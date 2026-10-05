/**
 * Operaciones: pasos, documentación y modelos de contrato.
 *
 * Todo lo que un agente necesita para llevar una venta o un alquiler de
 * principio a fin, sin salir del CRM. Los textos legales son MODELOS
 * ORIENTATIVOS: los revisa un escribano o abogado antes de firmar.
 */

import type { Deal, DealKind, DealParty, Property } from "@/types/db";
import { parseLocalDate } from "@/lib/authorization";

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

export interface DocBlock {
  t: "title" | "p" | "clause" | "sign";
  text: string;
}

const UNITS = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve",
];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function below1000(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r < 30) {
    if (r) parts.push(UNITS[r]);
  } else {
    const t = Math.floor(r / 10);
    const u = r % 10;
    parts.push(u ? `${TENS[t]} y ${UNITS[u]}` : TENS[t]);
  }
  return parts.join(" ");
}

/** 185000 -> "ciento ochenta y cinco mil". */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? "un millón" : `${below1000(millions).replace(/uno$/, "ún")} millones`);
  if (thousands) parts.push(thousands === 1 ? "mil" : `${below1000(thousands).replace(/uno$/, "ún")} mil`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

const CURRENCY_WORDS = { USD: "dólares estadounidenses", ARS: "pesos argentinos" } as const;

/** "USD 185.000 (dólares estadounidenses ciento ochenta y cinco mil)" */
export function amountInWords(amount: number | null, currency: "USD" | "ARS"): string {
  if (amount === null || amount === undefined) return "________________";
  const n = Math.round(amount).toLocaleString("es-AR");
  return `${currency} ${n} (${CURRENCY_WORDS[currency]} ${numberToWords(amount)})`;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function longDate(value: string | Date | null | undefined): string {
  if (!value) return "____ de ____________ de ______";
  const d = typeof value === "string" ? parseLocalDate(value) : value;
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

function blank(v: string | null | undefined, fallback = "________________"): string {
  return v && v.trim() ? v.trim() : fallback;
}

function partyText(p: DealParty): string {
  const parts = [
    blank(p.name),
    p.nationality || "argentino/a",
    p.civil_status ? p.civil_status : "estado civil ________",
    `DNI N° ${blank(p.dni, "__________")}`,
    p.cuit ? `CUIL/CUIT N° ${p.cuit}` : "",
    `con domicilio en ${blank(p.address)}`,
  ].filter(Boolean);
  return parts.join(", ");
}

function propertyAddress(p: Property | undefined): string {
  if (!p) return "________________";
  const street = [p.street, p.street_number].filter(Boolean).join(" ");
  const place = [p.locality, p.province].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(", ") || p.title;
}

export interface DocContext {
  deal: Deal;
  property: Property | undefined;
  agencyName: string;
  agencyCity: string;
  /** Nombre del agente que intermedia. */
  agentName: string;
}

function header(ctx: DocContext): string {
  const city = ctx.agencyCity || "________";
  return `En la ciudad de ${city}, a los ${longDate(new Date())}, se celebra el presente:`;
}

function tail(): DocBlock {
  return {
    t: "p",
    text: "Modelo orientativo generado desde PropMatch CRM. Debe ser revisado por un escribano o abogado antes de su firma.",
  };
}

export function buildDocument(kind: DocumentKind, ctx: DocContext): DocBlock[] {
  switch (kind) {
    case "reserva":
      return reservaDoc(ctx);
    case "contrato_alquiler":
      return contratoAlquilerDoc(ctx);
    case "boleto_compraventa":
      return boletoDoc(ctx);
  }
}

function reservaDoc(ctx: DocContext): DocBlock[] {
  const { deal, property } = ctx;
  const isSale = deal.kind === "venta";
  const addr = propertyAddress(property);
  const buyerRole = isSale ? "EL OFERENTE (comprador)" : "EL OFERENTE (locatario)";
  const sellerRole = isSale ? "EL PROPIETARIO (vendedor)" : "EL PROPIETARIO (locador)";
  return [
    { t: "title", text: isSale ? "RESERVA DE COMPRA" : "RESERVA DE ALQUILER" },
    { t: "p", text: header(ctx) },
    {
      t: "clause",
      text: `PARTES. Por una parte, ${partyText(deal.client)}, en adelante ${buyerRole}; y por la otra, ${partyText(deal.owner)}, en adelante ${sellerRole}, representado en este acto por la inmobiliaria ${blank(ctx.agencyName)}, a través de ${blank(ctx.agentName)}.`,
    },
    {
      t: "clause",
      text: `OBJETO. EL OFERENTE ofrece ${isSale ? "comprar" : "alquilar"} el inmueble ubicado en ${addr}${property ? `, identificado como "${property.title}"` : ""}.`,
    },
    {
      t: "clause",
      text: isSale
        ? `PRECIO. El precio ofrecido es de ${amountInWords(deal.price, deal.currency)}, que se abonará conforme lo que se establezca en el boleto de compraventa.`
        : `PRECIO. El alquiler mensual ofrecido es de ${amountInWords(deal.price, deal.currency)}, por un plazo de ${deal.contract_months ?? "____"} meses, con las condiciones de actualización que se acuerden en el contrato.`,
    },
    {
      t: "clause",
      text: `SEÑAL. En este acto EL OFERENTE entrega la suma de ${amountInWords(deal.reserva_amount, deal.currency)} en concepto de reserva, que se recibe a cuenta del ${isSale ? "precio" : "primer mes de alquiler y depósito"} y queda en poder de ${blank(ctx.agencyName)} hasta la aceptación de la oferta.`,
    },
    {
      t: "clause",
      text: `VIGENCIA. La oferta se mantiene vigente hasta el ${longDate(deal.reserva_valid_until)}. Si EL PROPIETARIO la acepta, las partes firmarán ${isSale ? "el boleto de compraventa" : "el contrato de locación"} dentro de los ${isSale ? "10" : "5"} días hábiles siguientes. Durante la vigencia el inmueble queda reservado y no se ofrecerá a terceros.`,
    },
    {
      t: "clause",
      text: "RECHAZO. Si EL PROPIETARIO no acepta la oferta, la señal se devuelve íntegramente a EL OFERENTE.",
    },
    {
      t: "clause",
      text: "DESISTIMIENTO. Si EL OFERENTE desiste una vez aceptada la oferta, pierde la señal entregada. Si desiste EL PROPIETARIO, deberá devolver la señal duplicada.",
    },
    {
      t: "clause",
      text: `HONORARIOS. La comisión de la inmobiliaria es de ${deal.commission_pct ?? "____"}% ${isSale ? "sobre el precio de venta" : "sobre el valor total del contrato, a cargo de las partes según lo pactado"}.`,
    },
    { t: "p", text: "En prueba de conformidad se firman dos ejemplares de un mismo tenor y a un solo efecto." },
    {
      t: "sign",
      text: `${blank(deal.client.name)}|EL OFERENTE||${blank(deal.owner.name)}|EL PROPIETARIO||${blank(ctx.agencyName)}|LA INMOBILIARIA`,
    },
    tail(),
  ];
}

function contratoAlquilerDoc(ctx: DocContext): DocBlock[] {
  const { deal, property } = ctx;
  const addr = propertyAddress(property);
  const months = deal.contract_months ?? 24;
  const depositMonths = deal.deposit_months ?? 1;
  const deposit = deal.price !== null ? deal.price * depositMonths : null;
  const hasGuarantor = deal.guarantor.name.trim().length > 0;
  return [
    { t: "title", text: "CONTRATO DE LOCACIÓN DE INMUEBLE" },
    { t: "p", text: header(ctx) },
    {
      t: "clause",
      text: `PARTES. ${partyText(deal.owner)}, en adelante EL LOCADOR; y ${partyText(deal.client)}, en adelante EL LOCATARIO${hasGuarantor ? `; y ${partyText(deal.guarantor)}, en adelante EL GARANTE` : ""}. Intermedia ${blank(ctx.agencyName)}.`,
    },
    {
      t: "clause",
      text: `PRIMERA – OBJETO. EL LOCADOR da en locación a EL LOCATARIO el inmueble ubicado en ${addr}, con todo lo que le es accesorio.`,
    },
    {
      t: "clause",
      text: `SEGUNDA – DESTINO. El inmueble se destina exclusivamente a ${blank(deal.destination, "vivienda")}. No podrá cambiarse el destino ni subalquilarse o cederse el contrato sin autorización escrita de EL LOCADOR.`,
    },
    {
      t: "clause",
      text: `TERCERA – PLAZO. El contrato dura ${months} meses, desde el ${longDate(deal.start_date)}. Al vencer, EL LOCATARIO debe restituir el inmueble libre de ocupantes y de cosas, salvo que las partes acuerden por escrito una renovación.`,
    },
    {
      t: "clause",
      text: `CUARTA – PRECIO Y FORMA DE PAGO. El alquiler mensual inicial es de ${amountInWords(deal.price, deal.currency)}, pagadero por mes adelantado, del 1 al 10 de cada mes, mediante transferencia bancaria a la cuenta que EL LOCADOR indique o en el domicilio de la inmobiliaria.`,
    },
    {
      t: "clause",
      text: `QUINTA – ACTUALIZACIÓN. ${deal.update_rule.trim() ? deal.update_rule.trim() : "El alquiler se actualizará según el índice y la periodicidad que las partes acuerden: ____________________________."}`,
    },
    {
      t: "clause",
      text: `SEXTA – DEPÓSITO EN GARANTÍA. EL LOCATARIO entrega ${depositMonths} ${depositMonths === 1 ? "mes" : "meses"} de alquiler, es decir ${amountInWords(deposit, deal.currency)}, que se restituirá al finalizar el contrato, previa verificación del estado del inmueble y de la ausencia de deudas.`,
    },
    {
      t: "clause",
      text: "SÉPTIMA – GASTOS Y SERVICIOS. Son a cargo de EL LOCATARIO: luz, gas, agua, internet, expensas ordinarias y toda tasa por servicios que use. Son a cargo de EL LOCADOR: el impuesto inmobiliario y las expensas extraordinarias. EL LOCATARIO debe exhibir los comprobantes de pago cuando EL LOCADOR lo pida.",
    },
    {
      t: "clause",
      text: "OCTAVA – ESTADO DEL INMUEBLE. EL LOCATARIO recibe el inmueble en el estado que consta en el inventario y las fotografías firmadas que se anexan, y se obliga a conservarlo y a devolverlo en el mismo estado, salvo el desgaste normal por el uso. Las mejoras requieren autorización escrita y quedan a beneficio del inmueble.",
    },
    {
      t: "clause",
      text: "NOVENA – MORA. La mora es automática, sin necesidad de interpelación. El atraso en el pago genera un interés punitorio del ____% diario sobre el monto adeudado. Dos meses impagos facultan a EL LOCADOR a resolver el contrato y reclamar el desalojo.",
    },
    {
      t: "clause",
      text: "DÉCIMA – RESCISIÓN ANTICIPADA. EL LOCATARIO puede rescindir el contrato pasados los primeros 6 meses, con un preaviso escrito de al menos 30 días. Si lo hace durante el primer año, abonará una indemnización equivalente a 1,5 mensualidades; si lo hace después, de 1 mensualidad.",
    },
    hasGuarantor
      ? {
          t: "clause",
          text: "DECIMOPRIMERA – GARANTÍA. EL GARANTE se constituye en fiador solidario, liso, llano y principal pagador de todas las obligaciones de EL LOCATARIO, con renuncia a los beneficios de excusión y división, y su responsabilidad se mantiene hasta la efectiva restitución del inmueble, incluso durante prórrogas.",
        }
      : {
          t: "clause",
          text: "DECIMOPRIMERA – GARANTÍA. Las obligaciones de EL LOCATARIO se garantizan mediante: ____________________________.",
        },
    {
      t: "clause",
      text: `DECIMOSEGUNDA – HONORARIOS. La comisión de ${blank(ctx.agencyName)} es de ${deal.commission_pct ?? "____"}% del valor total del contrato, a cargo de ____________. El Impuesto de Sellos, si corresponde, se abona por partes iguales.`,
    },
    {
      t: "clause",
      text: `DECIMOTERCERA – DOMICILIOS Y JURISDICCIÓN. Las partes constituyen domicilio en los indicados al comienzo, donde serán válidas las notificaciones, y se someten a los tribunales ordinarios de ${blank(ctx.agencyCity, "________")}.`,
    },
    { t: "p", text: "En prueba de conformidad se firman ejemplares de un mismo tenor y a un solo efecto." },
    {
      t: "sign",
      text: `${blank(deal.owner.name)}|EL LOCADOR||${blank(deal.client.name)}|EL LOCATARIO${hasGuarantor ? `||${blank(deal.guarantor.name)}|EL GARANTE` : ""}`,
    },
    tail(),
  ];
}

function boletoDoc(ctx: DocContext): DocBlock[] {
  const { deal, property } = ctx;
  const addr = propertyAddress(property);
  const advancePct = deal.boleto_advance_pct ?? 30;
  const advance = deal.price !== null ? (deal.price * advancePct) / 100 : null;
  const reserva = deal.reserva_amount ?? 0;
  const advanceNet = advance !== null ? Math.max(advance - reserva, 0) : null;
  const balance = deal.price !== null && advance !== null ? deal.price - advance : null;
  return [
    { t: "title", text: "BOLETO DE COMPRAVENTA INMOBILIARIA" },
    { t: "p", text: header(ctx) },
    {
      t: "clause",
      text: `PARTES. ${partyText(deal.owner)}, en adelante EL VENDEDOR; y ${partyText(deal.client)}, en adelante EL COMPRADOR. Intermedia ${blank(ctx.agencyName)}.`,
    },
    {
      t: "clause",
      text: `PRIMERA – OBJETO. EL VENDEDOR vende a EL COMPRADOR, quien compra, el inmueble ubicado en ${addr}${property?.surface_total ? `, con una superficie total aproximada de ${property.surface_total} m²` : ""}, cuyos datos de dominio y catastrales constan en el título que EL VENDEDOR exhibe y que integra este boleto.`,
    },
    {
      t: "clause",
      text: `SEGUNDA – PRECIO. El precio total y definitivo es de ${amountInWords(deal.price, deal.currency)}.`,
    },
    {
      t: "clause",
      text: `TERCERA – FORMA DE PAGO. (a) ${reserva ? `La suma de ${amountInWords(reserva, deal.currency)} ya entregada en concepto de reserva se imputa a cuenta de precio. ` : ""}(b) En este acto EL COMPRADOR abona ${amountInWords(advanceNet, deal.currency)}, completando un anticipo total del ${advancePct}% del precio (${amountInWords(advance, deal.currency)}); sirve este documento de suficiente recibo. (c) El saldo de ${amountInWords(balance, deal.currency)} se abonará al firmar la escritura traslativa de dominio.`,
    },
    {
      t: "clause",
      text: `CUARTA – ESCRITURA Y POSESIÓN. La escritura se otorgará el ${longDate(deal.escritura_date)}, ante ${deal.escribano.trim() ? `el escribano ${deal.escribano.trim()}` : "el escribano que designe EL COMPRADOR"}. La posesión se entrega en ese acto, con el inmueble libre de ocupantes y de cosas.`,
    },
    {
      t: "clause",
      text: "QUINTA – TÍTULO Y LIBRE DEUDA. EL VENDEDOR declara ser titular del dominio, que el inmueble no reconoce hipotecas, embargos, inhibiciones ni gravámenes, y que se encuentra libre de deudas de impuestos, tasas, servicios y expensas hasta la fecha de posesión, obligándose a acreditarlo con los certificados correspondientes. Si el título no fuera perfecto, EL COMPRADOR podrá desistir con devolución de lo pagado.",
    },
    {
      t: "clause",
      text: `SEXTA – GASTOS. Los honorarios del escribano y los gastos de escrituración son a cargo de EL COMPRADOR; el Impuesto de Sellos se abona por mitades; el impuesto a la transferencia de inmuebles, si correspondiera, a cargo de EL VENDEDOR. La comisión de ${blank(ctx.agencyName)} es de ${deal.commission_pct ?? "____"}% del precio a cada parte, o según lo pactado por separado.`,
    },
    {
      t: "clause",
      text: "SÉPTIMA – INCUMPLIMIENTO. Si EL COMPRADOR no cumple, pierde lo entregado a cuenta de precio. Si no cumple EL VENDEDOR, devolverá lo recibido duplicado. Ante cualquier incumplimiento la parte cumplidora podrá optar por exigir el cumplimiento forzoso. La mora es automática.",
    },
    {
      t: "clause",
      text: `OCTAVA – JURISDICCIÓN. Las partes constituyen domicilio en los indicados al comienzo y se someten a los tribunales ordinarios de ${blank(ctx.agencyCity, "________")}.`,
    },
    { t: "p", text: "En prueba de conformidad se firman tres ejemplares de un mismo tenor y a un solo efecto." },
    {
      t: "sign",
      text: `${blank(deal.owner.name)}|EL VENDEDOR||${blank(deal.client.name)}|EL COMPRADOR||${blank(ctx.agencyName)}|LA INMOBILIARIA`,
    },
    tail(),
  ];
}
