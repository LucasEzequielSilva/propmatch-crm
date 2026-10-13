# Los datos del CRM en la base propia

Contactos, propiedades, fotos, oportunidades, actividades, agenda, tareas,
operaciones, perfiles del equipo y los datos de la inmobiliaria se guardan en
el **Supabase propio del CRM** (`ktltjpwetvdoxcaayvkh`, el mismo del inbox, el
marketing y el calendario). Antes vivían solo en el navegador de cada agente:
cambiar de máquina o borrar el historial los perdía, y dos agentes de la misma
inmobiliaria no veían lo del otro.

**No va en la base de la app** (`jhtkvcxvgjwnuzfhbale`): esa es compartida con
Lucas, tiene usuarios reales y cada cambio necesita su aprobación. Las
propiedades siguen subiendo a la app con «Publicar en la app», como siempre.

## Cómo queda armado

| Pieza | Archivo |
|---|---|
| Tabla `crm_records`, funciones `crm_push` y `crm_adopt_scope`, bucket `crm-photos` | `supabase-crm/migrations/20261009190000_crm_records.sql` (aplicada el 2026-10-09) |
| Servidor: `GET /api/crm/pull`, `POST /api/crm/push`, `POST /api/crm/upload` | `api/crm.ts`, `api/_lib/crm/routes.ts` |
| Reglas puras (validación, diff, aplicar cambios) | `shared/crmSync.ts` (pruebas: `npm run test:crm-sync`) |
| Navegador: motor de sincronización | `src/data/remote.ts`, cableado en `src/data/store.tsx` |
| Avisos en pantalla (sin conexión, base sin configurar, sesión vencida) | `src/components/layout/AppLayout.tsx` |

### El modelo

Un **registro por entidad**: `kind` (`contact`, `property`, `photos`, `deal`,
`event`, …) + `id` + `data` (el objeto tal como lo maneja el store, en jsonb).
Cada escritura recibe una **versión** de un contador global. El navegador pide
«lo que cambió desde la versión N» y lo aplica: **por registro, gana el último
cambio**.

**Las bajas no borran**: la fila queda con `deleted = true` (una tumba) y su
contenido intacto. Así los demás navegadores se enteran y cualquier cosa se
puede recuperar desde la base (y más adelante, desde una papelera en el CRM).

El **ámbito** (`scope_id`) es la inmobiliaria del usuario (uuid de `agencies`
en la base de la app) o, si la cuenta todavía no está vinculada, el uuid del
usuario. Al vincularse, la primera bajada pasa lo suyo a la inmobiliaria si
esta estaba vacía (`crm_adopt_scope`).

### Seguridad

- El navegador **nunca habla con esta base**. Todo pasa por `/api/crm/*`, que
  valida el JWT de la app (`requireUser` en `api/_lib/auth.ts`), resuelve la
  inmobiliaria por `agency_members` y usa la service role.
- RLS forzada sin policies y revoke a `anon`/`authenticated`, igual que el inbox.
- El ámbito sale del JWT: el cuerpo de un pedido nunca lo nombra.
- Los **datos de ejemplo** (`is_sample`) nunca viajan. La **demo** no sincroniza.
- Las fotos cargadas en el CRM van al bucket público `crm-photos` bajo
  `<ámbito>/<propiedad>/`, subidas por el servidor (jpeg/png/webp, hasta 5 MB).

### Qué hace el navegador

1. **Al abrir sesión** baja todos los registros de la inmobiliaria (de a 500) y
   los reconcilia con lo que había en localStorage: la base manda sobre lo que
   conoce; se conservan los ejemplos, lo que estaba en la cola sin subir y lo
   que la base **no conoce** (ni como tumba), que se sube como nuevo. Así migran
   solos los datos que ya tenía cada navegador, aunque otro agente haya entrado
   antes. Lo que la base tiene borrado, se va.
2. **Cada cambio** del store se compara con lo último que se sabe que tiene la
   base; lo que difiere va a la cola y se sube en tandas (hasta 300 registros o
   3 MB) con 0,8 s de retraso. La cola se guarda en localStorage: lo cargado sin
   conexión se sube al volver, aunque se haya recargado la página.
3. **Cada 20 s** (y al volver la conexión o la pestaña) pide los cambios desde la
   última versión vista. Un registro con cambios locales sin subir no se pisa.
   Lo que el propio navegador acaba de subir no se vuelve a aplicar.
4. **Fotos nuevas** (data URL) se suben al bucket antes de subir el registro
   `photos`: en la base solo hay URLs.
5. **Propiedades traídas de la app** por dos navegadores a la vez quedan con el
   mismo `app_property_id`: gana la más vieja, y la otra se da de baja sola.

Si el servidor no responde, el CRM sigue andando con la copia local y avisa
arriba («Sin conexión con la base…»). Si faltan las variables de la base, avisa
que lo cargado queda solo en este navegador.

## Puesta en marcha

1. Migración aplicada (ya está). Si hubiera que repetirla: SQL Editor del
   proyecto `ktltjpwetvdoxcaayvkh` con el archivo de arriba.
2. En Vercel → Settings → Environment Variables (Production, y Preview si se
   usa): `CRM_SUPABASE_URL` = `https://ktltjpwetvdoxcaayvkh.supabase.co` y
   `CRM_SUPABASE_SERVICE_ROLE_KEY` = la service role del dashboard de ese
   proyecto (Settings → API). Son las mismas que piden el inbox, el marketing y
   el calendario. **Nunca** en `.env.local` ni con prefijo `VITE_`.
3. Redeploy. Al entrar con una cuenta real, lo que cada navegador tenía se sube
   solo la primera vez (si la inmobiliaria no tenía nada en la base todavía).

## Copias de seguridad

Nada se borra de la tabla, pero eso no reemplaza un backup: un error de
código o un borrado a mano en el dashboard sí pierden datos. Supabase en el
plan gratuito **no hace backups automáticos**; el plan Pro guarda uno diario por
7 días (y permite PITR). Para datos de clientes reales conviene Pro, o al menos
un export periódico de `crm_records` (CSV desde el dashboard o `pg_dump`).

## Limitaciones conocidas

- Conflictos: si dos agentes editan **el mismo registro** a la vez, gana el
  último que sube; no se mezclan campos.
- Las ediciones hechas **sin conexión** se conservan si estaban en la cola al
  volver; si la pestaña se cerró antes de que la cola se guardara (storage
  lleno), se pierden las que la base ya tenía en otra versión.
- `nextDealNumber` (PM-0001…) se calcula en el navegador: dos operaciones
  creadas a la vez por dos agentes pueden repetir número.
- No hay papelera en la UI todavía: recuperar una baja es poner `deleted =
  false` en la fila desde el dashboard (o pedir que se agregue la pantalla).
- `reviewed_match` y `synced_app_event` guardan solo ids (data vacío).
