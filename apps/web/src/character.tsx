import { decodeBuildReport, encodeBuild, indexClass, type Build, type ClassIndex, type DecodeReport } from "@wfuc/engine";
import type { Manifest } from "@wfuc/schema";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadLegacy, useAsync } from "./data";
import { onNavigate } from "./router";

const STORAGE_KEY = "wfuc.legacy";

interface CharacterState {
  manifest: Manifest;
  /** Datos de Legacy (null mientras cargan). */
  legacy: ClassIndex | null;
  legacyBuild: Build;
  legacyCode: string;
  /** true cuando Legacy ya se cargo y se aplico el enlace: hasta entonces nadie debe reescribir `l` en el enlace. */
  legacyReady: boolean;
  /** Lo que el enlace (o lo guardado) de Legacy no pudo conservar al leerlo con los datos actuales; null si encajaba. */
  legacyReport: DecodeReport | null;
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
  const [legacyReport, setLegacyReport] = useState<DecodeReport | null>(null);
  /** Aplica un codigo de Legacy: conserva lo valido y guarda el informe solo si algo no encajo. */
  const applyCode = useCallback((idx: ClassIndex, code: string) => {
    const r = decodeBuildReport(idx, code);
    setBuild(r.build);
    setLegacyReport(r.lost.length > 0 || r.malformed ? r : null);
  }, []);
  const hydrated = useRef(false);
  // El `l` del enlace se lee al montar, ANTES de que la pagina de clase (aun sin Legacy cargado) reescriba el enlace sin el
  const initialL = useRef(new URLSearchParams(window.location.search).get("l"));

  // Al tener los datos: el enlace manda sobre lo guardado
  useEffect(() => {
    if (!legacy || hydrated.current) return;
    hydrated.current = true;
    const code = initialL.current ?? readStored();
    if (code) applyCode(legacy, code);
    setReady(true);
  }, [legacy, applyCode]);

  // Un enlace nuevo con otro `l` (un enlace de la web o atrás/adelante) manda sobre el estado actual. Los cambios internos usan
  // replaceState y no avisan.
  useEffect(() => {
    if (!legacy) return;
    return onNavigate(() => {
      const code = new URLSearchParams(window.location.search).get("l");
      if (code !== null) applyCode(legacy, code);
    });
  }, [legacy, applyCode]);

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
  const value = useMemo(() => ({ manifest, legacy, legacyBuild: build, legacyCode, legacyReady: ready, legacyReport, setLegacyBuild }), [manifest, legacy, build, legacyCode, ready, legacyReport, setLegacyBuild]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** "--" / "---" = build vacio: no se escribe en el enlace. */
export const isEmptyCode = (code: string): boolean => /^-*$/.test(code);

/** Parametro `l` del enlace para conservar Legacy al navegar (vacio si no hay puntos de Legacy). */
export const legacyQuery = (code: string): Record<string, string> => (isEmptyCode(code) ? {} : { l: code });

/** Personaje vacío para generar las páginas estáticas (prerender): sin Legacy ni lectura del navegador. */
export function StaticCharacterProvider({ manifest, children }: { manifest: Manifest; children: ReactNode }) {
  const value: CharacterState = { manifest, legacy: null, legacyBuild: {}, legacyCode: "", legacyReady: true, legacyReport: null, setLegacyBuild: () => {} };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
