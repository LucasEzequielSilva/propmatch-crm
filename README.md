# PropMatch CRM

CRM para inmobiliarias. React 19 + Vite + Tailwind v4 + React Router.

Porteado del prototipo de Figma Make `PropMatch-SaaS-CRM-Dashboard`,
conservando el sistema visual completo.

## Correrlo

    npm install
    npm run dev     # http://localhost:5180

No necesita backend ni variables de entorno.

## Como funcionan los datos

Todo el estado vive en `src/data/`:

- `seed.ts` — contactos, propiedades, oportunidades, agenda y tareas de arranque.
  Es una sola fuente de verdad: en el prototipo cada pantalla tenia su propio
  array y no coincidian entre si.
- `store.tsx` — el estado de la app, con persistencia en localStorage. Es el
  unico archivo que las pantallas tocan para leer o escribir.

Los cambios sobreviven al refresh. Para volver a los datos de ejemplo:
`localStorage.removeItem('propmatch.store.v1')` en la consola del navegador.

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
