import type { Property } from "@/types/db";

export interface DiagnosticCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Explica el resultado: por qué pasa o qué falta. */
  detail: string;
}

/** Reglas de publicación. Las usan el diagnóstico y los contadores del alta. */
export const TITLE_MIN = 20;
export const TITLE_MAX = 100;
export const DESCRIPTION_MIN = 100;
export const PHOTOS_MIN = 5;

/** Validaciones previas a publicar una propiedad en portales externos. */
export function diagnose(p: Property, photoCount: number): DiagnosticCheck[] {
  const titleLen = p.title.trim().length;
  const descLen = (p.description ?? "").trim().length;
  const hasCoords = typeof p.lat === "number" && typeof p.lng === "number";
  const hasSize = !!p.surface_total && !!p.rooms && p.bathrooms != null && p.bathrooms > 0;

  const today = new Date().toISOString().slice(0, 10);
  let authOk = false;
  let authDetail = "No hay autorización del propietario cargada.";
  if (p.authorization_type) {
    if (!p.authorization_expires_at) {
      authOk = true;
      authDetail = "Autorización cargada, sin fecha de vencimiento.";
    } else if (p.authorization_expires_at >= today) {
      authOk = true;
      authDetail = `Vigente hasta el ${p.authorization_expires_at}.`;
    } else {
      authDetail = `Venció el ${p.authorization_expires_at}.`;
    }
  }

  return [
    {
      id: "title",
      label: "Título",
      ok: titleLen >= TITLE_MIN && titleLen <= TITLE_MAX,
      detail:
        titleLen >= TITLE_MIN && titleLen <= TITLE_MAX
          ? `${titleLen} caracteres (ideal ${TITLE_MIN} a ${TITLE_MAX}).`
          : `Tiene ${titleLen} caracteres; debe tener entre ${TITLE_MIN} y ${TITLE_MAX}.`,
    },
    {
      id: "description",
      label: "Descripción",
      ok: descLen >= DESCRIPTION_MIN,
      detail:
        descLen >= DESCRIPTION_MIN
          ? `${descLen} caracteres.`
          : `Tiene ${descLen} caracteres; se necesitan al menos ${DESCRIPTION_MIN}.`,
    },
    {
      id: "photos",
      label: "Fotos",
      ok: photoCount >= PHOTOS_MIN,
      detail:
        photoCount >= PHOTOS_MIN
          ? `${photoCount} fotos cargadas.`
          : `Hay ${photoCount}; se necesitan al menos ${PHOTOS_MIN}.`,
    },
    {
      id: "price",
      label: "Precio y moneda",
      ok: p.price != null && p.price > 0 && !!p.currency,
      detail: p.price != null && p.price > 0 ? `Precio cargado en ${p.currency}.` : "Falta definir el precio.",
    },
    {
      id: "coords",
      label: "Ubicación en el mapa",
      ok: hasCoords,
      detail: hasCoords ? "Coordenadas cargadas." : "Faltan las coordenadas (latitud y longitud).",
    },
    {
      id: "size",
      label: "Superficie, ambientes y baños",
      ok: hasSize,
      detail: hasSize ? "Datos completos." : "Completá superficie total, ambientes y baños.",
    },
    { id: "authorization", label: "Autorización", ok: authOk, detail: authDetail },
  ];
}
