/**
 * Cliente de /api/marketing/*. Mismo patrón que el inbox: el navegador manda
 * el JWT de la app y el servidor resuelve la agencia; nunca habla directo con
 * el Supabase del CRM. Sin /api (vite dev) o en la demo, degrada a "no
 * configurado" sin ruido.
 */
import { inboxApi, type ApiResult } from "@/lib/inbox/api";
import { isDemoActive } from "@/lib/demo";
import { normalizeEmail, normalizePhone, type MarketingChannel } from "../../../shared/marketing";
import { EMPTY_STATUS, readMarketing, updateMarketing } from "./state";
import type { Consent, ServerStatus, Unsubscribe, UnsubscribeScope } from "./types";

const inflight = new Map<string, Promise<unknown>>();

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key) as Promise<T> | undefined;
  if (cur) return cur;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** ¿Qué está configurado en el servidor? */
export function refreshStatus(agencyId: string): Promise<ServerStatus> {
  return once(`status:${agencyId}`, async () => {
    if (isDemoActive()) {
      const s = { ...EMPTY_STATUS, checkedAt: new Date().toISOString() };
      updateMarketing(agencyId, (d) => ({ ...d, status: s }));
      return s;
    }
    const r = await inboxApi<Omit<ServerStatus, "checkedAt" | "reachable">>("/api/marketing/status");
    const s: ServerStatus = r.ok && r.data
      ? { ...EMPTY_STATUS, ...r.data, checkedAt: new Date().toISOString(), reachable: true }
      : { ...EMPTY_STATUS, checkedAt: new Date().toISOString(), reachable: false };
    updateMarketing(agencyId, (d) => ({ ...d, status: s }));
    return s;
  });
}

interface ServerUnsubRow {
  id: string;
  scope: UnsubscribeScope;
  contact_ref: string | null;
  email_norm: string | null;
  phone_norm: string | null;
  source: Unsubscribe["source"];
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}
interface ServerConsentRow {
  id: string;
  channel: MarketingChannel;
  contact_ref: string | null;
  email_norm: string | null;
  phone_norm: string | null;
  status: "granted" | "revoked";
  method: Consent["method"];
  evidence: string | null;
  given_at: string;
}
export interface ServerCampaignRow {
  id: string;
  local_id: string;
  name: string;
  channel: MarketingChannel;
  status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled";
  scheduled_at: string | null;
  finished_at: string | null;
  stats: Record<string, number>;
}

const STATUS_MAP = { draft: "borrador", scheduled: "programada", sending: "enviando", sent: "enviada", paused: "pausada", cancelled: "cancelada" } as const;

/** Baja bajas/consentimientos/métricas del servidor. Silencioso si no hay servidor. */
export function refreshServerState(agencyId: string, opts: { maxAgeMs?: number } = {}): Promise<boolean> {
  const d0 = readMarketing(agencyId);
  if (isDemoActive()) return Promise.resolve(false);
  if (opts.maxAgeMs && d0.server.fetchedAt && Date.now() - Date.parse(d0.server.fetchedAt) < opts.maxAgeMs) return Promise.resolve(true);
  return once(`state:${agencyId}`, async () => {
    const r = await inboxApi<{ unsubscribes: ServerUnsubRow[]; consents: ServerConsentRow[]; campaigns: ServerCampaignRow[] }>("/api/marketing/state");
    if (!r.ok || !r.data) {
      // Marca de tiempo igual, para no reintentar en cada render.
      updateMarketing(agencyId, (d) => ({ ...d, server: { ...d.server, fetchedAt: new Date().toISOString() } }));
      return false;
    }
    const data = r.data;
    updateMarketing(agencyId, (d) => {
      const byLocal = new Map(data.campaigns.map((c) => [c.local_id, c]));
      return {
        ...d,
        server: {
          fetchedAt: new Date().toISOString(),
          unsubs: data.unsubscribes.map((u) => ({
            id: u.id,
            contact_id: u.contact_ref,
            email: u.email_norm,
            phone: u.phone_norm,
            scope: u.scope,
            source: u.source,
            note: u.note,
            created_at: u.created_at,
            revoked_at: u.revoked_at,
            revoked_by_consent: null,
            synced: true,
            from_server: true,
          })),
          consents: data.consents.map((c) => ({
            id: c.id,
            contact_id: c.contact_ref ?? "",
            channel: c.channel,
            status: c.status,
            method: c.method,
            evidence: c.evidence,
            given_at: c.given_at,
            recorded_at: c.given_at,
            synced: true,
            email: c.email_norm,
            phone: c.phone_norm,
          })),
        },
        campaigns: d.campaigns.map((c) => {
          const s = byLocal.get(c.id);
          if (!s) return c;
          return { ...c, status: STATUS_MAP[s.status], stats: s.stats };
        }),
      };
    });
    return true;
  });
}

/** Sube consentimientos y bajas cargados en este navegador. Devuelve cuántos subió. */
export async function pushPending(agencyId: string, contacts: { id: string; email: string | null; phone: string | null }[]): Promise<number> {
  const d = readMarketing(agencyId);
  if (isDemoActive() || !d.status.configured.db) return 0;
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const consents = d.consents.filter((c) => !c.synced);
  const unsubs = d.unsubs.filter((u) => !u.synced && !u.revoked_at);
  const items = [
    ...consents.map((c) => {
      const ct = byId.get(c.contact_id);
      return {
        op: c.status === "granted" ? "grant" : "revoke",
        channel: c.channel,
        contactRef: c.contact_id,
        email: normalizeEmail(ct?.email ?? c.email ?? null),
        phone: normalizePhone(ct?.phone ?? c.phone ?? null),
        method: c.method,
        evidence: c.evidence,
        givenAt: c.given_at,
      };
    }),
    ...unsubs.map((u) => {
      const ct = u.contact_id ? byId.get(u.contact_id) : undefined;
      return {
        op: "unsubscribe",
        scope: u.scope,
        contactRef: u.contact_id,
        email: normalizeEmail(ct?.email ?? u.email),
        phone: normalizePhone(ct?.phone ?? u.phone),
        note: u.note,
      };
    }),
  ].slice(0, 200);
  if (!items.length) return 0;
  const r = await inboxApi<{ results: { ok: boolean; error?: string }[] }>("/api/marketing/consent", { method: "POST", body: { items } });
  if (!r.ok || !r.data) return 0;
  const results = r.data.results;
  const okConsent = new Set(consents.filter((_, i) => results[i]?.ok).map((c) => c.id));
  const okUnsub = new Set(unsubs.filter((_, i) => results[consents.length + i]?.ok).map((u) => u.id));
  updateMarketing(agencyId, (x) => ({
    ...x,
    // Lo que ya está en el servidor sale de la lista local (vuelve con refreshServerState).
    consents: x.consents.filter((c) => !okConsent.has(c.id)),
    unsubs: x.unsubs.filter((u) => !okUnsub.has(u.id)),
  }));
  await refreshServerState(agencyId);
  return okConsent.size + okUnsub.size;
}

export type { ApiResult };

export interface QueueBody {
  action: "queue" | "test";
  campaign: {
    localId: string;
    name: string;
    channel: MarketingChannel;
    segment: unknown;
    template: unknown;
    limits: unknown;
    scheduledAt: string | null;
  };
  recipients?: unknown[];
  recipient?: unknown;
  final?: boolean;
}

export const queueCampaign = (body: QueueBody) =>
  inboxApi<{ ok: boolean; queued: number; rejected: Record<string, number>; dispatched: unknown }>("/api/marketing/campaign", { method: "POST", body });

export const campaignAction = (action: "cancel" | "pause" | "resume", localId: string) =>
  inboxApi<{ ok: boolean }>("/api/marketing/campaign", { method: "POST", body: { action, localId } });

export const dispatchNow = (localId: string) =>
  inboxApi<{ sent: number; remaining: number; stopped?: string }>("/api/marketing/dispatch", { method: "POST", body: { localId } });

export interface ServerRecipient {
  id: string;
  contact_ref: string | null;
  contact_name: string | null;
  email_norm: string | null;
  phone_norm: string | null;
  is_test: boolean;
  status: string;
  skip_reason: string | null;
  error_code: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  unsubscribed_at: string | null;
}

export const fetchRecipients = (localId: string) =>
  inboxApi<{ recipients: ServerRecipient[] }>(`/api/marketing/state?campaign=${encodeURIComponent(localId)}`);

/** Texto para la UI a partir del código del servidor. */
export function marketingErrorText(code: string | null): string {
  switch (code) {
    case "not_configured":
    case "unavailable":
      return "El servidor de marketing todavía no está configurado (falta el Supabase del CRM y sus variables).";
    case "email_not_configured":
      return "Falta configurar Resend (RESEND_API_KEY y MARKETING_FROM_EMAIL con un dominio verificado).";
    case "whatsapp_not_configured":
      return "Falta configurar WhatsApp Cloud API (app de Meta y Supabase del CRM).";
    case "whatsapp_no_conectado":
      return "No hay un número de WhatsApp conectado. Conectalo desde el Inbox → Canales.";
    case "plantilla_no_aprobada":
      return "La plantilla no está aprobada por Meta o no es de categoría MARKETING.";
    case "send_disabled":
      return "Los envíos reales están apagados (MARKETING_SEND_ENABLED). Se encendían después de probar.";
    case "destino_dado_de_baja":
      return "Ese destino está dado de baja: no se le puede enviar ni una prueba.";
    case "sin_email_propio":
      return "Tu usuario no tiene un email para recibir la prueba.";
    case "campaign_locked":
      return "La campaña ya salió o se canceló: no se puede modificar.";
    case "forbidden":
      return "Solo un administrador de la inmobiliaria puede enviar campañas.";
    case "unauthorized":
      return "Tenés que iniciar sesión con tu cuenta (en la demo no se envía nada).";
    case "rate_limited":
      return "Demasiados pedidos seguidos. Esperá un minuto.";
    case "network":
      return "No hay conexión con el servidor.";
    default:
      return "No se pudo completar. Probá de nuevo.";
  }
}
