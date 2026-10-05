import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "@/data/store";
import { hasSamples } from "@/data/samples";
import { isSample, SAMPLE_BANNER_TEXT } from "@/lib/samples";

/** Cerrado "por esta sesión": vuelve al abrir otra pestaña o al entrar de nuevo. */
const DISMISS_KEY = "propmatch.samplesBanner.dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Detalle de un registro de ejemplo según la ruta (`/propiedades/p-1`, `/operaciones/d-1`…). */
function useSampleDetail(): boolean {
  const { pathname } = useLocation();
  const { properties, contacts, deals, matches } = useStore();
  return useMemo(() => {
    const [, section, id] = pathname.split("/");
    if (!id) return false;
    const byId = <T extends { id: string; is_sample?: boolean }>(rows: T[]) => isSample(rows.find((r) => r.id === id));
    switch (section) {
      case "propiedades":
      case "publicador":
        return byId(properties);
      case "contactos":
        return byId(contacts);
      case "operaciones":
        return byId(deals);
      case "matches":
        return byId(matches);
      default:
        return false;
    }
  }, [pathname, properties, contacts, deals, matches]);
}

/**
 * Banner global: avisa que hay datos de ejemplo y ofrece pasar a los datos
 * reales. Se puede cerrar por sesión, pero reaparece al entrar al detalle de
 * un ejemplo (ahí es donde más importa no confundirlo con algo real).
 */
export function SampleBanner() {
  const store = useStore();
  const { isDemo, hideSamples, signOut } = store;
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readDismissed);
  const onSampleDetail = useSampleDetail();
  const visible = hasSamples(store);

  if (!visible || (dismissed && !onSampleDetail)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Sin storage: se cierra hasta el próximo refresh.
    }
  };

  const goReal = () => {
    if (isDemo) {
      // En la demo los ejemplos siempre están: para tener datos reales hay que entrar con una cuenta.
      signOut();
      navigate("/login");
      return;
    }
    if (window.confirm("Se van a quitar todos los datos de ejemplo. Lo que cargaste vos y lo que vino de la app se queda. Podés volver a mostrarlos desde Configuración.")) {
      hideSamples();
    }
  };

  return (
    <div
      role="status"
      className="px-4 md:px-8 py-2 text-sm border-b flex flex-wrap items-center gap-x-3 gap-y-1.5"
      style={{ background: "var(--color-lavender)", color: "var(--color-lilac-text)", borderColor: "var(--color-lilac)" }}
    >
      <span style={{ fontWeight: 600 }}>
        {onSampleDetail ? "Esto es un dato de ejemplo: no se sincroniza, no se publica ni se envía. " : ""}
        {SAMPLE_BANNER_TEXT}
      </span>
      <button
        type="button"
        onClick={goReal}
        className="min-h-[32px] px-3 rounded-lg text-xs transition-all hover:opacity-90"
        style={{ background: "var(--color-brand-purple)", color: "white", fontWeight: 700 }}
      >
        {isDemo ? "Crear mi cuenta" : "Usar mis datos reales"}
      </button>
      {!onSampleDetail && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Cerrar aviso de datos de ejemplo"
          className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center hover:bg-violet-100"
          style={{ color: "var(--color-lilac-text)", fontSize: 18, lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
