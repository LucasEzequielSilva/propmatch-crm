import { useEffect, useState } from "react";
import { WhatsAppIcon } from "@/components/ui/icons";
import { decodeListing, type SharedListing } from "@/lib/share";
import { whatsappLink } from "@/lib/whatsapp";
import { OPERATION_LABEL, PROPERTY_TYPE_LABEL, money } from "@/lib/format";

/**
 * Ficha pública que recibe el cliente por WhatsApp.
 *
 * Pensada para celular primero: se abre desde un chat, casi nunca desde una
 * compu. No necesita sesión ni backend: todo viene en el `#` del link. También
 * se imprime prolija (Imprimir → Guardar como PDF) para quien la pide así.
 */
export default function FichaPage() {
  const [listing, setListing] = useState<SharedListing | null | "loading">("loading");
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) return setListing(null);
    decodeListing(token).then(setListing);
  }, []);

  useEffect(() => {
    if (listing && listing !== "loading") document.title = `${listing.title} · ${listing.agency.name}`;
  }, [listing]);

  if (listing === "loading") {
    return <div className="min-h-full flex items-center justify-center text-sm" style={{ color: "#7458C4" }}>Cargando ficha…</div>;
  }

  if (!listing) {
    return (
      <div className="min-h-full flex items-center justify-center p-6 text-center" style={{ background: "#FDFCFF" }}>
        <div>
          <p className="text-lg" style={{ color: "#1F0A3C", fontWeight: 800 }}>
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
  const contactPhone = l.agent?.phone ?? l.agency.phone;
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

  return (
    <div className="min-h-full overflow-y-auto" style={{ background: "#FDFCFF" }}>
      <div className="max-w-3xl mx-auto pb-28 sm:pb-12">
        {/* Marca */}
        <header className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 800 }}>
            {l.agency.name}
          </p>
          <button
            onClick={() => window.print()}
            className="print:hidden text-xs px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600, background: "white" }}
          >
            Guardar PDF
          </button>
        </header>

        {/* Galería */}
        {l.photos.length > 0 ? (
          <div className="sm:px-6">
            <div className="relative sm:rounded-2xl overflow-hidden" style={{ background: "#F5F3FF", aspectRatio: "16 / 10" }}>
              <img src={l.photos[photo]} alt={l.title} className="w-full h-full object-cover" />
              {l.photos.length > 1 && (
                <span
                  className="absolute bottom-3 right-3 text-xs px-2.5 py-1 rounded-full text-white print:hidden"
                  style={{ background: "rgba(31,10,60,0.6)", fontWeight: 600 }}
                >
                  {photo + 1} / {l.photos.length}
                </span>
              )}
            </div>
            {l.photos.length > 1 && (
              <div className="px-4 sm:px-0 mt-2 flex gap-2 overflow-x-auto print:hidden">
                {l.photos.map((url, i) => (
                  <button
                    key={url}
                    onClick={() => setPhoto(i)}
                    className="rounded-lg overflow-hidden flex-shrink-0"
                    style={{ width: 72, height: 50, outline: i === photo ? "2px solid #7C3AED" : "1px solid #EDE9FE" }}
                    aria-label={`Foto ${i + 1}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <main className="px-4 sm:px-6 mt-5">
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 700 }}>
              {OPERATION_LABEL[l.operation]}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#FDF2F8", color: "#DB2777", fontWeight: 700 }}>
              {PROPERTY_TYPE_LABEL[l.type]}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl tracking-tight mt-3" style={{ color: "#1F0A3C", fontWeight: 800, lineHeight: 1.15 }}>
            {l.title}
          </h1>
          {where && (
            <p className="text-sm mt-1.5" style={{ color: "#7C6A99" }}>
              📍 {where}
            </p>
          )}

          <p className="text-3xl mt-4 text-gradient-brand-h" style={{ fontWeight: 800 }}>
            {l.price ? money(l.price, l.currency) : "Consultar precio"}
          </p>
          {l.expenses ? (
            <p className="text-sm mt-0.5" style={{ color: "#7C6A99" }}>
              + ARS {l.expenses.toLocaleString("es-AR")} de expensas
            </p>
          ) : null}

          {facts.length > 0 && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {facts.map((f) => (
                <div key={f.label} className="rounded-xl border px-3.5 py-3" style={{ borderColor: "#EDE9FE", background: "white" }}>
                  <p className="text-xs" style={{ color: "#7458C4", fontWeight: 600 }}>
                    {f.label}
                  </p>
                  <p className="text-base mt-0.5" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                    {f.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {l.description && (
            <section className="mt-7">
              <h2 className="text-sm uppercase" style={{ color: "#7C3AED", fontWeight: 700, letterSpacing: "0.08em" }}>
                Descripción
              </h2>
              <p className="text-base mt-2 whitespace-pre-line" style={{ color: "#3B2A55", lineHeight: 1.6 }}>
                {l.description}
              </p>
            </section>
          )}

          {l.features.length > 0 && (
            <section className="mt-7">
              <h2 className="text-sm uppercase" style={{ color: "#7C3AED", fontWeight: 700, letterSpacing: "0.08em" }}>
                Características
              </h2>
              <div className="flex flex-wrap gap-2 mt-2.5">
                {l.features.map((f) => (
                  <span key={f} className="text-sm px-3 py-1.5 rounded-full border" style={{ borderColor: "#EDE9FE", color: "#3B2A55", background: "white" }}>
                    ✓ {f}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="mt-8 rounded-2xl p-5" style={{ background: "var(--gradient-soft)" }}>
            <p className="text-xs uppercase" style={{ color: "#7C3AED", fontWeight: 700, letterSpacing: "0.08em" }}>
              Te atiende
            </p>
            <p className="text-lg mt-1" style={{ color: "#1F0A3C", fontWeight: 800 }}>
              {l.agent?.name ?? l.agency.name}
            </p>
            <p className="text-sm" style={{ color: "#7C6A99" }}>
              {l.agent ? l.agency.name : null}
              {contactPhone ? `${l.agent ? " · " : ""}${contactPhone}` : null}
              {l.agency.email ? ` · ${l.agency.email}` : null}
            </p>
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
