import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin, requireAgencyMember, type AgencyContext } from "../auth.js";
import { fail } from "../http.js";
import { rateHit } from "./db.js";

/**
 * Cuerpo crudo del request (para validar la firma del webhook). En Vercel los
 * helpers ya leyeron el stream y lo reinyectan para "data"/"end"; si no hay
 * stream (otro runtime) se cae al cuerpo ya parseado/serializado.
 */
export async function readRawBody(req: VercelRequest, maxBytes = 2_000_000): Promise<Buffer> {
  const fromStream = await new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (v: Buffer | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      req.on("data", (c: Buffer | string) => {
        const b = typeof c === "string" ? Buffer.from(c) : c;
        size += b.length;
        if (size > maxBytes) return finish(null);
        chunks.push(b);
      });
      req.on("end", () => finish(Buffer.concat(chunks)));
      req.on("error", () => finish(null));
    } catch {
      finish(null);
    }
    // Si el stream ya fue consumido y no emite nada, no colgamos la función.
    setTimeout(() => finish(chunks.length ? Buffer.concat(chunks) : null), 1500);
  });
  if (fromStream && fromStream.length) return fromStream;
  const b = (req as unknown as { body?: unknown }).body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b);
  return Buffer.alloc(0);
}

/** IP del cliente para el rate limit (Vercel pone x-forwarded-for). */
export function clientIp(req: VercelRequest): string {
  const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return xf || "unknown";
}

/**
 * Auth del inbox: JWT del Supabase de la app → agency_id (agency_members) y
 * rate limit por usuario. Responde 401/403/429 por sí misma.
 */
export async function inboxAuth(
  req: VercelRequest,
  res: VercelResponse,
  opts: { admin?: boolean; bucket: string; limit: number; windowSeconds?: number },
): Promise<AgencyContext | null> {
  const ctx = opts.admin ? await requireAgencyAdmin(req, res) : await requireAgencyMember(req, res);
  if (!ctx) return null;
  const ok = await rateHit(`${opts.bucket}:${ctx.userId}`, opts.limit, opts.windowSeconds ?? 60);
  if (!ok) {
    res.setHeader("Retry-After", String(opts.windowSeconds ?? 60));
    fail(res, 429, "rate_limited");
    return null;
  }
  return ctx;
}

/** Body JSON como objeto (o {} si vino vacío/mal). */
export function jsonBody(req: VercelRequest): Record<string, unknown> {
  const b = (req as unknown as { body?: unknown }).body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b as Record<string, unknown>;
  if (typeof b === "string") {
    try {
      const j = JSON.parse(b);
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }
  return {};
}

export const str = (v: unknown, max = 4096): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Para logs: nunca el número completo. */
export function maskPhone(p: string | null | undefined): string {
  if (!p) return "-";
  const d = p.replace(/\D/g, "");
  return d.length <= 4 ? "****" : `***${d.slice(-4)}`;
}
