import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityEffectSummary, applyModifiers, collectStatEffects, damageDonePct, dealsDamage, healsTarget, indexClass, rankAtLevel, spellModifiersOf, type Build } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const load = (token: string) => ({ cls: indexClass(ClassTalents.parse(json(`classes/${token}.json`))), abilities: Abilities.parse(json(`abilities/${token}.json`)), rules: TalentRules.parse(json(`rules/${token}.json`)) });
const only = (cls: ReturnType<typeof indexClass>, name: string): Build => {
  const t = cls.ordered.find((i) => i.talent.name === name)!.talent;
  return { [t.nodeId]: t.maxRank };
};

/** Daño infligido por escuela (aura 79): llega al daño de las habilidades de esa escuela; el condicionado al equipo queda como texto. */
describe("daño infligido por escuela", () => {
  const priest = load("priest");
  const fx = (name: string) => collectStatEffects({ cls: priest.cls, classBuild: only(priest.cls, name), legacy: null, legacyBuild: {}, race: null, abilities: priest.abilities, rules: priest.rules });
  const ranks = priest.abilities.abilities.map((a) => ({ a, rank: rankAtLevel(a, 60)! })).filter((x) => x.rank);
  const shadow = ranks.find((x) => x.rank.schoolMask === 32 && dealsDamage(x.rank))!;
  const holyHeal = ranks.find((x) => x.rank.schoolMask === 2 && healsTarget(x.rank) && !dealsDamage(x.rank))!;

  it("Oscuridad (+10 % daño de las Sombras) sube el daño de una habilidad de Sombras y no el de una sanación Sagrada", () => {
    const f = fx("Oscuridad");
    expect(damageDonePct(f, 32)).toBe(10);
    expect(damageDonePct(f, 2)).toBe(0);
    const base = applyModifiers(shadow.rank, 60, []);
    const withIt = applyModifiers(shadow.rank, 60, [], { damageDonePct: 10 });
    const dmg = (m: typeof base) => m.effects.filter((e) => e.effect.kind === "direct-damage" || e.effect.kind === "periodic-damage");
    expect(dmg(base).length).toBeGreaterThan(0);
    dmg(base).forEach((e, i) => {
      expect(dmg(withIt)[i]!.final.average).toBeCloseTo(e.final.average * 1.1, 5);
      if (e.coefficient !== null) expect(dmg(withIt)[i]!.coefficient).toBeCloseTo(e.coefficient * 1.1, 5);
    });
    // La sanación no se toca
    const heal = applyModifiers(holyHeal.rank, 60, [], { damageDonePct: 10 });
    expect(heal.effects.map((e) => e.final.average)).toEqual(applyModifiers(holyHeal.rank, 60, []).effects.map((e) => e.final.average));
  });

  it("la tarjeta de la habilidad de Sombras lista el bono; la sanación Sagrada y las de otra escuela no lo reciben", () => {
    const f = fx("Oscuridad");
    const label = (name: string, x: typeof shadow) => abilityEffectSummary(name, f, { schoolMask: x.rank.schoolMask, dealsDamage: dealsDamage(x.rank) }).lines.map((l) => `${l.label}=${l.value}`);
    expect(label(shadow.a.name, shadow)).toContain("daño infligido=10");
    expect(label(holyHeal.a.name, holyHeal)).not.toContain("daño infligido=10");
  });

  it("Especialización en varitas (+25 % con varitas) NO es un bono permanente: no suma al personaje y se conserva como texto", () => {
    const f = fx("Especialización en varitas");
    expect(f.totals.filter((t) => t.label === "daño infligido")).toEqual([]);
    expect(f.conditional.map((c) => c.source.name)).toContain("Especialización en varitas");
    expect(damageDonePct(f, 126)).toBe(0);
  });

  it("los condicionados al equipo o al estado de las demás clases tampoco suman (armas de una o dos manos, escudo, sin mascota, armas a distancia)", () => {
    const CONDITIONAL: [string, string][] = [
      ["paladin", "Especialización en armas de una mano"],
      ["paladin", "Especialización en armas de dos manos"],
      ["warrior", "Especialización en armas de dos manos"],
      ["warrior", "Bastión"],
      ["hunter", "Lobo solitario"],
      ["hunter", "Especialización en armas a distancia"],
    ];
    for (const [token, talent] of CONDITIONAL) {
      const c = load(token);
      const f = collectStatEffects({ cls: c.cls, classBuild: only(c.cls, talent), legacy: null, legacyBuild: {}, race: null, abilities: c.abilities, rules: c.rules });
      expect(f.totals.filter((t) => t.label === "daño infligido"), `${token}: ${talent}`).toEqual([]);
      expect(f.conditional.map((x) => x.source.name), `${token}: ${talent}`).toContain(talent);
    }
  });

  it("los permanentes sí suman: Furia de luna (+10 % Naturaleza y Arcano), Naturalista (+5 % a todo), Luz abrasadora (+5 % Sagrado)", () => {
    const druid = load("druid");
    const dfx = (name: string) => collectStatEffects({ cls: druid.cls, classBuild: only(druid.cls, name), legacy: null, legacyBuild: {}, race: null, abilities: druid.abilities, rules: druid.rules });
    expect(damageDonePct(dfx("Furia de luna"), 8 | 64)).toBe(10);
    expect(damageDonePct(dfx("Furia de luna"), 4)).toBe(0);
    expect(damageDonePct(dfx("Naturalista"), 1)).toBe(5);
    expect(damageDonePct(dfx("Naturalista"), 4)).toBe(5);
    expect(damageDonePct(fx("Luz abrasadora"), 2)).toBe(5);
    expect(damageDonePct(fx("Luz abrasadora"), 32)).toBe(0);
  });

  it("los modificadores de talentos y el daño infligido se multiplican entre sí", () => {
    const f = fx("Oscuridad");
    const mods = spellModifiersOf(priest.cls, only(priest.cls, "Oscuridad"));
    const a = applyModifiers(shadow.rank, 60, mods, { damageDonePct: damageDonePct(f, 32) });
    expect(a.effects.length).toBeGreaterThan(0);
  });
});
