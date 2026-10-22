// Estado de apariencia del avatar (cuerpo y personalización) y su forma compacta para el enlace.
import type { Selection } from "./recipe";

export interface Avatar {
  /** 0 = Cuerpo 1 (varón), 1 = Cuerpo 2 (mujer): el de ChrRaceXChrModel.Sex. */
  sex: 0 | 1;
  /** Personalización elegida: opción -> elección. Vacío = las de por defecto. */
  choices: Selection;
  /** Armas envainadas (no en la mano). */
  sheathed?: boolean;
}

export const DEFAULT_AVATAR: Avatar = { sex: 0, choices: {} };

/** `0` o `1.<opcion>-<eleccion>~<opcion>-<eleccion>`; una `s` tras el cuerpo (`0s`) = armas envainadas. Cadena vacía = valores por defecto. */
export function encodeAvatar(a: Avatar): string {
  const parts = Object.entries(a.choices).map(([o, c]) => `${o}-${c}`);
  if (a.sex === 0 && !parts.length && !a.sheathed) return "";
  const head = `${a.sex}${a.sheathed ? "s" : ""}`;
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
  return { sex: s.startsWith("1") ? 1 : 0, choices, ...(s.endsWith("s") ? { sheathed: true } : {}) };
}

export interface ModelIndexEntry {
  race: number;
  sex: number;
  chrModel: number;
}

/** WebGL 2 disponible (el visor lo necesita); sin él se enseña solo la hoja de ranuras. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}
