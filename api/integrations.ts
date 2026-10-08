import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin, requireAgencyMember } from "./_lib/auth.js";
import { allowMethod, fail, json } from "./_lib/http.js";
import { routeByAction } from "./_lib/router.js";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { saveArgenpropCredentials } from "./_lib/integrations/adapters/argenprop.js";
import { runEngine } from "./_lib/integrations/engine.js";
import { ADAPTERS, PORTAL_IDS, adapterFor } from "./_lib/integrations/registry.js";
import { parseReturnTarget } from "./_lib/integrations/returnTo.js";
import { meliImportDetails, meliImportLink, meliImportList } from "./_lib/integrations/adapters/mercadolibreImport.js";
import { parseImportCursor, parseImportLinks, parseItemIds } from "./_lib/integrations/meliRequest.js";
import { createHash, randomUUID } from "node:crypto";
import { MAX_IMAGE_BYTES, copyPhotos, parseCopyRequest, sniffImage } from "./_lib/photoCopy/core.js";
import { env } from "./_lib/env.js";
import { parseWatermarkRequest, photosPublicBase, watermarkPhotos } from "../shared/appWatermark.js";
import { downloadImage } from "./_lib/photoCopy/download.js";

/**
 * Una sola función para /api/integrations/* (Configuración → Integraciones y
 * el motor de publicación multi-portal). Ver docs/integraciones-multitenant.md.
 *
 *   GET  list         estado de cada portal para la agencia del usuario (sin secretos)
 *   POST connect      { portal, return? }        solo admins → { url } (OAuth) | { form: true }
 *   POST disconnect   { portal }                 solo admins
 *   POST credentials  { portal: "argenprop", … } solo admins (credenciales emitidas por el portal)
 *   POST check        { propertyId, portals, inputs }  valida por portal
 *   POST publish      { propertyId, portals, inputs }  publica por portal
 *                     (o { crmPropertyId, … } si la propiedad solo vive en el CRM: pesos o sin sincronizar)
 *   POST import         { portal: "mercadolibre", cursor? }   una página de avisos de la cuenta conectada
 *   POST import-details { portal: "mercadolibre", ids }       detalle con descripción (hasta 20)
 *   POST import-link    { portal: "mercadolibre", links }     vincula propiedades importadas con su aviso
 *   POST copy-photos    { crmPropertyId, urls }  solo admins: copia fotos externas (hasta 40) al bucket
 *                       property-photos/<agencia>/<crmPropertyId>/ → { results, skipped }
 *                       (ver docs/publicar-todas-en-la-app.md)
 *   POST watermark-photos { crmPropertyId, urls, logoUrl, position, size, backdrop }
 *                       miembros de la agencia: copia con el logo quemado de fotos de la
 *                       agencia (hasta 12) en property-photos/<agencia>/<crmPropertyId>/app/
 *                       → { results, skipped } (ver docs/marca-de-agua-app.md)
 *
 * Las URLs registradas en los portales (/api/meli/callback, /api/meli/notifications)
 * no cambian: siguen en api/meli.ts.
 */

const body = (req: VercelRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

async function list(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    const portals = await Promise.all(
      PORTAL_IDS.map(async (id) => {
        try {
          return await ADAPTERS[id].status(ctx);
        } catch {
          const a = ADAPTERS[id];
          return {
            portal: id,
            state: "error" as const,
            accountLabel: null,
            connectedAt: null,
            lastError: "No pudimos consultar el estado de la conexión.",
            lastCheckedAt: null,
            authMethod: a.authMethod,
            availability: a.availability(),
          };
        }
      }),
    );
    json(res, 200, { isAdmin: ctx.role === "admin", portals });
  } catch {
    fail(res, 500, "server_error");
  }
}

async function connect(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    const b = body(req);
    const a = adapterFor(b.portal);
    if (!a) return fail(res, 400, "unknown_portal");
    const av = a.availability();
    if (av.state === "coming_soon" || av.state === "not_configured") return json(res, 409, { error: "unavailable", message: av.reason });
    const start = await a.connect(ctx, { returnTo: parseReturnTarget(b.return) });
    if (start.setCookie) res.setHeader("Set-Cookie", start.setCookie);
    json(res, 200, { url: start.url, form: start.form ?? false });
  } catch {
    fail(res, 500, "server_error");
  }
}

async function disconnect(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    const a = adapterFor(body(req).portal);
    if (!a) return fail(res, 400, "unknown_portal");
    await a.disconnect(ctx);
    json(res, 200, { ok: true });
  } catch {
    fail(res, 500, "server_error");
  }
}

async function credentials(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    const b = body(req);
    if (b.portal !== "argenprop") return fail(res, 400, "unknown_portal");
    const r = await saveArgenpropCredentials(ctx, b.credentials);
    if (r.ok) return json(res, 200, { ok: true });
    const http = r.code === "invalid" ? 422 : r.code === "in_use" ? 409 : r.code === "disabled" ? 409 : 500;
    json(res, http, { error: r.code, field: r.field, message: r.message });
  } catch {
    fail(res, 500, "server_error");
  }
}

/** La propiedad, solo si es de la agencia. */
async function loadProperty(agencyId: string, propertyId: string) {
  const { data } = await supabaseAdmin().from("properties").select("id, agency_id").eq("id", propertyId).maybeSingle();
  return data && data.agency_id === agencyId ? { id: data.id as string } : null;
}

function engine(mode: "check" | "publish") {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (!allowMethod(req, res, "POST")) return;
    try {
      const ctx = await requireAgencyMember(req, res);
      if (!ctx) return;
      const r = await runEngine({ scope: ctx, mode, body: body(req) }, { adapterFor, loadProperty });
      json(res, r.http, r.body);
    } catch {
      fail(res, 500, "server_error");
    }
  };
}

/**
 * Importar avisos: por ahora solo Mercado Libre (el único portal con API de
 * lectura de avisos propios). Cualquier miembro de la agencia: solo lee avisos
 * y vincula propiedades de su propia agencia.
 */
function importAction(kind: "list" | "details" | "link") {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (!allowMethod(req, res, "POST")) return;
    try {
      const ctx = await requireAgencyMember(req, res);
      if (!ctx) return;
      const b = body(req);
      if (b.portal !== "mercadolibre") return fail(res, 400, "unknown_portal");
      const av = ADAPTERS.mercadolibre.availability();
      if (av.state !== "available") return json(res, 409, { error: "unavailable", message: av.reason });
      let r;
      if (kind === "list") {
        const cursor = parseImportCursor(b.cursor);
        if (!cursor) return fail(res, 400, "bad_request");
        r = await meliImportList(ctx, cursor);
      } else if (kind === "details") {
        const ids = parseItemIds(b.ids);
        if (!ids) return fail(res, 400, "bad_request");
        r = await meliImportDetails(ctx, ids);
      } else {
        const links = parseImportLinks(b.links);
        if (!links) return fail(res, 400, "bad_request");
        r = await meliImportLink(ctx, links);
      }
      if ("error" in r) return json(res, r.http, { error: r.error, message: r.message });
      json(res, 200, r);
    } catch {
      fail(res, 500, "server_error");
    }
  };
}

/**
 * «Publicar todas en la app»: copia las fotos externas (p. ej. las de un Excel
 * importado) de UNA propiedad al bucket público `property-photos`, en la
 * carpeta de la agencia del usuario (sale del JWT + agency_members, nunca del
 * pedido). Del lado servidor porque el navegador no puede leer imágenes de
 * otro dominio sin CORS. Validaciones anti-SSRF y de tamaño/tipo en
 * _lib/photoCopy. Lo que no entra en el plazo vuelve en `skipped`.
 */
async function copyPhotosAction(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    const parsed = parseCopyRequest(body(req));
    if (!parsed) return fail(res, 400, "bad_request");
    const bucket = supabaseAdmin().storage.from("property-photos");
    const r = await copyPhotos(ctx.agencyId, parsed, {
      download: downloadImage,
      upload: async (path, bytes, type) => {
        const { error } = await bucket.upload(path, bytes, { contentType: type, upsert: false, cacheControl: "31536000" });
        if (error) throw error;
        return bucket.getPublicUrl(path).data.publicUrl;
      },
      newId: randomUUID,
      now: Date.now,
    });
    json(res, 200, r);
  } catch {
    fail(res, 500, "server_error");
  }
}

/**
 * «Poner el logo en las fotos de la app PropMatch»: genera, para UNA
 * propiedad, una copia de cada foto con el logo de la inmobiliaria quemado.
 * Solo lee del bucket (fotos de `<agencia>/…` y logo de `<agencia>/branding/`,
 * la agencia sale de la sesión): nunca baja nada de internet. Idempotente: si
 * la copia (mismo hash de foto + logo + opciones) ya existe, no se procesa.
 * Lo que no entra en el plazo vuelve en `skipped`. Lógica en
 * shared/appWatermark.ts; el dibujo (sharp) en _lib/photoWatermark/render.ts,
 * que se carga recién acá para no demorar el arranque de las otras acciones.
 */
async function watermarkPhotosAction(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    const parsed = parseWatermarkRequest(body(req), { publicBase: photosPublicBase(env("SUPABASE_URL")), agencyId: ctx.agencyId });
    if (!parsed) return fail(res, 400, "bad_request");
    const { renderWatermark } = await import("./_lib/photoWatermark/render.js");
    const bucket = supabaseAdmin().storage.from("property-photos");
    const r = await watermarkPhotos(ctx.agencyId, parsed, {
      hash: (s) => createHash("sha256").update(s).digest("hex"),
      listNames: async (folder) => {
        const { data, error } = await bucket.list(folder, { limit: 1000 });
        if (error) throw error;
        return new Set((data ?? []).map((o) => o.name));
      },
      download: async (path) => {
        const { data, error } = await bucket.download(path);
        if (error || !data) throw error ?? new Error("download");
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (bytes.length > MAX_IMAGE_BYTES || !sniffImage(bytes)) throw new Error("not_image");
        return bytes;
      },
      render: renderWatermark,
      upload: async (path, bytes) => {
        const { error } = await bucket.upload(path, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
        if (error) throw error;
      },
      publicUrl: (path) => bucket.getPublicUrl(path).data.publicUrl,
      now: Date.now,
    });
    json(res, 200, r);
  } catch {
    fail(res, 500, "server_error");
  }
}

export default routeByAction("integrations", {
  list,
  connect,
  disconnect,
  credentials,
  check: engine("check"),
  publish: engine("publish"),
  import: importAction("list"),
  "import-details": importAction("details"),
  "import-link": importAction("link"),
  "copy-photos": copyPhotosAction,
  "watermark-photos": watermarkPhotosAction,
});
