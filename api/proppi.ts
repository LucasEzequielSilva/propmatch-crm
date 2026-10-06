import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAgencyMember } from "./_lib/auth.js";
import { allowMethod, fail } from "./_lib/http.js";
import { buildSystem, sanitizeSettings } from "./_lib/proppi/prompt.js";
import { PROPPI_TOOLS } from "./_lib/proppi/tools.js";
import { EFFORT, MAX_TOKENS, modelCaps, proppiModel, type ProppiMode } from "./_lib/proppi/model.js";
import { handleExtract, parseExtractBody } from "./_lib/proppi/extract.js";

/**
 * POST /api/proppi — relay SIN ESTADO entre el CRM y la API de Claude.
 *
 * El cliente manda el historial completo (append-only: el content de cada
 * respuesta del asistente se reenvía tal cual vino, con thinking incluido) y
 * la configuración de Proppi. Acá se agrega el system prompt y las tools, se
 * llama a Claude en streaming y se reenvía al navegador como SSE:
 *
 *   event: text   data: {"t": "..."}             (delta de texto)
 *   event: tool   data: {"name": "..."}          (Claude empezó a pedir una tool)
 *   event: done   data: {"stop_reason", "content", "usage", "model"}
 *   event: error  data: {"error": "codigo"}
 *
 * Si `stop_reason` es `tool_use`, el NAVEGADOR ejecuta las tools contra su
 * store y vuelve a llamar con los `tool_result`. El servidor nunca ve el CRM.
 *
 * Auth: JWT de Supabase + membresía de una inmobiliaria (mismo patrón que
 * api/meli/*). No hay modo demo: sin cuenta, 401.
 *
 * Con `mode: "extract"` es otra acción en la misma función (carga por voz):
 * respuesta JSON sin streaming. Ver _lib/proppi/extract.ts.
 */

const MAX_MESSAGES = 80;
const MAX_BODY_CHARS = 400_000;

type Msg = Anthropic.Beta.BetaMessageParam;

function parseBody(req: VercelRequest): { mode: ProppiMode; messages: Msg[]; settings: unknown } | null {
  const b = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  const mode: ProppiMode = b.mode === "inbox" ? "inbox" : "panel";
  const raw = b.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  if (JSON.stringify(raw).length > MAX_BODY_CHARS) return null;
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" && !Array.isArray(content)) return null;
  }
  const messages = raw as Msg[];
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return null;
  return { mode, messages, settings: b.settings };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Prepara el historial para el request SIN tocar lo que guarda el cliente:
 * - Tras un fallback server-side a mitad de respuesta, la doc pide omitir
 *   thinking / redacted_thinking / tool_use anteriores al último bloque
 *   `fallback` del turno (regla de "echoing fallback turns back").
 * - Breakpoint de caché en el último bloque del último mensaje (el historial
 *   crece por el final, así cada request reutiliza el anterior).
 * Es determinista: el mismo historial produce siempre los mismos bytes.
 */
function prepareMessages(messages: Msg[]): Msg[] {
  const out = messages.map((m): Msg => {
    if (m.role !== "assistant" || typeof m.content === "string") return m;
    const lastFallback = m.content.map((b) => b.type).lastIndexOf("fallback");
    if (lastFallback < 0) return m;
    const drop = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
    return { ...m, content: m.content.filter((b, i) => i > lastFallback || !drop.has(b.type)) };
  });
  const last = out[out.length - 1];
  const blocks: Anthropic.Beta.BetaContentBlockParam[] =
    typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const i = blocks.length - 1;
  const tail = blocks[i];
  if (tail && (tail.type === "text" || tail.type === "tool_result")) {
    blocks[i] = { ...tail, cache_control: { type: "ephemeral" } };
  }
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

function sse(res: VercelResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 503, "not_configured");

  let ctx;
  try {
    ctx = await requireAgencyMember(req, res);
  } catch {
    return fail(res, 500, "server_error");
  }
  if (!ctx) return;

  const rawBody = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (rawBody && typeof rawBody === "object" && rawBody.mode === "extract") {
    const extract = parseExtractBody(rawBody);
    if (!extract) return fail(res, 400, "bad_request");
    return handleExtract(res, extract, ctx.agencyId);
  }

  const body = parseBody(req);
  if (!body) return fail(res, 400, "bad_request");

  const model = proppiModel();
  const caps = modelCaps(model);
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    // Con thinking adaptive (5.x) el razonamiento también consume max_tokens.
    max_tokens: caps.effort ? MAX_TOKENS[body.mode] * 2 : MAX_TOKENS[body.mode],
    system: buildSystem(sanitizeSettings(body.settings)),
    tools: PROPPI_TOOLS,
    // tool_choice: auto (default). any/tool dan 400 en Opus 5.5.
    messages: prepareMessages(body.messages),
  };
  if (caps.effort) params.output_config = { effort: EFFORT[body.mode] };
  if (caps.serverFallback) {
    params.fallbacks = "default";
    params.betas = ["server-side-fallback-2026-07-01"];
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  const client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  try {
    const stream = client.beta.messages.stream(params, { signal: abort.signal });
    stream.on("text", (t) => sse(res, "text", { t }));
    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        sse(res, "tool", { name: ev.content_block.name });
      }
    });
    const msg = await stream.finalMessage();
    const u = msg.usage;
    // Verificación del caché en los logs de Vercel.
    console.log(
      `[proppi] agency=${ctx.agencyId} mode=${body.mode} model=${msg.model} stop=${msg.stop_reason} ` +
        `in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
    );
    sse(res, "done", {
      stop_reason: msg.stop_reason,
      content: msg.content,
      model: msg.model,
      usage: {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (err) {
    if (abort.signal.aborted) return void res.end();
    let code = "server_error";
    if (err instanceof Anthropic.RateLimitError) code = "rate_limited";
    else if (err instanceof Anthropic.AuthenticationError) code = "not_configured";
    else if (err instanceof Anthropic.BadRequestError) code = "bad_request";
    else if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) code = "overloaded";
    console.error(`[proppi] error ${code}`, err instanceof Anthropic.APIError ? err.status : "");
    sse(res, "error", { error: code });
  }
  res.end();
}
