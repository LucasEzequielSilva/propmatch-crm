/**
 * «Poner el logo en las fotos de la app PropMatch», del lado del navegador.
 *
 * Antes de escribir `properties.photos`, cambia cada foto de la agencia por
 * su copia con el logo quemado (la genera el servidor: POST
 * /api/integrations/watermark-photos). El CRM sigue guardando las
 * originales. Si una copia falla va la original y se informa: nunca frena la
 * publicación. Lógica pura en shared/appWatermark.ts; ver
 * docs/marca-de-agua-app.md.
 */
import { supabase } from "./supabase";
import { integrationsApi } from "@/features/integraciones/api";
import { appPhotosWithLogo, type AppPhotosOutcome } from "../../shared/appWatermark";
import { resolveAppWatermark, type AgencyBrand, type AppWatermarkConfig } from "../../shared/brand";

/** URL pública de `property-photos/` (misma que arma el cliente de Supabase para cada foto). */
export function photosBase(): string {
  return supabase.storage.from("property-photos").getPublicUrl("x").data.publicUrl.slice(0, -1);
}

/**
 * Qué logo se quema en las fotos de la app (o `null`: opción apagada o logo
 * sin publicar). El logo tiene que estar publicado en la carpeta de la agencia.
 */
export function appWatermarkFor(brand: Partial<AgencyBrand> | null | undefined, agencyId: string): AppWatermarkConfig | null {
  return resolveAppWatermark(brand, `${photosBase()}${agencyId}/branding/`);
}

/** Las fotos que van a la app (con logo si la opción está prendida). Nunca tira. */
export async function photosForApp(
  agencyId: string,
  crmPropertyId: string,
  uploaded: string[],
  brand: Partial<AgencyBrand> | null | undefined,
): Promise<AppPhotosOutcome> {
  const target = appWatermarkFor(brand, agencyId);
  if (!target) return { photos: uploaded, failures: [] };
  return appPhotosWithLogo(crmPropertyId, uploaded, target, {
    publicBase: photosBase(),
    agencyId,
    call: async (crm, urls, t) => {
      const r = await integrationsApi.watermarkPhotos(crm, urls, t);
      return r.ok ? { ok: true, data: r.data } : { ok: false, message: r.message };
    },
  });
}

/** Aviso para la propiedad cuando alguna foto fue a la app sin logo. */
export function watermarkNotice(failures: number): string | null {
  if (failures <= 0) return null;
  return failures === 1
    ? "1 foto se publicó en la app sin el logo (no se pudo generar la copia). Se reintenta al guardar o al actualizar las fotos en la app."
    : `${failures} fotos se publicaron en la app sin el logo (no se pudo generar la copia). Se reintenta al guardar o al actualizar las fotos en la app.`;
}
