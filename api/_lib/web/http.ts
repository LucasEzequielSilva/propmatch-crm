import type { VercelRequest, VercelResponse } from "@vercel/node";

/** La web pública solo necesita la base de la app (service role, solo servidor). */
export const webConfigured = () => !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Caché en el CDN de Vercel: 5 min fresco y hasta 1 h sirviendo la copia vieja
 * mientras se renueva. Ocultar o mostrar una propiedad tarda hasta 5 min en verse.
 */
export const CACHE_OK = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
const CACHE_MISS = "public, max-age=30, s-maxage=60";

export function sendJson(res: VercelResponse, status: number, body: unknown, opts: { cors?: boolean } = {}): void {
  res.setHeader("Cache-Control", status === 200 ? CACHE_OK : status === 404 ? CACHE_MISS : "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (opts.cors) res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(status).json(body);
}

export function onlyGet(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  res.setHeader("Allow", "GET");
  res.setHeader("Cache-Control", "no-store");
  res.status(405).json({ error: "method_not_allowed" });
  return false;
}

export const q = (req: VercelRequest, k: string): string => {
  const v = req.query?.[k];
  return (Array.isArray(v) ? v[0] : v ?? "").toString().trim().toLowerCase();
};

/** Origen público del sitio (para links absolutos en el feed y en Open Graph). */
export function siteOrigin(req: VercelRequest): string {
  const fromEnv = process.env.APP_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  return host ? `https://${host}` : "";
}
