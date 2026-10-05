import type {
  Activity,
  AppOffer,
  CalendarEvent,
  Contact,
  ContactRequirement,
  Match,
  Opportunity,
  Profile,
  Property,
} from "@/types/db";
import { computeMatch } from "@/lib/matching";
import { computeDiagnostic } from "@/lib/propertyDiagnostic";
import { computeFollowUps } from "@/lib/followups";
import { fetchAgencyMatches, fetchMatchMessages, fetchMessagesForMatches, type MatchRow } from "@/lib/leadSync";

/**
 * Ejecución de las tools de Proppi en el navegador, contra el store.
 * Los nombres y schemas están declarados en `api/_lib/proppi/tools.ts`.
 *
 * Reglas:
 * - Solo lectura.
 * - Respuestas compactas: pocos campos, topes de cantidad, textos recortados.
 * - Lista BLANCA de campos: si otro módulo suma datos confidenciales al modelo
 *   (p. ej. un precio mínimo de reserva), no salen acá porque nunca se copian.
 */

export interface ToolData {
  agencyId: string;
  linkedAgency: boolean;
  contacts: Contact[];
  requirements: ContactRequirement[];
  properties: Property[];
  photos: Record<string, string[]>;
  opportunities: Opportunity[];
  activities: Activity[];
  events: CalendarEvent[];
  appOffers: AppOffer[];
  matches: Match[];
  profiles: Profile[];
  followUpSnoozes: Record<string, string>;
}

export class ToolInputError extends Error {}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || null;
};
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const limitOf = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(MAX_LIMIT, Math.round(v))) : DEFAULT_LIMIT;
const str = (v: unknown, field: string): string => {
  if (typeof v !== "string") throw new ToolInputError(`Falta "${field}".`);
  return v;
};
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function propertyShort(p: Property) {
  return {
    id: p.id,
    titulo: p.title,
    tipo: p.type,
    operacion: p.operation,
    estado: p.status,
    zona: p.zone ?? p.locality,
    precio: p.price,
    moneda: p.currency,
    ambientes: p.rooms,
    dormitorios: p.bedrooms,
    m2_totales: p.surface_total,
  };
}

function contactShort(c: Contact, lastActivity: string | null) {
  return {
    id: c.id,
    nombre: c.full_name,
    tipo: c.kind,
    estado: c.status,
    telefono: c.phone,
    email: c.email,
    ultima_actividad: lastActivity,
  };
}

function lastActivityByContact(activities: Activity[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of activities) {
    if (!a.contact_id) continue;
    const prev = m.get(a.contact_id);
    if (!prev || a.created_at > prev) m.set(a.contact_id, a.created_at);
  }
  return m;
}

/* ── Inbox (chats reales de la app) ───────────────────────────────────────── */

async function appMatches(d: ToolData): Promise<MatchRow[]> {
  if (!d.linkedAgency) return [];
  return fetchAgencyMatches(d.agencyId);
}

function conversationLabels(d: ToolData, m: MatchRow) {
  const contact = d.contacts.find((c) => c.app_user_id === m.demandante_id);
  const property = d.properties.find((p) => p.app_property_id === m.property_id);
  return {
    contacto: contact ? { id: contact.id, nombre: contact.full_name } : { id: null, nombre: "Interesado desde la app" },
    propiedad: property ? { id: property.id, titulo: property.title } : null,
  };
}

/* ── Tools ───────────────────────────────────────────────────────────────── */

type Input = Record<string, unknown>;
type Handler = (input: Input, d: ToolData) => unknown | Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  buscar_contactos(input, d) {
    const q = norm(typeof input.query === "string" ? input.query : "");
    const last = lastActivityByContact(d.activities);
    const words = q.split(/\s+/).filter(Boolean);
    const rows = d.contacts
      .filter((c) => {
        if (!words.length) return true;
        const hay = norm(`${c.full_name} ${c.email ?? ""} ${c.phone ?? ""} ${c.notes ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => (last.get(b.id) ?? b.updated_at).localeCompare(last.get(a.id) ?? a.updated_at));
    const lim = limitOf(input.limit);
    return {
      total: rows.length,
      contactos: rows.slice(0, lim).map((c) => contactShort(c, day(last.get(c.id)))),
    };
  },

  ver_contacto(input, d) {
    const id = str(input.id, "id");
    const c = d.contacts.find((x) => x.id === id);
    if (!c) throw new ToolInputError(`No existe un contacto con id ${id}. Buscalo con buscar_contactos.`);
    const req = d.requirements.find((r) => r.contact_id === id && r.is_active);
    const owner = d.profiles.find((p) => p.id === c.owner_id);
    const opps = d.opportunities.filter((o) => o.contact_id === id);
    const acts = d.activities
      .filter((a) => a.contact_id === id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8);
    const prop = (pid: string | null) => d.properties.find((p) => p.id === pid);
    return {
      ...contactShort(c, day(acts[0]?.created_at)),
      origen: c.source,
      perfil: c.profile_type,
      a_cargo_de: owner?.full_name ?? null,
      alta: day(c.created_at),
      notas: clip(c.notes, 400),
      busqueda: req
        ? {
            operacion: req.operation,
            tipos: req.property_types,
            zonas: req.zones,
            presupuesto_min: req.budget_min,
            presupuesto_max: req.budget_max,
            moneda: req.currency,
            dormitorios_min: req.bedrooms_min,
            m2_min: req.surface_min,
            caracteristicas: req.features,
          }
        : null,
      oportunidades: opps.map((o) => ({
        id: o.id,
        etapa: o.stage,
        propiedad: prop(o.property_id)?.title ?? null,
        valor: o.value,
        moneda: o.currency,
        desde: day(o.stage_since),
      })),
      actividad_reciente: acts.map((a) => ({
        fecha: day(a.created_at),
        tipo: a.type,
        titulo: a.title,
        detalle: clip(a.detail, 160),
      })),
    };
  },

  buscar_propiedades(input, d) {
    const op = optStr(input.operacion);
    const tipo = optStr(input.tipo);
    const zona = norm(optStr(input.zona));
    const min = optNum(input.precio_min);
    const max = optNum(input.precio_max);
    const estado = optStr(input.estado);
    const rows = d.properties.filter((p) => {
      if (op && p.operation !== op) return false;
      if (tipo && p.type !== tipo) return false;
      if (estado && p.status !== estado) return false;
      if (zona && !norm(`${p.zone ?? ""} ${p.locality ?? ""} ${p.street ?? ""}`).includes(zona)) return false;
      if (min != null && (p.price == null || p.price < min)) return false;
      if (max != null && (p.price == null || p.price > max)) return false;
      return true;
    });
    const lim = limitOf(input.limit);
    return { total: rows.length, propiedades: rows.slice(0, lim).map(propertyShort) };
  },

  ver_propiedad(input, d) {
    const id = str(input.id, "id");
    const p = d.properties.find((x) => x.id === id);
    if (!p) throw new ToolInputError(`No existe una propiedad con id ${id}. Buscala con buscar_propiedades.`);
    const out: Record<string, unknown> = {
      ...propertyShort(p),
      direccion: [p.street, p.street_number].filter(Boolean).join(" ") || null,
      localidad: p.locality,
      expensas: p.expenses,
      banos: p.bathrooms,
      cocheras: p.garages,
      m2_cubiertos: p.surface_covered,
      antiguedad: p.age_years,
      caracteristicas: p.features,
      descripcion: clip(p.description, 500),
      fotos: d.photos[p.id]?.length ?? 0,
      autorizacion: p.authorization_type,
      autorizacion_vence: p.authorization_expires_at,
      publicada_desde: day(p.published_at),
    };
    try {
      // Diagnóstico local (sin leer la app: appListings null). Es barato.
      const dx = computeDiagnostic(p, {
        inventory: d.properties,
        appListings: null,
        photoCount: d.photos[p.id]?.length ?? 0,
        activities: d.activities,
        appOffers: d.appOffers,
        matches: d.matches,
        opportunities: d.opportunities,
        events: d.events,
        channelsPublished: null,
      });
      out.diagnostico = {
        confianza: dx.confidenceLabel,
        comparables: dx.comparables.length,
        precio: dx.price.showRange
          ? {
              posicion: dx.price.positioning,
              mediana_comparables: dx.price.median,
              rango_p25_p75: [dx.price.p25, dx.price.p75],
              diferencia_vs_mediana_pct: dx.price.diffVsMedian != null ? Math.round(dx.price.diffVsMedian * 1000) / 10 : null,
              sugerido: dx.price.suggested,
              moneda: dx.price.currency,
            }
          : "Sin comparables suficientes para un rango de precio.",
        puntaje: dx.score.value,
        resumen: dx.score.summary,
        senales: dx.signals.map((s) => `${s.label}: ${s.status} — ${clip(s.detail, 140)}`),
        recomendaciones: dx.recommendations.slice(0, 3).map((r) => `${r.title}: ${clip(r.why, 160)}`),
        notas: dx.notes.slice(0, 3),
      };
    } catch {
      out.diagnostico = "No se pudo calcular el diagnóstico.";
    }
    return out;
  },

  compradores_compatibles(input, d) {
    const id = str(input.property_id, "property_id");
    const p = d.properties.find((x) => x.id === id);
    if (!p) throw new ToolInputError(`No existe una propiedad con id ${id}.`);
    const rows = d.requirements
      .filter((r) => r.is_active && r.operation === p.operation)
      .map((r) => ({ r, m: computeMatch(r, p) }))
      .filter((x) => x.m.score >= 50)
      .sort((a, b) => b.m.score - a.m.score)
      .slice(0, 10);
    return {
      propiedad: p.title,
      nota: p.status !== "disponible" ? `La propiedad está ${p.status}.` : undefined,
      compatibles: rows.map(({ r, m }) => {
        const c = d.contacts.find((x) => x.id === r.contact_id);
        return {
          contacto_id: r.contact_id,
          nombre: c?.full_name ?? "(contacto borrado)",
          puntaje: m.score,
          razones: m.reasons,
          presupuesto: [r.budget_min, r.budget_max, r.currency],
          tiene_oportunidad: d.opportunities.some((o) => o.contact_id === r.contact_id && o.property_id === p.id),
        };
      }),
    };
  },

  async leer_conversacion(input, d) {
    const id = str(input.match_id, "match_id");
    if (!d.linkedAgency) return { error: "Esta cuenta no tiene chats de la app conectados." };
    const [list, msgs] = await Promise.all([appMatches(d), fetchMatchMessages(id)]);
    const m = list.find((x) => x.id === id);
    if (!m) throw new ToolInputError(`No encontré la conversación ${id}.`);
    const recent = msgs.slice(-30);
    return {
      ...conversationLabels(d, m),
      total_mensajes: msgs.length,
      mensajes: recent.map((x) => ({
        de: x.sender_id === m.demandante_id ? "cliente" : "inmobiliaria",
        fecha: x.created_at.slice(0, 16).replace("T", " "),
        texto: clip(x.content, 600),
      })),
    };
  },

  async conversaciones_sin_responder(_input, d) {
    let chats: unknown[] = [];
    let chatsNota: string | undefined;
    if (d.linkedAgency) {
      const list = await appMatches(d);
      const byMatch = await fetchMessagesForMatches(list.map((m) => m.id), 3);
      chats = list
        .map((m) => ({ m, last: byMatch[m.id]?.[byMatch[m.id].length - 1] }))
        .filter((x) => x.last && x.last.sender_id === x.m.demandante_id)
        .sort((a, b) => b.last!.created_at.localeCompare(a.last!.created_at))
        .slice(0, 15)
        .map(({ m, last }) => ({
          match_id: m.id,
          ...conversationLabels(d, m),
          ultimo_mensaje: clip(last!.content, 160),
          fecha: last!.created_at.slice(0, 16).replace("T", " "),
        }));
    } else {
      chatsNota = "Esta cuenta no tiene chats de la app conectados.";
    }
    const followUps = computeFollowUps({
      contacts: d.contacts,
      activities: d.activities,
      events: d.events,
      opportunities: d.opportunities,
      matches: d.matches,
      properties: d.properties,
      snoozes: d.followUpSnoozes,
    })
      .slice(0, 10)
      .map((f) => ({
        contacto_id: f.contact.id,
        nombre: f.contact.full_name,
        motivo: f.reason,
        dias: f.daysSince,
        prioridad: f.priority,
      }));
    return { chats_sin_responder: chats, chats_nota: chatsNota, seguimientos_pendientes: followUps };
  },

  agenda(input, d) {
    const desde = str(input.desde, "desde").slice(0, 10);
    const hasta = str(input.hasta, "hasta").slice(0, 10);
    const rows = d.events
      .filter((e) => e.starts_at.slice(0, 10) >= desde && e.starts_at.slice(0, 10) <= hasta)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return {
      total: rows.length,
      eventos: rows.slice(0, 40).map((e) => ({
        cuando: e.starts_at.slice(0, 16).replace("T", " "),
        tipo: e.type,
        titulo: e.title,
        contacto: d.contacts.find((c) => c.id === e.contact_id)?.full_name ?? null,
        propiedad: d.properties.find((p) => p.id === e.property_id)?.title ?? null,
        notas: clip(e.notes, 120),
      })),
    };
  },

  oportunidades(input, d) {
    const etapa = optStr(input.etapa);
    const rows = d.opportunities
      .filter((o) => (etapa ? o.stage === etapa : true))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    return {
      total: rows.length,
      oportunidades: rows.slice(0, 25).map((o) => ({
        id: o.id,
        etapa: o.stage,
        contacto: d.contacts.find((c) => c.id === o.contact_id)?.full_name ?? null,
        contacto_id: o.contact_id,
        propiedad: d.properties.find((p) => p.id === o.property_id)?.title ?? null,
        valor: o.value,
        moneda: o.currency,
        dias_en_etapa: daysSince(o.stage_since),
        prioritaria: o.is_priority,
      })),
    };
  },

  ofertas(input, d) {
    const estado = optStr(input.estado);
    const rows = d.appOffers
      .filter((o) => (estado ? o.status === estado : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      total: rows.length,
      ofertas: rows.slice(0, 20).map((o) => {
        const p = d.properties.find((x) => x.id === o.property_id);
        return {
          fecha: day(o.created_at),
          estado: o.status,
          monto_usd: o.amount_usd,
          contacto: d.contacts.find((c) => c.id === o.contact_id)?.full_name ?? null,
          propiedad: p?.title ?? null,
          precio_publicado: p ? [p.price, p.currency] : null,
        };
      }),
    };
  },
};

/** Etiqueta para "Proppi está …" mientras corre cada tool. */
export const TOOL_STATUS: Record<string, string> = {
  buscar_contactos: "buscando en tus contactos",
  ver_contacto: "leyendo la ficha del contacto",
  buscar_propiedades: "revisando tus propiedades",
  ver_propiedad: "analizando la propiedad",
  compradores_compatibles: "buscando compradores compatibles",
  leer_conversacion: "leyendo la conversación",
  conversaciones_sin_responder: "revisando qué quedó sin responder",
  agenda: "mirando la agenda",
  oportunidades: "revisando las oportunidades",
  ofertas: "revisando las ofertas",
};

export async function runTool(name: string, input: unknown, d: ToolData): Promise<{ content: string; isError: boolean }> {
  const h = HANDLERS[name];
  if (!h) return { content: `La herramienta ${name} no existe.`, isError: true };
  try {
    const result = await h((input && typeof input === "object" ? input : {}) as Input, d);
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    const msg = err instanceof ToolInputError ? err.message : "No se pudo leer ese dato en este momento.";
    if (!(err instanceof ToolInputError)) console.error(`[proppi] tool ${name}`, err);
    return { content: msg, isError: true };
  }
}
