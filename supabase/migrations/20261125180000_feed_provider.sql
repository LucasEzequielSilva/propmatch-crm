-- Feed XML de la propia inmobiliaria (provider 'feed').
--
-- SIN APLICAR. Aplicar solo con aprobación de Lucas: la base de la app es
-- compartida y tiene usuarios reales. Es aditiva: reescribe el check de
-- provider para sumar 'feed'. No borra filas. El auth_method 'feed' ya estaba
-- permitido desde 20261006120000.
--
-- Hasta aplicarla, guardar un feed responde con un mensaje que nombra esta
-- migración (el código no inventa el provider si el check lo rechaza).

alter table public.agency_integrations
  drop constraint if exists agency_integrations_provider_check;

alter table public.agency_integrations
  add constraint agency_integrations_provider_check
  check (provider in (
    'mercadolibre','meta','whatsapp','zonaprop','argenprop','cabaprop','properati','feed'
  ));
