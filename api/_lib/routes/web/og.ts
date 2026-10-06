import type { VercelRequest, VercelResponse } from "@vercel/node";
import { agencyBySlug, publicAgency, publicProperties, publicProperty } from "../../web/data.js";
import { CACHE_OK, q, siteOrigin, webConfigured } from "../../web/http.js";
import { formatUsd, isUuid, metaDescription, OPERATION_LABEL, TYPE_LABEL } from "../../../../shared/publicSite.js";

/**
 * Dominio propio (docs/web-dominio-propio.md): sin `slug`, se busca el host en
 * CUSTOM_DOMAINS ("dominio=slug,otro=slug"), la misma lista que
 * VITE_CUSTOM_DOMAINS del front.
 */
function customDomainSlug(req: VercelRequest): string {
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").toLowerCase().split(":")[0];
  for (const pair of (process.env.CUSTOM_DOMAINS ?? process.env.VITE_CUSTOM_DOMAINS ?? "").split(",")) {
    const [h, s] = pair.split("=").map((x) => x?.trim().toLowerCase());
    if (h && s && h === host) return s;
  }
  return "";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * GET /api/web/og?slug=…&id=… — HTML mínimo con title/description/Open Graph
 * para BOTS (WhatsApp, Facebook, X, LinkedIn, Google…).
 *
 * Por qué existe: la web es una SPA de Vite; los bots que arman la vista
 * previa de un link no ejecutan JavaScript y verían el index.html genérico.
 * vercel.json reescribe /sitio/* hacia acá SOLO cuando el User-Agent es de un
 * bot conocido; las personas reciben la SPA normal.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = siteOrigin(req);
  const slug = q(req, "slug") || customDomainSlug(req);
  const id = q(req, "id");
  let title = "PropMatch";
  let description = "Propiedades en venta y alquiler.";
  let image: string | null = null;
  // En un dominio propio la web vive en la raíz.
  const onCustomDomain = !q(req, "slug") && !!slug;
  let url = onCustomDomain ? origin : `${origin}/sitio/${slug}`;
  let status = 200;

  try {
    const found = webConfigured() ? await agencyBySlug(slug) : null;
    if (!found) {
      status = 404;
      title = "Inmobiliaria no encontrada";
    } else {
      const agency = await publicAgency(found.row, found.canonical);
      url = onCustomDomain ? origin : `${origin}/sitio/${agency.slug}`;
      if (id && isUuid(id)) {
        const p = await publicProperty(found.row.id, id);
        if (p) {
          title = `${p.title} · ${formatUsd(p.price, p.pricePeriod)} | ${agency.name}`;
          description = metaDescription(p);
          image = p.photos[0] ?? null;
          url = `${url}/p/${p.id}`;
        } else {
          status = 404;
          title = `Propiedad no disponible | ${agency.name}`;
        }
      } else {
        const list = await publicProperties(found.row.id, 50);
        title = `${agency.name} · Propiedades`;
        const ops = [...new Set(list.map((p) => OPERATION_LABEL[p.operation].toLowerCase()))].join(", ");
        const types = [...new Set(list.map((p) => TYPE_LABEL[p.type].toLowerCase()))].slice(0, 3).join(", ");
        description = list.length
          ? `${list.length} ${list.length === 1 ? "propiedad disponible" : "propiedades disponibles"}${ops ? ` en ${ops}` : ""}${types ? `: ${types}` : ""}.`
          : `Propiedades de ${agency.name}.`;
        image = list.find((p) => p.photos[0])?.photos[0] ?? null;
      }
    }
  } catch {
    status = 500;
  }

  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="es_AR">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    status === 200 ? "" : `<meta name="robots" content="noindex">`,
  ]
    .filter(Boolean)
    .join("\n");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", status === 200 ? CACHE_OK : "public, max-age=30, s-maxage=60");
  res.setHeader("X-Robots-Tag", status === 200 ? "all" : "noindex");
  res
    .status(status)
    .send(`<!doctype html><html lang="es-AR"><head><meta charset="utf-8">\n${tags}\n</head><body><h1>${esc(title)}</h1><p>${esc(description)}</p><p><a href="${esc(url)}">${esc(url)}</a></p></body></html>`);
}
