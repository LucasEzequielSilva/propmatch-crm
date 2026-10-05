import type Anthropic from "@anthropic-ai/sdk";

/**
 * Herramientas de Proppi. Se EJECUTAN en el navegador (los datos del CRM viven
 * en localStorage): el servidor solo se las declara a Claude y devuelve los
 * `tool_use` al cliente. Los nombres tienen que coincidir con
 * `src/lib/proppi/tools.ts`.
 *
 * Todas son de solo lectura. `strict: true` exige `additionalProperties: false`
 * y nada de minimum/maximum/minLength (no soportados por structured outputs).
 *
 * El orden y el contenido son fijos: las tools van primero en el prompt, así
 * que cualquier cambio acá invalida el caché de todas las consultas.
 */

type Schema = Anthropic.Beta.BetaTool["input_schema"];

const obj = (properties: Record<string, unknown>, required: string[]): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const OPERACION = { type: "string", enum: ["venta", "alquiler", "alquiler_temporal"] };
const TIPO = { type: "string", enum: ["casa", "departamento", "ph", "terreno", "local", "oficina"] };
const ESTADO_PROP = {
  type: "string",
  enum: ["disponible", "reservada", "vendida", "alquilada", "pausada", "en_revision"],
};
const LIMIT = { type: "integer", description: "Cuántos resultados como máximo (por defecto 10, tope 20)." };

export const PROPPI_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "buscar_contactos",
    description:
      "Busca contactos del CRM por nombre, email, teléfono o notas. Usala cuando el usuario nombre a una persona o pida una lista de clientes; devuelve id, nombre, tipo, estado y última actividad. Con query vacía trae los más recientes.",
    input_schema: obj({ query: { type: "string", description: "Texto a buscar. Puede ser vacío." }, limit: LIMIT }, ["query"]),
  },
  {
    name: "ver_contacto",
    description:
      "Ficha de un contacto por id: datos, búsqueda activa (requerimiento), oportunidades y las últimas actividades. Usala antes de hablar de un contacto en particular o de redactarle un mensaje.",
    input_schema: obj({ id: { type: "string", description: "id del contacto (de buscar_contactos)." } }, ["id"]),
  },
  {
    name: "buscar_propiedades",
    description:
      "Lista propiedades del inventario de la inmobiliaria con filtros opcionales. Usala para preguntas sobre el stock, precios o zonas. Los precios están en la moneda indicada en cada propiedad.",
    input_schema: obj(
      {
        operacion: OPERACION,
        tipo: TIPO,
        zona: { type: "string", description: "Barrio, localidad o zona (búsqueda parcial)." },
        precio_min: { type: "number" },
        precio_max: { type: "number" },
        estado: ESTADO_PROP,
        limit: LIMIT,
      },
      [],
    ),
  },
  {
    name: "ver_propiedad",
    description:
      "Detalle de una propiedad por id, con su diagnóstico: posicionamiento de precio frente a comparables, demanda, señales y recomendaciones. Usala para opinar sobre el precio o el rendimiento de una propiedad.",
    input_schema: obj({ id: { type: "string", description: "id de la propiedad." } }, ["id"]),
  },
  {
    name: "compradores_compatibles",
    description:
      "Contactos cuya búsqueda activa es compatible con una propiedad, ordenados por puntaje de match (0-100) con sus razones. Usala para saber a quién ofrecerle una propiedad.",
    input_schema: obj({ property_id: { type: "string" } }, ["property_id"]),
  },
  {
    name: "leer_conversacion",
    description:
      "Mensajes del chat de la app PropMatch para un match (conversación del Inbox), del más viejo al más nuevo, con quién escribió cada uno.",
    input_schema: obj({ match_id: { type: "string", description: "id de la conversación del Inbox." } }, ["match_id"]),
  },
  {
    name: "conversaciones_sin_responder",
    description:
      "Chats de la app cuyo último mensaje es del cliente (esperan respuesta) y seguimientos pendientes del CRM (leads sin contactar, negociaciones frenadas). Usala cuando pregunten qué falta contestar o a quién llamar.",
    input_schema: obj({}, []),
  },
  {
    name: "agenda",
    description: "Eventos de la agenda (visitas, llamadas, reuniones, seguimientos) entre dos fechas, inclusive.",
    input_schema: obj(
      {
        desde: { type: "string", format: "date", description: "YYYY-MM-DD" },
        hasta: { type: "string", format: "date", description: "YYYY-MM-DD" },
      },
      ["desde", "hasta"],
    ),
  },
  {
    name: "oportunidades",
    description:
      "Oportunidades del embudo de ventas, opcionalmente de una etapa, con contacto, propiedad, valor y días en la etapa.",
    input_schema: obj(
      { etapa: { type: "string", enum: ["nuevos", "contactados", "visita", "negociacion", "cierre", "perdida"] } },
      [],
    ),
  },
  {
    name: "ofertas",
    description: "Ofertas recibidas desde la app sobre propiedades de la inmobiliaria, opcionalmente filtradas por estado.",
    input_schema: obj({ estado: { type: "string", enum: ["pending", "accepted", "rejected"] } }, []),
  },
].map((t) => ({ ...t, strict: true }));
