-- Integración CRM ↔ App: agencias, miembros, dueños de propiedades gestionadas
-- y RLS para que la agencia lea lo que la app ya genera (swipes, matches,
-- mensajes, ofertas, visitas) de SUS propiedades.
--
-- Ya aplicada en producción (jhtkvcxvgjwnuzfhbale) directo contra la base,
-- sin quedar en el historial de migraciones. Este archivo la reconstruye desde
-- el catálogo (2026-10-05) para que quede versionada; no se volvió a aplicar.
--
-- Aditiva: columnas nullable en `properties` y policies nuevas que se suman a
-- las de `owner_id` de la app, nunca las reemplazan. Ownership = Opción B:
-- `properties.owner_id` es la cuenta paraguas de la agencia
-- (`agencies.owner_user_id`) y el dueño real queda en `property_owners`.
-- Depende de `public.users` y `public.set_updated_at()` de la app.

-- Agencias ---------------------------------------------------------------

create table public.agencies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner_user_id  uuid references public.users(id),
  created_at     timestamptz not null default now()
);

create table public.agency_members (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        text not null default 'agente' check (role in ('admin','agente')),
  created_at  timestamptz not null default now(),
  unique (agency_id, user_id)
);

create index agency_members_user_id_idx on public.agency_members (user_id);

create or replace function public.is_agency_member(p_agency_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agency_members
    where agency_id = p_agency_id and user_id = auth.uid()
  );
$$;

revoke execute on function public.is_agency_member(uuid) from public, anon;
grant execute on function public.is_agency_member(uuid) to authenticated, service_role;

-- Dueños reales (contactos del CRM, sin cuenta en la app) -----------------

create table public.property_owners (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  full_name   text not null,
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger property_owners_set_updated_at
  before update on public.property_owners
  for each row execute function public.set_updated_at();

-- Propiedades gestionadas por una agencia -------------------------------

alter table public.properties
  add column agency_id          uuid references public.agencies(id),
  add column managed_by_user_id uuid references public.users(id),
  add column owner_contact_id   uuid references public.property_owners(id);

create index properties_agency_id_idx          on public.properties (agency_id)          where agency_id is not null;
create index properties_managed_by_user_id_idx on public.properties (managed_by_user_id) where managed_by_user_id is not null;
create index properties_owner_contact_id_idx   on public.properties (owner_contact_id)   where owner_contact_id is not null;

-- RLS de las tablas nuevas -----------------------------------------------

alter table public.agencies        enable row level security;
alter table public.agency_members  enable row level security;
alter table public.property_owners enable row level security;

create policy agencies_member_read on public.agencies
  for select to authenticated
  using (public.is_agency_member(id));

create policy agency_members_self_read on public.agency_members
  for select to authenticated
  using (public.is_agency_member(agency_id));

create policy property_owners_agency_all on public.property_owners
  for all to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

-- RLS sobre tablas de la app (se suman a las existentes) -----------------

create policy properties_agency_read on public.properties
  for select to authenticated
  using (agency_id is not null and public.is_agency_member(agency_id));

-- Alta desde el CRM: a nombre de la cuenta paraguas de la agencia.
create policy properties_agency_insert on public.properties
  for insert to authenticated
  with check (
    agency_id is not null
    and public.is_agency_member(agency_id)
    and managed_by_user_id = auth.uid()
    and owner_id = (select a.owner_user_id from public.agencies a where a.id = properties.agency_id)
  );

create policy properties_agency_update on public.properties
  for update to authenticated
  using (agency_id is not null and public.is_agency_member(agency_id))
  with check (agency_id is not null and public.is_agency_member(agency_id));

create policy swipes_agency_read on public.swipes
  for select to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = swipes.property_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ));

-- La agencia puede actualizar swipes de sus propiedades (aceptar/rechazar
-- interesados desde el CRM, igual que haría el propietario en la app).
create policy swipes_agency_update on public.swipes
  for update to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = swipes.property_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ))
  with check (exists (
    select 1 from public.properties p
    where p.id = swipes.property_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ));

create policy matches_agency_read on public.matches
  for select to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = matches.property_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ));

create policy messages_agency_read on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.matches m
    join public.properties p on p.id = m.property_id
    where m.id = messages.match_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ));

create policy offers_agency_read on public.offers
  for select to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = offers.property_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ));

create policy visits_agency_read on public.visits
  for select to authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = visits.property_id and p.agency_id is not null and public.is_agency_member(p.agency_id)
  ));
