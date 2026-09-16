/**
 * Autorización de venta o alquiler.
 *
 * Es el papel que firma el propietario para que la inmobiliaria comercialice
 * la propiedad. Si es exclusiva y vence sin renovarse, el propietario puede
 * dársela a otra inmobiliaria: por eso lo que importa es cuánto falta.
 */

import type { AuthorizationType } from "@/types/db";

export const AUTHORIZATION_LABEL: Record<AuthorizationType, string> = {
  exclusiva: "Exclusiva",
  no_exclusiva: "No exclusiva",
};

/** Días antes del vencimiento en que empieza a avisar. */
export const AUTHORIZATION_WARNING_DAYS = 15;

export interface AuthorizationState {
  /** "Exclusiva · vence en 12 días" */
  label: string;
  tone: "ok" | "warning" | "expired" | "none";
  /** Negativo si ya venció. `null` sin fecha. */
  daysLeft: number | null;
}

const DAY = 86_400_000;

/** `YYYY-MM-DD` como medianoche local (con `new Date(str)` sería UTC y correría un día). */
export function parseLocalDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function authorizationState(
  type: AuthorizationType | null | undefined,
  expiresAt: string | null | undefined,
  now = new Date(),
): AuthorizationState {
  if (!type) return { label: "Sin autorización", tone: "none", daysLeft: null };
  const name = AUTHORIZATION_LABEL[type];
  if (!expiresAt) return { label: `${name} · sin vencimiento`, tone: "ok", daysLeft: null };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.round((parseLocalDate(expiresAt).getTime() - today.getTime()) / DAY);

  if (daysLeft < 0) {
    const ago = -daysLeft;
    return { label: `${name} · venció hace ${ago} ${ago === 1 ? "día" : "días"}`, tone: "expired", daysLeft };
  }
  if (daysLeft === 0) return { label: `${name} · vence hoy`, tone: "warning", daysLeft };
  return {
    label: `${name} · vence en ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`,
    tone: daysLeft <= AUTHORIZATION_WARNING_DAYS ? "warning" : "ok",
    daysLeft,
  };
}

export const AUTHORIZATION_TONE_STYLE: Record<AuthorizationState["tone"], { bg: string; text: string; border: string }> = {
  ok: { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0" },
  warning: { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A" },
  expired: { bg: "#FFF1F2", text: "#BE123C", border: "#FECDD3" },
  none: { bg: "#F9FAFB", text: "#6B7280", border: "#E5E7EB" },
};

/** `YYYY-MM-DD` local, dentro de `days` días. */
export function dateInputFromNow(days: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
