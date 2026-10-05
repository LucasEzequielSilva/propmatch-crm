/**
 * Cliente de /api/meta/* para PUBLICAR en Facebook (Página) e Instagram.
 * El navegador nunca ve tokens: manda el JWT de la sesión y el servidor
 * resuelve la agencia y la conexión (agency_integrations, provider 'meta').
 *
 * Las fotos editadas en el Estudio se suben directo al bucket público
 * `property-photos` de la app, en la carpeta de la agencia
 * (`<agency_id>/instagram/<uuid>.jpg`): la policy de Storage ya habilita esa
 * carpeta para los miembros y Meta necesita una URL pública para leerlas.
 */
import { supabase } from "./supabase";
import type { PropertyPublication } from "@/types/db";
import type { IgPublishKind, MediaIssue } from "../../shared/metaPublish";

export interface MetaApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  /** Cuerpo del error (p. ej. `issues` de fotos inválidas o `detail` de Meta). */
  body: Record<string, unknown> | null;
}

async function authHeader(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : null;
}

export async function metaApi<T>(action: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<MetaApiResult<T>> {
  try {
    const auth = await authHeader();
    if (!auth) return { ok: false, status: 401, data: null, error: "unauthorized", body: null };
    const r = await fetch(`/api/meta/${action}`, {
      method: init?.method ?? "GET",
      headers: { ...auth, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const isJson = r.headers.get("content-type")?.includes("application/json");
    // Sin /api (vite dev sin `vercel dev`) llega el index.html: lo tratamos como "no configurado".
    if (!isJson) return { ok: false, status: r.status === 200 ? 503 : r.status, data: null, error: "not_configured", body: null };
    const j = (await r.json()) as Record<string, unknown>;
    const ok = r.ok && r.status !== 202;
    return { ok, status: r.status, data: r.ok ? (j as T) : null, error: ok ? null : ((j.error as string) ?? (r.status === 202 ? "pending" : "error")), body: j };
  } catch {
    return { ok: false, status: 0, data: null, error: "network", body: null };
  }
}

export interface MetaPublishStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  needsReauth?: boolean;
  page?: { id?: string; name: string | null };
  instagram?: { username: string | null } | null;
  isAdmin?: boolean;
}

/** Sube un JPEG a la carpeta de la agencia y devuelve su URL pública. */
export async function uploadSocialJpeg(agencyId: string, blob: Blob): Promise<string> {
  const path = `${agencyId}/instagram/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("property-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error("upload");
  return supabase.storage.from("property-photos").getPublicUrl(path).data.publicUrl;
}

export interface IgPublishInput {
  kind: IgPublishKind;
  images: { url: string; alt?: string }[];
  caption: string;
  /** uuid de la propiedad en la app (para guardar en property_publications). */
  propertyId?: string | null;
}

export interface IgPublishOutcome {
  ok: boolean;
  permalink: string | null;
  mediaId: string | null;
  row: PropertyPublication | null;
  error: string | null;
  issues: MediaIssue[];
  detail: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Crea el contenedor y lo publica cuando Instagram termina de procesarlo.
 * Pregunta cada 5 s, hasta 5 minutos (la doc sugiere no insistir más que eso).
 */
export async function publishToInstagram(input: IgPublishInput, onStep?: (s: "preparing" | "processing" | "publishing") => void): Promise<IgPublishOutcome> {
  const fail = (r: MetaApiResult<unknown>): IgPublishOutcome => ({
    ok: false,
    permalink: null,
    mediaId: null,
    row: null,
    error: r.error,
    issues: (r.body?.issues as MediaIssue[] | undefined) ?? [],
    detail: (r.body?.detail as string | undefined) ?? (r.body?.message as string | undefined) ?? null,
  });
  onStep?.("preparing");
  const created = await metaApi<{ containerId: string }>("ig-create", { method: "POST", body: input });
  if (!created.ok || !created.data) return fail(created);
  const containerId = created.data.containerId;
  onStep?.("processing");
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const r = await metaApi<{ mediaId: string; permalink: string | null; row: PropertyPublication | null }>("ig-publish", {
      method: "POST",
      body: { containerId, propertyId: input.propertyId ?? null },
    });
    if (r.status === 202) {
      if (Date.now() > deadline) return { ...fail(r), error: "container_timeout" };
      await sleep(5000);
      continue;
    }
    if (!r.ok || !r.data) return fail(r);
    onStep?.("publishing");
    return { ok: true, permalink: r.data.permalink, mediaId: r.data.mediaId, row: r.data.row, error: null, issues: [], detail: null };
  }
}

export interface FbPublishInput {
  propertyId?: string | null;
  message: string;
  images: string[];
  /** Agrega el link a la ficha en la web de la inmobiliaria. */
  withLink: boolean;
}

export async function publishToFacebook(input: FbPublishInput) {
  return metaApi<{ postId: string; permalink: string; row: PropertyPublication | null }>("fb-publish", { method: "POST", body: input });
}

export async function deleteFromFacebook(propertyId: string) {
  return metaApi<{ row: PropertyPublication | null }>("fb-delete", { method: "POST", body: { propertyId } });
}
