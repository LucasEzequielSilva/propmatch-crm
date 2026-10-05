import type { PublicationChannel } from "@/types/db";

export interface IntegrationGuide {
  tagline: string;
  difficulty: "facil" | "media" | "dificil" | null;
  recommendation: string | null;
  /** Lo que la agencia tiene que tener a mano antes de conectar. */
  needs: string[];
  /** Lo que la agencia puede hacer HOY con el portal; el último paso es la conexión en PropMatch, que todavía no existe. */
  steps: string[];
  estimatedTime: string | null;
  warning: string | null;
  /**
   * `false` mientras los pasos no estén contrastados con la documentación oficial del portal.
   * Fuente de estos textos: `docs/integraciones-portales.md` (parte de la documentación oficial
   * no se pudo leer; lo no confirmado queda en `false`).
   */
  verified: boolean;
}

const CONNECT_SOON = "Cuando el conector esté disponible vas a poder conectarla desde PropMatch con un clic.";

export const INTEGRATION_GUIDES: Record<PublicationChannel, IntegrationGuide> = {
  mercadolibre: {
    tagline: "Publicá y actualizá tus propiedades en Mercado Libre Inmuebles desde PropMatch.",
    difficulty: "media",
    recommendation: "Disponible ahora: conectá tu cuenta y publicá en minutos.",
    needs: [
      "Una cuenta de Mercado Libre a nombre de la inmobiliaria, habilitada como inmobiliaria (si no lo está, se pide a Mercado Libre desde su formulario de soporte).",
      "Un paquete de publicación de Inmuebles con cupo disponible (tipo Plata; Oro y Oro Premium son destaques).",
      "Que la propiedad esté sincronizada con la app: las fotos tienen que tener una URL pública.",
    ],
    steps: [
      "Verificá en tu cuenta de Mercado Libre qué paquete de Inmuebles tenés y cuánto cupo te queda.",
      "Autorizar a PropMatch se hace con el login de Mercado Libre: no compartís tu contraseña con nosotros.",
      "Tocá «Conectar Mercado Libre», iniciá sesión con la cuenta de la inmobiliaria y aceptá los permisos.",
    ],
    estimatedTime: "3 minutos",
    warning:
      "Si se agota el cupo del paquete, Mercado Libre puede pausar avisos. Sin paquete no se puede crear ningún aviso.",
    verified: true,
  },
  zonaprop: {
    tagline: "Publicá en Zonaprop sin volver a cargar las propiedades.",
    difficulty: "dificil",
    recommendation: null,
    needs: [
      "Cuenta de Zonaprop con un plan de publicación contratado.",
      "Que Zonaprop habilite tu cuenta para integraciones.",
    ],
    steps: [
      "Escribile a tu ejecutivo de Zonaprop y pedile habilitar la integración con PropMatch.",
      "Averiguá qué planes y cupos tenés asignados.",
      CONNECT_SOON,
    ],
    estimatedTime: null,
    warning: null,
    verified: false,
  },
  argenprop: {
    tagline: "Publicá en Argenprop desde PropMatch y asigná puntos a tus avisos.",
    difficulty: "dificil",
    recommendation: null,
    needs: [
      "Suscripción activa en Argenprop.",
      "Las credenciales de integración que te manda Argenprop: usuario (termina en @api.com), contraseña e ID de anunciante. No sirven tu mail y clave de siempre.",
    ],
    steps: [
      "Pedile a Argenprop la integración con PropMatch (suelen pedir razón social, CUIT y datos de contacto).",
      "Antes de activarla, cargá todas tus propiedades en PropMatch.",
      CONNECT_SOON,
    ],
    estimatedTime: null,
    warning:
      "Antes de activar la integración, consultale a Argenprop qué pasa con los avisos que ya tenés publicados.",
    verified: false,
  },
  cabaprop: {
    tagline: "Publicá en CABAPROP y mantené precio, fotos y planos sincronizados.",
    difficulty: "facil",
    recommendation: null,
    needs: [
      "Cuenta de administrador en CABAPROP (profesional matriculado).",
      "Mínimo 3 fotos por propiedad.",
    ],
    steps: [
      "En CABAPROP entrá a Menú, Configuración, Integración.",
      "Creá una clave API y ponele de nombre «PropMatch». Guardala: es como una contraseña.",
      CONNECT_SOON,
    ],
    estimatedTime: "5 minutos",
    warning: "No compartas la clave por otro medio que no sea la conexión de PropMatch.",
    verified: false,
  },
  facebook: {
    tagline: "Publicá tus propiedades como posteos en la página de Facebook de la inmobiliaria.",
    difficulty: "media",
    recommendation: null,
    needs: ["Ser administrador de la página de Facebook de la inmobiliaria."],
    steps: [
      "Confirmá que sos administrador de la página y que figura en tu Meta Business.",
      "La conexión es la misma que la de Instagram: un solo login con Facebook.",
      CONNECT_SOON,
    ],
    estimatedTime: "5 minutos",
    warning:
      "Se publica como posteo en la Página de la inmobiliaria (no en Marketplace).",
    verified: true,
  },
  instagram: {
    tagline: "Publicá fotos de tus propiedades en el Instagram de la inmobiliaria.",
    difficulty: "media",
    recommendation: null,
    needs: [
      "Cuenta de Instagram profesional (empresa o creador) vinculada a una página de Facebook.",
      "Ser administrador de esa página.",
    ],
    steps: [
      "Pasá tu Instagram a cuenta profesional si todavía no lo es (Configuración, Cuenta).",
      "Vinculá ese Instagram con la página de Facebook de la inmobiliaria.",
      CONNECT_SOON,
    ],
    estimatedTime: "5 minutos",
    warning:
      "Se publica en el feed de tu Instagram (hasta 10 fotos por carrusel). No es un aviso clasificado.",
    verified: true,
  },
  web: {
    tagline: "Tu catálogo se publica solo en tu sitio web.",
    difficulty: "facil",
    recommendation: null,
    needs: ["Elegir qué propiedades se muestran."],
    steps: ["Es un canal propio: no depende de ningún portal."],
    estimatedTime: null,
    warning: null,
    verified: true,
  },
};
