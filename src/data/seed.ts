/**
 * Datos de arranque.
 *
 * Son los mismos contactos, propiedades y operaciones que traía el prototipo
 * de Figma Make, pero unificados en un solo lugar y tipados con el modelo real.
 * En el prototipo cada pantalla tenía su propio array y no coincidían entre sí:
 * "Camila Torres" era "Sofía Torres" en Matches, "Carolina Méndez" era "Laura
 * Méndez" en Oportunidades, y Juan Pérez buscaba un lote pero le asignaban una
 * casa. Acá hay una sola fuente de verdad.
 *
 * Los scores NO están acá: se calculan en lib/matching.ts a partir de lo que
 * busca cada contacto y de lo que es cada propiedad.
 */

import type {
  Activity,
  Agency,
  CalendarEvent,
  Contact,
  ContactRequirement,
  Opportunity,
  Profile,
  Property,
  Task,
} from "@/types/db";

const AGENCY_ID = "ag-1";

/** Fechas relativas a hoy, para que la agenda y los feeds nunca queden viejos. */
const now = new Date();
const iso = (daysAgo: number, hour = 10, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
/** `YYYY-MM-DD` local a `days` días de hoy (negativo = pasado). */
const dateFromToday = (days: number) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Día de esta semana laboral (0 = lunes) a una hora dada. */
const weekday = (dayIndex: number, hour: number, minute = 0) => {
  const d = new Date(now);
  const offset = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - offset + dayIndex);
  d.setHours(Math.floor(hour), minute || (hour % 1) * 60, 0, 0);
  return d.toISOString();
};

export const seedAgency: Agency = {
  id: AGENCY_ID,
  name: "Inmobiliaria PropMatch",
  slug: "propmatch",
  logo_url: null,
  phone: "+54 221 400 0000",
  email: "hola@propmatch.com",
  city: "La Plata",
  province: "Buenos Aires",
  created_at: iso(120),
};

export const seedProfiles: Profile[] = [
  {
    id: "u-1",
    agency_id: AGENCY_ID,
    full_name: "Valen Martínez",
    email: "valen@propmatch.com",
    phone: "+54 221 400 0001",
    avatar_url: null,
    initials: "VM",
    role: "owner",
    is_active: true,
    created_at: iso(120),
  },
  {
    id: "u-2",
    agency_id: AGENCY_ID,
    full_name: "Martina López",
    email: "martina@propmatch.com",
    phone: null,
    avatar_url: null,
    initials: "ML",
    role: "agente",
    is_active: true,
    created_at: iso(90),
  },
  {
    id: "u-3",
    agency_id: AGENCY_ID,
    full_name: "Lucas Soria",
    email: "lucas@propmatch.com",
    phone: null,
    avatar_url: null,
    initials: "LS",
    role: "agente",
    is_active: true,
    created_at: iso(80),
  },
  {
    id: "u-4",
    agency_id: AGENCY_ID,
    full_name: "Sofía Vargas",
    email: "sofia@propmatch.com",
    phone: null,
    avatar_url: null,
    initials: "SV",
    role: "agente",
    is_active: true,
    created_at: iso(60),
  },
  {
    id: "u-5",
    agency_id: AGENCY_ID,
    full_name: "Diego Herrera",
    email: "diego.h@propmatch.com",
    phone: null,
    avatar_url: null,
    initials: "DH",
    role: "agente",
    is_active: true,
    created_at: iso(45),
  },
];

/** El usuario "logueado" mientras no haya backend. */
export const CURRENT_USER_ID = "u-1";

type ContactSeed = Omit<Contact, "agency_id" | "created_at" | "updated_at"> & {
  createdDaysAgo: number;
  updatedDaysAgo: number;
};

const contactSeeds: ContactSeed[] = [
  { id: "c-1", owner_id: "u-1", full_name: "Martín Rodríguez", email: "martin.rodriguez@email.com", phone: "+54 221 444 5566", kind: "comprador", status: "activo", source: "referido", profile_type: "familia", notes: "Busca mudarse antes de fin de año.", createdDaysAgo: 40, updatedDaysAgo: 0 },
  { id: "c-2", owner_id: "u-1", full_name: "Lucía Fernández", email: "lucia.fernandez@email.com", phone: "+54 221 555 7788", kind: "comprador", status: "activo", source: "web", profile_type: "profesional", notes: null, createdDaysAgo: 35, updatedDaysAgo: 1 },
  { id: "c-3", owner_id: "u-2", full_name: "Juan Pérez", email: "juan.perez@email.com", phone: "+54 221 666 3344", kind: "inversor", status: "nuevo", source: "portal", profile_type: "inversor", notes: "Quiere terreno para construir.", createdDaysAgo: 2, updatedDaysAgo: 0 },
  { id: "c-4", owner_id: "u-1", full_name: "Camila Torres", email: "camila.torres@email.com", phone: "+54 221 777 8899", kind: "comprador", status: "visita_programada", source: "referido", profile_type: "familia", notes: null, createdDaysAgo: 28, updatedDaysAgo: 0 },
  { id: "c-5", owner_id: "u-3", full_name: "Roberto Silva", email: "roberto.silva@email.com", phone: "+54 221 333 1122", kind: "comprador", status: "en_seguimiento", source: "manual", profile_type: "primera_vivienda", notes: null, createdDaysAgo: 50, updatedDaysAgo: 3 },
  { id: "c-6", owner_id: "u-2", full_name: "Valentina López", email: "valentina.lopez@email.com", phone: "+54 221 999 0011", kind: "comprador", status: "activo", source: "web", profile_type: "familia", notes: null, createdDaysAgo: 22, updatedDaysAgo: 0 },
  { id: "c-7", owner_id: "u-4", full_name: "Diego Morales", email: "diego.morales@email.com", phone: "+54 221 222 4455", kind: "comprador", status: "nuevo", source: "portal", profile_type: "estudiante", notes: null, createdDaysAgo: 1, updatedDaysAgo: 0 },
  { id: "c-8", owner_id: "u-1", full_name: "Federico Álvarez", email: "federico.alvarez@email.com", phone: "+54 221 411 2233", kind: "comprador", status: "nuevo", source: "web", profile_type: "profesional", notes: null, createdDaysAgo: 0, updatedDaysAgo: 0 },
  { id: "c-9", owner_id: "u-3", full_name: "Laura Méndez", email: "laura.mendez@email.com", phone: "+54 221 488 9911", kind: "comprador", status: "nuevo", source: "referido", profile_type: "familia", notes: null, createdDaysAgo: 0, updatedDaysAgo: 0 },
  { id: "c-10", owner_id: "u-2", full_name: "Pablo Soto", email: "pablo.soto@email.com", phone: "+54 221 470 5544", kind: "inversor", status: "nuevo", source: "portal", profile_type: "inversor", notes: null, createdDaysAgo: 0, updatedDaysAgo: 0 },
  { id: "c-11", owner_id: "u-4", full_name: "Sofía Guerrero", email: "sofia.guerrero@email.com", phone: "+54 221 466 7788", kind: "comprador", status: "en_seguimiento", source: "web", profile_type: "primera_vivienda", notes: null, createdDaysAgo: 12, updatedDaysAgo: 2 },
  { id: "c-12", owner_id: "u-5", full_name: "Ramiro Díaz", email: "ramiro.diaz@email.com", phone: "+54 221 455 6677", kind: "comprador", status: "en_seguimiento", source: "manual", profile_type: "familia", notes: null, createdDaysAgo: 15, updatedDaysAgo: 2 },
  { id: "c-13", owner_id: "u-1", full_name: "Carolina Méndez", email: "carolina.mendez@email.com", phone: "+54 221 433 2211", kind: "comprador", status: "visita_programada", source: "referido", profile_type: "profesional", notes: null, createdDaysAgo: 18, updatedDaysAgo: 3 },
  { id: "c-14", owner_id: "u-3", full_name: "Ana García", email: "ana.garcia@email.com", phone: "+54 221 499 3322", kind: "comprador", status: "activo", source: "web", profile_type: "primera_vivienda", notes: null, createdDaysAgo: 60, updatedDaysAgo: 1 },
  { id: "c-15", owner_id: "u-1", full_name: "Graciela Benítez", email: "graciela.benitez@email.com", phone: "+54 221 520 1144", kind: "propietario", status: "activo", source: "referido", profile_type: null, notes: "Dueña de dos propiedades. Prefiere que le escriban por WhatsApp.", createdDaysAgo: 90, updatedDaysAgo: 10 },
  { id: "c-16", owner_id: "u-2", full_name: "Hernán Castro", email: "hernan.castro@email.com", phone: "+54 221 531 7720", kind: "propietario", status: "activo", source: "manual", profile_type: null, notes: null, createdDaysAgo: 70, updatedDaysAgo: 7 },
  { id: "c-17", owner_id: "u-3", full_name: "Mirta Aguirre", email: null, phone: "+54 221 544 9087", kind: "propietario", status: "en_seguimiento", source: "referido", profile_type: null, notes: "La autorización venció: llamar para renovar.", createdDaysAgo: 200, updatedDaysAgo: 30 },
  { id: "c-18", owner_id: "u-5", full_name: "Oscar Pereyra", email: "oscar.pereyra@email.com", phone: "+54 221 558 3310", kind: "propietario", status: "activo", source: "portal", profile_type: null, notes: null, createdDaysAgo: 45, updatedDaysAgo: 5 },
];

export const seedContacts: Contact[] = contactSeeds.map((c) => {
  const { createdDaysAgo, updatedDaysAgo, ...rest } = c;
  return {
    ...rest,
    agency_id: AGENCY_ID,
    created_at: iso(createdDaysAgo),
    updated_at: iso(updatedDaysAgo, 14, 42),
  };
});

/**
 * Lo que busca cada contacto. Es la mitad de la ecuación del matching y es la
 * tabla que el prototipo no tenía: guardaba un solo `interest` y una sola
 * `zone` por persona, cuando en la realidad se busca en varias zonas y se
 * aceptan varios tipos.
 */
type ReqSeed = Omit<ContactRequirement, "agency_id" | "created_at" | "updated_at">;

const requirementSeeds: ReqSeed[] = [
  { id: "r-1", contact_id: "c-1", label: "Casa familiar", operation: "venta", property_types: ["casa"], zones: ["City Bell", "Gonnet"], budget_min: 150000, budget_max: 200000, currency: "USD", rooms_min: 4, bedrooms_min: 3, bathrooms_min: 2, surface_min: 150, surface_max: 300, features: ["Cochera", "Jardín"], is_active: true },
  { id: "r-2", contact_id: "c-2", label: "Depto céntrico", operation: "venta", property_types: ["departamento"], zones: ["La Plata Centro"], budget_min: 80000, budget_max: 120000, currency: "USD", rooms_min: 2, bedrooms_min: 2, bathrooms_min: 1, surface_min: 60, surface_max: null, features: ["Balcón", "Amenities"], is_active: true },
  { id: "r-3", contact_id: "c-3", label: "Terreno para construir", operation: "venta", property_types: ["terreno"], zones: ["Gonnet", "City Bell"], budget_min: 50000, budget_max: 80000, currency: "USD", rooms_min: null, bedrooms_min: null, bathrooms_min: null, surface_min: 300, surface_max: null, features: [], is_active: true },
  { id: "r-4", contact_id: "c-4", label: "Casa amplia", operation: "venta", property_types: ["casa"], zones: ["Los Hornos", "Gonnet", "Tolosa"], budget_min: 200000, budget_max: 300000, currency: "USD", rooms_min: 5, bedrooms_min: 4, bathrooms_min: 2, surface_min: 250, surface_max: null, features: ["Pileta", "Parque"], is_active: true },
  { id: "r-5", contact_id: "c-5", label: "PH con terraza", operation: "venta", property_types: ["ph"], zones: ["Berisso", "La Plata Norte"], budget_min: 90000, budget_max: 130000, currency: "USD", rooms_min: 3, bedrooms_min: 2, bathrooms_min: 1, surface_min: 100, surface_max: null, features: ["Terraza", "Parrilla"], is_active: true },
  { id: "r-6", contact_id: "c-6", label: "Casa en zona sur", operation: "venta", property_types: ["casa", "ph"], zones: ["Ensenada", "Tolosa"], budget_min: 120000, budget_max: 180000, currency: "USD", rooms_min: 3, bedrooms_min: 3, bathrooms_min: 2, surface_min: 140, surface_max: null, features: ["Patio"], is_active: true },
  { id: "r-7", contact_id: "c-7", label: "Depto chico", operation: "venta", property_types: ["departamento"], zones: ["La Plata Norte", "La Plata Centro"], budget_min: 60000, budget_max: 90000, currency: "USD", rooms_min: 2, bedrooms_min: 1, bathrooms_min: 1, surface_min: null, surface_max: null, features: ["Luminoso"], is_active: true },
  { id: "r-8", contact_id: "c-8", label: "Primer departamento", operation: "venta", property_types: ["departamento"], zones: ["La Plata Centro"], budget_min: 80000, budget_max: 110000, currency: "USD", rooms_min: 2, bedrooms_min: 2, bathrooms_min: 1, surface_min: null, surface_max: null, features: ["Balcón"], is_active: true },
  { id: "r-9", contact_id: "c-9", label: "Casa con jardín", operation: "venta", property_types: ["casa"], zones: ["Gonnet"], budget_min: 150000, budget_max: 200000, currency: "USD", rooms_min: 4, bedrooms_min: 3, bathrooms_min: 2, surface_min: 180, surface_max: null, features: ["Jardín"], is_active: true },
  { id: "r-10", contact_id: "c-10", label: "Lote de inversión", operation: "venta", property_types: ["terreno"], zones: ["City Bell"], budget_min: 55000, budget_max: 75000, currency: "USD", rooms_min: null, bedrooms_min: null, bathrooms_min: null, surface_min: 250, surface_max: null, features: [], is_active: true },
  { id: "r-11", contact_id: "c-11", label: "PH en Berisso", operation: "venta", property_types: ["ph"], zones: ["Berisso"], budget_min: 110000, budget_max: 140000, currency: "USD", rooms_min: 3, bedrooms_min: 2, bathrooms_min: 1, surface_min: null, surface_max: null, features: ["Terraza"], is_active: true },
  { id: "r-12", contact_id: "c-12", label: "Casa en Tolosa", operation: "venta", property_types: ["casa"], zones: ["Tolosa"], budget_min: 140000, budget_max: 180000, currency: "USD", rooms_min: 4, bedrooms_min: 3, bathrooms_min: 2, surface_min: null, surface_max: null, features: ["Moderna", "Patio"], is_active: true },
  { id: "r-13", contact_id: "c-13", label: "PH La Plata", operation: "venta", property_types: ["ph"], zones: ["La Plata Norte"], budget_min: 110000, budget_max: 145000, currency: "USD", rooms_min: 4, bedrooms_min: 3, bathrooms_min: 2, surface_min: null, surface_max: null, features: ["Terraza", "2 plantas"], is_active: true },
  { id: "r-14", contact_id: "c-14", label: "Depto para estrenar", operation: "venta", property_types: ["departamento"], zones: ["La Plata Centro"], budget_min: 95000, budget_max: 130000, currency: "USD", rooms_min: 3, bedrooms_min: 2, bathrooms_min: 1, surface_min: null, surface_max: null, features: ["Amenities"], is_active: true },
];

export const seedRequirements: ContactRequirement[] = requirementSeeds.map((r) => ({
  ...r,
  agency_id: AGENCY_ID,
  created_at: iso(30),
  updated_at: iso(2),
}));

type PropSeed = Omit<Property, "agency_id" | "created_at" | "updated_at" | "published_at"> & {
  publishedDaysAgo: number;
};

const propertySeeds: PropSeed[] = [
  { id: "p-1", owner_agent_id: "u-1", owner_contact_id: "c-15", title: "Casa moderna en City Bell", description: "Casa a estrenar con jardín y cochera doble, en una de las mejores zonas de City Bell.", type: "casa", operation: "venta", status: "disponible", street: "Calle 13", street_number: "450", locality: "City Bell", province: "Buenos Aires", zone: "City Bell", lat: null, lng: null, price: 185000, currency: "USD", expenses: null, taxes: 12000, commission_pct: 3, surface_total: 220, surface_covered: 180, rooms: 4, bedrooms: 3, bathrooms: 2, garages: 2, age_years: 0, features: ["Cochera", "Jardín", "A estrenar"], authorization_type: "exclusiva", authorization_expires_at: dateFromToday(12), is_featured: true, published_to_marketplace: false, publishedDaysAgo: 3 },
  { id: "p-2", owner_agent_id: "u-2", owner_contact_id: "c-16", title: "Departamento en el centro", description: "Luminoso, con balcón al frente y amenities en el edificio.", type: "departamento", operation: "venta", status: "disponible", street: "Calle 7", street_number: "1220", locality: "La Plata", province: "Buenos Aires", zone: "La Plata Centro", lat: null, lng: null, price: 95000, currency: "USD", expenses: 45000, taxes: 8000, commission_pct: 3, surface_total: 85, surface_covered: 78, rooms: 3, bedrooms: 2, bathrooms: 1, garages: 0, age_years: 8, features: ["Balcón", "Luminoso", "Amenities"], authorization_type: "no_exclusiva", authorization_expires_at: dateFromToday(75), is_featured: false, published_to_marketplace: false, publishedDaysAgo: 7 },
  { id: "p-3", owner_agent_id: "u-1", owner_contact_id: null, title: "Casa con parque en Gonnet", description: "Gran casa familiar con pileta, parque y quincho con parrilla.", type: "casa", operation: "venta", status: "reservada", street: "Camino Centenario", street_number: "3400", locality: "Gonnet", province: "Buenos Aires", zone: "Gonnet", lat: null, lng: null, price: 230000, currency: "USD", expenses: null, taxes: 18000, commission_pct: 3, surface_total: 310, surface_covered: 240, rooms: 5, bedrooms: 4, bathrooms: 3, garages: 2, age_years: 12, features: ["Pileta", "Parque", "Parrilla"], authorization_type: null, authorization_expires_at: null, is_featured: true, published_to_marketplace: false, publishedDaysAgo: 1 },
  { id: "p-4", owner_agent_id: "u-3", owner_contact_id: "c-17", title: "PH amplio en La Plata Norte", description: "PH de dos plantas con terraza propia y parrilla.", type: "ph", operation: "venta", status: "disponible", street: "Calle 32", street_number: "780", locality: "La Plata", province: "Buenos Aires", zone: "La Plata Norte", lat: null, lng: null, price: 130000, currency: "USD", expenses: null, taxes: 9500, commission_pct: 3, surface_total: 150, surface_covered: 130, rooms: 4, bedrooms: 3, bathrooms: 2, garages: 1, age_years: 20, features: ["Terraza", "Parrilla", "2 plantas"], authorization_type: "exclusiva", authorization_expires_at: dateFromToday(-4), is_featured: false, published_to_marketplace: false, publishedDaysAgo: 14 },
  { id: "p-5", owner_agent_id: "u-4", owner_contact_id: null, title: "Casa de campo en Ringuelet", description: "Gran terreno arbolado con quincho.", type: "casa", operation: "venta", status: "en_revision", street: "Calle 514", street_number: "1100", locality: "Ringuelet", province: "Buenos Aires", zone: "Ringuelet", lat: null, lng: null, price: 148000, currency: "USD", expenses: null, taxes: 7000, commission_pct: 3, surface_total: 180, surface_covered: 120, rooms: 3, bedrooms: 2, bathrooms: 1, garages: 1, age_years: 30, features: ["Gran terreno", "Quincho", "Arboleda"], authorization_type: null, authorization_expires_at: null, is_featured: false, published_to_marketplace: false, publishedDaysAgo: 21 },
  { id: "p-6", owner_agent_id: "u-2", owner_contact_id: "c-15", title: "Casa de diseño en Tolosa", description: "Casa moderna, muy luminosa, con patio.", type: "casa", operation: "venta", status: "disponible", street: "Calle 3", street_number: "530", locality: "Tolosa", province: "Buenos Aires", zone: "Tolosa", lat: null, lng: null, price: 175000, currency: "USD", expenses: null, taxes: 11000, commission_pct: 3, surface_total: 190, surface_covered: 165, rooms: 4, bedrooms: 3, bathrooms: 2, garages: 1, age_years: 3, features: ["Moderna", "Luminoso", "Patio"], authorization_type: "exclusiva", authorization_expires_at: dateFromToday(110), is_featured: false, published_to_marketplace: false, publishedDaysAgo: 5 },
  { id: "p-7", owner_agent_id: "u-1", owner_contact_id: null, title: "Lote en City Bell", description: "Lote plano en zona residencial, listo para construir.", type: "terreno", operation: "venta", status: "disponible", street: "Calle 19", street_number: "890", locality: "City Bell", province: "Buenos Aires", zone: "City Bell", lat: null, lng: null, price: 65000, currency: "USD", expenses: null, taxes: 3000, commission_pct: 4, surface_total: 400, surface_covered: 0, rooms: null, bedrooms: null, bathrooms: null, garages: 0, age_years: null, features: ["Gran terreno"], authorization_type: null, authorization_expires_at: null, is_featured: false, published_to_marketplace: false, publishedDaysAgo: 9 },
  { id: "p-8", owner_agent_id: "u-5", owner_contact_id: "c-18", title: "Casa en Los Hornos", description: "Casa amplia con parque y pileta, ideal para familia numerosa.", type: "casa", operation: "venta", status: "disponible", street: "Calle 66", street_number: "1450", locality: "Los Hornos", province: "Buenos Aires", zone: "Los Hornos", lat: null, lng: null, price: 220000, currency: "USD", expenses: null, taxes: 15000, commission_pct: 3, surface_total: 280, surface_covered: 210, rooms: 5, bedrooms: 4, bathrooms: 3, garages: 2, age_years: 6, features: ["Pileta", "Parque", "Cochera"], authorization_type: "no_exclusiva", authorization_expires_at: dateFromToday(40), is_featured: false, published_to_marketplace: false, publishedDaysAgo: 11 },
  { id: "p-9", owner_agent_id: "u-3", owner_contact_id: null, title: "PH en Berisso", description: "PH reciclado con terraza y parrilla.", type: "ph", operation: "venta", status: "disponible", street: "Calle Montevideo", street_number: "620", locality: "Berisso", province: "Buenos Aires", zone: "Berisso", lat: null, lng: null, price: 128000, currency: "USD", expenses: null, taxes: 8000, commission_pct: 3, surface_total: 135, surface_covered: 115, rooms: 4, bedrooms: 3, bathrooms: 2, garages: 1, age_years: 25, features: ["Terraza", "Parrilla"], authorization_type: null, authorization_expires_at: null, is_featured: false, published_to_marketplace: false, publishedDaysAgo: 17 },
  { id: "p-10", owner_agent_id: "u-2", owner_contact_id: null, title: "Casa en Ensenada", description: "Casa con patio grande y quincho, sobre calle tranquila.", type: "casa", operation: "venta", status: "disponible", street: "Calle La Merced", street_number: "340", locality: "Ensenada", province: "Buenos Aires", zone: "Ensenada", lat: null, lng: null, price: 175000, currency: "USD", expenses: null, taxes: 10000, commission_pct: 3, surface_total: 200, surface_covered: 150, rooms: 4, bedrooms: 3, bathrooms: 2, garages: 1, age_years: 10, features: ["Patio", "Parrilla"], authorization_type: null, authorization_expires_at: null, is_featured: false, published_to_marketplace: false, publishedDaysAgo: 6 },
  { id: "p-11", owner_agent_id: "u-4", owner_contact_id: null, title: "Departamento en La Plata Norte", description: "Dos ambientes muy luminoso, apto profesional.", type: "departamento", operation: "venta", status: "disponible", street: "Calle 44", street_number: "1580", locality: "La Plata", province: "Buenos Aires", zone: "La Plata Norte", lat: null, lng: null, price: 88000, currency: "USD", expenses: 38000, taxes: 6000, commission_pct: 3, surface_total: 55, surface_covered: 52, rooms: 2, bedrooms: 1, bathrooms: 1, garages: 0, age_years: 5, features: ["Luminoso", "Balcón"], authorization_type: null, authorization_expires_at: null, is_featured: false, published_to_marketplace: false, publishedDaysAgo: 4 },
  { id: "p-12", owner_agent_id: "u-1", owner_contact_id: "c-16", title: "Departamento a estrenar en el centro", description: "Tres ambientes con amenities completos y cochera opcional.", type: "departamento", operation: "venta", status: "disponible", street: "Calle 12", street_number: "980", locality: "La Plata", province: "Buenos Aires", zone: "La Plata Centro", lat: null, lng: null, price: 112000, currency: "USD", expenses: 52000, taxes: 9000, commission_pct: 3, surface_total: 95, surface_covered: 88, rooms: 3, bedrooms: 2, bathrooms: 2, garages: 0, age_years: 0, features: ["Amenities", "A estrenar", "Balcón"], authorization_type: "exclusiva", authorization_expires_at: dateFromToday(160), is_featured: true, published_to_marketplace: false, publishedDaysAgo: 2 },
];

export const seedProperties: Property[] = propertySeeds.map((p) => {
  const { publishedDaysAgo, ...rest } = p;
  return {
    ...rest,
    agency_id: AGENCY_ID,
    published_at: iso(publishedDaysAgo),
    created_at: iso(publishedDaysAgo),
    updated_at: iso(Math.max(0, publishedDaysAgo - 1)),
  };
});

/**
 * Fotos. En el prototipo cada propiedad traía una URL de Unsplash hardcodeada;
 * se conservan como semilla para que el listado se vea igual, pero ahora pasan
 * por la misma capa que usarán las fotos subidas por el agente.
 */
export const seedPhotos: Record<string, string[]> = {
  "p-1": ["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=640&h=400&fit=crop&auto=format"],
  "p-2": ["https://images.unsplash.com/photo-1564078516393-cf04bd966897?w=640&h=400&fit=crop&auto=format"],
  "p-3": ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=640&h=400&fit=crop&auto=format"],
  "p-4": ["https://images.unsplash.com/photo-1628592102751-ba83b0314276?w=640&h=400&fit=crop&auto=format"],
  "p-5": ["https://images.unsplash.com/photo-1706408126103-51d1241ecf0d?w=640&h=400&fit=crop&auto=format"],
  "p-6": ["https://images.unsplash.com/photo-1633354747567-e0682586f082?w=640&h=400&fit=crop&auto=format"],
  "p-7": ["https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=640&h=400&fit=crop&auto=format"],
  "p-8": ["https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&h=400&fit=crop&auto=format"],
  "p-9": ["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=640&h=400&fit=crop&auto=format"],
  "p-10": ["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=640&h=400&fit=crop&auto=format"],
  "p-11": ["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=640&h=400&fit=crop&auto=format"],
  "p-12": ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=640&h=400&fit=crop&auto=format"],
};

type OppSeed = Omit<Opportunity, "agency_id" | "created_at" | "updated_at" | "stage_since"> & {
  stageDaysAgo: number;
};

const opportunitySeeds: OppSeed[] = [
  { id: "o-1", contact_id: "c-8", property_id: "p-12", match_id: null, owner_id: "u-1", stage: "nuevos", value: 112000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 0 },
  { id: "o-2", contact_id: "c-9", property_id: "p-3", match_id: null, owner_id: "u-3", stage: "nuevos", value: 180000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 0 },
  { id: "o-3", contact_id: "c-10", property_id: "p-7", match_id: null, owner_id: "u-2", stage: "nuevos", value: 65000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 0 },
  { id: "o-4", contact_id: "c-7", property_id: "p-11", match_id: null, owner_id: "u-4", stage: "contactados", value: 88000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 1 },
  { id: "o-5", contact_id: "c-11", property_id: "p-9", match_id: null, owner_id: "u-4", stage: "contactados", value: 128000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 2 },
  { id: "o-6", contact_id: "c-12", property_id: "p-6", match_id: null, owner_id: "u-5", stage: "contactados", value: 175000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 2 },
  { id: "o-7", contact_id: "c-1", property_id: "p-1", match_id: null, owner_id: "u-1", stage: "visita", value: 185000, currency: "USD", is_priority: true, priority_note: "Visita pendiente de confirmación", closed_at: null, stageDaysAgo: 1 },
  { id: "o-8", contact_id: "c-6", property_id: "p-10", match_id: null, owner_id: "u-2", stage: "visita", value: 175000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 1 },
  { id: "o-9", contact_id: "c-13", property_id: "p-4", match_id: null, owner_id: "u-1", stage: "visita", value: 130000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 3 },
  { id: "o-10", contact_id: "c-2", property_id: "p-2", match_id: null, owner_id: "u-1", stage: "negociacion", value: 95000, currency: "USD", is_priority: true, priority_note: "Esperando respuesta del cliente", closed_at: null, stageDaysAgo: 2 },
  { id: "o-11", contact_id: "c-5", property_id: "p-9", match_id: null, owner_id: "u-3", stage: "negociacion", value: 128000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 4 },
  { id: "o-12", contact_id: "c-4", property_id: "p-8", match_id: null, owner_id: "u-1", stage: "negociacion", value: 220000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 5 },
  { id: "o-13", contact_id: "c-3", property_id: "p-7", match_id: null, owner_id: "u-2", stage: "cierre", value: 65000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 1 },
  { id: "o-14", contact_id: "c-14", property_id: "p-12", match_id: null, owner_id: "u-3", stage: "cierre", value: 112000, currency: "USD", is_priority: false, priority_note: null, closed_at: null, stageDaysAgo: 2 },
];

export const seedOpportunities: Opportunity[] = opportunitySeeds.map((o) => {
  const { stageDaysAgo, ...rest } = o;
  return {
    ...rest,
    agency_id: AGENCY_ID,
    stage_since: iso(stageDaysAgo),
    created_at: iso(stageDaysAgo + 5),
    updated_at: iso(stageDaysAgo),
  };
});

export const seedActivities: Activity[] = [
  { id: "a-1", agency_id: AGENCY_ID, actor_id: "u-1", type: "contacto_creado", title: "Nuevo contacto agregado", detail: "Federico Álvarez", contact_id: "c-8", property_id: null, opportunity_id: null, created_at: iso(0, new Date().getHours(), Math.max(0, new Date().getMinutes() - 20)) },
  { id: "a-2", agency_id: AGENCY_ID, actor_id: "u-2", type: "propiedad_publicada", title: "Propiedad publicada", detail: "Casa en Los Hornos", contact_id: null, property_id: "p-8", opportunity_id: null, created_at: iso(0, Math.max(0, new Date().getHours() - 1)) },
  { id: "a-3", agency_id: AGENCY_ID, actor_id: "u-1", type: "visita_programada", title: "Visita programada", detail: "Martín Rodríguez — City Bell", contact_id: "c-1", property_id: "p-1", opportunity_id: "o-7", created_at: iso(0, Math.max(0, new Date().getHours() - 3)) },
  { id: "a-4", agency_id: AGENCY_ID, actor_id: null, type: "match_creado", title: "Nuevo match encontrado", detail: "Lucía Fernández + Depto. en el centro", contact_id: "c-2", property_id: "p-2", opportunity_id: null, created_at: iso(0, Math.max(0, new Date().getHours() - 5)) },
  { id: "a-5", agency_id: AGENCY_ID, actor_id: "u-1", type: "contacto_actualizado", title: "Contacto actualizado", detail: "Carolina Méndez", contact_id: "c-13", property_id: null, opportunity_id: null, created_at: iso(1, 16, 42) },
  { id: "a-6", agency_id: AGENCY_ID, actor_id: "u-2", type: "etapa_avanzada", title: "Juan pasó a cierre", detail: "Lote en City Bell", contact_id: "c-3", property_id: "p-7", opportunity_id: "o-13", created_at: iso(1, 11, 15) },
  { id: "a-7", agency_id: AGENCY_ID, actor_id: "u-3", type: "llamada", title: "Roberto respondió el mensaje", detail: "PH en Berisso", contact_id: "c-5", property_id: "p-9", opportunity_id: "o-11", created_at: iso(2, 9, 30) },
];

export const seedEvents: CalendarEvent[] = [
  { id: "e-1", agency_id: AGENCY_ID, owner_id: "u-1", type: "visita", title: "Casa en City Bell", contact_id: "c-1", property_id: "p-1", opportunity_id: "o-7", starts_at: weekday(0, 10), ends_at: weekday(0, 11, 30), notes: null, created_at: iso(3) },
  { id: "e-2", agency_id: AGENCY_ID, owner_id: "u-1", type: "llamada", title: "Seguimiento", contact_id: "c-2", property_id: null, opportunity_id: "o-10", starts_at: weekday(0, 14, 30), ends_at: weekday(0, 15), notes: null, created_at: iso(3) },
  { id: "e-3", agency_id: AGENCY_ID, owner_id: "u-1", type: "visita", title: "Depto. en La Plata", contact_id: "c-3", property_id: "p-2", opportunity_id: null, starts_at: weekday(0, 17), ends_at: weekday(0, 18), notes: null, created_at: iso(3) },
  { id: "e-4", agency_id: AGENCY_ID, owner_id: "u-1", type: "reunion", title: "Reunión de equipo", contact_id: null, property_id: null, opportunity_id: null, starts_at: weekday(1, 9), ends_at: weekday(1, 10), notes: null, created_at: iso(4) },
  { id: "e-5", agency_id: AGENCY_ID, owner_id: "u-1", type: "llamada", title: "Consulta de presupuesto", contact_id: "c-4", property_id: null, opportunity_id: null, starts_at: weekday(1, 11, 30), ends_at: weekday(1, 12), notes: null, created_at: iso(4) },
  { id: "e-6", agency_id: AGENCY_ID, owner_id: "u-1", type: "visita", title: "Casa en Gonnet", contact_id: "c-5", property_id: "p-3", opportunity_id: null, starts_at: weekday(1, 15), ends_at: weekday(1, 16, 30), notes: null, created_at: iso(4) },
  { id: "e-7", agency_id: AGENCY_ID, owner_id: "u-1", type: "seguimiento", title: "Contacto inicial", contact_id: "c-8", property_id: null, opportunity_id: "o-1", starts_at: weekday(2, 10), ends_at: weekday(2, 10, 30), notes: null, created_at: iso(4) },
  { id: "e-8", agency_id: AGENCY_ID, owner_id: "u-1", type: "visita", title: "PH en La Plata Norte", contact_id: "c-6", property_id: "p-4", opportunity_id: null, starts_at: weekday(2, 16), ends_at: weekday(2, 17), notes: null, created_at: iso(4) },
  { id: "e-9", agency_id: AGENCY_ID, owner_id: "u-1", type: "llamada", title: "Confirmación de oferta", contact_id: "c-5", property_id: null, opportunity_id: "o-11", starts_at: weekday(3, 9, 30), ends_at: weekday(3, 10), notes: null, created_at: iso(5) },
  { id: "e-10", agency_id: AGENCY_ID, owner_id: "u-1", type: "reunion", title: "Reunión con propietario", contact_id: null, property_id: "p-1", opportunity_id: null, starts_at: weekday(3, 13), ends_at: weekday(3, 14), notes: null, created_at: iso(5) },
  { id: "e-11", agency_id: AGENCY_ID, owner_id: "u-1", type: "visita", title: "Casa en Tolosa", contact_id: "c-7", property_id: "p-6", opportunity_id: null, starts_at: weekday(3, 18), ends_at: weekday(3, 19, 30), notes: null, created_at: iso(5) },
  { id: "e-12", agency_id: AGENCY_ID, owner_id: "u-1", type: "seguimiento", title: "Revisión del pipeline", contact_id: null, property_id: null, opportunity_id: null, starts_at: weekday(4, 10), ends_at: weekday(4, 10, 30), notes: null, created_at: iso(5) },
  { id: "e-13", agency_id: AGENCY_ID, owner_id: "u-1", type: "llamada", title: "Propuesta de compra", contact_id: "c-9", property_id: null, opportunity_id: "o-2", starts_at: weekday(4, 14), ends_at: weekday(4, 14, 30), notes: null, created_at: iso(5) },
];

export const seedTasks: Task[] = [
  { id: "t-1", agency_id: AGENCY_ID, owner_id: "u-1", text: "Confirmar visita con Martín Rodríguez", is_priority: true, is_done: false, due_date: null, contact_id: "c-1", created_at: iso(1) },
  { id: "t-2", agency_id: AGENCY_ID, owner_id: "u-1", text: "Enviar propiedades a Lucía Fernández", is_priority: false, is_done: false, due_date: null, contact_id: "c-2", created_at: iso(1) },
  { id: "t-3", agency_id: AGENCY_ID, owner_id: "u-1", text: "Contactar nuevo lead — Federico Álvarez", is_priority: false, is_done: false, due_date: null, contact_id: "c-8", created_at: iso(0) },
  { id: "t-4", agency_id: AGENCY_ID, owner_id: "u-1", text: "Actualizar fichas de propiedades", is_priority: false, is_done: false, due_date: null, contact_id: null, created_at: iso(2) },
];

/**
 * Amenities. El matching compara estos textos tal cual (matching.ts,
 * scoreFeatures): renombrar uno rompe los requerimientos ya guardados. Solo
 * se agregan al final.
 */
export const FEATURE_CHIPS = [
  "Jardín", "Balcón", "Cochera", "Piscina", "Terraza",
  "Seguridad", "Mascotas", "Parrilla", "Luminoso",
  "Gimnasio", "Solarium", "SUM", "Lavadero", "Aire acondicionado",
  "Seguridad 24 hs", "Ascensor", "Placards", "Apto profesional",
];

export const ZONES = [
  "City Bell", "Gonnet", "La Plata Centro", "La Plata Norte",
  "Tolosa", "Los Hornos", "Ringuelet", "Berisso", "Ensenada",
];
