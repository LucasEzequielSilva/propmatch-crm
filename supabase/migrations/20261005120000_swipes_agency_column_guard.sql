-- `swipes_agency_update` deja a un miembro de la agencia actualizar la fila
-- entera; el CRM solo necesita aceptar/rechazar (`leadSync.respondToSwipe`).
-- Este trigger limita a la agencia a `status` (y `responded_at`, que completa
-- el trigger `swipes_accepted` de la app, que corre antes por orden alfabético).
--
-- No cambia nada para la app: si quien actualiza es el demandante, el dueño
-- de la propiedad o el service role (auth.uid() null), no hace nada.

create or replace function public.swipes_agency_column_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or auth.uid() = old.demandante_id
     or exists (select 1 from public.properties p where p.id = old.property_id and p.owner_id = auth.uid())
  then
    return new;
  end if;

  if new.id            is distinct from old.id
     or new.demandante_id is distinct from old.demandante_id
     or new.property_id   is distinct from old.property_id
     or new.direction     is distinct from old.direction
     or new.created_at    is distinct from old.created_at
  then
    raise exception 'La agencia solo puede cambiar el estado del swipe'
      using errcode = '42501';
  end if;

  return new;
end $$;

revoke execute on function public.swipes_agency_column_guard() from public, anon, authenticated;

create trigger swipes_agency_column_guard
  before update on public.swipes
  for each row execute function public.swipes_agency_column_guard();
