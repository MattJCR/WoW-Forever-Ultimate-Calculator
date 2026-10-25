import type { GearSlot } from "@wfuc/engine";

/** Siluetas propias (trazo simple) de lo que va en cada ranura; se ven grabadas en el hueco cuando no hay pieza. */
const SLOT_PATH: Record<GearSlot, string> = {
  head: "M5 14a7 7 0 0 1 14 0v5h-4v-3H9v3H5z M9 12h6",
  neck: "M6 3c0 7 2.5 10 6 10s6-3 6-10 M12 13l3 3.5-3 4.5-3-4.5z",
  shoulder: "M3 16c0-6 4-10 9-10s9 4 9 10H3z M8 16v3 M16 16v3 M12 6v10",
  back: "M8 3h8l4 17-8-3-8 3z M12 3v14",
  chest: "M7 3L3 7l2 4 2-1v11h10V10l2 1 2-4-4-4c-1 2-3 3-5 3S8 5 7 3z",
  shirt: "M8 3c1 2 2 3 4 3s3-1 4-3l5 3-2 5-3-1v11H8V10l-3 1-2-5z",
  tabard: "M7 3h10v12l-5 6-5-6z M12 7v8 M9 10h6",
  wrist: "M4 8h16v8H4z M8 8v8 M16 8v8 M12 11v2",
  hands: "M7 21v-5l-3-4 1.5-1.5L8 13V5.5h2V12V4h2v8V5h2v8V7h2v8l-2 6z",
  waist: "M2 9h20v6H2z M9 7h6v10H9z M12 10v4",
  legs: "M6 3h12l1 18h-5l-2-10-2 10H5z M6 8h12",
  feet: "M9 3h6v9l6 4v5H4v-6l5-3z M9 8h6",
  finger1: "M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M9.5 6.5L12 3l2.5 3.5-2.5 2z",
  finger2: "M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M9.5 6.5L12 3l2.5 3.5-2.5 2z",
  trinket1: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8l1.5 3.5L17 12l-3.5 1.5L12 17l-1.5-3.5L7 12l3.5-.5z",
  trinket2: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 8l1.5 3.5L17 12l-3.5 1.5L12 17l-1.5-3.5L7 12l3.5-.5z",
  mainHand: "M19 4h1v5L10 19l-5-5L15 4z M5 14l-2 2 M10 19l-2 2 M3 21l3-3",
  offHand: "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z M12 3v18",
  ranged: "M5 3c10 1 16 7 16 16 M5 3l16 16 M8 16L20 4 M20 4h-4 M20 4v4",
};

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Silueta de la ranura (decorativa: el nombre de la ranura va en texto al lado). */
export function SlotGlyph({ slot }: { slot: GearSlot }) {
  return (
    <svg className="slot-glyph" viewBox="0 0 24 24" strokeWidth={1.6} aria-hidden="true" {...stroke}>
      <path d={SLOT_PATH[slot]} />
    </svg>
  );
}

const TOOL_PATH = {
  sets: "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5",
  customize: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  done: "M5 12l5 5 9-10",
  undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
  sheathe: "M19 4h1v5L10 19l-5-5L15 4z M5 14l-2 2 M10 19l-2 2 M3 21l3-3",
  pause: "M8 5v14 M16 5v14",
  effects: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  play: "M7 5l12 7-12 7z",
  capture: "M4 8h3l2-3h6l2 3h3v11H4z M12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  fullscreen: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
} as const;

/** Icono de la barra de herramientas del probador (decorativo: el botón lleva su nombre). */
export function ToolGlyph({ name }: { name: keyof typeof TOOL_PATH }) {
  return (
    <svg className="tool-glyph" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true" {...stroke}>
      <path d={TOOL_PATH[name]} />
    </svg>
  );
}
