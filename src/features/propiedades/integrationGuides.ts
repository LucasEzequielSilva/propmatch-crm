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
    recommendation: "Recomendado para empezar: es el único portal con alta propia, sin contrato previo.",
    needs: [
      "Una cuenta de Mercado Libre a nombre de la inmobiliaria.",
      "Un paquete de publicación de Inmuebles con cupo disponible.",
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
    recommendation: "Depende de un acuerdo con Zonaprop: todavía no está disponible.",
    needs: [
      "Cuenta de Zonaprop con un plan de publicación contratado.",
      "Que Zonaprop habilite tu cuenta para integraciones (a confirmar con Zonaprop).",
    ],
    steps: [
      "Escribile a tu ejecutivo de Zonaprop y pedile habilitar la integración con PropMatch.",
      "Averiguá qué planes y cupos tenés asignados.",
      CONNECT_SOON,
    ],
    estimatedTime: null,
    warning: "El tiempo de respuesta y las condiciones dependen de Zonaprop (no verificado).",
    verified: false,
  },
  argenprop: {
    tagline: "Publicá en Argenprop desde PropMatch y asigná puntos a tus avisos.",
    difficulty: "dificil",
    recommendation: "Depende de un acuerdo con Argenprop: todavía no está disponible.",
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
      "Al activar la integración, Argenprop puede dar de baja los avisos que ya tenías publicados, y desconectar no los despublica (no verificado en la documentación oficial).",
    verified: false,
  },
  cabaprop: {
    tagline: "Publicá en CABAPROP y mantené precio, fotos y planos sincronizados.",
    difficulty: "facil",
    recommendation: "Conexión simple con clave API, pendiente de confirmar que PropMatch pueda usar su endpoint.",
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
    recommendation: "Publica en tu Página, no en Marketplace.",
    needs: ["Ser administrador de la página de Facebook de la inmobiliaria."],
    steps: [
      "Confirmá que sos administrador de la página y que figura en tu Meta Business.",
      "La conexión es la misma que la de Instagram: un solo login con Facebook.",
      CONNECT_SOON,
    ],
    estimatedTime: "5 minutos",
    warning:
      "Facebook Marketplace de inmuebles no está disponible: es solo para partners aprobados por Meta. PropMatch también necesita la aprobación de Meta (revisión de la app), que puede tardar semanas.",
    verified: true,
  },
  instagram: {
    tagline: "Publicá fotos de tus propiedades en el Instagram de la inmobiliaria.",
    difficulty: "media",
    recommendation: "Alcance rápido por vía oficial, sujeto a la aprobación de Meta.",
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
      "Instagram acepta imágenes JPEG, hasta 10 por carrusel y un máximo de 100 publicaciones por día vía API. Es una publicación del feed, no un aviso clasificado.",
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
