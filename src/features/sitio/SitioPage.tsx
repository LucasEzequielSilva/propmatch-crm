import { useMemo, type ReactNode } from "react";
import { customDomainSlug } from "./customDomain";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { HomeIcon, MapPinIcon } from "@/components/ui/icons";
import {
  EMPTY_FILTERS,
  filterProperties,
  formatUsd,
  OPERATION_LABEL,
  TYPE_LABEL,
  type PublicOperation,
  type PublicProperty,
  type PublicPropertyType,
  type SiteFilters,
} from "../../../shared/publicSite";
import { useSiteData } from "./useSiteData";
import { useDocumentMeta } from "./useDocumentMeta";
import { INK, SiteMessage, SiteShell, SOFT, useSiteHref } from "./SiteChrome";

const num = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Los filtros viven en la URL: se pueden compartir y el botón atrás los respeta. */
function useFiltersInUrl(): [SiteFilters, (f: SiteFilters) => void] {
  const [params, setParams] = useSearchParams();
  const f: SiteFilters = {
    operation: (params.get("op") as PublicOperation) || "",
    type: (params.get("tipo") as PublicPropertyType) || "",
    area: params.get("zona") ?? "",
    priceMin: num(params.get("desde")),
    priceMax: num(params.get("hasta")),
    rooms: num(params.get("amb")),
  };
  const set = (n: SiteFilters) => {
    const p = new URLSearchParams();
    if (params.get("embed") === "1") p.set("embed", "1");
    if (n.operation) p.set("op", n.operation);
    if (n.type) p.set("tipo", n.type);
    if (n.area.trim()) p.set("zona", n.area);
    if (n.priceMin != null) p.set("desde", String(n.priceMin));
    if (n.priceMax != null) p.set("hasta", String(n.priceMax));
    if (n.rooms != null) p.set("amb", String(n.rooms));
    setParams(p, { replace: true });
  };
  return [f, set];
}

export default function SitioPage() {
  const { slug: routeSlug = "" } = useParams<{ slug: string }>();
  const slug = routeSlug || customDomainSlug() || "";
  const state = useSiteData(slug);
  const [filters, setFilters] = useFiltersInUrl();
  const site = state.kind === "ok" ? state.site : null;

  const list = useMemo(() => (site ? filterProperties(site.properties, filters) : []), [site, filters]);
  const ops = useMemo(() => [...new Set(site?.properties.map((p) => p.operation) ?? [])], [site]);
  const types = useMemo(() => [...new Set(site?.properties.map((p) => p.type) ?? [])], [site]);

  useDocumentMeta({
    title: site ? `${site.agency.name} · Propiedades` : "Propiedades",
    description: site
      ? `${site.properties.length} ${site.properties.length === 1 ? "propiedad disponible" : "propiedades disponibles"} de ${site.agency.name}.`
      : "Propiedades en venta y alquiler.",
    image: site?.properties.find((p) => p.photos[0])?.photos[0] ?? null,
    noindex: state.kind !== "ok" || state.preview,
  });

  if (state.kind === "loading") return <SiteShell agency={null}><LoadingGrid /></SiteShell>;
  if (state.kind === "needs_session")
    return (
      <SiteShell agency={null}>
        <SiteMessage title="Vista previa de tu web" text="Entrá a PropMatch en este navegador para ver cómo queda tu web con tus propiedades." action={<Link to="/login" className="underline" style={{ color: "var(--brand-accent, #5B21B6)" }}>Ir a iniciar sesión</Link>} />
      </SiteShell>
    );
  if (state.kind === "not_found")
    return (
      <SiteShell agency={null}>
        <SiteMessage title="No encontramos esta inmobiliaria" text="Revisá el link: puede que haya cambiado." />
      </SiteShell>
    );
  if (state.kind === "error" || !site)
    return (
      <SiteShell agency={null}>
        <SiteMessage title="No pudimos cargar las propiedades" text="Probá de nuevo en unos minutos." />
      </SiteShell>
    );

  const total = site.properties.length;
  const filtered = list.length !== total;

  return (
    <SiteShell agency={site.agency} preview={state.preview}>
      <section className="border-b" style={{ background: "linear-gradient(135deg, #F5F3FF, #FDE7F5)", borderColor: "#EDE9FE" }}>
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
          <h1 className="text-2xl md:text-4xl tracking-tight" style={{ fontWeight: 800 }}>
            Propiedades de {site.agency.name}
          </h1>
          <p className="mt-2 text-sm md:text-base" style={{ color: SOFT }}>
            {total === 0 ? "Pronto vas a encontrar acá nuestras propiedades disponibles." : `${total} ${total === 1 ? "propiedad disponible" : "propiedades disponibles"}. Escribinos y coordinamos una visita.`}
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 md:px-8">
        {total > 0 && <FilterBar value={filters} onChange={setFilters} ops={ops} types={types} />}

        <p role="status" aria-live="polite" className="mt-4 text-sm" style={{ color: SOFT }}>
          {filtered ? `${list.length} de ${total} propiedades con esos filtros.` : ""}
        </p>

        {total > 0 && list.length === 0 ? (
          <SiteMessage
            title="No hay propiedades con esos filtros"
            text="Probá ampliando la búsqueda."
            action={
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="min-h-11 px-5 rounded-xl border" style={{ borderColor: "var(--brand-border, #DDD6FE)", color: "var(--brand-accent, #5B21B6)", fontWeight: 700 }}>
                Ver todas
              </button>
            }
          />
        ) : (
          <ul className="mt-4 grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p, i) => (
              <li key={p.id}>
                <PropertyCard p={p} slug={site.agency.slug} eager={i < 3} notPublished={state.notPublished.has(p.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </SiteShell>
  );
}

function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-xs" style={{ color: "#7458C4", fontWeight: 700 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const control = "w-full min-h-11 px-3 rounded-xl border bg-white text-sm";
const controlStyle = { borderColor: "var(--brand-border, #DDD6FE)", color: INK };

function FilterBar({ value, onChange, ops, types }: { value: SiteFilters; onChange: (f: SiteFilters) => void; ops: PublicOperation[]; types: PublicPropertyType[] }) {
  const set = (part: Partial<SiteFilters>) => onChange({ ...value, ...part });
  const active = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <form role="search" aria-label="Buscar propiedades" onSubmit={(e) => e.preventDefault()} className="mt-6 rounded-2xl border bg-white p-4 grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 items-end" style={{ borderColor: "#EDE9FE", boxShadow: "var(--shadow-card)" }}>
      <Field label="Operación" htmlFor="f-op">
        <select id="f-op" value={value.operation} onChange={(e) => set({ operation: e.target.value as PublicOperation | "" })} className={control} style={controlStyle}>
          <option value="">Todas</option>
          {ops.map((o) => (
            <option key={o} value={o}>{OPERATION_LABEL[o]}</option>
          ))}
        </select>
      </Field>
      <Field label="Tipo" htmlFor="f-tipo">
        <select id="f-tipo" value={value.type} onChange={(e) => set({ type: e.target.value as PublicPropertyType | "" })} className={control} style={controlStyle}>
          <option value="">Todos</option>
          {types.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
      </Field>
      <Field label="Zona o barrio" htmlFor="f-zona">
        <input id="f-zona" type="search" value={value.area} onChange={(e) => set({ area: e.target.value })} placeholder="Ej.: Palermo" className={control} style={controlStyle} />
      </Field>
      <Field label="Precio desde (USD)" htmlFor="f-desde">
        <input id="f-desde" inputMode="numeric" value={value.priceMin ?? ""} onChange={(e) => set({ priceMin: num(e.target.value) })} placeholder="Mín." className={control} style={controlStyle} />
      </Field>
      <Field label="Precio hasta (USD)" htmlFor="f-hasta">
        <input id="f-hasta" inputMode="numeric" value={value.priceMax ?? ""} onChange={(e) => set({ priceMax: num(e.target.value) })} placeholder="Máx." className={control} style={controlStyle} />
      </Field>
      <Field label="Ambientes" htmlFor="f-amb">
        <select id="f-amb" value={value.rooms ?? ""} onChange={(e) => set({ rooms: num(e.target.value) })} className={control} style={controlStyle}>
          <option value="">Cualquiera</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n === 5 ? "5 o más" : `${n} o más`}</option>
          ))}
        </select>
      </Field>
      {active && (
        <div className="col-span-2 md:col-span-3 lg:col-span-6">
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="min-h-11 px-4 rounded-xl text-sm underline" style={{ color: "var(--brand-accent, #5B21B6)", fontWeight: 700 }}>
            Limpiar filtros
          </button>
        </div>
      )}
    </form>
  );
}

function PropertyCard({ p, slug, eager, notPublished }: { p: PublicProperty; slug: string; eager: boolean; notPublished: boolean }) {
  const href = useSiteHref();
  return (
    <Link
      to={href(`/sitio/${slug}/p/${p.id}`)}
      className="group block rounded-2xl border bg-white overflow-hidden h-full transition-shadow hover:shadow-lg focus-visible:shadow-lg"
      style={{ borderColor: "#EDE9FE", boxShadow: "var(--shadow-card)" }}
    >
      <div className="relative aspect-[4/3]" style={{ background: "var(--brand-soft, #F5F3FF)" }}>
        {p.photos[0] ? (
          <img src={p.photos[0]} alt="" loading={eager ? "eager" : "lazy"} decoding="async" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <HomeIcon size={32} color="#C4B5FD" />
          </div>
        )}
        <span className="absolute top-3 left-3 text-xs px-2.5 py-1 rounded-full bg-white" style={{ color: "var(--brand-accent, #5B21B6)", fontWeight: 800 }}>
          {OPERATION_LABEL[p.operation]}
        </span>
        {notPublished && (
          <span className="absolute top-3 right-3 text-xs px-2.5 py-1 rounded-full" style={{ background: "#FEF3C7", color: "#92400E", fontWeight: 800 }}>
            No se publica
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="text-lg" style={{ fontWeight: 800 }}>
          {formatUsd(p.price, p.pricePeriod)}
        </p>
        <h2 className="text-sm mt-1 line-clamp-2 group-hover:underline" style={{ fontWeight: 700 }}>
          {p.title}
        </h2>
        <p className="text-sm mt-2 flex items-center gap-1" style={{ color: SOFT }}>
          <MapPinIcon size={14} color="#7458C4" />
          <span className="truncate">{[TYPE_LABEL[p.type], p.area].filter(Boolean).join(" · ")}</span>
        </p>
        {p.rooms != null && (
          <p className="text-sm mt-1" style={{ color: SOFT }}>
            {p.rooms} {p.rooms === 1 ? "ambiente" : "ambientes"}
          </p>
        )}
      </div>
    </Link>
  );
}

function LoadingGrid() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-10" aria-busy="true" aria-label="Cargando propiedades">
      <div className="h-9 w-2/3 rounded-lg animate-pulse motion-reduce:animate-none" style={{ background: "var(--brand-soft, #F5F3FF)" }} />
      <ul className="mt-8 grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rounded-2xl overflow-hidden border" style={{ borderColor: "#EDE9FE" }}>
            <div className="aspect-[4/3] animate-pulse motion-reduce:animate-none" style={{ background: "var(--brand-soft, #F5F3FF)" }} />
            <div className="p-4 space-y-2">
              <div className="h-5 w-1/2 rounded animate-pulse motion-reduce:animate-none" style={{ background: "var(--brand-soft, #F5F3FF)" }} />
              <div className="h-4 w-3/4 rounded animate-pulse motion-reduce:animate-none" style={{ background: "var(--brand-soft, #F5F3FF)" }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
