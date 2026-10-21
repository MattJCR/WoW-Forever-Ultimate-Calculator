import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, Races, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { abilityEffectSummary, applyModifiers, collectStatEffects, decodeBuild, findAbility, indexClass, rankAtLevel, renderAbilityText, ruleAbilityDetail, ruleAppliesTo, ruleLines, spellModifiersOf } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70450");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
const legacy = indexClass(ClassTalents.parse(json("legacy.json")));
const abilities = Abilities.parse(json("abilities/mage.json"));
const rules = TalentRules.parse(json("rules/mage.json"));
const text = (parts: { text: string }[]): string => parts.map((p) => p.text).join("");
const nodeOf = (name: string) => mage.ordered.find((i) => i.talent.name === name)!.talent;
const full = (...names: string[]): Record<number, number> => Object.fromEntries(names.map((n) => [nodeOf(n).nodeId, nodeOf(n).maxRank]));

describe("texto de la habilidad con las mejoras", () => {
  const fireball = findAbility(abilities, "Bola de Fuego")!;
  const r12 = fireball.ranks[11]!;

  it("sin talentos el texto coincide con el del cliente (valores del nivel del rango)", () => {
    const m = applyModifiers(r12, 60, []);
    const t = text(renderAbilityText(r12, m));
    expect(t).toContain("causa 483 p. de daño de Fuego");
    expect(t).toContain("60 p. de daño extra durante 8 s");
    expect(renderAbilityText(r12, m).every((p) => !p.changed)).toBe(true);
  });

  it("con Inestabilidad Arcana 3/3 la Descarga de Escarcha sube un 3 % y las cifras cambiadas se marcan (Hielo penetrante se retiró el 20/10)", () => {
    const frostbolt = findAbility(abilities, "Descarga de Escarcha")!.ranks.at(-1)!;
    const none = text(renderAbilityText(frostbolt, applyModifiers(frostbolt, 60, [])));
    const mods = spellModifiersOf(mage, full("Inestabilidad Arcana"));
    const withTalent = renderAbilityText(frostbolt, applyModifiers(frostbolt, 60, mods));
    const nums = (s: string) => (s.match(/\d[\d.]*/g) ?? []).map((x) => Number(x.replace(/\./g, "")));
    const [lo0, hi0] = nums(none);
    const [lo1, hi1] = nums(text(withTalent));
    expect(lo1! / lo0!).toBeCloseTo(1.03, 1);
    expect(hi1! / hi0!).toBeCloseTo(1.03, 1);
    expect(withTalent.some((p) => p.changed)).toBe(true);
    expect(none).toMatch(/de \d+ a \d+ p\. de daño de Escarcha/);
  });

  it("la duracion del texto cambia con los modificadores de duracion (Escarcha permanente: +33 % al efecto de ralentizacion)", () => {
    const frostbolt = findAbility(abilities, "Descarga de Escarcha")!.ranks.at(-1)!;
    const base = text(renderAbilityText(frostbolt, applyModifiers(frostbolt, 60, [])));
    const changed = text(renderAbilityText(frostbolt, applyModifiers(frostbolt, 60, spellModifiersOf(mage, full("Escarcha permanente")))));
    expect(base).toContain("durante 9 s");
    expect(changed).not.toBe(base);
  });

  it("el nivel cambia los numeros del texto (rango 12 a nivel 60 frente a nivel 64: los puntos por nivel suben)", () => {
    const r = rankAtLevel(fireball, 60)!;
    const at60 = text(renderAbilityText(r, applyModifiers(r, 60, [])));
    const at64 = text(renderAbilityText(r, applyModifiers(r, 64, [])));
    expect(at64).not.toBe(at60);
  });

  it("todos los rangos del Mago generan un texto sin marcadores sin resolver", () => {
    for (const a of abilities.abilities) {
      for (const r of a.ranks) {
        const t = text(renderAbilityText(r, applyModifiers(r, r.maxLevel ?? 60, [])));
        expect(t, `${a.name} rango ${r.rank}`).not.toContain("{{");
      }
    }
  });
});

describe("reglas de talentos clasificadas a mano (Ignicion, Maestro de los elementos...)", () => {
  const build = full("Ignición", "Maestro de los elementos", "Trizar");
  const lines = ruleLines(rules, mage, build);
  const line = (name: string) => lines.find((l) => l.source.name === name)!;

  it("las 17 reglas del Mago son validas", () => {
    expect(rules.warnings).toEqual([]);
    expect(rules.rules).toHaveLength(17);
    expect(rules.provenance).toBe("assumption");
  });

  it("Ignicion 5/5 (40 %) afecta a los hechizos de daño de Fuego y no a los de Escarcha ni a los que no hacen daño", () => {
    const ign = line("Ignición");
    expect(ign.value).toBe(40);
    expect(ign.text).toContain("40 %");
    const applies = (name: string) => {
      const a = findAbility(abilities, name)!;
      return ruleAppliesTo(ign, a, a.ranks.at(-1)!);
    };
    for (const n of ["Bola de Fuego", "Chamuscar", "Explosión de Fuego", "Fogonazo"]) expect(applies(n), n).toBe(true);
    for (const n of ["Descarga de Escarcha", "Armadura de mago", "Teletransporte a: Dalaran"]) expect(applies(n), n).toBe(false);
  });

  it("el rango del talento cambia la cifra (Ignicion 1/5 = 8 %)", () => {
    const one = ruleLines(rules, mage, { [nodeOf("Ignición").nodeId]: 1 });
    expect(one[0]!.value).toBe(8);
  });

  it("Maestro de los elementos 3/3 devuelve el 30 % del coste base: Bola de Fuego rango 12 (410 de maná) = 123", () => {
    const mastery = line("Maestro de los elementos");
    const r12 = findAbility(abilities, "Bola de Fuego")!.ranks[11]!;
    expect(ruleAbilityDetail(mastery, r12).manaReturn).toBe(123);
    expect(ruleAbilityDetail(mastery, r12).text).toContain("123");
  });

  it("Tromba de misiles da la mitad de probabilidad a Bola de Fuego que a Explosion Arcana", () => {
    const l = ruleLines(rules, mage, full("Tromba de misiles")).map((x) => ({ names: x.scope.spells, v: x.value }));
    expect(l.find((x) => x.names?.includes("Explosión Arcana"))!.v).toBe(40);
    expect(l.find((x) => x.names?.includes("Bola de Fuego"))!.v).toBe(20);
  });

  it("los talentos con regla salen en los efectos sumados con su alcance y ya no en el texto suelto", () => {
    const classBuild = decodeBuild(mage, "V229luA1E1B2A1A1C2B4C3E1C1E6C8B1E1E1C6B")!;
    const legacyBuild = decodeBuild(legacy, "V22d3uE3E2B2B8B")!;
    const fx = collectStatEffects({ cls: mage, classBuild, legacy, legacyBuild, race: null, abilities, rules });
    const ign = fx.ruleEffects.find((r) => r.source.name === "Ignición")!;
    expect(ign.scope).toEqual(expect.arrayContaining(["Bola de Fuego", "Chamuscar", "Piroexplosión"]));
    expect(ign.scope).not.toContain("Descarga de Escarcha");
    const covered = ["Ignición", "Maestro de los elementos", "Trizar", "Mordiescarcha", "Dedos de Escarcha", "Escalofrío del invierno", "Tromba de misiles"];
    for (const n of covered) expect(fx.conditional.some((c) => c.source.name === n), n).toBe(false);
    // Los que no tienen regla (Legacy, activas) siguen como texto: nada se pierde
    expect(fx.conditional.some((c) => c.source.name === "Barrera de hielo")).toBe(true);
  });
});

describe("resumen de efectos por habilidad (tarjeta)", () => {
  const classBuild = decodeBuild(mage, "V229luA1E1B2A1A1C2B4C3E1C1E6C8B1E1E1C6B")!;
  const legacyBuild = decodeBuild(legacy, "V22d3uE3E2B2B8B")!;
  const human = Races.parse(json("races.json")).races.find((r) => r.id === 1)!;
  const fx = collectStatEffects({ cls: mage, classBuild, legacy, legacyBuild, race: human, abilities, rules });

  it("Descarga de Escarcha suma crítico (+2 de la raza), impacto +6 y bonus de crítico +100 (sin daño: Hielo penetrante se retiró el 20/10)", () => {
    const s = abilityEffectSummary("Descarga de Escarcha", fx);
    const get = (cat: string) => s.lines.find((l) => l.category === cat)!;
    expect(get("Probabilidad de crítico")).toMatchObject({ value: 2, unit: "puntos porcentuales" });
    expect(get("Probabilidad de crítico").sources.map((x) => x.name)).toEqual(["Humano: Crueldad"]);
    expect(get("Probabilidad de impacto").value).toBe(6);
    expect(get("Bonus de daño crítico").value).toBe(100);
    expect(s.lines.some((l) => l.category === "Daño y curación")).toBe(false);
  });

  it("Explosión de Fuego suma el crítico de la raza y el de Incineración en una sola línea (+8)", () => {
    const s = abilityEffectSummary("Explosión de Fuego", fx);
    const crit = s.lines.find((l) => l.category === "Probabilidad de crítico")!;
    expect(crit.value).toBe(8);
    expect(crit.sources.map((x) => x.name).sort()).toEqual(["Humano: Crueldad", "Incineración"]);
  });

  it("las categorías de coste, lanzamiento y alcance van aparte (se anotan junto a la cifra, no en la lista)", () => {
    const s = abilityEffectSummary("Bola de Fuego", fx);
    expect(s.lines.some((l) => l.category === "Tiempo de lanzamiento")).toBe(false);
    expect(s.inline["Tiempo de lanzamiento"]?.[0]).toMatchObject({ value: -0.5, unit: "s" });
    expect(s.inline["Alcance y radio"]?.some((l) => l.value === 6 && l.unit === "m")).toBe(true);
  });

  it("una habilidad sin efectos de talentos queda vacía y sin Ctrl el resultado sin mejoras es la base", () => {
    const s = abilityEffectSummary("Caída lenta", fx);
    expect(s.lines.filter((l) => l.category !== "Probabilidad de crítico").length).toBeLessThanOrEqual(2);
    const r = findAbility(abilities, "Bola de Fuego")!.ranks[11]!;
    const base = applyModifiers(r, 60, []);
    expect(base.castMs).toBe(3500);
    expect(base.applied).toEqual([]);
  });
});
