/**
 * Google Calendar en el CRM, por agente. Vive en el AppLayout para que los
 * cambios hechos en cualquier pantalla (agendar una visita desde un contacto,
 * una tarea con fecha…) lleguen a Google aunque la Agenda no esté abierta.
 *
 * Opción B — link de suscripción (.ics): si el agente lo activó, cada cambio
 * en sus eventos / visitas / tareas manda un snapshot (con debounce) a
 * gcal-feed-push. Google lo vuelve a leer cada varias horas.
 *
 * Ver docs/google-calendar.md.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/data/store";
import { fnv1a, type GcalItem } from "../../../shared/gcal";
import { feedApi, type FeedStatus } from "./api";
import { crmItems, feedItems } from "./items";

const FEED_DEBOUNCE_MS = 3_000;

/* ── Persistencia local (por cuenta) ──────────────────────────────────────── */

interface FeedLocal {
  /** El link se muestra una vez al crearlo; lo recordamos SOLO en este navegador para poder copiarlo de nuevo. */
  url: string | null;
  /** Últimas visitas de la app que vio la Agenda (las otras pantallas no las cargan). */
  visits: GcalItem[];
}

const feedKey = (userId: string) => `propmatch.gcal.feed.v1:${userId}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin espacio o bloqueado: se pierde la comodidad, no los datos.
  }
}

/* ── Contexto ─────────────────────────────────────────────────────────────── */

export type FeedUiState = "loading" | "hidden" | "demo" | "no_db" | "inactive" | "active" | "error";

export interface FeedController {
  state: FeedUiState;
  url: string | null;
  pushedAt: string | null;
  eventCount: number;
  error: string | null;
  busy: boolean;
  create: () => Promise<void>;
  rotate: () => Promise<void>;
  revoke: () => Promise<void>;
}

interface GcalContextValue {
  feed: FeedController;
  /** La Agenda avisa qué visitas de la app (ya filtradas al agente) hay hoy. */
  reportAppVisits: (items: GcalItem[]) => void;
  /** La Agenda se abrió: se reenvía el snapshot del link. */
  agendaOpened: () => void;
}

const Ctx = createContext<GcalContextValue | null>(null);

export function useGoogleCalendar(): GcalContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGoogleCalendar fuera de GoogleCalendarProvider");
  return v;
}

export function GoogleCalendarProvider({ children }: { children: ReactNode }) {
  const { events, tasks, contacts, properties, currentUserId, isDemo } = useStore();
  const userId = isDemo ? null : currentUserId;

  /* Ítems del agente ─────────────────────────────────────────────────────── */
  const [visits, setVisits] = useState<GcalItem[]>([]);
  useEffect(() => {
    setVisits(userId ? readJson<FeedLocal>(feedKey(userId), { url: null, visits: [] }).visits : []);
  }, [userId]);

  const items = useMemo(
    () => (userId ? [...crmItems({ events, tasks, contacts, properties, userId }), ...visits] : []),
    [events, tasks, contacts, properties, userId, visits],
  );

  const reportAppVisits = useCallback(
    (next: GcalItem[]) => {
      if (!userId) return;
      setVisits((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        const local = readJson<FeedLocal>(feedKey(userId), { url: null, visits: [] });
        writeJson(feedKey(userId), { ...local, visits: next });
        return next;
      });
    },
    [userId],
  );

  /* Opción B: link de suscripción ─────────────────────────────────────────── */
  const [feedStatus, setFeedStatus] = useState<{ state: FeedUiState; data: FeedStatus | null; error: string | null }>({
    state: "loading",
    data: null,
    error: null,
  });
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);

  useEffect(() => {
    if (isDemo) return setFeedStatus({ state: "demo", data: null, error: null });
    if (!userId) return setFeedStatus({ state: "loading", data: null, error: null });
    let cancelled = false;
    setFeedUrl(readJson<FeedLocal>(feedKey(userId), { url: null, visits: [] }).url);
    void feedApi.status().then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        // Sin /api (vite dev) o sin inmobiliaria vinculada: la opción no se muestra.
        if (r.error === "no_server" || r.error === "forbidden" || r.error === "not_configured") return setFeedStatus({ state: "hidden", data: null, error: null });
        return setFeedStatus({ state: "error", data: null, error: r.message });
      }
      setFeedStatus({ state: !r.data.db ? "no_db" : r.data.active ? "active" : "inactive", data: r.data, error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, isDemo]);

  const rememberUrl = useCallback(
    (url: string | null) => {
      setFeedUrl(url);
      if (!userId) return;
      const local = readJson<FeedLocal>(feedKey(userId), { url: null, visits: [] });
      writeJson(feedKey(userId), { ...local, url });
    },
    [userId],
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lastPushedHash = useRef<string | null>(null);

  const applyFeedResult = useCallback(
    (r: Awaited<ReturnType<typeof feedApi.status>>, onOk?: (d: FeedStatus) => void) => {
      if (!r.ok) {
        if (r.error === "no_db") setFeedStatus({ state: "no_db", data: null, error: null });
        else setFeedStatus((s) => ({ ...s, error: r.message }));
        return false;
      }
      setFeedStatus({ state: !r.data.db ? "no_db" : r.data.active ? "active" : "inactive", data: r.data, error: null });
      onOk?.(r.data);
      return true;
    },
    [],
  );

  const create = useCallback(async () => {
    setFeedBusy(true);
    const snapshot = feedItems(itemsRef.current);
    const r = await feedApi.create(snapshot);
    setFeedBusy(false);
    if (r.ok) {
      rememberUrl(r.data.url);
      lastPushedHash.current = fnv1a(JSON.stringify(snapshot));
    }
    applyFeedResult(r);
  }, [applyFeedResult, rememberUrl]);

  const rotate = useCallback(async () => {
    setFeedBusy(true);
    const snapshot = feedItems(itemsRef.current);
    const r = await feedApi.rotate(snapshot);
    setFeedBusy(false);
    if (r.ok) {
      rememberUrl(r.data.url);
      lastPushedHash.current = fnv1a(JSON.stringify(snapshot));
    }
    applyFeedResult(r);
  }, [applyFeedResult, rememberUrl]);

  const revoke = useCallback(async () => {
    setFeedBusy(true);
    const r = await feedApi.revoke();
    setFeedBusy(false);
    if (r.ok) rememberUrl(null);
    applyFeedResult(r);
  }, [applyFeedResult, rememberUrl]);

  const feedActive = feedStatus.state === "active";
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushing = useRef(false);

  const pushFeed = useCallback(
    async (force: boolean) => {
      if (pushing.current) return;
      const snapshot = feedItems(itemsRef.current);
      const hash = fnv1a(JSON.stringify(snapshot));
      if (!force && hash === lastPushedHash.current) return;
      pushing.current = true;
      const r = await feedApi.push(snapshot);
      pushing.current = false;
      if (r.ok) {
        lastPushedHash.current = hash;
        applyFeedResult(r);
      } else if (r.error === "rate_limited") {
        pushTimer.current = setTimeout(() => void pushFeed(force), 6_000);
      } else if (r.error === "no_feed") {
        rememberUrl(null);
        setFeedStatus((s) => ({ ...s, state: "inactive" }));
      } else {
        applyFeedResult(r);
      }
    },
    [applyFeedResult, rememberUrl],
  );

  const itemsHash = useMemo(() => fnv1a(JSON.stringify(feedItems(items))), [items]);
  useEffect(() => {
    if (!feedActive) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => void pushFeed(false), FEED_DEBOUNCE_MS);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [feedActive, itemsHash, pushFeed]);

  const agendaOpened = useCallback(() => {
    if (feedActive) void pushFeed(true);
  }, [feedActive, pushFeed]);

  const feed: FeedController = {
    state: feedStatus.state,
    url: feedActive ? feedUrl : null,
    pushedAt: feedStatus.data?.pushedAt ?? null,
    eventCount: feedStatus.data?.eventCount ?? 0,
    error: feedStatus.error,
    busy: feedBusy,
    create,
    rotate,
    revoke,
  };

  return <Ctx.Provider value={{ feed, reportAppVisits, agendaOpened }}>{children}</Ctx.Provider>;
}
