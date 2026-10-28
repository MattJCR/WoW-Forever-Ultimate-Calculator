import type { GearSlot } from "@wfuc/engine";

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Icono de la ranura vacía: la textura de la ventana de personaje del juego (apps/web/public/slots, de tools/extract/fetch-slot-icons.mjs). */
export function SlotGlyph({ slot }: { slot: GearSlot }) {
  return <img className="slot-glyph" src={`${import.meta.env.BASE_URL}slots/${slot}.png`} alt="" width={64} height={64} draggable={false} />;
}

const TOOL_PATH = {
  sets: "M12 3l9 5-9 5-9-5z M3 13l9 5 9-5",
  customize: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M9 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  done: "M5 12l5 5 9-10",
  undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
  sheathe: "M19 4h1v5L10 19l-5-5L15 4z M5 14l-2 2 M10 19l-2 2 M3 21l3-3",
  sheatheRanged: "M5 3c10 1 16 7 16 16 M5 3l16 16 M8 16L20 4 M20 4h-4 M20 4v4",
  pause: "M8 5v14 M16 5v14",
  effects: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  play: "M7 5l12 7-12 7z",
  capture: "M4 8h3l2-3h6l2 3h3v11H4z M12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  fullscreen: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  equipped: "M5 5h14 M5 10h14 M5 15h14 M5 20h9",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  hide: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z M4 4l16 16",
  show: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
} as const;

/** Icono de la barra de herramientas del probador (decorativo: el botón lleva su nombre). */
export function ToolGlyph({ name }: { name: keyof typeof TOOL_PATH }) {
  return (
    <svg className="tool-glyph" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true" {...stroke}>
      <path d={TOOL_PATH[name]} />
    </svg>
  );
}
