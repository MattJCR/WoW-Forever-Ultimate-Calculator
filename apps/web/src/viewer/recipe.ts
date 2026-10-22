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
  // Igual con las cejas hechas de malla (elfos, gnomos): «Afeitadas»/«Ninguna» (subgrupo 0) solo si no hay otra
  const noBrows = (c: RecipeChoice) => c.elements.length > 0 && c.elements.every((e) => e.geoset !== undefined && e.geoset % 100 === 0);
  const withBrows = o.choices.filter((c) => !c.npc && !noBrows(c));
  const players = o.choices.some((c) => c.elements.some((e) => e.hair)) && withHair.length ? withHair
    : /ceja/i.test(o.name) && withBrows.length ? withBrows : o.choices.filter((c) => !c.npc);
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
  const info = new Map<number, { option: number; swatch: number }>();
  for (const o of recipe.options) for (const c of o.choices) info.set(c.id, { option: o.id, swatch: c.swatch });
  for (const o of recipe.options) {
    const c = o.choices.find((x) => x.id === sel[o.id]) ?? o.choices[0];
    const painted = new Set<number>();
    for (const e of c?.elements ?? []) {
      if (e.related !== 0 && !chosen.has(e.related)) continue;
      if (e.geoset !== undefined) geosets.add(e.geoset);
      // Las mallas de las colecciones (cuernos, plumas, cejas…) se identifican con fichero * 10000 + subgeometría.
      if (e.skinned) geosets.add(e.skinned.file * 10000 + e.skinned.type * 100 + e.skinned.id);
      if (e.material && e.material.file) { targets.set(e.material.target, e.material.file); painted.add(e.material.target); }
    }
    // Una cara o un pelo sin textura para el color elegido (el cliente no ofrece esa pareja, pero la web deja elegirla y «Aleatorio» la saca):
    // se usa la del color más parecido en vez de dejarla sin pintar (sin boca, sin orejas, sin párpados…)
    for (const e of c?.elements ?? []) {
      const m = e.material;
      if (!m || !m.file || e.related === 0 || painted.has(m.target)) continue;
      const options = (c?.elements ?? []).filter((x) => x.related !== 0 && x.material?.file && x.material.target === m.target);
      const parent = info.get(e.related)?.option;
      const wanted = parent === undefined ? undefined : info.get(sel[parent] ?? -1)?.swatch;
      if (wanted === undefined) continue;
      const best = options.reduce((p, q) => (colorDistance(info.get(q.related)?.swatch ?? 0, wanted) < colorDistance(info.get(p.related)?.swatch ?? 0, wanted) ? q : p));
      targets.set(m.target, best.material!.file);
      painted.add(m.target);
    }
  }
  return { geosets, targets };
}

/** Distancia entre dos colores ARGB (suma de diferencias por canal). */
function colorDistance(a: number, b: number): number {
  return Math.abs(((a >>> 16) & 0xff) - ((b >>> 16) & 0xff)) + Math.abs(((a >>> 8) & 0xff) - ((b >>> 8) & 0xff)) + Math.abs((a & 0xff) - (b & 0xff));
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
