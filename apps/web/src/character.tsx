import { decodeBuild, encodeBuild, indexClass, type Build, type ClassIndex } from "@wfuc/engine";
import type { Manifest } from "@wfuc/schema";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadLegacy, useAsync } from "./data";
import { parseHash } from "./router";

const STORAGE_KEY = "wfuc.legacy";

interface CharacterState {
  manifest: Manifest;
  /** Datos de Legacy (null mientras cargan). */
  legacy: ClassIndex | null;
  legacyBuild: Build;
  legacyCode: string;
  /** true cuando Legacy ya se cargo y se aplico el enlace: hasta entonces nadie debe reescribir `l` en el enlace. */
  legacyReady: boolean;
  setLegacyBuild: (update: (b: Build) => Build) => void;
}

const Ctx = createContext<CharacterState | null>(null);

export function useCharacter(): CharacterState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCharacter fuera de CharacterProvider");
  return v;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // modo privado o almacenamiento bloqueado
  }
}

/**
 * Estado compartido del personaje que no depende de la clase: las ventajas de Legacy son de cuenta, asi que se
 * conservan al cambiar de clase (URL `l=` y localStorage) y se suman a los talentos de clase en el resumen.
 */
export function CharacterProvider({ manifest, children }: { manifest: Manifest; children: ReactNode }) {
  const state = useAsync(manifest.legacy.file, () => loadLegacy(manifest.legacy.file));
  const legacy = useMemo(() => (state.status === "ready" ? indexClass(state.value) : null), [state]);
  const [build, setBuild] = useState<Build>({});
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);
  // El `l` del enlace se lee al montar, ANTES de que la pagina de clase (aun sin Legacy cargado) reescriba el enlace sin el
  const initialL = useRef(parseHash(window.location.hash).query.get("l"));

  // Al tener los datos: el enlace manda sobre lo guardado
  useEffect(() => {
    if (!legacy || hydrated.current) return;
    hydrated.current = true;
    const code = initialL.current ?? readStored();
    if (code) setBuild(decodeBuild(legacy, code) ?? {});
    setReady(true);
  }, [legacy]);

  // Un enlace nuevo con otro `l` (p. ej. pegado en la misma pestana) manda sobre el estado actual. Los cambios internos usan
  // replaceState y no disparan hashchange.
  useEffect(() => {
    if (!legacy) return;
    const on = () => {
      const code = parseHash(window.location.hash).query.get("l");
      if (code !== null) setBuild(decodeBuild(legacy, code) ?? {});
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [legacy]);

  const legacyCode = useMemo(() => (legacy ? encodeBuild(legacy, build) : ""), [legacy, build]);
  useEffect(() => {
    if (!hydrated.current || !legacy) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, legacyCode);
    } catch {
      /* sin almacenamiento: solo se pierde la comodidad */
    }
  }, [legacy, legacyCode]);

  const setLegacyBuild = useCallback((update: (b: Build) => Build) => setBuild((b) => update(b)), []);
  const value = useMemo(() => ({ manifest, legacy, legacyBuild: build, legacyCode, legacyReady: ready, setLegacyBuild }), [manifest, legacy, build, legacyCode, ready, setLegacyBuild]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** "--" / "---" = build vacio: no se escribe en el enlace. */
export const isEmptyCode = (code: string): boolean => /^-*$/.test(code);

/** Parametro `l` del enlace para conservar Legacy al navegar (vacio si no hay puntos de Legacy). */
export const legacyQuery = (code: string): Record<string, string> => (isEmptyCode(code) ? {} : { l: code });
