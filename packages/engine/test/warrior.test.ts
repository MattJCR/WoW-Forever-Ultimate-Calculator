import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { applyModifiers, collectStatEffects, renderAbilityText, findAbility, indexClass, ruleAppliesTo, ruleLines, spellModifiersOf, type Build } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70532");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const warrior = indexClass(ClassTalents.parse(json("classes/warrior.json")));
const abilities = Abilities.parse(json("abilities/warrior.json"));
const rules = TalentRules.parse(json("rules/warrior.json"));

/** Todos los talentos al rango máximo: no es un build legal, pero el motor no valida requisitos al sumar efectos. */
const maxed: Build = Object.fromEntries(warrior.ordered.map((i) => [i.talent.nodeId, i.talent.maxRank]));
const only = (name: string): Build => ({ [warrior.ordered.find((i) => i.talent.name === name)!.talent.nodeId]: warrior.ordered.find((i) => i.talent.name === name)!.talent.maxRank });
const last = (name: string) => findAbility(abilities, name)!.ranks.at(-1)!;

describe("Guerrero: habilidades, talentos y reglas", () => {
  it("la ira va multiplicada por 10 en el cliente (Golpe heroico 15 de ira = 150) y Ira enfocada baja 3 de ira (−30)", () => {
    const heroic = last("Golpe heroico");
    expect(heroic.costType).toBe("rage");
    expect(heroic.cost! % 10).toBe(0);
    const m = applyModifiers(heroic, 60, spellModifiersOf(warrior, only("Ira enfocada")));
    expect(m.cost).toBe(heroic.cost! - 30);
  });

  it("Ejecutar tiene 5 rangos con los niveles 24, 32, 40, 48 y 56", () => {
    const e = findAbility(abilities, "Ejecutar")!;
    expect(e.ranks.map((r) => r.level)).toEqual([24, 32, 40, 48, 56]);
  });

  it("Crueldad suma +5 puntos de crítico cuerpo a cuerpo solo a habilidades físicas que hacen daño", () => {
    const fx = collectStatEffects({ cls: warrior, classBuild: only("Crueldad"), legacy: null, legacyBuild: {}, race: null, abilities, rules });
    const crit = fx.totals.find((t) => t.label === "probabilidad de crítico cuerpo a cuerpo")!;
    expect(crit.value).toBe(5);
    expect(crit.scope).toContain("Golpe heroico");
    expect(crit.scope).toContain("Ejecutar");
    expect(crit.scope).not.toContain("Grito de guerra");
    expect(crit.scope).not.toContain("Actitud de batalla");
  });

  it("Anticipación suma 20 puntos de habilidad en defensa y Embate mejorado −0,5 s de enfriamiento global", () => {
    const fx = collectStatEffects({ cls: warrior, classBuild: { ...only("Anticipación"), ...only("Embate mejorado") }, legacy: null, legacyBuild: {}, race: null, abilities, rules });
    expect(fx.totals.find((t) => t.label === "habilidad en defensa")).toMatchObject({ value: 20, unit: "puntos" });
    expect(fx.totals.find((t) => t.label === "enfriamiento global")).toMatchObject({ value: -0.5, unit: "s", scope: ["Embate"] });
  });

  it("las reglas del Guerrero son válidas y ningún talento escogido se pierde", () => {
    expect(rules.warnings).toEqual([]);
    const fx = collectStatEffects({ cls: warrior, classBuild: maxed, legacy: null, legacyBuild: {}, race: null, abilities, rules });
    const covered = new Set([...fx.totals.flatMap((t) => t.sources.map((s) => s.name)), ...fx.conditional.map((c) => c.source.name), ...fx.ruleEffects.map((r) => r.source.name)]);
    for (const { talent } of warrior.ordered) expect(covered.has(talent.name ?? ""), talent.name ?? "").toBe(true);
  });

  it("las reglas por escuela física alcanzan a los golpes de arma (daño de arma, no solo de escuela) y no a los gritos", () => {
    const deep = ruleLines(rules, warrior, only("Heridas profundas"))[0]!;
    expect(deep.value).toBe(60);
    const applies = (n: string) => ruleAppliesTo(deep, findAbility(abilities, n)!, last(n));
    for (const n of ["Golpe heroico", "Abrumar", "Ejecutar", "Sed de sangre"]) expect(applies(n), n).toBe(true);
    for (const n of ["Grito de guerra", "Actitud de batalla", "Muro de escudo"]) expect(applies(n), n).toBe(false);
  });

  it("Ira rabiosa mejorada divide entre 10 la ira que genera (el cliente guarda 100 = 10 p.)", () => {
    const line = ruleLines(rules, warrior, only("Ira rabiosa mejorada"))[0]!;
    expect(line.value).toBe(10);
    expect(line.text).toContain("genera 10 p. de ira");
    expect(line.text).toContain("100 %");
  });
});

describe("texto de las habilidades del Guerrero", () => {
  const text = (name: string) => {
    const r = last(name);
    return renderAbilityText(r, applyModifiers(r, 60, [])).map((p) => p.text).join("");
  };

  it("Ejecutar resuelve $*10;F1 con la amplitud de cadena del cliente: 15 p. de daño extra por punto de ira en el rango 5", () => {
    expect(text("Ejecutar")).toContain("convirtiendo cada punto extra de ira en 15 p. de daño extra");
  });

  it("ninguna habilidad del Guerrero deja marcadores del cliente sin resolver ($i, $7376s3, ${...})", () => {
    for (const a of abilities.abilities) for (const r of a.ranks) {
      const t = renderAbilityText(r, applyModifiers(r, 60, [])).map((p) => p.text).join("");
      expect(t, `${a.name} rango ${r.rank}`).not.toMatch(/\$|\{\{/);
    }
  });
});
