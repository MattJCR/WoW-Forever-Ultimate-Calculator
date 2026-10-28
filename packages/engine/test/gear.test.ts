import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CombatRatings, Enchants, EquipRules, Items, RandomSuffixes } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import {
  GEAR_SLOTS,
  canEquip,
  compareGear,
  decodeGear,
  encodeGear,
  deriveStats,
  enchantFits,
  enchantOptions,
  equipItem,
  gearChanceBonus,
  gearSpellPower,
  indexGearData,
  ratingPercents,
  slotsForItem,
  suffixOptions,
  suffixStats,
  summarizeGear,
  type GearContext,
  type GearSelection,
} from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
const has = existsSync(join(D, "items.json")) && existsSync(join(D, "equip-rules.json"));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

// Clases del cliente: 1 guerrero, 2 paladín, 3 cazador, 4 pícaro, 5 sacerdote, 7 chamán, 8 mago, 9 brujo, 11 druida
const WARRIOR = 1, PALADIN = 2, HUNTER = 3, ROGUE = 4, PRIEST = 5, MAGE = 8;
const HUMAN = 1;
const ctx = (classId: number, level = 60, raceId = HUMAN): GearContext => ({ classId, raceId, level });

describe.skipIf(!has)("equipo: reglas para equipar y sumas (cliente 1.60.1.70658 con hotfixes)", () => {
  const data = indexGearData({
    items: Items.parse(json("items.json")),
    rules: EquipRules.parse(json("equip-rules.json")),
    enchants: existsSync(join(D, "enchants.json")) ? Enchants.parse(json("enchants.json")) : null,
    suffixes: existsSync(join(D, "random-suffixes.json")) ? RandomSuffixes.parse(json("random-suffixes.json")) : null,
  });
  const item = (id: number) => {
    const i = data.items.get(id);
    if (!i) throw new Error(`falta el objeto ${id}`);
    return i;
  };
  const reasons = (id: number, slot: (typeof GEAR_SLOTS)[number], c: GearContext, worn: GearSelection = {}) => canEquip(item(id), slot, c, data, worn).reasons;

  // Peto de alabastro (placas, nivel 52), Toga imperial roja (tela, 51), Hoja de Hanna (espada 2M, 59), Aterratigres (daga, 33),
  // Égida de Ventormenta (escudo, 49), Ojo de Adaegus (anillo único, 48), Varita agostadora (30), Tratado sobre Gracia (libro, 60)
  const PLATE_CHEST = 8312, CLOTH_ROBE = 8252, TWO_HAND_SWORD = 2801, DAGGER = 1465, SHIELD = 1203, UNIQUE_RING = 5266, WAND = 5213, LIBRAM = 22402;

  it("cada objeto con datos cabe en alguna ranura (nada queda sin sitio)", () => {
    const sinRanura = [...data.items.values()].filter((i) => slotsForItem(i).length === 0).map((i) => `${i.id}/${i.inventoryType}`);
    expect(sinRanura).toEqual([]);
  });

  it("ranuras: anillos y abalorios en dos, una mano en las dos manos, dos manos y escudo en una sola", () => {
    expect(slotsForItem(item(UNIQUE_RING))).toEqual(["finger1", "finger2"]);
    expect(slotsForItem(item(DAGGER))).toEqual(["mainHand", "offHand"]);
    expect(slotsForItem(item(TWO_HAND_SWORD))).toEqual(["mainHand"]);
    expect(slotsForItem(item(SHIELD))).toEqual(["offHand"]);
    expect(slotsForItem(item(CLOTH_ROBE))).toEqual(["chest"]);
    expect(slotsForItem(item(WAND))).toEqual(["ranged"]);
    expect(slotsForItem(item(LIBRAM))).toEqual(["ranged"]);
  });

  it("armadura: placas a guerrero de nivel 60, no a nivel 40 (necesita nivel 52), no a un mago", () => {
    expect(reasons(PLATE_CHEST, "chest", ctx(WARRIOR))).toEqual([]);
    expect(reasons(PLATE_CHEST, "chest", ctx(WARRIOR, 45))).toEqual(["Necesita nivel 52"]);
    expect(reasons(PLATE_CHEST, "chest", ctx(MAGE))).toContain("Tu clase no puede usar placas");
    expect(reasons(PLATE_CHEST, "chest", ctx(HUNTER))).toContain("Tu clase no puede usar placas");
  });

  it("el nivel de la competencia cuenta aparte del nivel del objeto: un guerrero de nivel 39 no lleva placas aunque el objeto pida menos", () => {
    const lowPlate = [...data.items.values()].find((i) => i.classId === 4 && i.subclassId === 4 && i.inventoryType === 5 && i.requiredLevel > 0 && i.requiredLevel <= 38 && !i.placeholder && i.allowableClass === -1);
    expect(lowPlate, "debe existir una pieza de placas de nivel bajo").toBeTruthy();
    expect(canEquip(lowPlate!, "chest", ctx(WARRIOR, 38), data).reasons).toEqual(["Tu clase solo puede usar placas desde el nivel 40"]);
    expect(canEquip(lowPlate!, "chest", ctx(WARRIOR, 40), data).ok).toBe(true);
  });

  it("armas y varitas: el mago usa varita y no espada a dos manos; el sacerdote no usa dagas en la mano izquierda", () => {
    expect(reasons(WAND, "ranged", ctx(MAGE))).toEqual([]);
    expect(reasons(WAND, "ranged", ctx(WARRIOR))).toContain("Tu clase no puede usar varitas");
    expect(reasons(TWO_HAND_SWORD, "mainHand", ctx(MAGE))).toContain("Tu clase no puede usar espadas de dos manos");
    expect(reasons(TWO_HAND_SWORD, "mainHand", ctx(WARRIOR))).toEqual([]);
  });

  it("doble empuñadura: el pícaro de nivel 10 lleva una daga en la mano izquierda, el de nivel 9 no, el sacerdote nunca", () => {
    const dagger = item(DAGGER);
    expect(canEquip(dagger, "offHand", ctx(ROGUE, 33), data).ok).toBe(true);
    expect(canEquip(dagger, "mainHand", ctx(ROGUE, 33), data).ok).toBe(true);
    expect(canEquip(dagger, "offHand", ctx(PRIEST, 60), data).reasons).toContain("Tu clase no puede usar doble empuñadura");
    // el nivel de la daga (33) manda sobre el de la doble empuñadura: se comprueba la competencia con un objeto de nivel 0
    const lowDagger = { ...dagger, requiredLevel: 0 };
    expect(canEquip(lowDagger, "offHand", ctx(ROGUE, 9), data).reasons).toEqual(["Tu clase solo puede usar doble empuñadura desde el nivel 10"]);
    expect(canEquip(lowDagger, "offHand", ctx(ROGUE, 10), data).ok).toBe(true);
  });

  it("manos: un arma a dos manos y la mano izquierda se excluyen en las dos direcciones", () => {
    const withShield: GearSelection = { offHand: { itemId: SHIELD } };
    expect(reasons(TWO_HAND_SWORD, "mainHand", ctx(WARRIOR), withShield)).toContain("Un arma a dos manos deja libre la mano izquierda");
    const withTwoHand: GearSelection = { mainHand: { itemId: TWO_HAND_SWORD } };
    expect(reasons(SHIELD, "offHand", ctx(WARRIOR), withTwoHand)).toContain("La mano derecha lleva un arma a dos manos");
    // equipItem resuelve el choque vaciando la otra mano
    expect(equipItem(withShield, "mainHand", item(TWO_HAND_SWORD), data.items).offHand).toBeUndefined();
    expect(equipItem(withTwoHand, "offHand", item(SHIELD), data.items).mainHand).toBeUndefined();
    expect(equipItem(withShield, "mainHand", item(DAGGER), data.items).offHand?.itemId).toBe(SHIELD);
  });

  it("objeto único: no se pueden llevar dos Ojos de Adaegus, pero sí uno solo en cualquiera de las dos ranuras", () => {
    expect(reasons(UNIQUE_RING, "finger1", ctx(WARRIOR))).toEqual([]);
    expect(reasons(UNIQUE_RING, "finger2", ctx(WARRIOR), { finger1: { itemId: UNIQUE_RING } })).toEqual(["Objeto único: ya lo llevas en «Anillo 1»"]);
    expect(reasons(UNIQUE_RING, "finger1", ctx(WARRIOR), { finger1: { itemId: UNIQUE_RING } })).toEqual([]); // reemplazarse a sí mismo
  });

  it("categoría de límite: un solo «Dije de batalla» (716) aunque sean objetos distintos, y se puede cambiar el de la misma ranura", () => {
    const limit = (id: number, slot: (typeof GEAR_SLOTS)[number], worn: GearSelection) => reasons(id, slot, ctx(WARRIOR), worn).filter((r) => r.startsWith("Límite"));
    const ARATHOR = 20071, SCAVENGER = 20072; // ambos en la categoría 716, cantidad 1
    expect(item(ARATHOR).limitCategory).toBe(716);
    expect(item(SCAVENGER).limitCategory).toBe(716);
    expect(limit(SCAVENGER, "trinket2", { trinket1: { itemId: ARATHOR } })).toEqual(["Límite de la categoría «Dije de batalla»: solo puedes llevar uno (ya llevas «Abalorio 1»)"]);
    expect(limit(SCAVENGER, "trinket1", { trinket1: { itemId: ARATHOR } })).toEqual([]);
    expect(limit(SCAVENGER, "trinket2", {})).toEqual([]);
  });

  it("reliquias: el libro solo lo usa el paladín (regla nuestra, no del cliente)", () => {
    expect(reasons(LIBRAM, "ranged", ctx(PALADIN))).toEqual([]);
    expect(reasons(LIBRAM, "ranged", ctx(WARRIOR))).toEqual(["Solo la clase de libros puede usarla"]);
  });

  it("ranura equivocada, objeto de prueba, clase y raza restringidas", () => {
    expect(reasons(PLATE_CHEST, "head", ctx(WARRIOR))).toContain("No se lleva en la ranura «Cabeza»");
    const test = { ...item(PLATE_CHEST), placeholder: true };
    expect(canEquip(test, "chest", ctx(WARRIOR), data).reasons).toContain("Objeto de prueba o retirado");
    const rogueOnly = { ...item(PLATE_CHEST), allowableClass: 8 };
    expect(canEquip(rogueOnly, "chest", ctx(WARRIOR), data).reasons).toContain("Tu clase no puede usarlo");
    const orcOnly = { ...item(PLATE_CHEST), allowableRace: 1 << 1 };
    expect(canEquip(orcOnly, "chest", ctx(WARRIOR, 60, HUMAN), data).reasons).toContain("Tu raza no puede usarlo");
    expect(canEquip(orcOnly, "chest", ctx(WARRIOR, 60, 2), data).ok).toBe(true);
    // Cielonato (raza 95/96): no cabe en la máscara de 32 bits, no se bloquea
    expect(canEquip(orcOnly, "chest", ctx(WARRIOR, 60, 95), data).ok).toBe(true);
  });

  it("suma de estadísticas: objetos + sufijo + encantamiento, con su origen", () => {
    const suffixed = [...data.items.values()].find((i) => i.randomSuffixSet !== null && i.statBudget >= 20 && i.classId === 4 && i.inventoryType === 5 && !i.placeholder && i.requiredLevel <= 60)!;
    expect(suffixed, "debe existir una pieza de pecho con sufijo y presupuesto").toBeTruthy();
    const options = suffixOptions(suffixed, data);
    expect(options.length).toBeGreaterThan(0);
    const suffix = data.suffixes.get(options.find((id) => data.suffixes.get(id)?.allocations.length === 2) ?? options[0]!)!;
    const expectedSuffix = suffixStats(suffixed, suffix);
    for (const s of expectedSuffix) expect(s.value).toBe(Math.floor((suffix.allocations.find((a) => a.type === s.type)!.value * suffixed.statBudget) / 10000));

    const chestEnchant = [...data.enchants.values()].find((e) => e.slotType === 5 && e.stats.some((s) => s.key === "stamina"))!;
    const gear: GearSelection = {
      chest: { itemId: suffixed.id, suffixId: suffix.id, enchantId: chestEnchant.effectId },
      finger1: { itemId: UNIQUE_RING },
      offHand: { itemId: SHIELD },
    };
    const summary = summarizeGear(gear, ctx(WARRIOR), data);
    const stamina = summary.lines.find((l) => l.key === "stamina")!;
    // aguante = del anillo (5) + escudo (15) + sufijo/encantamiento si traen aguante + el del objeto
    const parts = [
      ...item(UNIQUE_RING).stats, ...item(SHIELD).stats, ...suffixed.stats, ...expectedSuffix, ...chestEnchant.stats,
    ].filter((s) => s.key === "stamina").reduce((n, s) => n + s.value, 0);
    expect(stamina.value).toBe(parts);
    expect(stamina.sources.map((s) => s.origin)).toContain("enchant");
    expect(summary.stats.stamina).toBe(parts);
    expect(summary.armor).toBeCloseTo(item(SHIELD).armor! + (suffixed.armor ?? 0), 1);
    expect(summary.problems).toEqual([]);
  });

  it("lo que no se puede llevar se sigue sumando y se avisa; un id desconocido sale en `missing`", () => {
    const summary = summarizeGear({ chest: { itemId: PLATE_CHEST }, head: { itemId: 999999999 } }, ctx(MAGE), data);
    expect(summary.problems).toHaveLength(1);
    expect(summary.problems[0]!.reasons).toContain("Tu clase no puede usar placas");
    expect(summary.stats.strength).toBe(17);
    expect(summary.missing).toEqual([{ slot: "head", itemId: 999999999 }]);
  });

  it("conjuntos: cuenta piezas distintas y activa los bonos al llegar al umbral", () => {
    const wearable = (id: number) => data.items.get(id);
    const set = data.sets.find((s) => s.bonuses.some((b) => b.threshold === 2) && s.itemIds.filter((id) => wearable(id) && !wearable(id)!.placeholder).length >= 2 && s.itemIds.every((id) => !wearable(id) || slotsForItem(wearable(id)!).length > 0));
    expect(set, "debe existir un conjunto con dos piezas con datos").toBeTruthy();
    const pieces = set!.itemIds.map(wearable).filter((i): i is NonNullable<typeof i> => !!i && !i.placeholder);
    const gear: GearSelection = {};
    const used = new Set<string>();
    for (const p of pieces) {
      const slot = slotsForItem(p).find((s) => !used.has(s));
      if (slot) {
        used.add(slot);
        gear[slot] = { itemId: p.id };
      }
    }
    const worn = Object.keys(gear).length;
    const progress = summarizeGear(gear, ctx(WARRIOR), data).sets.find((s) => s.setId === set!.id)!;
    expect(progress.count).toBe(worn);
    expect(progress.total).toBe(set!.itemIds.length);
    for (const b of progress.bonuses) expect(b.active).toBe(worn >= b.threshold);
  });

  it("cada objeto cuenta desde su propio nivel: a nivel 40 la daga (33) suma y el peto (52) no, y se avisa", () => {
    const gear: GearSelection = { chest: { itemId: PLATE_CHEST }, mainHand: { itemId: DAGGER } };
    const all = summarizeGear(gear, ctx(WARRIOR), data);
    const at40 = summarizeGear(gear, ctx(WARRIOR), data, { countLevel: 40 });
    const at60 = summarizeGear(gear, ctx(WARRIOR), data, { countLevel: 60 });
    expect(at40.uncounted.map((u) => [u.slot, u.requiredLevel])).toEqual([["chest", 52]]);
    expect(at40.armor).toBe(0);
    expect(at40.weapons.map((w) => w.slot)).toEqual(["mainHand"]);
    expect(at40.weapons[0]!.subclassId).toBe(item(DAGGER).subclassId);
    expect(at40.weapons[0]!.inventoryType).toBe(item(DAGGER).inventoryType);
    expect(at60.uncounted).toEqual([]);
    expect(at60.armor).toBe(all.armor);
    expect(at60.stats).toEqual(all.stats);
    // Sin countLevel todo cuenta (como siempre)
    expect(all.uncounted).toEqual([]);
  });

  it("los objetos que no cuentan tampoco cuentan para los conjuntos", () => {
    const set = data.sets.find((s) => s.itemIds.length >= 3 && s.itemIds.some((id) => (data.items.get(id)?.requiredLevel ?? 0) >= 50) && s.itemIds.some((id) => (data.items.get(id)?.requiredLevel ?? 0) < 20));
    if (!set) return;
    const gear: GearSelection = {};
    const used = new Set<string>();
    for (const id of set.itemIds) {
      const it = data.items.get(id);
      const slot = it && slotsForItem(it).find((s) => !used.has(s));
      if (it && slot) {
        used.add(slot);
        gear[slot] = { itemId: id };
      }
    }
    const all = summarizeGear(gear, ctx(WARRIOR), data, { countLevel: 60 }).sets.find((s) => s.setId === set.id)!;
    const low = summarizeGear(gear, ctx(WARRIOR), data, { countLevel: 10 }).sets.find((s) => s.setId === set.id);
    expect((low?.count ?? 0)).toBeLessThan(all.count);
  });

  it("comparar: cambiar el pecho resta lo que llevas y suma lo nuevo; el mismo objeto no compara; un arma a dos manos quita la mano izquierda", () => {
    const wornPlate: GearSelection = { chest: { itemId: PLATE_CHEST } };
    expect(compareGear(wornPlate, "chest", item(PLATE_CHEST), ctx(WARRIOR), data)).toBeNull();
    const cmp = compareGear(wornPlate, "chest", item(CLOTH_ROBE), ctx(WARRIOR), data)!;
    const plate = summarizeGear(wornPlate, ctx(WARRIOR), data);
    const robe = summarizeGear({ chest: { itemId: CLOTH_ROBE } }, ctx(WARRIOR), data);
    for (const d of cmp.stats) {
      expect(d.before).toBe(plate.stats[d.key] ?? 0);
      expect(d.after).toBe(robe.stats[d.key] ?? 0);
      expect(d.before).not.toBe(d.after);
    }
    expect(cmp.armor).toEqual({ before: Math.round(plate.armor), after: Math.round(robe.armor) });
    const swords = compareGear({ mainHand: { itemId: DAGGER }, offHand: { itemId: SHIELD } }, "mainHand", item(TWO_HAND_SWORD), ctx(WARRIOR), data)!;
    expect(swords.weaponDps.after).toBeGreaterThan(swords.weaponDps.before);
    // la mano izquierda desaparece: su armadura (el escudo) deja de contar
    expect(swords.armor.after).toBeLessThan(swords.armor.before);
  });

  it("encantamientos: el de pecho solo al pecho, el de dos manos solo a un arma a dos manos, el de escudo solo a un escudo", () => {
    const named = (re: RegExp) => [...data.enchants.values()].find((e) => re.test(e.nameEn))!;
    const chest = named(/^Enchant Chest/);
    expect(enchantFits(chest, "chest", item(PLATE_CHEST))).toBe(true);
    expect(enchantFits(chest, "head", undefined)).toBe(false);
    const twoHand = named(/^Enchant 2H Weapon/);
    expect(enchantFits(twoHand, "mainHand", item(TWO_HAND_SWORD))).toBe(true);
    expect(enchantFits(twoHand, "mainHand", item(DAGGER))).toBe(false);
    const shield = named(/^Enchant Shield/);
    expect(enchantFits(shield, "offHand", item(SHIELD))).toBe(true);
    expect(enchantFits(shield, "mainHand", item(DAGGER))).toBe(false);
    const weapon = named(/^Enchant Weapon/);
    expect(enchantFits(weapon, "mainHand", item(DAGGER))).toBe(true);
    expect(enchantFits(weapon, "offHand", item(SHIELD))).toBe(false);
  });

  it("encantamientos: un efecto que el cliente comparte entre ranuras (mismo effectId) sale en todas ellas, no solo en la de la última entrada", () => {
    const stamina = data.enchantEntries.filter((e) => e.effectId === 66);
    expect(stamina.map((e) => e.slotType).sort((a, b) => a - b)).toEqual([6, 10, 13]);
    const wrist = enchantOptions(data, "wrist", undefined).map((e) => e.effectId);
    const feet = enchantOptions(data, "feet", undefined).map((e) => e.effectId);
    expect(wrist).toContain(66);
    expect(feet).toContain(66);
    // sin repetir: cada efecto una vez por ranura
    expect(new Set(wrist).size).toBe(wrist.length);
  });

  it("auditoría: ninguna entrada de encantamiento queda oculta: su efecto se ofrece en alguna ranura con algún objeto", () => {
    const items = [...data.items.values()].filter((i) => !i.placeholder);
    const offered = new Set<number>();
    for (const slot of GEAR_SLOTS) for (const i of items) if (slotsForItem(i).includes(slot)) for (const e of enchantOptions(data, slot, i)) offered.add(e.effectId);
    const hidden = data.enchantEntries.filter((e) => !offered.has(e.effectId)).map((e) => `${e.effectId} ${e.nameEn}`);
    expect(hidden).toEqual([]);
    expect(data.enchantEntries.length).toBeGreaterThan(data.enchants.size);
  });

  it("auditoría: todo encantamiento cabe en alguna ranura con algún objeto", () => {
    const items = [...data.items.values()].filter((i) => !i.placeholder);
    const sin: string[] = [];
    for (const e of data.enchants.values()) {
      const fits = GEAR_SLOTS.some((slot) => items.some((i) => slotsForItem(i).includes(slot) && enchantFits(e, slot, i)));
      if (!fits) sin.push(`${e.effectId} ${e.nameEn}`);
    }
    expect(sin).toEqual([]);
  });

  it("auditoría: todo objeto con datos puede llevarlo alguna clase a nivel 60 (si no, las competencias o la ranura fallan)", () => {
    const classes = [1, 2, 3, 4, 5, 7, 8, 9, 11];
    const nadie: string[] = [];
    for (const i of data.items.values()) {
      if (i.placeholder || i.provenance !== "client-db2") continue;
      const ok = slotsForItem(i).some((slot) => classes.some((c) => canEquip({ ...i, requiredLevel: 0, allowableRace: -1 }, slot, ctx(c, 60), data).ok));
      if (!ok) nadie.push(`${i.id} ${i.name} (tipo ${i.inventoryType}, subclase ${i.classId}/${i.subclassId}, clases ${i.allowableClass})`);
    }
    expect(nadie).toEqual([]);
  });

  it("puntuaciones: se convierten con combat-ratings.json (crítico 14, impacto 10, esquivar 12, defensa 1 por punto)", () => {
    const ratings = CombatRatings.parse(json("combat-ratings.json"));
    const out = ratingPercents({ "crit-rating": 28, "hit-rating": 15, "dodge-rating": 24, defense: 5, "haste-rating": 0, strength: 100 }, ratings);
    const by = Object.fromEntries(out.map((r) => [r.stat, r]));
    expect(by["crit-rating"]!.value).toBe(2);
    expect(by["hit-rating"]!.value).toBe(1.5);
    expect(by["dodge-rating"]!.value).toBe(2);
    expect(by.defense).toMatchObject({ value: 5, unit: "pts" });
    expect(by["haste-rating"]).toBeUndefined();
    expect(by.strength).toBeUndefined();
  });

  it("impacto y crítico del equipo: 15 de impacto = 1,5 %, 28 de crítico = 2 %; sin equipo, 0", () => {
    const ratings = CombatRatings.parse(json("combat-ratings.json"));
    expect(gearChanceBonus({ "crit-rating": 28, "hit-rating": 15, strength: 50 }, ratings)).toEqual({ hitPct: 1.5, critPct: 2 });
    expect(gearChanceBonus({}, ratings)).toEqual({ hitPct: 0, critPct: 0 });
  });

  it("poder con hechizos: el genérico suma a daño y sanación, «sanación» solo a la sanación", () => {
    expect(gearSpellPower({ "spell-power": 10, "spell-damage": 5, "healing-power": 20 })).toEqual({ damage: 15, healing: 30 });
  });
});

describe("enlace del equipo", () => {
  it("ida y vuelta: una letra por ranura, el id, y encantamiento (e) y sufijo (x) si los hay", () => {
    const gear: GearSelection = { head: { itemId: 1234, enchantId: 99 }, ranged: { itemId: 500, suffixId: 12700 }, mainHand: { itemId: 7, enchantId: 3, suffixId: 4 } };
    const code = encodeGear(gear);
    expect(code).toBe("a1234e99.q7e3x4.s500x12700");
    expect(decodeGear(code)).toEqual({ gear: { head: { itemId: 1234, enchantId: 99, suffixId: null }, mainHand: { itemId: 7, enchantId: 3, suffixId: 4 }, ranged: { itemId: 500, enchantId: null, suffixId: 12700 } }, malformed: 0 });
    expect(encodeGear({})).toBe("");
  });

  it("cada ranura tiene su letra y las entradas mal formadas se cuentan sin romper las demás", () => {
    expect(GEAR_SLOTS).toHaveLength(19);
    for (const [i, slot] of GEAR_SLOTS.entries()) expect(Object.keys(decodeGear(encodeGear({ [slot]: { itemId: i + 1 } })).gear)).toEqual([slot]);
    expect(decodeGear("a10.zz9.b.t5.c20e")).toEqual({ gear: { head: { itemId: 10, enchantId: null, suffixId: null } }, malformed: 4 });
    expect(decodeGear(null)).toEqual({ gear: {}, malformed: 0 });
  });
});

describe("deriveStats con equipo", () => {
  const base = { attributes: [100, 100, 100, 100, 100] as [number, number, number, number, number], hpBase: 0, manaBase: 100 };

  it("el equipo se suma al atributo antes de los % de talentos, y la base de vida y maná lo incluye", () => {
    const sta = { category: "Atributos, salud y recursos" as const, label: "Aguante", value: 10, unit: "%" as const, scope: null, target: "sta" as const, sources: [] };
    const { rows } = deriveStats({ ...base, totals: [sta], gear: { stamina: 20, intellect: 10, health: 50, mana: 30 } });
    const get = (k: string) => rows.find((r) => r.key === k)!;
    expect(get("sta")).toMatchObject({ base: 100, gear: 20, final: 132 }); // (100 + 20) x 1,10
    expect(get("int")).toMatchObject({ base: 100, gear: 10, final: 110 });
    // vida sin talentos: 20 + (120 - 20) x 10 + 50 = 1070; con aguante 132: 20 + 112 x 10 + 50 = 1190
    expect(get("health")).toMatchObject({ base: 1070, gear: 50, final: 1190 });
    // maná: 100 + (20 + 90 x 15 = 1370 con 110 de intelecto) + 30
    expect(get("mana")).toMatchObject({ base: 100 + 1370 + 30, gear: 30 });
  });

  it("poder de ataque y poder con hechizos del equipo salen aunque no haya talentos", () => {
    const { rows } = deriveStats({ ...base, totals: [], attackPower: { perStrength: 2, perAgility: 1, rangedPerAgility: 1 }, gear: { strength: 10, "attack-power": 40, "ranged-attack-power": 25, "spell-power": 30, "healing-power": 10 } });
    const get = (k: string) => rows.find((r) => r.key === k);
    expect(get("ap")).toMatchObject({ base: 110 * 2 + 100 + 40, final: 110 * 2 + 100 + 40, gear: 40 });
    expect(get("rap")).toMatchObject({ base: 100 + 25 + 40, final: 165 }); // el poder de ataque del equipo suma también a distancia (Classic)
    expect(get("spell-damage")).toMatchObject({ base: 30, final: 30 });
    expect(get("spell-healing")).toMatchObject({ base: 40, final: 40 });
  });

  it("sin equipo no cambia nada: las filas de poder con hechizos no aparecen", () => {
    const { rows } = deriveStats({ ...base, totals: [] });
    expect(rows.find((r) => r.key === "spell-damage")).toBeUndefined();
    expect(rows.every((r) => r.gear === 0)).toBe(true);
  });
});
