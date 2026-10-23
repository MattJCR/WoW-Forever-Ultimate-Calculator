import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, CombatFormulas, Races } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityChances, abilityEffectSummary, canCrit, collectStatEffects, dealsDamage, findAbility, indexClass } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70532");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const rogue = indexClass(ClassTalents.parse(json("classes/rogue.json")));
const abilities = Abilities.parse(json("abilities/rogue.json"));
const formulas = CombatFormulas.parse(json("combat-formulas.json"));
const human = Races.parse(json("races.json")).races.find((r) => r.id === 1)!;
// Humano: +2 % de crítico "a todo el personaje" (Crueldad racial); antes se colaba en Robar
const fx = collectStatEffects({ cls: rogue, classBuild: {}, legacy: null, legacyBuild: {}, race: human, abilities });
const CRIT = ["Probabilidad de crítico", "Bonus de daño crítico"];

describe("el crítico solo afecta a lo que hace daño o sana", () => {
  it("Robar no puede ser crítico: ni los bonos de todo el personaje ni la probabilidad de la tarjeta", () => {
    const robar = findAbility(abilities, "Robar")!;
    const rank = robar.ranks[0]!;
    expect(canCrit(rank)).toBe(false);
    expect(abilityEffectSummary("Robar", fx).lines.some((l) => l.category === "Probabilidad de crítico")).toBe(true); // por defecto sí (compatibilidad)
    const summary = abilityEffectSummary("Robar", fx, { canCrit: canCrit(rank) });
    expect(summary.lines.filter((l) => CRIT.includes(l.category))).toEqual([]);
    const c = abilityChances({ rank, classId: 4, level: 60, target: "same", formulas, stats: { agi: 100, int: 50 }, classStats: null, lines: summary.lines });
    expect(c.crit).toMatchObject({ total: null, fromStat: null, bonusPct: 0 });
    expect(c.crit.unavailable).toMatch(/no puede ser crítica/);
  });

  it("las habilidades que hacen daño sí pueden ser críticas y siguen recibiendo el bono", () => {
    const sinister = findAbility(abilities, "Golpe siniestro")!;
    const rank = sinister.ranks.at(-1)!;
    expect(dealsDamage(rank) && canCrit(rank)).toBe(true);
    const summary = abilityEffectSummary("Golpe siniestro", fx, { canCrit: true });
    expect(summary.lines.find((l) => l.category === "Probabilidad de crítico")?.value).toBe(2);
  });
});

describe("casos que el extractor no marca como daño", () => {
  it("Espiral mortal (Brujo, efecto 9 «drenar salud») hace daño y puede ser crítico", () => {
    const warlock = Abilities.parse(json("abilities/warlock.json"));
    expect(canCrit(findAbility(warlock, "Espiral mortal")!.ranks.at(-1)!)).toBe(true);
  });
});
