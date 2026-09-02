-- ============================================================================
-- PropMatch — motor de compatibilidad
--
-- El diseño de Figma Make ya define el modelo: un score 0-100 desglosado en
-- factores, y umbrales de lectura (>=90 excelente, >=70 bueno, >=50 parcial).
-- Acá se implementa. El frontend NO calcula nada: lee `matches`.
--
-- Pesos (suman 100):
--   Presupuesto            30
--   Ubicación              25
--   Tipo de propiedad      20
--   Ambientes / superficie 15
--   Características        10
-- ============================================================================

create type match_breakdown as (
  score          int,
  score_budget   int,
  score_location int,
  score_type     int,
  score_size     int,
  score_features int,
  reasons        text[]
);

-- ── Factor: presupuesto ─────────────────────────────────────────────────────
-- Dentro del rango = 100. Fuera del rango decae de forma lineal hasta 0 a un
-- 25% de distancia: un cliente con tope 200k no descarta una de 210k, pero sí
-- una de 260k.
create or replace function f_score_budget(
  p_price numeric, p_min numeric, p_max numeric
) returns int language plpgsql immutable as $$
declare v_over numeric; v_tol numeric;
begin
  if p_price is null then return 50; end if;          -- sin precio: neutro
  if p_min is null and p_max is null then return 60; end if; -- sin presupuesto declarado

  if p_max is not null and p_price > p_max then
    v_tol  := p_max * 0.25;
    v_over := p_price - p_max;
    return greatest(0, round(100 * (1 - v_over / nullif(v_tol, 0)))::int);
  end if;

  if p_min is not null and p_price < p_min then
    -- Más barato de lo buscado casi nunca es un problema; penaliza poco.
    v_tol  := p_min * 0.50;
    v_over := p_min - p_price;
    return greatest(40, round(100 - 40 * (v_over / nullif(v_tol, 0)))::int);
  end if;

  return 100;
end;
$$;

-- ── Factor: ubicación ───────────────────────────────────────────────────────
create or replace function f_score_location(
  p_zone text, p_locality text, p_province text, p_zones text[]
) returns int language plpgsql immutable as $$
begin
  if p_zones is null or array_length(p_zones, 1) is null then
    return 60;                                        -- no declaró zona
  end if;
  if p_zone is not null and exists (
       select 1 from unnest(p_zones) z where lower(trim(z)) = lower(trim(p_zone))
     ) then
    return 100;
  end if;
  if p_locality is not null and exists (
       select 1 from unnest(p_zones) z where lower(trim(z)) = lower(trim(p_locality))
     ) then
    return 85;
  end if;
  -- Coincidencia parcial de texto: "La Plata Centro" contra "La Plata".
  if exists (
       select 1 from unnest(p_zones) z
       where lower(coalesce(p_zone, '') || ' ' || coalesce(p_locality, '')) like '%' || lower(trim(z)) || '%'
          or lower(trim(z)) like '%' || lower(coalesce(p_zone, p_locality, '~~')) || '%'
     ) then
    return 70;
  end if;
  if p_province is not null then return 30; end if;
  return 10;
end;
$$;

-- ── Factor: tipo de propiedad ───────────────────────────────────────────────
create or replace function f_score_type(
  p_type property_type, p_types property_type[]
) returns int language sql immutable as $$
  select case
    when p_types is null or array_length(p_types, 1) is null then 60
    when p_type = any (p_types) then 100
    else 0
  end;
$$;

-- ── Factor: ambientes y superficie ──────────────────────────────────────────
-- Promedia solo las dimensiones que el cliente efectivamente pidió.
create or replace function f_score_size(
  p_rooms int, p_bedrooms int, p_bathrooms int, p_surface numeric,
  p_rooms_min int, p_bedrooms_min int, p_bathrooms_min int,
  p_surface_min numeric, p_surface_max numeric
) returns int language plpgsql immutable as $$
-- Cumple el mínimo = 100; por debajo, se descuenta por unidad faltante.
declare v_sum int := 0; v_n int := 0;
begin
  if p_rooms_min is not null then
    v_n := v_n + 1;
    v_sum := v_sum + case when coalesce(p_rooms, 0) >= p_rooms_min then 100
                          else greatest(0, 100 - 25 * (p_rooms_min - coalesce(p_rooms, 0))) end;
  end if;
  if p_bedrooms_min is not null then
    v_n := v_n + 1;
    v_sum := v_sum + case when coalesce(p_bedrooms, 0) >= p_bedrooms_min then 100
                          else greatest(0, 100 - 30 * (p_bedrooms_min - coalesce(p_bedrooms, 0))) end;
  end if;
  if p_bathrooms_min is not null then
    v_n := v_n + 1;
    v_sum := v_sum + case when coalesce(p_bathrooms, 0) >= p_bathrooms_min then 100
                          else greatest(0, 100 - 30 * (p_bathrooms_min - coalesce(p_bathrooms, 0))) end;
  end if;
  if p_surface_min is not null or p_surface_max is not null then
    v_n := v_n + 1;
    v_sum := v_sum + case
      when p_surface is null then 50
      when p_surface_min is not null and p_surface < p_surface_min
        then greatest(0, round(100 * (p_surface / nullif(p_surface_min, 0)))::int)
      when p_surface_max is not null and p_surface > p_surface_max
        then greatest(50, round(100 - 50 * ((p_surface - p_surface_max) / nullif(p_surface_max, 0)))::int)
      else 100 end;
  end if;

  if v_n = 0 then return 65; end if;                  -- no pidió nada concreto
  return round(v_sum::numeric / v_n)::int;
end;
$$;

-- ── Factor: características ─────────────────────────────────────────────────
create or replace function f_score_features(
  p_features text[], p_wanted text[]
) returns int language plpgsql immutable as $$
declare v_hit int;
begin
  if p_wanted is null or array_length(p_wanted, 1) is null then return 70; end if;
  select count(*) into v_hit
  from unnest(p_wanted) w
  where exists (select 1 from unnest(coalesce(p_features, '{}')) f
                where lower(trim(f)) = lower(trim(w)));
  return round(100.0 * v_hit / array_length(p_wanted, 1))::int;
end;
$$;

-- ── Score compuesto ─────────────────────────────────────────────────────────

create or replace function compute_match(
  p_requirement_id uuid, p_property_id uuid
) returns match_breakdown
language plpgsql stable as $$
declare
  r record; p record; b match_breakdown; v_reasons text[] := '{}';
begin
  select * into r from contact_requirements where id = p_requirement_id;
  select * into p from properties           where id = p_property_id;
  if r is null or p is null then return null; end if;

  b.score_budget   := f_score_budget(p.price, r.budget_min, r.budget_max);
  b.score_location := f_score_location(p.zone, p.locality, p.province, r.zones);
  b.score_type     := f_score_type(p.type, r.property_types);
  b.score_size     := f_score_size(p.rooms, p.bedrooms, p.bathrooms, p.surface_total,
                                   r.rooms_min, r.bedrooms_min, r.bathrooms_min,
                                   r.surface_min, r.surface_max);
  b.score_features := f_score_features(p.features, r.features);

  b.score := round(
      b.score_budget   * 0.30
    + b.score_location * 0.25
    + b.score_type     * 0.20
    + b.score_size     * 0.15
    + b.score_features * 0.10
  )::int;

  -- Los chips "✓ ..." que muestra la card de match.
  if b.score_budget   >= 90 then v_reasons := v_reasons || 'Presupuesto compatible'; end if;
  if b.score_location = 100 then v_reasons := v_reasons || 'Zona preferida';
  elsif b.score_location >= 70 then v_reasons := v_reasons || 'Zona compatible'; end if;
  if b.score_type     = 100 then v_reasons := v_reasons || 'Tipo de propiedad ideal'; end if;
  if b.score_size     >= 90 and p.rooms is not null
                            then v_reasons := v_reasons || (p.rooms || ' ambientes'); end if;
  if b.score_features = 100 and array_length(r.features, 1) is not null
                            then v_reasons := v_reasons || 'Tiene todo lo buscado'; end if;
  b.reasons := v_reasons;

  return b;
end;
$$;

-- ── Recálculo ───────────────────────────────────────────────────────────────
-- Filtros duros antes de puntuar: misma agencia, misma operación, propiedad
-- disponible, requerimiento activo. Solo se guardan matches de 50 o más.

create or replace function refresh_matches_for_property(p_property_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_req record; b match_breakdown; v_count int := 0; p record;
begin
  select * into p from properties where id = p_property_id;
  if p is null then return 0; end if;

  delete from matches where property_id = p_property_id;
  if p.status <> 'disponible' then return 0; end if;

  for v_req in
    select cr.* from contact_requirements cr
    where cr.agency_id = p.agency_id
      and cr.is_active
      and cr.operation = p.operation
  loop
    b := compute_match(v_req.id, p_property_id);
    if b.score >= 50 then
      insert into matches (agency_id, contact_id, requirement_id, property_id, score,
                           score_location, score_budget, score_type, score_size,
                           score_features, reasons)
      values (p.agency_id, v_req.contact_id, v_req.id, p_property_id, b.score,
              b.score_location, b.score_budget, b.score_type, b.score_size,
              b.score_features, b.reasons)
      on conflict (requirement_id, property_id) do update
        set score = excluded.score,
            score_location = excluded.score_location,
            score_budget   = excluded.score_budget,
            score_type     = excluded.score_type,
            score_size     = excluded.score_size,
            score_features = excluded.score_features,
            reasons        = excluded.reasons;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function refresh_matches_for_requirement(p_requirement_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_prop record; b match_breakdown; v_count int := 0; r record;
begin
  select * into r from contact_requirements where id = p_requirement_id;
  if r is null then return 0; end if;

  delete from matches where requirement_id = p_requirement_id;
  if not r.is_active then return 0; end if;

  for v_prop in
    select p.* from properties p
    where p.agency_id = r.agency_id
      and p.status = 'disponible'
      and p.operation = r.operation
  loop
    b := compute_match(p_requirement_id, v_prop.id);
    if b.score >= 50 then
      insert into matches (agency_id, contact_id, requirement_id, property_id, score,
                           score_location, score_budget, score_type, score_size,
                           score_features, reasons)
      values (r.agency_id, r.contact_id, p_requirement_id, v_prop.id, b.score,
              b.score_location, b.score_budget, b.score_type, b.score_size,
              b.score_features, b.reasons)
      on conflict (requirement_id, property_id) do update
        set score = excluded.score,
            score_location = excluded.score_location,
            score_budget   = excluded.score_budget,
            score_type     = excluded.score_type,
            score_size     = excluded.score_size,
            score_features = excluded.score_features,
            reasons        = excluded.reasons;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ── Triggers: los matches se mantienen solos ────────────────────────────────

create or replace function trg_property_matches()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_matches_for_property(new.id);
  return new;
end;
$$;

create trigger properties_refresh_matches
  after insert or update of price, type, operation, status, zone, locality, province,
                            rooms, bedrooms, bathrooms, surface_total, features
  on properties
  for each row execute function trg_property_matches();

create or replace function trg_requirement_matches()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_matches_for_requirement(new.id);
  return new;
end;
$$;

create trigger requirements_refresh_matches
  after insert or update on contact_requirements
  for each row execute function trg_requirement_matches();

grant execute on function refresh_matches_for_property(uuid)    to authenticated;
grant execute on function refresh_matches_for_requirement(uuid) to authenticated;
