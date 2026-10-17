import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, BaseStats, ClassTalents, ClientStats, CombatFormulas, Races, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityChances, abilityEffectSummary, collectStatEffects, decodeBuild, findAbility, indexClass } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70425");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
const legacy = indexClass(ClassTalents.parse(json("legacy.json")));
const abilities = Abilities.parse(json("abilities/mage.json"));
const rules = TalentRules.parse(json("rules/mage.json"));
const formulas = CombatFormulas.parse(json("combat-formulas.json"));
const stats = BaseStats.parse(json("stats.json"));
const clientStats = ClientStats.parse(json("client-stats.json"));
/** Fila del cliente (critico por atributo) de una clase y nivel. */
const cs = (classId: number, level: number) => clientStats.classes.find((c) => c.classId === classId)!.levels.find((l) => l.level === level) ?? null;
const human = Races.parse(json("races.json")).races.find((r) => r.id === 1)!;

const classBuild = decodeBuild(mage, "0002-0355200000003-0055300301020301251")!;
const legacyBuild = decodeBuild(legacy, "255000002-02-")!;
const fx = collectStatEffects({ cls: mage, classBuild, legacy, legacyBuild, race: human, abilities, rules });
const row = stats.combos.find((c) => c.raceId === 1 && c.classId === 8)!.stats[59]!; // nivel 60
const base = { str: row[0]!, agi: row[1]!, sta: row[2]!, int: row[3]!, spi: row[4]! };

describe("probabilidades de impacto y critico por habilidad (estimacion de Classic)", () => {
  const frostbolt = findAbility(abilities, "Descarga de Escarcha")!;
  const rank = frostbolt.ranks.at(-1)!;
  const lines = abilityEffectSummary("Descarga de Escarcha", fx).lines;

  it("las formulas son de Classic, procedencia community y confianza baja (no se presentan como de Forever)", () => {
    expect(formulas.provenance).toBe("community");
    expect(formulas.confidence).toBe("low");
  });

  it("impacto contra el mismo nivel: 100 - 4 % de fallo + 5 de Enfoque elemental = 101, con tope 99", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(c.kind).toBe("spell");
    expect(c.hit).toMatchObject({ missPct: 4, bonusPct: 5, cap: 99, total: 99, capped: true });
  });

  it("impacto contra un jefe (+3): 100 - 17 + 5 = 88", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "boss", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(c.hit).toMatchObject({ missPct: 17, bonusPct: 5, total: 88, capped: false });
  });

  it("sin talentos el impacto es la tabla de Classic (96 % contra el mismo nivel)", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines: [] });
    expect(c.hit).toMatchObject({ bonusPct: 0, total: 96, capped: false });
  });

  it("critico: aporte del intelecto segun el cliente (intelecto x critico por punto) + bonos de talentos y raza; no inventa el critico base de la clase", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(c.crit.stat).toBe("int");
    expect(c.crit.statPerPercent).toBe(59.5);
    expect(c.crit.fromStat).toBeCloseTo(base.int * cs(8, 60)!.spellCritPerIntellect * 100, 1);
    expect(c.crit.bonusPct).toBe(2); // Crueldad del Humano; Incineracion no afecta a Descarga de Escarcha
    expect(c.crit.total).toBeCloseTo(c.crit.fromStat! + 2, 1);
    expect(c.crit.unavailable).toBeNull();
  });

  it("a cualquier nivel el aporte del atributo SI se calcula (el cliente trae la tabla de los 60 niveles): nivel 30 con 27,3 de intelecto por 1 %", () => {
    const l30 = stats.combos.find((x) => x.raceId === 1 && x.classId === 8)!.stats[29]!;
    const c = abilityChances({ rank, classId: 8, level: 30, target: "same", formulas, stats: { agi: l30[1]!, int: l30[3]! }, classStats: cs(8, 30), lines });
    expect(c.crit.statPerPercent).toBe(27.3);
    expect(c.crit.fromStat).toBeCloseTo(l30[3]! / 27.3, 0);
    expect(c.crit.bonusPct).toBe(2);
    expect(c.hit.total).toBe(99);
  });

  it("sin raza (sin estadisticas) no hay aporte del atributo y lo avisa", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: null, classStats: cs(8, 60), lines });
    expect(c.crit.fromStat).toBeNull();
    expect(c.crit.unavailable).toContain("raza");
  });

  it("las habilidades fisicas usan la tabla cuerpo a cuerpo (5 % / 9 %) y la agilidad del Picaro del cliente (29 por 1 % a nivel 60)", async () => {
    const rogue = Abilities.parse(json("abilities/rogue.json"));
    const evis = findAbility(rogue, "Eviscerar")!.ranks.at(-1)!;
    const c = abilityChances({ rank: evis, classId: 4, level: 60, target: "boss", formulas, stats: { agi: 290, int: 20 }, classStats: cs(4, 60), lines: [] });
    expect(c.kind).toBe("melee");
    expect(c.hit.missPct).toBe(9);
    expect(c.crit.statPerPercent).toBe(29);
    expect(c.crit.fromStat).toBeCloseTo(10, 0);
  });

  it("una clase sin critico de hechizo por intelecto (Guerrero) lo avisa en vez de inventarlo, y sin datos del cliente tambien", () => {
    const warrior = Abilities.parse(json("abilities/warrior.json"));
    const hs = findAbility(warrior, "Golpe heroico")!.ranks.at(-1)!;
    expect(abilityChances({ rank: hs, classId: 1, level: 60, target: "same", formulas, stats: { agi: 100, int: 20 }, classStats: cs(1, 60), lines: [] }).crit.fromStat).not.toBeNull();
    expect(abilityChances({ rank, classId: 1, level: 60, target: "same", formulas, stats: base, classStats: cs(1, 60), lines: [] }).crit.unavailable).toContain("no obtiene");
    expect(abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: null, lines: [] }).crit.unavailable).toContain("cliente");
  });
});
