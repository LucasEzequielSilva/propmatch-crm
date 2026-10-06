import type { VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { fail, json } from "../http.js";
import { modelCaps, proppiModel } from "./model.js";
import {
  MAX_DICTATION_CHARS,
  busquedaSchema,
  propiedadSchema,
  sanitizeBusqueda,
  sanitizeCatalog,
  sanitizePropiedad,
  type VozCatalog,
  type VozKind,
} from "../../../shared/voz.js";

/**
 * Modo "extract" de /api/proppi: carga por voz.
 *
 * Recibe el texto dictado (ya transcripto por el navegador: el audio nunca
 * llega acá) y devuelve los datos de una propiedad o de una búsqueda como JSON
 * validado. Usa structured outputs (`output_config.format` con json_schema):
 * la respuesta respeta el esquema, y igual se sanea con las mismas reglas que
 * el cliente (nada fuera de catálogo).
 *
 * Body: { mode: "extract", kind: "propiedad" | "busqueda", text, catalog: { zones, amenities } }
 * Respuesta: { kind, data, model } · errores { error: codigo } como el resto de Proppi.
 */

export interface ExtractBody {
  kind: VozKind;
  text: string;
  catalog: VozCatalog;
}

export function parseExtractBody(b: Record<string, unknown>): ExtractBody | null {
  const kind = b.kind === "propiedad" || b.kind === "busqueda" ? b.kind : null;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!kind || !text || text.length > MAX_DICTATION_CHARS) return null;
  return { kind, text, catalog: sanitizeCatalog(b.catalog) };
}

const OPS = "venta (también 'compra'), alquiler, alquiler_temporal (temporario, por día/mes de vacaciones)";

function systemFor(kind: VozKind, c: VozCatalog): string {
  const common = [
    "Sos el asistente de carga de un CRM inmobiliario argentino. Un agente dictó (o escribió) datos en español rioplatense; la transcripción automática puede tener errores.",
    "Extraé SOLO lo que se dijo. Si un dato no se mencionó, null (o lista vacía). No supongas valores típicos.",
    `Operaciones: ${OPS}.`,
    "Números: '85 mil' = 85000, '1 palo'/'un millón' = 1000000, '120 lucas' = 120000. Moneda: 'dólares', 'verdes', 'USD', 'U$S' = USD; 'pesos', '$' = ARS. Si no se dice la moneda, null.",
    `Zonas del CRM (usá exactamente estos valores): ${c.zones.join(", ") || "(sin lista)"}. Si nombran otra zona/barrio/localidad, no la fuerces: anotala en notes.`,
    `Amenities del CRM (usá exactamente estos valores): ${c.amenities.join(", ") || "(sin lista)"}. Equivalencias: pileta = Piscina, quincho/asador = Parrilla, garage = Cochera. Lo que no esté en la lista va a notes.`,
    "Tipos: casa, departamento (depto), ph, terreno (lote), local, oficina.",
  ];
  if (kind === "propiedad") {
    common.push(
      "Es la ficha de UNA propiedad para publicar.",
      "title: título de aviso claro (tipo, ambientes, zona, un diferencial), sin precio ni mayúsculas sostenidas.",
      "description: redactá un texto de aviso prolijo en español rioplatense, en tercera persona, usando solo los datos dictados; sin inventar características, sin precio ni datos de contacto. Si se dictó muy poco, una o dos oraciones.",
      "Ambientes incluye living; dormitorios es aparte. '2 ambientes' = rooms 2. No calcules uno a partir del otro.",
    );
  } else {
    common.push(
      "Es lo que BUSCA un cliente (comprador o inquilino), no una propiedad.",
      "'hasta X' = budget_max; 'desde X' = budget_min; 'entre X e Y' = ambos. 'mínimo 2 dormitorios' o 'de 2 dormitorios' = bedrooms_min 2.",
      "Si nombran al cliente o su teléfono, completá contact_name / contact_phone.",
    );
  }
  return common.join("\n");
}

export async function handleExtract(res: VercelResponse, body: ExtractBody, agencyId: string): Promise<void> {
  const model = proppiModel();
  const caps = modelCaps(model);
  const schema = body.kind === "propiedad" ? propiedadSchema(body.catalog) : busquedaSchema(body.catalog);

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: 2048,
    system: systemFor(body.kind, body.catalog),
    messages: [{ role: "user", content: `<dictado>\n${body.text}\n</dictado>` }],
    // Haiku 4.5: sin effort ni thinking (no se manda el parámetro).
    output_config: caps.effort
      ? { format: { type: "json_schema", schema }, effort: "low" }
      : { format: { type: "json_schema", schema } },
  };

  const client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  try {
    const msg = await client.messages.create(params);
    console.log(
      `[proppi] agency=${agencyId} mode=extract kind=${body.kind} model=${msg.model} stop=${msg.stop_reason} ` +
        `in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`,
    );
    // Con refusal o max_tokens la salida puede no respetar el esquema.
    if (msg.stop_reason === "refusal") return fail(res, 422, "refusal");
    if (msg.stop_reason === "max_tokens") return fail(res, 422, "truncated");
    const block = msg.content.find((b) => b.type === "text");
    let raw: unknown;
    try {
      raw = block && block.type === "text" ? JSON.parse(block.text) : null;
    } catch {
      raw = null;
    }
    if (!raw) return fail(res, 502, "bad_output");
    const data = body.kind === "propiedad" ? sanitizePropiedad(raw, body.catalog) : sanitizeBusqueda(raw, body.catalog);
    json(res, 200, { kind: body.kind, data, model: msg.model });
  } catch (err) {
    let code = "server_error";
    if (err instanceof Anthropic.RateLimitError) code = "rate_limited";
    else if (err instanceof Anthropic.AuthenticationError) code = "not_configured";
    else if (err instanceof Anthropic.BadRequestError) code = "bad_request";
    else if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) code = "overloaded";
    console.error(`[proppi] extract error ${code}`, err instanceof Anthropic.APIError ? err.status : "");
    fail(res, code === "rate_limited" ? 429 : 502, code);
  }
}
