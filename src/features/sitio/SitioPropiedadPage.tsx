import { useState } from "react";
import { customDomainSlug } from "./customDomain";
import { Link, useParams } from "react-router-dom";
import { ChevronLeftIcon, HomeIcon, MapPinIcon } from "@/components/ui/icons";
import { formatUsd, mapsLink, metaDescription, OPERATION_LABEL, TYPE_LABEL, type PublicProperty } from "../../../shared/publicSite";
import { useSiteData } from "./useSiteData";
import { useDocumentMeta } from "./useDocumentMeta";
import { PhotoLogoOverlay } from "@/features/branding/PhotoLogoOverlay";
import { resolvePhotoLogo, type ResolvedPhotoLogo } from "../../../shared/brand";
import { ContactButtons, INK, SiteMessage, SiteShell, SOFT, useEmbed, useSiteHref } from "./SiteChrome";

/**
 * Ficha pública de una propiedad. Toma los datos de la misma respuesta que la
 * portada (/api/web/site, cacheada en el CDN): navegar entre portada y fichas
 * no vuelve a pedir nada. /api/web/property existe para los bots y para
 * integradores.
 */
export default function SitioPropiedadPage() {
  const { slug: routeSlug = "", id = "" } = useParams<{ slug: string; id: string }>();
  const slug = routeSlug || customDomainSlug() || "";
  const state = useSiteData(slug);
  const href = useSiteHref();
  const embed = useEmbed();
  const site = state.kind === "ok" ? state.site : null;
  const p = site?.properties.find((x) => x.id === id) ?? null;

  useDocumentMeta({
    title: p && site ? `${p.title} · ${formatUsd(p.price, p.pricePeriod)} | ${site.agency.name}` : site ? site.agency.name : "Propiedad",
    description: p ? metaDescription(p) : "Propiedades en venta y alquiler.",
    image: p?.photos[0] ?? null,
    noindex: !p || (state.kind === "ok" && state.preview),
  });

  if (state.kind === "loading") {
    return (
      <SiteShell agency={null}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-10" aria-busy="true" aria-label="Cargando propiedad">
          <div className="aspect-[16/9] rounded-2xl animate-pulse motion-reduce:animate-none" style={{ background: "var(--brand-soft, #F5F3FF)" }} />
        </div>
      </SiteShell>
    );
  }
  if (!site) {
    return (
      <SiteShell agency={null}>
        <SiteMessage
          title={state.kind === "not_found" ? "No encontramos esta inmobiliaria" : state.kind === "needs_session" ? "Vista previa de tu web" : "No pudimos cargar la propiedad"}
          text={state.kind === "needs_session" ? "Entrá a PropMatch en este navegador para ver la vista previa." : "Probá de nuevo en unos minutos."}
        />
      </SiteShell>
    );
  }
  if (!p) {
    return (
      <SiteShell agency={site.agency} preview={state.kind === "ok" && state.preview}>
        <SiteMessage
          title="Esta propiedad ya no está disponible"
          text="Puede que se haya vendido o alquilado. Mirá las otras propiedades disponibles."
          action={
            <Link to={href(`/sitio/${site.agency.slug}`)} className="min-h-11 px-5 inline-flex items-center rounded-xl" style={{ background: "var(--brand-primary, #7C3AED)", color: "var(--brand-on-primary, #FFFFFF)", fontWeight: 700 }}>
              Ver propiedades
            </Link>
          }
        />
      </SiteShell>
    );
  }

  const pageUrl = window.location.href.split("?")[0];
  const contactText = `Hola ${site.agency.name}, me interesa «${p.title}». ${pageUrl}`;
  const notPublished = state.kind === "ok" && state.notPublished.has(p.id);

  return (
    <SiteShell agency={site.agency} preview={state.kind === "ok" && state.preview}>
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
        <Link to={href(`/sitio/${site.agency.slug}`)} className="inline-flex items-center gap-1 min-h-11 text-sm" style={{ color: "var(--brand-accent, #5B21B6)", fontWeight: 700 }}>
          <ChevronLeftIcon size={14} /> Todas las propiedades
        </Link>

        <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="min-w-0">
            <Gallery p={p} photoLogo={resolvePhotoLogo(site.agency.brand)} />

            <section aria-labelledby="desc-h" className="mt-8">
              <h2 id="desc-h" className="text-lg" style={{ fontWeight: 800 }}>
                Descripción
              </h2>
              <p className="mt-2 whitespace-pre-line leading-relaxed" style={{ color: "#374151" }}>
                {p.description || "Consultanos por más información."}
              </p>
            </section>

            {p.amenities.length > 0 && (
              <section aria-labelledby="amen-h" className="mt-8">
                <h2 id="amen-h" className="text-lg" style={{ fontWeight: 800 }}>
                  Características
                </h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {p.amenities.map((a) => (
                    <li key={a} className="text-sm px-3 py-1.5 rounded-full" style={{ background: "var(--brand-soft, #F5F3FF)", color: "var(--brand-accent, #5B21B6)", fontWeight: 600 }}>
                      {a}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Location p={p} />
          </div>

          <aside className="lg:sticky lg:top-6 rounded-2xl border bg-white p-5" style={{ borderColor: "#EDE9FE", boxShadow: "var(--shadow-card)" }}>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "var(--brand-soft, #F5F3FF)", color: "var(--brand-accent, #5B21B6)", fontWeight: 800 }}>
                {OPERATION_LABEL[p.operation]}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#F3F4F6", color: "#374151", fontWeight: 700 }}>
                {TYPE_LABEL[p.type]}
              </span>
              {notPublished && (
                <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#FEF3C7", color: "#92400E", fontWeight: 800 }}>
                  No se publica
                </span>
              )}
            </div>
            <h1 className="mt-3 text-xl md:text-2xl tracking-tight" style={{ fontWeight: 800 }}>
              {p.title}
            </h1>
            {p.area && (
              <p className="mt-1 text-sm flex items-center gap-1" style={{ color: SOFT }}>
                <MapPinIcon size={14} color="#7458C4" /> {p.area}
              </p>
            )}
            <p className="mt-4 text-2xl" style={{ fontWeight: 800, color: INK }}>
              {formatUsd(p.price, p.pricePeriod)}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt style={{ color: "#7458C4", fontWeight: 700 }}>Ambientes</dt>
                <dd style={{ fontWeight: 700 }}>{p.rooms ?? "—"}</dd>
              </div>
              <div>
                <dt style={{ color: "#7458C4", fontWeight: 700 }}>Operación</dt>
                <dd style={{ fontWeight: 700 }}>{OPERATION_LABEL[p.operation]}</dd>
              </div>
            </dl>
            <div className="mt-5">
              {site.agency.whatsapp || site.agency.email ? (
                <ContactButtons agency={site.agency} text={contactText} compact />
              ) : (
                <p className="text-sm" style={{ color: SOFT }}>
                  Consultá a {site.agency.name} por esta propiedad.
                </p>
              )}
            </div>
            {embed && (
              <p className="mt-3 text-xs" style={{ color: SOFT }}>
                Publicado por {site.agency.name}
              </p>
            )}
          </aside>
        </div>
      </div>
    </SiteShell>
  );
}

function Gallery({ p, photoLogo }: { p: PublicProperty; photoLogo: ResolvedPhotoLogo | null }) {
  const [i, setI] = useState(0);
  const n = p.photos.length;
  if (n === 0) {
    return (
      <div className="aspect-[16/10] rounded-2xl flex items-center justify-center" style={{ background: "var(--brand-soft, #F5F3FF)" }}>
        <HomeIcon size={40} color="#C4B5FD" />
      </div>
    );
  }
  const go = (d: number) => setI((x) => (x + d + n) % n);
  return (
    <section aria-label="Fotos" aria-roledescription="galería">
      <div className="relative aspect-[16/10] rounded-2xl overflow-hidden" style={{ background: "#1F0A3C" }}>
        <img src={p.photos[i]} alt={`${p.title}, foto ${i + 1} de ${n}`} className="w-full h-full object-contain" decoding="async" />
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Foto anterior" className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 flex items-center justify-center text-xl" style={{ color: INK, fontWeight: 800 }}>
              ‹
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Foto siguiente" className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 flex items-center justify-center text-xl" style={{ color: INK, fontWeight: 800 }}>
              ›
            </button>
            <span className="absolute bottom-3 right-3 text-xs px-2 py-1 rounded-full text-white" style={{ background: "rgba(31,10,60,0.75)", fontWeight: 700 }} aria-live="polite">
              {i + 1} / {n}
            </span>
          </>
        )}
        {/* Logo de la inmobiliaria: capa CSS decorativa (esquiva el contador). */}
        <PhotoLogoOverlay logo={photoLogo} context="hero" avoid={n > 1 ? ["bottom-right"] : []} />
      </div>
      {n > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {p.photos.map((u, k) => (
            <li key={u} className="flex-shrink-0">
              <button
                type="button"
                onClick={() => setI(k)}
                aria-label={`Ver foto ${k + 1}`}
                aria-current={k === i}
                className="block w-20 h-16 rounded-lg overflow-hidden border-2"
                style={{ borderColor: k === i ? "var(--brand-primary, #7C3AED)" : "transparent" }}
              >
                <img src={u} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Location({ p }: { p: PublicProperty }) {
  const link = mapsLink(p);
  if (!link) return null;
  const e = p.exact;
  // OpenStreetMap embebido: sin clave de API. Solo con ubicación exacta autorizada.
  const osm = e
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${e.lng - 0.006}%2C${e.lat - 0.004}%2C${e.lng + 0.006}%2C${e.lat + 0.004}&layer=mapnik&marker=${e.lat}%2C${e.lng}`
    : null;
  return (
    <section aria-labelledby="loc-h" className="mt-8">
      <h2 id="loc-h" className="text-lg" style={{ fontWeight: 800 }}>
        Ubicación
      </h2>
      <p className="mt-1 text-sm" style={{ color: SOFT }}>
        {e ? "Ubicación exacta." : `Zona: ${p.area}. La dirección exacta se comparte al coordinar la visita.`}
      </p>
      {osm && (
        <iframe title={`Mapa de ${p.title}`} src={osm} loading="lazy" className="mt-3 w-full h-64 rounded-2xl border" style={{ borderColor: "#EDE9FE" }} />
      )}
      <a href={link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 min-h-11 px-4 rounded-xl border bg-white" style={{ borderColor: "var(--brand-border, #DDD6FE)", color: "var(--brand-accent, #5B21B6)", fontWeight: 700 }}>
        <MapPinIcon size={16} color="#5B21B6" /> {e ? "Abrir en Google Maps" : "Ver la zona en Google Maps"}
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </section>
  );
}
