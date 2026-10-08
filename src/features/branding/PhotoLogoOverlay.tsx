import type { CSSProperties } from "react";
import { photoLogoCorner, type PhotoLogoPosition, type PhotoLogoSize, type ResolvedPhotoLogo } from "../../../shared/brand";

/**
 * Logo de la inmobiliaria SOBRE una foto, como capa CSS.
 *
 * Es solo visual: no modifica el archivo de la foto. Lo que se manda a
 * Mercado Libre (que no acepta logos ni marcas de agua en las fotos) y a la
 * app PropMatch es siempre la foto original. Ver «Logo sobre las fotos» en
 * shared/brand.ts.
 *
 * Va dentro de un contenedor `position: relative`. Es decorativo
 * (`aria-hidden`, `alt=""`) y no intercepta clics (`pointer-events: none`).
 * `avoid` son las esquinas que esa foto ya usa (badges, contador, estrella):
 * si la elegida está ocupada, se corre a otra.
 */
export type PhotoLogoContext = "card" | "hero";

const HEIGHT: Record<PhotoLogoContext, Record<PhotoLogoSize, number>> = {
  card: { sm: 20, md: 30 },
  hero: { sm: 30, md: 46 },
};
const INSET: Record<PhotoLogoContext, number> = { card: 12, hero: 16 };

export function PhotoLogoOverlay({
  logo,
  context = "card",
  avoid,
  className = "",
}: {
  logo: ResolvedPhotoLogo | null | undefined;
  context?: PhotoLogoContext;
  avoid?: readonly PhotoLogoPosition[];
  className?: string;
}) {
  if (!logo) return null;
  const corner = photoLogoCorner(logo.position, avoid);
  const [v, h] = corner.split("-") as ["top" | "bottom", "left" | "right"];
  const height = HEIGHT[context][logo.size];
  const inset = INSET[context];
  const plate = logo.backdrop !== "shadow";
  const wrap: CSSProperties = {
    position: "absolute",
    [v]: inset,
    [h]: inset,
    zIndex: 1,
    pointerEvents: "none",
    userSelect: "none",
    lineHeight: 0,
    // Que el PDF (impresión) conserve la placa y la sombra.
    printColorAdjust: "exact",
    WebkitPrintColorAdjust: "exact",
    ...(plate
      ? {
          padding: Math.round(height * 0.22),
          borderRadius: Math.round(height * 0.3),
          background: logo.backdrop === "light" ? "rgba(255,255,255,0.86)" : "rgba(17,12,30,0.5)",
          boxShadow: logo.backdrop === "light" ? "0 1px 4px rgba(0,0,0,0.18)" : "0 1px 4px rgba(0,0,0,0.25)",
          backdropFilter: "blur(3px)",
        }
      : {}),
  };
  return (
    <span aria-hidden="true" className={`photo-logo ${className}`} style={wrap}>
      <img
        src={logo.src}
        alt=""
        draggable={false}
        decoding="async"
        style={{
          display: "block",
          height,
          width: "auto",
          maxWidth: height * 4.5,
          objectFit: "contain",
          // Sombra suave: se lee sobre fotos claras y oscuras sin tapar la foto.
          filter: plate ? undefined : "drop-shadow(0 1px 2px rgba(0,0,0,0.55)) drop-shadow(0 0 8px rgba(0,0,0,0.3))",
        }}
      />
    </span>
  );
}
