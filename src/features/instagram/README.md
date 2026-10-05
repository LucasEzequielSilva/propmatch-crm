# Estudio de Instagram

Rutas: `/instagram` (mis publicaciones + calendario del mes), `/instagram/nueva` (elegir tipo), `/instagram/:postId`
(editor en 5 pasos: Medios, Editar, Texto, Programar, Publicar). La pantalla anterior por propiedad,
`/publicador/:propertyId/instagram`, sigue igual y ahora tiene un botón «Abrir en el Estudio»
(`/instagram/nueva?propiedad=ID` precarga fotos y texto de esa propiedad).

Tipos: Carrusel (2–10), Foto única, Story (imagen o video, 9:16) y Reel (video 9:16). Reglas en `imageSpecs.ts`.

## Real hoy vs. deshabilitado

- Real: subir fotos/videos propios (IndexedDB), editor no destructivo, vista previa (Feed/Perfil/Story/Reel),
  texto con plantillas, recordatorio (Agenda + campana + `.ics` + aviso opcional del navegador), descarga de
  archivos listos, «Marcar como publicada», lista, duplicar, reprogramar, eliminar.
- «Publicar ahora» por la API oficial (`ApiPublishCard.tsx`): foto, carrusel y story de imagen. Se habilita con la
  conexión de Meta del multipublicador (`connection.ts` → `useMetaConnection`) y `VITE_META_PUBLISH_ENABLED=1`; sin
  eso dice «Requiere aprobación de Meta». Hornea las ediciones a JPEG, las sube a `property-photos/<agency_id>/instagram/`
  (Meta necesita una URL pública) y llama a `/api/meta/ig-create` + `/api/meta/ig-publish`.
- No por API: Reels y stories de video (el bucket de la app solo acepta imágenes de hasta 5 MB) ni programar:
  PropMatch no tiene cola en el servidor, la fecha crea un recordatorio. Ver docs/meta-publicaciones-y-web.md.

## Persistencia

- `postStore.ts`: metadatos en localStorage (`propmatch.instagram-posts.v1`, `{ v: 1, posts }`), interfaz `list/get/save/remove`.
- `mediaStore.ts`: archivos en IndexedDB (`propmatch-instagram` / `media`); la portada de un video es `${mediaId}:cover`.
- Todo queda en este navegador. Para migrar a una base: otra implementación de `PostStore` y de las funciones de `mediaStore`.

## Recordatorio de punta a punta

1. «Programar con recordatorio» crea un evento `publicacion` en la Agenda (`useReminders().schedule`) y guarda su id.
2. La campana lo muestra 24 h antes y, cuando llega la hora, como «Publicación lista para subir» (hasta 48 h) mientras no se marque como publicada.
3. «Agregar a mi calendario» descarga un `.ics` con VALARM 15 min antes: es lo único que avisa con PropMatch cerrado.
4. Opcional: aviso del navegador (permiso solo si se activa), solo con la app abierta.

- Estados: Borrador, Programada, Lista para publicar (llegó la hora), Publicada (marcada a mano), Vencida (pasaron 24 h sin marcarla; criterio de producto, `OVERDUE_AFTER_MS`). Se derivan de la fecha, no se guardan.
- Reprogramar actualiza el evento de la Agenda; el `.ics` hay que bajarlo de nuevo. Eliminar la publicación borra su evento; marcarla como publicada también lo quita.
- Límite: si se edita la hora del evento desde la Agenda, la publicación no se entera (la fuente de verdad es la publicación).
- No hay «mejor horario sugerido»: no tenemos una fuente citada. Los atajos (hoy, mañana, lunes 10:00) son neutros.

## Video y Reels

Confirmado en la doc de Meta (IG User Media) y citado en `imageSpecs.ts`: MP4/MOV, H.264/HEVC, AAC, 23–60 fps, Reel de 3 s a 15 min
y hasta 300 MB, Story en video 3–60 s hasta 100 MB, ancho máx. 1920 px, 9:16 recomendado, portada JPEG hasta 8 MB.
A verificar: topes desde la app móvil, videos dentro de carruseles, 720 px como umbral de «blando» (criterio propio).
No se recorta ni recomprime video en el navegador. Mejora futura: armar un Reel a partir de fotos requiere ffmpeg en un servidor.

## Lógica pura: casos de ejemplo (verificados con vite-node, 2026-10-04)

Estados (programada 2026-10-06 10:00 AR = `2026-10-06T13:00:00Z`): 1 s antes -> `scheduled`; a la hora -> `ready`;
+23 h -> `ready`; +24 h -> `overdue`; guardada como `draft` -> `draft`; `published` -> `published` siempre.

Hora argentina: `arParts("2026-10-06T13:00:00Z")` -> `{ date: "2026-10-06", time: "10:00" }`;
`arToIso("2026-10-06","10:00")` -> `"2026-10-06T13:00:00.000Z"`; `arToIso("2026-13-40","10:00")` -> `null`.

`.ics` (`buildIcs`, título «Publicar en Instagram: Casa; City Bell, living», inicio 13:00Z): produce
`DTSTART:20261006T130000Z`, `DTEND:20261006T133000Z`, `SUMMARY:Publicar en Instagram: Casa\; City Bell\, living`,
`DESCRIPTION:Línea 1\nLínea 2`, y un `VALARM` con `TRIGGER:-PT15M`. Líneas con CRLF; `foldLine` pliega a <= 75 octetos UTF-8.

Edición: `editCrop(4000,3000,defaults,4/5)` -> `{sx:800,sy:0,sw:2400,sh:3000}` (igual que `cropRect`); con `zoom: 2` ->
`{sx:1400,sy:750,sw:1200,sh:1500}`; con `rotate: 90` el espacio de recorte es 3000×4000 -> `{sx:0,sy:125,sw:3000,sh:3750}`.
`filterString({filter:"marmol",brightness:40,saturation:-50})` -> `grayscale(1) contrast(1.1) brightness(1.200) saturate(0.500)`.
Horneado (`drawEdited` con un contexto falso): traslada/escala al recorte, aplica giro y espejo, fija `ctx.filter`, dibuja la imagen y luego
calidez, viñeta, texto con placa y sello. Vista previa y exportación usan la misma función.
Contraste del texto: blanco sobre placa negra 18,9:1; amarillo `#FACC15` -> placa negra 12,3:1; lila `#7458C4` -> placa blanca 5,34:1 (>= 4,5).
Video: 1080×1920, 30 s, 50 MB como Reel -> todo `ok` (el códec queda «sin datos»); 1920×1080, 2 s, 400 MB -> duración y peso `error`, relación `warn`.

## Notas

- Safari antiguo no tiene `ctx.filter`: se avisa y se exporta sin filtros ni ajustes de color.
- Fotos de propiedad remotas: si el servidor no habilita CORS quedan como enlace y no se pueden hornear (se avisa al descargar).
- No se probó con sesión real en un navegador: lo verificado es tsc, la lógica pura y que el servidor de desarrollo compile los módulos.

## Heredado (pantalla por propiedad)

- `cropRect(4000, 3000, 4/5, {x:.5,y:.5})` -> `{ sx: 800, sy: 0, sw: 2400, sh: 3000 }`.
- `countHashtags("#a #b hola")` -> `2`; `truncateForMore` corta a ~125 caracteres sin partir palabras.
- El punto focal es `object-position` (0..1): preview y JPEG usan la misma fórmula.
