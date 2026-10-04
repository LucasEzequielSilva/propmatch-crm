# Deal Room / Operaciones — propuesta de base de datos

Estado: **borrador para revisar con Lucas. No se aplicó nada.**
SQL completo: `deal_room.sql` (en esta misma carpeta, a propósito fuera de `migrations/`).

## Punto de partida (verificado contra la base viva el 2026-10-04)

- Existen: `agencies`, `agency_members` (`role` es texto; hoy hay un solo `admin`), `properties`
  (con `agency_id`), `property_owners`, `users`, `is_agency_member()`, `property_publications`.
- **No existen** `contacts`, `opportunities`, `profiles` ni `tasks`: esos datos del CRM siguen en el
  navegador (`localStorage`). El borrador viejo `backend-futuro/0004` depende de ellos, por eso no se puede
  aplicar tal cual.
- Storage hoy: `property-photos` y `avatars` (públicos), `chat-images` e `identity-documents` (privados).
  Ninguno sirve para contratos: se propone un bucket nuevo y privado.

## Qué ya existe en el CRM y se reutiliza (no se duplica)

El módulo **Operaciones** actual (`Deal` en `src/types/db.ts`, `lib/deals.ts`, checklists de venta y alquiler,
documentos para imprimir). Esta propuesta lo **lleva a la base y lo extiende**; no crea un segundo sistema.

| CRM actual | En la base |
|---|---|
| `Deal.kind` venta/alquiler | `deals.kind` (+ reserva, otro) |
| `en_curso / cerrada / caida` | 9 etapas: negociación → reserva → documentación → contrato → firma pendiente → firmada → cierre → completada, y cancelada |
| `client` / `owner` / `guarantor` (DealParty) | `deal_parties` + `deal_party_legal` (DNI, CUIT… restringido) |
| `steps` / `docs` (checklist en JSON) | `deal_documents` con estado real y archivo; el checklist sigue siendo código |
| `commission_pct`, `reserva_amount` | `deal_commissions`, `deal_payments` |

## Tablas (13) y para qué sirve cada una

| Tabla | Rol |
|---|---|
| `deals` | La operación. Número `PM-<deal_number>`. Máquina de estados forzada por trigger. |
| `deal_parties`, `deal_party_legal` | Comprador, propietario, garante, escribano. El propietario **no necesita cuenta** en la app. |
| `deal_events` | Timeline y auditoría. Solo se agrega. El cambio de etapa se registra solo. |
| `deal_documents` + bucket `deal-documents` | Archivos privados, con estado (pendiente/recibido/validado/rechazado/vencido). |
| `contract_templates`, `contracts` | Plantillas con `{{variables}}` y contratos generados (con snapshot del texto). |
| `signature_requests`, `contract_signers`, `signature_events` | Firma electrónica **agnóstica del proveedor**; solo guardan lo que informe el proveedor. |
| `deal_payments` | Reserva/seña/saldo como **registro administrativo**. No procesa dinero. |
| `deal_commissions`, `deal_commission_splits` | Comisión configurable (% o fijo, comprador/vendedor) y reparto entre agentes. |

## Seguridad

- Todo cuelga de `agency_id` y se filtra con `is_agency_member()`; `anon` no tiene acceso a nada.
- **Financiero y datos legales:** solo admin de la agencia o el responsable de la operación
  (`can_manage_deal_money`). Modificar comisiones: solo admin.
- **Storage:** bucket privado, 25 MB, PDF/imagen/docx. El primer segmento de la ruta es el `agency_id`
  (`<agency>/<deal>/documents|contracts|signed/…`) y las policies lo validan. Sin UPDATE: se sube una versión nueva.
  Descarga solo con URL firmada de corta duración.
- **No se borra:** una operación se cancela. Solo un admin puede eliminar filas (carga errónea).
- **Timeline y auditoría de firma:** triggers que impiden UPDATE y DELETE, también para admin.
- **Firma:** los estados de una solicitud los actualiza el backend (webhook del proveedor, service role),
  nunca el navegador. No se afirma validez jurídica especial hasta integrar un proveedor adecuado.

## Validación hecha

Probado en la base viva dentro de una transacción con rollback (no quedó nada): creación del núcleo
(deals, partes, eventos, documentos, contratos, pagos), triggers, la máquina de estados
(negociación → reserva → cancelada → negociación registró 3 eventos automáticos) y la policy de Storage.
**No se probó** con un usuario real de agencia ni cada tabla del script completo: falta una pasada en una
branch de Supabase antes de aplicar.

## Decisiones abiertas para la reunión

1. **Contactos y oportunidades:** ¿se llevan a la base antes que Deal Room? Hoy `deals` guarda una referencia
   de texto (`crm_*_ref`) y los datos de las partes viven en `deal_parties`. Es funcional, pero un contacto
   editado en el CRM no se actualiza en la operación.
2. **Roles:** `agency_members.role` es texto con un solo valor. Esta propuesta usa solo `admin` vs. el resto.
   ¿Se definen roles (admin, agente, administrativo)?
3. **Migración de lo existente:** los deals de `localStorage` no se migran solos; hay que decidir si se importan.
4. **Proveedor de firma:** requiere investigación aparte (costos, validez en Argentina, API) antes de elegir.
5. **Tareas, fechas y notificaciones (fases 10–11):** no están en este borrador; hoy viven en el CRM.
6. **Aplicar** primero en una branch de Supabase (con costo) o directamente con rollback plan.
