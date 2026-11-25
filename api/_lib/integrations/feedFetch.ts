/**
 * Baja el XML del feed de UNA inmobiliaria. Misma idea que la copia de fotos:
 * https, sin red privada, DNS chequeado al conectar, redirects a mano.
 * No loguea la URL (puede traer un token en el query).
 */
import https from "node:https";
import dns from "node:dns";
import { guardedLookup, type DnsLookup } from "../photoCopy/core.js";
import { FEED_MAX_BYTES, checkFeedUrl } from "../../../shared/feedXml.js";

const lookup = guardedLookup(dns.lookup as unknown as DnsLookup);
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export type FeedDownload = { ok: true; xml: string } | { ok: false; message: string };

function getOnce(url: URL, deadline: number): Promise<{ ok: true; xml: string } | { ok: false; message: string } | { redirect: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { ok: true; xml: string } | { ok: false; message: string } | { redirect: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const req = https.get(
      url,
      {
        lookup: lookup as never,
        headers: {
          "User-Agent": "PropMatchCRM-Feed/1.0",
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          try {
            return done({ redirect: new URL(res.headers.location, url).toString() });
          } catch {
            return done({ ok: false, message: "El feed redirigió a una dirección inválida." });
          }
        }
        if (status !== 200) {
          res.resume();
          return done({ ok: false, message: status === 404 ? "No encontramos el feed en esa dirección (404)." : "El sitio del feed no respondió bien. Probá de nuevo en un rato." });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > FEED_MAX_BYTES) {
            req.destroy();
            return done({ ok: false, message: "El feed pesa más de 8 MB." });
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const xml = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
          if (!xml.trim().startsWith("<")) return done({ ok: false, message: "Esa dirección no devolvió un XML." });
          done({ ok: true, xml });
        });
        res.on("error", () => done({ ok: false, message: "Se cortó la descarga del feed." }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done({ ok: false, message: "El sitio del feed tardó demasiado." });
    }, Math.max(1000, Math.min(TIMEOUT_MS, deadline - Date.now())));
    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, message: "El sitio del feed tardó demasiado." });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        message: err.code === "EBLOCKED" ? "Esa dirección apunta a una red privada. Tiene que ser un sitio público." : "No se pudo descargar el feed.",
      });
    });
  });
}

export async function downloadFeed(start: URL): Promise<FeedDownload> {
  const deadline = Date.now() + TIMEOUT_MS;
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await getOnce(url, deadline);
    if (!("redirect" in r)) return r;
    const check = checkFeedUrl(r.redirect);
    if (!check.ok) return { ok: false, message: "El feed redirigió a una dirección que no aceptamos." };
    url = check.url;
  }
  return { ok: false, message: "El feed redirigió demasiadas veces." };
}
