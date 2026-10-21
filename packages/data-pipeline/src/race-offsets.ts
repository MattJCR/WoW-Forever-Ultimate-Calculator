/**
 * Diferencias de atributos de cada raza respecto al Humano en Forever: [fuerza, agilidad, aguante, intelecto, espiritu].
 *
 * El cliente no las trae (ChrRaces no tiene columnas de atributos). Procedencia `community` (La comunidad, MIT):
 *  - Las 8 razas clasicas usan las diferencias del juego original (commit 6fc2230, PR #619, 2026-10-21): la comunidad
 *    probo antes (commit 6296e85, 2026-10-20) unas menores leidas en hojas de nivel 1 y las revirtio al dia siguiente
 *    («Forever puts every race but the Skyborne back on the original game's offsets, Spirit included»). Aqui mandan
 *    las vigentes; las del 2026-10-20 quedan descartadas.
 *  - Cielonato (95 y 96): leidas en hojas de nivel 1 el 2026-09-22 (cuatro parejas Humano/Alta Orden y un guerrero Hijo
 *    del Viento, mismo desplazamiento); sin cambios.
 * Son lecturas de un tercero, sin capturas publicadas. Anteriores a las raciales multiplicativas.
 * Se supone que no cambian con el nivel (como en Classic).
 */
export const RACE_OFFSETS_SOURCE = {
  name: "Medidas de la comunidad",
  url: "",
  commit: "",
  date: "2026-10-21",
  license: "MIT",
} as const;

export type Offset5 = [number, number, number, number, number];

/** ChrRaces.ID -> desplazamiento. Humano (1) es la referencia: cero. */
export const FOREVER_RACE_OFFSETS: Record<number, Offset5> = {
  1: [0, 0, 0, 0, 0], // Humano
  2: [3, -3, 2, -3, 3], // Orco
  3: [2, -4, 3, -1, -1], // Enano
  4: [-3, 5, -1, 0, 0], // Elfo de la noche
  5: [-1, -2, 1, -2, 5], // No-muerto
  6: [5, -5, 2, -5, 2], // Tauren
  7: [-5, 3, -1, 3, 0], // Gnomo
  8: [1, 2, 1, -4, 1], // Trol
  95: [-1, 1, -1, 1, 0], // Cielonato (Alianza, Alta Orden)
  96: [-1, 1, -1, 1, 0], // Cielonato (Horda, Hijo del Viento)
};
