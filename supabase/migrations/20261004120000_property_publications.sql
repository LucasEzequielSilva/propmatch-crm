-- Multipublicador: una propiedad -> N publicaciones externas (portales / redes / web).
-- Aditiva: no toca ninguna tabla ni policy existente. Mismo patrón de RLS que
-- `property_owners` (is_agency_member). Solo accesible para miembros de la agencia.

create table public.property_publications (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  channel          text not null check (channel in
                     ('mercadolibre','zonaprop','argenprop','cabaprop','facebook','instagram','web')),
  status           text not null default 'draft' check (status in
                     ('draft','pending','published','error','paused','removed')),
  external_id      text,
  external_url     text,
  error_message    text,
  published_at     timestamptz,
  last_synced_at   timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (property_id, channel)
);

create index property_publications_agency_idx   on public.property_publications (agency_id, status);
create index property_publications_property_idx on public.property_publications (property_id);

create or replace function public.property_publications_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger property_publications_touch
  before update on public.property_publications
  for each row execute function public.property_publications_touch();

alter table public.property_publications enable row level security;

-- La publicación solo puede apuntar a una propiedad de la MISMA agencia.
create policy property_publications_agency_all on public.property_publications
  for all to authenticated
  using (public.is_agency_member(agency_id))
  with check (
    public.is_agency_member(agency_id)
    and exists (
      select 1 from public.properties p
      where p.id = property_id and p.agency_id = property_publications.agency_id
    )
  );

revoke all on public.property_publications from anon;
grant select, insert, update, delete on public.property_publications to authenticated;
