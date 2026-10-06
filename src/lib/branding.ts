/**
 * Marca de la inmobiliaria en el navegador: logo, guardado local y
 * publicación en el Storage para que la web pública y la ficha la vean sin
 * login. Las reglas puras (lista blanca, contraste, PNG con el JSON) están en
 * shared/brand.ts; ahí está explicado por qué se publica como PNG.
 *
 * Guardado:
 *   - local: `agency.branding` en el store (localStorage, por agencia; la demo
 *     tiene el suyo);
 *   - público (solo cuenta vinculada a una agencia real): logo y brand.png en
 *     `property-photos/<agency_id>/branding/`.
 */
import { useMemo } from "react";
import { useStore, isLinkedAgencyId, type AgencyInput } from "@/data/store";
import { supabase } from "./supabase";
import type { Agency } from "@/types/db";
import {
  BRAND_BUCKET,
  EMPTY_BRAND,
  brandFolder,
  brandLogoPrefix,
  brandObjectPath,
  decodeBrandPng,
  encodeBrandPng,
  resolveBrand,
  sanitizeBrand,
  type AgencyBrand,
  type ResolvedBrand,
} from "../../shared/brand";
import { isUuid } from "../../shared/publicSite";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";

/** Patch para `updateAgency` (que pide los datos básicos) con la marca o las plantillas. */
export function agencyPatch(agency: Agency, patch: Partial<Pick<Agency, "branding" | "doc_templates">>): AgencyInput {
  return { name: agency.name, phone: agency.phone, email: agency.email, city: agency.city, province: agency.province, ...patch };
}

/** Marca resuelta de la agencia actual (con nombre/teléfono/email de la cuenta como respaldo). */
export function useAgencyBrand(): ResolvedBrand {
  const { agency } = useStore();
  return useMemo(() => resolveBrand(agency.branding, { name: agency.name, phone: agency.phone, email: agency.email }), [agency]);
}

/** ¿Esta cuenta puede publicar la marca? Solo una agencia real de Supabase. */
export const canPublishBrand = (agencyId: string) => isLinkedAgencyId(agencyId) && isUuid(agencyId);

/* ── Logo ────────────────────────────────────────────────────────────────── */

const LOGO_MAX_SIDE = 600;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen"));
    img.src = src;
  });
}

/**
 * Achica el logo a 600 px de lado mayor. PNG y SVG salen como PNG (conserva
 * la transparencia; el SVG se rasteriza porque el bucket no acepta SVG y así
 * tampoco viaja código), JPG sale como JPG.
 */
export async function processLogo(file: File): Promise<string> {
  if (!LOGO_TYPES.includes(file.type)) throw new Error("Subí un PNG, JPG o SVG.");
  if (file.size > 8 * 1024 * 1024) throw new Error("El archivo pesa más de 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    let w = img.naturalWidth || 0;
    let h = img.naturalHeight || 0;
    if (file.type === "image/svg+xml" && (!w || !h)) {
      w = 600;
      h = 300;
    }
    if (!w || !h) throw new Error("No se pudo leer la imagen");
    const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(w, h));
    // El SVG se agranda hasta el tope: es vectorial y queda nítido.
    const s = file.type === "image/svg+xml" ? LOGO_MAX_SIDE / Math.max(w, h) : scale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas no disponible");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.86) : canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ── Publicar / leer ─────────────────────────────────────────────────────── */

export type PublishResult = { ok: true; brand: AgencyBrand } | { ok: false; error: string };

/**
 * Sube el logo (si es nuevo) y brand.png. Devuelve la marca con el logo ya
 * como URL pública: esa es la que conviene guardar local (más liviana).
 */
export async function publishBrand(agencyId: string, brand: AgencyBrand): Promise<PublishResult> {
  if (!canPublishBrand(agencyId)) return { ok: false, error: "La web pública se activa con la cuenta de tu inmobiliaria." };
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return { ok: false, error: "Iniciá sesión para publicar la marca." };
  const bucket = supabase.storage.from(BRAND_BUCKET);
  let next: AgencyBrand = { ...brand, updatedAt: new Date().toISOString() };

  if (next.logoUrl?.startsWith("data:")) {
    const blob = dataUrlToBlob(next.logoUrl);
    const ext = blob.type === "image/jpeg" ? "jpg" : "png";
    const path = `${brandFolder(agencyId)}/logo-${Date.now()}.${ext}`;
    const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (error) return { ok: false, error: "No pudimos subir el logo. Probá de nuevo en un rato." };
    next = { ...next, logoUrl: bucket.getPublicUrl(path).data.publicUrl };
  }

  const clean = sanitizeBrand(next, { logoPrefix: brandLogoPrefix(SUPABASE_URL, agencyId) });
  if (!clean) return { ok: false, error: "Datos de marca inválidos." };
  const png = encodeBrandPng(JSON.stringify(clean));
  const { error } = await bucket.upload(brandObjectPath(agencyId), new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }), {
    contentType: "image/png",
    cacheControl: "60",
    upsert: true,
  });
  if (error) return { ok: false, error: "No pudimos publicar la marca. Revisá tu conexión y probá de nuevo." };
  return { ok: true, brand: clean };
}

/** Lee la marca publicada de una agencia (sin sesión). `null` si no hay. */
export async function fetchPublishedBrand(agencyId: string): Promise<AgencyBrand | null> {
  if (!SUPABASE_URL || !isUuid(agencyId)) return null;
  try {
    const url = `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${BRAND_BUCKET}/${brandObjectPath(agencyId)}?t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const text = decodeBrandPng(new Uint8Array(await r.arrayBuffer()));
    if (!text) return null;
    return sanitizeBrand(JSON.parse(text), { logoPrefix: brandLogoPrefix(SUPABASE_URL, agencyId) });
  } catch {
    return null;
  }
}

export { EMPTY_BRAND };
