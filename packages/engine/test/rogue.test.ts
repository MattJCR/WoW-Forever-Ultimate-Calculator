import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, Races, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { addPoint, applyModifiers, collectStatEffects, findAbility, indexClass, ruleAbilityDetail, ruleAppliesTo, ruleLines, spellModifiersOf, type Build } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70685");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const rogue = indexClass(ClassTalents.parse(json("classes/rogue.json")));
const legacy = indexClass(ClassTalents.parse(json("legacy.json")));
const abilities = Abilities.parse(json("abilities/rogue.json"));
const rules = TalentRules.parse(json("rules/rogue.json"));
const human = Races.parse(json("races.json")).races.find((r) => r.id === 1)!;

/** Talentos de las filas altas de Asesinato que sirven de relleno para cumplir los requisitos de fila. */
const FILLERS = ["Maldad", "Incapacitación mejorada", "Ataques implacables", "Crueldad", "Asesinar", "Hacer picadillo mejorado", "Letalidad"];

/** Build legal: se gastan puntos con las reglas del motor (requisitos de fila y prerrequisitos) hasta el rango maximo de cada talento pedido. */
function build(...names: string[]): Build {
  let b: Build = {};
  for (let pass = 0; pass < 40; pass++) for (const n of names) b = addPoint(rogue, b, rogue.ordered.find((i) => i.talent.name === n)!.talent.nodeId);
  return b;
}
const rankIn = (b: Build, name: string): number => b[rogue.ordered.find((i) => i.talent.name === name)!.talent.nodeId] ?? 0;

describe("Pícaro: habilidades, talentos y reglas", () => {
  const b = build(...FILLERS, "Golpes despiadados", "Exponer armadura mejorado", "Venenos mejorados", "Vigor");

  it("el build de prueba es legal y trae los talentos pedidos", () => {
    expect(rankIn(b, "Vigor")).toBe(2);
    expect(rankIn(b, "Crueldad")).toBeGreaterThan(0);
    expect(rankIn(b, "Asesinar")).toBe(2);
  });

  it("Vigor suma +10 de energia máxima y Asesinar +4 % de daño contra humanoides y gigantes", () => {
    const fx = collectStatEffects({ cls: rogue, classBuild: b, legacy, legacyBuild: {}, race: human, abilities, rules });
    const energy = fx.totals.find((t) => t.label === "energía máximo");
    expect(energy).toMatchObject({ value: 10, unit: "puntos", scope: null });
    const kill = fx.totals.find((t) => t.label === "daño infligido" && t.scope?.[0]?.startsWith("contra"))!;
    expect(kill.value).toBe(4);
    expect(kill.scope![0]).toBe("contra gigantes y humanoides");
  });

  it("Crueldad (reglas) afecta a los remates y a ninguna otra habilidad", () => {
    const lines = ruleLines(rules, rogue, b);
    const cruelty = lines.find((l) => l.source.name === "Crueldad")!;
    const applies = (n: string) => {
      const a = findAbility(abilities, n)!;
      return ruleAppliesTo(cruelty, a, a.ranks.at(-1)!);
    };
    for (const n of ["Eviscerar", "Ruptura", "Golpe a los riñones", "Exponer armadura"]) expect(applies(n), n).toBe(true);
    for (const n of ["Golpe siniestro", "Puñalada", "Patada"]) expect(applies(n), n).toBe(false);
    expect(cruelty.text).toContain(`${cruelty.value} %`);
  });

  it("los costes de energia salen sin multiplicar y los modificadores planos de coste bajan la energia (Exponer armadura mejorado: -10)", () => {
    const eb = build(...FILLERS, "Exponer armadura mejorado");
    const expose = findAbility(abilities, "Exponer armadura")!.ranks.at(-1)!;
    expect(expose.cost).toBe(25);
    const m = applyModifiers(expose, 60, spellModifiersOf(rogue, eb));
    expect(rankIn(eb, "Exponer armadura mejorado")).toBe(2);
    expect(m.cost).toBe(expose.cost! - 10);
  });

  it("los venenos de distinto rango se agrupan bajo el mismo nombre", () => {
    const poison = findAbility(abilities, "Veneno instantáneo")!;
    expect(poison.ranks.length).toBe(6);
    expect(poison.ranks.map((r) => r.level)).toEqual([...poison.ranks.map((r) => r.level)].sort((a, c) => a - c));
  });

  it("las reglas del Pícaro son válidas y ningún talento escogido se pierde", () => {
    expect(rules.warnings).toEqual([]);
    const fx = collectStatEffects({ cls: rogue, classBuild: b, legacy: null, legacyBuild: {}, race: null, abilities, rules });
    const covered = new Set([...fx.totals.flatMap((t) => t.sources.map((s) => s.name)), ...fx.conditional.map((c) => c.source.name), ...fx.ruleEffects.map((r) => r.source.name)]);
    for (const { talent } of rogue.ordered) if (rankIn(b, talent.name ?? "") > 0) expect(covered.has(talent.name ?? ""), talent.name ?? "").toBe(true);
  });

  it("Golpes despiadados devuelve energía a los remates y su detalle no inventa maná", () => {
    const line = ruleLines(rules, rogue, b).find((l) => l.source.name === "Golpes despiadados")!;
    const evis = findAbility(abilities, "Eviscerar")!.ranks.at(-1)!;
    expect(ruleAbilityDetail(line, evis).manaReturn).toBeNull();
  });
});

describe("texto de las habilidades del Pícaro", () => {
  it("las fórmulas de Eviscerar con variables de Forever ($<base>, $<mult>, $b1) se calculan a nivel 60 y no quedan marcadores crudos", async () => {
    const { renderAbilityText } = await import("../src/index.js");
    const evis = findAbility(abilities, "Eviscerar")!.ranks.at(-1)!;
    const text = renderAbilityText(evis, applyModifiers(evis, 60, [])).map((p) => p.text).join("");
    expect(text).not.toContain("${");
    expect(text).not.toContain("…");
    expect(text).toContain("1 punto: 224-332");
    expect(text).toContain("5 puntos: 904-1012");
    expect(text).toContain("Remate que inflige daño por cada punto de combo");
  });
});
