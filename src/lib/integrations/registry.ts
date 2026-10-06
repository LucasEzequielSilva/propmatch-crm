/**
 * Portales que una inmobiliaria puede conectar, con los textos para la UI.
 * Par del registro del servidor (api/_lib/integrations/registry.ts): mismo id
 * por adapter. El estado real (conectado, disponible, motivo) lo da
 * GET /api/integrations/list; esto es lo que se muestra mientras carga o si
 * el servidor no responde.
 *
 * Lenguaje para alguien que no sabe nada de APIs: nada de tokens, IDs ni
 * "claves técnicas". Sin imports (lo usan también las pruebas).
 */

export type PortalId = "mercadolibre" | "meta" | "argenprop" | "zonaprop";
export type PortalAuthMethod = "oauth" | "credentials" | "api_key" | "feed";
export type PortalAvailability = "available" | "needs_approval" | "coming_soon";

export interface PortalMeta {
  id: PortalId;
  name: string;
  /** Iniciales para el logo. */
  short: string;
  /** Color de marca (fondo del logo). */
  color: string;
  /** Color del texto del logo (contraste). */
  ink: string;
  description: string;
  authMethod: PortalAuthMethod;
  /** Canales de property_publications que cubre (Meta = Facebook + Instagram). */
  channels: string[];
  /** Disponibilidad por defecto (el servidor puede decir otra cosa). */
  availability: PortalAvailability;
  /** Qué tiene que hacer la inmobiliaria, paso a paso. */
  help: string[];
  /** Aviso importante antes de conectar. */
  warning?: string;
}

export const PORTALS: PortalMeta[] = [
  {
    id: "mercadolibre",
    name: "Mercado Libre Inmuebles",
    short: "ML",
    color: "#FFE600",
    ink: "#1F2937",
    description: "Publicá y actualizá tus propiedades en Mercado Libre con la cuenta de tu inmobiliaria.",
    authMethod: "oauth",
    channels: ["mercadolibre"],
    availability: "available",
    help: [
      "Tené a mano el usuario y la contraseña de la cuenta de Mercado Libre de la inmobiliaria (la cuenta principal, no la de un colaborador).",
      "Tocá «Conectar»: se abre Mercado Libre, iniciás sesión y aceptás. Tu contraseña la escribís en Mercado Libre, nunca en PropMatch.",
      "Para publicar, la cuenta tiene que estar habilitada como inmobiliaria y tener un paquete de Inmuebles con lugar disponible.",
    ],
  },
  {
    id: "meta",
    name: "Facebook e Instagram",
    short: "f",
    color: "#1877F2",
    ink: "#FFFFFF",
    description: "Publicá tus propiedades como posteos en la Página de Facebook y el Instagram de la inmobiliaria.",
    authMethod: "oauth",
    channels: ["facebook", "instagram"],
    availability: "needs_approval",
    help: [
      "Tenés que ser administrador de la Página de Facebook de la inmobiliaria.",
      "Para Instagram, la cuenta tiene que ser profesional y estar vinculada a esa Página.",
      "Tocá «Conectar con Facebook», elegí la Página y aceptá. Es una sola conexión para los dos.",
    ],
  },
  {
    id: "argenprop",
    name: "Argenprop",
    short: "AP",
    color: "#0F766E",
    ink: "#FFFFFF",
    description: "Publicá en Argenprop desde PropMatch sin cargar las propiedades dos veces.",
    authMethod: "credentials",
    channels: ["argenprop"],
    availability: "coming_soon",
    help: [
      "Antes que nada, cargá en PropMatch todas las propiedades que tenés publicadas en Argenprop.",
      "Pedile a Argenprop (a tu ejecutivo de cuenta o a soporte) la integración con PropMatch. Suelen pedir razón social, CUIT y un contacto.",
      "Argenprop te manda por mail un usuario especial que termina en «@api.com», una contraseña y tu número de vendedor. No son los datos con los que entrás a Argenprop.",
      "Pegalos en «Conectar Argenprop». Quedan guardados de forma segura y nadie de tu equipo los puede volver a ver.",
    ],
    warning:
      "Cuando pedís la integración, Argenprop puede dar de baja los avisos que cargaste a mano. Consultalo con ellos antes y tené todo cargado en PropMatch.",
  },
  {
    id: "zonaprop",
    name: "Zonaprop",
    short: "ZP",
    color: "#F26122",
    ink: "#FFFFFF",
    description: "Publicá en Zonaprop desde PropMatch con tu plan de publicación.",
    authMethod: "oauth",
    channels: ["zonaprop"],
    availability: "coming_soon",
    help: [
      "Necesitás una cuenta de Zonaprop con un plan de publicación activo.",
      "Cuando esté disponible, vas a pedirle a Zonaprop que habilite la integración con PropMatch y después conectar tu cuenta con un clic.",
    ],
  },
];

export function portalMeta(id: string): PortalMeta | null {
  return PORTALS.find((p) => p.id === id) ?? null;
}

/** Portal al que pertenece un canal de publicación (facebook → meta). */
export function portalOfChannel(channel: string): PortalMeta | null {
  return PORTALS.find((p) => p.channels.includes(channel)) ?? null;
}
