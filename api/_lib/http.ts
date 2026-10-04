import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Todas las respuestas de la API van sin caché. */
export function noStore(res: VercelResponse): void {
  res.setHeader("Cache-Control", "no-store");
}

export function json(res: VercelResponse, status: number, body: unknown): void {
  noStore(res);
  res.status(status).json(body);
}

/** Error genérico: nunca devuelve detalles internos. */
export function fail(res: VercelResponse, status: number, code: string): void {
  json(res, status, { error: code });
}

export function allowMethod(req: VercelRequest, res: VercelResponse, method: "GET" | "POST"): boolean {
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  fail(res, 405, "method_not_allowed");
  return false;
}

export function redirect(res: VercelResponse, location: string): void {
  noStore(res);
  res.setHeader("Location", location);
  res.status(302).end();
}

export function readCookie(req: VercelRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
