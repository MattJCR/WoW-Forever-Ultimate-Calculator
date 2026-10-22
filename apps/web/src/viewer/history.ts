import { useCallback, useEffect, useRef, useState } from "react";

/** Historial de deshacer/rehacer de un valor que se sustituye entero (equipo + apariencia). */
export function useHistory<T>(value: T, apply: (v: T) => void, limit = 100) {
  const stack = useRef<T[]>([value]);
  const idx = useRef(0);
  const fromHistory = useRef(false);
  const [, bump] = useState(0);

  useEffect(() => {
    if (fromHistory.current) {
      fromHistory.current = false;
      return;
    }
    if (stack.current[idx.current] === value) return;
    stack.current = [...stack.current.slice(0, idx.current + 1), value].slice(-limit);
    idx.current = stack.current.length - 1;
    bump((n) => n + 1);
  }, [value, limit]);

  const go = useCallback((delta: number) => {
    const next = idx.current + delta;
    if (next < 0 || next >= stack.current.length) return;
    idx.current = next;
    fromHistory.current = true;
    apply(stack.current[next] as T);
    bump((n) => n + 1);
  }, [apply]);

  return {
    canUndo: idx.current > 0,
    canRedo: idx.current < stack.current.length - 1,
    undo: () => go(-1),
    redo: () => go(1),
  };
}
