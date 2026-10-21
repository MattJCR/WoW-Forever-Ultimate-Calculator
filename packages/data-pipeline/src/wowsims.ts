import { int, type RawTables } from "./csv.js";
import { ITEM_STAT_KEYS } from "./items.js";
import type { CombatRatings, Enchants, Item, Items, ItemStat, RandomSuffixes } from "./model.js";

/**
 * Datos de wowsims/forever (MIT, https://github.com/wowsims/forever), copiados a data/external/wowsims/ (ver su ATTRIBUTION.md).
 * Son `community`: los midió/generó otro equipo desde el mismo cliente, con hotfixes mas recientes que nuestra cache. Sirven para lo que
 * nuestro volcado no trae (objetos nuevos, sufijos aleatorios, puntuaciones). Su `sources` (botin) no se usa: deriva de AtlasLoot (GPL).
 */
export interface WowsimsItem {
  id: number;
  name: string;
  type?: number;
  armorType?: number;
  weaponType?: number;
  handType?: number;
  rangedWeaponType?: number;
  weaponSpeed?: number;
  quality: number;
  unique?: boolean;
  randomSuffixOptions?: number[];
  scalingOptions?: Record<string, { ilvl?: number; stats?: Record<string, number>; weaponDamageMin?: number; weaponDamageMax?: number; unroundedDps?: number }>;
}
export interface WowsimsDb {
  items: WowsimsItem[];
  enchants: { effectId: number; spellId: number; itemId?: number; name: string; type: number; extraTypes?: number[]; stats: number[]; quality: number; lvl?: number }[];
  randomSuffixes: { id: number; name: string; stats: number[] }[];
}

export const WOWSIMS_SOURCE = "wowsims/forever (MIT) commit 5fd6bea8005759158f2c006f75fa73b70c140265, 2026-10-21";

/** Indice del enum Stat de wowsims (proto/common.proto) -> clave propia (las de ITEM_STAT_KEYS). */
const WS_STAT_KEYS: Record<number, string> = {
  0: "strength", 1: "agility", 2: "stamina", 3: "intellect", 4: "healing-power", 5: "spell-power",
  6: "arcane-power", 7: "fire-power", 8: "frost-power", 9: "holy-power", 10: "nature-power", 11: "shadow-power",
  12: "spell-penetration", 13: "spirit", 14: "attack-power", 15: "ranged-attack-power", 16: "feral-attack-power",
  17: "hit-rating", 18: "crit-rating", 19: "haste-rating", 20: "armor-penetration", 21: "expertise-rating",
  22: "defense", 23: "block-rating", 24: "block-value", 25: "dodge-rating", 26: "parry-rating",
  27: "armor", 28: "extra-armor", 29: "health", 30: "mana", 31: "mana-per-5",
  32: "arcane-resistance", 33: "fire-resistance", 34: "frost-resistance", 35: "nature-resistance", 36: "shadow-resistance",
  37: "physical-damage", 38: "armor-no-mods",
};
const TYPE_BY_KEY = new Map(Object.entries(ITEM_STAT_KEYS).map(([t, k]) => [k, Number(t)]));

function wsStats(list: number[] | Record<string, number> | undefined): ItemStat[] {
  const entries: [number, number][] = Array.isArray(list) ? list.map((v, i) => [i, v] as [number, number]) : Object.entries(list ?? {}).map(([i, v]) => [Number(i), v]);
  return entries
    .filter(([, v]) => v !== 0)
    .map(([i, value]) => {
      const key = WS_STAT_KEYS[i] ?? null;
      return { type: key ? (TYPE_BY_KEY.get(key) ?? -1) : -1, key, value };
    });
}

/** CombatRatings.txt: una fila por nivel, columnas con nombre (puntuacion por 1 %). */
export function buildCombatRatings(text: string, build: string): CombatRatings {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split("\t"));
  const header = rows[0]!;
  const cols = header.map((h, i) => ({ h, i })).filter(({ h, i }) => i > 0 && !/^unused/i.test(h));
  const slug = (h: string) => h.toLowerCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, "-");
  const data = rows.slice(1);
  const first = data[0]!;
  const constant = data.every((r) => cols.every(({ i }) => r[i] === first[i]));
  return {
    schemaVersion: 1,
    build,
    provenance: "community",
    source: `${WOWSIMS_SOURCE}, assets/db_inputs/basestats-forever/CombatRatings.txt`,
    constantAcrossLevels: constant,
    levels: { min: int(data[0]![0]), max: int(data.at(-1)![0]) },
    ratings: Object.fromEntries(cols.map(({ h, i }) => [slug(h), Number(first[i])])),
  };
}

/** Encantamientos: cifras de wowsims, nombre en español del cliente (SpellItemEnchantment.Name_lang, `$k1` = valor del primer efecto). */
export function buildEnchants(db: WowsimsDb, raw: RawTables, build: string, warnings: string[]): Enchants {
  const rows = new Map(raw.table("SpellItemEnchantment").map((r) => [int(r.ID), r]));
  let unresolved = 0;
  const enchants = db.enchants.map((e) => {
    const stats = wsStats(e.stats);
    const row = rows.get(e.effectId);
    // `$kN` = EffectPointsMin[N-1] del propio encantamiento (el orden es el de los efectos, no el de las estadisticas)
    let name = (row?.Name_lang ?? "") || e.name;
    name = name.replace(/\$k([123])/g, (m, n: string) => {
      const v = int(row?.[`EffectPointsMin[${Number(n) - 1}]`]);
      return v !== 0 ? String(v) : m;
    });
    if (/\$/.test(name)) unresolved++;
    return {
      effectId: e.effectId,
      spellId: e.spellId,
      itemId: e.itemId ?? null,
      name,
      nameEn: e.name,
      slotType: e.type,
      extraSlotTypes: e.extraTypes ?? [],
      quality: e.quality,
      level: e.lvl ?? null,
      stats,
    };
  });
  if (unresolved > 0) warnings.push(`${unresolved} encantamientos conservan algun marcador $ en el nombre`);
  const missing = db.enchants.filter((e) => !rows.has(e.effectId)).length;
  if (missing > 0) warnings.push(`${missing} encantamientos de wowsims no estan en SpellItemEnchantment del cliente`);
  return { schemaVersion: 1, build, provenance: "community", source: WOWSIMS_SOURCE, enchants };
}

export function buildRandomSuffixes(db: WowsimsDb, build: string): RandomSuffixes {
  return {
    schemaVersion: 1,
    build,
    provenance: "community",
    source: WOWSIMS_SOURCE,
    suffixes: db.randomSuffixes.map((s) => ({ id: s.id, nameEn: s.name, textOrigin: "untranslated" as const, allocations: wsStats(s.stats) })),
  };
}

/** ItemType de wowsims -> InventoryType del cliente (el arma depende de HandType). */
function inventoryTypeOf(i: WowsimsItem): number | null {
  const byType: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 16, 5: 5, 6: 9, 7: 10, 8: 6, 9: 7, 10: 8, 11: 11, 12: 12 };
  if (i.type !== undefined && byType[i.type]) return byType[i.type]!;
  if (i.type === 13) return ({ 1: 21, 2: 13, 3: 22, 4: 17 } as Record<number, number>)[i.handType ?? 2] ?? 13;
  if (i.type === 14) return ({ 1: 15, 2: 15, 3: 26, 4: 25, 5: 26, 6: 28, 7: 28 } as Record<number, number>)[i.rangedWeaponType ?? 1] ?? 15;
  return null;
}
/** Subclase de arma del cliente (0 hacha 1M, 1 hacha 2M, 4 maza 1M, 5 maza 2M, 6 asta, 7 espada 1M, 8 espada 2M, 10 baston, 13 puño, 15 daga) y de distancia (2 arco, 3 arma de fuego, 18 ballesta, 16 arrojadiza, 19 varita). */
function weaponSubclassOf(i: WowsimsItem): number | null {
  const two = i.handType === 4;
  if (i.type === 14) return ({ 1: 2, 2: 18, 3: 3, 4: 16, 5: 19 } as Record<number, number>)[i.rangedWeaponType ?? 0] ?? null;
  return ({ 1: two ? 1 : 0, 2: 15, 3: 13, 4: two ? 5 : 4, 6: 6, 8: 10, 9: two ? 8 : 7 } as Record<number, number>)[i.weaponType ?? 0] ?? null;
}

/**
 * Objetos de wowsims que no estan en `Item` del cliente (contenido mas nuevo que nuestra cache de hotfixes). Solo los equipables con
 * ranura; los que no (sellos, simbolos, tabardos) se cuentan en `skipped`.
 */
export function extraItems(db: WowsimsDb, knownIds: Set<number>): { items: Item[]; skipped: number } {
  const items: Item[] = [];
  let skipped = 0;
  for (const w of db.items) {
    if (knownIds.has(w.id)) continue;
    const inventoryType = inventoryTypeOf(w);
    const so = Object.values(w.scalingOptions ?? {})[0];
    if (inventoryType === null || !so) {
      skipped++;
      continue;
    }
    const isWeapon = w.type === 13 || w.type === 14;
    const shield = w.weaponType === 7;
    const classId = isWeapon && !shield ? 2 : 4;
    const subclassId = shield ? 6 : isWeapon ? (weaponSubclassOf(w) ?? 0) : (w.armorType ?? 0);
    const delay = w.weaponSpeed ?? 0;
    const table = ({ 15: "ranged", 26: "wand", 25: "thrown" } as Record<number, "ranged" | "wand" | "thrown">)[inventoryType] ?? (inventoryType === 17 ? "two-hand" : "one-hand");
    items.push({
      id: w.id,
      name: w.name,
      quality: w.quality,
      itemLevel: so.ilvl ?? 0,
      requiredLevel: 0,
      inventoryType,
      classId,
      subclassId,
      bonding: 0,
      iconFileDataId: null,
      allowableClass: -1,
      allowableRace: -1,
      itemSetId: null,
      limitCategory: null,
      maxCount: w.unique ? 1 : 0,
      armor: null,
      weapon:
        isWeapon && !shield && delay > 0 && so.weaponDamageMin !== undefined
          ? { min: so.weaponDamageMin, max: so.weaponDamageMax ?? so.weaponDamageMin, speed: delay, dps: Math.round((so.unroundedDps ?? 0) * 100) / 100, table, confidence: "estimated" }
          : null,
      casterWeapon: false,
      placeholder: false,
      stats: wsStats(so.stats),
      effects: [],
      provenance: "community",
      textOrigin: "untranslated",
      randomSuffixSet: null,
    });
  }
  return { items, skipped };
}

/** Completa `items.json` con lo de wowsims: objetos que el volcado no trae y las listas de sufijos aleatorios de cada objeto. */
export function applyWowsims(base: Items, db: WowsimsDb): { items: Items; extra: number; skipped: number } {
  const known = new Set([...base.items.map((i) => i.id), ...base.unavailable.map((u) => u.id)]);
  const { items: extra, skipped } = extraItems(db, known);
  const suffixOptions = new Map(db.items.filter((i) => i.randomSuffixOptions?.length).map((i) => [i.id, i.randomSuffixOptions!]));
  const sets: number[][] = [];
  const setIndex = new Map<string, number>();
  const withSuffix = (item: Item): Item => {
    const options = suffixOptions.get(item.id);
    if (!options) return item;
    const key = options.join(",");
    let idx = setIndex.get(key);
    if (idx === undefined) {
      idx = sets.length;
      sets.push(options);
      setIndex.set(key, idx);
    }
    return { ...item, randomSuffixSet: idx };
  };
  const items = [...base.items, ...extra].map(withSuffix).sort((a, b) => a.id - b.id);
  return { items: { ...base, items, suffixSets: sets }, extra: extra.length, skipped };
}
