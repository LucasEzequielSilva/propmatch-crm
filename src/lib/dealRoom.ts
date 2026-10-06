/**
 * Deal room (fase 1): etapas, migración de datos viejos, historial, firmas,
 * pagos y comisiones de una operación.
 *
 * Todo vive en localStorage con la MISMA forma que el borrador
 * `supabase/drafts/deal_room.sql` (deal_number, stage, deal_events,
 * deal_documents, deal_payments, deal_commissions + splits), para que migrar
 * a la base después sea copiar campos, no rediseñar.
 */

import { isPaymentPaid, salePlan } from "./refuerzos";
import type {
  Contact,
  ContactSource,
  Deal,
  DealCheck,
  DealCommission,
  DealDocState,
  DealDocStatus,
  DealEvent,
  DealEventType,
  DealKind,
  DealParty,
  DealPartyRole,
  DealPayment,
  DealPaymentConcept,
  DealStage,
  Profile,
  Property,
  UserRole,
} from "@/types/db";
import { DEAL_DOCS, DEAL_STEPS, type ChecklistItem } from "@/lib/deals";
import { parseLocalDate } from "@/lib/authorization";

/* ── Número ──────────────────────────────────────────────────────────────── */

/** 7 -> "PM-0007" */
export function dealNumberLabel(n: number | null | undefined): string {
  if (!n) return "PM-—";
  return `PM-${String(n).padStart(4, "0")}`;
}

export function nextDealNumber(deals: Pick<Deal, "number">[]): number {
  return deals.reduce((max, d) => Math.max(max, d.number || 0), 0) + 1;
}

/* ── Etapas ──────────────────────────────────────────────────────────────── */

/** Etapas del stepper, en orden. `completada` y `caida` son finales. */
export const STAGE_FLOW: Exclude<DealStage, "completada" | "caida">[] = [
  "negociacion",
  "reserva",
  "documentacion",
  "contrato",
  "firma",
  "cierre",
];

/** Qué pasos de DEAL_STEPS forman cada etapa. */
export const STAGE_STEPS: Record<DealKind, Record<(typeof STAGE_FLOW)[number], string[]>> = {
  venta: {
    negociacion: ["autorizacion", "docs_inmueble", "publicacion", "oferta"],
    reserva: ["reserva", "aceptacion"],
    documentacion: ["titulos"],
    contrato: ["boleto"],
    firma: ["certificados", "escritura"],
    cierre: ["honorarios", "posventa"],
  },
  alquiler: {
    negociacion: ["autorizacion", "publicacion", "visita", "oferta"],
    reserva: ["reserva"],
    documentacion: ["analisis"],
    contrato: ["contrato"],
    firma: ["firma"],
    cierre: ["entrega", "honorarios", "seguimiento"],
  },
};

export const STAGE_LABEL: Record<DealKind, Record<DealStage, string>> = {
  venta: {
    negociacion: "Negociación",
    reserva: "Reserva",
    documentacion: "Documentación",
    contrato: "Boleto",
    firma: "Escritura",
    cierre: "Cierre",
    completada: "Completada",
    caida: "Caída",
  },
  alquiler: {
    negociacion: "Negociación",
    reserva: "Reserva",
    documentacion: "Documentación",
    contrato: "Contrato",
    firma: "Firma",
    cierre: "Entrega y cierre",
    completada: "Completada",
    caida: "Caída",
  },
};

/** Estado legible del header: qué está pendiente ahora. */
export const STAGE_STATUS_TEXT: Record<DealKind, Record<DealStage, string>> = {
  venta: {
    negociacion: "En negociación",
    reserva: "Reserva en curso",
    documentacion: "Estudio de títulos pendiente",
    contrato: "Firma de boleto pendiente",
    firma: "Escritura pendiente",
    cierre: "Cobro de comisión y posventa",
    completada: "Operación completada",
    caida: "Operación caída",
  },
  alquiler: {
    negociacion: "En negociación",
    reserva: "Reserva en curso",
    documentacion: "Análisis del inquilino pendiente",
    contrato: "Contrato en redacción",
    firma: "Firma del contrato pendiente",
    cierre: "Entrega de llaves y cierre",
    completada: "Operación completada",
    caida: "Operación caída",
  },
};

/** Acepta el formato nuevo y el viejo (`true`). */
export function isChecked(v: unknown): boolean {
  if (v === true) return true;
  return !!v && typeof v === "object" && (v as { done?: unknown }).done === true;
}

/** Etapa actual derivada de los pasos y del estado (cerrada/caída se respetan). */
export function deriveStage(deal: Pick<Deal, "kind" | "status" | "steps">): DealStage {
  if (deal.status === "caida") return "caida";
  if (deal.status === "cerrada") return "completada";
  const groups = STAGE_STEPS[deal.kind];
  for (const stage of STAGE_FLOW) {
    if (groups[stage].some((id) => !isChecked(deal.steps[id]))) return stage;
  }
  return "completada";
}

export interface StageInfo {
  stage: (typeof STAGE_FLOW)[number];
  label: string;
  steps: ChecklistItem[];
  done: number;
  total: number;
  /** ISO de cuándo se tildó el último paso de la etapa (si está completa y hay fecha). */
  completedAt: string | null;
  state: "done" | "current" | "todo";
}

export function stagesOf(deal: Deal): StageInfo[] {
  const current = deal.stage ?? deriveStage(deal);
  const currentIdx = STAGE_FLOW.indexOf(current as (typeof STAGE_FLOW)[number]);
  const all = DEAL_STEPS[deal.kind];
  return STAGE_FLOW.map((stage, i) => {
    const ids = STAGE_STEPS[deal.kind][stage];
    const steps = all.filter((s) => ids.includes(s.id));
    const done = steps.filter((s) => isChecked(deal.steps[s.id])).length;
    const complete = done === steps.length;
    const dates = steps.map((s) => deal.steps[s.id]?.at).filter((x): x is string => !!x);
    const completedAt = complete && dates.length ? dates.sort().at(-1)! : null;
    let state: StageInfo["state"];
    if (current === "completada") state = "done";
    else if (current === "caida") state = complete ? "done" : "todo";
    else state = i < currentIdx || (complete && i !== currentIdx) ? "done" : i === currentIdx ? "current" : "todo";
    return { stage, label: STAGE_LABEL[deal.kind][stage], steps, done, total: steps.length, completedAt, state };
  });
}

/* ── Documentos ──────────────────────────────────────────────────────────── */

export const DOC_STATUS_LABEL: Record<DealDocStatus, string> = {
  pendiente: "Pendiente",
  recibido: "Recibido",
  validado: "Validado",
  vencido: "Vencido",
};

export function emptyCheck(): DealCheck {
  return { done: false, at: null, by: null, note: null };
}

export function emptyDocState(): DealDocState {
  return { ...emptyCheck(), status: "pendiente", expires_at: null, validated_by: null };
}

/** Un documento recibido o validado cuyo vencimiento ya pasó se muestra como vencido. */
export function effectiveDocStatus(d: DealDocState | undefined, today = todayInput()): DealDocStatus {
  if (!d) return "pendiente";
  if ((d.status === "recibido" || d.status === "validado") && d.expires_at && d.expires_at < today) return "vencido";
  return d.status;
}

export function docLabel(kind: DealKind, id: string): string {
  for (const g of DEAL_DOCS[kind]) {
    const it = g.items.find((i) => i.id === id);
    if (it) return it.label;
  }
  return id;
}

/* ── Partes ──────────────────────────────────────────────────────────────── */

export function partyRoleLabel(kind: DealKind, role: DealPartyRole): string {
  if (role === "guarantor") return "Garante";
  if (role === "client") return kind === "venta" ? "Comprador" : "Inquilino";
  return kind === "venta" ? "Vendedor" : "Propietario";
}

/** A quién se le reclama cada paso. `escribano` = el contacto del escribano. */
export type ReminderTarget = DealPartyRole | "escribano";

const STEP_TARGET: Record<string, ReminderTarget> = {
  autorizacion: "owner",
  docs_inmueble: "owner",
  oferta: "client",
  visita: "client",
  reserva: "client",
  aceptacion: "owner",
  titulos: "escribano",
  certificados: "escribano",
  boleto: "client",
  escritura: "client",
  analisis: "client",
  contrato: "owner",
  firma: "client",
  entrega: "client",
  honorarios: "client",
};

export function stepTarget(stepId: string): ReminderTarget | null {
  return STEP_TARGET[stepId] ?? null;
}

const DOC_GROUP_TARGET: Record<string, ReminderTarget> = {
  vendedor: "owner",
  propietario: "owner",
  inmueble: "owner",
  comprador: "client",
  inquilino: "client",
  garantia: "guarantor",
  operacion: "client",
};

export function docTarget(groupId: string): ReminderTarget {
  return DOC_GROUP_TARGET[groupId] ?? "client";
}

export function targetContact(deal: Deal, target: ReminderTarget): { name: string; phone: string; email: string } {
  if (target === "escribano") return { name: deal.escribano, phone: deal.escribano_phone, email: deal.escribano_email };
  const p: DealParty = deal[target === "client" ? "client" : target === "owner" ? "owner" : "guarantor"];
  return { name: p.name, phone: p.phone, email: p.email };
}

/* ── Contacto / plantillas ───────────────────────────────────────────────── */

export const CONTACT_SOURCE_LABEL: Record<ContactSource, string> = {
  manual: "Carga manual",
  web: "Sitio web",
  portal: "Portal",
  referido: "Referido",
  consumer_app: "App PropMatch",
};

/** Mensaje de WhatsApp para el cliente según la etapa. */
export function stageMessage(deal: Deal, propertyTitle: string, name: string): string {
  const hola = name ? `Hola ${name.trim().split(/\s+/)[0]}` : "Hola";
  const isSale = deal.kind === "venta";
  switch (deal.stage) {
    case "negociacion":
      return `${hola}, ¿cómo estás? Te escribo por ${propertyTitle}. ¿Pudiste pensar la propuesta? Quedo atento.`;
    case "reserva":
      return `${hola}, te escribo por la reserva de ${propertyTitle}. ¿Coordinamos la firma y la entrega de la señal?`;
    case "documentacion":
      return `${hola}, para avanzar con ${propertyTitle} nos falta reunir documentación. ¿Me la podés enviar cuando puedas?`;
    case "contrato":
      return isSale
        ? `${hola}, estamos preparando el boleto de ${propertyTitle}. ¿Te parece si coordinamos día y hora para la firma?`
        : `${hola}, estamos preparando el contrato de ${propertyTitle}. Te lo paso para que lo revises.`;
    case "firma":
      return isSale
        ? `${hola}, te escribo para coordinar la escritura de ${propertyTitle}${deal.escritura_date ? ` (prevista para el ${shortDate(deal.escritura_date)})` : ""}.`
        : `${hola}, te escribo para coordinar la firma del contrato de ${propertyTitle}.`;
    case "cierre":
      return `${hola}, ¡gracias por confiar en nosotros con ${propertyTitle}! Cualquier cosa que necesites, acá estoy.`;
    default:
      return `${hola}, te escribo por ${propertyTitle}.`;
  }
}

/** Mensaje para recordar un paso o un documento pendiente. */
export function reminderMessage(name: string, what: string, propertyTitle: string): string {
  const hola = name ? `Hola ${name.trim().split(/\s+/)[0]}` : "Hola";
  return `${hola}, ¿cómo estás? Para avanzar con ${propertyTitle} nos queda pendiente: ${what}. ¿Lo podemos ver esta semana? ¡Gracias!`;
}

/* ── Fechas ──────────────────────────────────────────────────────────────── */

export function todayInput(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "05/10" o "05/10/2026" si es de otro año. Acepta `YYYY-MM-DD` o ISO. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = value.length === 10 ? parseLocalDate(value) : new Date(value);
  const dm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return d.getFullYear() === new Date().getFullYear() ? dm : `${dm}/${d.getFullYear()}`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${shortDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Días corridos hasta una fecha `YYYY-MM-DD` (negativo = ya pasó). */
export function daysUntil(date: string, now = new Date()): number {
  const target = parseLocalDate(date);
  const today = parseLocalDate(todayInput(now));
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Días hábiles (lunes a viernes) desde hoy hasta la fecha. NO descuenta feriados. */
export function businessDaysUntil(date: string, now = new Date()): number {
  const target = parseLocalDate(date);
  const cur = parseLocalDate(todayInput(now));
  const sign = target >= cur ? 1 : -1;
  let count = 0;
  while (cur.getTime() !== target.getTime()) {
    cur.setDate(cur.getDate() + sign);
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) count += sign;
  }
  return count;
}

/* ── Plata ───────────────────────────────────────────────────────────────── */

export const PAYMENT_CONCEPT_LABEL: Record<DealPaymentConcept, string> = {
  reserva: "Reserva",
  refuerzo: "Refuerzo",
  anticipo: "Anticipo",
  saldo: "Saldo",
  comision: "Comisión",
};

/** Base sobre la que se calcula la comisión: precio (venta) o valor total del contrato (alquiler). */
export function commissionBase(deal: Deal): number | null {
  if (deal.price === null) return null;
  if (deal.kind === "venta") return deal.price;
  return deal.price * (deal.contract_months ?? 24);
}

function side(mode: "percent" | "fixed", value: number, base: number | null): number {
  if (mode === "fixed") return value || 0;
  return base !== null ? (base * (value || 0)) / 100 : 0;
}

export interface FinanceSummary {
  price: number | null;
  pricePerM2: number | null;
  /** Plan de pago como en el boleto (solo venta). */
  advanceTotal: number | null;
  balanceAtDeed: number | null;
  /** Lo pagado por el cliente (reserva, refuerzo, anticipo, saldo) en la moneda de la operación. */
  paidByClient: number;
  /** Lo que falta pagar del precio (venta). */
  pendingPrice: number | null;
  commissionBuyer: number;
  commissionSeller: number;
  commissionGross: number;
  commissionCollected: number;
  commissionPending: number;
  netAgency: number;
  splits: { user_id: string; share_pct: number; amount: number }[];
  /** Pagos en otra moneda: no se suman (no hay tipo de cambio). */
  otherCurrency: DealPayment[];
  /** Refuerzos de reserva (en la moneda de la operación): total y lo ya pagado. */
  refuerzosTotal: number;
  refuerzosPaid: number;
}

export function financeSummary(deal: Deal, property: Property | undefined): FinanceSummary {
  // Los programados (refuerzos a futuro, `paid: false`) no suman a lo pagado.
  const paidPayments = deal.payments.filter(isPaymentPaid);
  const sameCur = paidPayments.filter((p) => p.currency === deal.currency);
  const otherCurrency = paidPayments.filter((p) => p.currency !== deal.currency);
  const sum = (xs: DealPayment[]) => xs.reduce((a, p) => a + (p.amount || 0), 0);
  const paidByClient = sum(sameCur.filter((p) => p.concept !== "comision"));
  const commissionCollected = sum(sameCur.filter((p) => p.concept === "comision"));

  const isSale = deal.kind === "venta";
  // Con refuerzos, el anticipo total nunca es menor que reserva + refuerzos (ver src/lib/refuerzos.ts).
  const plan = salePlan(deal);
  const advanceTotal = isSale ? plan.advanceTotal : null;
  const balanceAtDeed = isSale ? plan.balance : null;
  const pendingPrice = isSale && deal.price !== null ? Math.max(deal.price - paidByClient, 0) : null;
  const surface = property?.surface_covered || property?.surface_total || null;
  const pricePerM2 = isSale && deal.price !== null && surface ? deal.price / surface : null;

  const base = commissionBase(deal);
  const c = deal.commission;
  const commissionBuyer = side(c.buyer_mode, c.buyer_value, base);
  const commissionSeller = side(c.seller_mode, c.seller_value, base);
  const commissionGross = commissionBuyer + commissionSeller;
  const netAgency = commissionGross - (c.expenses || 0);
  return {
    price: deal.price,
    pricePerM2,
    advanceTotal,
    balanceAtDeed,
    paidByClient,
    pendingPrice,
    commissionBuyer,
    commissionSeller,
    commissionGross,
    commissionCollected,
    commissionPending: Math.max(commissionGross - commissionCollected, 0),
    netAgency,
    splits: c.splits.map((s) => ({ ...s, amount: (netAgency * s.share_pct) / 100 })),
    otherCurrency,
    refuerzosTotal: plan.refuerzos,
    refuerzosPaid: plan.refuerzosPaid,
  };
}

/* ── Permisos (visuales: en localStorage no protegen nada) ──────────────── */

export function isAdminRole(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

/** Plata y datos legales: admin/dueño o responsable de la operación. */
export function canSeeSensitive(deal: Pick<Deal, "responsible_id">, profile: Pick<Profile, "id" | "role">): boolean {
  return isAdminRole(profile.role) || deal.responsible_id === profile.id;
}

/* ── Historial ───────────────────────────────────────────────────────────── */

let seq = 0;
export function dealUid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

export function makeEvent(type: DealEventType, title: string, detail: string | null, actorId: string | null, at?: string): DealEvent {
  return { id: dealUid("de"), type, title, detail, actor_id: actorId, created_at: at ?? new Date().toISOString() };
}

export const EVENT_TYPE_LABEL: Record<DealEventType, string> = {
  created: "Alta",
  stage_changed: "Etapa",
  status_changed: "Estado",
  step: "Paso",
  document: "Documento",
  signature: "Firma",
  payment: "Pago",
  calendar: "Agenda",
  note: "Nota",
  updated: "Datos",
};

/** Campos que, si cambian sin un evento explícito, dejan un "Datos actualizados". */
const TRACKED_FIELDS: Partial<Record<keyof Deal, string>> = {
  price: "precio",
  currency: "moneda",
  commission_pct: "comisión (%)",
  reserva_amount: "monto de la reserva",
  reserva_valid_until: "vencimiento de la reserva",
  boleto_advance_pct: "anticipo",
  escritura_date: "fecha de escritura",
  escribano: "escribano",
  contract_months: "plazo",
  start_date: "inicio del contrato",
  deposit_months: "depósito",
  update_rule: "actualización",
  destination: "destino",
  client: "datos del cliente",
  owner: "datos del propietario",
  guarantor: "datos del garante",
  responsible_id: "responsable",
  co_agent_id: "co-agente",
  expected_close_date: "cierre estimado",
  signing_date: "fecha de firma",
  commission: "comisión",
};

export function trackedChanges(patch: Partial<Deal>): string[] {
  return (Object.keys(patch) as (keyof Deal)[]).map((k) => TRACKED_FIELDS[k]).filter((x): x is string => !!x);
}

/**
 * Aplica un cambio como lo haría la base: recalcula la etapa, y agrega al
 * historial el evento explícito, el cambio de etapa y de estado. Las
 * ediciones de datos sin evento se agrupan: no deja una fila por tecla.
 */
export function applyDealPatch(
  prev: Deal,
  patch: Partial<Deal>,
  actorId: string | null,
  event?: { type: DealEventType; title: string; detail?: string | null },
): Deal {
  const nowIso = new Date().toISOString();
  const next: Deal = { ...prev, ...patch, updated_at: nowIso };
  const events: DealEvent[] = [...(prev.events ?? [])];
  if (event) events.push(makeEvent(event.type, event.title, event.detail ?? null, actorId, nowIso));
  if (patch.status && patch.status !== prev.status) {
    const label = { en_curso: "en curso", cerrada: "cerrada", caida: "caída" }[patch.status];
    events.push(makeEvent("status_changed", `Operación marcada como ${label}`, null, actorId, nowIso));
  }
  const stage = deriveStage(next);
  if (stage !== prev.stage) {
    next.stage = stage;
    next.stage_since = nowIso;
    events.push(
      makeEvent(
        "stage_changed",
        `Etapa: ${STAGE_LABEL[next.kind][prev.stage] ?? prev.stage} → ${STAGE_LABEL[next.kind][stage]}`,
        null,
        actorId,
        nowIso,
      ),
    );
  }
  if (!event) {
    const fields = trackedChanges(patch);
    if (fields.length) {
      const title = `Editó ${fields.join(", ")}`;
      const last = events[events.length - 1];
      const recent = last && last.type === "updated" && last.title === title && last.actor_id === actorId &&
        Date.now() - new Date(last.created_at).getTime() < 10 * 60_000;
      if (!recent) events.push(makeEvent("updated", title, null, actorId, nowIso));
    }
  }
  next.events = events;
  return next;
}

/* ── Migración de datos viejos ───────────────────────────────────────────── */

function defaultCommission(deal: Partial<Deal>): DealCommission {
  const pct = deal.commission_pct ?? 0;
  return {
    buyer_mode: "percent",
    buyer_value: pct,
    seller_mode: "percent",
    seller_value: deal.kind === "venta" ? pct : 0,
    expenses: 0,
    splits: [],
  };
}

function migrateCheck(v: unknown): DealCheck {
  if (v && typeof v === "object") {
    const o = v as Partial<DealCheck>;
    return { done: !!o.done, at: o.at ?? null, by: o.by ?? null, note: o.note ?? null };
  }
  return { done: v === true, at: null, by: null, note: null };
}

function migrateDoc(v: unknown): DealDocState {
  const base = migrateCheck(v);
  const o = (v && typeof v === "object" ? v : {}) as Partial<DealDocState>;
  const status: DealDocStatus = o.status ?? (base.done ? "recibido" : "pendiente");
  return { ...base, done: status === "recibido" || status === "validado", status, expires_at: o.expires_at ?? null, validated_by: o.validated_by ?? null };
}

/** Campos nuevos con valores por defecto para un deal recién creado. */
export function dealRoomDefaults(input: Partial<Deal>, actorId: string | null, number: number, nowIso: string) {
  const responsible = input.responsible_id !== undefined ? input.responsible_id : actorId;
  return {
    number,
    stage: "negociacion" as DealStage,
    stage_since: nowIso,
    created_by: actorId,
    responsible_id: responsible,
    co_agent_id: input.co_agent_id ?? null,
    expected_close_date: input.expected_close_date ?? null,
    signing_date: input.signing_date ?? null,
    escribano_phone: input.escribano_phone ?? "",
    escribano_email: input.escribano_email ?? "",
    signatures: input.signatures ?? {},
    payments: input.payments ?? [],
    // Sin co-agente, el reparto interno es 100% del responsable.
    commission: input.commission ?? { ...defaultCommission(input), splits: responsible ? [{ user_id: responsible, share_pct: 100 }] : [] },
    event_ids: input.event_ids ?? [],
    events: input.events ?? [],
  };
}

/**
 * Datos guardados antes del deal room: pasos/documentos en `boolean`, sin
 * número ni historial. Es idempotente: un deal ya migrado queda igual.
 * Los números se asignan por fecha de creación, después del mayor existente.
 */
export function migrateDeals(raw: unknown[], opportunityOwner: (id: string | null) => string | null = () => null): Deal[] {
  const list = (raw as Partial<Deal>[]).filter(Boolean);
  let next = list.reduce((m, d) => Math.max(m, typeof d.number === "number" ? d.number : 0), 0);
  const order = [...list]
    .filter((d) => typeof d.number !== "number" || !d.number)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const numbers = new Map<Partial<Deal>, number>();
  for (const d of order) numbers.set(d, ++next);

  return list.map((d) => {
    const steps = Object.fromEntries(Object.entries(d.steps ?? {}).map(([k, v]) => [k, migrateCheck(v)]));
    const docs = Object.fromEntries(Object.entries(d.docs ?? {}).map(([k, v]) => [k, migrateDoc(v)]));
    const createdAt = d.created_at ?? new Date().toISOString();
    const defaults = dealRoomDefaults(
      { ...d, responsible_id: d.responsible_id !== undefined ? d.responsible_id : opportunityOwner(d.opportunity_id ?? null) },
      d.created_by ?? null,
      numbers.get(d) ?? (d.number as number),
      createdAt,
    );
    const merged = { ...defaults, ...d, steps, docs } as Deal;
    merged.number = numbers.get(d) ?? merged.number;
    merged.responsible_id = defaults.responsible_id;
    merged.commission = d.commission ? { ...defaultCommission(d), ...d.commission, splits: d.commission.splits ?? [] } : defaults.commission;
    if (!d.events) {
      const events: DealEvent[] = [makeEvent("created", "Operación iniciada", null, null, createdAt)];
      if (d.notes && d.notes.trim()) events.push(makeEvent("note", d.notes.trim(), "Notas anteriores al historial", null, d.updated_at ?? createdAt));
      merged.events = events;
    }
    merged.stage = deriveStage(merged);
    if (!d.stage_since || d.stage !== merged.stage) merged.stage_since = d.stage_since ?? createdAt;
    return merged;
  });
}

/* ── Helpers de UI compartidos ───────────────────────────────────────────── */

export function profileName(profiles: Profile[], id: string | null | undefined): string {
  if (!id) return "—";
  return profiles.find((p) => p.id === id)?.full_name ?? "Usuario";
}

export function contactSourceLabel(c: Contact | undefined): string | null {
  return c ? CONTACT_SOURCE_LABEL[c.source] ?? null : null;
}

