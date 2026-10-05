-- ════════════════════════════════════════════════════════════════════════════
-- BORRADOR — SIN APLICAR. Solo con aprobación (la base es compartida con la app).
--
-- Web pública de la inmobiliaria (/sitio/:slug). Hoy el slug se DERIVA del
-- nombre + los primeros 8 caracteres del uuid de la agencia
-- ("inmobiliaria-lopez-1ffdbb92", ver shared/publicSite.ts) y funciona sin
-- tocar la base. Esta columna permite un slug elegido a mano
-- ("lopez-propiedades"): api/_lib/web/data.ts ya la busca primero si existe,
-- y si no existe sigue con el derivado.
--
-- Aditiva: una columna nullable con índice único. No cambia ninguna policy:
-- `agencies` sigue sin ser legible por anónimos (la web la lee el servidor
-- con la service role).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agencies
  add column if not exists slug text
    check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$');

create unique index if not exists agencies_slug_uidx on public.agencies (slug) where slug is not null;

-- Para fijarlo (desde el SQL editor, con aprobación):
--   update public.agencies set slug = 'lopez-propiedades' where id = '<uuid de la agencia>';
-- El link derivado sigue funcionando (redirige al mismo sitio).

-- Pendiente de decidir (no incluido): columnas propias para la ubicación
-- exacta autorizada (hoy en property_publications.external_id = 'geo:lat,lng'
-- de la fila web) y para el teléfono/mail públicos de la inmobiliaria (hoy se
-- usan los de la cuenta paraguas, agencies.owner_user_id → users).
