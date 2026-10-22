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
  const players = o.choices.filter((c) => !c.npc);
  const colored = players.filter((c) => c.swatch !== 0);
  return (colored.length ? colored : players.length ? players : o.choices)[0];
}

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
