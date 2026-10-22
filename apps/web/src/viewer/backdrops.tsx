// Fondos del probador: los escenarios de la pantalla de selección de personaje del propio cliente (uno por raza),
// renderizados a imagen con tools/model/render-scenes.mjs. Los dos Cielonato comparten el suyo.
import { MODELS_BASE } from "./config";

export interface Backdrop {
  /** Id en el enlace (`b<id>`): el de la primera raza a la que acompaña. */
  id: number;
  /** Lugar que enseña (clave de traducción). */
  name: string;
  /** Fichero en `scene/` (sin extensión). */
  file: string;
  /** Razas (ChrRaces.ID) a las que acompaña por defecto. */
  races: number[];
}

export const BACKDROPS: Backdrop[] = [
  { id: 1, name: "Ventormenta", file: "human", races: [1] },
  { id: 3, name: "Forjaz", file: "dwarf", races: [3] },
  { id: 4, name: "Darnassus", file: "nightelf", races: [4] },
  { id: 7, name: "Gnomeregan", file: "gnome", races: [7] },
  { id: 95, name: "Cielonato", file: "skyborne", races: [95, 96] },
  { id: 2, name: "Durotar", file: "orc", races: [2] },
  { id: 5, name: "Tirisfal", file: "scourge", races: [5] },
  { id: 6, name: "Mulgore", file: "tauren", races: [6] },
  { id: 8, name: "Islas del Eco", file: "troll", races: [8] },
];

/** Id del fondo que acompaña por defecto a una raza (0 si no hay). */
export const backdropOfRace = (race: number): number => BACKDROPS.find((b) => b.races.includes(race))?.id ?? 0;

/** Imagen de fondo de una escena (a todo el recuadro), o nada si el id no existe (0 = liso). */
export function BackdropArt({ id }: { id: number }) {
  const b = BACKDROPS.find((x) => x.id === id);
  if (!b) return null;
  return <img className="avatar-backdrop" src={`${MODELS_BASE}/scene/${b.file}.webp`} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}
