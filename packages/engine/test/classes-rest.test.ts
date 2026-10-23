import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { collectStatEffects, effectAt, findAbility, indexClass, ruleLines, type Build } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70532");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

/** Chamán, Cazador, Brujo y Druida: reglas válidas, ningún talento escogido se pierde y las cifras directas coinciden con la referencia. */
const CLASSES = [
  { token: "shaman", name: "Chamán", rules: 8, pairs: 72, ok: 62 },
  { token: "hunter", name: "Cazador", rules: 7, pairs: 3, ok: 3 },
  { token: "warlock", name: "Brujo", rules: 6, pairs: 33, ok: 33 },
  { token: "druid", name: "Druida", rules: 4, pairs: 45, ok: 45 },
] as const;

for (const c of CLASSES) {
  describe(`${c.name}: reglas y cifras`, () => {
    const cls = indexClass(ClassTalents.parse(json(`classes/${c.token}.json`)));
    const abilities = Abilities.parse(json(`abilities/${c.token}.json`));
    const rules = TalentRules.parse(json(`rules/${c.token}.json`));
    const maxed: Build = Object.fromEntries(cls.ordered.map((i) => [i.talent.nodeId, i.talent.maxRank]));

    it(`las ${c.rules} reglas son válidas y ningún talento escogido se pierde`, () => {
      expect(rules.warnings).toEqual([]);
      expect(rules.rules).toHaveLength(c.rules);
      const fx = collectStatEffects({ cls, classBuild: maxed, legacy: null, legacyBuild: {}, race: null, abilities, rules });
      const covered = new Set([...fx.totals.flatMap((t) => t.sources.map((s) => s.name)), ...fx.conditional.map((x) => x.source.name), ...fx.ruleEffects.map((r) => r.source.name)]);
      for (const { talent } of cls.ordered) expect(covered.has(talent.name ?? ""), talent.name ?? "").toBe(true);
      expect(ruleLines(rules, cls, maxed).length).toBeGreaterThanOrEqual(c.rules);
    });

    it(`daño y sanación «X a Y» frente a la referencia: ${c.ok} de ${c.pairs} (±1)`, () => {
      const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", `${c.token}.json`), "utf8")).spell_desc as Record<string, { id?: number; d?: string }>;
      const byId = new Map<number, (typeof abilities.abilities)[number]["ranks"][number]>();
      for (const a of abilities.abilities) for (const r of a.ranks) byId.set(r.spellId, r);
      let pairs = 0;
      let ok = 0;
      for (const v of Object.values(tf)) {
        const r = v.id ? byId.get(v.id) : undefined;
        if (!r || !v.d) continue;
        const ours = r.effects.map((e) => effectAt(e, r, Math.min(60, r.maxLevel ?? 60)));
        for (const m of v.d.matchAll(/(\d[\d,]*) to (\d[\d,]*)/g)) {
          pairs++;
          const [a, b] = [Number(m[1]!.replace(/,/g, "")), Number(m[2]!.replace(/,/g, ""))];
          if (ours.some((o) => Math.abs(o.min - a) <= 1 && Math.abs(o.max - b) <= 1)) ok++;
        }
      }
      expect([pairs, ok]).toEqual([c.pairs, c.ok]);
    });
  });
}

describe("rangos por nombre iguales a la referencia", () => {
  const ranks = (token: string, name: string) => findAbility(Abilities.parse(json(`abilities/${token}.json`)), name)?.ranks.length;
  it("Chamán: Escudo de relámpagos 7, Tótem de corriente curativa 5 (un rango traía otro nombre), Tótem de marea de maná 4", () => {
    expect([ranks("shaman", "Escudo de relámpagos"), ranks("shaman", "Tótem de corriente curativa"), ranks("shaman", "Tótem de marea de maná")]).toEqual([7, 5, 4]);
    expect(ranks("shaman", "Tótem Corriente de sanación")).toBeUndefined();
  });
  it("Chamán: Nova de Fuego escala con los niveles de su hechizo disparado (base 12, máximo 17): rango 1 = 32-38 a nivel 60", () => {
    const a = Abilities.parse(json("abilities/shaman.json"));
    const r = findAbility(a, "Nova de Fuego")!.ranks[0]!;
    const e = r.effects.find((x) => x.kind === "direct-damage")!;
    expect(e.levels).toEqual({ base: 12, max: 17 });
    const v = effectAt(e, r, 60);
    expect([v.min, v.max]).toEqual([32, 38]);
  });
  it("Cazador: Trampa de inmolación 5, Golpe de raptor 8 y su runa 8; las mitades auxiliares no cuentan", () => {
    expect([ranks("hunter", "Trampa de inmolación"), ranks("hunter", "Golpe de raptor"), ranks("hunter", "Golpe de raptor (runa)")]).toEqual([5, 8, 8]);
    expect(ranks("hunter", "Disparo de quimera: escórpido")).toBeUndefined();
  });
  it("Brujo: Crear piedra de fuego 4 y de hechizos 3 (nombres variantes unidos), Sacrificio demoníaco y Vínculo de alma (las enseña un talento)", () => {
    expect([ranks("warlock", "Crear piedra de fuego"), ranks("warlock", "Crear piedra de hechizos")]).toEqual([4, 3]);
    const a = Abilities.parse(json("abilities/warlock.json"));
    expect(findAbility(a, "Sacrificio demoníaco")!.ranks[0]).toMatchObject({ level: 20, learnedByTalent: true });
    expect(findAbility(a, "Vínculo de alma")!.ranks[0]).toMatchObject({ level: 30, learnedByTalent: true });
  });
  it("Druida: Furia del tigre se marca retirada según la referencia (el cliente la trae como runa)", () => {
    const a = Abilities.parse(json("abilities/druid.json"));
    expect(findAbility(a, "Furia del tigre")!.talentsForever).toMatchObject({ status: "retired" });
    expect(findAbility(a, "Forma de oso nefasto")).toBeDefined(); // La referencia también lista Dire Bear Form aparte
  });
});
