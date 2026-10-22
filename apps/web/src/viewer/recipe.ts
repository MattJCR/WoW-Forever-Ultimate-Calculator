// Receta de personaje (public/models/<build>/m<ChrModel>/character.json): lo que genera tools/model/build-character.mjs.

export interface RecipeElement {
  /** Elección de otra opción de la que depende este elemento (0 = siempre). Ej.: la cara depende del color de piel. */
  related: number;
  geoset?: number;
  hair?: boolean;
  material?: { target: number; file: number };
  skinned?: { file: number; type: number; id: number };
  boneSet?: number;
}

export interface RecipeChoice {
  id: number;
  name: string;
  req: number;
  /** Solo la usan los PNJ: el juego no la ofrece a los jugadores. */
  npc?: boolean;
  swatch: number;
  elements: RecipeElement[];
}

export interface RecipeOption {
  id: number;
  name: string;
  category: number;
  categoryName: string;
  choices: RecipeChoice[];
}

export interface RecipeLayer {
  textureType: number;
  layer: number;
  blend: number;
  /** Máscara de secciones del atlas donde se pinta (-1 = todo el atlas). */
  sectionMask: number;
  target: number;
}

export interface BatchInfo {
  texType: number;
  texFile: number;
  blend: number;
  shader: number;
  layer: number;
  priority: number;
  textureCount: number;
}

export interface GeosetInfo {
  geoset: number;
  vertices: number;
  triangles: number;
  batches: BatchInfo[];
}

export interface Recipe {
  chrModelId: number;
  sex: number;
  layout: { width: number; height: number; sections: { type: number; x: number; y: number; w: number; h: number }[] };
  materials: { type: number; width: number; height: number }[];
  layers: RecipeLayer[];
  options: RecipeOption[];
  geosets: GeosetInfo[];
}

/** Elección de cada opción de personalización: opción → elección. */
export type Selection = Record<number, number>;

/** Elección por defecto de una opción: la primera que ofrece el juego a los jugadores (en las de color, con color). */
export function defaultChoice(o: RecipeOption): RecipeChoice | undefined {
  // Un peinado «rapado» (sin pelo) solo si no hay otro: así el personaje sale completo
  const bald = (c: RecipeChoice) => c.elements.some((e) => e.hair && e.geoset === 0) && !c.elements.some((e) => e.hair && (e.geoset ?? 0) > 0);
  const withHair = o.choices.filter((c) => !c.npc && !bald(c));
  const players = o.choices.some((c) => c.elements.some((e) => e.hair)) && withHair.length ? withHair : o.choices.filter((c) => !c.npc);
  const colored = players.filter((c) => c.swatch !== 0);
  // La primera muestra de piel del Tauren es casi negra (azul-negro bajo la luz del visor): si la primera es muy oscura se parte de un marrón medio
  const first = colored[0];
  if (first && /piel/i.test(o.name) && luminance(first.swatch) < DARK_SKIN) return colored.reduce((best, c) => (Math.abs(luminance(c.swatch) - MID_SKIN) < Math.abs(luminance(best.swatch) - MID_SKIN) ? c : best), first);
  return (colored.length ? colored : players.length ? players : o.choices)[0];
}

const DARK_SKIN = 80;
const MID_SKIN = 105;
/** Luminosidad (0-255) de una muestra ARGB del cliente. */
export const luminance = (argb: number): number => 0.2126 * ((argb >>> 16) & 0xff) + 0.7152 * ((argb >>> 8) & 0xff) + 0.0722 * (argb & 0xff);

export function defaultSelection(recipe: Recipe): Selection {
  const sel: Selection = {};
  for (const o of recipe.options) sel[o.id] = defaultChoice(o)?.id ?? 0;
  return sel;
}

export interface Resolved {
  /** Subgeometrías que pide la personalización (piel, pelo, cara, orejas…). */
  geosets: Set<number>;
  /** Textura (FileDataID) de cada destino de material, ya elegida según las demás opciones. */
  targets: Map<number, number>;
}

export function resolveSelection(recipe: Recipe, sel: Selection): Resolved {
  const chosen = new Set(Object.values(sel));
  const geosets = new Set<number>();
  const targets = new Map<number, number>();
  for (const o of recipe.options) {
    const c = o.choices.find((x) => x.id === sel[o.id]) ?? o.choices[0];
    for (const e of c?.elements ?? []) {
      if (e.related !== 0 && !chosen.has(e.related)) continue;
      if (e.geoset !== undefined) geosets.add(e.geoset);
      // Las mallas de las colecciones (cuernos, plumas, cejas…) se identifican con fichero * 10000 + subgeometría.
      if (e.skinned) geosets.add(e.skinned.file * 10000 + e.skinned.type * 100 + e.skinned.id);
      if (e.material && e.material.file) targets.set(e.material.target, e.material.file);
    }
  }
  return { geosets, targets };
}

/** Zona de personalización en la que se agrupa una opción (pestañas del probador). */
export type OptionGroup = "body" | "face" | "hair";
export const OPTION_GROUPS: OptionGroup[] = ["body", "face", "hair"];

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** El cliente solo da el nombre de la opción (en español): se reparte por palabras clave; lo que no encaja va a «Cara». */
export function groupOfOption(o: Pick<RecipeOption, "name">): OptionGroup {
  const n = norm(o.name);
  if (/barba|bigote|vello|peinado|crin|(^| )pelo/.test(n)) return "hair";
  if (/facial|cara|rostro|ojo|ceja|orej|cuerno|nariz|colmillo|pendiente|joya|maquillaje|mandibula|rasgos|piercing/.test(n)) return "face";
  if (/piel|tatuaje|marcas|pluma|venda|rona/.test(n)) return "body";
  return "face";
}

/** Color (ARGB del cliente) como CSS; null si la elección no trae muestra. */
export function swatchCss(argb: number): string | null {
  if (!argb) return null;
  const a = (argb >>> 24) & 0xff, r = (argb >>> 16) & 0xff, g = (argb >>> 8) & 0xff, b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a === 0 ? 1 : +(a / 255).toFixed(3)})`;
}

/** Una opción es «de color» si casi todas sus elecciones traen muestra de color. */
export const isColorOption = (choices: Pick<RecipeChoice, "swatch">[]): boolean => choices.length > 1 && choices.filter((c) => c.swatch !== 0).length >= Math.ceil(choices.length * 0.8);

/** Elección anterior (dir -1) o siguiente (dir +1) dentro de la lista mostrada, dando la vuelta. */
export function stepChoice(shown: Pick<RecipeChoice, "id">[], currentId: number, dir: 1 | -1): number {
  if (shown.length === 0) return currentId;
  const i = shown.findIndex((c) => c.id === currentId);
  const next = i < 0 ? 0 : (i + dir + shown.length) % shown.length;
  return shown[next]!.id;
}
