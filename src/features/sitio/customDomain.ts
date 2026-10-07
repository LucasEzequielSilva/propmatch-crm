/**
 * Dominio propio de la inmobiliaria (p. ej. www.lopezpropiedades.com.ar).
 *
 * El dominio se agrega al proyecto de Vercel (ver docs/web-dominio-propio.md)
 * y se mapea a un slug con la variable de entorno de build:
 *
 *   VITE_CUSTOM_DOMAINS="www.lopezprop.com.ar=lopez-propiedades-1ffdbb92,lopezprop.com.ar=lopez-propiedades-1ffdbb92"
 *
 * Con ese host, la web se sirve en la raíz: `/` es el catálogo y `/p/:id` la
 * ficha de cada propiedad (los links de `/sitio/<slug>/…` también andan).
 */
export function parseDomainMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (raw ?? "").split(",")) {
    const [host, slug] = pair.split("=").map((s) => s?.trim().toLowerCase());
    if (host && slug && /^[a-z0-9.-]+$/.test(host) && /^[a-z0-9-]+$/.test(slug)) map.set(host, slug);
  }
  return map;
}

const DOMAINS = parseDomainMap(import.meta.env.VITE_CUSTOM_DOMAINS as string | undefined);

/** Slug de la web si este host es el dominio propio de una inmobiliaria. */
export function customDomainSlug(host: string = typeof window !== "undefined" ? window.location.hostname : ""): string | null {
  return DOMAINS.get(host.toLowerCase()) ?? null;
}

/** En un dominio propio, `/sitio/<slug>/p/<id>` → `/p/<id>` y `/sitio/<slug>` → `/`. */
export function toDomainPath(path: string): string {
  if (!customDomainSlug()) return path;
  const m = /^\/sitio\/[^/?#]+(\/[^?#]*)?(.*)$/.exec(path);
  if (!m) return path;
  return `${m[1] && m[1] !== "/" ? m[1] : "/"}${m[2] ?? ""}`;
}
