import { int, type RawTables, type Row } from "./csv.js";
import { renderSpellText } from "./spell-text.js";
import type { SpellTables } from "./spell-tables.js";
import type { Item, ItemSetDef, Items, ItemStat, ItemWeapon } from "./model.js";

/**
 * ItemSparse.StatModifier_bonusStat (ITEM_MOD_* de retail) -> clave propia. Interpretados contra las lecturas del juego que trae el
 * addon Lootified (12 738 de 12 940 objetos coinciden); los tipos 83 y 90-139 no se han podido interpretar y salen con `key: null`.
 */
export const ITEM_STAT_KEYS: Record<number, string> = {
  0: "mana",
  1: "health",
  3: "agility",
  4: "strength",
  5: "intellect",
  6: "spirit",
  7: "stamina",
  12: "defense",
  13: "dodge-rating",
  14: "parry-rating",
  15: "block-rating",
  31: "hit-rating",
  32: "crit-rating",
  36: "haste-rating",
  37: "expertise-rating",
  38: "attack-power",
  39: "ranged-attack-power",
  41: "healing-power",
  42: "spell-damage",
  43: "mana-per-5",
  45: "spell-power",
  46: "health-regen",
  47: "spell-penetration",
  48: "block-value",
  50: "extra-armor",
  51: "fire-resistance",
  52: "frost-resistance",
  53: "holy-resistance",
  54: "shadow-resistance",
  55: "nature-resistance",
  56: "arcane-resistance",
  84: "holy-power",
  85: "fire-power",
  86: "nature-power",
  87: "frost-power",
  88: "shadow-power",
  89: "arcane-power",
};

/** Cubo de ranura de RandPropPoints (0 cabeza/pecho/piernas/dos manos, 1 hombros/cintura/pies/manos, 2 cuello/muñecas/anillo/capa/escudo, 3 una mano, 4 varita/proyectil). */
const SLOT_BUCKET: Record<number, number> = {
  1: 0, 4: 0, 5: 0, 7: 0, 15: 0, 17: 0, 20: 0,
  3: 1, 6: 1, 8: 1, 10: 1, 12: 1,
  2: 2, 9: 2, 11: 2, 14: 2, 16: 2, 19: 2, 23: 2,
  13: 3, 21: 3, 22: 3,
  25: 4, 26: 4,
};

/** Material de armadura: ItemSubclass -> [columna de ItemArmorTotal, columna de ArmorLocation]. */
const ARMOR_MATERIAL: Record<number, [string, string]> = {
  1: ["Cloth", "Clothmodifier"],
  2: ["Leather", "Leathermodifier"],
  3: ["Mail", "Chainmodifier"],
  4: ["Plate", "Platemodifier"],
};
const SHIELD = 6;
const CLOAK_SLOT = 16;
const ROBE_SLOT = 20;
const CHEST_SLOT = 5;

/** Subclases de arma (clase 2) -> tabla de daño. A distancia = 0,6 x dos manos (medido: mediana 0,598, p10-p90 0,592-0,601). */
const WEAPON_TABLE: Record<number, ItemWeapon["table"]> = {
  0: "one-hand", 4: "one-hand", 7: "one-hand", 13: "one-hand", 15: "one-hand",
  1: "two-hand", 5: "two-hand", 6: "two-hand", 8: "two-hand", 10: "two-hand",
  2: "ranged", 3: "ranged", 18: "ranged",
  16: "thrown",
  19: "wand",
};
const RANGED_FACTOR = 0.6;
/** Armas de lanzador (Flags[4] bit 8): DPS x 0,664 (una mano) o x 0,741 (dos manos); medido en 143 armas, p10-p90 +-0,5 %. */
const CASTER_FACTOR: Partial<Record<ItemWeapon["table"], number>> = { "one-hand": 0.664, "two-hand": 0.741 };
const CASTER_WEAPON_FLAG = 0x100; // ItemSparse.Flags[4]

const PLACEHOLDER = /^\[PH\]|\(TEST\)|\bTEST\b|^OLD|\(OLD\)|^zz|^Deprecated|^DEPRECATED|^Monster - |\(DEPRECATED\)|\(Deprecated\)/i;

const num = (v: string | undefined): number => Number(v ?? 0) || 0;
const byLevel = (rows: Row[]): Map<number, Row> => new Map(rows.map((r) => [int(r.ItemLevel), r]));

/**
 * Objetos equipables (armas y armadura con ranura) desde las tablas del cliente con hotfixes.
 *  - Estadistica = round(StatPercentEditor / 10 000 x presupuesto de RandPropPoints[nivel][calidad][ranura]).
 *  - Armadura = ItemArmorTotal x ItemArmorQuality x ArmorLocation (escudos: ItemArmorShield).
 *  - Dano de arma = DPS de ItemDamage*[nivel][calidad] x velocidad, repartido +-DmgVariance/2.
 * Contrastado con las lecturas del juego de Lootified (ver test): estadisticas 98,7 %, armadura (con la armadura extra) 99,5 %, armas
 * 92-99 % segun tabla. A distancia y de lanzador usan un factor medido sobre la tabla y van marcadas `estimated`.
 */
export function buildItems(raw: RawTables, build: string, spells: SpellTables): Items {
  const spellText = (spellId: number) => {
    const r = renderSpellText(spells, spells.description(spellId), { spellId, rank: 1, curves: new Map() });
    return { name: spells.name(spellId) ?? "", text: r.text.trim(), textComplete: r.complete };
  };
  const sparse = raw.table("ItemSparse");
  const itemRows = raw.table("Item");
  const sparseById = new Map(sparse.map((r) => [r.ID!, r]));
  const rpp = new Map(raw.table("RandPropPoints").map((r) => [int(r.ID), r]));
  const armorTotal = byLevel(raw.table("ItemArmorTotal"));
  const armorQuality = new Map(raw.table("ItemArmorQuality").map((r) => [int(r.ID), r]));
  const armorShield = byLevel(raw.table("ItemArmorShield"));
  const armorLocation = new Map(raw.table("ArmorLocation").map((r) => [int(r.ID), r]));
  const damage = {
    "one-hand": byLevel(raw.table("ItemDamageOneHand")),
    "two-hand": byLevel(raw.table("ItemDamageTwoHand")),
    wand: byLevel(raw.table("ItemDamageWand")),
    thrown: byLevel(raw.table("ItemDamageThrown")),
  };
  const effectById = new Map(raw.table("ItemEffect").map((r) => [r.ID!, r]));
  const effectsByItem = new Map<string, Item["effects"]>();
  for (const x of raw.table("ItemXItemEffect")) {
    const e = effectById.get(x.ItemEffectID!);
    if (!e) continue;
    const list = effectsByItem.get(x.ItemID!) ?? [];
    list.push({ spellId: int(e.SpellID), trigger: int(e.TriggerType), ...spellText(int(e.SpellID)) });
    effectsByItem.set(x.ItemID!, list);
  }

  const warnings: string[] = [];
  const unknownTypes = new Map<number, number>();
  const items: Item[] = [];
  const unavailable: Items["unavailable"] = [];

  for (const it of itemRows) {
    const classId = int(it.ClassID);
    const inventoryType = int(it.InventoryType);
    if ((classId !== 2 && classId !== 4) || inventoryType === 0) continue;
    const s = sparseById.get(it.ID!);
    if (!s) {
      unavailable.push({ id: int(it.ID), classId, subclassId: int(it.SubclassID), inventoryType });
      continue;
    }
    const quality = int(s.OverallQualityID);
    const itemLevel = int(s.ItemLevel);
    const subclassId = int(it.SubclassID);

    // --- estadisticas
    const bucket = SLOT_BUCKET[inventoryType];
    const budgetRow = rpp.get(itemLevel);
    const column = quality >= 4 ? "Epic" : quality === 3 ? "Superior" : "Good";
    const budget = bucket !== undefined && budgetRow ? num(budgetRow[`${column}[${bucket}]`]) : 0;
    const stats: ItemStat[] = [];
    for (let i = 0; i < 10; i++) {
      const alloc = num(s[`StatPercentEditor[${i}]`]);
      if (alloc === 0) continue;
      const type = int(s[`StatModifier_bonusStat[${i}]`]);
      const key = ITEM_STAT_KEYS[type] ?? null;
      if (key === null) unknownTypes.set(type, (unknownTypes.get(type) ?? 0) + 1);
      stats.push({ type, key, value: Math.round((alloc * budget) / 10000) });
    }
    if (stats.length > 0 && budget === 0) warnings.push(`objeto ${it.ID}: sin presupuesto de RandPropPoints (nivel ${itemLevel}, ranura ${inventoryType})`);

    // --- armadura
    let armor: number | null = null;
    const total = armorTotal.get(itemLevel);
    const qualityMod = armorQuality.get(itemLevel);
    if (classId === 4 && subclassId === SHIELD) {
      armor = armorShield.get(itemLevel) ? num(armorShield.get(itemLevel)![`Quality[${quality}]`]) : null;
    } else if (classId === 4 && ARMOR_MATERIAL[subclassId] && total && qualityMod) {
      const [totalCol, locCol] = ARMOR_MATERIAL[subclassId]!;
      const loc = armorLocation.get(inventoryType === ROBE_SLOT ? CHEST_SLOT : inventoryType);
      armor = loc && num(loc[locCol]) > 0 ? num(total[totalCol]) * num(qualityMod[`Qualitymod[${quality}]`]) * num(loc[locCol]) : null;
    } else if (classId === 4 && subclassId === 0 && inventoryType === CLOAK_SLOT && total && qualityMod) {
      armor = num(total.Cloth) * num(qualityMod[`Qualitymod[${quality}]`]) * num(armorLocation.get(CLOAK_SLOT)?.Modifier);
    }

    // --- arma
    const casterWeapon = classId === 2 && (int(s["Flags[4]"]) & CASTER_WEAPON_FLAG) !== 0;
    let weapon: ItemWeapon | null = null;
    const table = classId === 2 ? WEAPON_TABLE[subclassId] : undefined;
    const delay = num(s.ItemDelay) / 1000;
    if (table && delay > 0) {
      const row = damage[table === "ranged" ? "two-hand" : table].get(itemLevel);
      if (row) {
        const dps = num(row[`Quality[${quality}]`]) * (table === "ranged" ? RANGED_FACTOR : 1) * (casterWeapon ? (CASTER_FACTOR[table] ?? 1) : 1);
        const avg = dps * delay;
        const variance = num(s.DmgVariance);
        weapon = {
          min: round2(avg * (1 - variance / 2)),
          max: round2(avg * (1 + variance / 2)),
          speed: delay,
          dps: round2(dps),
          table,
          confidence: casterWeapon || table === "ranged" ? "estimated" : "verified",
        };
      }
    }

    const name = s.Display_lang ?? "";
    items.push({
      id: int(it.ID),
      name,
      quality,
      itemLevel,
      requiredLevel: int(s.RequiredLevel),
      inventoryType,
      classId,
      subclassId,
      bonding: int(s.Bonding),
      iconFileDataId: int(it.IconFileDataID) || null,
      allowableClass: int(s.AllowableClass),
      allowableRace: int(s["AllowableRace[0]"]),
      itemSetId: int(s.ItemSet) || null,
      limitCategory: int(s.LimitCategory) || null,
      maxCount: int(s.MaxCount),
      armor: armor === null ? null : round2(armor),
      weapon,
      casterWeapon,
      placeholder: PLACEHOLDER.test(name) || (itemLevel >= 100 && int(s.RequiredLevel) >= 90),
      stats,
      effects: effectsByItem.get(it.ID!) ?? [],
      provenance: "client-db2",
      textOrigin: "client",
      randomSuffixSet: null,
    });
  }

  if (unknownTypes.size > 0) {
    warnings.push(`tipos de estadistica sin interpretar (se conservan con key null): ${[...unknownTypes].sort((a, b) => a[0] - b[0]).map(([t, n]) => `${t}×${n}`).join(", ")}`);
  }
  items.sort((a, b) => a.id - b.id);
  unavailable.sort((a, b) => a.id - b.id);

  // Conjuntos: ItemSet (piezas) + ItemSetSpell (bonos por numero de piezas)
  const bonusRows = new Map<string, Row[]>();
  for (const r of raw.table("ItemSetSpell")) bonusRows.set(r.ItemSetID!, [...(bonusRows.get(r.ItemSetID!) ?? []), r]);
  const sets: ItemSetDef[] = raw.table("ItemSet").map((r) => ({
    id: int(r.ID),
    name: r.Name_lang ?? "",
    requiredSkill: int(r.RequiredSkill),
    requiredSkillRank: int(r.RequiredSkillRank),
    itemIds: Array.from({ length: 17 }, (_, i) => int(r[`ItemID[${i}]`])).filter((id) => id > 0),
    bonuses: (bonusRows.get(r.ID!) ?? [])
      .map((b) => ({ threshold: int(b.Threshold), spellId: int(b.SpellID), ...spellText(int(b.SpellID)), specId: int(b.ChrSpecID) || null }))
      .sort((a, b) => a.threshold - b.threshold || a.spellId - b.spellId),
  }));
  const knownIds = new Set([...items.map((i) => i.id), ...unavailable.map((u) => u.id)]);
  const emptySets = sets.filter((s) => s.bonuses.length === 0).length;
  if (emptySets > 0) warnings.push(`${emptySets} conjuntos sin bonos en ItemSetSpell`);
  const strangers = sets.filter((s) => s.itemIds.some((id) => !knownIds.has(id))).length;
  if (strangers > 0) warnings.push(`${strangers} conjuntos citan piezas que no son armas ni armadura equipables (se conservan los ids)`);
  return { schemaVersion: 1, build, provenance: "client-db2", items, unavailable, sets, suffixSets: [], warnings };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
