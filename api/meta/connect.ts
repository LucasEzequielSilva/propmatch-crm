import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../_lib/http.js";
import { crmDb } from "../_lib/inbox/db.js";
import { metaMessagingEnabled } from "../_lib/inbox/env.js";
import { sealToken } from "../_lib/inbox/crypto.js";
import { GraphError } from "../_lib/inbox/graph.js";
import { inboxAuth, jsonBody, str } from "../_lib/inbox/request.js";
import { pagesFromCode, subscribePage, type PageInfo } from "../_lib/inbox/meta.js";

/**
 * Conecta Messenger e Instagram (mensajes) de una Página de Facebook.
 *
 * El navegador hace FB.login con la configuración de Facebook Login for
 * Business de mensajería (response_type "code") y nos manda el code y,
 * opcionalmente, qué Página eligió. Si el usuario administra varias Páginas y
 * no eligió, devolvemos la lista (sin tokens) para que elija y repita.
 *
 * Apagado hasta que Meta apruebe los permisos (META_MESSAGING_ENABLED=1).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!metaMessagingEnabled()) return fail(res, 503, "messaging_disabled");
  const ctx = await inboxAuth(req, res, { admin: true, bucket: "meta_connect", limit: 10, windowSeconds: 600 });
  if (!ctx) return;

  const b = jsonBody(req);
  const code = str(b.code, 2048);
  const pageId = str(b.pageId, 64);
  const want = new Set((Array.isArray(b.channels) ? b.channels : ["messenger", "instagram"]).filter((c) => c === "messenger" || c === "instagram"));
  if (!code || want.size === 0) return fail(res, 400, "bad_request");

  let step = "exchange";
  try {
    const pages = await pagesFromCode(code);
    if (pages.length === 0) return fail(res, 404, "no_pages");
    const page: PageInfo | undefined = pageId ? pages.find((p) => p.id === pageId) : pages.length === 1 ? pages[0] : undefined;
    if (!page) {
      // El code ya se usó: el cliente vuelve a lanzar el login con la Página elegida.
      return json(res, 200, {
        ok: false,
        choosePage: pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account?.username ?? null })),
      });
    }

    step = "subscribe";
    await subscribePage(page.access_token, page.id);

    step = "save";
    const db = crmDb();
    const tokenEnc = sealToken(page.access_token);
    const saved: string[] = [];
    const rows: Record<string, unknown>[] = [];
    if (want.has("messenger")) {
      rows.push({ channel: "messenger", page_id: page.id, display_name: page.name });
    }
    const ig = page.instagram_business_account;
    if (want.has("instagram") && ig?.id) {
      rows.push({ channel: "instagram", page_id: page.id, ig_user_id: ig.id, display_name: page.name, username: ig.username ?? null });
    }
    for (const r of rows) {
      await db
        .from("channel_accounts")
        .update({ status: "disconnected" })
        .eq("agency_id", ctx.agencyId)
        .eq("channel", r.channel as string)
        .eq("page_id", page.id);
      const { error } = await db.from("channel_accounts").insert({
        ...r,
        agency_id: ctx.agencyId,
        status: "connected",
        access_token_enc: tokenEnc,
        connected_by: ctx.userId,
      });
      if (error) return fail(res, 409, "account_in_use");
      saved.push(r.channel as string);
    }
    return json(res, 200, { ok: true, connected: saved, instagramMissing: want.has("instagram") && !ig?.id });
  } catch (e) {
    console.warn("[meta/connect] falló", { step, graphCode: e instanceof GraphError ? e.code : null });
    return fail(res, 502, `connect_${step}_failed`);
  }
}
