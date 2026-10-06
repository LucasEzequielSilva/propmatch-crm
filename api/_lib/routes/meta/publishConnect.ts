import type { VercelRequest, VercelResponse } from "@vercel/node";
import { encrypt } from "../../crypto.js";
import { allowMethod, fail, json } from "../../http.js";
import { GraphError, graph } from "../../inbox/graph.js";
import { jsonBody, str } from "../../inbox/request.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { instagramOf, metaPublishAuth } from "../../metaPublish/core.js";

interface PageRow {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string };
}

/**
 * POST /api/meta/publish-connect — conecta la Página de Facebook (y su
 * Instagram profesional) para PUBLICAR.
 *
 * Mismo login que el inbox (Facebook Login for Business con response_type
 * "code" desde el JS SDK) pero con la configuración de publicación
 * (VITE_META_PUBLISH_CONFIG_ID). Intercambio, igual que api/_lib/inbox/meta.ts:
 *   code → token de usuario → token de usuario de larga duración →
 *   /me/accounts → token de Página (de larga duración: no vence).
 * Doc: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 *
 * Si administra varias Páginas y no eligió, devuelve la lista (sin tokens) y
 * el navegador repite el login con la elegida (el code es de un solo uso).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  const ctx = await metaPublishAuth(req, res, { admin: true });
  if (!ctx) return;

  const b = jsonBody(req);
  const code = str(b.code, 2048);
  const pageId = str(b.pageId, 64);
  if (!code) return fail(res, 400, "bad_request");

  const appId = process.env.META_APP_ID as string;
  const secret = process.env.META_APP_SECRET as string;
  let step = "exchange";
  try {
    const short = await graph<{ access_token?: string }>("oauth/access_token", { query: { client_id: appId, client_secret: secret, code } });
    if (!short.access_token) throw new Error("no_token");
    const long = await graph<{ access_token?: string }>("oauth/access_token", {
      query: { grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: short.access_token },
    });
    const userToken = long.access_token ?? short.access_token;

    step = "permissions";
    const perms = await graph<{ data?: { permission: string; status: string }[] }>("me/permissions", { token: userToken });
    const granted = (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);

    step = "pages";
    const r = await graph<{ data?: PageRow[] }>("me/accounts", {
      token: userToken,
      query: { fields: "id,name,access_token,tasks,instagram_business_account{id,username}", limit: "50" },
    });
    const pages = (r.data ?? []).filter((p) => p.id && p.access_token);
    if (pages.length === 0) return fail(res, 404, "no_pages");
    const page = pageId ? pages.find((p) => p.id === pageId) : pages.length === 1 ? pages[0] : undefined;
    if (!page) {
      return json(res, 200, {
        ok: false,
        choosePage: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account?.username ?? null })),
      });
    }
    // Publicar en la Página requiere la tarea CREATE_CONTENT (doc de /{page-id}/feed).
    if (Array.isArray(page.tasks) && !page.tasks.includes("CREATE_CONTENT")) return fail(res, 403, "no_create_content");

    step = "save";
    const db = supabaseAdmin();
    const { data: taken } = await db
      .from("agency_integrations")
      .select("agency_id")
      .eq("provider", "meta")
      .eq("external_account_id", page.id)
      .neq("agency_id", ctx.agencyId)
      .limit(1);
    if (taken && taken.length > 0) return fail(res, 409, "page_in_use");

    const { error } = await db.from("agency_integrations").upsert(
      {
        agency_id: ctx.agencyId,
        provider: "meta",
        status: "connected",
        external_account_id: page.id,
        account_label: page.name,
        access_token_enc: encrypt(page.access_token),
        refresh_token_enc: null,
        expires_at: null,
        scopes: granted,
        connected_by: ctx.userId,
      },
      { onConflict: "agency_id,provider" },
    );
    if (error) return fail(res, 500, "save_failed");

    let instagram = page.instagram_business_account?.id
      ? { id: page.instagram_business_account.id, username: page.instagram_business_account.username ?? null }
      : null;
    if (!instagram) {
      instagram = await instagramOf({ pageId: page.id, pageName: page.name, token: page.access_token, status: "connected", scopes: granted }).catch(() => null);
    }
    return json(res, 200, {
      ok: true,
      page: { id: page.id, name: page.name },
      instagram: instagram ? { username: instagram.username } : null,
      missingScopes: ["pages_manage_posts", "instagram_content_publish"].filter((s) => !granted.includes(s)),
    });
  } catch (e) {
    console.warn("[meta/publish-connect] falló", { step, graphCode: e instanceof GraphError ? e.code : null });
    return fail(res, 502, `connect_${step}_failed`);
  }
}
