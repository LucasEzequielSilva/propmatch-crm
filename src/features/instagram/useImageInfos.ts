import { useEffect, useRef, useState } from "react";
import type { ImageFacts } from "./imageSpecs";

export type ImageInfo =
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ready" } & ImageFacts);

const mimeFromUrl = (url: string): string | null => {
  const data = /^data:([^;,]+)/.exec(url);
  if (data) return data[1];
  const ext = /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  if (!ext) return null;
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
};

/**
 * Lee dimensiones reales (`naturalWidth/Height`) y, si el CORS lo permite, peso y tipo
 * (`fetch` + `blob`). Si el fetch falla, el peso queda `null` ("no disponible").
 */
export function useImageInfos(urls: string[]): Record<string, ImageInfo> {
  const [infos, setInfos] = useState<Record<string, ImageInfo>>({});
  const started = useRef(new Set<string>());

  useEffect(() => {
    for (const url of urls) {
      if (started.current.has(url)) continue;
      started.current.add(url);
      setInfos((p) => ({ ...p, [url]: { status: "loading" } }));

      const img = new Image();
      img.onload = async () => {
        let bytes: number | null = null;
        let mime = mimeFromUrl(url);
        try {
          const blob = await (await fetch(url)).blob();
          bytes = blob.size;
          if (blob.type.startsWith("image/")) mime = blob.type;
        } catch {
          /* CORS u offline: peso no disponible */
        }
        setInfos((p) => ({ ...p, [url]: { status: "ready", width: img.naturalWidth, height: img.naturalHeight, bytes, mime } }));
      };
      img.onerror = () => setInfos((p) => ({ ...p, [url]: { status: "error" } }));
      img.src = url;
    }
  }, [urls]);

  return infos;
}
