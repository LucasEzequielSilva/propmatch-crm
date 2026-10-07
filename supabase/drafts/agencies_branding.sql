-- ════════════════════════════════════════════════════════════════════════════
-- BORRADOR — SIN APLICAR. Solo con aprobación (la base es compartida con la app).
--
-- Marca de la inmobiliaria (logo, colores, contacto) para la web pública y la
-- ficha para clientes. HOY FUNCIONA SIN ESTO: el CRM publica la marca como
-- `property-photos/<agency_id>/branding/brand.png` (un PNG 1×1 con el JSON en
-- un chunk iTXt, porque el bucket solo acepta imágenes: jpeg/png/webp/avif) y
-- el logo en la misma carpeta. Ver shared/brand.ts y src/lib/branding.ts.
--
-- Con esta columna:
--   - api/_lib/web/data.ts (agencyBrand) ya la lee PRIMERO si existe y tiene
--     valor; si no, sigue con el PNG. No hay que tocar el servidor.
--   - Falta (no hecho): que el CRM la escriba. `agencies` no tiene policy de
--     UPDATE para miembros, así que habría que escribirla desde un endpoint
--     con la service role (validando que el usuario sea owner/admin de la
--     agencia) o agregar una policy de UPDATE limitada a owner/admin.
--   - La ficha para clientes (/ficha) lee el PNG directo del Storage (sin
--     servidor); con la columna habría que exponerla por /api/web.
--
-- Aditiva: una columna jsonb nullable. No cambia policies ni lo que lee la
-- app (la web la lee el servidor con la service role).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agencies
  add column if not exists branding jsonb
    check (branding is null or (jsonb_typeof(branding) = 'object' and pg_column_size(branding) < 16384));

comment on column public.agencies.branding is
  'Marca pública de la inmobiliaria (CRM PropMatch). Lista blanca en shared/brand.ts (sanitizeBrand).';
