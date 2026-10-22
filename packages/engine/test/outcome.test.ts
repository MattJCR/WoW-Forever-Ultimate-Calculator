import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, CombatFormulas } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityChances, abilityOutcome, critMultiplierOf, findAbility, indexClass, rankAtLevel, spellModifiersOf, type PowerContext } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70450");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
const abilities = Abilities.parse(json("abilities/mage.json"));
const warlockAbilities = Abilities.parse(json("abilities/warlock.json"));
const formulas = CombatFormulas.parse(json("combat-formulas.json"));
const nodeOf = (name: string) => mage.ordered.find((i) => i.talent.name === name)!.talent;
const full = (...names: string[]): Record<number, number> => Object.fromEntries(names.map((n) => [nodeOf(n).nodeId, nodeOf(n).maxRank]));
const power = (over: Partial<PowerContext> = {}): PowerContext => ({
  spellDamage: 100, spellHealing: 0, schoolPower: { 2: 0, 4: 0, 8: 0, 16: 0, 32: 0, 64: 0 }, attackPower: 0, rangedAttackPower: 0,
  mainHand: null, offHand: null, ranged: null, physicalDamage: 0, offHandFactor: 0.5, ...over,
});
const crit = formulas.critMultiplier;

describe("resultado de la habilidad: incremento y total", () => {
  const frostbolt = findAbility(abilities, "Descarga de Escarcha")!.ranks.at(-1)!;

  it("sin talentos ni poder el total es el de las cifras del cliente y no hay incremento", () => {
    const o = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], power: null, chances: null, critMultiplier: crit })!;
    expect(o.talentGain).toBe(0);
    expect(o.powerGain).toBe(0);
    expect(o.total).toBe(o.base);
    expect(o.sources).toEqual([]);
    expect(o.expected).toBeNull();
    expect(o.lines[0]!.label).toBe("Daño directo");
  });

  it("con Inestabilidad Arcana (+3 % de daño) el incremento es el 3 % y la fuente aparece con su aportación", () => {
    const mods = spellModifiersOf(mage, full("Inestabilidad Arcana"));
    const o = abilityOutcome({ rank: frostbolt, level: 60, modifiers: mods, power: null, chances: null, critMultiplier: crit })!;
    expect(o.talentGainPct).toBeCloseTo(3, 1);
    expect(o.talentGain).toBeCloseTo(o.talents - o.base, 6);
    expect(o.sources.map((s) => s.name)).toContain("Inestabilidad Arcana");
    expect(o.sources.find((s) => s.name === "Inestabilidad Arcana")!.gain).toBeCloseTo(o.talentGain, 3);
  });

  it("el poder con hechizos suma poder × coeficiente (el de la Descarga de Escarcha, 0,814)", () => {
    const o = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], power: power(), chances: null, critMultiplier: crit })!;
    expect(o.powerGain).toBeCloseTo(81.4, 1);
    expect(o.total).toBeCloseTo(o.talents + 81.4, 1);
  });

  it("el daño infligido de talentos, raza y equipo cuenta como incremento", () => {
    const plain = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], power: null, chances: null, critMultiplier: crit })!;
    const withDd = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], damageDonePct: 10, power: null, chances: null, critMultiplier: crit })!;
    expect(withDd.talentGainPct).toBeCloseTo(10, 5);
    expect(withDd.talents).toBeCloseTo(plain.talents * 1.1, 4);
  });

  it("esperado: fallo y crítico (solo lo directo); el crítico físico duplica y los hechizos ×1,5", () => {
    const chances = abilityChances({ rank: frostbolt, classId: 8, level: 60, target: "same", formulas, stats: { agi: 0, int: 200 }, classStats: { critPerAgility: 0, spellCritPerIntellect: 0.0005 } as never, lines: [] });
    const o = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], power: null, chances, critMultiplier: crit })!;
    const c = chances.crit.vsTargetPct!;
    expect(o.critChancePct).toBe(c);
    expect(o.critMultiplier).toBeCloseTo(1.5, 5);
    expect(o.hitPct).toBe(chances.hit.total);
    expect(o.expected!).toBeCloseTo(o.total * (chances.hit.total / 100) * (1 + (c / 100) * 0.5), 4);
  });

  it("el bonus de daño crítico de los talentos multiplica la parte extra del crítico (Classic: ×1 + 0,5 × 1,5)", () => {
    expect(critMultiplierOf(1.5, 0)).toBe(1.5);
    expect(critMultiplierOf(1.5, 50)).toBeCloseTo(1.75, 5);
    expect(critMultiplierOf(2, 100)).toBe(3);
  });

  it("el daño periódico suma todos los ticks, no sale crítico y sale por segundo con la canalización o el lanzamiento", () => {
    const corruption = findAbility(warlockAbilities, "Corrupción")!.ranks.at(-1)!;
    const o = abilityOutcome({ rank: corruption, level: 60, modifiers: [], power: power(), chances: null, critMultiplier: crit })!;
    const line = o.lines[0]!;
    expect(line.critable).toBe(false);
    expect(line.label).toMatch(/^Daño periódico \(\d+ ticks\)$/);
    expect(o.powerGain).toBeGreaterThan(0);
  });

  it("una habilidad que no hace daño ni sana no tiene resultado", () => {
    const blink = findAbility(abilities, "Polimorfia")!.ranks.at(-1)!;
    expect(abilityOutcome({ rank: blink, level: 60, modifiers: [], power: power(), chances: null, critMultiplier: crit })).toBeNull();
    expect(rankAtLevel(findAbility(abilities, "Polimorfia")!, 60)).not.toBeNull();
  });

  it("por segundo: el tiempo de lanzamiento con celeridad", () => {
    const fast = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], power: null, chances: null, critMultiplier: crit, hastePct: 25 })!;
    const slow = abilityOutcome({ rank: frostbolt, level: 60, modifiers: [], power: null, chances: null, critMultiplier: crit })!;
    expect(slow.perSecond!.basis).toBe("cast");
    expect(fast.perSecond!.value).toBeCloseTo(slow.perSecond!.value * 1.25, 4);
  });
});
