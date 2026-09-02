/** Tipos del dominio. Espejo del esquema en supabase/migrations. */

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
export type EventType = "visita" | "llamada" | "reunion" | "seguimiento";
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
}

export interface Property {
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
  is_featured: boolean;
  published_to_marketplace: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
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
