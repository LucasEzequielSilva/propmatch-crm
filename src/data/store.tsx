import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  Activity,
  ActivityType,
  Agency,
  CalendarEvent,
  Contact,
  ContactRequirement,
  Match,
  Opportunity,
  OpportunityStage,
  Profile,
  Property,
  Task,
} from "@/types/db";
import { buildMatches } from "@/lib/matching";
import {
  CURRENT_USER_ID,
  seedActivities,
  seedAgency,
  seedContacts,
  seedEvents,
  seedOpportunities,
  seedPhotos,
  seedProfiles,
  seedProperties,
  seedRequirements,
  seedTasks,
} from "./seed";

/**
 * Store del frontend.
 *
 * Mientras no haya backend, todo el estado del CRM vive acá y se persiste en
 * localStorage. Es deliberadamente la misma forma que va a tener la capa de
 * datos real: las pantallas piden `useStore()` y no saben de dónde salen los
 * datos, así que cuando se conecte Supabase se cambia este archivo y no las
 * nueve pantallas.
 */

const STORAGE_KEY = "propmatch.store.v1";

interface StoreData {
  contacts: Contact[];
  requirements: ContactRequirement[];
  properties: Property[];
  photos: Record<string, string[]>;
  opportunities: Opportunity[];
  activities: Activity[];
  events: CalendarEvent[];
  tasks: Task[];
}

function seedData(): StoreData {
  return {
    contacts: seedContacts,
    requirements: seedRequirements,
    properties: seedProperties,
    photos: seedPhotos,
    opportunities: seedOpportunities,
    activities: seedActivities,
    events: seedEvents,
    tasks: seedTasks,
  };
}

function loadData(): StoreData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData();
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    // Se completa con la semilla por si el guardado es de una versión anterior.
    return { ...seedData(), ...parsed };
  } catch {
    return seedData();
  }
}

export interface NewPropertyInput {
  title: string;
  description: string | null;
  type: Property["type"];
  operation: Property["operation"];
  status: Property["status"];
  street: string | null;
  street_number: string | null;
  locality: string | null;
  province: string | null;
  price: number | null;
  currency: Property["currency"];
  expenses: number | null;
  taxes: number | null;
  commission_pct: number | null;
  surface_total: number | null;
  surface_covered: number | null;
  bedrooms: number;
  bathrooms: number;
  garages: number;
  age_years: number | null;
  features: string[];
  owner_agent_id: string | null;
  photos: string[];
}

interface StoreValue extends StoreData {
  agency: Agency;
  profile: Profile;
  profiles: Profile[];
  /** Derivado: se recalcula solo cuando cambian propiedades o requerimientos. */
  matches: Match[];

  // Lecturas auxiliares
  contactById: (id: string | null | undefined) => Contact | undefined;
  propertyById: (id: string | null | undefined) => Property | undefined;
  profileById: (id: string | null | undefined) => Profile | undefined;
  coverPhoto: (propertyId: string) => string | null;

  // Acciones
  addProperty: (input: NewPropertyInput) => Property;
  updateProperty: (id: string, patch: Partial<Property>) => void;
  addContact: (input: Pick<Contact, "full_name" | "email" | "phone" | "kind" | "status">) => Contact;
  moveOpportunity: (id: string, stage: OpportunityStage) => void;
  createOpportunityFromMatch: (matchId: string) => void;
  toggleTask: (id: string) => void;
  markMatchReviewed: (id: string) => void;
  reset: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<StoreData>(loadData);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Sin persistencia (modo incógnito, cuota llena): la app funciona igual.
    }
  }, [data]);

  /**
   * Los matches no se guardan: se derivan. Es lo que en la base hace el
   * trigger de `refresh_matches_*`, y garantiza que un cambio de precio o de
   * presupuesto se refleje al instante en toda la app.
   */
  const matches = useMemo(
    () => buildMatches(data.properties, data.requirements),
    [data.properties, data.requirements],
  );

  const profile = useMemo(
    () => seedProfiles.find((p) => p.id === CURRENT_USER_ID) ?? seedProfiles[0],
    [],
  );

  const logActivity = useCallback(
    (type: ActivityType, title: string, detail: string | null, refs: Partial<Activity> = {}) => {
      setData((d) => ({
        ...d,
        activities: [
          {
            id: uid("a"),
            agency_id: seedAgency.id,
            actor_id: CURRENT_USER_ID,
            type,
            title,
            detail,
            contact_id: null,
            property_id: null,
            opportunity_id: null,
            created_at: new Date().toISOString(),
            ...refs,
          },
          ...d.activities,
        ],
      }));
    },
    [],
  );

  const addProperty = useCallback<StoreValue["addProperty"]>(
    (input) => {
      const id = uid("p");
      const nowIso = new Date().toISOString();
      const property: Property = {
        id,
        agency_id: seedAgency.id,
        owner_agent_id: input.owner_agent_id,
        owner_contact_id: null,
        title: input.title,
        description: input.description,
        type: input.type,
        operation: input.operation,
        status: input.status,
        street: input.street,
        street_number: input.street_number,
        locality: input.locality,
        province: input.province,
        zone: input.locality,
        lat: null,
        lng: null,
        price: input.price,
        currency: input.currency,
        expenses: input.expenses,
        taxes: input.taxes,
        commission_pct: input.commission_pct,
        surface_total: input.surface_total,
        surface_covered: input.surface_covered,
        // El formulario pide dormitorios, baños y cocheras; los "ambientes"
        // que muestran las cards se derivan de dormitorios + 1 (estar).
        rooms: input.bedrooms + 1,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        garages: input.garages,
        age_years: input.age_years,
        features: input.features,
        is_featured: false,
        published_to_marketplace: false,
        published_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };

      setData((d) => ({
        ...d,
        properties: [property, ...d.properties],
        photos: { ...d.photos, [id]: input.photos },
        activities: [
          {
            id: uid("a"),
            agency_id: seedAgency.id,
            actor_id: CURRENT_USER_ID,
            type: "propiedad_publicada",
            title: "Propiedad publicada",
            detail: input.title,
            contact_id: null,
            property_id: id,
            opportunity_id: null,
            created_at: nowIso,
          },
          ...d.activities,
        ],
      }));

      return property;
    },
    [],
  );

  const updateProperty = useCallback<StoreValue["updateProperty"]>((id, patch) => {
    setData((d) => ({
      ...d,
      properties: d.properties.map((p) =>
        p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p,
      ),
    }));
  }, []);

  const addContact = useCallback<StoreValue["addContact"]>(
    (input) => {
      const nowIso = new Date().toISOString();
      const contact: Contact = {
        id: uid("c"),
        agency_id: seedAgency.id,
        owner_id: CURRENT_USER_ID,
        full_name: input.full_name,
        email: input.email,
        phone: input.phone,
        kind: input.kind,
        status: input.status,
        source: "manual",
        profile_type: null,
        notes: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      setData((d) => ({ ...d, contacts: [contact, ...d.contacts] }));
      logActivity("contacto_creado", "Nuevo contacto agregado", input.full_name, {
        contact_id: contact.id,
      });
      return contact;
    },
    [logActivity],
  );

  const moveOpportunity = useCallback<StoreValue["moveOpportunity"]>((id, stage) => {
    setData((d) => {
      const opp = d.opportunities.find((o) => o.id === id);
      const contact = d.contacts.find((c) => c.id === opp?.contact_id);
      const nowIso = new Date().toISOString();

      return {
        ...d,
        opportunities: d.opportunities.map((o) =>
          o.id === id
            ? {
                ...o,
                stage,
                stage_since: nowIso,
                updated_at: nowIso,
                closed_at: stage === "cierre" ? nowIso : o.closed_at,
              }
            : o,
        ),
        activities: opp
          ? [
              {
                id: uid("a"),
                agency_id: seedAgency.id,
                actor_id: CURRENT_USER_ID,
                type: "etapa_avanzada" as ActivityType,
                title: `${contact?.full_name.split(" ")[0] ?? "Oportunidad"} pasó a ${STAGE_LABEL[stage]}`,
                detail: d.properties.find((p) => p.id === opp.property_id)?.title ?? null,
                contact_id: opp.contact_id,
                property_id: opp.property_id,
                opportunity_id: opp.id,
                created_at: nowIso,
              },
              ...d.activities,
            ]
          : d.activities,
      };
    });
  }, []);

  const createOpportunityFromMatch = useCallback<StoreValue["createOpportunityFromMatch"]>(
    (matchId) => {
      const match = matches.find((m) => m.id === matchId);
      if (!match) return;

      setData((d) => {
        // No duplicar: si ya existe una oportunidad para ese par, no se crea otra.
        const exists = d.opportunities.some(
          (o) => o.contact_id === match.contact_id && o.property_id === match.property_id,
        );
        if (exists) return d;

        const property = d.properties.find((p) => p.id === match.property_id);
        const contact = d.contacts.find((c) => c.id === match.contact_id);
        const nowIso = new Date().toISOString();
        const id = uid("o");

        return {
          ...d,
          opportunities: [
            {
              id,
              agency_id: seedAgency.id,
              contact_id: match.contact_id,
              property_id: match.property_id,
              match_id: match.id,
              owner_id: CURRENT_USER_ID,
              stage: "nuevos",
              value: property?.price ?? null,
              currency: property?.currency ?? "USD",
              is_priority: false,
              priority_note: null,
              stage_since: nowIso,
              closed_at: null,
              created_at: nowIso,
              updated_at: nowIso,
            },
            ...d.opportunities,
          ],
          activities: [
            {
              id: uid("a"),
              agency_id: seedAgency.id,
              actor_id: CURRENT_USER_ID,
              type: "match_creado" as ActivityType,
              title: "Oportunidad creada desde un match",
              detail: `${contact?.full_name ?? ""} — ${property?.title ?? ""}`,
              contact_id: match.contact_id,
              property_id: match.property_id,
              opportunity_id: id,
              created_at: nowIso,
            },
            ...d.activities,
          ],
        };
      });
    },
    [matches],
  );

  const toggleTask = useCallback<StoreValue["toggleTask"]>((id) => {
    setData((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, is_done: !t.is_done } : t)),
    }));
  }, []);

  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const markMatchReviewed = useCallback((id: string) => {
    setReviewed((prev) => new Set(prev).add(id));
  }, []);

  const matchesWithReview = useMemo(
    () => matches.map((m) => (reviewed.has(m.id) ? { ...m, is_reviewed: true } : m)),
    [matches, reviewed],
  );

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setData(seedData());
    setReviewed(new Set());
  }, []);

  const value = useMemo<StoreValue>(() => {
    const contactIndex = new Map(data.contacts.map((c) => [c.id, c]));
    const propertyIndex = new Map(data.properties.map((p) => [p.id, p]));
    const profileIndex = new Map(seedProfiles.map((p) => [p.id, p]));

    return {
      ...data,
      agency: seedAgency,
      profile,
      profiles: seedProfiles,
      matches: matchesWithReview,
      contactById: (id) => (id ? contactIndex.get(id) : undefined),
      propertyById: (id) => (id ? propertyIndex.get(id) : undefined),
      profileById: (id) => (id ? profileIndex.get(id) : undefined),
      coverPhoto: (propertyId) => data.photos[propertyId]?.[0] ?? null,
      addProperty,
      updateProperty,
      addContact,
      moveOpportunity,
      createOpportunityFromMatch,
      toggleTask,
      markMatchReviewed,
      reset,
    };
  }, [
    data,
    profile,
    matchesWithReview,
    addProperty,
    updateProperty,
    addContact,
    moveOpportunity,
    createOpportunityFromMatch,
    toggleTask,
    markMatchReviewed,
    reset,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de <StoreProvider>");
  return ctx;
}

export const STAGE_LABEL: Record<OpportunityStage, string> = {
  nuevos: "Nuevos",
  contactados: "Contactados",
  visita: "Visita programada",
  negociacion: "Negociación",
  cierre: "Cierre",
  perdida: "Perdida",
};
