import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { graph } from "../../inbox/graph.js";
import { isUuid, jsonBody } from "../../inbox/request.js";
import { failGraph, graphPost, instagramOf, loadMetaConnection, metaPublishAuth } from "../../metaPublish/core.js";
import { agencyProperty, isAllowedImage, probeImage } from "../../metaPublish/media.js";
import {
  META_PUBLISH_LIMITS,
  checkIgCaption,
  checkIgCount,
  checkIgImage,
  type IgPublishKind,
  type MediaIssue,
} from "../../../../shared/metaPublish.js";

/**
 * POST /api/meta/ig-create — paso 1 de la publicación en Instagram: crea el
 * contenedor (foto, carrusel o story de imagen). El paso 2 es ig-publish.
 *
 * Body: { kind: "image"|"carousel"|"story", images: [{ url, alt? }], caption?, propertyId? }
 *
 * Flujo oficial (https://developers.facebook.com/docs/instagram-platform/content-publishing):
 *   foto:     POST /{ig-id}/media image_url, caption, alt_text
 *   carrusel: POST /{ig-id}/media image_url, is_carousel_item=true (hasta 10)
 *             POST /{ig-id}/media media_type=CAROUSEL, children=a,b,c, caption
 *   story:    POST /{ig-id}/media image_url, media_type=STORIES
 * Antes: JPEG, relación 4:5–1,91:1, ≤ 8 MB y cupo de content_publishing_limit.
 *
 * Reels y stories de video no van por acá: el video tiene que estar en una
 * URL pública y el bucket de la app solo admite imágenes de hasta 5 MB.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  const ctx = await metaPublishAuth(req, res);
  if (!ctx) return;

  const b = jsonBody(req);
  const kind = b.kind as IgPublishKind;
  if (kind !== "image" && kind !== "carousel" && kind !== "story") return fail(res, 400, "bad_request");
  const raw = Array.isArray(b.images) ? b.images : [];
  const images = raw
    .filter((i): i is { url: string; alt?: unknown } => !!i && typeof (i as { url?: unknown }).url === "string")
    .map((i) => ({ url: i.url, alt: typeof i.alt === "string" ? i.alt.slice(0, META_PUBLISH_LIMITS.altTextMax) : "" }));
  if (images.length !== raw.length) return fail(res, 400, "bad_request");
  const caption = typeof b.caption === "string" ? b.caption : "";
  const propertyId = isUuid(b.propertyId) ? b.propertyId : null;
  if (b.propertyId != null && !propertyId) return fail(res, 400, "bad_request");

  const countIssue = checkIgCount(kind, images.length);
  if (countIssue) return json(res, 422, { error: "media_invalid", message: countIssue });
  if (kind !== "story") {
    const capIssue = checkIgCaption(caption);
    if (capIssue) return json(res, 422, { error: "caption_invalid", message: capIssue });
  }

  let photos = new Set<string>();
  if (propertyId) {
    const prop = await agencyProperty(ctx.agencyId, propertyId);
    if (!prop || prop.status !== "active") return fail(res, 404, "bad_property");
    photos = new Set(prop.photos);
  }
  if (images.some((i) => !isAllowedImage(i.url, ctx.agencyId, photos))) return fail(res, 400, "image_not_allowed");

  const facts = await Promise.all(images.map((i) => probeImage(i.url)));
  const issues = facts.map((f) => checkIgImage(f, kind)).filter((x): x is MediaIssue => !!x);
  if (issues.length) return json(res, 422, { error: "media_invalid", issues });

  const conn = await loadMetaConnection(ctx.agencyId);
  if (!conn) return fail(res, 409, "not_connected");
  if (conn.status === "needs_reauth") return fail(res, 401, "needs_reauth");

  try {
    const ig = await instagramOf(conn);
    if (!ig) return fail(res, 409, "no_instagram");

    // Cupo de 24 h (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit).
    const lim = await graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(`${ig.id}/content_publishing_limit`, {
      token: conn.token,
      query: { fields: "quota_usage,config" },
    });
    const usage = lim.data?.[0]?.quota_usage ?? 0;
    const total = lim.data?.[0]?.config?.quota_total ?? null;
    if (total != null && usage >= total) return json(res, 429, { error: "quota_exceeded", quota: { usage, total } });

    let containerId: string;
    if (kind === "carousel") {
      const children: string[] = [];
      for (const i of images) {
        const c = await graphPost<{ id: string }>(`${ig.id}/media`, conn.token, {
          image_url: i.url,
          is_carousel_item: "true",
          alt_text: i.alt || undefined,
        });
        children.push(c.id);
      }
      const parent = await graphPost<{ id: string }>(`${ig.id}/media`, conn.token, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: caption || undefined,
      });
      containerId = parent.id;
    } else if (kind === "story") {
      const c = await graphPost<{ id: string }>(`${ig.id}/media`, conn.token, { image_url: images[0].url, media_type: "STORIES" });
      containerId = c.id;
    } else {
      const c = await graphPost<{ id: string }>(`${ig.id}/media`, conn.token, {
        image_url: images[0].url,
        caption: caption || undefined,
        alt_text: images[0].alt || undefined,
      });
      containerId = c.id;
    }
    return json(res, 200, { ok: true, containerId, quota: total != null ? { usage, total } : null });
  } catch (e) {
    return failGraph(res, ctx.agencyId, e, "ig-create");
  }
}
