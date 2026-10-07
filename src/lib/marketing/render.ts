/**
 * Contenido personalizado por contacto: variables, propiedades recomendadas
 * por matching y el HTML final del email (con branding y pie legal).
 */
import type { Agency, Contact, ContactRequirement, Match, Profile, Property } from "@/types/db";
import { computeMatch, MATCH_THRESHOLD } from "@/lib/matching";
import { money, OPERATION_LABEL, PROPERTY_TYPE_LABEL } from "@/lib/format";
import { isSample } from "@/lib/samples";
import { firstName } from "@/lib/whatsapp";
import { sitePropertyUrl, siteUrl } from "@/features/sitio/siteUrl";
import {
  buildEmailHtml,
  buildEmailText,
  DEFAULT_LEGAL,
  renderVars,
  withAdvertisingPrefix,
  type EmailPropertyBlock,
  type MarketingBrand,
  type MarketingFooter,
  type MarketingVars,
} from "../../../shared/marketing";
import type { EmailTemplate, WhatsAppTemplate } from "./types";

export interface RenderData {
  agency: Agency;
  profile: Profile;
  properties: Property[];
  requirements: ContactRequirement[];
  matches: Match[];
  coverPhoto: (propertyId: string) => string | null;
}

/**
 * Branding del email. PUNTO DE EXTENSIÓN: cuando exista el branding de la
 * inmobiliaria (src/lib/branding.ts o brand.json en el bucket, lo arma otra
 * rama), se mapea acá: logo, color principal y datos del pie. Hoy usa los
 * datos de la agencia y el violeta de PropMatch.
 */
export function resolveMarketingBrand(agency: Agency, override?: Partial<MarketingBrand>): MarketingBrand {
  return {
    agencyName: agency.name || "Tu inmobiliaria",
    logoUrl: agency.logo_url && /^https:\/\//.test(agency.logo_url) ? agency.logo_url : null,
    primary: "#7C3AED",
    onPrimary: "#FFFFFF",
    ...override,
  };
}

export function resolveFooter(agency: Agency, override?: Partial<MarketingFooter>): MarketingFooter {
  return {
    agencyName: agency.name || "Tu inmobiliaria",
    address: [agency.city, agency.province].filter(Boolean).join(", ") || null,
    phone: agency.phone,
    email: agency.email,
    website: siteUrl(agency),
    legal: DEFAULT_LEGAL,
    ...override,
  };
}

/**
 * Propiedades recomendadas para el contacto: primero sus matches (mejor
 * puntaje), si no alcanza, se calcula contra su búsqueda. Solo disponibles.
 * Nunca se recomienda una propiedad de ejemplo a un contacto real.
 */
export function recommendedFor(contact: Contact, d: RenderData, n: number): Property[] {
  if (n <= 0) return [];
  const ok = (p: Property | undefined): p is Property => !!p && p.status === "disponible" && (isSample(contact) || !isSample(p));
  const byId = new Map(d.properties.map((p) => [p.id, p]));
  const out: Property[] = [];
  const seen = new Set<string>();
  for (const m of d.matches.filter((x) => x.contact_id === contact.id && !x.is_dismissed).sort((a, b) => b.score - a.score)) {
    const p = byId.get(m.property_id);
    if (ok(p) && !seen.has(p.id)) {
      out.push(p);
      seen.add(p.id);
    }
    if (out.length >= n) return out;
  }
  const req = d.requirements.find((r) => r.contact_id === contact.id && r.is_active);
  if (req) {
    const extra = d.properties
      .filter((p) => ok(p) && !seen.has(p.id) && p.operation === req.operation)
      .map((p) => ({ p, s: computeMatch(req, p).score }))
      .filter((x) => x.s >= MATCH_THRESHOLD)
      .sort((a, b) => b.s - a.s);
    for (const x of extra) {
      out.push(x.p);
      if (out.length >= n) break;
    }
  }
  return out;
}

export function propertyLink(agency: Agency, p: Property): string | null {
  return sitePropertyUrl(agency, p.app_property_id);
}

export function varsFor(contact: Contact, d: RenderData, top: Property | undefined): MarketingVars {
  return {
    nombre: firstName(contact.full_name),
    propiedad: top?.title ?? "",
    link_propiedad: (top && propertyLink(d.agency, top)) ?? siteUrl(d.agency) ?? "",
    link_web: siteUrl(d.agency) ?? "",
    inmobiliaria: d.agency.name,
    agente: firstName(d.profile.full_name),
  };
}

function block(p: Property, d: RenderData): EmailPropertyBlock {
  const where = [p.zone, p.locality].filter(Boolean)[0];
  const facts = [OPERATION_LABEL[p.operation], PROPERTY_TYPE_LABEL[p.type], where, p.rooms ? `${p.rooms} amb.` : null, p.surface_total ? `${p.surface_total} m²` : null]
    .filter(Boolean)
    .join(" · ");
  const cover = d.coverPhoto(p.id);
  return {
    title: p.title,
    subtitle: facts,
    price: money(p.price, p.currency),
    url: propertyLink(d.agency, p),
    // Solo fotos con URL pública (las subidas desde la compu viven en el navegador).
    imageUrl: cover && /^https:\/\//.test(cover) ? cover : null,
  };
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  properties: Property[];
  missing: string[];
}

export function renderEmail(t: EmailTemplate, contact: Contact, d: RenderData): RenderedEmail {
  const recs = t.includeRecommendations ? recommendedFor(contact, d, Math.max(1, Math.min(6, t.recommendationsCount))) : [];
  const vars = varsFor(contact, d, recs[0]);
  const missing = (Object.keys(vars) as (keyof MarketingVars)[]).filter(
    (k) => !vars[k] && [t.subject, t.body, t.ctaUrl, t.preheader].some((s) => s.includes(`{{${k}}}`)),
  );
  const content = {
    subject: withAdvertisingPrefix(renderVars(t.subject, vars), t.advertisingPrefix),
    preheader: renderVars(t.preheader, vars),
    body: renderVars(t.body, vars),
    ctaLabel: t.ctaLabel.trim() || null,
    ctaUrl: renderVars(t.ctaUrl, vars) || null,
    properties: recs.map((p) => block(p, d)),
    propertiesTitle: "Propiedades que coinciden con tu búsqueda",
  };
  const brand = resolveMarketingBrand(d.agency);
  const footer = resolveFooter(d.agency);
  return {
    subject: content.subject,
    preheader: content.preheader,
    html: buildEmailHtml(content, brand, footer),
    text: buildEmailText(content, footer),
    properties: recs,
    missing,
  };
}

export interface RenderedWhatsApp {
  params: string[];
  preview: string;
  missing: string[];
  properties: Property[];
}

export function renderWhatsApp(t: WhatsAppTemplate, contact: Contact, d: RenderData): RenderedWhatsApp {
  const recs = recommendedFor(contact, d, 1);
  const vars = varsFor(contact, d, recs[0]);
  const params = t.params.map((p) => renderVars(p, vars).replace(/[\n\t]+/g, " ").trim());
  const missing = params.map((p, i) => (p ? null : `{{${i + 1}}}`)).filter((x): x is string => !!x);
  const preview = t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] || `{{${n}}}`);
  return { params, preview, missing, properties: recs };
}

/** Plantillas de arranque (se pueden editar). */
export function starterEmail(now: string, id: string): EmailTemplate {
  return {
    id,
    channel: "email",
    name: "Nuevas propiedades para vos",
    subject: "{{nombre}}, encontramos propiedades para tu búsqueda",
    preheader: "Seleccionadas según lo que nos contaste",
    body:
      "Hola {{nombre}}!\n\nSoy {{agente}} de {{inmobiliaria}}. Te escribo porque entraron propiedades que coinciden con lo que estás buscando. Te dejo las que mejor encajan.\n\nSi querés coordinar una visita o que te busquemos otras opciones, respondé este mail.",
    ctaLabel: "Ver todas las propiedades",
    ctaUrl: "{{link_web}}",
    includeRecommendations: true,
    recommendationsCount: 3,
    advertisingPrefix: false,
    created_at: now,
    updated_at: now,
  };
}

export function starterWhatsApp(now: string, id: string): WhatsAppTemplate {
  return {
    id,
    channel: "whatsapp",
    name: "Propiedad nueva (WhatsApp)",
    waName: "propiedad_nueva",
    waLanguage: "es_AR",
    body:
      "Hola {{1}}! Te escribimos de {{2}}. Entró una propiedad que coincide con tu búsqueda: {{3}}. Mirala acá: {{4}}\n\nRespondé BAJA para no recibir más mensajes.",
    params: ["{{nombre}}", "{{inmobiliaria}}", "{{propiedad}}", "{{link_propiedad}}"],
    optOut: "button",
    created_at: now,
    updated_at: now,
  };
}
