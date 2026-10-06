import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictado con la Web Speech API del navegador (SpeechRecognition /
 * webkitSpeechRecognition), en es-AR, continuo y con resultados interinos.
 *
 * El audio lo procesa el reconocimiento del propio navegador: en Chrome pasa
 * por los servidores de Google y en Edge por los de Microsoft. A PropMatch
 * solo llega el texto.
 *
 * Soporte: Chrome y Edge (escritorio y Android), Safari 14.1+ (macOS/iOS, con
 * Siri habilitado), Samsung Internet. Firefox no lo trae: ahí se escribe o se
 * pega el texto.
 */

/* Tipos mínimos: TypeScript no trae SpeechRecognition en lib.dom. */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function recognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = (): boolean => recognitionCtor() !== null;

export type DictationStatus = "idle" | "starting" | "listening" | "paused";

export type DictationError = "permiso" | "sin-microfono" | "red" | "idioma" | "otro";

export const DICTATION_ERROR_TEXT: Record<DictationError, string> = {
  permiso:
    "No hay permiso para usar el micrófono. Habilitalo desde el candado de la barra de direcciones (Configuración del sitio → Micrófono → Permitir) y probá de nuevo.",
  "sin-microfono": "No encontramos un micrófono. Conectá uno o escribí el texto.",
  red: "El reconocimiento de voz del navegador necesita internet. Revisá la conexión o escribí el texto.",
  idioma: "Tu navegador no reconoce español en este dispositivo. Escribí o pegá el texto.",
  otro: "El dictado se cortó. Probá de nuevo o escribí el texto.",
};

function mapError(code: string): DictationError | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null; // silencio o corte nuestro: no es un error para mostrar
    case "not-allowed":
    case "service-not-allowed":
      return "permiso";
    case "audio-capture":
      return "sin-microfono";
    case "network":
      return "red";
    case "language-not-supported":
      return "idioma";
    default:
      return "otro";
  }
}

/**
 * `onFinal` recibe cada frase confirmada (para sumarla al texto editable);
 * `interim` es lo que todavía se está reconociendo.
 */
export function useDictation(onFinal: (chunk: string) => void, lang = "es-AR") {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<DictationError | null>(null);
  const supported = speechSupported();
  const recRef = useRef<SR | null>(null);
  /** El usuario quiere seguir escuchando: Chrome corta solo tras un silencio y hay que reengancharlo. */
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const begin = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => setStatus("listening");
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) {
          if (t.trim()) onFinalRef.current(t.trim());
        } else live += t;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      const err = mapError(e.error);
      if (err) {
        setError(err);
        wantRef.current = false;
      }
    };
    rec.onend = () => {
      setInterim("");
      if (wantRef.current && recRef.current === rec) {
        try {
          rec.start();
          return;
        } catch {
          /* cae a pausado */
        }
      }
      if (recRef.current === rec) recRef.current = null;
      setStatus((s) => (s === "idle" ? "idle" : "paused"));
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setError("otro");
      wantRef.current = false;
      setStatus("paused");
    }
  }, [lang]);

  const start = useCallback(() => {
    if (!supported || wantRef.current) return;
    setError(null);
    wantRef.current = true;
    setStatus("starting");
    begin();
  }, [supported, begin]);

  /** Deja de escuchar; lo reconocido hasta acá se confirma. */
  const pause = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setStatus((s) => (s === "idle" ? "idle" : "paused"));
  }, []);

  /** Corta del todo (al cerrar o al procesar). */
  const stop = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    rec?.abort();
    setInterim("");
    setStatus("idle");
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
    recRef.current = null;
  }, []);

  return { supported, status, interim, error, start, pause, stop };
}

/**
 * Plan B para navegadores sin reconocimiento: grabar el audio SOLO para
 * escucharlo mientras se escribe. No se transcribe ni se sube a ningún lado.
 */
export function useAudioMemo() {
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
  const [recording, setRecording] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const urlRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const u = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        urlRef.current = u;
        setUrl(u);
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "permiso" : "sin-microfono");
    }
  }, []);

  const stop = useCallback(() => {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  useEffect(
    () => () => {
      if (recRef.current?.state === "recording") recRef.current.stop();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return { supported, recording, url, error, start, stop };
}
