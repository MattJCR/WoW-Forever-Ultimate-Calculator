import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { collectStatEffects, effectAt, findAbility, indexClass, ruleAppliesTo, ruleLines, type Build } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70685");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const paladin = indexClass(ClassTalents.parse(json("classes/paladin.json")));
const abilities = Abilities.parse(json("abilities/paladin.json"));
const rules = TalentRules.parse(json("rules/paladin.json"));

/** Todos los talentos al rango máximo: no es un build legal, pero el motor no valida requisitos al sumar efectos. */
const maxed: Build = Object.fromEntries(paladin.ordered.map((i) => [i.talent.nodeId, i.talent.maxRank]));
const only = (name: string): Build => {
  const i = paladin.ordered.find((x) => x.talent.name === name)!;
  return { [i.talent.nodeId]: i.talent.maxRank };
};
const last = (name: string) => findAbility(abilities, name)!.ranks.at(-1)!;

describe("Paladín: habilidades, talentos y reglas", () => {
  it("los hechizos auxiliares no cuentan como rangos: Luz Sagrada 9, Destello de Luz 6, Choque Sagrado 4", () => {
    expect(findAbility(abilities, "Luz Sagrada")!.ranks).toHaveLength(9);
    expect(findAbility(abilities, "Destello de Luz")!.ranks).toHaveLength(6);
    expect(findAbility(abilities, "Choque Sagrado")!.ranks.map((r) => r.level)).toEqual([30, 40, 48, 56]);
  });

  it("la habilidad de runa Exorcismo no se mezcla con el Exorcismo normal", () => {
    expect(findAbility(abilities, "Exorcismo")!.ranks.map((r) => r.level)).toEqual([20, 28, 36, 44, 52, 60]);
    expect(findAbility(abilities, "Exorcismo (runa)")!.ranks).toHaveLength(6);
  });

  it("Infusión de Luz reduce 1 s el lanzamiento de Luz Sagrada y no toca a otras habilidades", () => {
    const line = ruleLines(rules, paladin, only("Infusión de Luz"))[0]!;
    expect(line.value).toBe(1);
    expect(ruleAppliesTo(line, findAbility(abilities, "Luz Sagrada")!, last("Luz Sagrada"))).toBe(true);
    expect(ruleAppliesTo(line, findAbility(abilities, "Destello de Luz")!, last("Destello de Luz"))).toBe(false);
  });

  it("Iluminación alcanza a las sanaciones nombradas y no a Consagración", () => {
    const line = ruleLines(rules, paladin, only("Iluminación"))[0]!;
    expect(line.value).toBe(100);
    for (const n of ["Destello de Luz", "Luz Sagrada", "Choque Sagrado"]) expect(ruleAppliesTo(line, findAbility(abilities, n)!, last(n))).toBe(true);
    expect(ruleAppliesTo(line, findAbility(abilities, "Consagración")!, last("Consagración"))).toBe(false);
  });

  it("las reglas del Paladín son válidas y ningún talento escogido se pierde", () => {
    expect(rules.warnings).toEqual([]);
    const fx = collectStatEffects({ cls: paladin, classBuild: maxed, legacy: null, legacyBuild: {}, race: null, abilities, rules });
    const covered = new Set([...fx.totals.flatMap((t) => t.sources.map((s) => s.name)), ...fx.conditional.map((c) => c.source.name), ...fx.ruleEffects.map((r) => r.source.name)]);
    for (const { talent } of paladin.ordered) expect(covered.has(talent.name ?? ""), talent.name ?? "").toBe(true);
  });

  it("Convicción suma crítico cuerpo a cuerpo a habilidades físicas que hacen daño", () => {
    const fx = collectStatEffects({ cls: paladin, classBuild: only("Convicción"), legacy: null, legacyBuild: {}, race: null, abilities, rules });
    const crit = fx.totals.find((t) => t.label === "probabilidad de crítico cuerpo a cuerpo")!;
    expect(crit.value).toBe(5);
    expect(crit.scope).not.toContain("Luz Sagrada");
  });
});

describe("Paladín: cifras directas frente a la referencia (a nivel min(60, nivel máximo))", () => {
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "paladin.json"), "utf8")).spell_desc as Record<string, { id?: number; d?: string }>;
  const byId = new Map<number, (typeof abilities.abilities)[number]["ranks"][number]>();
  for (const a of abilities.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("daño y sanación «X a Y» coinciden (±1) en 59 de 80 cifras; el resto son fórmulas por velocidad de arma o daño de arma normalizado", () => {
    let pairs = 0;
    let ok = 0;
    const bad = new Set<string>();
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r || !v.d) continue;
      const ours = r.effects.map((e) => effectAt(e, r, Math.min(60, r.maxLevel ?? 60)));
      for (const m of v.d.matchAll(/(\d[\d,]*) to (\d[\d,]*)/g)) {
        pairs++;
        const [a, b] = [Number(m[1]!.replace(/,/g, "")), Number(m[2]!.replace(/,/g, ""))];
        if (ours.some((o) => Math.abs(o.min - a) <= 1 && Math.abs(o.max - b) <= 1)) ok++;
        else bad.add(key.split("|")[1]!);
      }
    }
    expect(pairs).toBe(80);
    expect(ok).toBe(59);
    // Sello de rectitud (por golpe: valor/87 a valor/25 según la velocidad del arma), Golpe Sagrado (el 25-50 % de arma multiplica también el extra: La referencia muestra la mitad o menos) y la mitad sin aturdir de Sello de orden
    expect([...bad].sort()).toEqual(["Holy Strike", "Seal of Command", "Seal of Righteousness"]);
  });
});
