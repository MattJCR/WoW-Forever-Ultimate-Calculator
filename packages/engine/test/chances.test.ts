import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, BaseStats, ClassTalents, ClientStats, CombatFormulas, Races, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityChances, abilityEffectSummary, collectStatEffects, decodeBuild, findAbility, indexClass } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
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

const classBuild = decodeBuild(mage, "V229luA1E1B2A1A1C2B4C3E1C1E6C8B1E1E1C6B")!;
const legacyBuild = decodeBuild(legacy, "V22d3uE3E2B2B8B")!;
const fx = collectStatEffects({ cls: mage, classBuild, legacy, legacyBuild, race: human, abilities, rules });
const row = stats.combos.find((c) => c.raceId === 1 && c.classId === 8)!.stats[59]!; // nivel 60
const base = { str: row[0]!, agi: row[1]!, sta: row[2]!, int: row[3]!, spi: row[4]! };

describe("probabilidades de impacto y critico por habilidad (cliente + comunidad)", () => {
  const frostbolt = findAbility(abilities, "Descarga de Escarcha")!;
  const rank = frostbolt.ranks.at(-1)!;
  const lines = abilityEffectSummary("Descarga de Escarcha", fx).lines;

  it("las reglas son de la comunidad, procedencia community y confianza baja (no se presentan como medidas por el cliente)", () => {
    expect(formulas.provenance).toBe("community");
    expect(formulas.confidence).toBe("low");
  });

  it("impacto contra el mismo nivel: 100 - 4 % de fallo + 6 de Enfoque elemental (hotfix 20/10: 3 rangos de 2 %) = 102, con tope 100 (en Forever no hay 1 % minimo de fallo)", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(c.kind).toBe("spell");
    expect(c.hit).toMatchObject({ missPct: 4, bonusPct: 6, cap: 100, total: 100, capped: true });
  });

  it("impacto contra un jefe (+3): 100 - 17 + 6 = 89", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "boss", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(c.hit).toMatchObject({ missPct: 17, bonusPct: 6, total: 89, capped: false });
  });

  it("sin talentos el impacto es la tabla de Classic (96 % contra el mismo nivel)", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines: [] });
    expect(c.hit).toMatchObject({ bonusPct: 0, total: 96, capped: false });
  });

  it("critico: base de la clase (comunidad: Mago 0,2 %) + intelecto segun el cliente (intelecto x critico por punto) + bonos de talentos y raza", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(c.crit.stat).toBe("int");
    expect(c.crit.statPerPercent).toBe(59.5);
    expect(c.crit.fromStat).toBeCloseTo(base.int * cs(8, 60)!.spellCritPerIntellect * 100, 1);
    expect(c.crit.bonusPct).toBe(2); // Crueldad del Humano; Incineracion no afecta a Descarga de Escarcha
    expect(c.crit.baseClassPct).toBe(0.2);
    expect(c.crit.total).toBeCloseTo(0.2 + c.crit.fromStat! + 2, 1);
    expect(c.crit.suppressionPct).toBe(0); // contra el mismo nivel no hay supresion
    expect(c.crit.unavailable).toBeNull();
  });

  it("a cualquier nivel el aporte del atributo SI se calcula (el cliente trae la tabla de los 60 niveles): nivel 30 con 27,3 de intelecto por 1 %", () => {
    const l30 = stats.combos.find((x) => x.raceId === 1 && x.classId === 8)!.stats[29]!;
    const c = abilityChances({ rank, classId: 8, level: 30, target: "same", formulas, stats: { agi: l30[1]!, int: l30[3]! }, classStats: cs(8, 30), lines });
    expect(c.crit.statPerPercent).toBe(27.3);
    expect(c.crit.fromStat).toBeCloseTo(l30[3]! / 27.3, 0);
    expect(c.crit.bonusPct).toBe(2);
    expect(c.hit.total).toBe(100);
  });

  it("equipo: la puntuación de impacto y de crítico se suma (+1,5 % de impacto, +2 % de crítico), el impacto sigue con tope y el crítico sale aparte", () => {
    const gear = { hitPct: 1.5, critPct: 2 };
    const sin = abilityChances({ rank, classId: 8, level: 60, target: "boss", formulas, stats: base, classStats: cs(8, 60), lines });
    const con = abilityChances({ rank, classId: 8, level: 60, target: "boss", formulas, stats: base, classStats: cs(8, 60), lines, gear });
    expect(con.hit.gearPct).toBe(1.5);
    expect(con.hit.total).toBeCloseTo(sin.hit.total + 1.5, 2);
    expect(con.crit.gearPct).toBe(2);
    expect(con.crit.total).toBeCloseTo(sin.crit.total! + 2, 2);
    // contra el mismo nivel ya estamos en el tope de 100
    expect(abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: cs(8, 60), lines, gear }).hit).toMatchObject({ total: 100, capped: true });
    // sin equipo no cambia nada
    expect(sin.hit.gearPct).toBe(0);
    expect(sin.crit.gearPct).toBe(0);
  });

  it("sin raza (sin estadisticas) no hay aporte del atributo y lo avisa", () => {
    const c = abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: null, classStats: cs(8, 60), lines });
    expect(c.crit.fromStat).toBeNull();
    expect(c.crit.unavailable).toContain("raza");
  });

  it("las habilidades fisicas usan la tabla cuerpo a cuerpo (5 % / 8 % contra +3) y la agilidad del Picaro del cliente (29 por 1 % a nivel 60)", async () => {
    const rogue = Abilities.parse(json("abilities/rogue.json"));
    const evis = findAbility(rogue, "Eviscerar")!.ranks.at(-1)!;
    const c = abilityChances({ rank: evis, classId: 4, level: 60, target: "boss", formulas, stats: { agi: 290, int: 20 }, classStats: cs(4, 60), lines: [] });
    expect(c.kind).toBe("melee");
    expect(c.hit.missPct).toBe(8);
    expect(c.crit.statPerPercent).toBe(29);
    expect(c.crit.fromStat).toBeCloseTo(10, 0);
  });

  it("supresion de critico contra un jefe: fisico 3 % por habilidad de arma + critico de auras hasta 1,8 %; hechizos ninguna", () => {
    const rogue = Abilities.parse(json("abilities/rogue.json"));
    const evis = findAbility(rogue, "Eviscerar")!.ranks.at(-1)!;
    const stats = { agi: 290, int: 20 };
    const same = abilityChances({ rank: evis, classId: 4, level: 60, target: "same", formulas, stats, classStats: cs(4, 60), lines: [] });
    const boss = abilityChances({ rank: evis, classId: 4, level: 60, target: "boss", formulas, stats, classStats: cs(4, 60), lines: [] });
    expect(same.crit.suppressionPct).toBe(0);
    expect(boss.crit.suppressionPct).toBe(3);
    expect(boss.crit.vsTargetPct).toBeCloseTo(boss.crit.total! - 3, 2);
    // con 5 % de crítico de equipo (puntuacion), solo se suprimen 1,8 puntos de los 5 que vienen de auras
    const geared = abilityChances({ rank: evis, classId: 4, level: 60, target: "boss", formulas, stats, classStats: cs(4, 60), lines: [], gear: { hitPct: 0, critPct: 5 } });
    expect(geared.crit.suppressionPct).toBeCloseTo(3 + 1.8, 2);
    // los hechizos no tienen supresion
    const spell = abilityChances({ rank, classId: 8, level: 60, target: "boss", formulas, stats: base, classStats: cs(8, 60), lines });
    expect(spell.crit.suppressionPct).toBe(0);
    expect(spell.crit.vsTargetPct).toBe(spell.crit.total);
  });

  it("una clase sin critico de hechizo por intelecto (Guerrero) lo avisa en vez de inventarlo, y sin datos del cliente tambien", () => {
    const warrior = Abilities.parse(json("abilities/warrior.json"));
    const hs = findAbility(warrior, "Golpe heroico")!.ranks.at(-1)!;
    expect(abilityChances({ rank: hs, classId: 1, level: 60, target: "same", formulas, stats: { agi: 100, int: 20 }, classStats: cs(1, 60), lines: [] }).crit.fromStat).not.toBeNull();
    expect(abilityChances({ rank, classId: 1, level: 60, target: "same", formulas, stats: base, classStats: cs(1, 60), lines: [] }).crit.unavailable).toContain("no obtiene");
    expect(abilityChances({ rank, classId: 8, level: 60, target: "same", formulas, stats: base, classStats: null, lines: [] }).crit.unavailable).toContain("cliente");
  });
});
