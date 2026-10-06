-- ════════════════════════════════════════════════════════════════════════════
-- BORRADOR — SIN APLICAR. Solo con aprobación (la base es compartida con la app).
--
-- Plantillas de documentos de la inmobiliaria (reserva, boleto, contrato de
-- alquiler), compartidas entre los usuarios de la agencia.
--
-- HOY: se guardan en el navegador (`agency.doc_templates` en el store local,
-- ver src/lib/docTemplates.ts): cada usuario ve las suyas. Con esta tabla se
-- compartirían: el CRM leería/escribiría con la sesión del usuario (RLS por
-- membresía) y usaría el store como caché. Ese cambio en el cliente NO está
-- hecho.
--
-- Guardan TEXTO CON VARIABLES ({{precio_letras}}), nunca datos de clientes.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.agency_doc_templates (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  kind        text not null check (kind in ('reserva', 'boleto_compraventa', 'contrato_alquiler')),
  -- Solo para la reserva: 'venta' | 'alquiler' | null (las dos).
  deal_kind   text check (deal_kind in ('venta', 'alquiler')),
  name        text not null check (char_length(name) between 1 and 120),
  body        text not null check (char_length(body) <= 60000),
  is_default  boolean not null default false,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists agency_doc_templates_agency_idx on public.agency_doc_templates (agency_id, kind);

-- Una sola predeterminada por agencia, tipo y alcance.
create unique index if not exists agency_doc_templates_default_uidx
  on public.agency_doc_templates (agency_id, kind, coalesce(deal_kind, '*'))
  where is_default;

alter table public.agency_doc_templates enable row level security;

-- Leer: cualquier miembro de la agencia.
create policy agency_doc_templates_select on public.agency_doc_templates
  for select to authenticated
  using (public.is_agency_member(agency_id));

-- Escribir: owner/admin de la agencia.
create policy agency_doc_templates_write on public.agency_doc_templates
  for all to authenticated
  using (exists (
    select 1 from public.agency_members m
    where m.agency_id = agency_doc_templates.agency_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.agency_members m
    where m.agency_id = agency_doc_templates.agency_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

grant select, insert, update, delete on public.agency_doc_templates to authenticated;
