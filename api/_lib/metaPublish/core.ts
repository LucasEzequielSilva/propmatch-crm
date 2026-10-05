/**
 * Publicación en Facebook (Página) e Instagram profesional con la API oficial
 * de Meta. Fuente de verdad de la conexión: `agency_integrations` (provider
 * 'meta') en la base de la APP, la misma tabla que ya usa Mercado Libre:
 * existe hoy, cifra con INTEGRATIONS_ENC_KEY y no expone tokens al navegador
 * (grants por columna). El inbox unificado puede leer el mismo token de Página
 * más adelante en vez de pedir otro login.
 *
 *   external_account_id = id de la Página
 *   account_label       = nombre de la Página
 *   access_token_enc    = token de Página de larga duración (cifrado)
 *   scopes              = permisos que aceptó el usuario
 *   expires_at          = null (los tokens de Página de larga duración no vencen;
 *                         se invalidan si cambia la contraseña, el rol, etc.)
 *
 * La cuenta de Instagram vinculada NO se guarda: se consulta a la Página
 * (`instagram_business_account`) cada vez, así sigue andando si la cambian.
 *
 * Docs:
 * - Facebook Login for Business: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
 * - Tokens de larga duración: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin, requireAgencyMember, type AgencyContext } from "../auth.js";
import { decrypt } from "../crypto.js";
import { fail } from "../http.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { GRAPH_BASE, GraphError, graph, isAuthError } from "../inbox/graph.js";

export { GRAPH_VERSION } from "../inbox/graph.js";

const REQUIRED = [
  "META_APP_ID",
  "META_APP_SECRET",
  "INTEGRATIONS_ENC_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function metaPublishConfigured(): boolean {
  return REQUIRED.every((k) => !!process.env[k]);
}

/** Apagado hasta que Meta apruebe los permisos de publicación (App Review). */
export function metaPublishEnabled(): boolean {
  return metaPublishConfigured() && process.env.META_PUBLISH_ENABLED === "1";
}

/** Permisos que pide la configuración de Facebook Login for Business de publicación. */
export const META_PUBLISH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
] as const;

/** Flag + auth en un solo paso. Responde por sí misma y devuelve null si no corresponde seguir. */
export async function metaPublishAuth(
  req: VercelRequest,
  res: VercelResponse,
  opts: { admin?: boolean } = {},
): Promise<AgencyContext | null> {
  if (!metaPublishConfigured()) {
    fail(res, 503, "not_configured");
    return null;
  }
  if (!metaPublishEnabled()) {
    fail(res, 503, "publish_disabled");
    return null;
  }
  try {
    return opts.admin ? await requireAgencyAdmin(req, res) : await requireAgencyMember(req, res);
  } catch {
    fail(res, 500, "server_error");
    return null;
  }
}

export interface MetaConnection {
  pageId: string;
  pageName: string | null;
  token: string;
  status: string;
  scopes: string[] | null;
}

export async function loadMetaConnection(agencyId: string): Promise<MetaConnection | null> {
  const { data, error } = await supabaseAdmin()
    .from("agency_integrations")
    .select("status, external_account_id, account_label, access_token_enc, scopes")
    .eq("agency_id", agencyId)
    .eq("provider", "meta")
    .maybeSingle();
  if (error || !data?.external_account_id || !data.access_token_enc) return null;
  return {
    pageId: data.external_account_id,
    pageName: data.account_label ?? null,
    token: decrypt(data.access_token_enc),
    status: data.status,
    scopes: data.scopes ?? null,
  };
}

export async function markMetaNeedsReauth(agencyId: string): Promise<void> {
  await supabaseAdmin().from("agency_integrations").update({ status: "needs_reauth" }).eq("agency_id", agencyId).eq("provider", "meta");
}

export interface IgAccount {
  id: string;
  username: string | null;
}

/** Cuenta de Instagram profesional vinculada a la Página (o null). */
export async function instagramOf(conn: MetaConnection): Promise<IgAccount | null> {
  const r = await graph<{ instagram_business_account?: { id?: string; username?: string } }>(conn.pageId, {
    token: conn.token,
    query: { fields: "instagram_business_account{id,username}" },
    timeoutMs: 5000,
  });
  const ig = r.instagram_business_account;
  return ig?.id ? { id: ig.id, username: ig.username ?? null } : null;
}

/**
 * POST a la Graph API con cuerpo application/x-www-form-urlencoded, como en los
 * ejemplos oficiales (`attached_media[0]={"media_fbid":"…"}`, `children=a,b`).
 * El token va en el header; los errores se reducen a código + título.
 */
export async function graphPost<T>(path: string, token: string, params: Record<string, string | undefined>, timeoutMs = 20_000): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${GRAPH_BASE}/${path.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number; message?: string; error_user_title?: string } };
    if (!r.ok || j.error) {
      const e = j.error ?? {};
      throw new GraphError(r.status, e.code ?? null, e.error_subcode ?? null, (e.error_user_title || e.message || "").slice(0, 200));
    }
    return j as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Traduce un error de la Graph API a una respuesta. Token muerto → marca la
 * conexión para reconectar. El título de Meta se devuelve (es texto para el
 * usuario, sin datos internos) para que la inmobiliaria sepa qué corregir.
 */
export async function failGraph(res: VercelResponse, agencyId: string, e: unknown, where: string): Promise<void> {
  if (isAuthError(e)) {
    await markMetaNeedsReauth(agencyId).catch(() => undefined);
    return fail(res, 401, "needs_reauth");
  }
  const g = e instanceof GraphError ? e : null;
  console.warn(`[meta/${where}] graph`, { status: g?.status ?? null, code: g?.code ?? null, subcode: g?.subcode ?? null });
  // Límite de publicaciones de Instagram (código 9, subcódigo 2207042 en la doc de errores de IG).
  if (g?.code === 9 || g?.subcode === 2207042) return fail(res, 429, "quota_exceeded");
  res.setHeader("Cache-Control", "no-store");
  res.status(502).json({ error: "graph_error", detail: g?.title || null });
}

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
