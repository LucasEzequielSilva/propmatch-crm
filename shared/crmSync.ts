/**
 * Datos del CRM en la base propia: piezas puras, sin red ni React.
 * Las usan api/crm.ts (servidor) y src/data/remote.ts (navegador).
 * Pruebas: npm run test:crm-sync. Ver docs/datos-en-la-base.md.
 *
 * Un registro = una entidad del store (`kind` + `id`) con su contenido en
 * `data`. Las bajas viajan como tumbas (`deleted: true`): en la base nunca se
 * borra nada, así otro navegador se entera y se puede recuperar.
 */

export const CRM_KINDS = [
  "agency",
  "profile",
  "contact",
  "requirement",
  "property",
  "photos",
  "opportunity",
  "activity",
  "event",
  "task",
  "deal",
  "app_offer",
  "reviewed_match",
  "snooze",
  "synced_app_event",
  "app_visit_feedback",
  "app_visit_checklist",
] as const;

export type CrmKind = (typeof CRM_KINDS)[number];

export interface CrmRecord {
  kind: CrmKind;
  id: string;
  data: Record<string, unknown>;
  deleted?: boolean;
}

/** Lo que devuelve la base: además, la versión global del cambio. */
export interface CrmStoredRecord extends CrmRecord {
  version: number;
  updated_by?: string | null;
}

/** Clave única de un registro dentro de una inmobiliaria. */
export const recordKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

export const PUSH_MAX_ITEMS = 300;
/** Tope del cuerpo de un push (Vercel corta en 4,5 MB; las fotos no viajan acá). */
export const PUSH_MAX_BYTES = 3_000_000;
export const PULL_PAGE_SIZE = 500;
/** Foto subida desde el CRM: data URL de hasta 5 MB (compressImage deja ~300 KB). */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const KIND_SET = new Set<string>(CRM_KINDS);

export const isCrmKind = (v: unknown): v is CrmKind => typeof v === "string" && KIND_SET.has(v);
export const isRecordId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);

/**
 * Valida el cuerpo de `POST /api/crm/push`. Devuelve los registros limpios o
 * `null` si el pedido no es válido (tipo desconocido, id raro, data que no es
 * un objeto, demasiados ítems).
 */
export function parsePushBody(body: unknown): CrmRecord[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > PUSH_MAX_ITEMS) return null;
  const out: CrmRecord[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return null;
    const { kind, id, data, deleted } = raw as Record<string, unknown>;
    if (!isCrmKind(kind) || !isRecordId(id)) return null;
    if (deleted !== undefined && typeof deleted !== "boolean") return null;
    if (deleted) {
      out.push({ kind, id, data: {}, deleted: true });
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    out.push({ kind, id, data: data as Record<string, unknown> });
  }
  return out;
}

/** `?since=N` de `GET /api/crm/pull`: entero >= 0, o 0 si no vino o no sirve. */
export function parseSince(v: unknown): number {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string" || !/^\d{1,18}$/.test(s)) return 0;
  return Number(s);
}

/**
 * Valida `POST /api/crm/upload`: una foto en data URL (jpeg/png/webp) para una
 * propiedad. Devuelve los bytes y la extensión, o `null`.
 */
export function parseUploadBody(body: unknown): { propertyId: string; bytes: Uint8Array; mime: string; ext: string } | null {
  const b = (body ?? {}) as { propertyId?: unknown; dataUrl?: unknown };
  if (!isRecordId(b.propertyId) || typeof b.dataUrl !== "string") return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl);
  if (!m) return null;
  // 4 caracteres base64 = 3 bytes: se corta antes de decodificar.
  if (m[2].length > Math.ceil(UPLOAD_MAX_BYTES / 3) * 4) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(m[2]);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > UPLOAD_MAX_BYTES) return null;
  const mime = m[1];
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
  return { propertyId: b.propertyId, bytes, mime, ext };
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Diff y aplicación (navegador) ────────────────────────────────────────── */

export interface Row {
  id: string;
  /** Dato de ejemplo: nunca sale del navegador. */
  is_sample?: boolean;
}

/** `true` si la fila es un ejemplo (nunca se sincroniza). */
export const isSampleRow = (r: { is_sample?: boolean } | null | undefined) => r?.is_sample === true;

/**
 * Convierte las filas reales (sin ejemplos) de una lista en registros.
 * `agency_id` no viaja: en la base el ámbito es la inmobiliaria.
 */
export function rowsToRecords<T extends Row>(kind: CrmKind, rows: T[]): CrmRecord[] {
  const out: CrmRecord[] = [];
  for (const r of rows) {
    if (isSampleRow(r)) continue;
    out.push({ kind, id: r.id, data: rowData(r) });
  }
  return out;
}

/** La fila tal cual, sin la marca de ejemplo. */
export function rowData<T extends object>(row: T): Record<string, unknown> {
  const { is_sample: _s, ...rest } = row as T & { is_sample?: boolean };
  void _s;
  return rest as Record<string, unknown>;
}

/**
 * Aplica registros remotos a una lista de filas: reemplaza por id, agrega lo
 * nuevo (adelante, como hace el store) y saca las tumbas. Las filas de ejemplo
 * no se tocan. `skip` = claves con cambios locales todavía sin subir: lo local
 * gana hasta que se suba.
 */
export function applyRecordsToRows<T extends Row>(
  rows: T[],
  records: CrmRecord[],
  skip: ReadonlySet<string> = new Set(),
): T[] {
  if (records.length === 0) return rows;
  const byId = new Map<string, CrmRecord>();
  for (const r of records) if (!skip.has(recordKey(r))) byId.set(r.id, r);
  if (byId.size === 0) return rows;

  const seen = new Set<string>();
  const next: T[] = [];
  let changed = false;
  for (const row of rows) {
    const rec = byId.get(row.id);
    if (!rec) {
      next.push(row);
      continue;
    }
    seen.add(row.id);
    // Un ejemplo con el mismo id tapa lo remoto: no se pisa ni se duplica.
    if (isSampleRow(row)) {
      next.push(row);
      continue;
    }
    changed = true;
    if (rec.deleted) continue;
    next.push({ ...(rec.data as object), id: rec.id } as T);
  }
  const added: T[] = [];
  for (const rec of byId.values()) {
    if (seen.has(rec.id) || rec.deleted) continue;
    added.push({ ...(rec.data as object), id: rec.id } as T);
    changed = true;
  }
  return changed ? [...added, ...next] : rows;
}

/**
 * Qué subir: lo que difiere de lo último que se sabe que tiene la base
 * (`known`, por clave → JSON de `data`) y las tumbas de lo que la base tenía y
 * acá ya no está. `current` son los registros reales del store ahora.
 */
export function pendingChanges(
  current: CrmRecord[],
  known: ReadonlyMap<string, string>,
  stringify: (data: Record<string, unknown>) => string = JSON.stringify,
): CrmRecord[] {
  const out: CrmRecord[] = [];
  const present = new Set<string>();
  for (const rec of current) {
    const key = recordKey(rec);
    present.add(key);
    if (known.get(key) !== stringify(rec.data)) out.push(rec);
  }
  for (const [key, json] of known) {
    if (present.has(key) || json === TOMBSTONE) continue;
    const i = key.indexOf(":");
    out.push({ kind: key.slice(0, i) as CrmKind, id: key.slice(i + 1), data: {}, deleted: true });
  }
  return out;
}

/** Marca en `known` de una clave que la base tiene como borrada. */
export const TOMBSTONE = "\u0000deleted";

/** Lo que `known` debe guardar para un registro recién subido o recibido. */
export const knownValue = (rec: CrmRecord, stringify: (d: Record<string, unknown>) => string = JSON.stringify) =>
  rec.deleted ? TOMBSTONE : stringify(rec.data);

/** Parte una lista en tandas que respeten el tope de ítems y de bytes de un push. */
export function chunkForPush(
  records: CrmRecord[],
  stringify: (data: Record<string, unknown>) => string = JSON.stringify,
): CrmRecord[][] {
  const chunks: CrmRecord[][] = [];
  let cur: CrmRecord[] = [];
  let bytes = 0;
  for (const rec of records) {
    const size = rec.deleted ? 64 : stringify(rec.data).length + 64;
    if (cur.length > 0 && (cur.length >= PUSH_MAX_ITEMS || bytes + size > PUSH_MAX_BYTES)) {
      chunks.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(rec);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * Propiedades traídas de la app por dos navegadores a la vez: quedan dos filas
 * con el mismo `app_property_id`. Gana la más vieja (y a igual fecha, el id
 * menor): la decisión es la misma en todos los navegadores.
 */
export function dedupeByAppId<T extends Row & { app_property_id?: string | null; created_at?: string }>(rows: T[]): T[] {
  const winner = new Map<string, T>();
  for (const r of rows) {
    if (!r.app_property_id || isSampleRow(r)) continue;
    const w = winner.get(r.app_property_id);
    if (!w || (r.created_at ?? "") < (w.created_at ?? "") || ((r.created_at ?? "") === (w.created_at ?? "") && r.id < w.id)) {
      winner.set(r.app_property_id, r);
    }
  }
  const out = rows.filter((r) => !r.app_property_id || isSampleRow(r) || winner.get(r.app_property_id) === r);
  return out.length === rows.length ? rows : out;
}
