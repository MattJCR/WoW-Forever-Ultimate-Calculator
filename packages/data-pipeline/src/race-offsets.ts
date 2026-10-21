/**
 * Diferencias de atributos de cada raza respecto al Humano en Forever: [fuerza, agilidad, aguante, intelecto, espiritu].
 *
 * El cliente no las trae (ChrRaces no tiene columnas de atributos). Las midio el proyecto wowsims/forever (MIT, "wowsims team")
 * en hojas de personaje desnudas de nivel 1 de TODAS las razas, leidas contra un Humano el 2026-10-20 (commit 6296e85, PR #597),
 * y las de Cielonato el 2026-09-22 (commit d4be883: cuatro parejas Humano/Alta Orden y un guerrero Hijo del Viento, mismo
 * desplazamiento). Procedencia `community`: lectura de un tercero, sin capturas publicadas. Son anteriores a las raciales
 * multiplicativas (no aparecen en la hoja de nivel 1). Ninguna raza cambia el espiritu.
 *
 * Sustituyen a las diferencias de Classic Era, mayores (Tauren +5/-5/+2/-5, Trol +1/+2/+1/-4...), que Forever dejo de usar.
 * Se supone que no cambian con el nivel (como en Classic); solo se han leido a nivel 1.
 */
export const RACE_OFFSETS_SOURCE = {
  name: "wowsims/forever",
  url: "https://github.com/wowsims/forever",
  commit: "6296e8546d9c5a0b4670d18476bfd690eba9c687",
  date: "2026-10-20",
  license: "MIT (Copyright (c) 2022 wowsims team)",
} as const;

export type Offset5 = [number, number, number, number, number];

/** ChrRaces.ID -> desplazamiento. Humano (1) es la referencia: cero. */
export const FOREVER_RACE_OFFSETS: Record<number, Offset5> = {
  1: [0, 0, 0, 0, 0], // Humano
  2: [3, -3, 1, -1, 0], // Orco
  3: [2, -2, 1, -1, 0], // Enano
  4: [-2, 2, 0, 0, 0], // Elfo de la noche
  5: [2, -1, 1, -2, 0], // No-muerto
  6: [2, -2, 2, -2, 0], // Tauren
  7: [-3, 1, -1, 3, 0], // Gnomo
  8: [1, 2, 0, -3, 0], // Trol
  95: [-1, 1, -1, 1, 0], // Cielonato (Alianza, Alta Orden)
  96: [-1, 1, -1, 1, 0], // Cielonato (Horda, Hijo del Viento)
};
