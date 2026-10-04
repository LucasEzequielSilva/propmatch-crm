import { useEffect, useRef, useState } from "react";
import type { IgFormat } from "./imageSpecs";
import { drawEdited, loadImage, type DrawOptions } from "./photoEdits";
import type { PostMedia } from "./postStore";

const PREVIEW_WIDTH = 540;

/**
 * Imágenes «horneadas» a baja resolución para la maqueta del celular: pasan por `drawEdited`,
 * la misma función que usa la exportación. Si el canvas queda bloqueado por CORS (foto remota),
 * se muestra el original sin ediciones.
 */
export function useBakedPreviews(media: PostMedia[], urls: Record<string, string>, format: IgFormat, opts: DrawOptions): Record<string, string> {
  const [baked, setBaked] = useState<Record<string, string>>({});
  const owned = useRef<string[]>([]);

  const optsKey = `${opts.stampText ?? ""}|${opts.safeMargin ?? 0}`;
  const key = JSON.stringify(media.filter((m) => m.kind === "image").map((m) => [m.id, urls[m.id] ?? "", m.edits])) + `|${format.id}|${optsKey}`;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const next: Record<string, string> = {};
      const created: string[] = [];
      for (const m of media) {
        const src = urls[m.id];
        if (m.kind !== "image" || !src) continue;
        try {
          const img = await loadImage(src);
          const h = Math.round(PREVIEW_WIDTH / format.ratio);
          const c = document.createElement("canvas");
          c.width = PREVIEW_WIDTH;
          c.height = h;
          drawEdited(c.getContext("2d")!, img, img.naturalWidth, img.naturalHeight, m.edits, PREVIEW_WIDTH, h, opts);
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
          if (blob) {
            const u = URL.createObjectURL(blob);
            created.push(u);
            next[m.id] = u;
          } else next[m.id] = src;
        } catch {
          next[m.id] = src;
        }
        if (!alive) {
          created.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
      }
      owned.current.forEach((u) => URL.revokeObjectURL(u));
      owned.current = created;
      setBaked(next);
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // `key` resume todo lo que cambia el resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => owned.current.forEach((u) => URL.revokeObjectURL(u)), []);

  return baked;
}
