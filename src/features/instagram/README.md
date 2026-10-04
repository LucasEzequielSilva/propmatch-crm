# Publicación en Instagram

Ruta: `/publicador/:propertyId/instagram`. Las especificaciones y sus fuentes están en `imageSpecs.ts`
(lo no confirmado en la doc oficial de Meta está marcado «a verificar» ahí).

Real hoy: selector/orden de fotos, encuadre, chequeos, texto, hashtags, vista previa, descarga de JPEG,
borrador en localStorage, cola del canal. Deshabilitado: «Publicar en Instagram» (`INSTAGRAM_CONNECTED = false`
en `InstagramPublisherPage.tsx`).

## Lógica pura: casos de ejemplo (verificados con vite-node)

- `cropRect(4000, 3000, 4/5, {x:.5,y:.5})` -> `{ sx: 800, sy: 0, sw: 2400, sh: 3000 }` (foto apaisada 4:3 recortada a retrato centrado).
- `cropRect(1000, 1000, 1.91, {x:0,y:1})` -> `sy ≈ 476`, `sh ≈ 524` (recorte apaisado pegado abajo).
- `countHashtags("#a #b hola")` -> `2`.
- `truncateForMore(texto)` corta a ~125 caracteres retrocediendo hasta un espacio si queda a <20 caracteres.
- `buildCaption` con la propiedad semilla «Casa en City Bell», tono Cálido, produce gancho, precio `USD 185.000`,
  descripción, viñetas (ambientes, dormitorios, baños, cocheras, m², características), llamado a la acción con
  «link en la bio» y contacto con el teléfono de la agencia (si la agencia no tiene teléfono, se omite).
- `suggestHashtags` -> `#casaenventa #casa #venta #citybell #buenosaires #laplata #inmobiliaria ...`.

## Notas

- El punto focal es `object-position` (0..1): preview y JPEG exportado usan la misma fórmula.
- La exportación necesita CORS en las fotos remotas; si falta, se informa por foto y se sugiere «Subir fotos».
- El borrador no guarda fotos subidas desde el equipo ni data URLs (se referencian por posición).
