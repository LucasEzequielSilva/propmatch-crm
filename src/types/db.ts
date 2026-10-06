/** Tipos del dominio. Espejo del esquema en supabase/migrations. */

import type { AgencyBrand } from "../../shared/brand";

export type UserRole = "owner" | "admin" | "agente";
export type OperationType = "venta" | "alquiler" | "alquiler_temporal";
export type PropertyType = "casa" | "departamento" | "ph" | "terreno" | "local" | "oficina";
export type PropertyStatus =
  | "disponible"
  | "reservada"
  | "vendida"
  | "alquilada"
  | "pausada"
  | "en_revision";
export type CurrencyCode = "USD" | "ARS";
export type ContactStatus =
  | "nuevo"
  | "activo"
  | "en_seguimiento"
  | "visita_programada"
  | "cerrado"
  | "perdido";
export type ContactKind = "comprador" | "inquilino" | "propietario" | "inversor" | "otro";
export type ContactSource = "manual" | "web" | "portal" | "referido" | "consumer_app";
export type ClientProfile =
  | "inversor"
  | "primera_vivienda"
  | "familia"
  | "estudiante"
  | "profesional";
export type OpportunityStage =
  | "nuevos"
  | "contactados"
  | "visita"
  | "negociacion"
  | "cierre"
  | "perdida";
/** "publicacion" = recordatorio de subir algo a Instagram (lo crea el Estudio de Instagram). */
export type EventType = "visita" | "llamada" | "reunion" | "seguimiento" | "publicacion";
export type AuthorizationType = "exclusiva" | "no_exclusiva";
export type ActivityType =
  | "contacto_creado"
  | "contacto_actualizado"
  | "propiedad_publicada"
  | "visita_programada"
  | "match_creado"
  | "etapa_avanzada"
  | "mensaje"
  | "llamada"
  | "nota";

export interface Agency {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  province: string | null;
  created_at: string;
  /** Marca de la inmobiliaria (logo, colores, contacto). Ver shared/brand.ts y src/lib/branding.ts. */
  branding?: AgencyBrand | null;
  /** Plantillas de documentos propias de la inmobiliaria. Ver src/lib/docTemplates.ts. */
  doc_templates?: DocTemplate[];
}

/** Plantilla de documento guardada por la inmobiliaria: texto con variables ({{precio_letras}}), no valores. */
export interface DocTemplate {
  id: string;
  /** "reserva" | "boleto_compraventa" | "contrato_alquiler" (DocumentKind de src/lib/deals.ts). */
  kind: "reserva" | "boleto_compraventa" | "contrato_alquiler";
  name: string;
  /** Solo para la reserva: si vale para ventas, alquileres o las dos (`null`). */
  deal_kind: DealKind | null;
  text: string;
  /** La que se usa por defecto para ese tipo de documento. */
  is_default: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface Profile {
  id: string;
  agency_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  initials: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

export interface Contact {
  id: string;
  agency_id: string;
  owner_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  kind: ContactKind;
  status: ContactStatus;
  source: ContactSource;
  profile_type: ClientProfile | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** uuid del usuario real en la app, si este contacto vino de un lead real (`source: "consumer_app"`). */
  app_user_id?: string | null;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

export interface ContactRequirement {
  id: string;
  agency_id: string;
  contact_id: string;
  label: string | null;
  operation: OperationType;
  property_types: PropertyType[];
  zones: string[];
  budget_min: number | null;
  budget_max: number | null;
  currency: CurrencyCode;
  rooms_min: number | null;
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  surface_min: number | null;
  surface_max: number | null;
  features: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

export type PropertyLayout = "frente" | "contrafrente" | "lateral" | "interno";
export type PropertyOrientation = "N" | "NE" | "NO" | "S" | "SE" | "SO" | "E" | "O";

/**
 * Datos de la ficha que solo viven en el CRM (localStorage). No van a la app:
 * `buildAppPayload` arma su payload campo por campo y no los toca.
 *
 * Todos opcionales: las propiedades guardadas antes de que existieran se
 * siguen leyendo igual (sin definir = sin dato).
 */
export interface PropertyCrmDetails {
  /** Texto libre con sugerencias por tipo: "Chalet", "Monoambiente", "Lote en barrio cerrado"… */
  subtype?: string | null;
  toilettes?: number | null;
  surface_semicovered?: number | null;
  surface_uncovered?: number | null;
  layout?: PropertyLayout | null;
  orientation?: PropertyOrientation | null;
  /** Texto porque hay "PB", "EP", "11". */
  floor?: string | null;
  unit?: string | null;
  /** Moneda de `expenses`. Sin definir = ARS (lo que se asumía antes). */
  expenses_currency?: CurrencyCode | null;
  credit_eligible?: boolean | null;
  accepts_swap?: boolean | null;
  /**
   * CONFIDENCIAL: precio mínimo que acepta el propietario. Nunca sale del CRM:
   * no va a la ficha pública, ni a los CSV, ni al informe al propietario, ni a la app.
   */
  reserve_min_price?: number | null;
  reserve_min_currency?: CurrencyCode | null;
}

export interface Property extends PropertyCrmDetails {
  id: string;
  agency_id: string;
  owner_agent_id: string | null;
  owner_contact_id: string | null;
  title: string;
  description: string | null;
  type: PropertyType;
  operation: OperationType;
  status: PropertyStatus;
  street: string | null;
  street_number: string | null;
  locality: string | null;
  province: string | null;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  price: number | null;
  currency: CurrencyCode;
  expenses: number | null;
  taxes: number | null;
  commission_pct: number | null;
  surface_total: number | null;
  surface_covered: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  age_years: number | null;
  features: string[];
  /** Autorización firmada por el propietario. `null` = no hay. */
  authorization_type: AuthorizationType | null;
  /** `YYYY-MM-DD`. */
  authorization_expires_at: string | null;
  is_featured: boolean;
  published_to_marketplace: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** uuid de la fila real en la app (Supabase `properties`), si esta propiedad quedó publicada. `null`/sin definir = solo vive en el CRM. */
  app_property_id?: string | null;
  /** Estado de la sincronización con la app. Sin definir = todavía no se intentó. */
  sync_status?: "not_publishable" | "synced" | "syncing" | "error";
  /** La agencia tiene las llaves de la propiedad. Sin definir = no se cargó. */
  keys_custody?: boolean;
  /**
   * Dato de ejemplo (semilla para conocer PropMatch). Solo vive en el navegador:
   * nunca se sincroniza con la app, ni se publica, ni se manda a nadie. Editarlo
   * no lo vuelve real. Ver src/lib/samples.ts.
   */
  is_sample?: boolean;
}

export interface PropertyPhoto {
  id: string;
  agency_id: string;
  property_id: string;
  storage_path: string;
  position: number;
  is_cover: boolean;
  created_at: string;
}

export interface PropertyMatchPrefs {
  property_id: string;
  agency_id: string;
  budget_min: number | null;
  budget_max: number | null;
  client_profiles: ClientProfile[];
  target_features: string[];
  updated_at: string;
}

export interface Match {
  id: string;
  agency_id: string;
  contact_id: string;
  requirement_id: string;
  property_id: string;
  score: number;
  score_location: number;
  score_budget: number;
  score_type: number;
  score_size: number;
  score_features: number;
  reasons: string[];
  origin: "crm" | "consumer";
  is_reviewed: boolean;
  is_dismissed: boolean;
  created_at: string;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

export interface Opportunity {
  id: string;
  agency_id: string;
  contact_id: string;
  property_id: string | null;
  match_id: string | null;
  owner_id: string | null;
  stage: OpportunityStage;
  value: number | null;
  currency: CurrencyCode;
  is_priority: boolean;
  priority_note: string | null;
  stage_since: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

export interface Activity {
  id: string;
  agency_id: string;
  actor_id: string | null;
  type: ActivityType;
  title: string;
  detail: string | null;
  contact_id: string | null;
  property_id: string | null;
  opportunity_id: string | null;
  created_at: string;
  /** uuid de la oferta real en la app, solo si esta actividad es "Oferta recibida desde la app". */
  app_offer_id?: string | null;
  /** Estado de esa oferta tal como la dejó el CRM al responderla. `null`/sin definir = no es una oferta o no se respondió. */
  offer_status?: "pending" | "accepted" | "rejected" | null;
  /** uuid del swipe real en la app, solo si esta actividad es "Le interesó tu propiedad en la app". */
  app_swipe_id?: string | null;
  swipe_status?: "pending" | "accepted" | "rejected" | null;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

export interface CalendarEvent {
  id: string;
  agency_id: string;
  owner_id: string | null;
  type: EventType;
  title: string;
  contact_id: string | null;
  property_id: string | null;
  opportunity_id: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  created_at: string;
  /** Solo visitas. Sin definir en una visita = "por_confirmar". */
  status?: VisitStatus;
  /** Cómo salió la visita, cargado por el agente después. */
  feedback?: VisitFeedback | null;
  /** Checklist manual de coordinación (ISO de cuándo se tildó). */
  checklist?: VisitChecklist;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

/* ── Agenda: estado y feedback de visitas ─────────────────────────────────── */

export type VisitStatus = "por_confirmar" | "confirmada" | "realizada" | "reprogramada" | "no_show" | "cancelada";
export type VisitHappened = "si" | "reprogramada" | "no_show";
export type VisitInterest = "alto" | "medio" | "descarto";
export type VisitNextAction = "carta_oferta" | "segunda_visita" | "enviar_alternativas" | "tasacion_parte_pago" | "otra";

export interface VisitFeedback {
  happened: VisitHappened;
  interest: VisitInterest | null;
  next_action: VisitNextAction | null;
  notes: string | null;
  saved_at: string;
}

export interface VisitChecklist {
  reminder_sent_at?: string;
  location_sent_at?: string;
}

export interface Task {
  id: string;
  agency_id: string;
  owner_id: string | null;
  text: string;
  is_priority: boolean;
  is_done: boolean;
  due_date: string | null;
  contact_id: string | null;
  created_at: string;
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

/* ── Vistas compuestas que usan las pantallas ─────────────────────────────── */

export interface MatchWithRelations extends Match {
  contact: Pick<Contact, "id" | "full_name" | "phone" | "email">;
  requirement: Pick<
    ContactRequirement,
    "id" | "operation" | "property_types" | "zones" | "budget_min" | "budget_max" | "currency"
  >;
  property: Pick<
    Property,
    "id" | "title" | "type" | "price" | "currency" | "zone" | "locality" | "rooms" | "surface_total"
  > & { cover_url: string | null };
}

export interface OpportunityWithRelations extends Opportunity {
  contact: Pick<Contact, "id" | "full_name">;
  property: Pick<Property, "id" | "title" | "type"> | null;
  match_score: number | null;
}

/**
 * Oferta real hecha desde la app sobre una propiedad de la agencia. Es la
 * fuente de verdad para el Dashboard, la pantalla de Ofertas y la ficha de
 * la propiedad — la actividad en el historial del contacto solo enlaza acá
 * por `app_offer_id`, no duplica el estado.
 */
export interface AppOffer {
  id: string;
  /** uuid de la oferta real en Supabase (`offers.id`). */
  app_offer_id: string;
  contact_id: string;
  property_id: string;
  amount_usd: number;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  /**
   * Oferta de ejemplo: NO existe en la app (su `app_offer_id` es inventado).
   * Aceptarla o rechazarla se resuelve solo en el navegador (store.respondOffer).
   */
  is_sample?: boolean;
}

/* ── Operaciones (expediente de una venta o un alquiler) ──────────────────── */

export type DealKind = "venta" | "alquiler";
export type DealStatus = "en_curso" | "cerrada" | "caida";

/** Datos de una persona tal como van en el contrato. */
export interface DealParty {
  name: string;
  dni: string;
  cuit: string;
  civil_status: string;
  nationality: string;
  address: string;
  phone: string;
  email: string;
}

export interface Deal {
  id: string;
  agency_id: string;
  kind: DealKind;
  status: DealStatus;
  opportunity_id: string | null;
  property_id: string | null;
  /** Comprador o inquilino. */
  client_contact_id: string | null;
  /** Vendedor o propietario. */
  owner_contact_id: string | null;
  client: DealParty;
  owner: DealParty;
  guarantor: DealParty;
  /** Precio de venta, o alquiler mensual. */
  price: number | null;
  currency: CurrencyCode;
  commission_pct: number | null;
  /** Reserva */
  reserva_amount: number | null;
  /** `YYYY-MM-DD` */
  reserva_valid_until: string | null;
  /** Venta: % del precio que se paga al firmar el boleto. */
  boleto_advance_pct: number | null;
  /** `YYYY-MM-DD` */
  escritura_date: string | null;
  escribano: string;
  /** Alquiler */
  contract_months: number | null;
  start_date: string | null;
  deposit_months: number | null;
  update_rule: string;
  destination: string;
  /** Estado de cada paso y de cada documento, por id. Antes eran `boolean` (se migran al cargar). */
  steps: Record<string, DealCheck>;
  docs: Record<string, DealDocState>;
  notes: string;
  created_at: string;
  updated_at: string;
  /* ── Deal room (fase 1, localStorage). Misma forma que supabase/drafts/deal_room.sql. ── */
  /** Correlativo por agencia (`deals.deal_number`). Se muestra como `PM-0007`. */
  number: number;
  /** Etapa derivada de los pasos (`deals.stage`). La recalcula el store en cada cambio. */
  stage: DealStage;
  stage_since: string;
  created_by: string | null;
  /** Agente responsable (`deals.responsible_user_id`) y co-agente opcional. */
  responsible_id: string | null;
  co_agent_id: string | null;
  /** `YYYY-MM-DD`. Cierre estimado (`deals.expected_close_date`). */
  expected_close_date: string | null;
  /** `YYYY-MM-DD`. Firma del boleto (venta) o del contrato (alquiler). */
  signing_date: string | null;
  /** Contacto del escribano (el nombre sigue en `escribano`). */
  escribano_phone: string;
  escribano_email: string;
  /** Firma en papel por parte (`client`, `owner`, `guarantor`). */
  signatures: Partial<Record<DealPartyRole, DealSignature>>;
  payments: DealPayment[];
  commission: DealCommission;
  /** Ids de eventos de Agenda creados desde la operación. */
  event_ids: string[];
  /** Historial: solo se agrega (`deal_events`). */
  events: DealEvent[];
  /** Dato de ejemplo: solo vive en el navegador (ver src/lib/samples.ts). */
  is_sample?: boolean;
}

/** Etapas de `deals.stage` que usa el CRM hoy (sin firma electrónica). */
export type DealStage =
  | "negociacion"
  | "reserva"
  | "documentacion"
  | "contrato"
  | "firma"
  | "cierre"
  | "completada"
  | "caida";

export type DealPartyRole = "client" | "owner" | "guarantor";

/** Un paso tildado: cuándo y quién. */
export interface DealCheck {
  done: boolean;
  /** ISO. `null` en datos viejos (antes solo se guardaba el tilde). */
  at: string | null;
  /** Id del perfil que lo tildó. */
  by: string | null;
  note: string | null;
}

/** `deal_documents.status` sin archivo: en fase 1 no se suben archivos. */
export type DealDocStatus = "pendiente" | "recibido" | "validado" | "vencido";

export interface DealDocState extends DealCheck {
  status: DealDocStatus;
  /** `YYYY-MM-DD` */
  expires_at: string | null;
  validated_by: string | null;
}

export interface DealSignature {
  signed: boolean;
  /** `YYYY-MM-DD` en que firmó en papel. */
  date: string | null;
  by: string | null;
  at: string | null;
}

/** `deal_payments` (registro administrativo, no mueve dinero). */
export type DealPaymentConcept = "reserva" | "refuerzo" | "anticipo" | "saldo" | "comision";

export interface DealPayment {
  id: string;
  concept: DealPaymentConcept;
  amount: number;
  currency: CurrencyCode;
  /** `YYYY-MM-DD` */
  paid_at: string | null;
  /** `YYYY-MM-DD`. Fecha prevista (refuerzos y pagos programados). */
  due_date?: string | null;
  /** `false` = programado, todavía no se pagó (no suma a lo pagado). Sin el campo = pagado (datos viejos). */
  paid?: boolean;
  receipt_text: string;
  notes: string;
  created_by: string | null;
  created_at: string;
}

/** `deal_commissions` + `deal_commission_splits`. */
export interface DealCommission {
  buyer_mode: "percent" | "fixed";
  buyer_value: number;
  seller_mode: "percent" | "fixed";
  seller_value: number;
  expenses: number;
  splits: { user_id: string; share_pct: number }[];
}

export type DealEventType =
  | "created"
  | "stage_changed"
  | "status_changed"
  | "step"
  | "document"
  | "signature"
  | "payment"
  | "calendar"
  | "note"
  | "updated";

/** `deal_events`: no se edita ni se borra. */
export interface DealEvent {
  id: string;
  type: DealEventType;
  title: string;
  detail: string | null;
  actor_id: string | null;
  created_at: string;
}

export type PublicationChannel =
  | "mercadolibre"
  | "zonaprop"
  | "argenprop"
  | "cabaprop"
  | "facebook"
  | "instagram"
  | "web";
export type PublicationStatus = "draft" | "pending" | "published" | "error" | "paused" | "removed";

/** Una publicación externa de una propiedad (`property_publications`). La propiedad sigue siendo la fuente de verdad. */
export interface PropertyPublication {
  id: string;
  agency_id: string;
  property_id: string;
  channel: PublicationChannel;
  status: PublicationStatus;
  external_id: string | null;
  external_url: string | null;
  error_message: string | null;
  published_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}
