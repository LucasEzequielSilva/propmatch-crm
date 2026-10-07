/**
 * Acceso a las tablas de marketing del Supabase PROPIO del CRM (service role).
 * La fuente de verdad de bajas y consentimientos es ESTA base: el navegador
 * puede tener copia, pero el servidor vuelve a chequear antes de cada envío.
 */
import { crmDb } from "../inbox/db.js";
import { normalizePhone, type MarketingChannel, type UnsubscribeScope } from "../../../shared/marketing.js";

export type UnsubSource =
  | "link_email"
  | "one_click"
  | "whatsapp_boton"
  | "whatsapp_texto"
  | "whatsapp_meta"
  | "queja_spam"
  | "rebote"
  | "manual";

export interface Suppression {
  /** Bajas vigentes que alcanzan a este canal (canal o "todos"). */
  unsubEmails: Set<string>;
  unsubPhones: Set<string>;
  unsubRefs: Set<string>;
  /** Consentimiento vigente (el último registro es "granted"). */
  consentEmails: Set<string>;
  consentPhones: Set<string>;
}

const PAGE = 1000;
const MAX_ROWS = 50_000;

async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error("db");
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadSuppression(agencyId: string, channel: MarketingChannel): Promise<Suppression> {
  const db = crmDb();
  const unsubs = await allRows<{ email_norm: string | null; phone_norm: string | null; contact_ref: string | null }>((a, b) =>
    db
      .from("marketing_unsubscribes")
      .select("email_norm, phone_norm, contact_ref")
      .eq("agency_id", agencyId)
      .is("revoked_at", null)
      .in("scope", [channel, "all"])
      .range(a, b),
  );
  const consents = await allRows<{ email_norm: string | null; phone_norm: string | null; status: string; given_at: string }>((a, b) =>
    db
      .from("marketing_consents")
      .select("email_norm, phone_norm, status, given_at")
      .eq("agency_id", agencyId)
      .eq("channel", channel)
      .order("given_at", { ascending: true })
      .range(a, b),
  );
  const s: Suppression = {
    unsubEmails: new Set(),
    unsubPhones: new Set(),
    unsubRefs: new Set(),
    consentEmails: new Set(),
    consentPhones: new Set(),
  };
  for (const u of unsubs) {
    if (u.email_norm) s.unsubEmails.add(u.email_norm);
    if (u.phone_norm) s.unsubPhones.add(u.phone_norm);
    if (u.contact_ref) s.unsubRefs.add(u.contact_ref);
  }
  // Orden ascendente: el último registro gana.
  for (const c of consents) {
    const on = c.status === "granted";
    if (c.email_norm) (on ? s.consentEmails.add(c.email_norm) : s.consentEmails.delete(c.email_norm));
    if (c.phone_norm) (on ? s.consentPhones.add(c.phone_norm) : s.consentPhones.delete(c.phone_norm));
  }
  return s;
}

/** Motivo por el que NO se le puede mandar, o null si se puede. */
export function blockedReason(
  s: Suppression,
  channel: MarketingChannel,
  r: { contact_ref?: string | null; email_norm?: string | null; phone_norm?: string | null },
): string | null {
  if (r.contact_ref && s.unsubRefs.has(r.contact_ref)) return "baja";
  if (channel === "email") {
    if (!r.email_norm) return "sin_email";
    if (s.unsubEmails.has(r.email_norm)) return "baja";
    if (!s.consentEmails.has(r.email_norm)) return "sin_consentimiento";
  } else {
    if (!r.phone_norm) return "sin_telefono";
    if (s.unsubPhones.has(r.phone_norm)) return "baja";
    if (!s.consentPhones.has(r.phone_norm)) return "sin_consentimiento";
  }
  return null;
}

export interface UnsubInput {
  agencyId: string;
  scope: UnsubscribeScope;
  contactRef?: string | null;
  email?: string | null;
  phone?: string | null;
  source: UnsubSource;
  campaignId?: string | null;
  recipientId?: string | null;
  note?: string | null;
  recordedBy?: string | null;
}

/**
 * Registra una baja (idempotente: si ya hay una vigente igual, no duplica) y
 * saca de la cola lo que estuviera pendiente para ese destino.
 */
export async function recordUnsubscribe(u: UnsubInput): Promise<{ created: boolean }> {
  const db = crmDb();
  if (!u.email && !u.phone && !u.contactRef) throw new Error("no_target");
  let q = db
    .from("marketing_unsubscribes")
    .select("id")
    .eq("agency_id", u.agencyId)
    .eq("scope", u.scope)
    .is("revoked_at", null)
    .limit(1);
  if (u.email) q = q.eq("email_norm", u.email);
  else if (u.phone) q = q.eq("phone_norm", u.phone);
  else q = q.eq("contact_ref", u.contactRef as string);
  const { data: existing } = await q;
  let created = false;
  if (!existing?.length) {
    const { error } = await db.from("marketing_unsubscribes").insert({
      agency_id: u.agencyId,
      scope: u.scope,
      contact_ref: u.contactRef ?? null,
      email_norm: u.email ?? null,
      phone_norm: u.phone ?? null,
      source: u.source,
      campaign_id: u.campaignId ?? null,
      recipient_id: u.recipientId ?? null,
      note: u.note?.slice(0, 500) ?? null,
      recorded_by: u.recordedBy ?? null,
    });
    if (error) throw new Error("db");
    created = true;
  }

  // Lo que estaba en cola para ese destino ya no sale.
  const channels: MarketingChannel[] = u.scope === "all" ? ["email", "whatsapp"] : [u.scope];
  for (const ch of channels) {
    const target = ch === "email" ? u.email : u.phone;
    if (!target) continue;
    await db
      .from("marketing_recipients")
      .update({ status: "skipped", skip_reason: "baja", html: null, text_body: null })
      .eq("agency_id", u.agencyId)
      .eq("channel", ch)
      .eq(ch === "email" ? "email_norm" : "phone_norm", target)
      .eq("status", "queued");
  }
  return { created };
}

export interface RecipientRow {
  id: string;
  agency_id: string;
  campaign_id: string;
  channel: MarketingChannel;
  contact_ref: string | null;
  contact_name: string | null;
  email_norm: string | null;
  phone_norm: string | null;
  is_test: boolean;
  status: string;
  subject: string | null;
  html: string | null;
  text_body: string | null;
  wa_template: { name?: string; language?: string; params?: string[] } | null;
  attempts: number;
}

export const RECIPIENT_COLS =
  "id, agency_id, campaign_id, channel, contact_ref, contact_name, email_norm, phone_norm, is_test, status, subject, html, text_body, wa_template, attempts";

export async function recipientById(id: string): Promise<RecipientRow | null> {
  const { data, error } = await crmDb().from("marketing_recipients").select(RECIPIENT_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error("db");
  return (data as RecipientRow | null) ?? null;
}

/** Destinos que ya recibieron marketing de esta agencia hace menos de `days` días. */
export async function recentlyContacted(
  agencyId: string,
  channel: MarketingChannel,
  targets: string[],
  days: number,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!targets.length || days <= 0) return out;
  const col = channel === "email" ? "email_norm" : "phone_norm";
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  for (let i = 0; i < targets.length; i += 200) {
    const { data, error } = await crmDb()
      .from("marketing_recipients")
      .select(col)
      .eq("agency_id", agencyId)
      .eq("channel", channel)
      .eq("is_test", false)
      .gte("sent_at", since)
      .in(col, targets.slice(i, i + 200));
    if (error) throw new Error("db");
    for (const r of (data ?? []) as Record<string, string | null>[]) if (r[col]) out.add(r[col] as string);
  }
  return out;
}

/** Envíos reales de la agencia desde `sinceIso` (para los topes). */
export async function sentCount(agencyId: string, sinceIso: string, campaignId?: string): Promise<number> {
  let q = crmDb()
    .from("marketing_recipients")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .eq("is_test", false)
    .gte("sent_at", sinceIso);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { count, error } = await q;
  if (error) throw new Error("db");
  return count ?? 0;
}

/**
 * Para el inbox: ¿la plantilla es de MARKETING y el destino está dado de baja
 * de WhatsApp? Si las tablas de marketing no existen, devuelve false (no
 * bloquea el inbox).
 */
export async function isWhatsappUnsubscribed(
  agencyId: string,
  channelAccountId: string,
  templateName: string,
  language: string,
  waId: string,
): Promise<boolean> {
  try {
    const db = crmDb();
    const { data: tpl } = await db
      .from("message_templates")
      .select("category")
      .eq("channel_account_id", channelAccountId)
      .eq("name", templateName)
      .eq("language", language)
      .maybeSingle();
    if ((tpl?.category ?? "").toUpperCase() !== "MARKETING") return false;
    const phone = normalizePhone(waId);
    if (!phone) return false;
    const { data, error } = await db
      .from("marketing_unsubscribes")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("phone_norm", phone)
      .is("revoked_at", null)
      .in("scope", ["whatsapp", "all"])
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
