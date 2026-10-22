import { activeGearEffects, classifyGearAuras } from "./gear-effects.js";
import type { CombatRatings, Enchant, Enchants, EquipRules, Item, ItemEffectRef, ItemLimitCategoryDef, Items, Proficiency, RandomSuffix, RandomSuffixes } from "@wfuc/schema";

/**
 * Equipo: ranuras, reglas para equipar y suma de estadisticas. TS puro, sin UI.
 *
 * Procedencia: objetos, armadura y competencias de clase salen del cliente (`client-db2`); encantamientos, sufijos aleatorios y
 * puntuaciones de combate, de la comunidad (`community`). El filtro de encantamientos por tipo de arma y las reliquias son
 * nuestros (`assumption`). Los bonos de conjunto y los efectos de objeto se muestran como texto: no se cuantifican.
 */

export const GEAR_SLOTS = [
  "head", "neck", "shoulder", "back", "chest", "shirt", "tabard", "wrist", "hands", "waist", "legs", "feet",
  "finger1", "finger2", "trinket1", "trinket2", "mainHand", "offHand", "ranged",
] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

export const SLOT_LABEL: Record<GearSlot, string> = {
  head: "Cabeza", neck: "Cuello", shoulder: "Hombros", back: "Espalda", chest: "Pecho", shirt: "Camisa", tabard: "Tabardo",
  wrist: "Muñecas", hands: "Manos", waist: "Cintura", legs: "Piernas", feet: "Pies", finger1: "Anillo 1", finger2: "Anillo 2",
  trinket1: "Abalorio 1", trinket2: "Abalorio 2", mainHand: "Mano derecha", offHand: "Mano izquierda", ranged: "Distancia / reliquia",
};

/** Camisa y tabardo son cosmeticos: solo suman lo que diga el cliente (normalmente nada). */
export const COSMETIC_SLOTS: readonly GearSlot[] = ["shirt", "tabard"];

/** Ranuras en las que cabe cada InventoryType del cliente (18 bolsa y 24 municion no son equipo). */
const SLOTS_BY_INVENTORY_TYPE: Record<number, GearSlot[]> = {
  1: ["head"], 2: ["neck"], 3: ["shoulder"], 4: ["shirt"], 5: ["chest"], 20: ["chest"], 6: ["waist"], 7: ["legs"], 8: ["feet"],
  9: ["wrist"], 10: ["hands"], 11: ["finger1", "finger2"], 12: ["trinket1", "trinket2"], 13: ["mainHand", "offHand"], 14: ["offHand"],
  15: ["ranged"], 16: ["back"], 17: ["mainHand"], 19: ["tabard"], 21: ["mainHand"], 22: ["offHand"], 23: ["offHand"],
  25: ["ranged"], 26: ["ranged"], 28: ["ranged"],
};
const TWO_HAND = 17;
const RELIC = 28;
const CLASS_ARMOR = 4;
const CLASS_WEAPON = 2;
const SUBCLASS_SHIELD = 6;

export const slotsForItem = (item: Pick<Item, "inventoryType">): GearSlot[] => SLOTS_BY_INVENTORY_TYPE[item.inventoryType] ?? [];

/** Lo que se lleva puesto en una ranura. Encantamiento = `Enchant.effectId`; sufijo = `RandomSuffix.id`. */
export interface EquippedItem {
  itemId: number;
  enchantId?: number | null;
  suffixId?: number | null;
}
export type GearSelection = Partial<Record<GearSlot, EquippedItem>>;

/** Quien lleva el equipo. `raceId` 0 (sin raza elegida) o > 31 (Cielonato: no cabe en la mascara de raza de 32 bits) = sin restriccion de raza. */
export interface GearContext {
  classId: number;
  raceId: number;
  level: number;
}

/** Datos de equipo indexados por id (se construye una vez con `indexGearData`). */
export interface GearData {
  items: Map<number, Item>;
  enchants: Map<number, Enchant>;
  suffixes: Map<number, RandomSuffix>;
  suffixSets: number[][];
  /** Categorias de limite por id (`Item.limitCategory`). */
  limitCategories: Map<number, ItemLimitCategoryDef>;
  sets: Items["sets"];
  /** Equipables que el cliente no trae con datos (llegan por hotfix al verlos en el juego): no se pueden ofrecer. */
  unavailable: Items["unavailable"];
  rules: EquipRules;
}

export function indexGearData(input: { items: Items; rules: EquipRules; enchants?: Enchants | null; suffixes?: RandomSuffixes | null }): GearData {
  return {
    items: new Map(input.items.items.map((i) => [i.id, i])),
    enchants: new Map((input.enchants?.enchants ?? []).map((e) => [e.effectId, e])),
    suffixes: new Map((input.suffixes?.suffixes ?? []).map((s) => [s.id, s])),
    suffixSets: input.items.suffixSets,
    limitCategories: new Map(input.items.limitCategories.map((c) => [c.id, c])),
    sets: input.items.sets,
    unavailable: input.items.unavailable,
    rules: input.rules,
  };
}

const classBit = (classId: number): number => 1 << (classId - 1);

const ARMOR_NAME: Record<number, string> = { 1: "tela", 2: "cuero", 3: "malla", 4: "placas", 6: "escudos" };
const WEAPON_NAME: Record<number, string> = {
  0: "hachas de una mano", 1: "hachas de dos manos", 2: "arcos", 3: "armas de fuego", 4: "mazas de una mano", 5: "mazas de dos manos",
  6: "armas de asta", 7: "espadas de una mano", 8: "espadas de dos manos", 10: "bastones", 13: "armas de puño", 15: "dagas",
  16: "armas arrojadizas", 18: "ballestas", 19: "varitas",
};
const RELIC_NAME: Record<number, string> = { 7: "libros", 8: "ídolos", 9: "tótems" };

/** Tipo de objeto en plural y en español («tela», «espadas de una mano»…) para filtrar la lista; null si no es armadura ni arma con tipo. */
export function itemTypeName(item: Pick<Item, "classId" | "subclassId">): string | null {
  if (item.classId === CLASS_ARMOR) return ARMOR_NAME[item.subclassId] ?? null;
  if (item.classId === CLASS_WEAPON) return WEAPON_NAME[item.subclassId] ?? null;
  return null;
}

/** Competencia: ok si alguna fila incluye la clase y el nivel alcanza; `minLevel` = el menor nivel al que la clase la tiene (null = nunca). */
export function proficiency(list: Proficiency[] | undefined, classId: number, level: number): { ok: boolean; minLevel: number | null } {
  const mine = (list ?? []).filter((p) => (p.classMask & classBit(classId)) !== 0);
  if (mine.length === 0) return { ok: false, minLevel: null };
  const minLevel = Math.min(...mine.map((p) => p.minLevel));
  return { ok: mine.some((p) => p.minLevel <= level), minLevel };
}

const needs = (what: string, p: { minLevel: number | null }): string => (p.minLevel === null ? `Tu clase no puede usar ${what}` : `Tu clase solo puede usar ${what} desde el nivel ${p.minLevel}`);

export interface EquipCheck {
  ok: boolean;
  /** Motivos en español por los que no se puede equipar (vacio si ok). */
  reasons: string[];
}

/**
 * ¿Puede este personaje llevar el objeto en esa ranura? Comprueba, en este orden: objeto de prueba, ranura, clase, raza, nivel,
 * competencia de armadura / arma / doble empuñadura / reliquia, y con `equipped` los choques con lo ya puesto (arma a dos manos
 * frente a mano izquierda, objeto unico, categoria de limite: p. ej. un solo sello de batalla).
 */
export function canEquip(item: Item, slot: GearSlot, ctx: GearContext, data: Pick<GearData, "rules" | "items"> & Partial<Pick<GearData, "limitCategories">>, equipped: GearSelection = {}): EquipCheck {
  const reasons: string[] = [];
  const { rules } = data;
  if (item.placeholder) reasons.push("Objeto de prueba o retirado");
  if (!slotsForItem(item).includes(slot)) reasons.push(`No se lleva en la ranura «${SLOT_LABEL[slot]}»`);
  if (item.allowableClass !== -1 && item.allowableClass !== 0 && (item.allowableClass & classBit(ctx.classId)) === 0) reasons.push("Tu clase no puede usarlo");
  if (item.allowableRace !== -1 && item.allowableRace !== 0 && ctx.raceId > 0 && ctx.raceId <= 31 && (item.allowableRace & (1 << (ctx.raceId - 1))) === 0) reasons.push("Tu raza no puede usarlo");
  if (item.requiredLevel > ctx.level) reasons.push(`Necesita nivel ${item.requiredLevel}`);

  if (item.classId === CLASS_ARMOR && rules.armor[String(item.subclassId)]) {
    const p = proficiency(rules.armor[String(item.subclassId)], ctx.classId, ctx.level);
    if (!p.ok) reasons.push(needs(ARMOR_NAME[item.subclassId] ?? "esta armadura", p));
  }
  if (item.classId === CLASS_WEAPON && rules.weapons[String(item.subclassId)]) {
    const p = proficiency(rules.weapons[String(item.subclassId)], ctx.classId, ctx.level);
    if (!p.ok) reasons.push(needs(WEAPON_NAME[item.subclassId] ?? "esta arma", p));
  }
  if (item.classId === CLASS_WEAPON && slot === "offHand") {
    const p = proficiency(rules.dualWield, ctx.classId, ctx.level);
    if (!p.ok) reasons.push(needs("doble empuñadura", p));
  }
  if (item.inventoryType === RELIC) {
    const mask = rules.relics.byClassMask[String(item.subclassId)];
    if (mask !== undefined && (mask & classBit(ctx.classId)) === 0) reasons.push(`Solo la clase de ${RELIC_NAME[item.subclassId] ?? "esta reliquia"} puede usarla`);
  }

  // Choques con lo que ya se lleva
  if (slot === "offHand" && item.inventoryType !== TWO_HAND) {
    const main = equipped.mainHand ? data.items.get(equipped.mainHand.itemId) : undefined;
    if (main?.inventoryType === TWO_HAND) reasons.push("La mano derecha lleva un arma a dos manos");
  }
  if (slot === "mainHand" && item.inventoryType === TWO_HAND && equipped.offHand) reasons.push("Un arma a dos manos deja libre la mano izquierda");
  if (item.maxCount === 1 || item.uniqueEquipped) {
    const other = (Object.keys(equipped) as GearSlot[]).find((s) => s !== slot && equipped[s]?.itemId === item.id);
    if (other) reasons.push(`Objeto único${item.maxCount === 1 ? "" : "-equipado"}: ya lo llevas en «${SLOT_LABEL[other]}»`);
  }
  const category = item.limitCategory === null ? undefined : data.limitCategories?.get(item.limitCategory);
  if (category && category.quantity > 0) {
    const others = (Object.keys(equipped) as GearSlot[]).filter((s) => s !== slot && data.items.get(equipped[s]!.itemId)?.limitCategory === item.limitCategory);
    if (others.length >= category.quantity) {
      const label = category.name ? `«${category.name}»` : `n.º ${category.id}`;
      reasons.push(category.quantity === 1 ? `Límite de la categoría ${label}: solo puedes llevar uno (ya llevas «${SLOT_LABEL[others[0]!]}»)` : `Límite de la categoría ${label}: como mucho ${category.quantity} equipados`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Pone un objeto en una ranura aplicando las reglas de manos: un arma a dos manos vacia la mano izquierda y un objeto en la mano
 * izquierda vacia una mano derecha a dos manos. No valida (eso es `canEquip`). Devuelve una copia.
 */
export function equipItem(gear: GearSelection, slot: GearSlot, item: Item, items: Map<number, Item>, extra: Pick<EquippedItem, "enchantId" | "suffixId"> = {}): GearSelection {
  const next: GearSelection = { ...gear, [slot]: { itemId: item.id, enchantId: extra.enchantId ?? null, suffixId: extra.suffixId ?? null } };
  if (slot === "mainHand" && item.inventoryType === TWO_HAND) delete next.offHand;
  if (slot === "offHand" && gear.mainHand && items.get(gear.mainHand.itemId)?.inventoryType === TWO_HAND) delete next.mainHand;
  return next;
}

// ---------------------------------------------------------------------------------------------------------------------
// Encantamientos y sufijos aleatorios

/** ItemType de la comunidad por ranura (ver `Enchant.slotType`). Las dos manos comparten el tipo 13 (arma) y la distancia el 14. */
const ENCHANT_TYPE: Partial<Record<GearSlot, number>> = {
  head: 1, neck: 2, shoulder: 3, back: 4, chest: 5, wrist: 6, hands: 7, waist: 8, legs: 9, feet: 10, finger1: 11, finger2: 11,
  trinket1: 12, trinket2: 12, mainHand: 13, offHand: 13, ranged: 14,
};
const MELEE_WEAPON_INVENTORY = new Set([13, 17, 21, 22]);

/**
 * ¿Se puede poner este encantamiento al objeto de esa ranura? Primero el tipo de ranura (la comunidad); dentro del tipo «arma» el
 * cliente no distingue escudo, dos manos y una mano, asi que se separa por el nombre en ingles de la comunidad (`assumption`):
 * «Enchant 2H Weapon» solo a dos manos, «Shield» solo a escudos, «Off-Hand» solo a la mano izquierda, el resto a armas cuerpo a cuerpo.
 */
export function enchantFits(enchant: Enchant, slot: GearSlot, item: Item | undefined): boolean {
  const type = ENCHANT_TYPE[slot];
  if (type === undefined || (enchant.slotType !== type && !enchant.extraSlotTypes.includes(type))) return false;
  if (type !== 13 && type !== 14) return true;
  if (!item) return true;
  if (type === 14) return item.classId === CLASS_WEAPON && [2, 3, 18].includes(item.subclassId);
  const name = enchant.nameEn;
  const shield = item.classId === CLASS_ARMOR && item.subclassId === SUBCLASS_SHIELD;
  if (/Shield/i.test(name)) return shield;
  if (/Off-Hand/i.test(name)) return slot === "offHand" && !shield;
  if (/^Enchant 2H Weapon/i.test(name)) return item.inventoryType === TWO_HAND;
  return item.classId === CLASS_WEAPON && MELEE_WEAPON_INVENTORY.has(item.inventoryType);
}

/** Sufijos que puede llevar el objeto (ids de `RandomSuffixes`). */
export const suffixOptions = (item: Item, data: Pick<GearData, "suffixSets">): number[] => (item.randomSuffixSet === null ? [] : (data.suffixSets[item.randomSuffixSet] ?? []));

/**
 * Estadisticas de un sufijo aleatorio en un objeto: reparto (diezmilesimas) x presupuesto del objeto (`statBudget`, RandPropPoints).
 * Se redondea hacia abajo como el servidor de Classic; **sin confirmar en Forever** (`estimated`): el presupuesto coincide con el de
 * La comunidad en los 1 641 objetos, pero no hay una lectura del juego de un objeto con sufijo.
 */
export function suffixStats(item: Item, suffix: RandomSuffix): { type: number; key: string | null; value: number }[] {
  return suffix.allocations.map((a) => ({ type: a.type, key: a.key, value: Math.floor((a.value * item.statBudget) / 10000 + 1e-9) }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Suma de estadisticas

export type StatOrigin = "item" | "suffix" | "enchant" | "set" | "effect";
export interface GearStatSource {
  /** Ranura y objeto de origen (null en los bonos de conjunto). */
  slot: GearSlot | null;
  itemId: number | null;
  /** Objeto, o nombre del bono de conjunto (con el numero de piezas). */
  itemName: string;
  origin: StatOrigin;
  value: number;
}
export interface GearStatLine {
  /** Clave de `ItemStat.key` (strength, stamina, crit-rating, spell-power...); `type:N` si el cliente aun no se interpreto. */
  key: string;
  value: number;
  sources: GearStatSource[];
}

export interface GearWeapon {
  slot: GearSlot;
  itemName: string;
  min: number;
  max: number;
  speed: number;
  dps: number;
  confidence: "verified" | "estimated";
  /** Velocidad «normalizada» de Classic para los golpes de arma normalizados (daga 1,7, una mano 2,4, dos manos 3,3, a distancia 2,8). */
  normalizedSpeed: number;
  /** Subtipo (ItemSubClass: 15 daga, 19 varita...) y tipo de ranura (13 una mano, 17 dos manos...) del arma: para los requisitos de objeto equipado. */
  subclassId: number;
  inventoryType: number;
}

/** Objeto que se lleva y que no se cuenta a este nivel (exige un nivel mayor). */
export interface UncountedItem {
  slot: GearSlot;
  itemId: number;
  itemName: string;
  requiredLevel: number;
}

/**
 * Reparte lo que se lleva entre lo que cuenta a ese nivel y lo que aún no: cada objeto cuenta desde su propio nivel necesario (los demás
 * siguen contando). Sin `countLevel`, todo cuenta. Los ids que el cliente no trae no se tocan (los informa `summarizeGear` como `missing`).
 */
export function splitByLevel(gear: GearSelection, items: Map<number, Item>, countLevel: number | undefined): { counted: GearSelection; uncounted: UncountedItem[] } {
  if (countLevel === undefined) return { counted: gear, uncounted: [] };
  const counted: GearSelection = {};
  const uncounted: UncountedItem[] = [];
  for (const slot of GEAR_SLOTS) {
    const worn = gear[slot];
    if (!worn) continue;
    const item = items.get(worn.itemId);
    if (item && item.requiredLevel > countLevel) uncounted.push({ slot, itemId: item.id, itemName: item.name, requiredLevel: item.requiredLevel });
    else counted[slot] = worn;
  }
  return { counted, uncounted };
}

export interface SetProgress {
  setId: number;
  name: string;
  /** Piezas distintas del conjunto que llevas. */
  count: number;
  total: number;
  bonuses: { threshold: number; spellId: number; name: string; text: string; textComplete: boolean; active: boolean }[];
}

export interface GearEffect {
  slot: GearSlot;
  itemName: string;
  effect: ItemEffectRef;
}

export interface GearProblem {
  slot: GearSlot;
  itemId: number;
  reasons: string[];
}

const DAGGER_SUBCLASS = 15;
/** Velocidad normalizada del arma (Classic): a distancia 2,8; dos manos 3,3; daga 1,7; el resto de una mano 2,4. `community`/Classic. */
export function normalizedWeaponSpeed(item: Item): number {
  if ([15, 25, 26].includes(item.inventoryType)) return 2.8;
  if (item.inventoryType === TWO_HAND) return 3.3;
  return item.subclassId === DAGGER_SUBCLASS ? 1.7 : 2.4;
}

export interface GearSummary {
  lines: GearStatLine[];
  /** Suma por clave, para consultar rapido. */
  stats: Record<string, number>;
  /** Armadura base de las piezas (la de las tablas, que ya incluye `bonusArmor`; sin la estadistica «armadura extra» de objetos y encantamientos, que va en `stats["extra-armor"]`). */
  armor: number;
  /** Parte de `armor` que es armadura extra de piezas verdes: no recibe el % de armadura de los talentos. */
  bonusArmor: number;
  weapons: GearWeapon[];
  sets: SetProgress[];
  /** Efectos al equipar, al usar y por probabilidad de los objetos (solo texto del cliente). */
  effects: GearEffect[];
  /** Objetos que no se pueden llevar (clase, nivel, competencia...), nunca se descartan en silencio: se siguen sumando y se avisa. */
  problems: GearProblem[];
  /** Objetos de la seleccion sin datos (id desconocido). */
  missing: { slot: GearSlot; itemId: number }[];
  /** Hay algun objeto de la comunidad sin estadisticas (`provenance: community`). */
  incomplete: boolean;
  /** Objetos que se llevan pero no cuentan a este nivel (`countLevel`): exigen un nivel mayor. Nunca se descartan en silencio: la web los lista. */
  uncounted: UncountedItem[];
  /** «+N de daño» (tipo 83) de todo el equipo: se suma a cada golpe de arma, de las dos manos. */
  physicalDamage: number;
}

const statKey = (s: { key: string | null; type: number }): string => s.key ?? `type:${s.type}`;

/**
 * Suma de todo lo que lleva el personaje: estadisticas de cada objeto, de su sufijo aleatorio y de su encantamiento; armadura base;
 * armas; progreso de conjuntos y efectos. Camisa y tabardo suman lo que diga el cliente. No aplica porcentajes ni conversiones:
 * eso es `deriveStats` (atributos) y `ratingPercents` (puntuaciones).
 */
export function summarizeGear(gear: GearSelection, ctx: GearContext, data: GearData, options: { countLevel?: number } = {}): GearSummary {
  // Cada objeto cuenta desde su nivel necesario: los de nivel mayor al del personaje no suman (se avisan en `uncounted`)
  const { counted, uncounted } = splitByLevel(gear, data.items, options.countLevel);
  const lines = new Map<string, GearStatLine>();
  const add = (key: string, value: number, source: GearStatSource) => {
    if (value === 0) return;
    const line = lines.get(key) ?? { key, value: 0, sources: [] };
    line.value += value;
    line.sources.push(source);
    lines.set(key, line);
  };
  const weapons: GearWeapon[] = [];
  const effects: GearEffect[] = [];
  const problems: GearProblem[] = [];
  const missing: GearSummary["missing"] = [];
  let armor = 0;
  let bonusArmor = 0;
  let incomplete = false;
  const piecesBySet = new Map<number, Set<number>>();

  for (const slot of GEAR_SLOTS) {
    const worn = counted[slot];
    if (!worn) continue;
    const item = data.items.get(worn.itemId);
    if (!item) {
      missing.push({ slot, itemId: worn.itemId });
      continue;
    }
    const check = canEquip(item, slot, ctx, data, gear);
    if (!check.ok) problems.push({ slot, itemId: item.id, reasons: check.reasons });
    const source = (origin: StatOrigin, value: number): GearStatSource => ({ slot, itemId: item.id, itemName: item.name, origin, value });

    for (const s of item.stats) add(statKey(s), s.value, source("item", s.value));
    const suffix = worn.suffixId ? data.suffixes.get(worn.suffixId) : undefined;
    if (suffix) {
      
      for (const s of suffixStats(item, suffix)) add(statKey(s), s.value, source("suffix", s.value));
    }
    const enchant = worn.enchantId ? data.enchants.get(worn.enchantId) : undefined;
    if (enchant) for (const s of enchant.stats) add(statKey(s), s.value, source("enchant", s.value));

    if (item.armor) armor += item.armor;
    bonusArmor += item.bonusArmor ?? 0;
    if (item.weapon) weapons.push({ slot, itemName: item.name, min: item.weapon.min, max: item.weapon.max, speed: item.weapon.speed, dps: item.weapon.dps, confidence: item.weapon.confidence, normalizedSpeed: normalizedWeaponSpeed(item), subclassId: item.subclassId, inventoryType: item.inventoryType });
    for (const effect of item.effects) effects.push({ slot, itemName: item.name, effect });
    if (item.provenance === "community" && item.stats.length === 0) incomplete = true;
    if (item.itemSetId !== null) {
      const set = piecesBySet.get(item.itemSetId) ?? new Set<number>();
      set.add(item.id);
      piecesBySet.set(item.itemSetId, set);
    }
  }

  // Bonos de conjunto activos y efectos «al equipar»: sus estadisticas planas (atributos, poder de ataque...) se suman aqui;
  // los porcentajes y modificadores de habilidades entran en los efectos sumados (`collectStatEffects`)
  for (const e of activeGearEffects(counted, data)) {
    const { stats } = classifyGearAuras(e.auras, e.text);
    for (const s of stats) add(s.key, s.value, { slot: e.slot, itemId: e.itemId, itemName: e.origin, origin: e.kind === "set" ? "set" : "effect", value: s.value });
  }

  const sets: SetProgress[] = [];
  for (const [setId, pieces] of piecesBySet) {
    const def = data.sets.find((s) => s.id === setId);
    if (!def) continue;
    sets.push({
      setId,
      name: def.name,
      count: pieces.size,
      total: def.itemIds.length,
      bonuses: def.bonuses.map((b) => ({ threshold: b.threshold, spellId: b.spellId, name: b.name, text: b.text, textComplete: b.textComplete, active: pieces.size >= b.threshold })),
    });
  }
  sets.sort((a, b) => a.name.localeCompare(b.name));

  const sorted = [...lines.values()].sort((a, b) => a.key.localeCompare(b.key));
  return {
    lines: sorted,
    stats: Object.fromEntries(sorted.map((l) => [l.key, l.value])),
    armor: Math.round(armor * 100) / 100,
    bonusArmor,
    weapons,
    sets,
    effects,
    problems,
    missing,
    incomplete,
    uncounted,
    physicalDamage: lines.get("physical-damage")?.value ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Puntuaciones -> porcentaje

/** Estadistica del equipo -> clave de `combat-ratings.json`. Forever tiene una sola puntuacion de impacto, de critico y de celeridad. */
const RATING_KEYS: { stat: string; rating: string; label: string; unit: "%" | "pts" }[] = [
  { stat: "crit-rating", rating: "crit-melee", label: "Probabilidad de crítico", unit: "%" },
  { stat: "hit-rating", rating: "hit-melee", label: "Probabilidad de impacto", unit: "%" },
  { stat: "haste-rating", rating: "haste-melee", label: "Celeridad", unit: "%" },
  { stat: "dodge-rating", rating: "dodge", label: "Esquivar", unit: "%" },
  { stat: "parry-rating", rating: "parry", label: "Parada", unit: "%" },
  { stat: "block-rating", rating: "block", label: "Bloqueo", unit: "%" },
  { stat: "expertise-rating", rating: "expertise", label: "Pericia", unit: "pts" },
  { stat: "defense", rating: "defense-skill", label: "Habilidad de defensa", unit: "pts" },
];

export interface RatingPercent {
  stat: string;
  label: string;
  rating: number;
  /** Puntuacion necesaria por 1 % (por punto en defensa). */
  perUnit: number;
  value: number;
  unit: "%" | "pts";
}

/**
 * Convierte las puntuaciones del equipo en porcentaje con `combat-ratings.json` (la comunidad, `community`, constantes en los
 * 123 niveles). Sin redondear: el juego muestra dos decimales. Solo salen las que el equipo aporta.
 */
export function ratingPercents(stats: Record<string, number>, ratings: Pick<CombatRatings, "ratings">): RatingPercent[] {
  const out: RatingPercent[] = [];
  for (const r of RATING_KEYS) {
    const rating = stats[r.stat] ?? 0;
    const perUnit = ratings.ratings[r.rating];
    if (rating === 0 || !perUnit) continue;
    out.push({ stat: r.stat, label: r.label, rating, perUnit, value: rating / perUnit, unit: r.unit });
  }
  return out;
}

/** Impacto y crítico (%) que dan las puntuaciones del equipo: lo que `abilityChances` suma a cada habilidad. */
export function gearChanceBonus(stats: Record<string, number>, ratings: Pick<CombatRatings, "ratings">): { hitPct: number; critPct: number } {
  const pcts = ratingPercents(stats, ratings);
  const get = (stat: string): number => pcts.find((p) => p.stat === stat)?.value ?? 0;
  return { hitPct: get("hit-rating"), critPct: get("crit-rating") };
}

/** Poder con hechizos de daño y de sanación que da el equipo: el generico («spell-power») suma a las dos y los demas a la suya. */
export function gearSpellPower(stats: Record<string, number>): { damage: number; healing: number } {
  const generic = stats["spell-power"] ?? 0;
  return { damage: generic + (stats["spell-damage"] ?? 0), healing: generic + (stats["healing-power"] ?? 0) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Enlace

const SLOT_LETTERS = "abcdefghijklmnopqrs";

/**
 * Codigo del equipo para el enlace: una entrada por ranura, separadas por «.»; cada una es la letra de la ranura (a = cabeza ...
 * s = distancia, el orden de `GEAR_SLOTS`), el id del objeto y, si los hay, `e` + encantamiento y `x` + sufijo. Ejemplo: `a1234e99.q500x12700`.
 * Va por ids de objeto, no por posiciones, asi que un hotfix no rompe los enlaces: lo que ya no exista se informa al leerlo.
 */
export function encodeGear(gear: GearSelection): string {
  return GEAR_SLOTS.flatMap((slot, i) => {
    const w = gear[slot];
    if (!w) return [];
    return [`${SLOT_LETTERS[i]}${w.itemId}${w.enchantId ? `e${w.enchantId}` : ""}${w.suffixId ? `x${w.suffixId}` : ""}`];
  }).join(".");
}

/** Lee un codigo de equipo; las entradas mal formadas se descartan y se cuentan en `malformed`. Es tolerante: no valida contra los datos. */
export function decodeGear(code: string | null | undefined): { gear: GearSelection; malformed: number } {
  const gear: GearSelection = {};
  let malformed = 0;
  for (const part of (code ?? "").split(".").filter(Boolean)) {
    const m = /^([a-s])(\d+)(?:e(\d+))?(?:x(\d+))?$/.exec(part);
    if (!m) {
      malformed++;
      continue;
    }
    const slot = GEAR_SLOTS[SLOT_LETTERS.indexOf(m[1]!)]!;
    gear[slot] = { itemId: Number(m[2]), enchantId: m[3] ? Number(m[3]) : null, suffixId: m[4] ? Number(m[4]) : null };
  }
  return { gear, malformed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Comparar antes / despues

export interface StatDelta {
  key: string;
  before: number;
  after: number;
}
export interface GearComparison {
  /** Estadisticas que cambian (despues − antes), sin la armadura. */
  stats: StatDelta[];
  /** Armadura total (piezas + «armadura extra»). */
  armor: { before: number; after: number };
  /** Daño por segundo del arma de esa ranura (0 si no hay arma). */
  weaponDps: { before: number; after: number };
  /** Conjuntos cuyo numero de piezas o bonos activos cambian. */
  sets: { setId: number; name: string; countBefore: number; countAfter: number; total: number; activeBefore: number; activeAfter: number; bonuses: SetProgress["bonuses"] }[];
}

/**
 * Lo que cambia al poner `item` en `slot` en lugar de lo que lleva: se suma de nuevo todo el equipo (asi cuentan las reglas de manos,
 * el sufijo y el encantamiento que se pierden y los conjuntos). El objeto nuevo entra sin sufijo ni encantamiento, como al elegirlo
 * en la lista. Devuelve null si ya llevas ese objeto en la ranura.
 */
export function compareGear(gear: GearSelection, slot: GearSlot, item: Item, ctx: GearContext, data: GearData): GearComparison | null {
  if (gear[slot]?.itemId === item.id) return null;
  const before = summarizeGear(gear, ctx, data);
  const after = summarizeGear(equipItem(gear, slot, item, data.items), ctx, data);
  const keys = new Set([...Object.keys(before.stats), ...Object.keys(after.stats)]);
  keys.delete("extra-armor");
  const stats = [...keys]
    .map((key) => ({ key, before: before.stats[key] ?? 0, after: after.stats[key] ?? 0 }))
    .filter((d) => d.before !== d.after)
    .sort((a, b) => a.key.localeCompare(b.key));
  const totalArmor = (s: GearSummary): number => s.armor + (s.stats["extra-armor"] ?? 0);
  const dps = (s: GearSummary): number => s.weapons.find((w) => w.slot === slot)?.dps ?? 0;
  const setNames = new Set([...before.sets, ...after.sets].map((s) => s.setId));
  const sets: GearComparison["sets"] = [];
  for (const id of setNames) {
    const b = before.sets.find((s) => s.setId === id);
    const a = after.sets.find((s) => s.setId === id);
    const activeBefore = b?.bonuses.filter((x) => x.active).length ?? 0;
    const activeAfter = a?.bonuses.filter((x) => x.active).length ?? 0;
    if ((b?.count ?? 0) === (a?.count ?? 0) && activeBefore === activeAfter) continue;
    const ref = (a ?? b)!;
    sets.push({ setId: id, name: ref.name, countBefore: b?.count ?? 0, countAfter: a?.count ?? 0, total: ref.total, activeBefore, activeAfter, bonuses: ref.bonuses });
  }
  return {
    stats,
    armor: { before: Math.round(totalArmor(before)), after: Math.round(totalArmor(after)) },
    weaponDps: { before: dps(before), after: dps(after) },
    sets,
  };
}
