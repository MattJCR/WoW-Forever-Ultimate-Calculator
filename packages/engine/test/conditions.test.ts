import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { applyModifiers, findAbility, indexClass, knownSpellIds, plainTemplate, renderAbilityText, splitConditions, talentEffectValue } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70532");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const legacy = indexClass(ClassTalents.parse(json("legacy.json")));
const text = (parts: { text: string }[]): string => parts.map((p) => p.text).join("");

describe("condicionales del texto de la habilidad («si tienes el talento X»)", () => {
  it("splitConditions elige la rama según los hechizos conocidos y admite anidadas", () => {
    const t = "A s1sí1no1 B a2|a3sí2 s4anidadanadano2 C";
    expect(splitConditions(t).map((s) => s.text).join("")).toBe("A no1 B no2 C");
    expect(plainTemplate(t)).toBe("A no1 B no2 C");
    const withKnown = splitConditions(t, new Set([1, 3, 4]));
    expect(withKnown.map((s) => s.text).join("")).toBe("A sí1 B sí2 anidada C");
    expect(withKnown.filter((s) => s.chosen).map((s) => s.text)).toEqual(["sí1", "sí2 ", "anidada"]);
    expect(splitConditions(t, new Set([1])).map((s) => s.text).join("")).toBe("A sí1 B no2 C");
  });

  const druid = indexClass(ClassTalents.parse(json("classes/druid.json")));
  const druidAbilities = Abilities.parse(json("abilities/druid.json"));
  const overgrowth = druid.ordered.find((i) => i.talent.spellId === 17245)!.talent;
  const entangle = findAbility(druidAbilities, "Enredaderas")!.ranks.at(-1)!;
  const build = { [overgrowth.nodeId]: overgrowth.maxRank };
  const input = { cls: druid, classBuild: build, legacy, legacyBuild: {}, abilities: druidAbilities, level: 60 };

  it("Enredaderas: sin el talento solo un objetivo; con Sobrecrecimiento el máximo del talento, resaltado", () => {
    const m = applyModifiers(entangle, 60, []);
    expect(text(renderAbilityText(entangle, m))).toContain("tener 1 solo objetivo enraizado");
    const none = knownSpellIds({ ...input, classBuild: {} });
    expect(none.has(17245)).toBe(false);
    const known = knownSpellIds(input);
    expect(known.has(17245)).toBe(true);
    const parts = renderAbilityText(entangle, m, { known, talentValue: (id, i) => talentEffectValue(input, id, i) });
    const t = text(parts);
    expect(t).toMatch(/tener un máximo de \d+ objetivos enraizados/);
    expect(t).not.toContain("1 solo objetivo");
    expect(parts.some((p) => p.changed && p.text.includes("máximo"))).toBe(true);
  });

  it("el valor del talento sale de su rango escogido", () => {
    expect(talentEffectValue(input, 17245, 0)).toBe(overgrowth.rankValues[overgrowth.maxRank - 1]![0]);
    expect(talentEffectValue({ ...input, classBuild: {} }, 17245, 0)).toBeNull();
  });

  it("las habilidades de runa no cuentan como conocidas y las de la clase sí, por nivel", () => {
    const known1 = knownSpellIds({ ...input, classBuild: {}, level: 1 });
    const known60 = knownSpellIds({ ...input, classBuild: {}, level: 60 });
    expect(known60.size).toBeGreaterThan(known1.size);
    const runeSpell = druidAbilities.abilities.flatMap((a) => a.ranks).find((r) => r.acquireMethod === 3)!;
    expect(known60.has(runeSpell.spellId)).toBe(false);
  });
});
