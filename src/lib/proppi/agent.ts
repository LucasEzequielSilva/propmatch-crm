import type Anthropic from "@anthropic-ai/sdk";
import {
  ERROR_TEXT,
  ProppiError,
  streamProppi,
  type ApiMessage,
  type DoneEvent,
  type ProppiMode,
  type ProppiSettingsPayload,
} from "./client";
import { runTool, TOOL_STATUS, type ToolData } from "./tools";

/**
 * Loop de tool use del lado del cliente.
 *
 * El historial es APPEND-ONLY: el `content` de cada respuesta se guarda tal
 * cual vino (thinking incluido) y nunca se edita. Si un turno falla o Claude
 * se niega, se descarta el turno entero (se vuelve al historial anterior), lo
 * que solo recorta la cola y no rompe el caché del prefijo.
 */

const MAX_ITERATIONS = 6;

export type TurnStatus = "ok" | "truncated" | "refusal" | "limit" | "error";

export interface TurnResult {
  history: ApiMessage[];
  text: string;
  status: TurnStatus;
  errorText?: string;
}

const REFUSAL_TEXT =
  "Prefiero no responder eso. Si es una consulta del trabajo, probá reformularla o contame un poco más de contexto.";

export function todayLine(now = new Date()): string {
  const fecha = now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `[Hoy es ${fecha} (${iso}).]`;
}

type Block = Anthropic.Beta.BetaContentBlockParam;

export async function runTurn(opts: {
  mode: ProppiMode;
  history: ApiMessage[];
  /** Texto que ve Claude para este turno (ya con fecha y contexto). */
  prompt: string;
  settings: ProppiSettingsPayload;
  getData: () => ToolData;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onStatus: (label: string | null) => void;
}): Promise<TurnResult> {
  const msgs: ApiMessage[] = [...opts.history, { role: "user", content: [{ type: "text", text: opts.prompt }] }];
  let text = "";
  let needsGap = false;

  const fail = (errorText: string, status: TurnStatus = "error"): TurnResult => ({
    history: opts.history,
    text,
    status,
    errorText,
  });

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      opts.onStatus("pensando");
      const done: DoneEvent = await streamProppi({
        mode: opts.mode,
        messages: msgs,
        settings: opts.settings,
        signal: opts.signal,
        onText: (t) => {
          opts.onStatus(null);
          if (needsGap) {
            needsGap = false;
            text += "\n\n";
            opts.onText("\n\n");
          }
          text += t;
          opts.onText(t);
        },
        onTool: (name) => opts.onStatus(TOOL_STATUS[name] ?? "consultando el CRM"),
      });
      if (text) needsGap = true;

      // Siempre se mira stop_reason antes de usar el content.
      const stop = done.stop_reason;
      if (stop === "refusal") return fail(REFUSAL_TEXT, "refusal");

      const toolUses = done.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const assistant: ApiMessage = { role: "assistant", content: done.content as unknown as Block[] };

      if (stop === "max_tokens") {
        // Un tool_use cortado puede parecer válido: no se ejecuta.
        if (toolUses.length) return fail("La respuesta quedó cortada. Probá con una pregunta más acotada.");
        msgs.push(assistant);
        return { history: msgs, text, status: "truncated" };
      }
      if (stop === "pause_turn") {
        msgs.push(assistant);
        continue;
      }
      if (stop !== "tool_use" || toolUses.length === 0) {
        msgs.push(assistant);
        return { history: msgs, text, status: "ok" };
      }

      msgs.push(assistant);
      const data = opts.getData();
      const results = await Promise.all(toolUses.map((t) => runTool(t.name, t.input, data)));
      // Todos los tool_result del turno en UN solo mensaje user.
      msgs.push({
        role: "user",
        content: toolUses.map(
          (t, k): Block => ({
            type: "tool_result",
            tool_use_id: t.id,
            content: results[k].content,
            ...(results[k].isError ? { is_error: true } : {}),
          }),
        ),
      });
    }
    return { history: msgs, text, status: "limit", errorText: "Me quedé sin pasos para esta consulta. Probá dividirla en partes." };
  } catch (err) {
    if (opts.signal?.aborted) return fail("Consulta cancelada.");
    const code = err instanceof ProppiError ? err.code : "network";
    return fail(ERROR_TEXT[code] ?? ERROR_TEXT.server_error);
  } finally {
    opts.onStatus(null);
  }
}
