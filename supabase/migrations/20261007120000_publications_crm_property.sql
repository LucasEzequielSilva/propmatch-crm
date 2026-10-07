-- ════════════════════════════════════════════════════════════════════════════
-- Publicaciones de propiedades que solo viven en el CRM (precio en pesos o
-- todavía sin sincronizar con la app) y avisos importados de Mercado Libre.
--
-- SIN APLICAR. Aplicar solo con aprobación de Lucas (la base es compartida con
-- la app y tiene usuarios reales). Orden: después de
--   20261004120000_property_publications
--   20261006120000_integrations_multitenant   (connection_id + trigger de guarda)
--
-- Es ADITIVA:
--   - property_id deja de ser obligatorio (sigue siendo FK a properties con
--     on delete cascade; las filas existentes no cambian),
--   - columna nueva crm_property_id (id local del CRM, texto),
--   - check: cada fila apunta a una propiedad de la app O a una del CRM,
--   - índice único (agency_id, crm_property_id, channel) para el upsert del
--     servidor (en Postgres los NULL no chocan entre sí: las filas de la app,
--     con crm_property_id NULL, no se ven afectadas).
-- No toca la policy existente: el navegador sigue pudiendo escribir solo filas
-- de propiedades de la app (la policy exige que property_id exista en la
-- agencia). Las filas solo-CRM las escribe ÚNICAMENTE el servidor (service
-- role) después de validar la sesión, la agencia y el aviso con Mercado Libre.
-- El navegador las LEE con la policy de siempre (is_agency_member(agency_id)).
--
-- El código del CRM funciona con y sin esta migración: sin ella, la publicación
-- de una propiedad solo-CRM queda guardada en el navegador que publicó (no se
-- comparte entre equipos) y el servidor la verifica contra Mercado Libre cada vez.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.property_publications
  alter column property_id drop not null;

alter table public.property_publications
  add column if not exists crm_property_id text;

alter table public.property_publications
  drop constraint if exists property_publications_target_check;
alter table public.property_publications
  add constraint property_publications_target_check
  check (
    property_id is not null
    or (crm_property_id is not null and crm_property_id ~ '^[A-Za-z0-9_-]{1,64}$')
  );

create unique index if not exists property_publications_agency_crm_channel_key
  on public.property_publications (agency_id, crm_property_id, channel);

-- Para el importador de Mercado Libre (dedupe por aviso) y las notificaciones.
create index if not exists property_publications_external_idx
  on public.property_publications (agency_id, channel, external_id)
  where external_id is not null;

-- El trigger property_publications_connection_guard (20261006120000) sigue
-- valiendo igual para estas filas: connection_id tiene que ser de la MISMA
-- agencia. No hace falta tocarlo.

-- Para volver atrás (solo si no hay filas solo-CRM):
--   drop index if exists property_publications_external_idx;
--   drop index if exists property_publications_agency_crm_channel_key;
--   alter table public.property_publications drop constraint if exists property_publications_target_check;
--   alter table public.property_publications drop column if exists crm_property_id;
--   alter table public.property_publications alter column property_id set not null;  -- falla si quedó alguna fila con property_id null
