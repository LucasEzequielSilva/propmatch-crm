import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { WhatsAppIcon } from "@/components/ui/icons";
import { decodeListing, type SharedListing } from "@/lib/share";
import { whatsappLink } from "@/lib/whatsapp";
import { fetchPublishedBrand } from "@/lib/branding";
import { PhotoLogoOverlay } from "@/features/branding/PhotoLogoOverlay";
import { OPERATION_LABEL, PROPERTY_TYPE_LABEL, money } from "@/lib/format";
import { brandCssVars, resolveBrand, type AgencyBrand } from "../../../shared/brand";

const INK = "#1F0A3C";
const SOFT = "#5B4B7A";

/**
 * Ficha pública que recibe el cliente por WhatsApp.
 *
 * Pensada para celular primero: se abre desde un chat, casi nunca desde una
 * compu. No necesita sesión ni backend: todo viene en el `#` del link. Va con
 * la marca de la inmobiliaria (logo, colores, contacto): la que viajó en el
 * link y, si la agencia es real, la publicada más nueva. «Descargar PDF» usa
 * la impresión del navegador con una hoja de estilos A4 propia.
 */
export default function FichaPage() {
  const [listing, setListing] = useState<SharedListing | null | "loading">("loading");
  const [published, setPublished] = useState<AgencyBrand | null>(null);
  const [photo, setPhoto] = useState(0);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) return setListing(null);
    decodeListing(token).then(setListing);
  }, []);

  useEffect(() => {
    if (!listing || listing === "loading" || !listing.ag) return;
    let alive = true;
    fetchPublishedBrand(listing.ag).then((b) => alive && b && setPublished(b));
    return () => {
      alive = false;
    };
  }, [listing]);

  const brand = useMemo(() => {
    if (!listing || listing === "loading") return null;
    // La publicada gana si es más nueva que la que viajó en el link.
    const inLink = listing.brand ?? null;
    const b = published && (!inLink?.updatedAt || (published.updatedAt ?? "") >= inLink.updatedAt) ? published : inLink;
    return resolveBrand(b, { name: listing.agency.name, phone: listing.agency.phone, email: listing.agency.email });
  }, [listing, published]);

  useEffect(() => {
    if (listing && listing !== "loading" && brand) document.title = `${listing.title} · ${brand.name}`;
  }, [listing, brand]);

  if (listing === "loading") {
    return <div className="min-h-full flex items-center justify-center text-sm" style={{ color: "#7458C4" }}>Cargando ficha…</div>;
  }

  if (!listing || !brand) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 text-center" style={{ background: "#FDFCFF" }}>
        <div>
          <p className="text-lg" style={{ color: INK, fontWeight: 800 }}>
            No pudimos abrir esta ficha
          </p>
          <p className="text-sm mt-2" style={{ color: "#7C6A99" }}>
            El link llegó incompleto. Pedile a quien te lo mandó que te lo reenvíe.
          </p>
        </div>
      </div>
    );
  }

  const l = listing;
  const contactPhone = l.agent?.phone ?? brand.whatsapp;
  const where = [l.street, l.zone ?? l.locality, l.province].filter(Boolean).join(", ");
  const facts = [
    l.surface_total ? { label: "Sup. total", value: `${l.surface_total} m²` } : null,
    l.surface_covered ? { label: "Sup. cubierta", value: `${l.surface_covered} m²` } : null,
    l.rooms ? { label: "Ambientes", value: String(l.rooms) } : null,
    l.bedrooms ? { label: "Dormitorios", value: String(l.bedrooms) } : null,
    l.bathrooms ? { label: "Baños", value: String(l.bathrooms) } : null,
    l.garages ? { label: "Cocheras", value: String(l.garages) } : null,
    l.age_years !== null ? { label: "Antigüedad", value: l.age_years === 0 ? "A estrenar" : `${l.age_years} años` } : null,
  ].filter((f): f is { label: string; value: string } => !!f);

  const message = `Hola! Vi la ficha de "${l.title}" y me gustaría tener más información.`;
  const link = window.location.href;
  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 3000);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      flash("Link copiado");
    } catch {
      flash("No pudimos copiar: copiá el link de la barra del navegador");
    }
  };
  const shareWa = `https://wa.me/?text=${encodeURIComponent(`${l.title}\n${link}`)}`;
  const web = brand.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="ficha-root min-h-full overflow-y-auto" style={{ ...(brandCssVars(brand) as CSSProperties), background: "#FDFCFF" }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 14mm 16mm; }
          html, body, #root { height: auto !important; overflow: visible !important; background: white !important; }
          .ficha-root { background: white !important; overflow: visible !important; }
          .ficha-wrap { max-width: none !important; padding-bottom: 0 !important; }
          .ficha-hero { aspect-ratio: auto !important; height: 88mm !important; border-radius: 6px !important; }
          .ficha-print-photos { display: grid !important; }
          .ficha-facts { grid-template-columns: repeat(4, 1fr) !important; }
          .ficha-section, .ficha-contact, .ficha-facts > div { break-inside: avoid; }
          h1, h2 { break-after: avoid; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="ficha-wrap max-w-3xl mx-auto pb-28 sm:pb-12">
        {/* Marca */}
        <header className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b print:px-0" style={{ borderColor: brand.border }}>
          <div className="flex items-center gap-3 min-w-0">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="h-10 max-w-[160px] object-contain" />
            ) : (
              <span className="w-10 h-10 rounded-xl flex items-center justify-center text-sm flex-shrink-0" style={{ background: brand.gradient, color: brand.onPrimary, fontWeight: 800 }} aria-hidden="true">
                {brand.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm truncate" style={{ color: INK, fontWeight: 800 }}>
                {brand.name}
              </p>
              {brand.license && <p className="text-xs truncate" style={{ color: SOFT }}>Matrícula {brand.license}</p>}
            </div>
          </div>
          <p className="hidden print:block text-xs text-right" style={{ color: SOFT }}>
            {[brand.phone, brand.email].filter(Boolean).join(" · ")}
          </p>
        </header>

        {/* Acciones (no se imprimen) */}
        <div className="print:hidden px-4 sm:px-6 pt-3 flex flex-wrap gap-2">
          <button
            onClick={() => window.print()}
            className="min-h-10 px-4 rounded-xl text-sm"
            style={{ background: "var(--brand-primary)", color: "var(--brand-on-primary)", fontWeight: 700 }}
          >
            Descargar PDF
          </button>
          <button onClick={copyLink} className="min-h-10 px-4 rounded-xl text-sm border bg-white" style={{ borderColor: "var(--brand-border)", color: "var(--brand-accent)", fontWeight: 700 }}>
            Copiar link
          </button>
          <a
            href={shareWa}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-10 px-4 rounded-xl text-sm border bg-white inline-flex items-center gap-2"
            style={{ borderColor: "var(--brand-border)", color: "var(--brand-accent)", fontWeight: 700 }}
          >
            <WhatsAppIcon size={15} color="currentColor" /> Mandar por WhatsApp
          </a>
          <span role="status" aria-live="polite" className="text-xs self-center" style={{ color: "#15803D", fontWeight: 600 }}>
            {msg}
          </span>
        </div>

        {/* Galería */}
        {l.photos.length > 0 ? (
          <div className="sm:px-6 mt-4 print:px-0">
            <div className="ficha-hero relative sm:rounded-2xl overflow-hidden" style={{ background: brand.soft, aspectRatio: "16 / 10" }}>
              <img src={l.photos[photo]} alt={l.title} className="w-full h-full object-cover" />
              {l.photos.length > 1 && (
                <span
                  className="absolute bottom-3 right-3 text-xs px-2.5 py-1 rounded-full text-white print:hidden"
                  style={{ background: "rgba(31,10,60,0.6)", fontWeight: 600 }}
                >
                  {photo + 1} / {l.photos.length}
                </span>
              )}
              {/* Logo sobre la foto: solo visual, también en el PDF. Esquiva el contador. */}
              <PhotoLogoOverlay logo={brand.photoLogo} context="hero" avoid={l.photos.length > 1 ? ["bottom-right"] : []} />
            </div>
            {l.photos.length > 1 && (
              <div className="px-4 sm:px-0 mt-2 flex gap-2 overflow-x-auto print:hidden">
                {l.photos.map((url, i) => (
                  <button
                    key={url}
                    onClick={() => setPhoto(i)}
                    className="rounded-lg overflow-hidden flex-shrink-0"
                    style={{ width: 72, height: 50, outline: i === photo ? `2px solid ${brand.primary}` : `1px solid ${brand.border}` }}
                    aria-label={`Foto ${i + 1}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <main className="px-4 sm:px-6 mt-5 print:px-0">
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: brand.soft, color: brand.accent, fontWeight: 700 }}>
              {OPERATION_LABEL[l.operation]}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: brand.border, color: brand.accent2, fontWeight: 700 }}>
              {PROPERTY_TYPE_LABEL[l.type]}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl tracking-tight mt-3" style={{ color: INK, fontWeight: 800, lineHeight: 1.15 }}>
            {l.title}
          </h1>
          {where && (
            <p className="text-sm mt-1.5" style={{ color: SOFT }}>
              📍 {where}
            </p>
          )}

          <p className="text-3xl mt-4" style={{ fontWeight: 800, color: brand.accent }}>
            {l.price ? money(l.price, l.currency) : "Consultar precio"}
          </p>
          {l.expenses ? (
            <p className="text-sm mt-0.5" style={{ color: SOFT }}>
              + ARS {l.expenses.toLocaleString("es-AR")} de expensas
            </p>
          ) : null}

          {facts.length > 0 && (
            <div className="ficha-facts mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {facts.map((f) => (
                <div key={f.label} className="rounded-xl border px-3.5 py-3" style={{ borderColor: brand.border, background: "white" }}>
                  <p className="text-xs" style={{ color: SOFT, fontWeight: 600 }}>
                    {f.label}
                  </p>
                  <p className="text-base mt-0.5" style={{ color: INK, fontWeight: 700 }}>
                    {f.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {l.description && (
            <section className="ficha-section mt-7">
              <h2 className="text-sm uppercase" style={{ color: brand.accent, fontWeight: 700, letterSpacing: "0.08em" }}>
                Descripción
              </h2>
              <p className="text-base mt-2 whitespace-pre-line" style={{ color: "#3B2A55", lineHeight: 1.6 }}>
                {l.description}
              </p>
            </section>
          )}

          {l.features.length > 0 && (
            <section className="ficha-section mt-7">
              <h2 className="text-sm uppercase" style={{ color: brand.accent, fontWeight: 700, letterSpacing: "0.08em" }}>
                Características
              </h2>
              <div className="flex flex-wrap gap-2 mt-2.5">
                {l.features.map((f) => (
                  <span key={f} className="text-sm px-3 py-1.5 rounded-full border" style={{ borderColor: brand.border, color: "#3B2A55", background: "white" }}>
                    ✓ {f}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* En el PDF: el resto de las fotos en grilla */}
          {l.photos.length > 1 && (
            <section className="ficha-print-photos hidden mt-7 gap-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} aria-hidden="true">
              {l.photos.slice(1, 7).map((url) => (
                <div key={url} style={{ position: "relative", borderRadius: 4, overflow: "hidden", breakInside: "avoid" }}>
                  <img src={url} alt="" style={{ display: "block", width: "100%", height: "42mm", objectFit: "cover" }} />
                  <PhotoLogoOverlay logo={brand.photoLogo} />
                </div>
              ))}
            </section>
          )}

          <section className="ficha-contact mt-8 rounded-2xl p-5" style={{ background: brand.soft, border: `1px solid ${brand.border}` }}>
            <p className="text-xs uppercase" style={{ color: brand.accent, fontWeight: 700, letterSpacing: "0.08em" }}>
              Te atiende
            </p>
            <p className="text-lg mt-1" style={{ color: INK, fontWeight: 800 }}>
              {l.agent?.name ?? brand.name}
            </p>
            <p className="text-sm" style={{ color: SOFT }}>
              {l.agent ? brand.name : null}
              {contactPhone ? `${l.agent ? " · " : ""}${contactPhone}` : null}
              {brand.email ? ` · ${brand.email}` : null}
            </p>
            {(brand.address || web || brand.instagram) && (
              <p className="text-sm mt-1" style={{ color: SOFT }}>
                {[brand.address, web, brand.instagram ? `@${brand.instagram}` : null].filter(Boolean).join(" · ")}
              </p>
            )}
            {contactPhone && (
              <a
                href={whatsappLink(contactPhone, message)}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex print:hidden mt-4 items-center gap-2 px-5 py-3 rounded-xl text-[#063B2A]"
                style={{ background: "#25D366", fontWeight: 700 }}
              >
                <WhatsAppIcon size={18} color="#063B2A" />
                Consultar por WhatsApp
              </a>
            )}
          </section>

          <footer className="mt-6 text-xs text-center" style={{ color: SOFT }}>
            {brand.footer && <p className="whitespace-pre-line">{brand.footer}</p>}
            {brand.showPoweredBy && <p className="mt-1" style={{ fontSize: 10, opacity: 0.8 }}>Hecho con PropMatch</p>}
          </footer>
        </main>
      </div>

      {/* En celular el botón queda siempre a mano */}
      {contactPhone && (
        <div className="sm:hidden print:hidden fixed bottom-0 inset-x-0 p-3" style={{ background: "linear-gradient(transparent, #FDFCFF 30%)" }}>
          <a
            href={whatsappLink(contactPhone, message)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-[#063B2A]"
            style={{ background: "#25D366", fontWeight: 700, boxShadow: "0 8px 24px rgba(37,211,102,0.35)" }}
          >
            <WhatsAppIcon size={18} color="#063B2A" />
            Consultar por WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
