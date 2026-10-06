/**
 * Acciones de Marketing sobre el estado local + envío al servidor.
 */
import type { Contact } from "@/types/db";
import { clampLimits, DEFAULT_LIMITS, type MarketingChannel, type UnsubscribeScope } from "../../../shared/marketing";
import { newId, readMarketing, updateMarketing } from "./state";
import { activeUnsubs } from "./block";
import { campaignAction, pushPending, queueCampaign, refreshServerState } from "./api";
import { renderEmail, renderWhatsApp, type RenderData } from "./render";
import type { Campaign, Consent, ConsentMethod, EmailTemplate, MarketingTemplate, Segment, SegmentRules, WhatsAppTemplate } from "./types";

const now = () => new Date().toISOString();

/* ── Segmentos / plantillas / campañas ──────────────────────────────────── */

export function saveSegment(agencyId: string, s: { id?: string; name: string; rules: SegmentRules }): Segment {
  const at = now();
  let saved!: Segment;
  updateMarketing(agencyId, (d) => {
    const prev = s.id ? d.segments.find((x) => x.id === s.id) : undefined;
    saved = prev ? { ...prev, name: s.name, rules: s.rules, updated_at: at } : { id: newId("seg"), name: s.name, rules: s.rules, created_at: at, updated_at: at };
    return { ...d, segments: prev ? d.segments.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...d.segments] };
  });
  return saved;
}

export function removeSegment(agencyId: string, id: string) {
  updateMarketing(agencyId, (d) => ({ ...d, segments: d.segments.filter((x) => x.id !== id) }));
}

export function saveTemplate<T extends MarketingTemplate>(agencyId: string, t: T): T {
  const saved = { ...t, updated_at: now() };
  updateMarketing(agencyId, (d) => {
    const exists = d.templates.some((x) => x.id === t.id);
    return { ...d, templates: exists ? d.templates.map((x) => (x.id === t.id ? saved : x)) : [saved, ...d.templates] };
  });
  return saved;
}

export function removeTemplate(agencyId: string, id: string) {
  updateMarketing(agencyId, (d) => ({ ...d, templates: d.templates.filter((x) => x.id !== id) }));
}

export function newCampaign(agencyId: string, channel: MarketingChannel): Campaign {
  const at = now();
  const c: Campaign = {
    id: newId("cmp"),
    name: channel === "email" ? "Campaña por email" : "Campaña por WhatsApp",
    channel,
    segmentId: null,
    templateId: null,
    status: "borrador",
    scheduledAt: null,
    limits: { ...DEFAULT_LIMITS, ...(channel === "whatsapp" ? { perHour: 60, perDay: 250 } : {}) },
    audienceSize: null,
    stats: {},
    lastError: null,
    created_at: at,
    updated_at: at,
  };
  updateMarketing(agencyId, (d) => ({ ...d, campaigns: [c, ...d.campaigns] }));
  return c;
}

export function patchCampaign(agencyId: string, id: string, patch: Partial<Campaign>) {
  updateMarketing(agencyId, (d) => ({
    ...d,
    campaigns: d.campaigns.map((c) => (c.id === id ? { ...c, ...patch, updated_at: now() } : c)),
  }));
}

export function removeCampaign(agencyId: string, id: string) {
  updateMarketing(agencyId, (d) => ({ ...d, campaigns: d.campaigns.filter((c) => c.id !== id) }));
}

export function setTags(agencyId: string, contactId: string, tags: string[]) {
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20);
  updateMarketing(agencyId, (d) => ({ ...d, tags: { ...d.tags, [contactId]: clean } }));
}

/* ── Consentimiento y bajas ─────────────────────────────────────────────── */

export function recordConsent(
  agencyId: string,
  contact: Contact,
  input: { channel: MarketingChannel; status: "granted" | "revoked"; method: ConsentMethod; evidence: string | null; givenAt: string },
  allContacts: Contact[],
): Consent {
  const at = now();
  const c: Consent & { email: string | null; phone: string | null } = {
    id: newId("cons"),
    contact_id: contact.id,
    channel: input.channel,
    status: input.status,
    method: input.method,
    evidence: input.evidence?.trim() || null,
    given_at: input.givenAt,
    recorded_at: at,
    synced: false,
    email: contact.email,
    phone: contact.phone,
  };
  updateMarketing(agencyId, (d) => {
    // Un consentimiento nuevo revierte las bajas locales de ese canal (la del
    // servidor la revierte el servidor al recibirlo).
    const unsubs = d.unsubs.flatMap((u) => {
      if (input.status !== "granted" || u.revoked_at) return [u];
      const mine = activeUnsubs({ ...d, server: { ...d.server, unsubs: [] } }, contact).some((x) => x.id === u.id);
      if (!mine || (u.scope !== input.channel && u.scope !== "all")) return [u];
      const revoked = { ...u, revoked_at: at, revoked_by_consent: c.id };
      if (u.scope === "all") {
        const other: MarketingChannel = input.channel === "email" ? "whatsapp" : "email";
        return [revoked, { ...u, id: newId("baja"), scope: other, created_at: at, note: `Sigue vigente para ${other === "email" ? "email" : "WhatsApp"}`, synced: false }];
      }
      return [revoked];
    });
    return { ...d, consents: [c, ...d.consents], unsubs };
  });
  void pushPending(agencyId, allContacts);
  return c;
}

export function recordManualUnsubscribe(
  agencyId: string,
  contact: Contact,
  scope: UnsubscribeScope,
  note: string | null,
  allContacts: Contact[],
) {
  const at = now();
  updateMarketing(agencyId, (d) => ({
    ...d,
    unsubs: [
      {
        id: newId("baja"),
        contact_id: contact.id,
        email: contact.email,
        phone: contact.phone,
        scope,
        source: "manual",
        note: note?.trim() || null,
        created_at: at,
        revoked_at: null,
        revoked_by_consent: null,
        synced: false,
        from_server: false,
      },
      ...d.unsubs,
    ],
  }));
  void pushPending(agencyId, allContacts);
}

/* ── Envío ──────────────────────────────────────────────────────────────── */

const CHUNK = 100; // ~10 KB de HTML por destinatario: lejos del límite de 4,5 MB del body

function snapshot(c: Campaign, segment: Segment | undefined, t: MarketingTemplate, agencyName: string) {
  const template =
    t.channel === "email"
      ? { kind: "email", name: t.name, subject: (t as EmailTemplate).subject, agencyName }
      : { kind: "whatsapp", name: t.name, waName: (t as WhatsAppTemplate).waName, waLanguage: (t as WhatsAppTemplate).waLanguage, agencyName };
  return {
    localId: c.id,
    name: c.name,
    channel: c.channel,
    segment: segment ? { name: segment.name, rules: segment.rules } : {},
    template,
    limits: clampLimits(c.limits),
  };
}

function recipientFor(t: MarketingTemplate, contact: Contact, d: RenderData) {
  if (t.channel === "email") {
    const r = renderEmail(t, contact, d);
    return { contactRef: contact.id, name: contact.full_name, email: contact.email, subject: r.subject, html: r.html, text: r.text };
  }
  const r = renderWhatsApp(t, contact, d);
  return { contactRef: contact.id, name: contact.full_name, phone: contact.phone, waTemplate: { name: t.waName, language: t.waLanguage, params: r.params } };
}

export interface SendOutcome {
  ok: boolean;
  error: string | null;
  queued: number;
  rejected: Record<string, number>;
}

/**
 * Sube la campaña personalizada por contacto. `scheduledAt` null = sale ya
 * (respetando los topes). El servidor vuelve a filtrar bajas/consentimiento.
 */
export async function submitCampaign(
  agencyId: string,
  c: Campaign,
  segment: Segment | undefined,
  t: MarketingTemplate,
  eligible: Contact[],
  d: RenderData,
  allContacts: Contact[],
): Promise<SendOutcome> {
  await pushPending(agencyId, allContacts);
  const camp = { ...snapshot(c, segment, t, d.agency.name), scheduledAt: c.scheduledAt };
  let queued = 0;
  const rejected: Record<string, number> = {};
  const chunks = Math.max(1, Math.ceil(eligible.length / CHUNK));
  for (let i = 0; i < chunks; i++) {
    const slice = eligible.slice(i * CHUNK, (i + 1) * CHUNK);
    const r = await queueCampaign({
      action: "queue",
      campaign: camp,
      recipients: slice.map((ct) => recipientFor(t, ct, d)),
      final: i === chunks - 1,
    });
    if (!r.ok || !r.data) {
      patchCampaign(agencyId, c.id, { lastError: r.error });
      return { ok: false, error: r.error, queued, rejected };
    }
    queued += r.data.queued;
    for (const [k, v] of Object.entries(r.data.rejected ?? {})) rejected[k] = (rejected[k] ?? 0) + v;
  }
  patchCampaign(agencyId, c.id, {
    status: c.scheduledAt && Date.parse(c.scheduledAt) > Date.now() ? "programada" : "enviando",
    audienceSize: eligible.length,
    lastError: null,
  });
  void refreshServerState(agencyId);
  return { ok: true, error: null, queued, rejected };
}

export async function sendTest(
  _agencyId: string,
  c: Campaign,
  segment: Segment | undefined,
  t: MarketingTemplate,
  sampleContact: Contact,
  d: RenderData,
  testPhone: string | null,
): Promise<{ ok: boolean; error: string | null }> {
  const rec = recipientFor(t, sampleContact, d);
  // La prueba usa el contenido de un contacto, pero va a uno mismo: el email lo pone el servidor
  // (mail del usuario logueado); en WhatsApp, el número que indica el usuario.
  const recipient =
    t.channel === "email"
      ? { ...rec, contactRef: null, name: d.profile.full_name, email: null, isSample: false }
      : { ...rec, contactRef: null, name: d.profile.full_name, phone: testPhone, isSample: false };
  const r = await queueCampaign({ action: "test", campaign: { ...snapshot(c, segment, t, d.agency.name), scheduledAt: null }, recipient });
  return { ok: r.ok, error: r.error };
}

export async function cancelCampaign(agencyId: string, c: Campaign): Promise<string | null> {
  if (c.status === "borrador") {
    patchCampaign(agencyId, c.id, { status: "cancelada" });
    return null;
  }
  const r = await campaignAction("cancel", c.id);
  if (r.ok) patchCampaign(agencyId, c.id, { status: "cancelada" });
  return r.ok ? null : r.error;
}

export async function pauseCampaign(agencyId: string, c: Campaign, pause: boolean): Promise<string | null> {
  const r = await campaignAction(pause ? "pause" : "resume", c.id);
  if (r.ok) patchCampaign(agencyId, c.id, { status: pause ? "pausada" : "enviando" });
  return r.ok ? null : r.error;
}

/** Para Proppi y otros módulos sin React. */
export const marketingSnapshot = readMarketing;
