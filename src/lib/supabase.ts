import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** `false` mientras no se hayan cargado las credenciales en el .env local. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Se crea con placeholders si falta configuración, en lugar de tirar al
 * importar: así la app arranca igual y puede mostrar la pantalla que explica
 * qué falta, en vez de una pantalla en blanco.
 */
export const supabase = createClient(
  url || "http://localhost:54321",
  anonKey || "public-anon-key-placeholder",
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  },
);

/** URL pública de una foto guardada en el bucket `propiedades`. */
export function photoUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  return supabase.storage.from("propiedades").getPublicUrl(storagePath).data.publicUrl;
}
