/**
 * «Conectar feed XML»: la inmobiliaria pega la URL https de su propio feed.
 * El servidor la guarda cifrada y en esta pantalla solo vuelve el dominio.
 */
import { useId, useState } from "react";
import { integrationsApi } from "./api";

const INK = "#1A1A1A";
const MUTED = "#6B7280";

export function FeedUrlForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void | Promise<void> }) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await integrationsApi.saveFeed(url);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setUrl("");
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: "#DDD8CF", background: "#FAF8F5" }}>
      <p className="text-sm" style={{ color: INK, fontWeight: 700 }}>Conectar feed XML</p>
      <ol className="text-xs list-decimal pl-5 space-y-1" style={{ color: "#374151" }}>
        <li>Copiá la dirección https del XML de tu inmobiliaria.</li>
        <li>Tiene que ser un sitio público. Si lleva un token, va en el query, no como usuario y clave.</li>
        <li>La dirección queda guardada de forma segura: en esta pantalla solo vas a ver el dominio.</li>
      </ol>
      <label className="text-xs block" style={{ color: MUTED, fontWeight: 600 }} htmlFor={id}>
        Dirección del feed
        <input
          id={id}
          type="url"
          required
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full min-h-[44px] px-3 rounded-xl border text-sm bg-white"
          style={{ borderColor: error ? "#FDA4AF" : "#DDD8CF", color: INK }}
        />
      </label>
      {error && <p role="alert" className="text-xs" style={{ color: "#BE123C" }}>{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="flex-1 min-h-[44px] px-4 rounded-xl text-sm text-white disabled:opacity-60" style={{ background: "#9B21FF", fontWeight: 700 }}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] px-4 rounded-xl text-sm border bg-white" style={{ borderColor: "#DDD8CF", color: "#7C0BD8", fontWeight: 700 }}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function FeedSyncButton({ onDone }: { onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    const r = await integrationsApi.feedSync();
    setBusy(false);
    if (!r.ok) {
      setNote({ ok: false, text: r.message });
      await onDone();
      return;
    }
    const d = r.data;
    const parts = [
      d.created ? `${d.created} nuevas` : "",
      d.updated ? `${d.updated} actualizadas` : "",
      d.paused ? `${d.paused} pausadas` : "",
      d.unchanged ? `${d.unchanged} sin cambios` : "",
    ].filter(Boolean);
    const extra = d.truncated ? " El archivo es muy grande: no se pausó nada que no hayamos llegado a leer." : "";
    const skipped = d.skipped ? ` ${d.skipped} avisos no tenían tipo, operación o título, y no se importaron.` : "";
    setNote({ ok: true, text: `Listo. ${parts.join(", ") || "Nada que cambiar"}.${skipped}${extra}` });
    await onDone();
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="w-full min-h-[44px] px-4 rounded-xl text-sm border bg-white hover:bg-violet-50 disabled:opacity-60"
        style={{ borderColor: "#DDD8CF", color: "#7C0BD8", fontWeight: 700 }}
      >
        {busy ? "Trayendo avisos…" : "Traer avisos"}
      </button>
      {note && (
        <p role="status" className="text-xs mt-2 px-3 py-2 rounded-lg" style={note.ok ? { background: "#F0FDF4", color: "#15803D" } : { background: "#FFF1F2", color: "#BE123C" }}>
          {note.text}
        </p>
      )}
    </div>
  );
}
