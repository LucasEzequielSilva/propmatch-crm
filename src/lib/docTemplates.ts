/**
 * Plantillas de documentos (reserva, boleto, contrato de alquiler).
 *
 * Una plantilla es TEXTO CON VARIABLES, no valores: `{{precio_letras}}`,
 * `{{comprador_nombre}}`, `{{refuerzos}}`… Al abrir el documento de una
 * operación se completan solas con sus datos. Los modelos de PropMatch son
 * también plantillas (DEFAULT_TEMPLATES): una sola fuente para el modelo y
 * para lo que la inmobiliaria personalice.
 *
 * Formato (pensado para que se pueda editar a mano):
 *   - párrafos separados por una línea en blanco;
 *   - `# TEXTO` = título; `> texto` = nota al pie (chiquita, en cursiva);
 *   - `{{firmas}}` solo en un párrafo = bloque de firmas de las partes;
 *   - `MAYÚSCULAS.` al principio de un párrafo = cláusula (va en negrita);
 *   - secciones condicionales: `{{#venta}}…{{/venta}}` (se muestra si es una
 *     venta) y `{{^garante}}…{{/garante}}` (si NO hay garante). Ver SECTIONS.
 *
 * Al renderizar, las secciones que no aplican no desaparecen del todo: viajan
 * ocultas (DocPart "raw"/"mark") para que «Guardar como plantilla» desde un
 * documento ya completado devuelva la plantilla con sus condiciones.
 */
import type { Deal, DealKind, DealParty, DocTemplate, Property } from "@/types/db";
import { amountInWords, longDate } from "./docText";
import { refuerzosOf, refuerzosText, salePlan } from "./refuerzos";

export type TemplateKind = DocTemplate["kind"];

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = {
  reserva: "Reserva",
  boleto_compraventa: "Boleto de compraventa",
  contrato_alquiler: "Contrato de alquiler",
};

/* ── Variables ───────────────────────────────────────────────────────────── */

export interface TemplateVariable {
  key: string;
  label: string;
  group: string;
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { key: "fecha_hoy", label: "Fecha de hoy (larga)", group: "General" },
  { key: "ciudad", label: "Ciudad de la inmobiliaria", group: "General" },
  { key: "inmobiliaria", label: "Nombre de la inmobiliaria", group: "General" },
  { key: "inmobiliaria_matricula", label: "Matrícula", group: "General" },
  { key: "inmobiliaria_direccion", label: "Dirección de la inmobiliaria", group: "General" },
  { key: "agente", label: "Agente que intermedia", group: "General" },

  { key: "comprador_nombre", label: "Comprador / oferente: nombre", group: "Partes" },
  { key: "comprador_datos", label: "Comprador / oferente: nombre, DNI y domicilio", group: "Partes" },
  { key: "vendedor_nombre", label: "Vendedor / propietario: nombre", group: "Partes" },
  { key: "vendedor_datos", label: "Vendedor / propietario: nombre, DNI y domicilio", group: "Partes" },
  { key: "locatario_nombre", label: "Inquilino: nombre", group: "Partes" },
  { key: "locatario_datos", label: "Inquilino: nombre, DNI y domicilio", group: "Partes" },
  { key: "locador_nombre", label: "Propietario (locador): nombre", group: "Partes" },
  { key: "locador_datos", label: "Propietario (locador): nombre, DNI y domicilio", group: "Partes" },
  { key: "garante_nombre", label: "Garante: nombre", group: "Partes" },
  { key: "garante_datos", label: "Garante: nombre, DNI y domicilio", group: "Partes" },

  { key: "inmueble_direccion", label: "Dirección del inmueble", group: "Inmueble" },
  { key: "inmueble_titulo", label: "Título de la publicación", group: "Inmueble" },
  { key: "inmueble_superficie", label: "Superficie total (m²)", group: "Inmueble" },

  { key: "precio", label: "Precio (USD 185.000)", group: "Plata" },
  { key: "precio_letras", label: "Precio en números y letras", group: "Plata" },
  { key: "moneda", label: "Moneda (USD / ARS)", group: "Plata" },
  { key: "comision_pct", label: "Comisión (%)", group: "Plata" },
  { key: "reserva_letras", label: "Reserva en números y letras", group: "Plata" },
  { key: "reserva_vigencia", label: "Vigencia de la reserva (fecha)", group: "Plata" },
  { key: "refuerzos", label: "Listado de refuerzos (uno por línea)", group: "Plata" },
  { key: "refuerzos_total_letras", label: "Total de refuerzos en letras", group: "Plata" },
  { key: "a_cuenta_letras", label: "Reserva + refuerzos en letras", group: "Plata" },

  { key: "anticipo_pct", label: "Anticipo (%)", group: "Venta" },
  { key: "anticipo_letras", label: "Anticipo total en letras", group: "Venta" },
  { key: "anticipo_neto_letras", label: "Lo que se paga en el boleto, en letras", group: "Venta" },
  { key: "saldo_letras", label: "Saldo a la escritura en letras", group: "Venta" },
  { key: "fecha_escritura", label: "Fecha de escritura", group: "Venta" },
  { key: "escribano", label: "Escribano", group: "Venta" },

  { key: "plazo_meses", label: "Plazo (meses)", group: "Alquiler" },
  { key: "fecha_inicio", label: "Fecha de inicio", group: "Alquiler" },
  { key: "destino", label: "Destino (vivienda, comercio…)", group: "Alquiler" },
  { key: "actualizacion", label: "Regla de actualización", group: "Alquiler" },
  { key: "deposito_meses_texto", label: "Depósito (\"1 mes\", \"2 meses\")", group: "Alquiler" },
  { key: "deposito_letras", label: "Depósito en letras", group: "Alquiler" },

  { key: "firmas", label: "Bloque de firmas (solo, en su párrafo)", group: "Especiales" },
];

/** Secciones condicionales: `{{#clave}}…{{/clave}}` / `{{^clave}}…{{/clave}}`. */
export const SECTIONS: { key: string; label: string }[] = [
  { key: "venta", label: "Si es una venta" },
  { key: "alquiler", label: "Si es un alquiler" },
  { key: "reserva", label: "Si hay monto de reserva" },
  { key: "refuerzos", label: "Si hay refuerzos cargados" },
  { key: "garante", label: "Si hay garante" },
  { key: "escribano", label: "Si hay escribano cargado" },
];

export interface DocContext {
  deal: Deal;
  property: Property | undefined;
  agencyName: string;
  agencyCity: string;
  /** Nombre del agente que intermedia. */
  agentName: string;
  agencyLicense?: string | null;
  agencyAddress?: string | null;
}

const BLANK = "________________";

function blank(v: string | null | undefined, fallback = BLANK): string {
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
  if (!p) return BLANK;
  const street = [p.street, p.street_number].filter(Boolean).join(" ");
  const place = [p.locality, p.province].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(", ") || p.title;
}

const fmtPct = (n: number) => (Math.round(n * 100) / 100).toLocaleString("es-AR");

export interface TemplateData {
  vars: Record<string, string>;
  flags: Record<string, boolean>;
  /** Firmas: "Nombre|ROL||Nombre|ROL". */
  signatures: string;
}

export function templateData(kind: TemplateKind, ctx: DocContext): TemplateData {
  const { deal, property } = ctx;
  const cur = deal.currency;
  const plan = salePlan(deal);
  const months = deal.contract_months ?? 24;
  const depositMonths = deal.deposit_months ?? 1;
  const deposit = deal.price !== null ? deal.price * depositMonths : null;
  const hasGuarantor = deal.guarantor.name.trim().length > 0;
  const refuerzos = refuerzosOf(deal);
  const advancePctReal = plan.price && plan.advanceTotal !== null ? (plan.advanceTotal / plan.price) * 100 : plan.advancePct;

  const vars: Record<string, string> = {
    fecha_hoy: longDate(new Date()),
    ciudad: blank(ctx.agencyCity, "________"),
    inmobiliaria: blank(ctx.agencyName),
    inmobiliaria_matricula: blank(ctx.agencyLicense ?? null, "________"),
    inmobiliaria_direccion: blank(ctx.agencyAddress ?? null),
    agente: blank(ctx.agentName),

    comprador_nombre: blank(deal.client.name),
    comprador_datos: partyText(deal.client),
    vendedor_nombre: blank(deal.owner.name),
    vendedor_datos: partyText(deal.owner),
    locatario_nombre: blank(deal.client.name),
    locatario_datos: partyText(deal.client),
    locador_nombre: blank(deal.owner.name),
    locador_datos: partyText(deal.owner),
    garante_nombre: blank(deal.guarantor.name),
    garante_datos: partyText(deal.guarantor),

    inmueble_direccion: propertyAddress(property),
    inmueble_titulo: property ? property.title : BLANK,
    inmueble_superficie: property?.surface_total ? `${property.surface_total}` : "____",

    precio: deal.price !== null ? `${cur} ${Math.round(deal.price).toLocaleString("es-AR")}` : BLANK,
    precio_letras: amountInWords(deal.price, cur),
    moneda: cur,
    comision_pct: deal.commission_pct !== null && deal.commission_pct !== undefined ? fmtPct(deal.commission_pct) : "____",
    reserva_letras: amountInWords(deal.reserva_amount, cur),
    reserva_vigencia: longDate(deal.reserva_valid_until),
    refuerzos: refuerzosText(deal),
    refuerzos_total_letras: amountInWords(plan.refuerzos, cur),
    a_cuenta_letras: amountInWords(plan.aCuenta, cur),

    anticipo_pct: fmtPct(advancePctReal),
    anticipo_letras: amountInWords(plan.advanceTotal, cur),
    anticipo_neto_letras: amountInWords(plan.advanceNet, cur),
    saldo_letras: amountInWords(plan.balance, cur),
    fecha_escritura: longDate(deal.escritura_date),
    escribano: blank(deal.escribano),

    plazo_meses: String(deal.kind === "alquiler" ? months : deal.contract_months ?? "____"),
    fecha_inicio: longDate(deal.start_date),
    destino: blank(deal.destination, "vivienda"),
    actualizacion: deal.update_rule.trim()
      ? deal.update_rule.trim()
      : "El alquiler se actualizará según el índice y la periodicidad que las partes acuerden: ____________________________.",
    deposito_meses_texto: `${depositMonths} ${depositMonths === 1 ? "mes" : "meses"}`,
    deposito_letras: amountInWords(deposit, cur),
  };

  const flags: Record<string, boolean> = {
    venta: deal.kind === "venta",
    alquiler: deal.kind === "alquiler",
    reserva: !!deal.reserva_amount,
    refuerzos: refuerzos.length > 0,
    garante: hasGuarantor,
    escribano: !!deal.escribano.trim(),
  };

  const agency = blank(ctx.agencyName);
  const signatures =
    kind === "reserva"
      ? `${blank(deal.client.name)}|EL OFERENTE||${blank(deal.owner.name)}|EL PROPIETARIO||${agency}|LA INMOBILIARIA`
      : kind === "contrato_alquiler"
        ? `${blank(deal.owner.name)}|EL LOCADOR||${blank(deal.client.name)}|EL LOCATARIO${hasGuarantor ? `||${blank(deal.guarantor.name)}|EL GARANTE` : ""}`
        : `${blank(deal.owner.name)}|EL VENDEDOR||${blank(deal.client.name)}|EL COMPRADOR||${agency}|LA INMOBILIARIA`;

  return { vars, flags, signatures };
}

/* ── Modelos de PropMatch ────────────────────────────────────────────────── */

const NOTE = "> Modelo orientativo generado desde PropMatch CRM. Debe ser revisado por un escribano o abogado antes de su firma.";

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  reserva: `# {{#venta}}RESERVA DE COMPRA{{/venta}}{{#alquiler}}RESERVA DE ALQUILER{{/alquiler}}

En la ciudad de {{ciudad}}, a los {{fecha_hoy}}, se celebra el presente:

PARTES. Por una parte, {{comprador_datos}}, en adelante EL OFERENTE ({{#venta}}comprador{{/venta}}{{#alquiler}}locatario{{/alquiler}}); y por la otra, {{vendedor_datos}}, en adelante EL PROPIETARIO ({{#venta}}vendedor{{/venta}}{{#alquiler}}locador{{/alquiler}}), representado en este acto por la inmobiliaria {{inmobiliaria}}, a través de {{agente}}.

OBJETO. EL OFERENTE ofrece {{#venta}}comprar{{/venta}}{{#alquiler}}alquilar{{/alquiler}} el inmueble ubicado en {{inmueble_direccion}}, identificado como "{{inmueble_titulo}}".

{{#venta}}PRECIO. El precio ofrecido es de {{precio_letras}}, que se abonará conforme lo que se establezca en el boleto de compraventa.{{/venta}}{{#alquiler}}PRECIO. El alquiler mensual ofrecido es de {{precio_letras}}, por un plazo de {{plazo_meses}} meses, con las condiciones de actualización que se acuerden en el contrato.{{/alquiler}}

SEÑAL. En este acto EL OFERENTE entrega la suma de {{reserva_letras}} en concepto de reserva, que se recibe a cuenta del {{#venta}}precio{{/venta}}{{#alquiler}}primer mes de alquiler y depósito{{/alquiler}} y queda en poder de {{inmobiliaria}} hasta la aceptación de la oferta.

{{#refuerzos}}REFUERZOS. EL OFERENTE refuerza la reserva, a cuenta del {{#venta}}precio{{/venta}}{{#alquiler}}primer mes de alquiler y depósito{{/alquiler}}, con los siguientes pagos, por un total de {{refuerzos_total_letras}}:
{{refuerzos}}
Cada refuerzo se documenta con su recibo y queda sujeto a las mismas condiciones que la señal.{{/refuerzos}}

VIGENCIA. La oferta se mantiene vigente hasta el {{reserva_vigencia}}. Si EL PROPIETARIO la acepta, las partes firmarán {{#venta}}el boleto de compraventa dentro de los 10{{/venta}}{{#alquiler}}el contrato de locación dentro de los 5{{/alquiler}} días hábiles siguientes. Durante la vigencia el inmueble queda reservado y no se ofrecerá a terceros.

RECHAZO. Si EL PROPIETARIO no acepta la oferta, la señal{{#refuerzos}} y los refuerzos abonados{{/refuerzos}} se devuelven íntegramente a EL OFERENTE.

DESISTIMIENTO. Si EL OFERENTE desiste una vez aceptada la oferta, pierde la señal entregada{{#refuerzos}} y los refuerzos abonados{{/refuerzos}}. Si desiste EL PROPIETARIO, deberá devolver {{#refuerzos}}la señal y los refuerzos recibidos, duplicados{{/refuerzos}}{{^refuerzos}}la señal duplicada{{/refuerzos}}.

HONORARIOS. La comisión de la inmobiliaria es de {{comision_pct}}% {{#venta}}sobre el precio de venta{{/venta}}{{#alquiler}}sobre el valor total del contrato, a cargo de las partes según lo pactado{{/alquiler}}.

En prueba de conformidad se firman dos ejemplares de un mismo tenor y a un solo efecto.

{{firmas}}

${NOTE}`,

  boleto_compraventa: `# BOLETO DE COMPRAVENTA INMOBILIARIA

En la ciudad de {{ciudad}}, a los {{fecha_hoy}}, se celebra el presente:

PARTES. {{vendedor_datos}}, en adelante EL VENDEDOR; y {{comprador_datos}}, en adelante EL COMPRADOR. Intermedia {{inmobiliaria}}.

PRIMERA – OBJETO. EL VENDEDOR vende a EL COMPRADOR, quien compra, el inmueble ubicado en {{inmueble_direccion}}, con una superficie total aproximada de {{inmueble_superficie}} m², cuyos datos de dominio y catastrales constan en el título que EL VENDEDOR exhibe y que integra este boleto.

SEGUNDA – PRECIO. El precio total y definitivo es de {{precio_letras}}.

TERCERA – FORMA DE PAGO. {{#reserva}}(a) La suma de {{reserva_letras}} ya entregada en concepto de reserva se imputa a cuenta de precio. {{/reserva}}{{#refuerzos}}(b) Se imputan también a cuenta de precio los refuerzos de reserva, por un total de {{refuerzos_total_letras}}:
{{refuerzos}}
{{/refuerzos}}(c) En este acto EL COMPRADOR abona {{anticipo_neto_letras}}, completando un anticipo total del {{anticipo_pct}}% del precio ({{anticipo_letras}}); sirve este documento de suficiente recibo. (d) El saldo de {{saldo_letras}} se abonará al firmar la escritura traslativa de dominio.

CUARTA – ESCRITURA Y POSESIÓN. La escritura se otorgará el {{fecha_escritura}}, ante {{#escribano}}el escribano {{escribano}}{{/escribano}}{{^escribano}}el escribano que designe EL COMPRADOR{{/escribano}}. La posesión se entrega en ese acto, con el inmueble libre de ocupantes y de cosas.

QUINTA – TÍTULO Y LIBRE DEUDA. EL VENDEDOR declara ser titular del dominio, que el inmueble no reconoce hipotecas, embargos, inhibiciones ni gravámenes, y que se encuentra libre de deudas de impuestos, tasas, servicios y expensas hasta la fecha de posesión, obligándose a acreditarlo con los certificados correspondientes. Si el título no fuera perfecto, EL COMPRADOR podrá desistir con devolución de lo pagado.

SEXTA – GASTOS. Los honorarios del escribano y los gastos de escrituración son a cargo de EL COMPRADOR; el Impuesto de Sellos se abona por mitades; el impuesto a la transferencia de inmuebles, si correspondiera, a cargo de EL VENDEDOR. La comisión de {{inmobiliaria}} es de {{comision_pct}}% del precio a cada parte, o según lo pactado por separado.

SÉPTIMA – INCUMPLIMIENTO. Si EL COMPRADOR no cumple, pierde lo entregado a cuenta de precio. Si no cumple EL VENDEDOR, devolverá lo recibido duplicado. Ante cualquier incumplimiento la parte cumplidora podrá optar por exigir el cumplimiento forzoso. La mora es automática.

OCTAVA – JURISDICCIÓN. Las partes constituyen domicilio en los indicados al comienzo y se someten a los tribunales ordinarios de {{ciudad}}.

En prueba de conformidad se firman tres ejemplares de un mismo tenor y a un solo efecto.

{{firmas}}

${NOTE}`,

  contrato_alquiler: `# CONTRATO DE LOCACIÓN DE INMUEBLE

En la ciudad de {{ciudad}}, a los {{fecha_hoy}}, se celebra el presente:

PARTES. {{locador_datos}}, en adelante EL LOCADOR; y {{locatario_datos}}, en adelante EL LOCATARIO{{#garante}}; y {{garante_datos}}, en adelante EL GARANTE{{/garante}}. Intermedia {{inmobiliaria}}.

PRIMERA – OBJETO. EL LOCADOR da en locación a EL LOCATARIO el inmueble ubicado en {{inmueble_direccion}}, con todo lo que le es accesorio.

SEGUNDA – DESTINO. El inmueble se destina exclusivamente a {{destino}}. No podrá cambiarse el destino ni subalquilarse o cederse el contrato sin autorización escrita de EL LOCADOR.

TERCERA – PLAZO. El contrato dura {{plazo_meses}} meses, desde el {{fecha_inicio}}. Al vencer, EL LOCATARIO debe restituir el inmueble libre de ocupantes y de cosas, salvo que las partes acuerden por escrito una renovación.

CUARTA – PRECIO Y FORMA DE PAGO. El alquiler mensual inicial es de {{precio_letras}}, pagadero por mes adelantado, del 1 al 10 de cada mes, mediante transferencia bancaria a la cuenta que EL LOCADOR indique o en el domicilio de la inmobiliaria.

QUINTA – ACTUALIZACIÓN. {{actualizacion}}

SEXTA – DEPÓSITO EN GARANTÍA. EL LOCATARIO entrega {{deposito_meses_texto}} de alquiler, es decir {{deposito_letras}}, que se restituirá al finalizar el contrato, previa verificación del estado del inmueble y de la ausencia de deudas.

SÉPTIMA – GASTOS Y SERVICIOS. Son a cargo de EL LOCATARIO: luz, gas, agua, internet, expensas ordinarias y toda tasa por servicios que use. Son a cargo de EL LOCADOR: el impuesto inmobiliario y las expensas extraordinarias. EL LOCATARIO debe exhibir los comprobantes de pago cuando EL LOCADOR lo pida.

OCTAVA – ESTADO DEL INMUEBLE. EL LOCATARIO recibe el inmueble en el estado que consta en el inventario y las fotografías firmadas que se anexan, y se obliga a conservarlo y a devolverlo en el mismo estado, salvo el desgaste normal por el uso. Las mejoras requieren autorización escrita y quedan a beneficio del inmueble.

NOVENA – MORA. La mora es automática, sin necesidad de interpelación. El atraso en el pago genera un interés punitorio del ____% diario sobre el monto adeudado. Dos meses impagos facultan a EL LOCADOR a resolver el contrato y reclamar el desalojo.

DÉCIMA – RESCISIÓN ANTICIPADA. EL LOCATARIO puede rescindir el contrato pasados los primeros 6 meses, con un preaviso escrito de al menos 30 días. Si lo hace durante el primer año, abonará una indemnización equivalente a 1,5 mensualidades; si lo hace después, de 1 mensualidad.

{{#garante}}DECIMOPRIMERA – GARANTÍA. EL GARANTE se constituye en fiador solidario, liso, llano y principal pagador de todas las obligaciones de EL LOCATARIO, con renuncia a los beneficios de excusión y división, y su responsabilidad se mantiene hasta la efectiva restitución del inmueble, incluso durante prórrogas.{{/garante}}{{^garante}}DECIMOPRIMERA – GARANTÍA. Las obligaciones de EL LOCATARIO se garantizan mediante: ____________________________.{{/garante}}

DECIMOSEGUNDA – HONORARIOS. La comisión de {{inmobiliaria}} es de {{comision_pct}}% del valor total del contrato, a cargo de ____________. El Impuesto de Sellos, si corresponde, se abona por partes iguales.

DECIMOTERCERA – DOMICILIOS Y JURISDICCIÓN. Las partes constituyen domicilio en los indicados al comienzo, donde serán válidas las notificaciones, y se someten a los tribunales ordinarios de {{ciudad}}.

En prueba de conformidad se firman ejemplares de un mismo tenor y a un solo efecto.

{{firmas}}

${NOTE}`,
};

/* ── Render ──────────────────────────────────────────────────────────────── */

export type DocPart =
  | { k: "text"; text: string }
  | { k: "var"; key: string; value: string }
  /** Marca invisible de apertura/cierre de una sección que sí aplica. */
  | { k: "mark"; raw: string }
  /** Sección que no aplica: invisible, se conserva para volver a la plantilla. */
  | { k: "raw"; raw: string };

export interface DocBlock {
  t: "title" | "p" | "clause" | "sign" | "note";
  /** Texto visible (sin marcas). En `sign`: "Nombre|ROL||Nombre|ROL". */
  text: string;
  parts: DocPart[];
  /** Párrafo que quedó vacío porque su sección no aplica: no se ve, pero se guarda. */
  hidden?: boolean;
}

const S_OPEN = "\u0001";
const S_CLOSE = "\u0002";
const SENTINEL = /\u0001([mr])([^\u0002]*)\u0002/g;
const INNER_SECTION = /\{\{([#^])(\w+)\}\}((?:(?!\{\{[#^]\w+\}\})[\s\S])*?)\{\{\/\2\}\}/;

const sentinel = (k: "m" | "r", raw: string) => `${S_OPEN}${k}${encodeURIComponent(raw)}${S_CLOSE}`;
/** Vuelve un texto con centinelas a la plantilla original. */
const restore = (s: string) => s.replace(SENTINEL, (_, _k, enc: string) => decodeURIComponent(enc));

function applySections(text: string, flags: Record<string, boolean>): string {
  let s = text;
  for (let guard = 0; guard < 500; guard++) {
    const m = INNER_SECTION.exec(s);
    if (!m) break;
    const [all, sign, key, body] = m;
    const on = sign === "#" ? !!flags[key] : !flags[key];
    const rep = on ? `${sentinel("m", `{{${sign}${key}}}`)}${body}${sentinel("m", `{{/${key}}}`)}` : sentinel("r", restore(all));
    s = s.slice(0, m.index) + rep + s.slice(m.index + all.length);
  }
  return s;
}

const CLAUSE_HEAD = /^([A-ZÁÉÍÓÚÑ0-9 –.-]+?\.)\s([\s\S]*)$/;

function tokenize(par: string, vars: Record<string, string>): DocPart[] {
  const parts: DocPart[] = [];
  const re = /\u0001([mr])([^\u0002]*)\u0002|\{\{(\w+)\}\}/g;
  let last = 0;
  for (let m = re.exec(par); m; m = re.exec(par)) {
    if (m.index > last) parts.push({ k: "text", text: par.slice(last, m.index) });
    if (m[1]) parts.push({ k: m[1] === "m" ? "mark" : "raw", raw: decodeURIComponent(m[2]) });
    else parts.push({ k: "var", key: m[3], value: m[3] in vars ? vars[m[3]] : `{{${m[3]}}}` });
    last = re.lastIndex;
  }
  if (last < par.length) parts.push({ k: "text", text: par.slice(last) });
  return parts;
}

const visible = (parts: DocPart[]) => parts.map((p) => (p.k === "text" ? p.text : p.k === "var" ? p.value : "")).join("");

/** Quita un prefijo ("# ", "> ") del primer texto visible. */
function stripPrefix(parts: DocPart[], prefix: RegExp): DocPart[] {
  const out = [...parts];
  const i = out.findIndex((p) => p.k === "text" && p.text.trim() !== "");
  if (i >= 0) {
    const p = out[i] as { k: "text"; text: string };
    out[i] = { k: "text", text: p.text.replace(prefix, "") };
  }
  return out;
}

export function renderTemplate(template: string, data: TemplateData): DocBlock[] {
  const withSections = applySections(template.replace(/\r\n?/g, "\n"), data.flags);
  const paragraphs = withSections.split(/\n[ \t]*\n/);
  const blocks: DocBlock[] = [];
  for (const raw of paragraphs) {
    const par = raw.replace(/^\n+|\n+$/g, "");
    if (!par.trim()) continue;
    let parts = tokenize(par, data.vars);
    const vis = visible(parts).trim();
    const onlyHidden = parts.every((p) => p.k === "mark" || p.k === "raw" || (p.k === "text" && !p.text.trim()));
    if (onlyHidden) {
      blocks.push({ t: "p", text: "", parts, hidden: true });
      continue;
    }
    const varsInPar = parts.filter((p) => p.k === "var");
    if (varsInPar.length === 1 && (varsInPar[0] as { key: string }).key === "firmas" && vis === (varsInPar[0] as { value: string }).value.trim()) {
      blocks.push({ t: "sign", text: data.signatures, parts });
      continue;
    }
    if (/^#\s/.test(vis)) {
      parts = stripPrefix(parts, /^\s*#\s/);
      blocks.push({ t: "title", text: visible(parts).trim(), parts });
    } else if (/^>\s/.test(vis)) {
      parts = stripPrefix(parts, /^\s*>\s/);
      blocks.push({ t: "note", text: visible(parts).trim(), parts });
    } else {
      blocks.push({ t: CLAUSE_HEAD.test(vis) ? "clause" : "p", text: vis, parts });
    }
  }
  return blocks;
}

/** Parte el primer texto de una cláusula en encabezado (negrita) + resto. */
export function clauseHead(text: string): [string, string] | null {
  const m = CLAUSE_HEAD.exec(text);
  return m ? [m[1], m[2]] : null;
}

/** Variables usadas que no existen (para avisar en el editor). */
export function unknownVariables(template: string): string[] {
  const known = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
  const sections = new Set(SECTIONS.map((s) => s.key));
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{([#^/]?)(\w+)\}\}/g)) {
    if (m[1] ? !sections.has(m[2]) : !known.has(m[2])) out.add(`{{${m[1]}${m[2]}}}`);
  }
  return [...out];
}

/** Plantilla a usar para un documento: la elegida, la por defecto de la inmobiliaria o el modelo de PropMatch. */
export function templatesFor(list: DocTemplate[] | undefined, kind: TemplateKind, dealKind: DealKind): DocTemplate[] {
  return (list ?? []).filter((t) => t.kind === kind && (t.deal_kind === null || t.deal_kind === dealKind));
}

export function defaultTemplateFor(list: DocTemplate[] | undefined, kind: TemplateKind, dealKind: DealKind): DocTemplate | null {
  const options = templatesFor(list, kind, dealKind);
  return options.find((t) => t.is_default) ?? null;
}

/* ── De la pantalla (contentEditable) a la plantilla ─────────────────────── */

/**
 * Convierte el documento editado en pantalla en una plantilla: las variables
 * que no se tocaron vuelven a ser `{{variable}}`; si el agente cambió el
 * valor a mano, queda el texto fijo. Las secciones ocultas se conservan.
 */
export function domToTemplate(root: HTMLElement): string {
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? "").replace(/ /g, " ");
    if (!(n instanceof HTMLElement)) return "";
    if (n.dataset.var !== undefined) {
      const val = n.dataset.val ?? "";
      return (n.textContent ?? "") === val ? `{{${n.dataset.var}}}` : (n.textContent ?? "");
    }
    if (n.dataset.raw !== undefined) return n.dataset.raw;
    if (n.tagName === "BR") return "\n";
    const inner = Array.from(n.childNodes).map(walk).join("");
    if ((n.tagName === "DIV" || n.tagName === "P") && n !== root) return `\n${inner}`;
    return inner;
  };

  const out: string[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child instanceof HTMLElement) {
      const t = child.dataset.block;
      if (t === "letterhead") continue;
      if (t === "sign") {
        out.push("{{firmas}}");
        continue;
      }
      const body = Array.from(child.childNodes).map(walk).join("").replace(/^\n+/, "");
      if (t === "title") out.push(`# ${body.trim()}`);
      else if (t === "note") out.push(`> ${body.trim()}`);
      else if (body.trim()) out.push(body.replace(/\n{2,}/g, "\n").trim());
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      out.push(child.textContent.trim());
    }
  }
  return out.join("\n\n");
}

/* ── Datos de ejemplo (vista previa en Configuración) ────────────────────── */

const party = (name: string, dni: string, address: string): DealParty => ({
  name,
  dni,
  cuit: "",
  civil_status: "soltero/a",
  nationality: "argentina",
  address,
  phone: "",
  email: "",
});

export function sampleContext(dealKind: DealKind, agencyName: string, agencyCity: string): DocContext {
  const today = new Date();
  const iso = (d: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() + d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const sale = dealKind === "venta";
  const deal = {
    kind: dealKind,
    client: party("María González", "30.123.456", "Av. Cabildo 2100, CABA"),
    owner: party("Jorge Pérez", "20.987.654", "Libertador 4500, CABA"),
    guarantor: party(sale ? "" : "Laura Gómez", "25.555.444", "Ciudad de la Paz 800, CABA"),
    price: sale ? 185000 : 650000,
    currency: sale ? "USD" : "ARS",
    commission_pct: sale ? 3 : 4.15,
    reserva_amount: sale ? 5000 : 300000,
    reserva_valid_until: iso(10),
    boleto_advance_pct: 30,
    escritura_date: iso(60),
    escribano: sale ? "Ana Ruiz" : "",
    contract_months: sale ? null : 24,
    start_date: iso(15),
    deposit_months: 1,
    update_rule: "",
    destination: "vivienda",
    payments: [
      { id: "s1", concept: "refuerzo", amount: sale ? 10000 : 200000, currency: sale ? "USD" : "ARS", paid_at: iso(-2), paid: true, due_date: iso(-2), receipt_text: "", notes: "", created_by: null, created_at: "" },
      { id: "s2", concept: "refuerzo", amount: sale ? 15000 : 150000, currency: sale ? "USD" : "ARS", paid_at: null, paid: false, due_date: iso(20), receipt_text: "", notes: "", created_by: null, created_at: "" },
    ],
  } as unknown as Deal;
  const property = {
    title: sale ? "Departamento 3 ambientes con balcón" : "Monoambiente luminoso en Palermo",
    street: sale ? "Ciudad de la Paz" : "Gorriti",
    street_number: sale ? "1550" : "4800",
    locality: sale ? "Belgrano" : "Palermo",
    province: "CABA",
    surface_total: sale ? 78 : 32,
  } as unknown as Property;
  return { deal, property, agencyName, agencyCity: agencyCity || "Buenos Aires", agentName: "Sofía Martínez" };
}

/* ── Lista de plantillas de la inmobiliaria ──────────────────────────────── */

const overlaps = (a: DealKind | null, b: DealKind | null) => a === null || b === null || a === b;

/** Agrega o reemplaza una plantilla. Si es la predeterminada, las otras del mismo tipo (y alcance) dejan de serlo. */
export function upsertTemplate(list: DocTemplate[] | undefined, tpl: DocTemplate): DocTemplate[] {
  const rest = (list ?? []).filter((t) => t.id !== tpl.id);
  const fixed = tpl.is_default
    ? rest.map((t) => (t.kind === tpl.kind && t.is_default && overlaps(t.deal_kind, tpl.deal_kind) ? { ...t, is_default: false } : t))
    : rest;
  return [...fixed, tpl];
}

export function newTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
