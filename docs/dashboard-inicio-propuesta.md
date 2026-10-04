# Rediseño del Inicio de PropMatch CRM: diagnóstico y propuesta

Fecha: 2026-10-04. Alcance: investigación y propuesta. No se modificó código, ni Git, ni Supabase.

Planteo del dueño: «No me convence el dashboard de inicio por ahora. Faltan accesos directos y componentes más chicos, etc.»

Material de apoyo (fuera del repo, en el scratchpad de la sesión):

- Capturas del Inicio actual: `C:\Users\barre\AppData\Local\Temp\claude\C--Windows-System32\b7a01059-9287-40d3-a795-66a866532476\scratchpad\dashboard-research\shots\`
  - `actual-desktop-1440.png` (1440×900, primer pantallazo)
  - `actual-desktop-full.png` (1440 de ancho, página completa de 1696 px)
  - `actual-movil-390.png` (390×844)
  - `actual-movil-full.png` (390 de ancho, página completa de 3471 px)
- Maqueta: `...\dashboard-research\mock.html` y su captura `...\shots\mock-captura.png`.
- Las capturas son de una copia de auditoría con sesión demo y datos de ejemplo (puerto 5199, ya apagado), con el código de `src/` actual. Los números que se ven (10 propiedades, 50 matches, 100 % de score) son de la semilla, no de datos reales de agentes.

---

## 1. Diagnóstico del Inicio actual

### 1.1 Qué hay hoy (de arriba hacia abajo, en escritorio)

| # | Bloque | Dónde | Altura aprox. a 1440 |
|---|---|---|---|
| 1 | Header: saludo + subtítulo genérico, buscador, campana, avatar, botón «Agregar» | `DashboardPage.tsx:92-98`, `AppHeader.tsx` | 95 px |
| 2 | Banner de ofertas pendientes (solo si hay) | `DashboardPage.tsx:101-122` | ~72 px |
| 3 | 4 `StatCard` (propiedades activas, nuevos contactos, oportunidades activas, valor del pipeline) | `DashboardPage.tsx:134-181`, `StatCard.tsx` | 200 px |
| 4 | «Para contactar hoy» (`FollowUpsCard`, hasta 5 filas + «ver los restantes») | `DashboardPage.tsx:184-186`, `FollowUpsCard.tsx` | ~400 px |
| 5 | «Oportunidades recientes» (tabla de 4 filas, 5 columnas) + «Actividad reciente» (timeline de 5) | `DashboardPage.tsx:188-329` | ~520 px |
| 6 | «Matches para revisar» (3 tarjetas grandes con score de 36 px) | `DashboardPage.tsx:331-471` | ~480 px |

Página completa en escritorio: 1696 px, es decir casi dos pantallas. En móvil: 3471 px, unas cuatro pantallas y media. En la primera pantalla de 1440×900 se ven los KPIs, «Para contactar hoy» y apenas el borde de la tabla.

### 1.2 Jerarquía real vs. jerarquía que debería tener

- Lo más grande visualmente son los 4 KPIs (cada uno con icono de 44 px, badge, número, etiqueta, sub-etiqueta y barra) y las tarjetas de match con el «100 % MATCH» a 36 px. Son lo que menos se «actúa» desde el Inicio.
- Lo más accionable, «Para contactar hoy», va segundo y recién en móvil se sube al primer lugar (`order-1 md:order-2`, líneas 134 y 184). Es decir, el propio código reconoce que es lo importante, pero en escritorio queda debajo de los números.
- No hay una sola fila de «hacer algo ya»: el único atajo es «Agregar» y siempre lleva a `/propiedades/nueva` (`DashboardPage.tsx:97`). Por la etiqueta ambigua, el usuario puede esperar un menú y no lo hay.

### 1.3 Qué ocupa más espacio del que merece

1. **KPIs**: 200 px de alto para 4 números. Ninguno es accionable (no llevan a ningún lado, las `StatCard` no son clicables, `StatCard.tsx:39-42` es un `div`).
2. **Matches**: 480 px para 3 tarjetas que repiten cada una nombre, propiedad, 3 chips y un botón. Cada tarjeta tiene el «MATCH» en degradé, 5 barritas y un círculo decorativo (líneas 363-401). Además `topMatches = matches.slice(0, 3)` (línea 87) no ordena por score ni filtra los ya revisados/descartados: se muestran los 3 primeros que salgan, no «los mejores por revisar». El texto «Busca su propiedad ideal» (línea 416) es relleno.
3. **Tabla de oportunidades**: `minWidth: 620`, 5 columnas, avatar + título en 2 líneas; en la captura la columna «Propiedad» se parte en 4 líneas. 4 filas ocupan ~400 px y el clic lleva a `/oportunidades` genérico, no a la oportunidad (`onClick={() => navigate("/oportunidades")}`, línea 229).
4. **Actividad reciente**: timeline con iconos de 36 px, 3 líneas por entrada; 5 entradas = 450 px.

### 1.4 Qué se repite con el menú lateral

- Los 4 KPIs reproducen lo que ya dicen los ítems de menú: Propiedades, Contactos, Oportunidades (`Sidebar.tsx:26-38`). «Oportunidades recientes» y «Matches para revisar» son, además, teasers de las pantallas `/oportunidades` y `/matches`.
- El banner de ofertas duplica la insignia «Ofertas» del menú (`Sidebar.tsx:93-100`), pero con 72 px de alto.
- El buscador del Inicio solo cruza propiedades y contactos (líneas 69-76); no incluye oportunidades, operaciones ni acciones, y reemplaza todo el dashboard por resultados.

### 1.5 Qué le falta

- **Accesos directos**: ninguno de los verbos frecuentes del agente (Nueva propiedad, Subir y publicar, Nuevo contacto, Registrar visita, Nueva operación, Abrir Inbox, Agenda de hoy, Multipublicador) está a un clic desde el Inicio. Para registrar una visita hay que ir a Agenda; para publicar, a `/publicador`.
- **Componentes chicos**: solo existen tarjetas grandes (`Card`, `StatCard`, tarjeta de match). No hay fila compacta, mini-stat, chip, ni barra de pipeline.
- **Hoy completo**: «Para contactar hoy» solo cubre seguimientos. No aparecen las visitas del día, las conversaciones del Inbox sin responder, ni las autorizaciones por vencer, a pesar de que esos datos ya existen (ver sección 2).
- **Propiedades que necesitan atención** (sin fotos, sin publicar, con error de publicación): nada.
- **Pipeline por etapas**: no hay vista de cuántas oportunidades hay en cada etapa.
- **Onboarding / estado vacío útil**: la cuenta nueva ve KPIs en 0 con barras de progreso, tablas vacías y «Todavía no hay matches». No hay un camino de primeros pasos.
- **Atajo de teclado / paleta de comandos**: no existe `Ctrl+K` en el código (búsqueda de `ctrlKey`/`metaKey` sin resultados).
- **Personalización**: no se puede ocultar ni reordenar nada.

### 1.6 Problemas de honestidad de datos y detalles encontrados en el código

- `barWidth` hardcodeado: la barra de «Oportunidades activas» es siempre 72 % y la de «Valor del pipeline» siempre 90 % (`DashboardPage.tsx:167` y `179`). Representan nada. Contradice la docstring de `StatCard.tsx:34` («se calcula contra el máximo del período, no se hardcodea»).
- Insignia «Activo» fija en verde en el KPI de pipeline (líneas 175-177): decorativa.
- «Valor del pipeline» suma `o.value` sin mirar la moneda (línea 64). Si hay oportunidades en ARS y en USD, el total mezcla unidades y se muestra como «USD 1,86M». Hay que separar por moneda o mostrar solo USD (y decirlo).
- «Nuevos contactos» = últimos 30 días, con barra = nuevos / total de contactos, que no significa nada (línea 155).
- Subtítulo fijo «Así se mueve tu negocio hoy.» (línea 95) en todos los estados, incluso con la cuenta vacía.
- `FollowUpsCard` en estado vacío usa 🎉 y copy «Buen momento para cargar propiedades» (líneas 77-83): ocupa ~160 px para decir que no hay nada. Aprovechable como espacio de acción.
- Las filas de seguimiento tienen 3 botones de texto con jerarquía pareja («WhatsApp», «✓ Hecho», «Posponer»), `FollowUpsCard.tsx:115-133`. Bien en objetivos táctiles móviles (`h-11`), pero en escritorio es la única parte del Inicio que ya funciona como «fila accionable».
- En móvil, cada fila de seguimiento ocupa 112 px (captura `actual-movil-390.png`): los botones van en segunda línea. Cinco filas = más de una pantalla.
- Inbox no está en el Inicio, pero sí su contador en menú y en `MobileNav.tsx` (`countUnanswered`); eso confirma que el dato está disponible.

### 1.7 Los 5 problemas principales (resumen)

1. No hay accesos directos: el único atajo («Agregar») va siempre a «Nueva propiedad» y su etiqueta es ambigua.
2. Todo son tarjetas grandes: 4 KPIs de 200 px y 3 tarjetas de match de 480 px dominan una página de ~1700 px (móvil: ~3500 px).
3. El «Hoy» está incompleto y mal ubicado: solo seguimientos, tras los KPIs en escritorio; faltan visitas del día, Inbox sin responder, ofertas y autorizaciones por vencer.
4. Redundancia con el menú y poca acción: KPIs y teasers repiten el menú, no son clicables y las filas de oportunidad llevan a una pantalla genérica.
5. Métricas poco honestas: barras de progreso con valores fijos (72 % y 90 %), insignia «Activo» decorativa y pipeline que suma monedas distintas.

---

## 2. Qué datos hay disponibles (sin inventar métricas)

Todo proviene de `useStore()` (`src/data/store.tsx`, estado en memoria sincronizado con la base, más `localStorage`) o de hooks que ya existen. «Barato» = cálculo en memoria sobre arrays ya cargados, O(n), sin pedir nada a la red.

| Dato | Dónde vive | Costo | Notas / cautelas |
|---|---|---|---|
| Contactos (alta, tipo, fuente, `owner_id`) | `useStore().contacts` (`types/db.ts` `Contact`) | Barato | `source: "consumer_app"` permite contar leads de la app. |
| Propiedades (estado, precio, autorización, sync) | `useStore().properties`, `coverPhoto()`, `photos` | Barato | `status` incluye `en_revision`, `pausada`: útil para «necesitan atención». |
| Fotos por propiedad | `useStore().photos[propertyId]` | Barato | Base para «sin fotos» (y `diagnose()` pide ≥ 5). |
| Oportunidades por etapa | `useStore().opportunities` (`stage`, `value`, `currency`, `is_priority`, `stage_since`) | Barato | `stage_since` permite «estancadas». Separar por moneda. |
| Matches y score | `useStore().matches` (derivado), `reviewedMatches` | Barato | Sin ordenar hoy; filtrar `!is_reviewed && !is_dismissed` como ya hace `Sidebar.tsx:42`. |
| Ofertas de la app | `useStore().appOffers` (`status`, `amount_usd`) | Barato | `pending` ya se usa en el banner y en el menú. |
| Swipes de la app («me interesa») | `Activity.app_swipe_id/swipe_status` en `activities`; `lib/leadSync.ts` `fetchAgencySwipes` | Barato en `activities`; red si se consulta directo | Preferir el reflejo en `activities`. |
| Visitas | `useStore().events` con `type: "visita"`, `starts_at` | Barato | «Visitas de hoy / mañana». |
| Agenda / eventos / tareas | `events`, `tasks` (`is_done`, `due_date`, `is_priority`) | Barato | `tasks` hoy solo lo usa Agenda: se puede sumar a «Hoy». |
| Seguimiento automático | `useFollowUps()` (`src/data/useFollowUps.ts:1-25`) → `computeFollowUps` (`lib/followups.ts`) | Medio-barato | Ya memoizado; cada consumidor recalcula (ver riesgos). Devuelve `priority` 1/2/3 y plantilla. |
| Operaciones / deals | `useStore().deals` (`status`, `kind`) + `lib/deals.ts` `stepProgress`, `nextStep` | Barato | «En curso» y «próximo paso» ya calculables. |
| Publicaciones por canal | `usePublications().channelsOf(p)` (`features/propiedades/usePublications.ts`) | Medio: un fetch de la agencia por cada montaje del hook | Estados `pending/published/error`; solo muestra lo que existe, nunca inventa IDs. Estado de error por `errorMessage`. |
| Conversaciones sin responder | `useInboxFeed(agency.id)` + `countUnanswered` (`features/inbox/inboxFeed.ts:82-99`) | Medio: un polling compartido cada 10 s, pausado con pestaña oculta | Ya está en Sidebar y MobileNav; sumar el Inicio no agrega pedidos (un solo polling por pestaña). Hay que derivar la lista (no solo el conteo). |
| Autorizaciones por vencer | `lib/authorization.ts` `authorizationState(...)` sobre `properties` | Barato | `AUTHORIZATION_WARNING_DAYS = 15`; devuelve `tone` y `daysLeft`. |
| Diagnóstico de publicación | `lib/listingDiagnostics.ts` `diagnose(p, photoCount)` | Barato | Lista de checks `ok`/`no ok` por propiedad: base de «necesita atención». |
| Actividad reciente | `useStore().activities` | Barato | Ya usada. |
| Canal ML conectado | `useMeliConnection()` (`useIntegrations.ts`) | Red (`/api/meli/status`) | En `vite dev` no hay `/api`: degrada a `configured: false`. Solo para el checklist de «conectar un canal». |
| Equipo | `useStore().profiles` | Barato | La invitación de agentes dice «va a estar disponible cuando el CRM tenga backend» (`ConfiguracionPage.tsx:88`): no ofrecer como paso del checklist todavía. |

Datos que NO existen y por lo tanto no se deben mostrar: tendencia semana contra semana de contactos o ventas (no hay snapshots históricos; solo se puede mostrar «+N esta semana», que sí sale de `created_at`), métricas de portales (vistas, consultas por aviso), comisiones cobradas y tiempo de respuesta. Reportes (`ReportesPage.tsx`) es la casa de las métricas; el Inicio no debe competir con él.

---

## 3. Hallazgos del benchmark

Fuentes consultadas por WebSearch (los resúmenes devueltos por el buscador; no se abrieron todas las páginas completas). Lo que no se pudo verificar está marcado.

| Producto | Patrón observado | Fuente | Estado |
|---|---|---|---|
| HubSpot Sales Workspace | Pestaña «Summary» con tareas vencidas, de hoy y de mañana arriba; cola de prospección para pasar de una tarea a la siguiente; dashboard opcional como pestaña. Los usuarios piden poder agregar/quitar/mover secciones. | https://knowledge.hubspot.com/prospecting/use-the-prospecting-workspace · https://knowledge.hubspot.com/prospecting/review-sales-activity-in-the-sales-workspace · https://community.hubspot.com/t/customize-the-prospecting-workspace/109959 | Verificado en resumen |
| Pipedrive | Rediseño con menú lateral y arriba buscador + botón «Quick add» (deal, actividad, contacto) + asistente. | https://pipedrive.com/en/newsroom/pipedrive-unveils-its-biggest-redesign-launches-new-products-for-10th-anniversary · https://support.pipedrive.com/en/article/quick-actions-in-pipedrive | Verificado |
| Follow Up Boss | Listas de tareas «Hoy», «Vencidas» y «Futuras»; Smart Lists agrupables en colecciones; menos «ruido visual». | https://updates.followupboss.com/en/introducing-smart-list-collections-structure-your-teams-workflow-for-better-follow_up · https://www.followupboss.com/blog/october-2016-new-feature-round-up | Verificado. No encontré una descripción de su «home» como tal: no inferir. |
| Attio | Home con reuniones próximas y tareas (hoy, mañana, vencidas); `Cmd+K` para búsqueda y acciones rápidas según contexto; buscador arriba del menú. | https://attio.com/help/getting-started/navigating-your-workspace · https://attio.com/help/reference/workspace/quick-search | Verificado |
| Salesforce Lightning Home | Componentes estándar: gráfico de rendimiento, «Assistant» (leads asignados hoy, oportunidades con tareas vencidas o sin actividad en 30 días), eventos y tareas de hoy, «Key Deals», elementos recientes. Home distinta por perfil. | https://www.salesforceben.com/standard-lightning-components-to-implement-now/ · https://admin.salesforce.com/blog/2016/3-custom-home-pages-in-lightning | Verificado |
| Zoho CRM | Home personalizable por usuario o por rol; «Classic View» fija con lista de tareas, eventos de hoy y pipeline por etapa; hasta 5 componentes en la vista personalizada. | https://www.zoho.com/crm/help/customization/customize-home-tab.html | Verificado |
| Close | «Inbox» centrado en lo que hay que hacer ahora: inbound sin responder, tareas del día, oportunidades por cerrar; pestañas Inbox / Hecho / Futuro (snooze); filtros por estado, pipeline y Smart Views. «Se puede trabajar solo desde la bandeja». | https://help.close.com/docs/inbox | Verificado |
| Linear | `Ctrl/Cmd+K` ejecuta cualquier acción o salta a cualquier página; `G` luego `I` = Inbox, `G` luego `M` = mis issues; triage con teclas 1/2/3. | https://linear.app/docs/search · https://linear.app/enablement/guide/navigating-linear · https://linear.app/docs/triage | Verificado |
| Notion Home | Widgets que se muestran u ocultan: Recientes (20), Próximos eventos, Mis tareas, Vistas de base, Sugeridos. Menú «⋯» para elegir la home y qué widgets ver. | https://www.notion.com/help/home-and-my-tasks | Verificado |
| Stripe Dashboard | «Edit overview» → agregar/quitar widgets → aplicar. Las cifras de la home se avisan como estimadas; para precisión, informes. | https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights | Verificado. Cómo exactamente reordenan: no verificado. |
| Intercom Inbox | Vistas fijables: «Tu bandeja», «Menciones», «Sin asignar» con contador. | https://intercom.com/help/en/articles/6588834-organize-your-inbox-with-custom-views-and-folders | Verificado |
| Zillow Premier Agent | Bandeja de 3 paneles (lista de leads y mensajes, mensaje con la propiedad, datos de contacto). | https://www.zillow.com/agents/app-overview/ | Verificado en resumen. Home exacta: no verificado. |
| Lofty | Dashboard cuyas tarjetas se reordenan «para que lo más importante quede arriba»; tarjetas como «Leads nuevos de hoy / de la semana». | https://help.lofty.com/hc/en-us/articles/8472031391131-Dashboard-Overview | Verificado |
| Tokko Broker | Descripto como CRM con panel principal para cargar propiedades, difundir a portales y ver oportunidades por estado; acceso desde cualquier dispositivo. | https://apps.apple.com/ar/app/tokko-broker-app/id1574953628 · https://www.comparasoftware.com/tokko-broker | Solo descripción de terceros. Layout del Inicio: no verificado (requiere cuenta). |
| Kiteprop | Agenda, control de llamadas, difusión a portales, fichas imprimibles. | https://www.capterra.es/software/1024853/kiteprop-crm-inmobiliario | Solo descripción de terceros. Home: no verificado. |
| kvCORE / Inside Real Estate, Compass, Rechat | Rechat tiene módulo de Tareas con filtros; kvCORE se menciona integrado con Zillow y seguimientos con IA. | https://help.rechat.com/guides/crm/tasks | No verificado el diseño de su pantalla de inicio. No lo cito como evidencia. |

### Patrones que se repiten (con fuerza de evidencia)

1. **«Hoy» accionable al frente** (HubSpot, Attio, Salesforce, Close, Follow Up Boss, Notion): tareas vencidas / de hoy / de mañana arriba, con la acción en la misma fila. Es el patrón más consistente. PropMatch ya lo tiene a medias con `FollowUpsCard`.
2. **Bandeja priorizada con estados Hoy/Hecho/Futuro** (Close): lo resuelto sale de la lista y lo pospuesto vuelve después. PropMatch ya tiene «Hecho» y «Posponer 3 días» (`snoozeFollowUp`). Falta sumar otros orígenes al mismo formato.
3. **Crear global + buscar global** (Pipedrive: «Quick add» + búsqueda arriba; Attio y Linear: `Cmd+K`). Es el atajo más barato y universal.
4. **Paleta de comandos** (Linear, Attio): una sola entrada para saltar a páginas, buscar registros y ejecutar acciones. Se explica por Hick: reemplaza decidir entre 11 ítems de menú por escribir 2 letras.
5. **Widgets mostrables/ocultables y reordenables** (Notion, Zoho, Lofty, Stripe, Salesforce por perfil). Dato relevante: HubSpot lo tiene como pedido de usuarios, lo que sugiere que un Inicio fijo genera fricción.
6. **Límites a la personalización** (Zoho: hasta 5 componentes en la vista personalizada; Stripe: «Edit overview» explícito). Ayuda a decidir: no dejar crear widgets arbitrarios.
7. **Salesforce «Assistant»** y los «sin actividad en 30 días»: la lista priorizada incluye reglas del tipo «oportunidad estancada». PropMatch puede usar `stage_since`.
8. **Cifras con aviso de que son estimadas** (Stripe): refuerza la regla de métricas honestas.
9. **Móvil**: no se verificó cómo adaptan cada producto su home a celular salvo Zoho (organiza la home en la app iOS/Android, https://help.zoho.com/portal/en/kb/crm-v2-1/crm-mobile/apple/getting-started/articles/crm-v2-organizing-the-home-screen). El resto del móvil de esta propuesta sale de principios, no de evidencia de competidores.
10. **Densidad cómodo/compacto**, **favoritos/pines** y **saludo contextual**: no encontré evidencia en las fuentes consultadas de que estos productos los ofrezcan en su Inicio. Los pines sí aparecen como vistas fijables en Intercom (fuente arriba). Los trato como opcionales (ver «Fase 3»).
11. **Onboarding/checklist con estado vacío**: no lo verifiqué por producto en esta ronda. Se propone a partir de principios (sección 4) y de la ventaja de que PropMatch puede calcular cada paso con datos reales.

---

## 4. Principios de diseño aplicables

| Principio | Qué dice | Cómo se aplica acá | Fuente |
|---|---|---|---|
| Ley de Hick | Más opciones = más tiempo de decisión | Pocos accesos (8, los de mayor frecuencia), resto en el menú y en `Ctrl+K`; agrupar «Crear» en un solo botón con menú | https://lawsofux.com/hicks-law/ |
| Ley de Fitts | Tiempo de alcance = f(distancia / tamaño) | Acciones frecuentes grandes y cerca (fila de accesos arriba; en móvil, «+» flotante al pulgar) | https://en.wikipedia.org/wiki/Fitts%27s_law |
| Carga cognitiva / «a un vistazo» | Diseñar para mirar, no para estudiar; una sola cifra destacada, el resto en segundo plano; «si todo es énfasis, nada lo es» | Un único elemento con color pleno (botón «+ Crear» y el accesorio primario); KPIs sin degradés, ni barras, ni iconos de 44 px | Resumen de Nielsen Norman Group sobre dashboards, tal como lo devolvió la búsqueda (no abrí el artículo original): https://app.uxcel.com/lessons/dashboard-best-practices-876 |
| Scan → decide → act | Cada bloque se escanea, se decide y se actúa sin cambiar de pantalla | La fila de «Hoy» tiene la acción dentro (WhatsApp, Hecho, Posponer, Responder, Revisar) | Heurística de diseño, sin fuente única. Consistente con Close («cada ítem accionable»): https://help.close.com/docs/inbox |
| Patrón en F | La lectura sigue el borde izquierdo y una barra superior | Lo más importante arriba a la izquierda (Hoy), texto principal alineado a la izquierda, acciones a la derecha de cada fila | Heurística de Nielsen Norman Group, no verificada en esta ronda |
| Frecuencia de uso | Lo frecuente, a un toque; lo raro, escondido | Orden por frecuencia: crear, Hoy, Inbox; matches, reportes y actividad quedan secundarios | Hick/Fitts arriba |
| Densidad de información | Más información útil por pantalla sin perder legibilidad | Filas de 44-52 px en lugar de tarjetas de 120-480 px | Criterio propio, consistente con HubSpot/Close/FUB |
| Objetivos táctiles | WCAG 2.2 SC 2.5.8 AA: mínimo 24×24 CSS px; Apple HIG 44 pt; Material 48 dp | Todo objetivo táctil ≥ 44 px en móvil; ≥ 32 px en escritorio y nunca por debajo de 24 px | https://allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide (resumen de las tres referencias) |
| Contraste y color | WCAG AA: 4,5:1 texto normal, 3:1 texto grande/UI; no depender solo del color | Usar `--color-lilac-text #7458C4` (5,3:1) para metadatos, nunca `#C4B5FD` para texto; el semáforo de prioridad lleva además texto («Urgente») | `src/index.css:34-35` y estándar WCAG 2.2 |

---

## 5. Propuesta de rediseño

### 5.1 Idea central

El Inicio pasa de «tablero de números» a «mi día»: arriba, una **barra de acciones** (crear, buscar, ⌘K); debajo, una **fila de accesos directos**; luego una **franja de KPIs de una línea**; el centro es **«Hoy»**, una lista de filas accionables; y a un costado, **pipeline en miniatura**, **propiedades que necesitan atención** y **actividad reciente** compacta. Todo en componentes de 40-64 px de alto.

Resultado estimado: el Inicio completo cabe en ~900-1000 px en escritorio (hoy 1696 px) y el primer pantallazo ya muestra accesos, KPIs y el Hoy.

### 5.2 Wireframe: escritorio (≥ 1280)

Menú lateral sin cambios (256 px). Contenido ~1000-1150 px útiles.

```
┌ Sidebar 256 ┬───────────────────────────────────────────────────────────────────────────────┐
│ PropMatch   │ Buenas tardes, Valen         [🔍 Buscar o ir a…         Ctrl K]  🔔  (VM) [+ Crear ▾]│  56-64 px
│ ● Inicio    │ Hoy: 3 visitas · 5 por contactar · 3 sin responder                              │
│ Inbox    3  ├───────────────────────────────────────────────────────────────────────────────┤
│ Contactos   │ ACCESOS DIRECTOS (8 tiles, 64 px alto, 1 fila; "Personalizar" a la derecha)       │
│ Propiedades │ [Nueva      ][Subir y   ][Nuevo    ][Registrar][Nueva    ][Abrir   ][Agenda   ][Multi-   │
│ Oportun.    │ [propiedad ][publicar  ][contacto ][visita   ][operación][Inbox  3][de hoy 3][publicador]│
│ Publicac.   ├───────────────────────────────────────────────────────────────────────────────┤
│ Ofertas   2 │ KPIs (5 mini-stats, 48 px alto, 1 fila)                                           │
│ Operac.     │ [10 Props. activas][14 Oportun. abiertas][+5 Contactos/sem][2 Ofertas pend.][USD 1,86M]│
│ Matches  50 ├───────────────────────────────────────────────────┬───────────────────────────┤
│ Agenda      │ HOY  (6-8 filas de 44-52 px)       [Ver todo]       │ PIPELINE (barra por etapas)│
│ Reportes    │ ● Lucía F. · Negociación, 6 d sin hablar  [WA][✓][⏱]│ [5|3|2|3|1]  etapa = enlace │
│             │ ● Visita 16:30 · Depto centro             [Ficha][↻]├───────────────────────────┤
│             │ ● Laura M. sin responder 2 h              [Responder]│ NECESITAN ATENCIÓN (3-5)    │
│             │ ● Oferta USD 112.000 · Casa Gonnet        [Revisar] │ Casa Los Hornos: sin fotos  │
│             │ ● Autorización vence en 9 d · Lote CB     [Abrir]   │ PH Tolosa: error Zonaprop   │
│             │ (+3 más)                                            ├───────────────────────────┤
│             │                                                     │ ACTIVIDAD RECIENTE (4 líneas)│
│             │                                                     │ de 32 px                    │
│             ├───────────────────────────────────────────────────┴───────────────────────────┤
│ Config.     │ Checklist de primeros pasos (solo mientras falte algo; ver 5.6)                    │
└─────────────┴───────────────────────────────────────────────────────────────────────────────┘
```

Columnas: 2 de contenido, `grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr)`. Los accesos son 8 columnas iguales a ≥ 1280 y 4 columnas × 2 filas a 1024-1279 (ver tablet).

### 5.3 Wireframe: tablet (768-1279; menú lateral oculto bajo `lg` y MobileNav inferior)

```
┌───────────────────────────────────────────────────────────┐
│ Buenas tardes, Valen                    🔍  🔔  (VM) [+ Crear]│
│ Hoy: 3 visitas · 5 por contactar · 3 sin responder           │
├───────────────────────────────────────────────────────────┤
│ [Nueva prop.][Subir/publ.][Contacto][Visita]               │  grilla 4×2
│ [Operación ][Inbox   3  ][Agenda 3 ][Multipub.]            │
├───────────────────────────────────────────────────────────┤
│ [10 Props][14 Oportun.][+5 Contactos][2 Ofertas][USD 1,86M]│  chips, 5 en una fila
├───────────────────────────────────────────────────────────┤
│ HOY                                                         │  1 columna
│ filas 48 px con acciones a la derecha                       │
├────────────────────────────┬──────────────────────────────┤
│ PIPELINE                    │ NECESITAN ATENCIÓN             │
│ ACTIVIDAD (4)               │                                │
└────────────────────────────┴──────────────────────────────┘
```

### 5.4 Wireframe: móvil (390×844)

Orden de bloques: saludo → accesos en una fila deslizable → Hoy → KPIs como chips deslizables → pipeline → atención → actividad → checklist. «Hoy» queda en la primera pantalla.

```
┌──────────────────────────────┐
│ Hola, Valen         🔍  🔔    │ 56 px
│ 3 visitas · 5 por contactar    │
├──────────────────────────────┤
│ [＋Prop][Contacto][Visita][Publ.][Inbox 3] → │ scroll horizontal, tiles 84×68
├──────────────────────────────┤
│ HOY                  Ver todo │
│ ● Lucía F.     [WA] [✓]       │ filas 52-56 px, 2 acciones visibles,
│   6 d sin hablar        ⋯      │ resto en «⋯» (Posponer, Ficha)
│ ● Visita 16:30  [Ficha]       │
│ ● Laura M. sin responder      │
│                    [Responder]│
├──────────────────────────────┤
│ [10 Props][14 Oport.][2 Ofert.]→│ chips deslizables
│ PIPELINE  [5|3|2|3|1]          │
│ NECESITAN ATENCIÓN (3)         │
│                         ( + ) │ botón flotante 52 px, abre «Crear»
├──────────────────────────────┤
│ Inicio Inbox Contactos Props Más│ MobileNav actual (64 px)
└──────────────────────────────┘
```

Reglas móviles:
- Todo objetivo táctil ≥ 44 px (`h-11`, como ya hace `FollowUpsCard.tsx:119`). Las filas de Hoy tienen 2 acciones visibles; el resto va a un menú «⋯» para no pasar de 56 px por fila (hoy 112 px).
- Accesos: scroll horizontal con `scroll-snap-type: x proximity`; el primero (Nueva propiedad) con color pleno. Alternativa 2×4 si se prefiere sin scroll oculto; recomiendo scroll horizontal porque ocupa 76 px frente a 150 px y deja ver Hoy sin bajar.
- El botón flotante «+» (52 px, a la derecha, 78 px sobre el borde inferior) abre una hoja inferior con las acciones de «Crear»; hay que evitar que tape el último ítem (padding inferior de 80 px, como en la maqueta). El header actual ya tiene un «+» en la esquina superior (`AppHeader.tsx`, botón `action`): en móvil se mueve abajo, a la zona del pulgar.
- Los chips de KPI hacen scroll horizontal; en `390` caben ~3 a la vista.
- Respetar `env(safe-area-inset-bottom)` como ya hace `MobileNav.tsx`.

Maqueta navegable: `...\dashboard-research\mock.html` (todos los datos están rotulados «ejemplo»).

### 5.5 Qué se mueve a segundo plano o se elimina

| Elemento actual | Destino |
|---|---|
| 4 `StatCard` grandes | Se reemplazan por 5 `MiniStat` de 48 px, clicables. `StatCard` queda para las pantallas que lo usan (Contactos, Propiedades, Oportunidades), no para el Inicio. |
| Barras de progreso con `barWidth` fijo (72 % / 90 %) e insignia «Activo» | Se eliminan. |
| Banner de ofertas pendientes (72 px) | Se absorbe: contador en el tile «Ofertas» / MiniStat y fila en Hoy. |
| «Oportunidades recientes» (tabla) | Se reemplaza por `PipelineBar` (clicable por etapa). El detalle sigue en `/oportunidades`. |
| «Matches para revisar» (3 tarjetas de 160 px) | Segundo plano: una fila compacta «N matches nuevos con score ≥ 80» con 1-2 ítems en `AttentionRow`, o ítem del menú «Matches» con su insignia. Esto exige ordenar por score y excluir los revisados (hoy `matches.slice(0,3)`, línea 87). |
| «Actividad reciente» con iconos de 36 px | Se mantiene como `ActivityRow` de 32 px, 4-5 líneas, abajo a la derecha. |
| Buscador del header que reemplaza el dashboard | Se reemplaza por buscador/`Ctrl+K` que abre una paleta superpuesta (no pierde el Inicio). Se amplía a oportunidades, operaciones y acciones. |
| Saludo con ✦ y subtítulo genérico | Saludo breve + una línea de resumen real («3 visitas · 5 por contactar»); si no hay nada, cambia a texto de estado vacío útil. |
| 🎉 y relleno del estado «al día» | Se reemplaza por una línea de 44 px con 2 accesos (ver 5.8). |

### 5.6 Catálogo de componentes chicos

Todos nuevos en `src/features/dashboard/components/` (o `src/components/ui/` los reutilizables), tipados, sin estilos en línea nuevos: usar tokens de `index.css` (`--color-lilac #EDE9FE`, `--color-lilac-text #7458C4`, `--color-ink #1F0A3C`, etc.). Estados: cargando = esqueleto con `animate-pulse` del mismo tamaño (para que no salte el layout); vacío = `EmptyHint`; error = texto + «Reintentar» solo donde hay red (Inbox, publicaciones).

| Componente | Props principales | Tamaño | Estados | Reemplaza |
|---|---|---|---|---|
| `QuickActionTile` | `icon`, `label`, `to \| onClick`, `badge?: number`, `badgeTone?: "alert" \| "info"`, `primary?: boolean`, `hotkey?: string` | Escritorio: alto 64 px, ancho flexible (8 columnas), icono 22 px, texto 11,5-12 px. Móvil: 84×68 (primario 96×68), objetivo completo ≥ 44 px | `loading` (insignia en esqueleto), `badge` oculto en 0; foco visible `ring-2` | El botón único «Agregar» (`AppHeader.tsx` `action`) como único atajo; los iconos de 44 px de `StatCard` |
| `MiniStat` | `value`, `label`, `to?`, `delta?: {text, tone}` (solo si hay base real), `unit?`, `loading?` | Alto 48 px, ancho flexible; número 20 px, etiqueta 11,5 px en dos líneas | `loading`, `empty` (muestra `—` y «Sin datos», nunca 0 inventado), clicable | `StatCard` en el Inicio |
| `TodayItem` | `kind: "followup" \| "visit" \| "unanswered" \| "offer" \| "authorization" \| "task"`, `priority: 1\|2\|3`, `title`, `subtitle`, `time?`, `actions: Action[]` (máx. 2 visibles + «⋯»), `onOpen` | Escritorio: alto 44-52 px, padding `px-3.5`; móvil: 52-56 px, acciones ≥ 44 px. Punto de prioridad de 8 px + texto accesible («Urgente») | `loading` (3 filas esqueleto), `empty` (EmptyHint), `done` (animación y desaparece), `error` (si falla la acción: mensaje en la fila) | `FollowUpsCard` (filas de 60 px con avatar de 40 px) y el banner de ofertas |
| `PipelineBar` | `stages: {stage, count, valueByCurrency?}[]`, `onStageClick(stage)`, `showLost?: false` | Alto 26 px la barra + 16 px leyenda; ancho proporcional con mínimo 24 px por segmento no vacío; segmento clicable ≥ 24×24 | `loading`, `empty` («Sin oportunidades. Convertí un match en oportunidad»), tooltip con conteo | La tabla «Oportunidades recientes» y el KPI de pipeline |
| `AttentionRow` | `title`, `reason`, `severity: "warning" \| "error" \| "info"`, `cta: {label, to}`, `photo?` | Alto 44 px; foto opcional 32 px; CTA como chip de 28 px alto (≥ 24 WCAG; en móvil 44 px de fila táctil) | `loading`, `empty` («Todo en orden»), `error` | Nada actual (nuevo) y las tarjetas de match |
| `ActivityRow` | `icon`, `text`, `when`, `to?` | Alto 32 px, una línea con elipsis | `loading`, `empty` | El timeline de «Actividad reciente» (36 px por icono) |
| `EmptyHint` | `title`, `body?`, `actions?: {label, to}[]`, `tone?: "neutral" \| "success"` | Alto 44-96 px; sin emoji decorativo; 1-2 acciones | n/a | `EmptyState compact` del Inicio y el 🎉 de `FollowUpsCard` |

Dos contenedores de apoyo: `DashSection` (título de 13,5 px, enlace «Ver todo», `Card` con `overflow-hidden` y encabezado de 36 px, reemplaza a `SectionHeader inCard`) y `CreateMenu` (el botón «+ Crear ▾» con menú: Propiedad, Subir y publicar, Contacto, Visita, Oportunidad, Operación, Evento).

Datos para cada acceso rápido (todos los destinos ya existen en `App.tsx`): Nueva propiedad `/propiedades/nueva`; Subir y publicar `/propiedades/nueva` (flujo existente) o `/publicador`; Nuevo contacto y Registrar visita abren los modales existentes (`ContactFormModal`, `EventFormModal`); Nueva operación abre `NewDealModal`; Inbox `/inbox` (insignia = `countUnanswered`); Agenda de hoy `/agenda` (insignia = visitas/eventos de hoy); Multipublicador `/publicador`. Verificar durante la implementación si los modales se pueden abrir desde fuera de su pantalla; si no, en la Fase 1 navegan con un parámetro (`?nuevo=1`) y se evalúa extraerlos.

Elección y orden de los 8 accesos (frecuencia + importancia): 1) Nueva propiedad (primario), 2) Subir y publicar, 3) Nuevo contacto, 4) Registrar visita, 5) Nueva operación, 6) Abrir Inbox, 7) Agenda de hoy, 8) Multipublicador. Esto es una hipótesis de partida: no hay analítica de uso en el repo. Se valida con una semana de conteo de clics (ver «Riesgos y preguntas abiertas»).

### 5.7 Buscador global, «+ Crear» y paleta de comandos

- **Botón «+ Crear ▾»** en el header: reemplaza al «Agregar». Un menú con 6-7 entradas, el mismo para todas las pantallas (idealmente en `AppHeader`, no solo en el Inicio).
- **`Ctrl+K` / `⌘K`**: paleta modal con tres secciones: «Ir a…» (las 11 páginas), «Crear…» (las mismas acciones del menú) y «Buscar» (propiedades, contactos, oportunidades, operaciones; el índice ya está en memoria). Estado vacío: muestra las últimas 5 visitas. Es el patrón de Linear y Attio (fuentes en la sección 3). En móvil, el icono de búsqueda del header abre la misma paleta a pantalla completa.
- Accesibilidad: `role="dialog"`, `aria-modal`, foco atrapado, `Esc` cierra, resultados con `role="listbox"`.

### 5.8 Estados vacíos y onboarding (basado en datos reales)

Un `OnboardingChecklist` de una fila compacta (colapsable) que aparece mientras haya pasos sin cumplir y **desaparece solo** cuando se completan todos, o a mano con «Ocultar» (se guarda en la preferencia del agente). Cada paso se evalúa con datos reales, nunca se tilda a mano:

| Paso | Cómo se sabe que está hecho | Fuente |
|---|---|---|
| Cargar tu primera propiedad | `properties.length > 0` | store |
| Subir fotos (≥ 5) a una propiedad | existe una con `photos[id].length >= 5` | store |
| Publicar en un canal | alguna publicación con `status === "published"` o `"pending"` (en cola) | `usePublications` |
| Conectar un canal | `useMeliConnection().connected` | `useIntegrations.ts` (no disponible en `vite dev`: oculto si `configured === false`, ver `useIntegrations.ts`) |
| Cargar tu primer contacto | `contacts.length > 0` | store |
| Invitar al equipo | NO incluir todavía: `ConfiguracionPage.tsx:88` dice que la invitación aún no existe | n/a |

Estados vacíos con texto útil (en lugar de ceros y barras):
- Sin propiedades: «Todavía no cargaste propiedades. [Nueva propiedad] [Importar]».
- Sin seguimientos: «Estás al día con tus contactos.» + una línea y un acceso («Cargar un contacto»), no un bloque de 160 px.
- Sin visitas hoy: «Sin visitas hoy. [Agendar visita]».
- Sin conversaciones sin responder: «Inbox al día.»
- Inbox sin conexión o en error: «No pudimos traer las conversaciones. Reintentar» (el feed ya expone `error`).
- KPIs sin base real: `—` y la etiqueta, no `0 %` ni barras.

### 5.9 Personalización

Alcance mínimo, sin tocar la base: guardar por agente y por agencia en `localStorage`, con un adaptador como el de Inbox (`createLocalAutomationStore`, `src/features/inbox/automationStore.ts`, clave `pm_inbox_automations_${agencyId}`, `try/catch` en lectura y escritura, `sanitize` al leer).

Propuesta de adaptador `DashboardPrefsStore`:

```ts
interface DashboardPrefs {
  v: 1;
  density: "comfortable" | "compact";
  blocks: { id: BlockId; hidden: boolean; order: number }[]; // quick, kpis, today, pipeline, attention, activity, checklist
  quickActions: string[];          // ids, máx. 8, en orden
  onboardingDismissed: boolean;
}
interface DashboardPrefsStore { load(): DashboardPrefs | null; save(p: DashboardPrefs): boolean; }
// createLocalDashboardPrefsStore(agencyId, userId) → clave `pm_dashboard_prefs_${agencyId}_${userId}`
```

- Se puede **ocultar** cualquier bloque y **reordenar** los de la columna principal con botones «subir/bajar» (accesible, funciona en táctil y teclado) en un modo «Personalizar» (como «Edit overview» de Stripe). Arrastrar y soltar es opcional y viene después.
- Los **accesos directos** se eligen de un catálogo cerrado (no se crean accesos arbitrarios; Zoho también acota a 5 componentes).
- **Densidad** cómodo/compacto: cambia solo la altura de las filas (52 → 44 px) y el padding. Por defecto, cómodo en móvil y compacto en escritorio.
- `sanitize` descarta ids desconocidos y completa los que falten con el orden por defecto, para que agregar un bloque en una versión futura no rompa lo guardado (la clave lleva `v`).
- Límite honesto: `localStorage` es por navegador; no sigue al agente a otro dispositivo. Si más adelante se pasa a una tabla de preferencias, el adaptador es el único punto que cambia (misma interfaz).

### 5.10 Métricas honestas

Regla: **una cifra solo se muestra si sale de datos reales y su denominador es claro; si no, se muestra `—` y la razón.**

- Sin barras de progreso decorativas. Si hay una barra, su valor es una proporción calculada y rotulada («8 de 12 disponibles»).
- Sin tendencias («+12 %») si no hay serie histórica. Lo único honesto hoy es «+N esta semana» desde `created_at`.
- Dinero siempre con moneda; el pipeline se muestra por moneda («USD 1,86 M · ARS 24 M») o solo USD con la etiqueta «solo oportunidades en USD». Nunca sumar monedas distintas.
- No usar insignias de estado fijas como «Activo».
- Los textos de estado vacío dicen qué falta y cómo resolverlo, no celebran ni rellenan.
- Cada MiniStat enlaza a la pantalla donde se puede verificar el número (misma definición del filtro).
- Cualquier dato de la app consumer (ofertas, swipes) se rotula como tal («de la app»), igual que ya hace el banner actual.

---

## 6. Plan por fases

Referencia de esfuerzo: S = menos de 1 día, M = 1-3 días, L = más de 3 días.

| Fase | Contenido | Esfuerzo | Riesgo |
|---|---|---|---|
| **0: Quick wins (rápidos, sin estructura nueva)** | 1) `MiniStat` de 5 en una fila en lugar de 4 `StatCard`; quitar barras fijas e insignia «Activo»; separar el pipeline por moneda. 2) Fila de 8 `QuickActionTile` con insignias reales (Inbox, Agenda de hoy, Ofertas). 3) Cambiar «Agregar» por «+ Crear ▾» con menú. 4) Subir «Para contactar hoy» al primer lugar también en escritorio. | S + S + S + S ≈ M | Bajo. Solo un archivo (`DashboardPage.tsx`) y componentes nuevos. |
| **1: «Hoy» unificado** | `TodayItem` y un hook `useTodayItems()` que combina seguimientos (`useFollowUps`), visitas del día (`events`), sin responder (`useInboxFeed`), ofertas pendientes (`appOffers`), autorizaciones por vencer (`authorizationState`) y tareas (`tasks`). Prioridad: urgentes, visitas por hora, resto. Acciones en la fila. | M | Medio: mezcla de fuentes con distinta latencia (el Inbox llega por polling); definir el orden y deduplicar un contacto que aparece por dos motivos. |
| **2: Pipeline y atención** | `PipelineBar` (reemplaza la tabla), `AttentionRow` y hook `usePropertiesNeedingAttention()` (sin fotos, sin publicar, con error de publicación, autorización por vencer, `diagnose`). Matches ordenados por score y sin revisados, reducidos a una fila. `ActivityRow` compacta. | M | Medio: `usePublications` hace un fetch por montaje (ya se usa en 4 pantallas); evaluar que el Inicio no sume una petición más (compartir estado como `inboxFeed`). |
| **3: Paleta ⌘K y buscador global** | Paleta con acciones, páginas y búsqueda ampliada; atajo global; ajustes de accesibilidad. Idealmente en `AppLayout` para que valga en todas las pantallas. | M-L | Medio: gestión del foco, conflicto con atajos del navegador y teclados en español/ARG (probar `Ctrl+K` en Firefox y Chrome). |
| **4: Personalización y densidad** | `DashboardPrefsStore`, modo «Personalizar» (ocultar/reordenar con botones), densidad. | M | Bajo: `localStorage` con adaptador. |
| **5: Onboarding** | `OnboardingChecklist` y estados vacíos de todo el Inicio. | S-M | Bajo; el paso «Conectar un canal» depende de `/api` (no corre en `vite dev`). |
| **6: Móvil afinado** | Botón flotante «+», hoja «Crear», filas de 52 px con menú «⋯», accesos deslizables. Se puede hacer con la Fase 0 si el tiempo apremia. | S-M | Bajo-Medio: el «+» flotante no debe tapar contenido ni chocar con `MobileNav`. |

### Quick wins recomendados, en orden

1. **Fila de accesos directos** (8 `QuickActionTile`) con insignias reales: es lo que el dueño pidió explícitamente y se hace casi sin riesgo.
2. **Reemplazar los 4 `StatCard` por una franja de 5 `MiniStat`** y eliminar las barras fijas y la insignia «Activo» (corrige además la honestidad de datos).
3. **«+ Crear ▾» y buscador `Ctrl+K` (versión mínima)**, o, si se prefiere más barato, subir «Para contactar hoy» al primer lugar y sumar a esa lista las visitas del día y las conversaciones sin responder.

---

## 7. Riesgos y preguntas abiertas

Riesgos:

- **Doble cálculo y pedidos repetidos**: cada `useFollowUps` y `usePublications` recalcula/pide por consumidor. En el Inicio conviene calcular una vez y pasar por props, o compartir estado como `inboxFeed.ts` (un polling para N consumidores).
- **Inbox por polling**: el Inicio muestra datos hasta 10 s viejos y se pausa con la pestaña oculta. Aceptable, pero se debe mostrar el error del feed (`feed.error`) en lugar de «Inbox al día» cuando falló.
- **Modales de creación**: no se verificó si `ContactFormModal`, `EventFormModal` y `NewDealModal` pueden abrirse desde el Inicio sin duplicar estado. Puede requerir moverlos a un contexto (esfuerzo sumado a Fase 0/3).
- **Datos semilla vs. reales**: las capturas usan semilla (todos los scores 100 %); con datos reales la distribución cambia. Probar con cuentas con 0, pocas y muchas propiedades, y con el Inbox vacío.
- **Moneda**: hoy el pipeline suma monedas. Cambiarlo cambia una cifra que el dueño ya ve; avisarlo.
- **Accesibilidad**: `ctrl+K` y los menús necesitan foco, `aria`, contraste del lila (`#7458C4`, 5,3:1 sobre blanco) y objetivos táctiles de 44 px en móvil. Revisar cada tile con teclado.
- **Estado de la copia usada para las capturas**: es una copia de auditoría con sesión demo; no refleja el entorno real de Supabase ni el Inbox con mensajes.
- **Benchmark limitado**: las fuentes son resúmenes de búsqueda y documentación de producto, no pruebas de uso. De Tokko, Kiteprop, kvCORE, Compass y Rechat no pude verificar el diseño de su inicio. De la adaptación móvil de la mayoría de los productos tampoco.

Preguntas abiertas para el dueño del producto:

1. ¿Qué hace el agente apenas abre el CRM? (Los 8 accesos son una hipótesis; ¿hay alguno que sobre, o falte, por ejemplo «Importar contactos» o «Informe a propietario»?)
2. ¿«Subir y publicar» y «Multipublicador» son dos destinos distintos o uno solo? Hoy ambos pasan por flujos separados (`/propiedades/nueva` y `/publicador`).
3. ¿El Inicio es para el agente individual (su día) o para la agencia (su negocio)? Esta propuesta asume el agente; para dueño/administrador convendría una vista aparte o un selector «Mi día / Equipo».
4. ¿Se aprueba medir clics en los accesos durante una semana para ordenarlos con datos reales (requeriría un contador local o analítica, no hay ninguno hoy)?
5. ¿Los matches deben seguir en el Inicio? Propongo bajarlos a una fila y dejar la pantalla `/matches` como lugar principal.
6. ¿Se mantiene el ✦ y el tono del saludo? Propongo un saludo breve con resumen real.
7. ¿Hay una fecha para la invitación de agentes? Condiciona el paso «Invitar al equipo» del onboarding.
8. ¿Se quiere sincronizar las preferencias entre dispositivos? Si sí, hace falta una tabla en la base, hoy fuera de alcance.
