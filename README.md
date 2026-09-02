# PropMatch CRM

CRM SaaS multi-tenant para inmobiliarias. React 19 + Vite + Tailwind v4 + Supabase.

El frontend se porteó del prototipo de Figma Make
(`PropMatch-SaaS-CRM-Dashboard`) conservando el sistema visual completo.

## Puesta en marcha

1. `npm install`
2. Creá un proyecto en [supabase.com](https://supabase.com).
3. En el SQL Editor, corré en orden:
   - `supabase/migrations/0001_init.sql`  (esquema + RLS multi-tenant)
   - `supabase/migrations/0002_matching.sql` (motor de compatibilidad)
4. `cp .env.example .env` y completá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
   (Project Settings -> API).
5. `npm run dev` -> http://localhost:5180

Sin el `.env`, la app arranca igual y muestra una pantalla con estos pasos.

## Arquitectura

    src/
      components/layout/   Sidebar, AppHeader (unico para toda la app), AppLayout
      components/ui/       icons, Card, StatCard, ScoreRing, FilterTabs, states
      features/<modulo>/   una carpeta por seccion del CRM
      lib/                 supabase, format
      types/db.ts          tipos del dominio, espejo del esquema
    supabase/migrations/   esquema versionado

### Multi-tenant

Toda tabla de negocio lleva `agency_id` y tiene una policy de RLS
`agency_id = current_agency_id()`. El aislamiento vive en la base, no en el
frontend: aunque una consulta se escriba mal, Postgres no devuelve filas de
otra inmobiliaria.

### Motor de matching

`compute_match(requirement, property)` puntua 5 factores y los pondera:

| Factor                | Peso |
|-----------------------|------|
| Presupuesto           | 30%  |
| Ubicacion             | 25%  |
| Tipo de propiedad     | 20%  |
| Ambientes/superficie  | 15%  |
| Caracteristicas       | 10%  |

Se recalcula solo por trigger al crear o editar una propiedad o un
requerimiento. El frontend nunca calcula scores: lee la tabla `matches`.

### Fase 2 (consumer)

Los puntos de enganche estan marcados con `-- [FASE 2]` en el esquema y son
columnas nullable que hoy nadie lee: `contacts.user_id`,
`contacts.source = 'consumer_app'`, `properties.published_to_marketplace`,
`matches.origin`. La tabla `contact_requirements` ya esta separada de
`contacts` porque es el perfil de busqueda que en Fase 2 edita el comprador.

## Scripts

    npm run dev         servidor de desarrollo
    npm run build       build de produccion
    npm run typecheck   chequeo de tipos
