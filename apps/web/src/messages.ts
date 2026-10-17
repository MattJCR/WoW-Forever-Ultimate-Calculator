import type { Blocker } from "@wfuc/engine";

export const BLOCKER_TEXT: Record<Blocker, string> = {
  "unknown-node": "Talento desconocido",
  inactive: "Nodo no activo: no se puede seleccionar",
  "max-rank": "Ya está al rango máximo",
  "no-points": "No quedan puntos de talento",
  "row-locked": "Faltan puntos para desbloquearlo",
  prerequisite: "Requiere el rango máximo del talento previo",
  "not-allocated": "No hay puntos que quitar",
  "required-by-others": "Otros talentos dependen de este punto",
};

/** plural(1, "nodo", "nodos") -> "1 nodo"; plural(3, ...) -> "3 nodos". */
export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const SMALL =new Set(["de", "del", "la", "las", "el", "los", "en", "y", "a", "con", "por"]);

/** Iniciales para la ficha del talento mientras no tengamos los iconos del juego. */
export function initials(name: string | null): string {
  if (!name) return "?";
  const words = name.split(/[\s:]+/).filter((w) => w && !SMALL.has(w.toLowerCase()));
  const pick = (words.length ? words : [name]).slice(0, 2);
  return pick.map((w) => w[0]!.toUpperCase()).join("");
}
