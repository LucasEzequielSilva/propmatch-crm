import type { ExternalChannel } from "./api";

/**
 * Ventana de atención al cliente de Meta: 24 h desde el ÚLTIMO mensaje del
 * cliente (se reinicia con cada mensaje). Fuera de ella, WhatsApp solo acepta
 * plantillas e Instagram/Messenger no dejan escribir (salvo HUMAN_AGENT).
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 */
export const WINDOW_MS = 24 * 3600 * 1000;

export interface WindowInfo {
  open: boolean;
  remainingMs: number;
  /** "Quedan 5 h 12 min" / "Ventana cerrada". */
  label: string;
  /** Menos de 2 h: se muestra en ámbar. */
  closingSoon: boolean;
}

export function windowInfo(lastInboundAt: string | null, now = Date.now()): WindowInfo {
  if (!lastInboundAt) return { open: false, remainingMs: 0, label: "El cliente todavía no escribió", closingSoon: false };
  const remainingMs = Date.parse(lastInboundAt) + WINDOW_MS - now;
  if (remainingMs <= 0) return { open: false, remainingMs: 0, label: "Ventana de 24 h cerrada", closingSoon: false };
  const h = Math.floor(remainingMs / 3600_000);
  const m = Math.floor((remainingMs % 3600_000) / 60_000);
  return {
    open: true,
    remainingMs,
    label: h > 0 ? `Quedan ${h} h ${m} min para responder` : `Quedan ${m} min para responder`,
    closingSoon: remainingMs < 2 * 3600_000,
  };
}

export function closedHint(channel: ExternalChannel): string {
  return channel === "whatsapp"
    ? "Para retomar la conversación mandá una plantilla aprobada. Cuando el cliente conteste se abre otra ventana de 24 h."
    : "Meta no deja escribirle hasta que la persona vuelva a mandar un mensaje.";
}

/**
 * Texto entrante para mostrar: React ya escapa HTML; además sacamos
 * caracteres de control y overrides bidi (se usan para disfrazar links).
 */
export function cleanIncoming(s: string | null | undefined): string {
  return (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "");
}
