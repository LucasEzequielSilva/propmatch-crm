import { useEffect } from "react";

function setMeta(attr: "name" | "property", key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content == null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.dataset.sitio = "1";
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Title, description y Open Graph de cada página de la web pública.
 *
 * Límite de una SPA de Vite: esto corre en el navegador. Google ejecuta
 * JavaScript y lo ve; los bots que arman la vista previa de un link
 * (WhatsApp, Facebook, X, LinkedIn…) no: a ellos les responde
 * /api/web/og por un rewrite de vercel.json según el User-Agent.
 */
export function useDocumentMeta(m: { title: string; description: string; image?: string | null; noindex?: boolean }) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = m.title;
    setMeta("name", "description", m.description);
    setMeta("property", "og:title", m.title);
    setMeta("property", "og:description", m.description);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:url", window.location.href.split("?")[0]);
    setMeta("property", "og:image", m.image ?? null);
    setMeta("name", "robots", m.noindex ? "noindex" : null);
    return () => {
      document.title = prevTitle;
      document.head.querySelectorAll('meta[data-sitio="1"]').forEach((el) => el.remove());
    };
  }, [m.title, m.description, m.image, m.noindex]);
}
