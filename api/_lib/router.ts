import type { VercelRequest, VercelResponse } from "@vercel/node";

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

/**
 * Router interno para agrupar varias rutas en UNA función de Vercel (el plan
 * Hobby permite 12 funciones por deploy).
 *
 * vercel.json reescribe `/api/<grupo>/<acción>` → `/api/<grupo>?action=<acción>`.
 * La acción sale de `req.query.action` o, si no vino (p. ej. `vercel dev`
 * sin rewrites), del último segmento del path original.
 *
 * No toca `req.body`: el body se parsea de forma perezosa recién cuando el
 * handler lo lee, así el webhook de WhatsApp y las notificaciones de ML
 * siguen pudiendo leer el cuerpo crudo.
 */
export function routeByAction(group: string, routes: Record<string, Handler>): Handler {
  return (req, res) => {
    const q = req.query?.action;
    let action: string | undefined = Array.isArray(q) ? q[0] : q;
    if (!action) {
      const path = (req.url ?? "").split("?")[0];
      const m = new RegExp(`/api/${group}/([\\w-]+)/?$`).exec(path);
      action = m?.[1];
    }
    const handler = action && Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : undefined;
    if (!handler) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ error: "not_found" });
    }
    return handler(req, res);
  };
}
