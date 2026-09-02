# Backend (todavia no conectado)

El MVP corre 100% en el frontend: los datos viven en `src/data/` y se guardan
en el localStorage del navegador. Esta carpeta queda para cuando el proyecto
sume backend.

Adentro estan las migraciones de Supabase ya escritas:

- `supabase/migrations/0001_init.sql` — esquema multi-tenant (12 tablas con
  `agency_id` + RLS) y alta de agencia.
- `supabase/migrations/0002_matching.sql` — el mismo motor de compatibilidad que
  hoy corre en `src/lib/matching.ts`, portado a Postgres con recalculo por
  trigger.

Ninguno de los dos fue ejecutado todavia contra una base real.

## Como se conectaria

`src/data/store.tsx` es el unico archivo que las pantallas usan para leer y
escribir. Reemplazar su implementacion por consultas a Supabase no obliga a
tocar ninguna de las nueve pantallas: la forma de los datos (`src/types/db.ts`)
ya es la de las tablas.
