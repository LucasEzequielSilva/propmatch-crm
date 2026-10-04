import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { IG_LIMITS } from "./imageSpecs";
import { countHashtags, joinCaption, TONES, truncateForMore, type CaptionOptions } from "./caption";

interface Props {
  body: string;
  onBody: (v: string) => void;
  hashtags: string[];
  suggested: string[];
  onHashtags: (v: string[]) => void;
  options: CaptionOptions;
  onOptions: (o: CaptionOptions) => void;
  onRegenerate: () => void;
  hasPhone: boolean;
  isStory: boolean;
  /** Texto de ayuda bajo el título (el Estudio sin propiedad lo cambia). */
  intro?: string;
  /** Contenido extra arriba del texto (p. ej. «Autocompletar desde una propiedad»). */
  extra?: ReactNode;
}

const toggles: { key: keyof Omit<CaptionOptions, "tone">; label: string }[] = [
  { key: "hook", label: "Gancho inicial" },
  { key: "details", label: "Detalles con viñetas" },
  { key: "cta", label: "Llamado a la acción" },
  { key: "linkInBio", label: "«Link en la bio»" },
  { key: "contact", label: "Contacto" },
  { key: "showPrice", label: "Mostrar precio" },
];

export function CaptionPanel({ body, onBody, hashtags, suggested, onHashtags, options, onOptions, onRegenerate, hasPhone, isStory, intro, extra }: Props) {
  const [copied, setCopied] = useState("");
  const full = joinCaption(body, hashtags);
  const tagCount = countHashtags(full);
  const { visible, rest, truncated } = truncateForMore(full);
  const overChars = full.length > IG_LIMITS.captionMax;
  const overTags = tagCount > IG_LIMITS.hashtagsMax;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied("Texto copiado al portapapeles.");
    } catch {
      setCopied("No pudimos copiar automáticamente: seleccioná el texto y copialo con Ctrl+C.");
    }
    setTimeout(() => setCopied(""), 4000);
  };
  const toggleTag = (t: string) => onHashtags(hashtags.includes(t) ? hashtags.filter((x) => x !== t) : [...hashtags, t]);

  const counter = (label: string, n: number, max: number, bad: boolean) => (
    <span className="text-xs" style={{ color: bad ? "#BE123C" : "#4B5563", fontWeight: bad ? 700 : 500 }}>
      {label}: {n.toLocaleString("es-AR")}/{max.toLocaleString("es-AR")}
      {bad && " · te pasaste"}
    </span>
  );

  return (
    <Card>
      <div className="px-5 py-4 border-b" style={{ borderColor: "#F3F0FF" }}>
        <h3 className="text-base" style={{ color: "#1F0A3C", fontWeight: 700 }}>Texto de la publicación</h3>
        <p className="text-xs mt-0.5" style={{ color: "#6B5A8A" }}>
          {intro ?? "Se arma con los datos reales de la propiedad. Editalo libremente."}
        </p>
        {isStory && (
          <p className="text-xs mt-2 px-3 py-2 rounded-lg" style={{ background: "#F5F3FF", color: "#5B3FA8" }}>
            Las Stories no llevan texto de publicación; este texto aplica si cambiás a un formato de feed.
          </p>
        )}
      </div>
      <div className="p-5 flex flex-col gap-4">
        {extra}
        <fieldset>
          <legend className="text-xs mb-1.5" style={{ color: "#7458C4", fontWeight: 700 }}>Tono</legend>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <label
                key={t.id}
                className="px-3 min-h-11 md:min-h-9 rounded-xl border text-sm flex items-center gap-2 cursor-pointer has-[:focus-visible]:outline-2"
                style={{ borderColor: options.tone === t.id ? "#7C3AED" : "#EDE9FE", background: options.tone === t.id ? "#F5F3FF" : "white", color: "#1F0A3C", fontWeight: 600 }}
                title={t.hint}
              >
                <input type="radio" name="ig-tone" className="sr-only" checked={options.tone === t.id} onChange={() => onOptions({ ...options, tone: t.id })} />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-xs mb-1.5" style={{ color: "#7458C4", fontWeight: 700 }}>Bloques</legend>
          <div className="flex flex-wrap gap-x-4">
            {toggles.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm min-h-11 md:min-h-8 cursor-pointer" style={{ color: "#1F0A3C" }}>
                <input type="checkbox" className="w-5 h-5" style={{ accentColor: "#7C3AED" }} checked={options[t.key]} onChange={(e) => onOptions({ ...options, [t.key]: e.target.checked })} />
                {t.label}
              </label>
            ))}
          </div>
          {!hasPhone && options.contact && (
            <p className="text-xs mt-1" style={{ color: "#6B5A8A" }}>La agencia no tiene teléfono cargado: el contacto muestra solo el nombre.</p>
          )}
          {options.linkInBio && (
            <p className="text-xs mt-1" style={{ color: "#6B5A8A" }}>
              Los links dentro del texto de Instagram no son clicables. Por eso proponemos «link en la bio»: poné el enlace de la ficha en tu perfil.
            </p>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-2 px-3 min-h-11 md:min-h-9 rounded-xl border text-xs hover:bg-violet-50"
            style={{ borderColor: "#EDE9FE", color: "#7458C4", fontWeight: 700 }}
          >
            Regenerar texto con estas opciones
          </button>
        </fieldset>

        <div>
          <label htmlFor="ig-body" className="text-xs" style={{ color: "#7458C4", fontWeight: 700 }}>Texto</label>
          <textarea
            id="ig-body"
            value={body}
            onChange={(e) => onBody(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-xl border p-3 text-sm"
            style={{ borderColor: overChars ? "#E11D48" : "#EDE9FE", color: "#1F0A3C", lineHeight: 1.5 }}
          />
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {counter("Caracteres", full.length, IG_LIMITS.captionMax, overChars)}
            {counter("Hashtags", tagCount, IG_LIMITS.hashtagsMax, overTags)}
          </div>
          <div className="mt-2 rounded-lg border p-2.5 text-xs" style={{ borderColor: "#EDE9FE", background: "#FDFCFF", color: "#1F0A3C" }}>
            <p style={{ color: "#7458C4", fontWeight: 700 }}>
              Lo que se ve antes del «más…» (~{IG_LIMITS.captionVisibleChars} caracteres, aproximado)
            </p>
            <p className="mt-1" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              <mark style={{ background: "#EDE9FE", color: "#1F0A3C" }}>{visible || "—"}</mark>
              {truncated && <span style={{ color: "#6B7280" }}>{rest}</span>}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs" style={{ color: "#7458C4", fontWeight: 700 }}>Hashtags sugeridos</p>
          <p className="text-xs mt-0.5" style={{ color: "#6B5A8A" }}>
            Instagram permite hasta {IG_LIMITS.hashtagsMax}, pero conviene pocos y relevantes. Tocá un chip para agregarlo o quitarlo.
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Hashtags sugeridos">
            {suggested.map((t) => {
              const on = hashtags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTag(t)}
                  className="px-3 min-h-11 md:min-h-8 rounded-full border text-xs"
                  style={{ borderColor: on ? "#7C3AED" : "#EDE9FE", background: on ? "#7C3AED" : "white", color: on ? "white" : "#7458C4", fontWeight: 600 }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copy}
            className="px-5 min-h-11 rounded-xl text-sm text-white hover:opacity-90 active:scale-95"
            style={{ background: "var(--gradient-brand)", fontWeight: 700 }}
          >
            Copiar texto
          </button>
          <span role="status" aria-live="polite" className="text-xs" style={{ color: "#15803D", fontWeight: 600 }}>
            {copied}
          </span>
        </div>
      </div>
    </Card>
  );
}
