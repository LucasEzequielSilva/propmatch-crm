import type { Property } from "@/types/db";

export interface DiagnosticCheck {
  id: string;
  label: string;
  ok: boolean;
  /** Explica el resultado: por qué pasa o qué falta. */
  detail: string;
}

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
      ok: titleLen >= 20 && titleLen <= 100,
      detail:
        titleLen >= 20 && titleLen <= 100
          ? `${titleLen} caracteres (ideal 20 a 100).`
          : `Tiene ${titleLen} caracteres; debe tener entre 20 y 100.`,
    },
    {
      id: "description",
      label: "Descripción",
      ok: descLen >= 100,
      detail: descLen >= 100 ? `${descLen} caracteres.` : `Tiene ${descLen} caracteres; se necesitan al menos 100.`,
    },
    {
      id: "photos",
      label: "Fotos",
      ok: photoCount >= 5,
      detail: photoCount >= 5 ? `${photoCount} fotos cargadas.` : `Hay ${photoCount}; se necesitan al menos 5.`,
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
