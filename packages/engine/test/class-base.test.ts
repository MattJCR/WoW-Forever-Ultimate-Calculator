import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClientStats, CombatFormulas } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { baseAttackPower, classBaseOf, deriveCombatStats, deriveStats, dodgePerAgility, spiritManaPer5s } from "../src/index.js";

/**
 * Contraste permanente con la comunidad (simulador de DPS de Forever, MIT; solo se contrastan cifras): atributos de combate por clase a nivel 60
 * leidos de hojas de personaje desnudas de la beta y del tooltip del juego. Los valores que el cliente SI trae (critico por atributo, mana base y
 * poder de ataque por atributo) deben coincidir con ellos; los que no trae (critico y esquive base, poder de ataque base, regeneracion por espiritu)
 * viven en data/rules/combat-formulas.json con procedencia community.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70707");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const formulas = CombatFormulas.parse(json("combat-formulas.json"));
const client = ClientStats.parse(json("client-stats.json"));

/** classId -> cifras de la comunidad a nivel 60 (porcentaje por punto de agilidad / intelecto, maná base, PA por atributo). */
const COMMUNITY: Record<number, { critPerAgi: number; critPerInt: number; mana: number; apStr: number; apAgi: number; rapAgi: number; hp: number }> = {
  1: { critPerAgi: 0.05, critPerInt: 0, mana: 0, apStr: 2, apAgi: 0, rapAgi: 0, hp: 1689 },
  2: { critPerAgi: 0.0506, critPerInt: 0.0167, mana: 1512, apStr: 2, apAgi: 0, rapAgi: 0, hp: 1381 },
  3: { critPerAgi: 0.0189, critPerInt: 0.0165, mana: 1720, apStr: 1, apAgi: 1, rapAgi: 2, hp: 1467 },
  4: { critPerAgi: 0.0345, critPerInt: 0, mana: 0, apStr: 1, apAgi: 1, rapAgi: 0, hp: 1523 },
  5: { critPerAgi: 0.05, critPerInt: 0.0168, mana: 1376, apStr: 1, apAgi: 0, rapAgi: 0, hp: 1397 },
  7: { critPerAgi: 0.0508, critPerInt: 0.0169, mana: 1520, apStr: 2, apAgi: 0, rapAgi: 0, hp: 1280 },
  8: { critPerAgi: 0.0514, critPerInt: 0.0168, mana: 1213, apStr: 1, apAgi: 0, rapAgi: 0, hp: 1370 },
  9: { critPerAgi: 0.05, critPerInt: 0.0165, mana: 1373, apStr: 1, apAgi: 0, rapAgi: 0, hp: 1414 },
  11: { critPerAgi: 0.05, critPerInt: 0.0167, mana: 1244, apStr: 2, apAgi: 0, rapAgi: 0, hp: 1483 },
};

describe("contraste con la comunidad: lo que trae el cliente coincide en las 9 clases a nivel 60", () => {
  for (const c of client.classes) {
    const k = COMMUNITY[c.classId]!;
    const l = c.levels.find((x) => x.level === 60)!;
    it(`clase ${c.classId}: crítico por agilidad e intelecto, maná base y poder de ataque por atributo`, () => {
      expect(l.critPerAgility * 100).toBeCloseTo(k.critPerAgi, 4);
      expect(l.spellCritPerIntellect * 100).toBeCloseTo(k.critPerInt, 4);
      expect(l.baseMana).toBe(k.mana);
      expect(c.attackPowerPerStrength).toBe(k.apStr);
      expect(c.attackPowerPerAgility).toBe(k.apAgi);
      // La comunidad solo da poder de ataque a distancia por agilidad al cazador; el cliente también lo da a guerrero y pícaro (2)
      if (k.rapAgi > 0) expect(c.rangedAttackPowerPerAgility).toBe(k.rapAgi);
    });
  }

  it("la vida base de clase a nivel 60 coincide en las 9 clases (Sacerdote y Mago usan la lectura de la comunidad: 1397 y 1370; la tabla de Classic daba 10 menos)", () => {
    const stats = JSON.parse(readFileSync(join(D, "stats.json"), "utf8")) as { classBase: { classId: number; hp: number[] }[] };
    for (const b of stats.classBase) if (COMMUNITY[b.classId]) expect(b.hp[59], `clase ${b.classId}`).toBe(COMMUNITY[b.classId]!.hp);
  });
});

describe("valores base por clase que el cliente no trae (comunidad)", () => {
  it("poder de ataque base: reproduce las cifras de la comunidad a nivel 60 y es la fórmula de Classic en otros niveles", () => {
    const at60 = (id: number) => baseAttackPower(classBaseOf(formulas, id), 60);
    expect([1, 2, 3, 4, 5, 7, 8, 9, 11].map((id) => at60(id).melee)).toEqual([160, 160, 100, 100, -10, 100, -10, -10, -20]);
    expect(at60(3).ranged).toBe(110); // cazador: nivel × 2 − 10
    expect(baseAttackPower(classBaseOf(formulas, 1), 30)).toEqual({ melee: 70, ranged: 0 });
    expect(baseAttackPower(null, 60)).toEqual({ melee: 0, ranged: 0 });
  });

  it("regeneración de maná por espíritu: fórmula medida con el tooltip del juego (656, 662 y 668 cada 5 s con 1000, 1010 y 1020 de espíritu)", () => {
    expect([1000, 1010, 1020].map((s) => spiritManaPer5s(formulas, s))).toEqual([656, 662, 668]);
    // mismo valor que 2,5 × (12,5 + espíritu / 4) hacia abajo
    for (const spi of [0, 50, 125, 333, 1000]) expect(spiritManaPer5s(formulas, spi)).toBe(Math.floor(2.5 * (12.5 + spi / 4)));
  });

  it("esquive por agilidad = crítico por agilidad del cliente; pícaro y cazador el doble", () => {
    const perAgi = (id: number) => dodgePerAgility(classBaseOf(formulas, id), client.classes.find((c) => c.classId === id)!.levels.find((l) => l.level === 60)!);
    expect(perAgi(1)).toBeCloseTo(0.05, 4);
    expect(perAgi(4)).toBeCloseTo(0.069, 4);
    expect(perAgi(3)).toBeCloseTo(0.0378, 4);
    expect(dodgePerAgility(null, null)).toBe(0);
  });
});

describe("filas de combate con las reglas de la comunidad", () => {
  const attrs = { mage: [30, 35, 45, 125, 120] as [number, number, number, number, number], rogue: [80, 130, 75, 35, 50] as [number, number, number, number, number] };
  const stat = (classId: number) => client.classes.find((c) => c.classId === classId)!.levels.find((l) => l.level === 60)!;
  const row = (r: ReturnType<typeof deriveCombatStats>, key: string) => r.rows.find((x) => x.key === key);

  it("Mago: crítico con hechizos con la base de la clase, esquive base + agilidad, armadura por agilidad y regeneración por espíritu", () => {
    const derived = deriveStats({ attributes: attrs.mage, hpBase: 1370, manaBase: 1213, totals: [] });
    const r = deriveCombatStats({ derived, totals: [], classStats: stat(8), rules: { formulas, classId: 8 } });
    const crit = row(r, "crit-spell")!;
    expect(crit.parts[0]).toEqual({ label: "base de la clase", value: 0.2 });
    expect(crit.value).toBeCloseTo(0.2 + 125 * 0.0168, 1);
    const dodge = row(r, "dodge")!;
    expect(dodge.value).toBeCloseTo(3.2 + 35 * 0.0514, 1);
    expect(row(r, "armor")!.value).toBe(70); // 35 de agilidad × 2
    expect(row(r, "spirit-regen")!.value).toBe(Math.floor(31.25 + 120 * 0.625)); // 106
  });

  it("Pícaro: sin maná no hay regeneración por espíritu; esquive con el doble de la agilidad; el crítico físico base es 0", () => {
    const derived = deriveStats({ attributes: attrs.rogue, hpBase: 1523, manaBase: 0, totals: [] });
    const r = deriveCombatStats({ derived, totals: [], classStats: stat(4), rules: { formulas, classId: 4 } });
    expect(row(r, "spirit-regen")).toBeUndefined();
    expect(row(r, "dodge")!.value).toBeCloseTo(130 * 0.069, 1);
    expect(row(r, "crit-melee")!.parts.some((p) => p.label === "base de la clase")).toBe(false);
    expect(row(r, "armor")!.value).toBe(260);
  });

  it("sin reglas de la comunidad no se inventa nada: el esquive solo sale con lo que haya y no hay armadura por agilidad ni regeneración", () => {
    const derived = deriveStats({ attributes: attrs.mage, hpBase: 1370, manaBase: 1213, totals: [] });
    const r = deriveCombatStats({ derived, totals: [], classStats: stat(8) });
    expect(row(r, "spirit-regen")).toBeUndefined();
    expect(row(r, "armor")).toBeUndefined();
    expect(row(r, "dodge")).toBeUndefined();
  });

  it("el poder de ataque base de la clase se suma al de los atributos (Guerrero: 160 + 2 por fuerza)", () => {
    const warrior = client.classes.find((c) => c.classId === 1)!;
    const ap = baseAttackPower(classBaseOf(formulas, 1), 60);
    const derived = deriveStats({
      attributes: [120, 80, 110, 30, 45],
      hpBase: 1689,
      manaBase: 0,
      totals: [],
      attackPower: { perStrength: warrior.attackPowerPerStrength, perAgility: warrior.attackPowerPerAgility, rangedPerAgility: warrior.rangedAttackPowerPerAgility, baseMelee: ap.melee, baseRanged: ap.ranged },
    });
    expect(derived.rows.find((r) => r.key === "ap")!.final).toBe(160 + 2 * 120);
  });
});
