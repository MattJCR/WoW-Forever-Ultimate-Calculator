import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { applyModifiers, findAbility, powerEstimate, rankAtLevel, type PowerContext } from "../src/index.js";

const D = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), "data", "forever", "1.60.1.70658");
const load = (c: string) => Abilities.parse(JSON.parse(readFileSync(join(D, "abilities", `${c}.json`), "utf8")));
const mage = load("mage");
const warlock = load("warlock");
const warrior = load("warrior");
const modified = (data: ReturnType<typeof load>, name: string) => applyModifiers(rankAtLevel(findAbility(data, name)!, 60)!, 60, []);

const ctx = (over: Partial<PowerContext> = {}): PowerContext => ({ spellDamage: 100, spellHealing: 200, schoolPower: { 2: 0, 4: 0, 8: 0, 16: 0, 32: 0, 64: 0 }, attackPower: 280, rangedAttackPower: 140, mainHand: { min: 100, max: 120, speed: 2.8, normalizedSpeed: 2.4, usesAttackPower: true }, offHand: null, ranged: null, physicalDamage: 0, offHandFactor: 0.5, ...over });

describe("poder con hechizos y de ataque en el daño de las habilidades (estimación)", () => {
  it("daño directo: poder × coeficiente del cliente (Descarga de Escarcha 0,814), más el poder de la escuela si lo hay", () => {
    const m = modified(mage, "Descarga de Escarcha");
    const plain = powerEstimate(m, ctx()).spell[0]!;
    expect(plain.coefficient).toBeCloseTo(0.814, 3);
    expect(plain.perHit).toBeCloseTo(81.4, 1);
    expect(plain.final.average).toBeCloseTo(m.effects.find((x) => x.effect.index === plain.effectIndex)!.final.average + 81.4, 1);
    const frost = powerEstimate(m, ctx({ schoolPower: { 2: 0, 4: 0, 8: 0, 16: 50, 32: 0, 64: 0 } })).spell[0]!;
    expect(frost.power).toBe(150);
  });

  it("coeficiente exactamente 1: vale en los hechizos de 3,5 s o más (Bola de Fuego) y es relleno en el resto", () => {
    expect(powerEstimate(modified(mage, "Bola de Fuego"), ctx()).spell[0]?.coefficient).toBe(1);
    // Cólera Arcana también lleva 1 pero es de 3,5 s; un hechizo instantáneo con 1 no suma nada
    const fillers = [...mage.abilities, ...warlock.abilities].filter((a) => a.ranks.some((r) => r.castMs < 3500 && r.effects.some((e) => e.coefficient === 1 && e.kind === "direct-damage" && r.schoolMask !== 1)));
    for (const a of fillers) {
      const r = rankAtLevel(a, 60)!;
      const out = powerEstimate(applyModifiers(r, 60, []), ctx()).spell;
      for (const b of out) expect(b.coefficient).not.toBe(1);
    }
  });

  it("daño periódico: el coeficiente es por tick (Corrupción 0,2 × 6 ticks = 1,2 del poder en total)", () => {
    const m = modified(warlock, "Corrupción");
    const b = powerEstimate(m, ctx()).spell.find((x) => x.periodic)!;
    expect(b.ticks).toBe(6);
    expect(b.perHit).toBeCloseTo(20, 1);
    expect(b.total).toBeCloseTo(120, 1);
  });

  it("las sanaciones usan el poder de sanación y las habilidades físicas no usan el poder con hechizos", () => {
    const heal = powerEstimate(modified(load("priest"), "Renovar"), ctx()).spell.find((x) => x.heal)!;
    expect(heal.power).toBe(200);
    expect(heal.total).toBeCloseTo(200 * 0.2 * 5, 1);
    const w = warrior.abilities.flatMap((a) => a.ranks.filter((r) => r.schoolMask === 1 && r.effects.some((e) => e.kind === "direct-damage" && e.coefficient)));
    expect(w.length).toBeGreaterThan(0);
    for (const r of w) expect(powerEstimate(applyModifiers(r, 60, []), ctx()).spell).toEqual([]);
  });

  it("golpe de arma: arma + poder de ataque ÷ 14 × velocidad, con la normalizada en los efectos 121 y el % de arma multiplicando", () => {
    const names = warrior.abilities.filter((a) => a.ranks.some((r) => r.effects.some((e) => [17, 58].includes(e.effect)) && !r.effects.some((e) => e.effect === 31 || e.effect === 121))).map((a) => a.name);
    expect(names.length).toBeGreaterThan(0);
    const m = modified(warrior, names[0]!);
    const w = powerEstimate(m, ctx()).weapon!;
    const flat = m.weaponEffects.filter((e) => [17, 58].includes(e.effect.effect)).reduce((n, e) => n + e.final.average, 0);
    expect(w.average).toBeCloseTo(flat + 110 + (280 / 14) * 2.8, 1);
    expect(w.ranged).toBe(false);
    expect(powerEstimate(m, ctx({ mainHand: null })).weapon).toBeNull();
    const pctAbility = [...warrior.abilities, ...load("rogue").abilities].find((a) => a.ranks.some((r) => r.effects.some((e) => e.effect === 31) && !r.effects.some((e) => [17, 58, 121].includes(e.effect))));
    if (pctAbility) {
      const mp = applyModifiers(rankAtLevel(pctAbility, 60)!, 60, []);
      const pct = mp.weaponEffects.find((e) => e.effect.effect === 31)!.final.average / 100;
      expect(powerEstimate(mp, ctx()).weapon!.average).toBeCloseTo((110 + 20 * 2.8) * pct, 1);
    }
  });
});
