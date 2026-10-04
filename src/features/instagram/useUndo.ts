import { useCallback, useRef, useState } from "react";

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 60;

/**
 * Estado con deshacer/rehacer. `set(next, group)` junta cambios seguidos del mismo `group`
 * dentro de `windowMs` en un solo paso (arrastrar un slider = un deshacer, no cien).
 */
export function useUndoState<T>(initial: T, windowMs = 600) {
  const [h, setH] = useState<History<T>>({ past: [], present: initial, future: [] });
  const last = useRef<{ group: string; at: number }>({ group: "", at: 0 });

  const set = useCallback(
    (next: T | ((p: T) => T), group = "") => {
      const now = Date.now();
      const merge = group !== "" && last.current.group === group && now - last.current.at < windowMs;
      last.current = { group, at: now };
      setH((cur) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(cur.present) : next;
        if (merge) return { ...cur, present: value, future: [] };
        return { past: [...cur.past, cur.present].slice(-LIMIT), present: value, future: [] };
      });
    },
    [windowMs],
  );
  const undo = useCallback(() => {
    last.current = { group: "", at: 0 };
    setH((c) => (c.past.length ? { past: c.past.slice(0, -1), present: c.past[c.past.length - 1], future: [c.present, ...c.future] } : c));
  }, []);
  const redo = useCallback(() => {
    last.current = { group: "", at: 0 };
    setH((c) => (c.future.length ? { past: [...c.past, c.present], present: c.future[0], future: c.future.slice(1) } : c));
  }, []);
  /** Reemplaza todo sin dejar historia (carga inicial). */
  const reset = useCallback((value: T) => setH({ past: [], present: value, future: [] }), []);

  return { value: h.present, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
