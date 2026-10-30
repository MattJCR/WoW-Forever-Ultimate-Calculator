import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import {
  applyModifiers,
  autoAttacks,
  collectStatEffects,
  damageDonePct,
  describeEquipped,
  equippedStateOf,
  findAbility,
  indexClass,
  meetsEquipped,
  offHandFactorOf,
  powerEstimate,
  rankAtLevel,
  spellModifiersOf,
  type EquippedState,
  type PowerContext,
} from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70685");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const legacy = indexClass(ClassTalents.parse(json("legacy.json")));
const warrior = indexClass(ClassTalents.parse(json("classes/warrior.json")));
const warriorAbilities = Abilities.parse(json("abilities/warrior.json"));
const rogueAbilities = Abilities.parse(json("abilities/rogue.json"));
const shamanAbilities = Abilities.parse(json("abilities/shaman.json"));

const worn = (slot: "mainHand" | "offHand" | "ranged", subclassId: number, inventoryType: number, itemClass = 2): EquippedState => ({ items: [{ slot, itemClass, subclassId, inventoryType }] });
const twoHandSword = worn("mainHand", 8, 17);
const dagger = worn("mainHand", 15, 13);
const shield: EquippedState = { items: [{ slot: "offHand", itemClass: 4, subclassId: 6, inventoryType: 14 }] };

const weapon = (min: number, max: number, speed: number, normalizedSpeed: number, usesAttackPower = true) => ({ min, max, speed, normalizedSpeed, usesAttackPower });
const ctx = (over: Partial<PowerContext> = {}): PowerContext => ({
  spellDamage: 0, spellHealing: 0, schoolPower: { 2: 0, 4: 0, 8: 0, 16: 0, 32: 0, 64: 0 }, attackPower: 280, rangedAttackPower: 140,
  mainHand: weapon(50, 70, 2.8, 2.4), offHand: weapon(30, 50, 1.4, 1.7), ranged: null, physicalDamage: 0, offHandFactor: 0.5, ...over,
});
const modified = (data: Abilities, name: string) => applyModifiers(rankAtLevel(findAbility(data, name)!, 60)!, 60, []);

describe("requisitos de objeto equipado (SpellEquippedItems)", () => {
  it("las armas de dos manos, la varita y el escudo se reconocen por su subtipo", () => {
    const twoHand = warrior.ordered.find((i) => i.talent.spellId === 12163)!.talent;
    expect(twoHand.equipped.length).toBeGreaterThan(0);
    expect(meetsEquipped(twoHand.equipped, twoHandSword)).toBe(true);
    expect(meetsEquipped(twoHand.equipped, dagger)).toBe(false);
    expect(describeEquipped(twoHand.equipped)).toBe("un arma a dos manos");
    const bastion = warrior.ordered.find((i) => i.talent.spellId === 16538)!.talent;
    expect(meetsEquipped(bastion.equipped, shield)).toBe(true);
    expect(meetsEquipped(bastion.equipped, twoHandSword)).toBe(false);
    expect(describeEquipped(bastion.equipped)).toBe("un escudo");
  });

  it("sin equipo elegido o sin requisito se da por cumplido", () => {
    expect(meetsEquipped([{ itemClass: 2, invTypeMask: 0, subclassMask: 1 << 19 }], null)).toBe(true);
    expect(meetsEquipped([], dagger)).toBe(true);
    expect(equippedStateOf({}, { items: new Map() })).toBeNull();
  });

  it("un arma en la mano izquierda cumple el requisito de doble empuñadura (arma de la mano izquierda)", () => {
    const dualWield = warrior.ordered.find((i) => i.talent.spellId === 23584)!.talent;
    expect(meetsEquipped(dualWield.equipped, worn("offHand", 7, 13))).toBe(true);
    expect(meetsEquipped(dualWield.equipped, worn("mainHand", 7, 13))).toBe(false);
  });

  it("Especialización en armas de dos manos suma su % de daño físico solo con un arma a dos manos; sin ella queda con el motivo", () => {
    const talent = warrior.ordered.find((i) => i.talent.spellId === 12163)!.talent;
    const classBuild = { [talent.nodeId]: talent.maxRank };
    const run = (equipped: EquippedState) => collectStatEffects({ cls: warrior, classBuild, legacy, legacyBuild: {}, race: null, abilities: warriorAbilities, equipped });
    const with2h = run(twoHandSword);
    expect(damageDonePct(with2h, 1)).toBeGreaterThan(0);
    expect(with2h.conditional.some((c) => c.source.name === talent.name)).toBe(false);
    const withDagger = run(dagger);
    expect(damageDonePct(withDagger, 1)).toBe(0);
    expect(withDagger.conditional.find((c) => c.source.name === talent.name)?.blocked).toBe("Necesitas llevar un arma a dos manos");
    // Sin equipo elegido se queda como texto, como siempre (no se supone que lo cumpla)
    const none = run(null);
    expect(damageDonePct(none, 1)).toBe(0);
    expect(none.conditional.find((c) => c.source.name === talent.name)?.blocked).toBeUndefined();
  });

  it("los modificadores de hechizo que exigen un objeto solo valen si se lleva", () => {
    const needs = warrior.ordered.find((i) => i.talent.equipped.length > 0 && i.talent.effectInfo.some((e) => e.aura === 107 || e.aura === 108));
    if (!needs) return;
    const b = { [needs.talent.nodeId]: needs.talent.maxRank };
    const ok = { items: [{ slot: "mainHand" as const, itemClass: 2, subclassId: 7, inventoryType: 13 }] };
    expect(spellModifiersOf(warrior, b, ok).length).toBeGreaterThanOrEqual(spellModifiersOf(warrior, b, shield).length);
    expect(spellModifiersOf(warrior, b, null).length).toBeGreaterThanOrEqual(spellModifiersOf(warrior, b, shield).length);
  });

  it("las habilidades que exigen un arma lo traen (Mutilar: una daga)", () => {
    const mutilate = findAbility(rogueAbilities, "Mutilar")!.ranks.at(-1)!;
    expect(describeEquipped(mutilate.equipped)).toBe("una daga");
    expect(meetsEquipped(mutilate.equipped, dagger)).toBe(true);
    expect(meetsEquipped(mutilate.equipped, twoHandSword)).toBe(false);
  });
});

describe("golpe de arma: mano izquierda, dos armas y «+N de daño»", () => {
  const mutilate = modified(rogueAbilities, "Mutilar");
  const flurry = modified(warriorAbilities, "Huracán");
  const lava = modified(shamanAbilities, "Latigazo de lava");

  it("la mano izquierda de cada habilidad sale del cliente: ambas armas, solo la izquierda o la derecha", () => {
    expect(mutilate.rank.weaponHand).toBe("both");
    expect(flurry.rank.weaponHand).toBe("both");
    expect(lava.rank.weaponHand).toBe("off");
    expect(modified(rogueAbilities, "Puñalada").rank.weaponHand).toBe("main");
  });

  it("Mutilar suma las dos armas, la de la izquierda con la fracción de daño de esa mano", () => {
    const both = powerEstimate(mutilate, ctx())!.weapon!;
    const mainOnly = powerEstimate(mutilate, ctx({ offHand: null }));
    expect(mainOnly.weapon).toBeNull();
    const offZero = powerEstimate(mutilate, ctx({ offHandFactor: 0 }))!.weapon!;
    const offFull = powerEstimate(mutilate, ctx({ offHandFactor: 1 }))!.weapon!;
    expect(offFull.average - offZero.average).toBeCloseTo(2 * (offFull.average - both.average), 5);
    expect(both.formula).toContain("mano derecha");
    expect(both.formula).toContain("mano izquierda");
    expect(both.average).toBeGreaterThan(offZero.average);
  });

  it("las habilidades de la mano izquierda usan solo esa arma y no hay estimación sin ella", () => {
    expect(powerEstimate(lava, ctx({ offHand: null })).weapon).toBeNull();
    const withOff = powerEstimate(lava, ctx())!.weapon!;
    const bigger = powerEstimate(lava, ctx({ offHand: weapon(300, 500, 1.4, 1.7) }))!.weapon!;
    expect(bigger.average).toBeGreaterThan(withOff.average);
    expect(powerEstimate(lava, ctx({ mainHand: null })).weapon).not.toBeNull();
  });

  it("«+N de daño» del equipo se suma a cada golpe de arma, de cada mano", () => {
    const plain = powerEstimate(mutilate, ctx())!.weapon!;
    const bonus = powerEstimate(mutilate, ctx({ physicalDamage: 10 }))!.weapon!;
    // 75 % de daño de arma: +10 en la derecha y +10 × 0,5 en la izquierda, todo × 0,75
    expect(bonus.average - plain.average).toBeCloseTo(10 * 1.5 * 0.75, 5);
    expect(bonus.formula).toContain("de daño del equipo");
  });

  it("el % de daño (talentos, daño infligido) multiplica el golpe entero, arma y poder de ataque incluidos, una sola vez", () => {
    const rank = rankAtLevel(findAbility(warriorAbilities, "Golpe heroico")!, 60)!;
    const plain = powerEstimate(applyModifiers(rank, 60, []), ctx())!.weapon!;
    const boosted = powerEstimate(applyModifiers(rank, 60, [], { damageDonePct: 10 }), ctx())!.weapon!;
    expect(boosted.average / plain.average).toBeCloseTo(1.1, 5);
  });

  it("las varitas no usan el poder de ataque", () => {
    const wand = powerEstimate(modified(warriorAbilities, "Huracán"), ctx({ mainHand: weapon(10, 20, 2, 2, false), offHand: weapon(10, 20, 2, 2, false) }))!.weapon!;
    const withAp = powerEstimate(modified(warriorAbilities, "Huracán"), ctx({ mainHand: weapon(10, 20, 2, 2, true), offHand: weapon(10, 20, 2, 2, true) }))!.weapon!;
    expect(withAp.average).toBeGreaterThan(wand.average);
  });
});

describe("Especialización en doble empuñadura", () => {
  it("el «daño del arma de la mano izquierda» de los talentos multiplica la fracción base (0,5 × 1,1) y entra en los golpes", () => {
    const talent = warrior.ordered.find((i) => i.talent.spellId === 23584)!.talent;
    const fx = collectStatEffects({ cls: warrior, classBuild: { [talent.nodeId]: talent.maxRank }, legacy, legacyBuild: {}, race: null, abilities: warriorAbilities, equipped: worn("offHand", 7, 13) });
    const bonus = fx.totals.find((t) => t.label === "daño del arma de la mano izquierda")!;
    expect(bonus.value).toBeGreaterThan(0);
    const factor = offHandFactorOf(0.5, fx.totals);
    expect(factor).toBeCloseTo(0.5 * (1 + bonus.value / 100), 6);
    const [, plain] = autoAttacks(ctx(), { melee: 0, ranged: 0 });
    const [, boosted] = autoAttacks(ctx({ offHandFactor: factor }), { melee: 0, ranged: 0 });
    expect(boosted!.average / plain!.average).toBeCloseTo(factor / 0.5, 6);
    expect(offHandFactorOf(0.5, [])).toBe(0.5);
  });
});

describe("golpes automáticos", () => {
  it("cada golpe es arma + «+N de daño» + PA ÷ 14 × velocidad; la mano izquierda hace su fracción y la celeridad acorta el tiempo", () => {
    const [main, off] = autoAttacks(ctx({ physicalDamage: 4 }), { melee: 10, ranged: 0 });
    expect(main!.hand).toBe("main");
    expect(main!.average).toBeCloseTo(60 + 4 + (280 / 14) * 2.8, 5);
    expect(main!.hastedSpeed).toBeCloseTo(2.8 / 1.1, 5);
    expect(main!.dps).toBeCloseTo(main!.average / (2.8 / 1.1), 5);
    expect(off!.hand).toBe("off");
    expect(off!.average).toBeCloseTo((40 + 4 + (280 / 14) * 1.4) * 0.5, 5);
  });

  it("sin armas no hay golpes y el arma a distancia usa el poder de ataque a distancia", () => {
    expect(autoAttacks(ctx({ mainHand: null, offHand: null }), { melee: 0, ranged: 0 })).toEqual([]);
    const [r] = autoAttacks(ctx({ mainHand: null, offHand: null, ranged: weapon(100, 140, 3, 2.8) }), { melee: 0, ranged: 0 });
    expect(r!.hand).toBe("ranged");
    expect(r!.average).toBeCloseTo(120 + (140 / 14) * 3, 5);
  });
});
