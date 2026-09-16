# PropMatch CRM

CRM para inmobiliarias. React 19 + Vite + Tailwind v4 + React Router.

**En vivo:** https://propmatch-crm-taupe.vercel.app
**Repo:** https://github.com/Valentinbarrera/propmatch-crm (privado)

Cada push a `master` redespliega solo.

> El deploy es publico: cualquiera con el link entra, porque el login todavia
> no valida nada (ver mas abajo). Los datos son de ejemplo, no hay informacion
> real de clientes.

Porteado del prototipo de Figma Make `PropMatch-SaaS-CRM-Dashboard`,
conservando el sistema visual completo.

## Correrlo

    npm install
    npm run dev     # http://localhost:5180

No necesita backend ni variables de entorno.

## Inicio de sesion

La pantalla de login existe, pero NO es seguridad: sin backend no hay
contrasenas guardadas ni tokens, y alcanza con el mail de un agente para
entrar. Sirve para que el flujo este completo y para saber que agente esta
usando el CRM (de eso dependen "a cargo de", el avatar del header y el ranking
del equipo).

La pantalla lista los agentes del equipo: un click completa el formulario.
La sesion se guarda en `localStorage` bajo `propmatch.session.v1`.

## Como funcionan los datos

Todo el estado vive en `src/data/`:

- `seed.ts` — contactos, propiedades, oportunidades, agenda y tareas de arranque.
  Es una sola fuente de verdad: en el prototipo cada pantalla tenia su propio
  array y no coincidian entre si.
- `store.tsx` — el estado de la app, con persistencia en localStorage. Es el
  unico archivo que las pantallas tocan para leer o escribir.

Los cambios sobreviven al refresh. Para volver a los datos de ejemplo:
Configuracion > "Volver a los datos de ejemplo" (tambien cierra la sesion).
Los datos de la inmobiliaria y el perfil propio se editan en la misma pantalla.

## Animaciones

Las clases viven en `src/index.css`: `pm-enter` (contenido al cambiar de ruta),
`pm-modal` y `pm-backdrop`, `pm-toast`, `pm-stagger` (listas escalonadas) y
`pm-dragging` (tarjeta del kanban mientras se arrastra). Todo se desactiva solo
con `prefers-reduced-motion`.

## El motor de matching

`src/lib/matching.ts`. Los scores NO estan escritos a mano: se calculan cruzando
lo que busca cada contacto (`contact_requirements`) con cada propiedad.

| Factor                | Peso |
|-----------------------|------|
| Presupuesto           | 30%  |
| Ubicacion             | 25%  |
| Tipo de propiedad     | 20%  |
| Ambientes/superficie  | 15%  |
| Caracteristicas       | 10%  |

Se recalcula solo: al cargar una propiedad, sus matches aparecen al instante en
Matches, en el badge del sidebar y en los KPIs. El formulario de alta muestra el
potencial de match en vivo mientras se completa.

Umbrales de lectura (los define el diseno): >=90 excelente, >=70 bueno,
>=50 parcial. Por debajo de 50 no se muestra.

## Estructura

    src/
      components/layout/   Sidebar, AppHeader (unico para toda la app), AppLayout
      components/ui/       icons, Card, StatCard, ScoreRing, FilterTabs, states
      data/                seed.ts, store.tsx
      features/<modulo>/   una carpeta por pantalla del CRM
      lib/                 matching.ts, format.ts
      types/db.ts          tipos del dominio
    backend-futuro/        migraciones SQL para cuando haya backend

## Scripts

    npm run dev         servidor de desarrollo
    npm run build       build de produccion
    npm run typecheck   chequeo de tipos
