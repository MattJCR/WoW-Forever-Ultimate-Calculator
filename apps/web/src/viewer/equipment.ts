// De qué objetos lleva el personaje a lo que se ve: subgeometrías (mangas, botas, guantes, capa…), texturas
// sobre el cuerpo y modelos anclados (casco, hombreras, armas). Los datos salen de appearance.json.
import type { Overlay } from "./compose";
import type { FxIndex } from "./fx-index";

export interface AppearanceData {
  build: string;
  items: Record<string, number>;
  display: Record<string, DisplayRecord>;
  tex: Record<string, Record<string, number>>;
  model: Record<string, { f: number; g: number; r: number; p: number }[]>;
  helm: Record<string, Record<string, number[]>>;
  /** Objeto -> tipo de envaine (Item.SheatheType). */
  sheathe?: Record<string, number>;
}

export interface DisplayRecord {
  /** GeosetGroup[0..5] */
  g?: number[];
  /** Vis de casco [varón, mujer] */
  h?: [number, number];
  /** [sección del atlas, recurso de textura] */
  s?: [number, number][];
  /** [recurso de modelo, recurso de textura, tipo] */
  m?: [number, number, number][];
  /** [índice de modelo, tipo de textura, recurso] */
  t?: [number, number, number][];
}

export interface Equipped {
  /** Ranura de la hoja de equipo (mainHand, offHand, ranged…). */
  slot: string;
  inventoryType: number;
  classId: number;
  subclassId: number;
  itemId: number;
  /** Encantamiento puesto (SpellItemEnchantment.ID): los de arma pueden llevar un efecto visual. */
  enchantId?: number | null;
}

/** Modelo de efecto que cuelga de un anclaje (0-4) del modelo del objeto: partículas (`p`), malla (`m`) o ambas. */
export interface EffectRef {
  attach: number;
  file: number;
  kind: string;
}

export interface AttachedModel {
  /** Punto de anclaje del personaje (att_<id>). */
  attachment: number;
  file: number;
  /** Textura (FileDataID) por tipo de textura del modelo; la clave -1 vale para cualquiera. */
  textures: Record<number, number>;
  slot: number;
  /** Se pinta reflejado (la hombrera derecha cuando el objeto solo trae la izquierda). */
  mirror?: boolean;
  /** Efectos que lleva el objeto (brillo propio y encantamiento) en los anclajes del arma. */
  fx?: EffectRef[];
  /** El modelo trae emisores de partículas propios (llamas, chispas…). */
  own?: boolean;
}

export interface EquipResult {
  geosets: Set<number>;
  hiddenGroups: Set<number>;
  overlays: Overlay[];
  /** Subgeometrías que oculta el casco (grupo 0 = peinado, 1-3 = vello facial). */
  helmetHides: number[];
  models: AttachedModel[];
  /** Textura del objeto (capa) por tipo de textura de la malla (2 = capa). */
  objectTextures: Record<number, number>;
  /** Animación acorde con las armas que lleva. */
  pose: string;
  /** Objetos que el cliente no deja dibujar: sin apariencia o con un modelo sin fichero asociado. */
  missing: number[];
}

/** Tipos de objeto que se ven en el personaje (cuello, anillos y abalorios no). */
const DRAWN = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26]);

/** Grupo de subgeometría del personaje que mueve cada GeosetGroup[i] según la ranura. */
const GROUPS: Record<number, number[]> = {
  4: [8],
  5: [8, 10, 13],
  20: [8, 10, 13],
  7: [9, 11, 13],
  8: [5, 20],
  10: [4],
  16: [15],
  19: [12],
};

/** Orden en que las ranuras deciden las subgeometrías (la última gana). */
const GEOSET_ORDER = [4, 7, 8, 10, 16, 19, 5, 20];

/** Orden en que se pinta cada ranura sobre el atlas (la de abajo primero). */
const PAINT_ORDER = [4, 7, 8, 5, 20, 10, 9, 6, 19];


/** Puntos de anclaje de las armas envainadas: 28 escudo a la espalda, 30/31 arma grande a la espalda, 32/33 arma a la cadera izquierda/derecha. */
const SHEATH = { shield: 28, backLeft: 30, backRight: 31, hipLeft: 32, hipRight: 33 };

export interface EquipOptions {
  /** Armas envainadas en vez de en la mano (el personaje queda en reposo). */
  sheathed?: boolean;
  /** Efectos visuales (fx/index.json); sin él no se añade ninguno. */
  fx?: FxIndex | null;
}

/** Modelos de efecto de un arma: el brillo de su apariencia y el del encantamiento, cada uno en los anclajes 0-4 del arma. */
function effectsOf(fx: FxIndex | null | undefined, displayId: number | undefined, enchantId: number | null | undefined): EffectRef[] {
  if (!fx) return [];
  const out: EffectRef[] = [];
  const visuals = [displayId === undefined ? undefined : fx.display[String(displayId)], enchantId ? fx.enchant[String(enchantId)] : undefined];
  for (const v of visuals) {
    const files = v === undefined ? undefined : fx.visuals[String(v)];
    files?.forEach((file, attach) => {
      const kind = file ? fx.effects[String(file)] : undefined;
      if (kind) out.push({ attach, file, kind });
    });
  }
  return out;
}

export function resolveEquipment(
  ap: AppearanceData, race: number, sex: number, equipped: Equipped[], textureUrl: (f: number) => string, opts: EquipOptions = {},
): EquipResult {
  const res: EquipResult = { geosets: new Set(), hiddenGroups: new Set(), overlays: [], helmetHides: [], models: [], objectTextures: {}, pose: "Stand", missing: [] };
  const bySlot = new Map<number, DisplayRecord>();
  const slotItem = new Map<number, Equipped>();
  for (const e of equipped) {
    const d = ap.display[String(ap.items[String(e.itemId)] ?? 0)];
    if (!d) {
      if (DRAWN.has(e.inventoryType)) res.missing.push(e.itemId);
      continue;
    }
    bySlot.set(e.inventoryType, d);
    slotItem.set(e.inventoryType, e);
  }
  const tex = (resId: number): number | undefined => {
    const t = ap.tex[String(resId)];
    return t ? (t[sex] ?? t[3] ?? Object.values(t)[0]) : undefined;
  };

  // Cada grupo de subgeometría lo decide la última ranura que lo toca, en orden de capas (la camisa debajo, el pecho encima).
  const chosen = new Map<number, number | null>();
  for (const slot of GEOSET_ORDER) {
    const d = bySlot.get(slot);
    const groups = GROUPS[slot];
    if (!d || !groups) continue;
    groups.forEach((grp, i) => {
      const v = d.g?.[i] ?? 0;
      // v = -1: el objeto oculta el grupo; si no, variante 01 + v (sin GeosetGroup, la 01: cuerpo desnudo).
      chosen.set(grp, v >= 0 ? grp * 100 + 1 + v : null);
    });
  }
  // Una túnica larga (vestido) tapa las piernas.
  if (bySlot.has(20)) { chosen.set(9, null); chosen.set(11, null); }
  for (const [grp, geoset] of chosen) {
    res.hiddenGroups.add(grp);
    if (geoset !== null) res.geosets.add(geoset);
  }

  for (const slot of PAINT_ORDER) {
    const d = bySlot.get(slot);
    for (const [section, resId] of d?.s ?? []) {
      const f = tex(resId);
      if (f) res.overlays.push({ section, url: textureUrl(f) });
    }
  }

  const helm = bySlot.get(1);
  if (helm?.h) {
    const vis = helm.h[sex === 1 ? 1 : 0] || helm.h[0];
    res.helmetHides = ap.helm[String(vis)]?.[String(race)] ?? [];
  }

  const addModels = (slot: number, d: DisplayRecord, attach: (idx: number, pos: number) => number | null) => {
    (d.m ?? []).forEach(([modelRes, matRes], idx) => {
      if (!modelRes) return;
      const variants = ap.model[String(modelRes)] ?? [];
      if (!variants.length) {
        const id = slotItem.get(slot)?.itemId;
        if (id !== undefined && !res.missing.includes(id)) res.missing.push(id);
      }
      const bySex = variants.filter((v) => v.g === sex || v.g === 3 || v.g === 2);
      const mine = bySex.filter((v) => v.r === 0 || v.r === race);
      // Una raza sin modelo propio (Cielonato) usa el de la primera raza que lo tenga para su sexo.
      const firstRace = bySex.find((v) => v.r !== 0)?.r;
      const pick = mine.length ? mine : bySex.filter((v) => v.r === firstRace || v.r === 0).length ? bySex.filter((v) => v.r === firstRace || v.r === 0) : variants;
      const files = pick.some((v) => v.p >= 0) ? pick : pick.slice(0, 1);
      for (const v of files) {
        const att = attach(idx, v.p);
        if (att === null) continue;
        const textures: Record<number, number> = {};
        const f = matRes ? tex(matRes) : undefined;
        if (f) textures[-1] = f;
        for (const [mi, type, rr] of d.t ?? []) if (mi === idx) { const tf = tex(rr); if (tf) textures[type] = tf; }
        res.models.push({ attachment: att, file: v.f, textures, slot });
      }
    });
  };

  for (const slot of [1, 3]) {
    const d = bySlot.get(slot);
    if (!d) continue;
    if (slot === 1) addModels(slot, d, () => 11);
    else {
      addModels(slot, d, (idx, pos) => (pos === 1 ? 5 : pos === 0 ? 6 : idx === 0 ? 6 : 5));
      // Un solo modelo de hombrera: la otra se obtiene reflejándolo.
      const shoulders = res.models.filter((m) => m.slot === 3);
      if (shoulders.length === 1 && shoulders[0]) res.models.push({ ...shoulders[0], attachment: 5, mirror: true });
    }
  }
  // Armas: cada hueco de la hoja las cuelga de su mano. Una mano izquierda con arma va a la mano izquierda;
  // un escudo, a su anclaje del antebrazo; el arco, a la mano izquierda; varitas, armas de fuego y arrojadizas, a la derecha.
  let twoHanded = false, bow = false, gun = false, oneHanded = false;
  for (const e of equipped) {
    const d = ap.display[String(ap.items[String(e.itemId)] ?? 0)];
    if (!d) continue;
    let att: number | null = null;
    if (e.slot === "mainHand") { att = 1; if (e.inventoryType === 17) twoHanded = true; else oneHanded = true; }
    else if (e.slot === "offHand") { att = e.inventoryType === 14 ? 0 : 2; oneHanded = true; }
    else if (e.slot === "ranged") {
      if (e.inventoryType === 15) { att = 2; bow = true; }
      else { att = 1; if (e.classId === 2 && e.subclassId === 3) gun = true; }
    }
    // Solo las armas (att ya decidido arriba) van a su funda; el casco, las hombreras y el resto ya se pintaron en su sitio
    if (opts.sheathed && att !== null) {
      const sh = ap.sheathe?.[String(e.itemId)] ?? 0;
      if (e.inventoryType === 14) att = SHEATH.shield;
      else if (e.slot === "offHand") att = SHEATH.hipLeft;
      else if (e.inventoryType === 17 || sh === 1 || sh === 2 || e.inventoryType === 15) att = SHEATH.backRight;
      else att = SHEATH.hipRight;
    }
    if (att !== null) {
      const before = res.models.length;
      addModels(e.inventoryType, d, () => att);
      const fx = effectsOf(opts.fx, ap.items[String(e.itemId)], e.classId === 2 ? e.enchantId : null);
      if (fx.length) for (let k = before; k < res.models.length; k++) res.models[k]!.fx = fx.map((x) => ({ ...x }));
    }
  }
  const own = new Set(opts.fx?.own ?? []);
  if (own.size) for (const m of res.models) if (own.has(m.file)) m.own = true;
  if (opts.sheathed) { /* en reposo */ }
  else if (twoHanded) res.pose = "Ready2H";
  else if (bow) res.pose = "ReadyBow";
  else if (gun && !oneHanded) res.pose = "ReadyRifle";
  else if (oneHanded) res.pose = "Ready1H";

  const cloak = bySlot.get(16);
  if (cloak?.m) for (const [, matRes] of cloak.m) { const f = matRes ? tex(matRes) : undefined; if (f) res.objectTextures[2] = f; }
  return res;
}
