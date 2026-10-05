/**
 * POST /api/meli/notifications — callback de notificaciones de Mercado Libre
 * (topic `items`). Se configura en la app de Mercado Libre como
 * "Notifications callback URL".
 *
 * Mercado Libre pide responder HTTP 200 en menos de 500 ms y luego consultar
 * el recurso (https://developers.mercadolibre.com.ar/en_us/products-receive-notifications):
 * por eso se responde enseguida y el trabajo sigue con `waitUntil`.
 *
 * Las notificaciones NO vienen firmadas: el cuerpo se usa solo como pista.
 * Nunca se confía en su contenido: se verifica el application_id, se busca la
 * inmobiliaria por el user_id guardado al conectar, se relee el ítem con el
 * token de esa inmobiliaria y solo se actualiza la publicación cuyo
 * external_id coincide y pertenece a esa misma inmobiliaria.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { isConfigured, env } from "../../env.js";
import { getMeliSession } from "../../meli.js";
import { meliFetch, type MeliItem } from "../../meliItems.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { mapMeliItemStatus } from "../../../../shared/meliListing.js";

const RESOURCE = /^\/items\/(MLA\d{6,15})$/;

async function handleNotification(body: Record<string, unknown>): Promise<void> {
  if (body.topic !== "items") return;
  if (String(body.application_id ?? "") !== env("MELI_CLIENT_ID")) return;
  const m = RESOURCE.exec(String(body.resource ?? ""));
  const sellerId = String(body.user_id ?? "");
  if (!m || !/^\d{1,20}$/.test(sellerId)) return;
  const itemId = m[1];

  const db = supabaseAdmin();
  const { data: integ } = await db
    .from("agency_integrations")
    .select("agency_id")
    .eq("provider", "mercadolibre")
    .eq("external_account_id", sellerId)
    .maybeSingle();
  if (!integ) return;

  const { data: pub } = await db
    .from("property_publications")
    .select("id")
    .eq("agency_id", integ.agency_id)
    .eq("channel", "mercadolibre")
    .eq("external_id", itemId)
    .maybeSingle();
  if (!pub) return;

  const session = await getMeliSession(integ.agency_id);
  const item = await meliFetch<MeliItem>(session.token, `/items/${itemId}`);
  if (!item.ok || !item.body || String(item.body.seller_id ?? "") !== sellerId) return;

  const mapped = mapMeliItemStatus(item.body);
  await db
    .from("property_publications")
    .update({
      status: mapped.status,
      error_message: mapped.message,
      external_url: item.body.permalink ?? undefined,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", pub.id);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Siempre 200 rápido: si no, Mercado Libre reintenta y termina desactivando el topic.
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" || !isConfigured()) {
    res.status(200).end();
    return;
  }
  const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  waitUntil(handleNotification(body).catch(() => undefined));
  res.status(200).end();
}
