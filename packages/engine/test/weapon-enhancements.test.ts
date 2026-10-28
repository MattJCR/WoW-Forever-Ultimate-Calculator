import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Enchants, EquipRules, Items, WeaponEnhancements } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import {
  GEAR_SLOTS,
  autoAttacks,
  decodeGear,
  encodeGear,
  enhancementFits,
  enhancementOptions,
  indexGearData,
  powerContext,
  summarizeGear,
  type GearContext,
  type GearSelection,
} from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
const has = ["items.json", "equip-rules.json", "weapon-enhancements.json"].every((f) => existsSync(join(D, f)));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

const ROGUE = 4, MAGE = 8, WARRIOR = 1;
const ctx = (classId: number, level = 60): GearContext => ({ classId, raceId: 1, level });
// Objetos de prueba del cliente
const SWORD = 851; // Alfanje (espada de una mano)
const MACE = 852; // Maza (una mano)
const DAGGER = 816; // Hoja de mano pequeña
const STAFF = 767; // Bastón largo bo (dos manos)
// Mejoras
const SHARPENING_2 = 2862; // Piedra de afilar férrea: +2 de daño, armas cortantes
const WEIGHTSTONE_2 = 3239; // Contrapeso férreo: +2 de daño, armas contundentes
const ELEMENTAL_STONE = 18262; // Piedra de afilar elemental: +2 % de crítico
const INSTANT_POISON = 6947; // Veneno instantáneo: solo pícaros
const WIZARD_OIL = 20744; // Aceite de zahorí menor

describe.skipIf(!has)("mejoras temporales de arma (cliente 1.60.1.70658 con hotfixes)", () => {
  const enhancements = WeaponEnhancements.parse(json("weapon-enhancements.json"));
  const data = indexGearData({
    items: Items.parse(json("items.json")),
    rules: EquipRules.parse(json("equip-rules.json")),
    enchants: existsSync(join(D, "enchants.json")) ? Enchants.parse(json("enchants.json")) : null,
    weaponEnhancements: enhancements,
  });
  const item = (id: number) => data.items.get(id)!;
  const enh = (id: number) => data.enhancements.get(id)!;

  it("el volcado trae las mejoras del cliente y deja con motivo las que no ofrece", () => {
    expect(enhancements.enhancements.length).toBeGreaterThan(70);
    for (const id of [SHARPENING_2, WEIGHTSTONE_2, ELEMENTAL_STONE, INSTANT_POISON, WIZARD_OIL]) expect(data.enhancements.has(id), `falta ${id}`).toBe(true);
    // Los cebos de pesca y los objetos de prueba no se ofrecen, pero no se pierden en silencio
    expect(enhancements.skipped.length).toBeGreaterThan(0);
    for (const s of enhancements.skipped) expect(s.reason).not.toBe("");
    // Las piedras de afilar suman daño por golpe; los venenos llevan su probabilidad (el cliente la trae en el encantamiento)
    expect(enh(SHARPENING_2).kind).toBe("damage");
    expect(enh(SHARPENING_2).stats).toEqual([{ type: 83, key: "physical-damage", value: 2 }]);
    expect(enh(INSTANT_POISON).kind).toBe("proc");
    expect(enh(INSTANT_POISON).effects[0]!.proc?.chancePct).toBe(20);
  });

  it("dónde se aplica: afilar a cortantes, contrapeso a contundentes, veneno solo a pícaros, nada fuera de las manos", () => {
    expect(enhancementFits(enh(SHARPENING_2), "mainHand", item(SWORD), WARRIOR)).toBe(true);
    expect(enhancementFits(enh(SHARPENING_2), "mainHand", item(DAGGER), WARRIOR)).toBe(true);
    expect(enhancementFits(enh(SHARPENING_2), "mainHand", item(MACE), WARRIOR)).toBe(false);
    expect(enhancementFits(enh(WEIGHTSTONE_2), "mainHand", item(MACE), WARRIOR)).toBe(true);
    expect(enhancementFits(enh(WEIGHTSTONE_2), "mainHand", item(SWORD), WARRIOR)).toBe(false);
    expect(enhancementFits(enh(INSTANT_POISON), "offHand", item(DAGGER), ROGUE)).toBe(true);
    expect(enhancementFits(enh(INSTANT_POISON), "mainHand", item(DAGGER), WARRIOR)).toBe(false);
    expect(enhancementFits(enh(SHARPENING_2), "head", item(SWORD), WARRIOR)).toBe(false);
    expect(enhancementFits(enh(SHARPENING_2), "ranged", item(SWORD), WARRIOR)).toBe(false);
    // Lo que ofrece una ranura sale por tipo (daño, probabilidad, estadísticas)
    const opts = enhancementOptions(data, "mainHand", item(SWORD), WARRIOR);
    expect(opts.some((e) => e.itemId === SHARPENING_2)).toBe(true);
    expect(opts.some((e) => e.itemId === INSTANT_POISON)).toBe(false);
    expect(enhancementOptions(data, "mainHand", item(SWORD), ROGUE).some((e) => e.itemId === INSTANT_POISON)).toBe(true);
    expect(enhancementOptions(data, "mainHand", item(SWORD), MAGE).every((e) => e.classMask === 0 || (e.classMask & (1 << (MAGE - 1))) !== 0)).toBe(true);
  });

  it("el «+N de daño» de una piedra de afilar va solo a esa arma, no a las dos manos ni al resto del equipo", () => {
    const gear: GearSelection = { mainHand: { itemId: SWORD, tempId: SHARPENING_2 }, offHand: { itemId: DAGGER } };
    const s = summarizeGear(gear, ctx(ROGUE), data);
    expect(s.weapons.find((w) => w.slot === "mainHand")!.bonusDamage).toBe(2);
    expect(s.weapons.find((w) => w.slot === "offHand")!.bonusDamage).toBe(0);
    expect(s.physicalDamage).toBe(0);
    expect(s.problems).toEqual([]);
  });

  it("el golpe automático suma el daño de la mejora a esa arma", () => {
    const base = summarizeGear({ mainHand: { itemId: SWORD } }, ctx(WARRIOR), data);
    const withStone = summarizeGear({ mainHand: { itemId: SWORD, tempId: SHARPENING_2 } }, ctx(WARRIOR), data);
    const swing = (g: typeof base) => autoAttacks(powerContext({ rows: [] } as never, g.stats, g.weapons), { melee: 0, ranged: 0 })[0]!;
    expect(swing(withStone).average - swing(base).average).toBeCloseTo(2, 5);
    expect(swing(withStone).formula).toContain("daño añadido al arma");
  });

  it("el «+N de daño» de un encantamiento de arma también es de esa arma", () => {
    // Daño de arma +2 (encantamiento 241) en la mano derecha; la izquierda no lo recibe
    const gear: GearSelection = { mainHand: { itemId: SWORD, enchantId: 241 }, offHand: { itemId: DAGGER } };
    const s = summarizeGear(gear, ctx(ROGUE), data);
    expect(s.weapons.find((w) => w.slot === "mainHand")!.bonusDamage).toBe(2);
    expect(s.weapons.find((w) => w.slot === "offHand")!.bonusDamage).toBe(0);
    expect(s.physicalDamage).toBe(0);
  });

  it("los efectos al equipar (piedra elemental: +2 % de crítico) y los procs (veneno) van con el arma y con su origen", () => {
    const gear: GearSelection = { mainHand: { itemId: DAGGER, tempId: ELEMENTAL_STONE }, offHand: { itemId: DAGGER, tempId: INSTANT_POISON } };
    const s = summarizeGear(gear, ctx(ROGUE), data);
    expect(s.effects.some((e) => e.slot === "offHand" && e.effect.proc?.chancePct === 20 && e.itemName.includes("Veneno instantáneo"))).toBe(true);
    expect(s.problems).toEqual([]);
  });

  it("una mejora que no cabe en el arma se sigue sumando y se avisa", () => {
    const s = summarizeGear({ mainHand: { itemId: MACE, tempId: SHARPENING_2 } }, ctx(WARRIOR), data);
    expect(s.weapons[0]!.bonusDamage).toBe(2);
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]!.reasons[0]).toContain("no se puede aplicar");
  });

  it("el código del enlace lleva la mejora y se lee de vuelta", () => {
    const gear: GearSelection = { mainHand: { itemId: SWORD, enchantId: 241, tempId: SHARPENING_2 }, offHand: { itemId: DAGGER, tempId: INSTANT_POISON } };
    const code = encodeGear(gear);
    expect(code).toContain(`t${SHARPENING_2}`);
    const back = decodeGear(code);
    expect(back.malformed).toBe(0);
    expect(back.gear.mainHand).toEqual({ itemId: SWORD, enchantId: 241, suffixId: null, tempId: SHARPENING_2 });
    expect(back.gear.offHand).toMatchObject({ itemId: DAGGER, tempId: INSTANT_POISON });
    // Sin mejora, el código es el de siempre
    expect(encodeGear({ mainHand: { itemId: SWORD } })).toBe(`${"abcdefghijklmnopqrs"[GEAR_SLOTS.indexOf("mainHand")]}${SWORD}`);
  });

  it("auditoría: cada mejora se ofrece a alguna clase en alguna mano con algún arma, y su tipo coincide con lo que da", () => {
    const weapons = [...data.items.values()].filter((i) => !i.placeholder && (i.classId === 2 || i.subclassId === 6) && [13, 14, 17, 21, 22].includes(i.inventoryType));
    const nowhere: string[] = [];
    for (const e of data.enhancementList) {
      const offered = [1, 2, 3, 4, 5, 7, 8, 9, 11].some((c) => (["mainHand", "offHand"] as const).some((slot) => weapons.some((w) => enhancementFits(e, slot, w, c))));
      if (!offered) nowhere.push(`${e.itemId} ${e.name}`);
      expect(e.name, `mejora ${e.itemId}`).not.toBe("");
      expect(e.durationMs).toBeGreaterThan(0);
      if (e.kind === "damage") expect(e.stats.some((s) => s.key === "physical-damage")).toBe(true);
      if (e.kind === "proc") expect(e.effects.some((x) => x.trigger === 2)).toBe(true);
    }
    // Exacto: si el cliente trae una mejora que no cabe en ninguna arma, se decide aquí (no se calla)
    expect(nowhere).toEqual([]);
  });
});
