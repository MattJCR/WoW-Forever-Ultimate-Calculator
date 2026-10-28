import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { collectStatEffects, effectAt, findAbility, indexClass, ruleAppliesTo, ruleLines, type Build } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const priest = indexClass(ClassTalents.parse(json("classes/priest.json")));
const abilities = Abilities.parse(json("abilities/priest.json"));
const rules = TalentRules.parse(json("rules/priest.json"));

/** Todos los talentos al rango máximo: no es un build legal, pero el motor no valida requisitos al sumar efectos. */
const maxed: Build = Object.fromEntries(priest.ordered.map((i) => [i.talent.nodeId, i.talent.maxRank]));
const only = (name: string): Build => {
  const i = priest.ordered.find((x) => x.talent.name === name)!;
  return { [i.talent.nodeId]: i.talent.maxRank };
};
const last = (name: string) => findAbility(abilities, name)!.ranks.at(-1)!;

describe("Sacerdote: habilidades, talentos y reglas", () => {
  it("los hechizos auxiliares no cuentan como rangos: Guardia de las Sombras 6, Toque de debilidad 6, Penitencia 4", () => {
    expect(findAbility(abilities, "Guardia de las Sombras")!.ranks).toHaveLength(6);
    expect(findAbility(abilities, "Toque de debilidad")!.ranks).toHaveLength(6);
    expect(findAbility(abilities, "Penitencia")!.ranks.map((r) => r.level)).toEqual([30, 40, 50, 60]);
  });

  it("Renovar (runa) va aparte de Renovar y Control mental tiene 3 s de lanzamiento y luego se canaliza", () => {
    expect(findAbility(abilities, "Renovar")!.ranks).toHaveLength(10);
    expect(findAbility(abilities, "Renovar (runa)")!.ranks).toHaveLength(10);
    expect(last("Control mental")).toMatchObject({ castMs: 3000, channeled: true, durationMs: 60000 });
  });

  it("Esperanza renovada: +10 % de crítico y −5 s de Alma debilitada, solo en sanaciones", () => {
    const line = ruleLines(rules, priest, only("Esperanza renovada"))[0]!;
    expect(line.value).toBe(10);
    expect(line.text).toContain("reduce 5 s");
    expect(ruleAppliesTo(line, findAbility(abilities, "Curación superior")!, last("Curación superior"))).toBe(true);
    expect(ruleAppliesTo(line, findAbility(abilities, "Acometida")!, last("Acometida"))).toBe(false);
  });

  it("Desmayo alcanza a los hechizos de daño de las Sombras y no a la Acometida (Sagrado)", () => {
    const line = ruleLines(rules, priest, only("Desmayo"))[0]!;
    expect(line.value).toBe(10);
    expect(ruleAppliesTo(line, findAbility(abilities, "Palabra de las Sombras: Dolor")!, last("Palabra de las Sombras: Dolor"))).toBe(true);
    expect(ruleAppliesTo(line, findAbility(abilities, "Acometida")!, last("Acometida"))).toBe(false);
  });

  it("las reglas del Sacerdote son válidas y ningún talento escogido se pierde", () => {
    expect(rules.warnings).toEqual([]);
    const fx = collectStatEffects({ cls: priest, classBuild: maxed, legacy: null, legacyBuild: {}, race: null, abilities, rules });
    const covered = new Set([...fx.totals.flatMap((t) => t.sources.map((s) => s.name)), ...fx.conditional.map((c) => c.source.name), ...fx.ruleEffects.map((r) => r.source.name)]);
    for (const { talent } of priest.ordered) expect(covered.has(talent.name ?? ""), talent.name ?? "").toBe(true);
  });
});

describe("Sacerdote: cifras directas frente a la referencia (a nivel min(60, nivel máximo))", () => {
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "priest.json"), "utf8")).spell_desc as Record<string, { id?: number; d?: string }>;
  const byId = new Map<number, (typeof abilities.abilities)[number]["ranks"][number]>();
  for (const a of abilities.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("daño y sanación «X a Y» coinciden (±1) en las 95 cifras", () => {
    let pairs = 0;
    let ok = 0;
    let hotfixed = 0;
    for (const v of Object.values(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r || !v.d) continue;
      const ours = r.effects.map((e) => effectAt(e, r, Math.min(60, r.maxLevel ?? 60)));
      for (const m of v.d.matchAll(/(\d[\d,]*) to (\d[\d,]*)/g)) {
        pairs++;
        const [a, b] = [Number(m[1]!.replace(/,/g, "")), Number(m[2]!.replace(/,/g, ""))];
        if (ours.some((o) => Math.abs(o.min - a) <= 1 && Math.abs(o.max - b) <= 1)) ok++;
        else if (v.id === 14914) hotfixed++; // Fuego Sagrado rango 1: hotfix del 18/10 (57-70 → 53-65); la referencia aún trae el valor anterior
      }
    }
    expect(pairs).toBe(95);
    expect([ok, hotfixed]).toEqual([95, 0]); // la referencia (export del 27/10) ya trae el hotfix de Fuego Sagrado rango 1 (antes 94 + 1)
  });
});
