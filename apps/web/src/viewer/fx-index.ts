// Efectos visuales de objetos (brillos de arma, encantamientos y partículas propias): qué modelo de efecto lleva cada cosa.
// Los genera tools/model/build-effects.mjs en fx/index.json y fx/<FileDataID>.json.

/** Emisor de partículas de un modelo (ejes de glTF, posición ya sumada al pivote del hueso). Pistas de vida: [tiempo 0-1, valores…]. */
export interface EmitterData {
  pos: [number, number, number];
  /** FileDataID de la textura (0 = ninguna). */
  tex: number;
  /** Mezcla de M2: 4 y 7 aditiva, el resto con transparencia. */
  blend: number;
  /** 1 = plano, 2 = esfera. */
  shape: number;
  rows: number;
  cols: number;
  speed: number;
  speedVar: number;
  vertical: number;
  horizontal: number;
  gravity: number;
  life: number;
  lifeVar: number;
  rate: number;
  length: number;
  width: number;
  color: [number, number, number, number][];
  alpha: [number, number][];
  scale: [number, number, number][];
  scaleVar: [number, number];
  head: [number, number][];
  spin: number;
  spinVar: number;
  baseSpin: number;
  baseSpinVar: number;
  drag: number;
  flags: number;
}

export interface FxIndex {
  build: string;
  /** ItemVisuals.ID -> modelos de efecto de los anclajes 0-4 del arma (0 = ninguno). */
  visuals: Record<string, number[]>;
  /** SpellItemEnchantment.ID -> ItemVisuals.ID. */
  enchant: Record<string, number>;
  /** ItemDisplayInfo.ID -> ItemVisuals.ID (brillo propio del arma). */
  display: Record<string, number>;
  /** Modelo de efecto -> `p` (partículas), `m` (malla) o ambas. */
  effects: Record<string, string>;
  /** Modelos de objeto con emisores propios. */
  own: number[];
}

let cached: Promise<FxIndex | null> | null = null;

/** fx/index.json: se descarga una vez; si la carpeta no existe (otro alojamiento sin efectos) devuelve null y no se dibujan. */
export function loadFxIndex(base: string): Promise<FxIndex | null> {
  cached ??= fetch(`${base}/fx/index.json`).then((r) => (r.ok ? (r.json() as Promise<FxIndex>) : null), () => null);
  return cached;
}

const emitters = new Map<string, Promise<EmitterData[] | null>>();

/** Emisores de un modelo (una descarga por fichero). */
export function loadEmitters(base: string, file: number): Promise<EmitterData[] | null> {
  const url = `${base}/fx/${file}.json`;
  let p = emitters.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? (r.json() as Promise<EmitterData[]>) : null), () => null);
    emitters.set(url, p);
  }
  return p;
}
