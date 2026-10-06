import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { graph } from "../../inbox/graph.js";
import { isUuid, jsonBody, str } from "../../inbox/request.js";
import { failGraph, graphPost, instagramOf, loadMetaConnection, metaPublishAuth } from "../../metaPublish/core.js";
import { agencyProperty, savePublication } from "../../metaPublish/media.js";
import type { IgContainerStatus } from "../../../../shared/metaPublish.js";

/**
 * POST /api/meta/ig-publish — paso 2: si el contenedor está FINISHED, lo
 * publica (POST /{ig-id}/media_publish creation_id=…) y guarda el resultado
 * en property_publications (si vino propertyId).
 *
 * Si todavía está IN_PROGRESS responde 202 { pending: true } y el navegador
 * vuelve a preguntar (la doc recomienda consultar el estado una vez por minuto
 * hasta 5 minutos; las fotos suelen estar listas en segundos, así que el
 * navegador pregunta cada 5 s y corta a los 5 min).
 *
 * Body: { containerId, propertyId? }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  const ctx = await metaPublishAuth(req, res);
  if (!ctx) return;

  const b = jsonBody(req);
  const containerId = str(b.containerId, 64);
  if (!containerId || !/^\d+$/.test(containerId)) return fail(res, 400, "bad_request");
  const propertyId = isUuid(b.propertyId) ? b.propertyId : null;
  if (propertyId) {
    const prop = await agencyProperty(ctx.agencyId, propertyId);
    if (!prop) return fail(res, 404, "bad_property");
  }

  const conn = await loadMetaConnection(ctx.agencyId);
  if (!conn) return fail(res, 409, "not_connected");

  try {
    const ig = await instagramOf(conn);
    if (!ig) return fail(res, 409, "no_instagram");

    const st = await graph<{ status_code?: IgContainerStatus }>(containerId, { token: conn.token, query: { fields: "status_code" } });
    switch (st.status_code) {
      case "IN_PROGRESS":
        return json(res, 202, { ok: false, pending: true });
      case "ERROR":
        return fail(res, 422, "container_error");
      case "EXPIRED":
        return fail(res, 410, "container_expired");
      case "PUBLISHED":
        return fail(res, 409, "already_published");
      default:
        break; // FINISHED
    }

    const pub = await graphPost<{ id: string }>(`${ig.id}/media_publish`, conn.token, { creation_id: containerId });
    let permalink: string | null = null;
    try {
      const m = await graph<{ permalink?: string }>(pub.id, { token: conn.token, query: { fields: "permalink" } });
      permalink = m.permalink ?? null;
    } catch {
      /* el link es un extra: la publicación ya salió */
    }

    const row = propertyId
      ? await savePublication({
          agencyId: ctx.agencyId,
          propertyId,
          channel: "instagram",
          status: "published",
          externalId: pub.id,
          externalUrl: permalink,
          userId: ctx.userId,
        })
      : null;
    return json(res, 200, { ok: true, mediaId: pub.id, permalink, row });
  } catch (e) {
    return failGraph(res, ctx.agencyId, e, "ig-publish");
  }
}
