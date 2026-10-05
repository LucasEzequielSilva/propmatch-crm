/**
 * Cliente mínimo de la Graph API de Meta.
 *
 * Versión fija y explícita: Meta versiona la Graph API y cada versión vive
 * ~2 años. v26.0 es la última (29/07/2026) y v25.0 la que usan los ejemplos de
 * Embedded Signup; quedamos en v25.0 y se puede subir con META_GRAPH_VERSION
 * sin tocar código. https://developers.facebook.com/docs/graph-api/changelog
 */
export const GRAPH_VERSION = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION ?? "")
  ? (process.env.META_GRAPH_VERSION as string)
  : "v25.0";

export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: number | null,
    public subcode: number | null,
    public title: string,
  ) {
    super(`graph_${status}_${code ?? "x"}`);
  }
}

interface GraphOpts {
  method?: "GET" | "POST" | "DELETE";
  token?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * Llama a la Graph API. El token va en el header (no en la URL, para que no
 * quede en logs). Los errores se reducen a código + título: el cuerpo nunca se
 * loguea porque puede traer datos del cliente.
 */
export async function graph<T>(path: string, opts: GraphOpts = {}): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH_BASE}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const r = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number; message?: string; error_user_title?: string } };
    if (!r.ok || j.error) {
      const e = j.error ?? {};
      throw new GraphError(r.status, e.code ?? null, e.error_subcode ?? null, (e.error_user_title || e.message || "").slice(0, 200));
    }
    return j as T;
  } finally {
    clearTimeout(t);
  }
}

/** Errores de Graph que significan "token muerto": hay que reconectar. */
export function isAuthError(e: unknown): boolean {
  return e instanceof GraphError && (e.code === 190 || e.status === 401);
}
