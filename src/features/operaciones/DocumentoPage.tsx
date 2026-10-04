import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "@/data/store";
import { DOCUMENT_LABEL, buildDocument, type DocumentKind } from "@/lib/deals";

const KINDS = Object.keys(DOCUMENT_LABEL) as DocumentKind[];

/**
 * Documento listo para imprimir (o guardar como PDF desde el diálogo de
 * impresión). El texto es editable en pantalla para ajustar cláusulas antes
 * de imprimir; esos cambios no se guardan, la fuente es la operación.
 */
export default function DocumentoPage() {
  const { dealId, kind } = useParams();
  const { deals, propertyById, agency, profile } = useStore();
  const deal = deals.find((d) => d.id === dealId);
  const docKind = KINDS.find((k) => k === kind);

  const blocks = useMemo(() => {
    if (!deal || !docKind) return null;
    return buildDocument(docKind, {
      deal,
      property: propertyById(deal.property_id),
      agencyName: agency.name,
      agencyCity: agency.city ?? "",
      agentName: profile.full_name,
    });
  }, [deal, docKind, propertyById, agency, profile]);

  if (!deal || !docKind || !blocks) {
    return (
      <div className="p-8 text-sm">
        No se encontró el documento. <Link to="/operaciones" style={{ color: "#7C3AED" }}>Volver a Operaciones</Link>
      </div>
    );
  }

  return (
    <div className="doc-root" style={{ background: "#F3F0FF", height: "100vh", overflowY: "auto" }}>
      <style>{`
        @media print {
          .doc-toolbar { display: none !important; }
          .doc-root { background: white !important; }
          .doc-paper { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: none !important; }
          html, body, #root { height: auto !important; overflow: visible !important; }
          @page { margin: 22mm 20mm; }
        }
      `}</style>

      <div className="doc-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ background: "white", borderColor: "#EDE9FE" }}>
        <Link to={`/operaciones/${deal.id}`} className="text-sm" style={{ color: "#7C3AED", fontWeight: 600 }}>
          ← Volver a la operación
        </Link>
        <p className="text-xs hidden sm:block" style={{ color: "#7458C4" }}>
          Podés editar el texto antes de imprimir.
        </p>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-xl text-sm text-white"
          style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
        >
          Imprimir / Guardar PDF
        </button>
      </div>

      <div
        className="doc-paper mx-auto my-6 bg-white"
        style={{
          maxWidth: 800,
          padding: "48px 56px",
          boxShadow: "0 4px 24px rgba(59,7,100,0.10)",
          color: "#111",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 14,
          lineHeight: 1.65,
          textAlign: "justify",
        }}
        contentEditable
        suppressContentEditableWarning
      >
        {blocks.map((b, i) => {
          if (b.t === "title") {
            return (
              <h1 key={i} style={{ textAlign: "center", fontSize: 20, fontWeight: 700, margin: "0 0 24px", letterSpacing: "0.04em" }}>
                {b.text}
              </h1>
            );
          }
          if (b.t === "sign") {
            return (
              <div key={i} style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "space-around", marginTop: 72, textAlign: "center" }}>
                {b.text.split("||").map((s, j) => {
                  const [name, role] = s.split("|");
                  return (
                    <div key={j} style={{ minWidth: 180, flex: 1 }}>
                      <div style={{ borderTop: "1px solid #111", paddingTop: 6 }}>
                        <div style={{ fontWeight: 700 }}>{name}</div>
                        <div style={{ fontSize: 12 }}>{role}</div>
                        <div style={{ fontSize: 11, marginTop: 4 }}>DNI: ____________</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          if (b.t === "p" && i === blocks.length - 1) {
            return (
              <p key={i} style={{ marginTop: 48, fontSize: 11, color: "#6B7280", textAlign: "center", fontStyle: "italic" }}>
                {b.text}
              </p>
            );
          }
          const m = b.t === "clause" ? b.text.match(/^([A-ZÁÉÍÓÚÑ0-9 –.-]+?\.)\s([\s\S]*)$/) : null;
          return (
            <p key={i} style={{ margin: "0 0 12px" }}>
              {m ? (
                <>
                  <strong>{m[1]}</strong> {m[2]}
                </>
              ) : (
                b.text
              )}
            </p>
          );
        })}
      </div>
    </div>
  );
}
