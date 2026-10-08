/**
 * Descarga de UNA foto externa con las guardas anti-SSRF de core.ts.
 *
 * Usa node:http(s) y no `fetch` porque necesitamos `lookup` propio: la IP se
 * valida en el momento de conectar (no antes), así un DNS que cambia de
 * respuesta no puede llevarnos a la red interna. Las redirecciones se siguen a
 * mano (máx. 3) y cada salto se vuelve a validar.
 */
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import {
  MAX_IMAGE_BYTES,
  MAX_REDIRECTS,
  PHOTO_TIMEOUT_MS,
  checkPhotoUrl,
  declaredTypeOk,
  guardedLookup,
  sniffImage,
  type DnsLookup,
  type DownloadResult,
} from "./core.js";

const lookup = guardedLookup(dns.lookup as unknown as DnsLookup);

function getOnce(url: URL, deadline: number): Promise<DownloadResult | { redirect: string }> {
  return new Promise((resolve) => {
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (r: DownloadResult | { redirect: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = lib.get(
      url,
      {
        lookup: lookup as never,
        headers: {
          "User-Agent": "PropMatchCRM-PhotoCopy/1.0 (+https://propmatch.app)",
          Accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1",
        },
        timeout: PHOTO_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          return done({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (status !== 200) {
          res.resume();
          return done({ ok: false, reason: status === 404 ? "La foto ya no existe en el sitio de origen (404)" : `El sitio de origen respondió ${status}` });
        }
        if (!declaredTypeOk(res.headers["content-type"])) {
          res.resume();
          return done({ ok: false, reason: "No es una imagen JPG, PNG o WebP" });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_IMAGE_BYTES) {
          res.resume();
          return done({ ok: false, reason: "La foto pesa más de 10 MB" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_IMAGE_BYTES) {
            req.destroy();
            return done({ ok: false, reason: "La foto pesa más de 10 MB" });
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const bytes = Buffer.concat(chunks);
          const type = sniffImage(bytes);
          if (!type) return done({ ok: false, reason: "No es una imagen JPG, PNG o WebP" });
          done({ ok: true, bytes, type });
        });
        res.on("error", () => done({ ok: false, reason: "Se cortó la descarga" }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ ok: false, reason: "El sitio de origen tardó demasiado" });
    }, Math.max(1000, Math.min(PHOTO_TIMEOUT_MS, deadline - Date.now())));
    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, reason: "El sitio de origen tardó demasiado" });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        reason: err.code === "EBLOCKED" ? "Dirección no permitida (red privada o local)" : "No se pudo descargar",
      });
    });
  });
}

export async function downloadImage(start: URL): Promise<DownloadResult> {
  const deadline = Date.now() + PHOTO_TIMEOUT_MS;
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await getOnce(url, deadline);
    if (!("redirect" in r)) return r;
    const check = checkPhotoUrl(r.redirect);
    if (!check.ok) return { ok: false, reason: `Redirección no permitida: ${check.reason}` };
    url = check.url;
  }
  return { ok: false, reason: "Demasiadas redirecciones" };
}
