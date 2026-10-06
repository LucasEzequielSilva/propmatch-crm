import { FEATURE_CHIPS, ZONES } from "@/data/seed";
import { ERROR_TEXT, ProppiError } from "@/lib/proppi/client";
import { supabase } from "@/lib/supabase";
import {
  MAX_DICTATION_CHARS,
  sanitizeBusqueda,
  sanitizePropiedad,
  type VozCatalog,
  type VozData,
  type VozKind,
} from "../../../shared/voz";
import { parseBusqueda, parsePropiedad } from "./parse";

/** Catálogo cerrado del CRM: lo que se puede marcar en los formularios. */
export const VOZ_CATALOG: VozCatalog = { zones: [...ZONES], amenities: [...FEATURE_CHIPS] };

export type VozSource = "proppi" | "local";

export interface VozExtraction {
  result: VozData;
  source: VozSource;
  /** Por qué no se usó Proppi aunque estaba activo (se cayó al parser local). */
  warning: string | null;
}

/** Sin IA: reglas en el navegador. Nunca sale nada de acá. */
export function parseLocal(kind: VozKind, text: string): VozData {
  // Pasa por el mismo saneamiento que la respuesta de Proppi.
  return kind === "propiedad"
    ? { kind, data: sanitizePropiedad(parsePropiedad(text, VOZ_CATALOG), VOZ_CATALOG) }
    : { kind, data: sanitizeBusqueda(parseBusqueda(text, VOZ_CATALOG), VOZ_CATALOG) };
}

/** Con Proppi: POST /api/proppi { mode: "extract" } (JWT + agencia, igual que el chat). */
export async function extractWithProppi(kind: VozKind, text: string, signal?: AbortSignal): Promise<VozData> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ProppiError("unauthorized");
  let r: Response;
  try {
    r = await fetch("/api/proppi", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: "extract", kind, text: text.slice(0, MAX_DICTATION_CHARS), catalog: VOZ_CATALOG }),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ProppiError("network");
  }
  const j = (await r.json().catch(() => null)) as { error?: string; kind?: string; data?: unknown } | null;
  if (!r.ok || !j || j.kind !== kind) throw new ProppiError(j?.error ?? "server_error");
  // El servidor ya sanea; se repite acá por si responde una versión vieja.
  return kind === "propiedad"
    ? { kind, data: sanitizePropiedad(j.data, VOZ_CATALOG) }
    : { kind, data: sanitizeBusqueda(j.data, VOZ_CATALOG) };
}

const EXTRA_ERRORS: Record<string, string> = {
  refusal: "Proppi no pudo procesar este texto.",
  truncated: "El dictado era muy largo para procesarlo entero.",
  bad_output: "La respuesta de Proppi vino incompleta.",
};

/**
 * Extrae con Proppi si está activo; si no (demo, sin key, error), con el
 * parser local. Siempre devuelve algo para revisar: nunca guarda nada.
 */
export async function extractVoz(opts: { kind: VozKind; text: string; useProppi: boolean; signal?: AbortSignal }): Promise<VozExtraction> {
  const text = opts.text.trim();
  if (!opts.useProppi) return { result: parseLocal(opts.kind, text), source: "local", warning: null };
  try {
    return { result: await extractWithProppi(opts.kind, text, opts.signal), source: "proppi", warning: null };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    const code = err instanceof ProppiError ? err.code : "server_error";
    const why = EXTRA_ERRORS[code] ?? ERROR_TEXT[code] ?? ERROR_TEXT.server_error;
    return {
      result: parseLocal(opts.kind, text),
      source: "local",
      warning: `${why} Lo armé con reglas básicas: revisalo con más cuidado.`,
    };
  }
}
