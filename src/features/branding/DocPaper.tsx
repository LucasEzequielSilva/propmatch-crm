import type { CSSProperties, ReactNode, Ref } from "react";
import { clauseHead, type DocBlock, type DocPart } from "@/lib/docTemplates";
import type { ResolvedBrand } from "../../../shared/brand";

/**
 * Hoja del documento (reserva, boleto, contrato). La usan DocumentoPage
 * (editable, para imprimir) y la vista previa de plantillas en Configuración.
 *
 * Cada variable va en un `<span data-var data-val>` y cada sección oculta en
 * un `<span data-raw hidden>`: así «Guardar como plantilla» puede volver del
 * texto completado a la plantilla (ver domToTemplate).
 */
export function DocPaper({
  blocks,
  brand,
  editable,
  paperRef,
  highlightVars,
  style,
}: {
  blocks: DocBlock[];
  /** Membrete con la marca de la inmobiliaria (null = sin membrete). */
  brand: ResolvedBrand | null;
  editable?: boolean;
  paperRef?: Ref<HTMLDivElement>;
  /** Resalta los valores que vienen de variables (vista previa de plantillas). */
  highlightVars?: boolean;
  style?: CSSProperties;
}) {
  const lastVisible = [...blocks].reverse().find((b) => !b.hidden);
  return (
    <div
      ref={paperRef}
      className="doc-paper mx-auto bg-white"
      style={{
        maxWidth: 800,
        padding: "48px 56px",
        boxShadow: "0 4px 24px rgba(59,7,100,0.10)",
        color: "#111",
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 14,
        lineHeight: 1.65,
        textAlign: "justify",
        ...style,
      }}
      contentEditable={editable}
      suppressContentEditableWarning
    >
      {brand && <Letterhead brand={brand} />}
      {blocks.map((b, i) => {
        if (b.hidden) {
          return (
            <div key={i} data-block="p" hidden>
              <Parts parts={b.parts} highlight={false} />
            </div>
          );
        }
        if (b.t === "title") {
          return (
            <h1 key={i} data-block="title" style={{ textAlign: "center", fontSize: 20, fontWeight: 700, margin: "0 0 24px", letterSpacing: "0.04em" }}>
              <Parts parts={b.parts} highlight={!!highlightVars} />
            </h1>
          );
        }
        if (b.t === "sign") {
          return (
            <div
              key={i}
              data-block="sign"
              contentEditable={false}
              className="doc-sign"
              style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "space-around", marginTop: 72, textAlign: "center" }}
            >
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
        if (b.t === "note") {
          return (
            <p
              key={i}
              data-block="note"
              style={{ marginTop: b === lastVisible ? 48 : 12, fontSize: 11, color: "#6B7280", textAlign: "center", fontStyle: "italic", whiteSpace: "pre-line" }}
            >
              <Parts parts={b.parts} highlight={!!highlightVars} />
            </p>
          );
        }
        return (
          <p key={i} data-block={b.t} style={{ margin: "0 0 12px", whiteSpace: "pre-line" }}>
            <Parts parts={b.parts} highlight={!!highlightVars} bold={b.t === "clause"} />
          </p>
        );
      })}
      {brand && (brand.footer || brand.showPoweredBy) && (
        <div data-block="letterhead" contentEditable={false} className="doc-foot" style={{ marginTop: 32, paddingTop: 10, borderTop: `1px solid ${brand.border}`, fontSize: 10.5, color: "#6B7280", textAlign: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
          {brand.footer && <p style={{ whiteSpace: "pre-line" }}>{brand.footer}</p>}
          {brand.showPoweredBy && <p style={{ fontSize: 9, marginTop: 2 }}>Hecho con PropMatch</p>}
        </div>
      )}
    </div>
  );
}

function Parts({ parts, highlight, bold }: { parts: DocPart[]; highlight: boolean; bold?: boolean }) {
  // Encabezado de cláusula ("PRIMERA – OBJETO.") en negrita: sale del primer texto visible.
  let headDone = !bold;
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (p.k === "mark" || p.k === "raw") {
      out.push(<span key={i} data-raw={p.raw} hidden />);
      return;
    }
    if (p.k === "var") {
      out.push(
        <span key={i} data-var={p.key} data-val={p.value} style={highlight ? { background: "#FEF3C7", borderRadius: 3 } : undefined}>
          {p.value}
        </span>,
      );
      if (p.value.trim()) headDone = true;
      return;
    }
    if (!headDone && p.text.trim()) {
      headDone = true;
      const lead = p.text.match(/^\s*/)?.[0] ?? "";
      const h = clauseHead(p.text.slice(lead.length));
      if (h) {
        out.push(
          <span key={i}>
            {lead}
            <strong>{h[0]}</strong> {h[1]}
          </span>,
        );
        return;
      }
    }
    out.push(<span key={i}>{p.text}</span>);
  });
  return <>{out}</>;
}

function Letterhead({ brand }: { brand: ResolvedBrand }) {
  const contact = [brand.address, brand.phone, brand.email, brand.website?.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean).join(" · ");
  return (
    <div
      data-block="letterhead"
      contentEditable={false}
      className="doc-letterhead"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        paddingBottom: 14,
        marginBottom: 28,
        borderBottom: `2px solid ${brand.primary}`,
        fontFamily: "Inter, system-ui, sans-serif",
        textAlign: "left",
      }}
    >
      {brand.logoUrl && <img src={brand.logoUrl} alt="" style={{ height: 48, maxWidth: 180, objectFit: "contain" }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: brand.accent }}>{brand.name}</div>
        {contact && <div style={{ fontSize: 11, color: "#4B5563" }}>{contact}</div>}
        {brand.license && <div style={{ fontSize: 11, color: "#4B5563" }}>Matrícula: {brand.license}</div>}
      </div>
    </div>
  );
}
