/**
 * Datos de ejemplo: reglas compartidas.
 *
 * Cómo se marca un dato de ejemplo: cada registro de la semilla lleva
 * `is_sample: true` (campo opcional en los tipos). Se eligió el campo y no
 * solo un set de ids porque viaja con el registro: sobrevive a ediciones
 * (todas las acciones del store hacen `{ ...registro, ...cambios }`), a
 * copias entre pantallas y a lo que lean Proppi/IA, y no depende de que los
 * ids de la semilla nunca choquen con otros. Para los datos guardados ANTES
 * de este campo (la demo ya tenía la semilla en localStorage) hay una red de
 * contención por id: `markLegacySamples` en src/data/samples.ts los marca al
 * cargar.
 *
 * Regla de oro: un dato de ejemplo NUNCA sale del navegador. No se sincroniza
 * con la app, no se publica en portales ni en Mercado Libre, no se le escribe
 * por WhatsApp a un número real y en los CSV va marcado. Editarlo no lo
 * vuelve real.
 */

/** `true` si el registro es de ejemplo. Acepta `undefined` para usarlo directo con `byId()`. */
export function isSample(record: { is_sample?: boolean } | null | undefined): boolean {
  return record?.is_sample === true;
}

/** Mensaje único cuando se intenta publicar algo de ejemplo. */
export const SAMPLE_PUBLISH_BLOCKED = "Es una propiedad de ejemplo: no se publica";

/** Texto del banner global. */
export const SAMPLE_BANNER_TEXT = "Estás viendo datos de ejemplo para conocer PropMatch.";

/**
 * Teléfonos de los contactos de ejemplo: `+54 221 555-01xx`. Son ficticios a
 * propósito y además `whatsappLink` se niega a armar un chat con ellos: el
 * link abre WhatsApp sin destinatario.
 */
export const SAMPLE_PHONE_PREFIX = "+54 221 555-01";

/** Reconoce los teléfonos ficticios de la semilla, con o sin 9, 0 o separadores. */
export function isSamplePhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  return /(?:^|54)9?0?2215550\d{3}$/.test(digits);
}

/** Valor para la columna "Ejemplo" de los CSV. */
export const sampleCsvCell = (record: { is_sample?: boolean } | null | undefined) =>
  isSample(record) ? "Sí (dato de ejemplo)" : "";
