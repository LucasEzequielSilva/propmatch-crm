/**
 * Cliente de Supabase.
 *
 * El proyecto es el mismo que usa la app de Lucas (`jhtkvcxvgjwnuzfhbale`):
 * no hay uno propio del CRM. Ver `src/lib/propertySync.ts` para qué se lee y
 * escribe ahí, y `README.md` para las variables de entorno necesarias.
 */

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env.local y completá los valores.",
  );
}

export const supabase = createClient(url, anonKey);
