import type Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";

/**
 * Cliente de `/api/proppi`. Solo tipos del SDK (se borran al compilar): la key
 * y el SDK viven en el servidor.
 */

export type ApiMessage = Anthropic.Beta.BetaMessageParam;
export type ApiBlock = Anthropic.Beta.BetaContentBlock;
export type ProppiMode = "panel" | "inbox";

export interface ProppiSettingsPayload {
  tone: "cercano" | "formal";
  signature: string;
  knowledge: string;
}

export interface DoneEvent {
  stop_reason: Anthropic.Beta.BetaStopReason | null;
  content: ApiBlock[];
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

export class ProppiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Proppi está disponible con tu cuenta de inmobiliaria. Iniciá sesión para usarlo.",
  forbidden: "Proppi está disponible con tu cuenta de inmobiliaria.",
  not_configured: "Proppi todavía no está configurado en este servidor.",
  rate_limited: "Hay muchas consultas en este momento. Probá de nuevo en un minuto.",
  overloaded: "El servicio está con mucha demanda. Probá de nuevo en un rato.",
  bad_request: "No pude procesar la consulta. Probá empezar una conversación nueva.",
  network: "No me pude conectar. Revisá tu conexión y probá de nuevo.",
  server_error: "Algo falló de nuestro lado. Probá de nuevo.",
};

export async function streamProppi(opts: {
  mode: ProppiMode;
  messages: ApiMessage[];
  settings: ProppiSettingsPayload;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onTool: (name: string) => void;
}): Promise<DoneEvent> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ProppiError("unauthorized");

  let r: Response;
  try {
    r = await fetch("/api/proppi", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: opts.mode, messages: opts.messages, settings: opts.settings }),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ProppiError("network");
  }
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new ProppiError(j?.error ?? "server_error");
  }

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let done: DoneEvent | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let payload = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) payload += line.slice(6);
      }
      const d = payload ? JSON.parse(payload) : {};
      if (event === "text") opts.onText(d.t);
      else if (event === "tool") opts.onTool(d.name);
      else if (event === "done") done = d as DoneEvent;
      else if (event === "error") throw new ProppiError(d.error ?? "server_error");
    }
  }
  if (!done) throw new ProppiError("network");
  return done;
}
