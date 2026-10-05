/**
 * Coordenadas a partir de lo que el agente tiene a mano: un link de Google
 * Maps copiado del navegador o un par "lat, lng" suelto.
 *
 * Sin red ni API: solo se lee lo que ya viene en el texto. Los links cortos
 * (maps.app.goo.gl) no traen coordenadas hasta que se abren, así que no se
 * pueden leer acá; se avisa para que abran el link y copien el largo.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 es el "sin dato" típico de un formulario mal cargado, no una casa.
    !(lat === 0 && lng === 0)
  );
}

function pick(text: string, re: RegExp): LatLng | null {
  const m = text.match(re);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/**
 * Orden de preferencia:
 * 1. `!3d<lat>!4d<lng>`: el pin del lugar elegido (lo más preciso).
 * 2. `?q=` / `query=` / `ll=` / `destination=`: el punto pedido.
 * 3. `@lat,lng,zoom`: el centro de la vista (puede estar corrido del pin).
 * 4. Un par "lat, lng" suelto.
 */
export function parseCoordinates(raw: string): LatLng | null {
  let text = raw.trim();
  if (!text) return null;
  try {
    text = decodeURIComponent(text);
  } catch {
    /* un % suelto: se usa tal cual */
  }
  return (
    pick(text, new RegExp(`!3d${NUM}!4d${NUM}`)) ??
    pick(text, new RegExp(`[?&](?:q|query|ll|destination|center)=${NUM}\\s*,\\s*${NUM}`)) ??
    pick(text, new RegExp(`@${NUM},${NUM}`)) ??
    pick(text, new RegExp(`^${NUM}\\s*[,;]\\s*${NUM}$`))
  );
}

/** Link corto de Google Maps: no trae coordenadas hasta que se abre. */
export function isShortMapsLink(raw: string): boolean {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(raw);
}
