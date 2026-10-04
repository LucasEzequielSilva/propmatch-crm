/**
 * Recordatorio de una publicación, de punta a punta:
 *  1. `useReminders().schedule` crea/actualiza un evento de tipo «publicacion» en la Agenda del CRM.
 *  2. La campana (`NotificationsMenu`) lo muestra 24 h antes y, cuando llega la hora, como «lista
 *     para subir» mientras no se marque como publicada (`dueForNotification`).
 *  3. El .ics (`schedule.ts`) lleva el recordatorio al calendario del celular (aviso 15 min antes).
 *  4. Opcional: aviso del navegador, solo si la persona lo activa, y solo con la app abierta.
 * Límite: nada de esto publica; si nadie abre la app ni el calendario, nadie se entera.
 */

import { useCallback } from "react";
import { useStore, type NewEventInput } from "@/data/store";
import { agendaTimes, derivedStatus } from "./schedule";
import { postStore, type InstagramPost } from "./postStore";

export const eventTitle = (post: Pick<InstagramPost, "title" | "kind">) => `Publicar en Instagram: ${post.title.trim() || "publicación sin título"}`;

export const KIND_WORD: Record<InstagramPost["kind"], string> = { carousel: "carrusel", photo: "foto", story: "story", reel: "reel" };

export function useReminders() {
  const { events, addEvent, updateEvent, removeEvent, currentUserId } = useStore();

  /** Crea o actualiza el evento y devuelve su id (para guardarlo en la publicación). */
  const schedule = useCallback(
    (post: InstagramPost, startIso: string): string => {
      const input: NewEventInput = {
        type: "publicacion",
        title: eventTitle(post),
        contact_id: null,
        property_id: post.propertyId,
        notes: `Tipo: ${KIND_WORD[post.kind]}. Abrí el Estudio de Instagram para descargar los archivos, copiar el texto y subirla.`,
        owner_id: currentUserId ?? null,
        ...agendaTimes(startIso),
      };
      const existing = post.reminderEventId ? events.find((e) => e.id === post.reminderEventId) : undefined;
      if (existing) {
        updateEvent(existing.id, input);
        return existing.id;
      }
      return addEvent(input).id;
    },
    [events, addEvent, updateEvent, currentUserId],
  );

  const unschedule = useCallback(
    (post: Pick<InstagramPost, "reminderEventId">) => {
      if (post.reminderEventId) removeEvent(post.reminderEventId);
    },
    [removeEvent],
  );

  return { schedule, unschedule };
}

/** Publicación asociada a un evento de la Agenda (para que la campana enlace al editor). */
export const postOfEvent = (eventId: string, posts: InstagramPost[] = postStore.list()) => posts.find((p) => p.reminderEventId === eventId) ?? null;

/** Publicaciones cuya hora ya llegó y siguen sin marcarse como publicadas (listas o vencidas). */
export function dueForNotification(posts: InstagramPost[], now: number, maxAgeMs = 48 * 3_600_000): InstagramPost[] {
  return posts.filter((p) => {
    const s = derivedStatus(p, now);
    if (s !== "ready" && s !== "overdue") return false;
    return now - new Date(p.scheduledAt!).getTime() <= maxAgeMs;
  });
}

/* ── Avisos del navegador (opt-in) ────────────────────────────────────────── */

const OPT_KEY = "propmatch.instagram.browser-notify.v1";
const SENT_KEY = "propmatch.instagram.browser-notify.sent.v1";

export const browserNotifySupported = () => typeof Notification !== "undefined";

export function browserNotifyEnabled(): boolean {
  try {
    return browserNotifySupported() && Notification.permission === "granted" && localStorage.getItem(OPT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Pide permiso SOLO cuando la persona lo pide. Devuelve el permiso resultante. */
export async function enableBrowserNotify(): Promise<NotificationPermission | "unsupported"> {
  if (!browserNotifySupported()) return "unsupported";
  const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  try {
    if (perm === "granted") localStorage.setItem(OPT_KEY, "1");
  } catch {
    /* sin storage: el aviso funciona esta sesión pero no se recuerda */
  }
  return perm;
}

export function disableBrowserNotify() {
  try {
    localStorage.removeItem(OPT_KEY);
  } catch {
    /* nada que borrar */
  }
}

/** Dispara los avisos pendientes (una sola vez por publicación y hora). Se llama desde un intervalo con la app abierta. */
export function fireDueBrowserNotifications(posts: InstagramPost[], now = Date.now()) {
  if (!browserNotifyEnabled()) return;
  let sent: string[] = [];
  try {
    sent = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as string[];
  } catch {
    sent = [];
  }
  for (const p of dueForNotification(posts, now, 3_600_000)) {
    const key = `${p.id}@${p.scheduledAt}`;
    if (sent.includes(key)) continue;
    try {
      new Notification("Es hora de publicar en Instagram", { body: p.title.trim() || "Tenés una publicación lista para subir.", tag: key });
    } catch {
      /* algunos navegadores móviles exigen service worker: se ignora */
    }
    sent.push(key);
  }
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(sent.slice(-100)));
  } catch {
    /* sin storage */
  }
}
