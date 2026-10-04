/**
 * Generación y medición del texto de la publicación. Todo es puro (sin React)
 * para poder probarlo con casos de ejemplo (ver README.md de esta carpeta).
 * Solo usa datos reales de la propiedad y de la agencia: lo que falta se omite.
 */

import { money, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { Agency, Property } from "@/types/db";
import { IG_LIMITS } from "./imageSpecs";

export type Tone = "calido" | "profesional" | "premium" | "directo";

export const TONES: { id: Tone; label: string; hint: string }[] = [
  { id: "calido", label: "Cálido", hint: "Cercano, con emojis." },
  { id: "profesional", label: "Profesional", hint: "Claro y ordenado, viñetas." },
  { id: "premium", label: "Premium", hint: "Minimalista, sin emojis." },
  { id: "directo", label: "Directo", hint: "Corto, al grano." },
];

export interface CaptionOptions {
  tone: Tone;
  hook: boolean;
  details: boolean;
  cta: boolean;
  contact: boolean;
  showPrice: boolean;
  /** Agrega «link en la bio» al llamado a la acción (los links del texto no son clicables). */
  linkInBio: boolean;
}

export const DEFAULT_OPTIONS: CaptionOptions = {
  tone: "calido",
  hook: true,
  details: true,
  cta: true,
  contact: true,
  showPrice: true,
  linkInBio: true,
};

const OP_PHRASE = { venta: "venta", alquiler: "alquiler", alquiler_temporal: "alquiler temporal" } as const;

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "Palermo Chico" -> "palermochico" */
export const hashtagWord = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Depto luminoso, 2 amb." -> "depto-luminoso-2-amb" (para nombres de archivo). */
export const slugify = (s: string) =>
  strip(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "foto";

const unique = <T,>(xs: T[]) => [...new Set(xs)];

export function placeOf(p: Property): string {
  return p.zone || p.locality || p.province || "";
}

const num = (n: number | null | undefined) => (n != null && n > 0 ? n : null);

/** Primeras oraciones de la descripción, hasta ~220 caracteres, sin cortar a la mitad. */
export function shortDescription(desc: string | null | undefined, max = 220): string {
  const clean = (desc ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastStop > 60) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`;
}

function detailLines(p: Property, tone: Tone): string[] {
  const emoji = tone === "calido" || tone === "directo";
  const bullet = (e: string) => (emoji ? `${e} ` : tone === "premium" ? "— " : "• ");
  const rows: string[] = [];
  const rooms = num(p.rooms);
  const beds = num(p.bedrooms);
  const baths = num(p.bathrooms);
  const garages = num(p.garages);
  if (rooms) rows.push(`${bullet("🚪")}${rooms} ${rooms === 1 ? "ambiente" : "ambientes"}`);
  if (beds) rows.push(`${bullet("🛏️")}${beds} ${beds === 1 ? "dormitorio" : "dormitorios"}`);
  if (baths) rows.push(`${bullet("🚿")}${baths} ${baths === 1 ? "baño" : "baños"}`);
  if (garages) rows.push(`${bullet("🚗")}${garages} ${garages === 1 ? "cochera" : "cocheras"}`);
  const total = num(p.surface_total);
  const covered = num(p.surface_covered);
  if (total && covered && covered !== total) rows.push(`${bullet("📐")}${total} m² totales (${covered} m² cubiertos)`);
  else if (total || covered) rows.push(`${bullet("📐")}${total ?? covered} m²`);
  const feats = (p.features ?? []).filter(Boolean).slice(0, tone === "directo" ? 3 : 5);
  if (feats.length) rows.push(`${bullet("✔️")}${feats.join(" · ")}`);
  return rows;
}

export function buildCaption(
  p: Property,
  agency: Pick<Agency, "name" | "phone">,
  o: CaptionOptions,
): string {
  const place = placeOf(p);
  const type = PROPERTY_TYPE_LABEL[p.type];
  const headline = `${type} en ${OP_PHRASE[p.operation]}${place ? ` en ${place}` : ""}`;
  const price = o.showPrice && p.price ? money(p.price, p.currency) : "";
  const blocks: string[] = [];

  if (o.hook) {
    blocks.push(
      {
        calido: `✨ ${headline}. Un lugar pensado para sentirte en casa.`,
        profesional: `${headline}.`,
        premium: p.title,
        directo: `${OP_PHRASE[p.operation].toUpperCase()} · ${type}${place ? ` · ${place}` : ""}`,
      }[o.tone],
    );
  }

  if (price) {
    blocks.push({ calido: `💰 ${price}`, profesional: `Valor: ${price}`, premium: price, directo: price }[o.tone]);
  }

  const desc = o.tone === "directo" ? "" : shortDescription(p.description);
  if (desc) blocks.push(desc);

  if (o.details) {
    const rows = detailLines(p, o.tone);
    if (rows.length) blocks.push(rows.join("\n"));
  }

  if (o.cta) {
    const base = {
      calido: "💬 Escribinos por mensaje directo y coordinamos una visita.",
      profesional: "Consultá por más información y coordiná tu visita.",
      premium: "Visitas con cita previa.",
      directo: "Consultá ahora.",
    }[o.tone];
    blocks.push(
      o.linkInBio ? `${base}\n${o.tone === "calido" ? "🔗 " : ""}Más fotos y detalles: link en la bio.` : base,
    );
  }

  if (o.contact) {
    const phone = agency.phone?.trim();
    blocks.push(
      o.tone === "premium"
        ? `${agency.name}${phone ? ` — ${phone}` : ""}`
        : `${o.tone === "calido" ? "📲 " : ""}${agency.name}${phone ? ` · ${phone}` : ""}`,
    );
  }

  return blocks.join("\n\n");
}

/** Hashtags armados con datos reales de la propiedad; el orden es de relevancia. */
export function suggestHashtags(p: Property, agency: Pick<Agency, "slug" | "city">): string[] {
  const typeWord = { casa: "casa", departamento: "departamento", ph: "ph", terreno: "terreno", local: "localcomercial", oficina: "oficina" }[p.type];
  const opWord = { venta: "venta", alquiler: "alquiler", alquiler_temporal: "alquilertemporal" }[p.operation];
  const tags = [
    `${typeWord}${p.operation === "venta" ? "enventa" : p.operation === "alquiler" ? "enalquiler" : "alquilertemporal"}`,
    typeWord,
    opWord,
    p.zone,
    p.locality,
    p.province,
    agency.city,
    "inmobiliaria",
    "propiedades",
    "inmuebles",
    "bienesraices",
    agency.slug,
  ]
    .filter((x): x is string => !!x)
    .map(hashtagWord)
    .filter((w) => w.length > 1)
    .map((w) => `#${w}`);
  return unique(tags);
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

export const countHashtags = (text: string) => (text.match(HASHTAG_RE) ?? []).length;

/** Texto final = cuerpo + hashtags en un bloque aparte. */
export function joinCaption(body: string, hashtags: string[]): string {
  const b = body.trimEnd();
  return hashtags.length ? `${b}${b ? "\n\n" : ""}${hashtags.join(" ")}` : b;
}

/**
 * Parte visible antes del «más…». Se corta en `limit` caracteres, retrocediendo hasta el
 * último espacio si cae a menos de 20 caracteres del corte, para no partir palabras.
 * Es una aproximación: Instagram también corta por líneas y varía por dispositivo (a verificar).
 */
export function truncateForMore(text: string, limit: number = IG_LIMITS.captionVisibleChars) {
  if (text.length <= limit) return { visible: text, rest: "", truncated: false };
  let cut = limit;
  const space = text.lastIndexOf(" ", limit);
  const nl = text.lastIndexOf("\n", limit);
  const back = Math.max(space, nl);
  if (back >= limit - 20) cut = back;
  return { visible: text.slice(0, cut).trimEnd(), rest: text.slice(cut), truncated: true };
}
