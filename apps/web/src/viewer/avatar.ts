// Estado de apariencia del avatar (cuerpo y personalización) y su forma compacta para el enlace.
import { MODELS_BASE } from "./config";
import type { Selection } from "./recipe";

export interface Avatar {
  /** 0 = Cuerpo 1 (varón), 1 = Cuerpo 2 (mujer): el de ChrRaceXChrModel.Sex. */
  sex: 0 | 1;
  /** Personalización elegida: opción -> elección. Vacío = las de por defecto. */
  choices: Selection;
  /** Armas envainadas (no en la mano). */
  sheathed?: boolean;
  /** Raza con la que se dibuja el avatar (ChrRaces.ID); sin ella, la del paso Raza. Solo cambia el aspecto. */
  race?: number;
  /** Escena de fondo del probador (id de `BACKDROPS`; 0 = liso); sin ella, la de la raza que se ve. */
  bg?: number;
}

export const DEFAULT_AVATAR: Avatar = { sex: 0, choices: {} };

/** `0` o `1.<opcion>-<eleccion>~<opcion>-<eleccion>`; tras el cuerpo, `s` = armas envainadas y `r<id>` = raza del avatar y `b<id>` = fondo (`0sr6b2`). Cadena vacía = valores por defecto. */
export function encodeAvatar(a: Avatar): string {
  const parts = Object.entries(a.choices).map(([o, c]) => `${o}-${c}`);
  if (a.sex === 0 && !parts.length && !a.sheathed && !a.race && a.bg === undefined) return "";
  const head = `${a.sex}${a.sheathed ? "s" : ""}${a.race ? `r${a.race}` : ""}${a.bg !== undefined ? `b${a.bg}` : ""}`;
  return parts.length ? `${head}.${parts.join("~")}` : head;
}

export function decodeAvatar(code: string | null): Avatar {
  if (!code) return { ...DEFAULT_AVATAR, choices: {} };
  const [s = "0", rest = ""] = code.split(".");
  const choices: Selection = {};
  for (const p of rest.split("~")) {
    const [o, c] = p.split("-").map(Number);
    if (o && c) choices[o] = c;
  }
  const race = Number(/r(\d+)/.exec(s)?.[1]) || 0;
  const bg = /b(\d+)/.exec(s)?.[1];
  return { sex: s.startsWith("1") ? 1 : 0, choices, ...(/^\ds/.test(s) ? { sheathed: true } : {}), ...(race ? { race } : {}), ...(bg !== undefined ? { bg: Number(bg) } : {}) };
}

export interface ModelIndexEntry {
  race: number;
  sex: number;
  chrModel: number;
}

let indexPromise: Promise<ModelIndexEntry[] | null> | null = null;
/** `index.json` de los modelos (raza y cuerpo → ChrModel.ID); se descarga una vez y es null si no hay modelos. */
export const loadModelIndex = () => (indexPromise ??= fetch(`${MODELS_BASE}/index.json`).then((r) => (r.ok ? (r.json() as Promise<ModelIndexEntry[]>) : null), () => null));

/** WebGL 2 disponible (el visor lo necesita); sin él se enseña solo la hoja de ranuras. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}
