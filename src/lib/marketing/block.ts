/**
 * "No contactar": bajas y consentimientos de un contacto.
 *
 * Lo usan Marketing, WhatsAppModal, el inbox, la ficha del contacto y Proppi.
 * Una baja vigente BLOQUEA cualquier envío por ese canal (o por todos). Solo se
 * revierte con un consentimiento nuevo (fecha y cómo lo dio).
 */
import { useEffect } from "react";
import type { Contact } from "@/types/db";
import { normalizeEmail, normalizePhone, type MarketingChannel } from "../../../shared/marketing";
import { readMarketing, useMarketing, type MarketingData } from "./state";
import { refreshServerState } from "./api";
import type { Consent, Unsubscribe } from "./types";

type Who = Pick<Contact, "id" | "email" | "phone">;

function sameTarget(u: { contact_id: string | null; email: string | null; phone: string | null }, c: Who): boolean {
  if (u.contact_id && u.contact_id === c.id) return true;
  const e = normalizeEmail(c.email);
  if (e && u.email && normalizeEmail(u.email) === e) return true;
  const p = normalizePhone(c.phone);
  if (p && u.phone && normalizePhone(u.phone) === p) return true;
  return false;
}

/** Bajas vigentes del contacto (locales pendientes + servidor). */
export function activeUnsubs(d: MarketingData, c: Who): Unsubscribe[] {
  return [...d.unsubs, ...d.server.unsubs].filter((u) => !u.revoked_at && sameTarget(u, c));
}

export interface ContactBlock {
  email: boolean;
  whatsapp: boolean;
  /** Alguna baja vigente. */
  any: boolean;
  /** "No contactar", "No contactar por email", … */
  label: string | null;
  since: string | null;
}

export function blockOf(d: MarketingData, c: Who | null | undefined): ContactBlock {
  if (!c) return { email: false, whatsapp: false, any: false, label: null, since: null };
  const list = activeUnsubs(d, c);
  const email = list.some((u) => u.scope === "email" || u.scope === "all");
  const whatsapp = list.some((u) => u.scope === "whatsapp" || u.scope === "all");
  const any = email || whatsapp;
  const label = !any
    ? null
    : email && whatsapp
      ? "No contactar"
      : email
        ? "No contactar por email"
        : "No contactar por WhatsApp";
  const since = list.map((u) => u.created_at).sort()[0] ?? null;
  return { email, whatsapp, any, label, since };
}

/** Lectura sincrónica (sin React). */
export function contactBlock(agencyId: string, c: Who | null | undefined): ContactBlock {
  return blockOf(readMarketing(agencyId), c);
}

/** Hook: bloqueo del contacto + refresco del servidor si la copia es vieja. */
export function useContactBlock(agencyId: string, c: Who | null | undefined): ContactBlock {
  const d = useMarketing(agencyId);
  useEffect(() => {
    void refreshServerState(agencyId, { maxAgeMs: 5 * 60_000 });
  }, [agencyId]);
  return blockOf(d, c);
}

type AnyConsent = Consent & { email?: string | null; phone?: string | null };

/** Último registro de consentimiento del contacto para ese canal (o null). */
export function latestConsent(d: MarketingData, c: Who, channel: MarketingChannel): AnyConsent | null {
  const e = normalizeEmail(c.email);
  const p = normalizePhone(c.phone);
  const all: AnyConsent[] = [...d.consents, ...d.server.consents].filter((x) => {
    if (x.channel !== channel) return false;
    if (x.contact_id === c.id) return true;
    if (channel === "email" && e && x.email && normalizeEmail(x.email) === e) return true;
    if (channel === "whatsapp" && p && x.phone && normalizePhone(x.phone) === p) return true;
    return false;
  });
  return all.sort((a, b) => b.given_at.localeCompare(a.given_at) || b.recorded_at.localeCompare(a.recorded_at))[0] ?? null;
}

export function hasConsent(d: MarketingData, c: Who, channel: MarketingChannel): boolean {
  return latestConsent(d, c, channel)?.status === "granted";
}
