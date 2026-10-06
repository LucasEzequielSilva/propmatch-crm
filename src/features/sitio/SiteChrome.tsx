import type { CSSProperties, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MailIcon, WhatsAppIcon } from "@/components/ui/icons";
import { whatsappDigits, type PublicAgency } from "../../../shared/publicSite";
import { brandCssVars, resolveBrand } from "../../../shared/brand";
import { toDomainPath } from "./customDomain";

export const INK = "#1F0A3C";
export const SOFT = "#6B5A8E";

/** `?embed=1`: insertada en otro sitio con un iframe, sin encabezado ni pie. */
export function useEmbed(): boolean {
  const [params] = useSearchParams();
  return params.get("embed") === "1";
}

/** Conserva `?embed=1` en los links internos. */
export function useSiteHref() {
  const embed = useEmbed();
  return (path: string) => {
    const p = toDomainPath(path);
    return embed ? `${p}?embed=1` : p;
  };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "PM";

export function contactLinks(agency: PublicAgency, text: string) {
  const wa = whatsappDigits(agency.whatsapp);
  return {
    whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null,
    email: agency.email ? `mailto:${agency.email}?subject=${encodeURIComponent(text.split("\n")[0].slice(0, 120))}&body=${encodeURIComponent(text)}` : null,
  };
}

export function ContactButtons({ agency, text, compact }: { agency: PublicAgency; text: string; compact?: boolean }) {
  const c = contactLinks(agency, text);
  if (!c.whatsapp && !c.email) return null;
  const size = compact ? "min-h-11 px-4 text-sm" : "min-h-12 px-5 text-base";
  return (
    <div className="flex flex-wrap gap-2">
      {c.whatsapp && (
        <a
          href={c.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={`${size} inline-flex items-center gap-2 rounded-xl text-white hover:opacity-90`}
          style={{ background: "#15803D", fontWeight: 700 }}
        >
          <WhatsAppIcon size={18} color="white" /> Consultar por WhatsApp
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      )}
      {c.email && (
        <a
          href={c.email}
          className={`${size} inline-flex items-center gap-2 rounded-xl border bg-white hover:bg-violet-50`}
          style={{ borderColor: "var(--brand-border, #DDD6FE)", color: "var(--brand-accent, #5B21B6)", fontWeight: 700 }}
        >
          <MailIcon size={18} color="currentColor" /> Escribir un mail
        </a>
      )}
    </div>
  );
}

export function SiteShell({ agency, preview, children }: { agency: PublicAgency | null; preview?: boolean; children: ReactNode }) {
  const embed = useEmbed();
  const href = useSiteHref();
  const brand = agency ? resolveBrand(agency.brand, { name: agency.name, phone: agency.whatsapp, email: agency.email }) : null;
  const web = brand?.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className="min-h-dvh flex flex-col" style={{ ...((brand ? brandCssVars(brand) : {}) as CSSProperties), background: "#FDFCFF", color: INK }}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white">
        Saltar al contenido
      </a>
      {preview && (
        <p role="note" className="px-4 py-2 text-sm text-center" style={{ background: "#FEF3C7", color: "#92400E" }}>
          Vista previa con los datos de este navegador. Lo marcado «No se publica» (ejemplos o sin sincronizar) no aparece en tu web real.
        </p>
      )}
      {!embed && agency && (
        <header className="border-b bg-white" style={{ borderColor: "#EDE9FE" }}>
          <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-3">
            <Link to={href(`/sitio/${agency.slug}`)} className="flex items-center gap-3 min-w-0 min-h-11">
              {brand?.logoUrl ? (
                <img src={brand.logoUrl} alt="" className="h-10 max-w-[160px] object-contain flex-shrink-0" />
              ) : (
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                  style={{ background: "var(--brand-gradient, var(--gradient-brand))", color: "var(--brand-on-primary, #FFFFFF)", fontWeight: 800 }}
                  aria-hidden="true"
                >
                  {initials(agency.name)}
                </span>
              )}
              <span className="truncate text-base md:text-lg" style={{ fontWeight: 800 }}>
                {agency.name}
              </span>
            </Link>
            <div className="ml-auto hidden sm:block">
              <ContactButtons agency={agency} text={`Hola ${agency.name}, quería hacer una consulta.`} compact />
            </div>
          </div>
        </header>
      )}
      <main id="contenido" className="flex-1">
        {children}
      </main>
      {!embed && agency && (
        <footer className="border-t mt-12" style={{ borderColor: "#EDE9FE", background: "white" }}>
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between text-sm" style={{ color: SOFT }}>
            <div className="grid gap-0.5">
              <p style={{ color: INK, fontWeight: 700 }}>
                © {new Date().getFullYear()} {agency.name}
              </p>
              {brand?.address && <p>{brand.address}</p>}
              {brand?.license && <p>Matrícula {brand.license}</p>}
              {(web || brand?.instagram || brand?.facebook) && (
                <p className="flex flex-wrap gap-x-3">
                  {web && brand?.website && (
                    <a href={brand.website} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--brand-accent, #5B21B6)" }}>
                      {web}
                    </a>
                  )}
                  {brand?.instagram && (
                    <a href={`https://instagram.com/${brand.instagram}`} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--brand-accent, #5B21B6)" }}>
                      Instagram
                    </a>
                  )}
                  {brand?.facebook && (
                    <a href={`https://facebook.com/${brand.facebook}`} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--brand-accent, #5B21B6)" }}>
                      Facebook
                    </a>
                  )}
                </p>
              )}
              {brand?.footer && <p className="whitespace-pre-line max-w-xl">{brand.footer}</p>}
            </div>
            {brand?.showPoweredBy !== false && (
              <p className="text-xs">
                Hecho con <span style={{ fontWeight: 700 }}>PropMatch</span>
              </p>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

export function SiteMessage({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center">
      <h1 className="text-2xl" style={{ fontWeight: 800 }}>
        {title}
      </h1>
      <p className="mt-2" style={{ color: SOFT }}>
        {text}
      </p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
