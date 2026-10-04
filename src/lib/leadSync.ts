/**
 * Leads reales de la app: gente real que matcheó, propuso una visita o hizo
 * una oferta sobre una propiedad de la agencia. Solo lectura — la app nunca
 * se entera de que esto existe. `store.tsx` decide qué hacer con cada fila
 * (crear contacto + oportunidad, o solo una actividad).
 */

import { supabase } from "./supabase";

export interface SwipeRow {
  id: string;
  demandante_id: string;
  property_id: string;
  created_at: string;
  status: string;
}

export interface MatchRow {
  id: string;
  demandante_id: string;
  property_id: string;
  created_at: string;
}

export interface VisitRow {
  id: string;
  demandante_id: string;
  property_id: string;
  created_at: string;
}

export interface OfferRow {
  id: string;
  demandante_id: string;
  property_id: string;
  amount_usd: number;
  status: string;
  created_at: string;
}

export interface AppUserRow {
  id: string;
  name: string;
}

/** Solo swipes a la derecha: un "me interesa" real sobre una propiedad de la agencia. */
export async function fetchAgencySwipes(agencyId: string): Promise<SwipeRow[]> {
  const { data, error } = await supabase
    .from("swipes")
    .select("id, demandante_id, property_id, created_at, status, direction, properties!inner(agency_id)")
    .eq("direction", "right")
    .eq("properties.agency_id", agencyId);
  if (error) throw error;
  return data as unknown as SwipeRow[];
}

/** Acepta/rechaza un "me interesa" real — UPDATE directo sobre `swipes`, permitido por la policy `swipes_agency_update`. */
export async function respondToSwipe(
  swipeId: string,
  action: "accepted" | "rejected",
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("swipes").update({ status: action }).eq("id", swipeId);
  return { error: error?.message ?? null };
}

/** Filtra por `properties.agency_id` vía el embed — requiere el FK `property_id → properties.id`. */
export async function fetchAgencyMatches(agencyId: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("id, demandante_id, property_id, created_at, properties!inner(agency_id)")
    .eq("properties.agency_id", agencyId);
  if (error) throw error;
  return data as unknown as MatchRow[];
}

export async function fetchAgencyVisits(agencyId: string): Promise<VisitRow[]> {
  const { data, error } = await supabase
    .from("visits")
    .select("id, demandante_id, property_id, created_at, properties!inner(agency_id)")
    .eq("properties.agency_id", agencyId);
  if (error) throw error;
  return data as unknown as VisitRow[];
}

export async function fetchAgencyOffers(agencyId: string): Promise<OfferRow[]> {
  const { data, error } = await supabase
    .from("offers")
    .select("id, demandante_id, property_id, amount_usd, status, created_at, properties!inner(agency_id)")
    .eq("properties.agency_id", agencyId);
  if (error) throw error;
  return data as unknown as OfferRow[];
}

export interface MessageRow {
  id: string;
  match_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
}

/** Historial de un match real — el mismo chat que ve el usuario en la app. */
export async function fetchMatchMessages(matchId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, match_id, sender_id, content, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as MessageRow[];
}

/** Manda un mensaje real al chat — permitido por `messages_agency_send`. */
export async function sendMatchMessage(
  matchId: string,
  senderId: string,
  content: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("messages").insert({ match_id: matchId, sender_id: senderId, content });
  return { error: error?.message ?? null };
}

/**
 * Acepta/rechaza una oferta real usando el mismo RPC que usaría la app
 * (`respond_offer`). OJO: ese RPC exige que quien llama sea el
 * `propietario_id` de la oferta (el `owner_id` real de la propiedad) — hoy
 * eso solo funciona si el agente logueado es la cuenta paraguas de la
 * agencia. Con más de un agente por agencia, esto va a fallar para los que
 * no sean esa cuenta; ahí hay que resolverlo distinto (ver charla con Lucas).
 */
export async function respondToOffer(
  offerId: string,
  action: "accept" | "reject",
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("respond_offer", {
    p_offer_id: offerId,
    p_action: action,
    p_counter_amount_usd: null,
  });
  return { error: error?.message ?? null };
}

/** Solo `id, name`: `email`/`phone` de un usuario de la app no son legibles para `authenticated` (a propósito). */
export async function fetchUsersByIds(ids: string[]): Promise<AppUserRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("users").select("id, name").in("id", ids);
  if (error) throw error;
  return data as AppUserRow[];
}
