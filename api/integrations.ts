import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin, requireAgencyMember } from "./_lib/auth.js";
import { allowMethod, fail, json } from "./_lib/http.js";
import { routeByAction } from "./_lib/router.js";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { saveArgenpropCredentials } from "./_lib/integrations/adapters/argenprop.js";
import { runEngine } from "./_lib/integrations/engine.js";
import { ADAPTERS, PORTAL_IDS, adapterFor } from "./_lib/integrations/registry.js";
import { parseReturnTarget } from "./_lib/integrations/returnTo.js";

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

export default routeByAction("integrations", {
  list,
  connect,
  disconnect,
  credentials,
  check: engine("check"),
  publish: engine("publish"),
});
