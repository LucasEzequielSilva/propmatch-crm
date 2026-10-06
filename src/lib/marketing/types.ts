import type { ContactKind, ContactSource, ContactStatus, CurrencyCode, OperationType, PropertyType } from "@/types/db";
import type { MarketingChannel, RecipientStatus, SendLimits, UnsubscribeScope } from "../../../shared/marketing";

export type { MarketingChannel, UnsubscribeScope, SendLimits, RecipientStatus };

/** Interacciones para retargeting. */
export type InteractionRule = "visito_sin_oferta" | "oferto_sin_cierre" | "oportunidad_perdida";

export interface SegmentRules {
  /* Por búsqueda (requerimiento activo del contacto) */
  operation: OperationType | null;
  propertyTypes: PropertyType[];
  zones: string[];
  /** Rango de precio buscado (se cruza con el presupuesto del contacto). */
  priceMin: number | null;
  priceMax: number | null;
  currency: CurrencyCode;
  /** Busca al menos N ambientes. */
  roomsMin: number | null;
  /* Por interacción */
  /** "any" = matcheó con alguna; id = matcheó con esa propiedad. */
  matchedProperty: string | null;
  interactions: InteractionRule[];
  /** Sin contacto hace al menos N días. */
  noContactDays: number | null;
  /* Por origen / tipo / estado / etiqueta */
  sources: ContactSource[];
  kinds: ContactKind[];
  statuses: ContactStatus[];
  tags: string[];
}

export const EMPTY_RULES: SegmentRules = {
  operation: null,
  propertyTypes: [],
  zones: [],
  priceMin: null,
  priceMax: null,
  currency: "USD",
  roomsMin: null,
  matchedProperty: null,
  interactions: [],
  noContactDays: null,
  sources: [],
  kinds: [],
  statuses: [],
  tags: [],
};

export interface Segment {
  id: string;
  name: string;
  rules: SegmentRules;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplate {
  id: string;
  channel: "email";
  name: string;
  subject: string;
  preheader: string;
  body: string;
  ctaLabel: string;
  /** Puede usar variables ({{link_web}}, {{link_propiedad}}). */
  ctaUrl: string;
  includeRecommendations: boolean;
  recommendationsCount: number;
  /** Disposición 4/2009: "Publicidad" en el asunto. */
  advertisingPrefix: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppTemplate {
  id: string;
  channel: "whatsapp";
  name: string;
  /** Nombre y idioma de la plantilla en Meta (debe estar APROBADA y ser MARKETING). */
  waName: string;
  waLanguage: string;
  /** Texto del cuerpo como está (o se va a cargar) en Meta, con {{1}}, {{2}}… */
  body: string;
  /** Qué va en cada {{n}}: texto con variables del CRM ("{{nombre}}"). */
  params: string[];
  /** Cómo se da de baja: botón de respuesta rápida o texto "Respondé BAJA". */
  optOut: "button" | "footer";
  created_at: string;
  updated_at: string;
}

export type MarketingTemplate = EmailTemplate | WhatsAppTemplate;

export type CampaignStatus = "borrador" | "programada" | "enviando" | "enviada" | "pausada" | "cancelada";

export interface CampaignStats {
  total?: number;
  queued?: number;
  sent?: number;
  delivered_any?: number;
  opened_any?: number;
  clicked_any?: number;
  replied_any?: number;
  unsubscribed?: number;
  bounced?: number;
  complained?: number;
  failed?: number;
  skipped?: number;
}

export interface Campaign {
  id: string;
  name: string;
  channel: MarketingChannel;
  segmentId: string | null;
  templateId: string | null;
  status: CampaignStatus;
  /** ISO. null = enviar apenas se confirma. */
  scheduledAt: string | null;
  limits: SendLimits;
  /** Destinatarios elegibles al momento de confirmar. */
  audienceSize: number | null;
  stats: CampaignStats;
  lastError: string | null;
  created_at: string;
  updated_at: string;
}

export type ConsentMethod = "formulario_web" | "whatsapp" | "verbal" | "escrito" | "importacion" | "app" | "email" | "otro";

export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  formulario_web: "Formulario web (casilla marcada)",
  whatsapp: "Por WhatsApp (lo pidió por escrito)",
  verbal: "En persona / por teléfono",
  escrito: "Por escrito (firmado)",
  importacion: "Importado con consentimiento previo",
  app: "Desde la app PropMatch",
  email: "Por email",
  otro: "Otro",
};

export interface Consent {
  id: string;
  contact_id: string;
  channel: MarketingChannel;
  status: "granted" | "revoked";
  method: ConsentMethod;
  evidence: string | null;
  /** Cuándo lo dio (puede ser anterior a cuando se cargó). */
  given_at: string;
  recorded_at: string;
  /** Ya está en el servidor. */
  synced: boolean;
}

export type UnsubSource =
  | "link_email"
  | "one_click"
  | "whatsapp_boton"
  | "whatsapp_texto"
  | "whatsapp_meta"
  | "queja_spam"
  | "rebote"
  | "manual";

export const UNSUB_SOURCE_LABEL: Record<UnsubSource, string> = {
  link_email: "Link de baja del email",
  one_click: "Botón de baja del correo (un clic)",
  whatsapp_boton: "Botón de WhatsApp",
  whatsapp_texto: "Respondió BAJA por WhatsApp",
  whatsapp_meta: "Frenó las promociones desde WhatsApp",
  queja_spam: "Marcó el email como spam",
  rebote: "El email rebotó",
  manual: "Cargada a mano",
};

export interface Unsubscribe {
  id: string;
  contact_id: string | null;
  email: string | null;
  phone: string | null;
  scope: UnsubscribeScope;
  source: UnsubSource;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
  /** Consentimiento nuevo que la revirtió. */
  revoked_by_consent: string | null;
  synced: boolean;
  /** Vino del servidor (link público, webhook). */
  from_server: boolean;
}

export interface ServerStatus {
  /** null = todavía no se consultó. */
  checkedAt: string | null;
  configured: { db: boolean; email: boolean; whatsapp: boolean; sendEnabled: boolean };
  whatsapp: {
    connected: boolean;
    phone: string | null;
    templates: { name: string; language: string; category: string | null; status: string; body_params: number; hasOptOutButton: boolean; components: { type?: string; text?: string }[] }[];
  } | null;
  isAdmin: boolean;
  /** Error de red / sin sesión / sin /api (vite dev). */
  reachable: boolean;
}
