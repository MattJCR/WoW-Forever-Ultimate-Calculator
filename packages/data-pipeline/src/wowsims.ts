import { int, type RawTables, type Row } from "./csv.js";
import { ITEM_STAT_KEYS, spellEffectInfo } from "./items.js";
import type { SpellTables } from "./spell-tables.js";
import type { CombatRatings, Enchant, Enchants, Item, Items, ItemStat, RandomSuffixes } from "./model.js";

/**
 * Datos de la comunidad (MIT), copiados a data/external/wowsims/ (ver su ATTRIBUTION.md).
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

export const WOWSIMS_SOURCE = "Datos de la comunidad (MIT), 2026-10-21";

/** Indice del enum Stat de la comunidad (proto/common.proto) -> clave propia (las de ITEM_STAT_KEYS). */
const WS_STAT_KEYS: Record<number, string> = {
  0: "strength", 1: "agility", 2: "stamina", 3: "intellect", 4: "healing-power", 5: "spell-damage",
  6: "arcane-power", 7: "fire-power", 8: "frost-power", 9: "holy-power", 10: "nature-power", 11: "shadow-power",
  12: "spell-penetration", 13: "spirit", 14: "attack-power", 15: "ranged-attack-power", 16: "feral-attack-power",
  17: "hit-rating", 18: "crit-rating", 19: "haste-rating", 20: "armor-penetration", 21: "expertise-rating",
  22: "defense", 23: "block-rating", 24: "block-value", 25: "dodge-rating", 26: "parry-rating",
  27: "armor", 28: "extra-armor", 29: "health", 30: "mana", 31: "mana-per-5",
  32: "arcane-resistance", 33: "fire-resistance", 34: "frost-resistance", 35: "nature-resistance", 36: "shadow-resistance",
  37: "physical-damage", 38: "armor-no-mods",
};
const TYPE_BY_KEY = new Map(Object.entries(ITEM_STAT_KEYS).map(([t, k]) => [k, Number(t)]));

/**
 * Estadisticas de la comunidad en nuestras claves. Su enum separa la sanacion (4) y el daño con hechizos (5); nosotros tenemos ademas el
 * poder con hechizos generico (daño y sanacion a la vez, tipo 45): si el mismo objeto trae las dos con la misma cifra, es ese.
 */
export function wsStats(list: number[] | Record<string, number> | undefined): ItemStat[] {
  const entries: [number, number][] = Array.isArray(list) ? list.map((v, i) => [i, v] as [number, number]) : Object.entries(list ?? {}).map(([i, v]) => [Number(i), v]);
  const out: ItemStat[] = entries
    .filter(([, v]) => v !== 0)
    .map(([i, value]) => {
      const key = WS_STAT_KEYS[i] ?? null;
      return { type: key ? (TYPE_BY_KEY.get(key) ?? -1) : -1, key, value };
    });
  // Poder de ataque y de ataque a distancia con la misma cifra = nuestro «poder de ataque» (suma a las dos)
  const ap = out.find((s) => s.key === "attack-power");
  const rap = out.find((s) => s.key === "ranged-attack-power");
  if (ap && rap && ap.value === rap.value) out.splice(out.indexOf(rap), 1);
  const heal = out.find((s) => s.key === "healing-power");
  const damage = out.find((s) => s.key === "spell-damage");
  if (heal && damage && heal.value === damage.value) {
    const rest = out.filter((s) => s !== heal && s !== damage);
    return [...rest, { type: 45, key: "spell-power", value: heal.value }];
  }
  return out;
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
    source: WOWSIMS_SOURCE,
    constantAcrossLevels: constant,
    levels: { min: int(data[0]![0]), max: int(data.at(-1)![0]) },
    ratings: Object.fromEntries(cols.map(({ h, i }) => [slug(h), Number(first[i])])),
  };
}

/** Escuela de resistencia de SpellItemEnchantment (efecto 4, argumento): 0 = fisica (armadura extra), 1 sagrado ... 6 arcano. */
const ENCHANT_RESISTANCE: Record<number, { type: number; key: string }> = {
  0: { type: 50, key: "extra-armor" },
  1: { type: 53, key: "holy-resistance" },
  2: { type: 51, key: "fire-resistance" },
  3: { type: 55, key: "nature-resistance" },
  4: { type: 52, key: "frost-resistance" },
  5: { type: 54, key: "shadow-resistance" },
  6: { type: 56, key: "arcane-resistance" },
};
/** SpellItemEnchantment.Effect -> ItemEffect.TriggerType del hechizo que lleva (3 al equipar -> 1, 1 probabilidad al golpear -> 2, 7 uso -> 0). */
const ENCHANT_TRIGGER: Record<number, number> = { 3: 1, 1: 2, 7: 0 };
const PHYSICAL_DAMAGE_TYPE = 83;
/** Tipo 124 («todas las resistencias»): las cinco escuelas magicas, sin Sagrado (como en los objetos). */
const ALL_RESISTANCES_TYPE = 124;
const ALL_SCHOOL_RESISTANCES: [number, string][] = [[56, "arcane-resistance"], [51, "fire-resistance"], [52, "frost-resistance"], [55, "nature-resistance"], [54, "shadow-resistance"]];
/**
 * Encantamientos cuyo efecto del cliente contradice su propio nombre: «Espíritu +4» (8203) trae un efecto de estadistica de tipo 124 (todas
 * las resistencias). Se sigue el nombre, que coincide con la lectura de la comunidad (espiritu 4): se descarta la estadistica directa del cliente.
 */
const CLIENT_EFFECT_CONTRADICTS_NAME = new Set([8203]);

/**
 * Lo que el cliente dice que da un encantamiento (SpellItemEnchantment, 3 efectos): estadisticas directas (efecto 5: tipo de estadistica y
 * cifra; efecto 4: resistencia o armadura; efecto 2: daño de arma) y los hechizos que lleva (efectos 3, 1 y 7) con sus auras.
 */
export function clientEnchantValues(row: Row, spells: SpellTables): { stats: ItemStat[]; effects: Enchant["effects"]; unhandled: number[] } {
  const stats: ItemStat[] = [];
  const effects: Enchant["effects"] = [];
  const unhandled: number[] = [];
  for (let i = 0; i < 3; i++) {
    const kind = int(row[`Effect[${i}]`]);
    const points = int(row[`EffectPointsMin[${i}]`]);
    const arg = int(row[`EffectArg[${i}]`]);
    if (kind === 0) continue;
    if (kind === 5) {
      if (arg === ALL_RESISTANCES_TYPE) for (const [schoolType, k] of ALL_SCHOOL_RESISTANCES) stats.push({ type: schoolType, key: k, value: points });
      else stats.push({ type: arg, key: ITEM_STAT_KEYS[arg] ?? null, value: points });
    }
    else if (kind === 4) {
      const r = ENCHANT_RESISTANCE[arg];
      if (r) stats.push({ type: r.type, key: r.key, value: points });
      else unhandled.push(kind);
    } else if (kind === 2) stats.push({ type: PHYSICAL_DAMAGE_TYPE, key: ITEM_STAT_KEYS[PHYSICAL_DAMAGE_TYPE] ?? null, value: points });
    else if (ENCHANT_TRIGGER[kind] !== undefined && arg > 0) effects.push({ spellId: arg, trigger: ENCHANT_TRIGGER[kind]!, ...spellEffectInfo(spells, arg) });
    else unhandled.push(kind);
  }
  return { stats, effects, unhandled };
}

/**
 * Encantamientos. Nombre, estadisticas y hechizos salen del cliente (SpellItemEnchantment; el nombre lleva marcadores: `$kN` = valor del
 * efecto N del propio encantamiento y `$<hechizo>M<n>` = cifra del efecto n de ese hechizo). La ranura donde se aplica, el objeto que lo
 * aplica y la calidad son de la comunidad (el cliente no los trae); si el cliente no trae el encantamiento, valen las cifras de la comunidad.
 */
export function buildEnchants(db: WowsimsDb, raw: RawTables, build: string, warnings: string[], spells: SpellTables): Enchants {
  const rows = new Map(raw.table("SpellItemEnchantment").map((r) => [int(r.ID), r]));
  let unresolved = 0;
  const unhandled = new Set<number>();
  const enchants = db.enchants.map((e) => {
    const row = rows.get(e.effectId);
    let name = (row?.Name_lang ?? "") || e.name;
    name = name.replace(/\$k([123])/g, (m, n: string) => {
      const v = int(row?.[`EffectPointsMin[${Number(n) - 1}]`]);
      return v !== 0 ? String(v) : m;
    });
    name = name.replace(/\$(\d+)M([123])/g, (m, id: string, n: string) => {
      const eff = spells.effect(Number(id), Number(n) - 1);
      const v = eff ? Math.abs(Number(eff.EffectBasePointsF)) : NaN;
      return Number.isFinite(v) && v !== 0 ? String(v) : m;
    });
    if (/\$/.test(name)) unresolved++;
    const client = row ? clientEnchantValues(row, spells) : null;
    if (client && CLIENT_EFFECT_CONTRADICTS_NAME.has(e.effectId)) client.stats = [];
    for (const k of client?.unhandled ?? []) unhandled.add(k);
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
      stats: client ? client.stats : [],
      effects: client ? client.effects : [],
      communityStats: wsStats(e.stats).map((s) => ({ ...s, source: "community" as const })),
    };
  });
  if (unresolved > 0) warnings.push(`${unresolved} encantamientos conservan algun marcador $ en el nombre`);
  if (unhandled.size > 0) warnings.push(`encantamientos con tipos de efecto sin interpretar: ${[...unhandled].join(", ")}`);
  const missing = db.enchants.filter((e) => !rows.has(e.effectId)).length;
  if (missing > 0) warnings.push(`${missing} encantamientos de la comunidad no estan en SpellItemEnchantment del cliente (solo valen sus cifras)`);
  return {
    schemaVersion: 1,
    build,
    provenance: "client-db2",
    source: "Cifras y hechizos: cliente (SpellItemEnchantment). Ranura, objeto y calidad: comunidad (MIT), 2026-10-21",
    enchants,
  };
}

/** `names` = traducciones propias (data/i18n/suffixes-esES.json): nombre en ingles de la comunidad -> español. */
export function buildRandomSuffixes(db: WowsimsDb, build: string, names: Record<string, string> = {}): RandomSuffixes {
  return {
    schemaVersion: 1,
    build,
    provenance: "community",
    source: WOWSIMS_SOURCE,
    suffixes: db.randomSuffixes.map((s) => ({ id: s.id, name: names[s.name] ?? s.name, nameEn: s.name, textOrigin: names[s.name] ? ("translated-by-us" as const) : ("untranslated" as const), allocations: wsStats(s.stats) })),
  };
}

/** ItemType de la comunidad -> InventoryType del cliente (el arma depende de HandType). */
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
 * Objetos de la comunidad que no estan en `Item` del cliente (contenido mas nuevo que nuestra cache de hotfixes). Solo los equipables con
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
      uniqueEquipped: false,
      bonusArmor: 0,
      armor: so.stats?.["27"] ?? null,
      weapon:
        isWeapon && !shield && delay > 0 && so.weaponDamageMin !== undefined
          ? { min: so.weaponDamageMin, max: so.weaponDamageMax ?? so.weaponDamageMin, speed: delay, dps: Math.round((so.unroundedDps ?? 0) * 100) / 100, table, confidence: "estimated" }
          : null,
      casterWeapon: false,
      placeholder: false,
      stats: wsStats(so.stats).filter((s) => s.key !== "armor"),
      statBudget: 0,
      effects: [],
      provenance: "community",
      textOrigin: "untranslated",
      randomSuffixSet: null,
    });
  }
  return { items, skipped };
}

/** Completa `items.json` con lo de la comunidad: objetos que el volcado no trae y las listas de sufijos aleatorios de cada objeto. */
export function applyWowsims(base: Items, db: WowsimsDb): { items: Items; extra: number; skipped: number } {
  // Los que el cliente lista pero sin datos (`unavailable`) y la comunidad si trae pasan a ser objetos `community`
  const known = new Set(base.items.map((i) => i.id));
  const { items: extra, skipped } = extraItems(db, known);
  const recovered = new Set(extra.map((i) => i.id));
  const unavailable = base.unavailable.filter((u) => !recovered.has(u.id));
  // Valor de bloqueo de los escudos: el cliente no lo trae (la comunidad lo saca de una tabla de objetos), asi que se anade marcado community
  const blockOf = new Map<number, number>();
  for (const w of db.items) {
    const v = Object.values(w.scalingOptions ?? {})[0]?.stats?.["24"];
    if (v) blockOf.set(w.id, v);
  }
  const withBlock = (item: Item): Item => {
    const v = item.classId === 4 && item.subclassId === 6 ? blockOf.get(item.id) : undefined;
    if (!v) return item;
    // Si el objeto ya trae un bono de bloqueo propio (suma al valor base del escudo) se sustituye por el total de la comunidad
    const own = item.stats.find((x) => x.key === "block-value");
    if (own && own.value >= v) return item;
    return { ...item, stats: [...item.stats.filter((x) => x.key !== "block-value"), { type: 48, key: "block-value", value: v, source: "community" as const }] };
  };
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
  const items = [...base.items.map(withBlock), ...extra].map(withSuffix).sort((a, b) => a.id - b.id);
  return { items: { ...base, items, unavailable, suffixSets: sets }, extra: extra.length, skipped };
}
