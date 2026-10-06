/**
 * Operaciones: pasos, documentación y modelos de contrato.
 *
 * Todo lo que un agente necesita para llevar una venta o un alquiler de
 * principio a fin, sin salir del CRM. Los textos legales son MODELOS
 * ORIENTATIVOS: los revisa un escribano o abogado antes de firmar.
 */

import type { Deal, DealKind, DealParty } from "@/types/db";
export { amountInWords, longDate, numberToWords, numericDate } from "./docText";
import { DEFAULT_TEMPLATES, renderTemplate, templateData, type DocBlock, type DocContext } from "./docTemplates";

export interface ChecklistItem {
  id: string;
  label: string;
  hint?: string;
}

export interface ChecklistGroup {
  id: string;
  title: string;
  items: ChecklistItem[];
}

/* ── Pasos de la operación ───────────────────────────────────────────────── */

export const DEAL_STEPS: Record<DealKind, ChecklistItem[]> = {
  venta: [
    { id: "autorizacion", label: "Autorización de venta firmada", hint: "Exclusiva o no exclusiva, con plazo y comisión." },
    { id: "docs_inmueble", label: "Documentación del inmueble reunida", hint: "Título, planos, deudas, expensas." },
    { id: "publicacion", label: "Publicada y difundida", hint: "Fotos, ficha, portales, WhatsApp." },
    { id: "oferta", label: "Oferta del comprador recibida", hint: "Por escrito, con monto y forma de pago." },
    { id: "reserva", label: "Reserva firmada y señal recibida", hint: "Documento de reserva + comprobante." },
    { id: "aceptacion", label: "Propietario aceptó la oferta", hint: "Si hay contraoferta, dejarla por escrito." },
    { id: "titulos", label: "Estudio de títulos por el escribano", hint: "Dominio, inhibiciones, titularidad." },
    { id: "boleto", label: "Boleto de compraventa firmado", hint: "Con anticipo y fecha de escritura." },
    { id: "certificados", label: "Certificados solicitados al escribano", hint: "Dominio, inhibición, catastral, libre deuda." },
    { id: "escritura", label: "Escritura y entrega de posesión", hint: "Pago del saldo, llaves, actas." },
    { id: "honorarios", label: "Comisión cobrada", hint: "A cada parte según lo pactado." },
    { id: "posventa", label: "Posventa y pedido de referidos" },
  ],
  alquiler: [
    { id: "autorizacion", label: "Autorización de alquiler firmada" },
    { id: "publicacion", label: "Publicada y difundida" },
    { id: "visita", label: "Visita realizada" },
    { id: "oferta", label: "Oferta del interesado aceptada por el propietario" },
    { id: "reserva", label: "Reserva firmada y señal recibida" },
    { id: "analisis", label: "Análisis del inquilino y la garantía", hint: "Recibos, informe crediticio, garantía." },
    { id: "contrato", label: "Contrato redactado y revisado por las partes" },
    { id: "firma", label: "Contrato firmado, depósito y primer mes cobrados" },
    { id: "entrega", label: "Entrega de llaves con inventario y estado del inmueble", hint: "Fotos y lecturas de medidores." },
    { id: "honorarios", label: "Comisión cobrada" },
    { id: "seguimiento", label: "Seguimiento: ajustes y renovación", hint: "Agendar los aumentos y el vencimiento." },
  ],
};

/* ── Documentación a reunir ──────────────────────────────────────────────── */

export const DEAL_DOCS: Record<DealKind, ChecklistGroup[]> = {
  venta: [
    {
      id: "vendedor",
      title: "Vendedor / propietario",
      items: [
        { id: "v_dni", label: "DNI (frente y dorso)" },
        { id: "v_cuil", label: "CUIL / CUIT" },
        { id: "v_estado", label: "Estado civil", hint: "Si es casado: acta de matrimonio." },
        { id: "v_asentimiento", label: "Asentimiento conyugal (si corresponde)" },
        { id: "v_poder", label: "Poder o carta de representación (si actúa un apoderado)" },
        { id: "v_cbu", label: "CBU / datos bancarios para el cobro" },
      ],
    },
    {
      id: "inmueble",
      title: "Inmueble",
      items: [
        { id: "i_escritura", label: "Escritura / título de propiedad" },
        { id: "i_plano", label: "Plano aprobado / de mensura" },
        { id: "i_partida", label: "Partida inmobiliaria y nomenclatura catastral" },
        { id: "i_abl", label: "Impuesto inmobiliario y tasas municipales al día" },
        { id: "i_agua", label: "Agua y servicios sin deuda" },
        { id: "i_expensas", label: "Libre deuda de expensas y reglamento de copropiedad (PH / departamento)" },
        { id: "i_habilitacion", label: "Final de obra / habilitaciones (si hay construcciones nuevas)" },
        { id: "i_sucesion", label: "Declaratoria de herederos (si es una sucesión)" },
      ],
    },
    {
      id: "comprador",
      title: "Comprador",
      items: [
        { id: "c_dni", label: "DNI (frente y dorso)" },
        { id: "c_cuil", label: "CUIL / CUIT" },
        { id: "c_estado", label: "Estado civil y datos del cónyuge (si corresponde)" },
        { id: "c_fondos", label: "Constancia de origen de los fondos", hint: "Exigida por la UIF: ahorros, venta anterior, préstamo." },
        { id: "c_credito", label: "Preaprobación de crédito hipotecario (si compra con crédito)" },
        { id: "c_domicilio", label: "Domicilio real y constituido" },
      ],
    },
    {
      id: "operacion",
      title: "Operación",
      items: [
        { id: "o_autorizacion", label: "Autorización de venta firmada" },
        { id: "o_reserva", label: "Reserva firmada" },
        { id: "o_recibo_reserva", label: "Recibo de la señal" },
        { id: "o_boleto", label: "Boleto de compraventa firmado" },
        { id: "o_certificados", label: "Certificados de dominio e inhibición" },
        { id: "o_escritura", label: "Escritura traslativa de dominio" },
      ],
    },
  ],
  alquiler: [
    {
      id: "propietario",
      title: "Propietario",
      items: [
        { id: "p_dni", label: "DNI (frente y dorso)" },
        { id: "p_cuil", label: "CUIL / CUIT" },
        { id: "p_titulo", label: "Título de propiedad (escritura) o boleto", hint: "Para acreditar que puede alquilar." },
        { id: "p_abl", label: "Impuesto inmobiliario y tasas al día" },
        { id: "p_expensas", label: "Constancia de expensas (si corresponde)" },
        { id: "p_servicios", label: "Últimas boletas de luz, gas y agua" },
        { id: "p_cbu", label: "CBU para el cobro del alquiler" },
      ],
    },
    {
      id: "inquilino",
      title: "Inquilino",
      items: [
        { id: "t_dni", label: "DNI (frente y dorso)" },
        { id: "t_cuil", label: "CUIL / CUIT" },
        { id: "t_recibos", label: "Últimos 3 recibos de sueldo", hint: "Como referencia, ingresos de al menos 3 veces el alquiler." },
        { id: "t_laboral", label: "Certificado laboral o constancia de trabajo" },
        { id: "t_monotributo", label: "Constancia de AFIP y últimos pagos (monotributistas / independientes)" },
        { id: "t_informe", label: "Informe crediticio (Veraz / Nosis)" },
        { id: "t_domicilio", label: "Domicilio actual (servicio a su nombre)" },
      ],
    },
    {
      id: "garantia",
      title: "Garantía",
      items: [
        { id: "g_dni", label: "DNI del garante" },
        { id: "g_escritura", label: "Escritura de la propiedad en garantía", hint: "Idealmente en la misma jurisdicción y sin embargos." },
        { id: "g_dominio", label: "Informe de dominio (Registro de la Propiedad)" },
        { id: "g_recibos", label: "Recibos de sueldo del garante" },
        { id: "g_caucion", label: "Alternativa: seguro de caución o garantía bancaria" },
      ],
    },
    {
      id: "operacion",
      title: "Operación",
      items: [
        { id: "o_autorizacion", label: "Autorización de alquiler firmada" },
        { id: "o_reserva", label: "Reserva firmada" },
        { id: "o_contrato", label: "Contrato de locación firmado (todas las hojas)" },
        { id: "o_inventario", label: "Inventario y fotos del estado del inmueble" },
        { id: "o_deposito", label: "Comprobante del depósito en garantía" },
        { id: "o_recibo", label: "Recibo del primer mes" },
      ],
    },
  ],
};

export function stepProgress(deal: Deal): { done: number; total: number } {
  const steps = DEAL_STEPS[deal.kind];
  return { done: steps.filter((s) => deal.steps[s.id]?.done).length, total: steps.length };
}

export function docProgress(deal: Deal): { done: number; total: number } {
  const items = DEAL_DOCS[deal.kind].flatMap((g) => g.items);
  return { done: items.filter((i) => deal.docs[i.id]?.done).length, total: items.length };
}

/** Primer paso pendiente: "qué sigue". */
export function nextStep(deal: Deal): ChecklistItem | null {
  return DEAL_STEPS[deal.kind].find((s) => !deal.steps[s.id]?.done) ?? null;
}

export const emptyParty = (): DealParty => ({
  name: "",
  dni: "",
  cuit: "",
  civil_status: "",
  nationality: "argentina",
  address: "",
  phone: "",
  email: "",
});

/* ── Modelos de documentos ───────────────────────────────────────────────── */

export type DocumentKind = "reserva" | "contrato_alquiler" | "boleto_compraventa";

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  reserva: "Reserva",
  contrato_alquiler: "Contrato de alquiler",
  boleto_compraventa: "Boleto de compraventa",
};

export function documentsFor(kind: DealKind): DocumentKind[] {
  return kind === "venta" ? ["reserva", "boleto_compraventa"] : ["reserva", "contrato_alquiler"];
}

export type { DocBlock, DocContext } from "./docTemplates";

/** Documento con el modelo de PropMatch (o con `template`, el texto de una plantilla de la inmobiliaria). */
export function buildDocument(kind: DocumentKind, ctx: DocContext, template?: string): DocBlock[] {
  return renderTemplate(template ?? DEFAULT_TEMPLATES[kind], templateData(kind, ctx));
}
