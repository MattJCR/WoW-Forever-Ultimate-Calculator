import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, CombatFormulas } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityOutcome, findAbility, formFlatAttackPower, formOfRank, formPowerContext, rankAtLevel, type PowerContext } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70450");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const rogue = Abilities.parse(json("abilities/rogue.json"));
const warrior = Abilities.parse(json("abilities/warrior.json"));
const priest = Abilities.parse(json("abilities/priest.json"));
const warlock = Abilities.parse(json("abilities/warlock.json"));
const druid = Abilities.parse(json("abilities/druid.json"));
const formulas = CombatFormulas.parse(json("combat-formulas.json"));
const weapon = { min: 100, max: 100, speed: 2, normalizedSpeed: 2, usesAttackPower: true };
const power = (over: Partial<PowerContext> = {}): PowerContext => ({
  spellDamage: 0, spellHealing: 0, schoolPower: {}, attackPower: 0, rangedAttackPower: 0, mainHand: weapon, offHand: weapon, ranged: null, physicalDamage: 0, offHandFactor: 0.5, ...over,
});
const outcome = (a: Abilities, name: string, p: PowerContext | null = power()) => abilityOutcome({ rank: rankAtLevel(findAbility(a, name)!, 60)!, level: 60, modifiers: [], power: p, chances: null, critMultiplier: formulas.critMultiplier });

describe("habilidades con el daño en un efecto «dummy» o en un drenaje periódico", () => {
  it("Ejecutar enseña su daño directo del texto (600) y lo que añade cada punto de ira extra", () => {
    const o = outcome(warrior, "Ejecutar", null)!;
    expect(o.total).toBe(600);
    expect(o.lines[0]!.label).toContain("15 por cada punto de ira extra");
    expect(o.lines[0]!.critable).toBe(true);
  });

  it("Puyazo golpea con el arma de la mano izquierda como un golpe de arma normal (media del arma × la fracción de la mano izquierda)", () => {
    const o = outcome(rogue, "Puyazo")!;
    expect(o.lines[0]!.label).toBe("Golpe de arma");
    expect(o.total).toBeCloseTo(100 * 0.5, 5);
    expect(outcome(rogue, "Puyazo", power({ offHand: null }))).toBeNull();
  });

  it("Cuchillo envenenado rango 1 y 2 hacen lo mismo", () => {
    const a = findAbility(rogue, "Cuchillo envenenado")!;
    for (const rank of a.ranks) expect(abilityOutcome({ rank, level: 60, modifiers: [], power: power(), chances: null, critMultiplier: null })).not.toBeNull();
  });

  it("Peste devoradora, Drenar vida y Succionar vida son daño periódico (drenaje de la aura 53)", () => {
    const plague = outcome(priest, "Peste devoradora", null)!;
    expect(plague.lines[0]!.label).toContain("periódico");
    expect(plague.total).toBeCloseTo(848, 0);
    expect(outcome(warlock, "Drenar vida", null)!.total).toBeGreaterThan(0);
    expect(outcome(warlock, "Succionar vida", null)!.total).toBeGreaterThan(0);
  });
});

describe("formas del druida", () => {
  const claw = rankAtLevel(findAbility(druid, "Zarpa")!, 60)!;
  const maul = rankAtLevel(findAbility(druid, "Machaque")!, 60)!;

  it("las habilidades de energía con daño de arma son del gato y las de ira, del oso; solo para el druida", () => {
    expect(formOfRank(claw, 11)).toBe("cat");
    expect(formOfRank(maul, 11)).toBe("bear");
    expect(formOfRank(claw, 4)).toBeNull();
    expect(formOfRank(rankAtLevel(findAbility(druid, "Cólera")!, 60)!, 11)).toBeNull();
  });

  it("los puntos de poder de ataque de la propia forma salen del cliente (felina 2 × nivel, oso 3 × nivel)", () => {
    expect(formFlatAttackPower(druid, "cat", 60)).toBe(120);
    expect(formFlatAttackPower(druid, "bear", 60)).toBe(180);
    expect(formFlatAttackPower(druid, "bear", 20)).toBe(60);
    expect(formFlatAttackPower(druid, "cat", 5)).toBe(0);
  });

  it("bajo forma felina no se usa el arma equipada: el golpe sale del poder de ataque de la forma", () => {
    const ctx = formPowerContext(power(), { form: "cat", forms: formulas.forms!, level: 60, strength: 100, agility: 150, gearAttackPower: 30, formFlatAttackPower: 120 });
    // 2 × 100 + 150 − 20 + 30 + 120 (el término del nivel viene en los puntos de la forma)
    expect(ctx.attackPower).toBe(480);
    expect(ctx.mainHand).toMatchObject({ min: 0, max: 0, speed: 1 });
    const o = abilityOutcome({ rank: claw, level: 60, modifiers: [], power: ctx, chances: null, critMultiplier: null })!;
    const plano = claw.effects.find((e) => e.effect === 58)!.base;
    const porcentaje = claw.effects.find((e) => e.effect === 31)!.base / 100;
    expect(o.total).toBeCloseTo((plano + 480 / 14) * porcentaje, 3);
    expect(o.lines[0]!.label).toBe("Golpe de arma");
  });

  it("bajo forma de oso la velocidad es 2,5 s y el poder de ataque usa la fuerza y los puntos de la forma", () => {
    const ctx = formPowerContext(power(), { form: "bear", forms: formulas.forms!, level: 60, strength: 100, agility: 150, gearAttackPower: 0, formFlatAttackPower: 180 });
    expect(ctx.attackPower).toBe(2 * 100 - 20 + 180);
    expect(ctx.mainHand!.speed).toBe(2.5);
  });
});

/**
 * AUDITORÍA (sesión 13): habilidades cuyo texto habla de daño o sanación con cifras y que aun así no tienen resultado por lanzamiento (con todas las armas
 * y poder equipados). Lista EXACTA con el motivo: si un parche o un cambio del motor mueve una, la prueba falla y hay que decidir.
 */
const NO_OUTCOME: Record<string, string> = {
  // Absorciones: protegen, no hacen daño ni sanan
  "mage: Custodia de Fuego": "absorbe daño",
  "mage: Custodia de Escarcha": "absorbe daño",
  "mage: Barrera de hielo": "absorbe daño",
  "priest: Palabra de poder: escudo": "absorbe daño",
  // Modificadores del daño o la sanación recibidos
  "mage: Empapar magia": "reduce el daño de los hechizos recibidos",
  "mage: Amplificar magia": "aumenta el daño y la sanación de los hechizos recibidos",
  "warlock: Maldición de debilidad": "reduce el daño físico del objetivo",
  "warlock: Armadura vil": "suma poder con hechizos",
  // Daño o sanación reactivos: dependen de lo que ocurra en combate (golpes recibidos, sanaciones, maná del objetivo)
  "paladin: Aura de castigo": "daño por cada golpe recibido por el grupo",
  "paladin: Escudo Sagrado": "daño por cada ataque bloqueado",
  "druid: Espinas": "daño por cada golpe recibido",
  "priest: Rebote": "quema el maná del atacante",
  "priest: Quemar maná": "el daño es la mitad del maná que tenga el objetivo",
  "priest: Rezo de alivio": "sanación la próxima vez que el objetivo reciba daño",
  "shaman: Escudo de tierra": "sanación cuando los ataques golpean",
  // Maná, no daño ni sanación
  "paladin: Bendición de Sabiduría": "restaura maná",
  "paladin: Sello de sabiduría": "restaura maná con los golpes",
  "shaman: Tótem de marea de maná": "restaura maná",
  "shaman: Tótem Fuente de maná": "restaura maná",
  // Sus golpes ya los hace el arma de la mano principal (el tótem solo los mejora)
  "shaman: Tótem lengua de Fuego": "daño de Fuego por golpe de arma del grupo",
};

describe("cobertura del resultado por lanzamiento (las 9 clases)", () => {
  it("las habilidades con cifras de daño o sanación sin resultado son exactamente las inventariadas", () => {
    const full: PowerContext = power({ spellDamage: 100, spellHealing: 100, attackPower: 500, rangedAttackPower: 500, ranged: weapon });
    const text = /(inflig\w*|caus\w*|sana\w*|cur\w+|restaura\w*|recibe\w*|absorbe)\b[^.]{0,40}?\d+[\d,.]* p\.\s*(de\s+(da[ñn]o|salud))?|daño (de|con) arma|daño normal/i;
    const found: string[] = [];
    for (const token of ["mage", "rogue", "warrior", "paladin", "priest", "shaman", "hunter", "warlock", "druid"]) {
      const abilities = Abilities.parse(json(`abilities/${token}.json`));
      for (const a of abilities.abilities) {
        const miss = a.ranks.find((r) => text.test(r.description) && !abilityOutcome({ rank: r, level: 60, modifiers: [], power: full, chances: null, critMultiplier: null }));
        if (miss) found.push(`${token}: ${a.name}`);
      }
    }
    expect(found.sort()).toEqual(Object.keys(NO_OUTCOME).sort());
  });
});
