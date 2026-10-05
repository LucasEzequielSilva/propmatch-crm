import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { GraphError, graph } from "../../inbox/graph.js";
import { isUuid, jsonBody } from "../../inbox/request.js";
import { failGraph, loadMetaConnection, metaPublishAuth } from "../../metaPublish/core.js";
import { loadPublication, savePublication } from "../../metaPublish/media.js";

/**
 * POST /api/meta/fb-delete — borra el posteo de la Página (DELETE /{page-post-id},
 * https://developers.facebook.com/docs/pages-api/posts) y deja la publicación
 * como `removed`. Instagram NO permite borrar por API: no hay equivalente.
 *
 * Body: { propertyId }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  const ctx = await metaPublishAuth(req, res);
  if (!ctx) return;

  const b = jsonBody(req);
  if (!isUuid(b.propertyId)) return fail(res, 400, "bad_request");
  const propertyId = b.propertyId;

  const pub = await loadPublication(ctx.agencyId, propertyId, "facebook");
  if (!pub?.external_id) return fail(res, 404, "not_published");
  const conn = await loadMetaConnection(ctx.agencyId);
  if (!conn) return fail(res, 409, "not_connected");

  try {
    await graph(pub.external_id, { method: "DELETE", token: conn.token });
  } catch (e) {
    // Ya no existe en Facebook (la borraron a mano): igual se marca como finalizada.
    const gone = e instanceof GraphError && (e.code === 100 || e.status === 404);
    if (!gone) return failGraph(res, ctx.agencyId, e, "fb-delete");
  }
  const row = await savePublication({
    agencyId: ctx.agencyId,
    propertyId,
    channel: "facebook",
    status: "removed",
    userId: ctx.userId,
  });
  json(res, 200, { ok: true, row });
}
