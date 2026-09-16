import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  Activity,
  ActivityType,
  Agency,
  CalendarEvent,
  ClientProfile,
  Contact,
  ContactKind,
  ContactRequirement,
  ContactStatus,
  CurrencyCode,
  EventType,
  Match,
  OperationType,
  Opportunity,
  OpportunityStage,
  Profile,
  Property,
  PropertyType,
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
const SESSION_KEY = "propmatch.session.v1";

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

/** Qué busca un contacto. Es la mitad de la ecuación del matching. */
export interface RequirementInput {
  label: string | null;
  operation: OperationType;
  property_types: PropertyType[];
  zones: string[];
  budget_min: number | null;
  budget_max: number | null;
  currency: CurrencyCode;
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  surface_min: number | null;
  surface_max: number | null;
  features: string[];
}

export interface NewContactInput {
  full_name: string;
  email: string | null;
  phone: string | null;
  kind: ContactKind;
  status: ContactStatus;
  profile_type: ClientProfile | null;
  notes: string | null;
  owner_id: string | null;
  /** Opcional: sin esto el contacto existe pero no genera matches. */
  requirement: RequirementInput | null;
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

export interface NewEventInput {
  type: EventType;
  title: string;
  contact_id: string | null;
  property_id: string | null;
  /** ISO. La pantalla arma el día y la hora; el store no interpreta zonas. */
  starts_at: string;
  ends_at: string;
  notes: string | null;
  owner_id: string | null;
}

export interface NewTaskInput {
  text: string;
  is_priority: boolean;
  due_date: string | null;
  contact_id: string | null;
  owner_id: string | null;
}

export interface NewOpportunityInput {
  contact_id: string;
  property_id: string | null;
  stage: OpportunityStage;
  value: number | null;
  currency: CurrencyCode;
  owner_id: string | null;
}

interface StoreValue extends StoreData {
  agency: Agency;
  /** El agente con la sesión abierta. */
  profile: Profile;
  profiles: Profile[];
  /** `null` mientras nadie inició sesión. */
  currentUserId: string | null;
  /** Devuelve el error a mostrar, o `null` si la sesión se abrió. */
  signIn: (email: string, password: string) => string | null;
  signOut: () => void;
  /** Derivado: se recalcula solo cuando cambian propiedades o requerimientos. */
  matches: Match[];

  // Lecturas auxiliares
  contactById: (id: string | null | undefined) => Contact | undefined;
  propertyById: (id: string | null | undefined) => Property | undefined;
  profileById: (id: string | null | undefined) => Profile | undefined;
  coverPhoto: (propertyId: string) => string | null;

  // Acciones
  addProperty: (input: NewPropertyInput) => Property;
  /** Cambios puntuales (estado, destacada). */
  updateProperty: (id: string, patch: Partial<Property>) => void;
  /** Guarda una propiedad editada desde el formulario completo, fotos incluidas. */
  savePropertyEdit: (id: string, input: NewPropertyInput) => void;
  addContact: (input: NewContactInput) => Contact;
  updateContact: (id: string, patch: Partial<Contact>) => void;
  /** Crea o reemplaza la búsqueda activa de un contacto. */
  saveRequirement: (contactId: string, input: RequirementInput) => void;
  /** Búsqueda activa de un contacto, si tiene. */
  requirementOf: (contactId: string) => ContactRequirement | undefined;
  /** Alta manual, sin pasar por un match. */
  addOpportunity: (input: NewOpportunityInput) => Opportunity;
  moveOpportunity: (id: string, stage: OpportunityStage) => void;
  /** Marca o desmarca una operación como urgente. `null` la desmarca. */
  setOpportunityPriority: (id: string, note: string | null) => void;
  /** Saca la operación del pipeline dejando escrito el motivo. */
  markOpportunityLost: (id: string, reason: string | null) => void;
  /** Vuelve a abrir una operación perdida, en la primera etapa. */
  reopenOpportunity: (id: string) => void;
  createOpportunityFromMatch: (matchId: string) => void;
  addEvent: (input: NewEventInput) => CalendarEvent;
  addTask: (input: NewTaskInput) => Task;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
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

  /**
   * Sesión.
   *
   * OJO: esto NO es autenticación. No hay backend ni contraseñas guardadas:
   * la pantalla de login existe para que el flujo de la app esté completo y
   * para saber qué agente está usando el CRM. Cualquiera que abra la app puede
   * entrar con el mail de cualquier agente. Cuando haya backend, esto se
   * reemplaza por auth de verdad.
   */
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (currentUserId) localStorage.setItem(SESSION_KEY, currentUserId);
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // Sin persistencia: la sesión dura lo que dure la pestaña.
    }
  }, [currentUserId]);

  const signIn = useCallback<StoreValue["signIn"]>((email, password) => {
    const found = seedProfiles.find(
      (p) => p.email?.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!found) return "No encontramos ninguna cuenta con ese email.";
    if (password.trim().length < 4) return "Ingresá tu contraseña.";
    setCurrentUserId(found.id);
    return null;
  }, []);

  const signOut = useCallback(() => setCurrentUserId(null), []);

  const profile = useMemo(
    () =>
      seedProfiles.find((p) => p.id === currentUserId) ??
      seedProfiles.find((p) => p.id === CURRENT_USER_ID) ??
      seedProfiles[0],
    [currentUserId],
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

  const savePropertyEdit = useCallback<StoreValue["savePropertyEdit"]>((id, input) => {
    const nowIso = new Date().toISOString();
    setData((d) => ({
      ...d,
      properties: d.properties.map((p) =>
        p.id === id
          ? {
              ...p,
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
              price: input.price,
              currency: input.currency,
              expenses: input.expenses,
              taxes: input.taxes,
              commission_pct: input.commission_pct,
              surface_total: input.surface_total,
              surface_covered: input.surface_covered,
              rooms: input.bedrooms + 1,
              bedrooms: input.bedrooms,
              bathrooms: input.bathrooms,
              garages: input.garages,
              age_years: input.age_years,
              features: input.features,
              owner_agent_id: input.owner_agent_id,
              updated_at: nowIso,
            }
          : p,
      ),
      photos: { ...d.photos, [id]: input.photos },
    }));
  }, []);

  const addContact = useCallback<StoreValue["addContact"]>((input) => {
    const nowIso = new Date().toISOString();
    const contactId = uid("c");

    const contact: Contact = {
      id: contactId,
      agency_id: seedAgency.id,
      owner_id: input.owner_id ?? CURRENT_USER_ID,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      kind: input.kind,
      status: input.status,
      source: "manual",
      profile_type: input.profile_type,
      notes: input.notes,
      created_at: nowIso,
      updated_at: nowIso,
    };

    // El contacto y su búsqueda se guardan juntos: si se guardaran en dos
    // pasos, entre uno y otro habría un contacto sin criterios y el motor de
    // matching lo ignoraría.
    const requirement: ContactRequirement | null = input.requirement
      ? {
          id: uid("r"),
          agency_id: seedAgency.id,
          contact_id: contactId,
          ...input.requirement,
          rooms_min: null,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        }
      : null;

    setData((d) => ({
      ...d,
      contacts: [contact, ...d.contacts],
      requirements: requirement ? [requirement, ...d.requirements] : d.requirements,
      activities: [
        {
          id: uid("a"),
          agency_id: seedAgency.id,
          actor_id: CURRENT_USER_ID,
          type: "contacto_creado",
          title: "Nuevo contacto agregado",
          detail: input.full_name,
          contact_id: contactId,
          property_id: null,
          opportunity_id: null,
          created_at: nowIso,
        },
        ...d.activities,
      ],
    }));

    return contact;
  }, []);

  const updateContact = useCallback<StoreValue["updateContact"]>((id, patch) => {
    setData((d) => ({
      ...d,
      contacts: d.contacts.map((c) =>
        c.id === id ? { ...c, ...patch, updated_at: new Date().toISOString() } : c,
      ),
    }));
  }, []);

  const saveRequirement = useCallback<StoreValue["saveRequirement"]>((contactId, input) => {
    const nowIso = new Date().toISOString();
    setData((d) => {
      const existing = d.requirements.find((r) => r.contact_id === contactId && r.is_active);

      const next: ContactRequirement = existing
        ? { ...existing, ...input, rooms_min: null, updated_at: nowIso }
        : {
            id: uid("r"),
            agency_id: seedAgency.id,
            contact_id: contactId,
            ...input,
            rooms_min: null,
            is_active: true,
            created_at: nowIso,
            updated_at: nowIso,
          };

      return {
        ...d,
        requirements: existing
          ? d.requirements.map((r) => (r.id === existing.id ? next : r))
          : [next, ...d.requirements],
        contacts: d.contacts.map((c) =>
          c.id === contactId ? { ...c, updated_at: nowIso } : c,
        ),
      };
    });
  }, []);

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

  /**
   * Alta manual de una oportunidad: la misma pieza que `createOpportunityFromMatch`
   * pero arrancando de un contacto elegido a mano, sin match detrás.
   */
  const addOpportunity = useCallback<StoreValue["addOpportunity"]>((input) => {
    const nowIso = new Date().toISOString();
    const id = uid("o");
    const opportunity: Opportunity = {
      id,
      agency_id: seedAgency.id,
      contact_id: input.contact_id,
      property_id: input.property_id,
      match_id: null,
      owner_id: input.owner_id,
      stage: input.stage,
      value: input.value,
      currency: input.currency,
      is_priority: false,
      priority_note: null,
      stage_since: nowIso,
      closed_at: input.stage === "cierre" ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    setData((d) => {
      const contact = d.contacts.find((c) => c.id === input.contact_id);
      const property = d.properties.find((p) => p.id === input.property_id);
      return {
        ...d,
        opportunities: [opportunity, ...d.opportunities],
        activities: [
          {
            id: uid("a"),
            agency_id: seedAgency.id,
            actor_id: CURRENT_USER_ID,
            type: "etapa_avanzada" as ActivityType,
            title: `Oportunidad nueva en ${STAGE_LABEL[input.stage]}`,
            detail: [contact?.full_name, property?.title].filter(Boolean).join(" — ") || null,
            contact_id: input.contact_id,
            property_id: input.property_id,
            opportunity_id: id,
            created_at: nowIso,
          },
          ...d.activities,
        ],
      };
    });

    return opportunity;
  }, []);

  const addEvent = useCallback<StoreValue["addEvent"]>((input) => {
    const nowIso = new Date().toISOString();
    const event: CalendarEvent = {
      id: uid("e"),
      agency_id: seedAgency.id,
      owner_id: input.owner_id,
      type: input.type,
      title: input.title,
      contact_id: input.contact_id,
      property_id: input.property_id,
      opportunity_id: null,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      notes: input.notes,
      created_at: nowIso,
    };

    setData((d) => {
      const contact = d.contacts.find((c) => c.id === input.contact_id);
      const property = d.properties.find((p) => p.id === input.property_id);
      return {
        ...d,
        events: [...d.events, event],
        activities: [
          {
            id: uid("a"),
            agency_id: seedAgency.id,
            actor_id: CURRENT_USER_ID,
            type: EVENT_ACTIVITY[input.type],
            title: input.title,
            detail: [contact?.full_name, property?.title].filter(Boolean).join(" — ") || null,
            contact_id: input.contact_id,
            property_id: input.property_id,
            opportunity_id: null,
            created_at: nowIso,
          },
          ...d.activities,
        ],
      };
    });

    return event;
  }, []);

  const setOpportunityPriority = useCallback<StoreValue["setOpportunityPriority"]>(
    (id, note) => {
      const nowIso = new Date().toISOString();
      setData((d) => ({
        ...d,
        opportunities: d.opportunities.map((o) =>
          o.id === id
            ? { ...o, is_priority: note !== null, priority_note: note, updated_at: nowIso }
            : o,
        ),
      }));
    },
    [],
  );

  /**
   * Perder una operación no es "una etapa más": deja de contar en el pipeline
   * y el motivo queda en el historial, que es lo único que después sirve para
   * entender por qué se cae la gente.
   */
  const markOpportunityLost = useCallback<StoreValue["markOpportunityLost"]>((id, reason) => {
    const nowIso = new Date().toISOString();
    setData((d) => {
      const opp = d.opportunities.find((o) => o.id === id);
      if (!opp) return d;
      const contact = d.contacts.find((c) => c.id === opp.contact_id);

      return {
        ...d,
        opportunities: d.opportunities.map((o) =>
          o.id === id
            ? {
                ...o,
                stage: "perdida",
                stage_since: nowIso,
                updated_at: nowIso,
                closed_at: nowIso,
                is_priority: false,
                priority_note: reason,
              }
            : o,
        ),
        activities: [
          {
            id: uid("a"),
            agency_id: seedAgency.id,
            actor_id: CURRENT_USER_ID,
            type: "etapa_avanzada" as ActivityType,
            title: `${contact?.full_name.split(" ")[0] ?? "Oportunidad"} se dio de baja`,
            detail: reason,
            contact_id: opp.contact_id,
            property_id: opp.property_id,
            opportunity_id: opp.id,
            created_at: nowIso,
          },
          ...d.activities,
        ],
      };
    });
  }, []);

  const reopenOpportunity = useCallback<StoreValue["reopenOpportunity"]>((id) => {
    const nowIso = new Date().toISOString();
    setData((d) => ({
      ...d,
      opportunities: d.opportunities.map((o) =>
        o.id === id
          ? {
              ...o,
              stage: "nuevos",
              stage_since: nowIso,
              updated_at: nowIso,
              closed_at: null,
              priority_note: null,
            }
          : o,
      ),
    }));
  }, []);

  const addTask = useCallback<StoreValue["addTask"]>((input) => {
    const task: Task = {
      id: uid("t"),
      agency_id: seedAgency.id,
      owner_id: input.owner_id,
      text: input.text,
      is_priority: input.is_priority,
      is_done: false,
      due_date: input.due_date,
      contact_id: input.contact_id,
      created_at: new Date().toISOString(),
    };
    // Las urgentes arriba: es el orden en el que la pantalla las muestra.
    setData((d) => ({
      ...d,
      tasks: input.is_priority ? [task, ...d.tasks] : [...d.tasks, task],
    }));
    return task;
  }, []);

  const removeTask = useCallback<StoreValue["removeTask"]>((id) => {
    setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  }, []);

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
    setCurrentUserId(null);
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
      currentUserId,
      signIn,
      signOut,
      matches: matchesWithReview,
      contactById: (id) => (id ? contactIndex.get(id) : undefined),
      propertyById: (id) => (id ? propertyIndex.get(id) : undefined),
      profileById: (id) => (id ? profileIndex.get(id) : undefined),
      coverPhoto: (propertyId) => data.photos[propertyId]?.[0] ?? null,
      requirementOf: (contactId) =>
        data.requirements.find((r) => r.contact_id === contactId && r.is_active),
      addProperty,
      updateProperty,
      savePropertyEdit,
      addContact,
      updateContact,
      saveRequirement,
      addOpportunity,
      moveOpportunity,
      setOpportunityPriority,
      markOpportunityLost,
      reopenOpportunity,
      createOpportunityFromMatch,
      addEvent,
      addTask,
      toggleTask,
      removeTask,
      markMatchReviewed,
      reset,
    };
  }, [
    data,
    profile,
    matchesWithReview,
    currentUserId,
    signIn,
    signOut,
    addProperty,
    updateProperty,
    savePropertyEdit,
    addContact,
    updateContact,
    saveRequirement,
    addOpportunity,
    moveOpportunity,
    setOpportunityPriority,
    markOpportunityLost,
    reopenOpportunity,
    createOpportunityFromMatch,
    addEvent,
    addTask,
    toggleTask,
    removeTask,
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

/** Qué queda escrito en el historial según el tipo de evento agendado. */
const EVENT_ACTIVITY: Record<EventType, ActivityType> = {
  visita: "visita_programada",
  llamada: "llamada",
  reunion: "nota",
  seguimiento: "nota",
};

export const STAGE_LABEL: Record<OpportunityStage, string> = {
  nuevos: "Nuevos",
  contactados: "Contactados",
  visita: "Visita programada",
  negociacion: "Negociación",
  cierre: "Cierre",
  perdida: "Perdida",
};
