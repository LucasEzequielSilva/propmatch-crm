import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { graph } from "../../inbox/graph.js";
import { isUuid, jsonBody } from "../../inbox/request.js";
import { failGraph, graphPost, loadMetaConnection, metaPublishAuth } from "../../metaPublish/core.js";
import { agencyProperty, isAllowedImage, probeImage, savePublication } from "../../metaPublish/media.js";
import { agencySlugById } from "../../web/data.js";
import { META_PUBLISH_LIMITS, checkFbImage, type MediaIssue } from "../../../../shared/metaPublish.js";

/**
 * POST /api/meta/fb-publish — posteo en la Página de Facebook.
 *
 * Body: { propertyId?, message, images?: string[], withLink?: boolean }
 *
 * - Con fotos (doc https://developers.facebook.com/docs/graph-api/reference/page/photos/):
 *   cada foto se sube con POST /{page-id}/photos url=…, published=false y
 *   después POST /{page-id}/feed message=…, attached_media[i]={"media_fbid":"…"}.
 * - Sin fotos y con withLink: POST /{page-id}/feed message=…, link=<ficha en la web>.
 *   (Si hay fotos, el link va dentro del texto: Facebook no combina las dos cosas.)
 * Doc del feed: https://developers.facebook.com/docs/graph-api/reference/page/feed/
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  const ctx = await metaPublishAuth(req, res);
  if (!ctx) return;

  const b = jsonBody(req);
  const propertyId = isUuid(b.propertyId) ? b.propertyId : null;
  if (b.propertyId != null && !propertyId) return fail(res, 400, "bad_request");
  let message = typeof b.message === "string" ? b.message.trim() : "";
  if (message.length > META_PUBLISH_LIMITS.fbMessageMax) return fail(res, 400, "message_too_long");
  const images = Array.isArray(b.images) ? b.images.filter((u): u is string => typeof u === "string") : [];
  if (images.length > META_PUBLISH_LIMITS.fbPhotosMax) return fail(res, 400, "too_many_images");

  let photos = new Set<string>();
  if (propertyId) {
    const prop = await agencyProperty(ctx.agencyId, propertyId);
    if (!prop || prop.status !== "active") return fail(res, 404, "bad_property");
    photos = new Set(prop.photos);
  }
  if (images.some((u) => !isAllowedImage(u, ctx.agencyId, photos))) return fail(res, 400, "image_not_allowed");

  let link: string | null = null;
  if (b.withLink === true && propertyId && process.env.APP_URL) {
    const slug = await agencySlugById(ctx.agencyId);
    if (slug) link = `${process.env.APP_URL.replace(/\/+$/, "")}/sitio/${slug}/p/${propertyId}`;
  }
  if (link && images.length) message = `${message}\n\n${link}`.trim();
  if (!message && !images.length && !link) return fail(res, 400, "empty_post");

  if (images.length) {
    const facts = await Promise.all(images.map((u) => probeImage(u)));
    const issues = facts.map(checkFbImage).filter((x): x is MediaIssue => !!x);
    if (issues.length) return json(res, 422, { error: "media_invalid", issues });
  }

  const conn = await loadMetaConnection(ctx.agencyId);
  if (!conn) return fail(res, 409, "not_connected");
  if (conn.status === "needs_reauth") return fail(res, 401, "needs_reauth");

  try {
    const params: Record<string, string | undefined> = { message: message || undefined };
    if (images.length) {
      const ids: string[] = [];
      for (const url of images) {
        const p = await graphPost<{ id: string }>(`${conn.pageId}/photos`, conn.token, { url, published: "false" });
        ids.push(p.id);
      }
      ids.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
    } else if (link) {
      params.link = link;
    }
    const post = await graphPost<{ id: string }>(`${conn.pageId}/feed`, conn.token, params);

    let permalink = `https://www.facebook.com/${post.id}`;
    try {
      const p = await graph<{ permalink_url?: string }>(post.id, { token: conn.token, query: { fields: "permalink_url" } });
      if (p.permalink_url) permalink = p.permalink_url;
    } catch {
      /* queda el formato documentado https://www.facebook.com/{page_post_id} */
    }

    const row = propertyId
      ? await savePublication({
          agencyId: ctx.agencyId,
          propertyId,
          channel: "facebook",
          status: "published",
          externalId: post.id,
          externalUrl: permalink,
          userId: ctx.userId,
        })
      : null;
    return json(res, 200, { ok: true, postId: post.id, permalink, row });
  } catch (e) {
    return failGraph(res, ctx.agencyId, e, "fb-publish");
  }
}
