import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, CombatRatings, EquipRules, Items } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import {
  activeGearEffects,
  classifyGearAuras,
  collectStatEffects,
  gearSpellModifiers,
  indexClass,
  indexGearData,
  slotsForItem,
  summarizeGear,
  textHasNumber,
  type GearEffectSource,
  type GearSelection,
} from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70685");
const has = existsSync(join(D, "items.json")) && existsSync(join(D, "equip-rules.json"));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

describe.skipIf(!has)("bonos de conjunto y efectos de objeto (cliente 1.60.1.70685)", () => {
  const items = Items.parse(json("items.json"));
  const data = indexGearData({ items, rules: EquipRules.parse(json("equip-rules.json")) });
  const ratings = CombatRatings.parse(json("combat-ratings.json"));
  const all: GearEffectSource[] = [
    ...items.sets.flatMap((s) => s.bonuses.map((b) => ({ kind: "set" as const, name: b.name, origin: s.name, spellId: b.spellId, text: b.text, auras: b.auras, slot: null, itemId: null }))),
    ...items.items.flatMap((i) => i.effects.filter((e) => e.trigger === 1).map((e) => ({ kind: "item" as const, name: e.name, origin: i.name, spellId: e.spellId, text: e.text, auras: e.auras, slot: null, itemId: i.id }))),
  ];
  const bySpell = (id: number): GearEffectSource => all.find((e) => e.spellId === id)!;
  const stats = (id: number) => Object.fromEntries(classifyGearAuras(bySpell(id).auras, bySpell(id).text).stats.map((s) => [s.key, s.value]));

  it("poder de ataque (cuerpo a cuerpo y a distancia gemelos), poder con hechizos (daño y sanación gemelos), atributo, defensa y maná cada 5 s", () => {
    expect(stats(9331)).toEqual({ "attack-power": 20 }); // «+20 p. de poder de ataque» (dos auras gemelas = una estadística que suma al cuerpo a cuerpo y a distancia)
    expect(stats(14047)).toEqual({ "spell-power": 23 }); // «daño y la curación de los hechizos mágicos hasta en 23 p.»
    expect(stats(9106)).toEqual({ intellect: 10 });
    expect(stats(7516)).toEqual({ defense: 3 });
    expect(stats(18378)).toEqual({ "mana-per-5": 8 });
    expect(stats(26175)).toEqual({ "spell-penetration": 10 });
    expect(stats(14707)).toEqual({ "arcane-resistance": 5 });
  });

  it("puntuaciones (aura 189): impacto, crítico y pericia, y el % del texto coincide con puntuación ÷ puntuación por 1 %", () => {
    expect(stats(1299734)).toEqual({ "hit-rating": 5 });
    expect(stats(1299738)).toEqual({ "crit-rating": 21 });
    expect(stats(1301096)).toEqual({ "expertise-rating": 12 });
    const per = (key: string) => ratings.ratings[{ "hit-rating": "hit-melee", "crit-rating": "crit-melee", "expertise-rating": "expertise" }[key]!]!;
    for (const [id, key, pct] of [[1299734, "hit-rating", 0.5], [1299738, "crit-rating", 1.5], [1301096, "expertise-rating", 1.2]] as const) {
      expect(stats(id)[key]! / per(key)).toBeCloseTo(pct, 1);
    }
  });

  it("solo se cuantifica lo que el texto del cliente confirma, y nada se cuenta en dos sitios (plano o porcentaje)", () => {
    let flat = 0;
    for (const e of all) {
      const { stats: out, consumed } = classifyGearAuras(e.auras, e.text);
      if (out.length > 0) flat++;
      for (const a of e.auras) {
        if (!consumed.has(a.index)) continue;
        // todo aura plana consumida: su cifra aparece en el texto (salvo las puntuaciones, que el texto da en %)
        if (a.aura !== 189 && !a.levelScaled && !textHasNumber(e.text, a.value)) throw new Error(`${e.spellId}: ${a.value} no está en «${e.text}»`);
      }
      // ninguna clave repetida en el mismo hechizo salvo las que expande «todos los atributos / resistencias»
      expect(new Set(out.map((s) => s.key)).size).toBe(out.length);
    }
    expect(flat).toBeGreaterThan(300);
  });

  it("los porcentajes entran en los efectos sumados con origen «equipo» y el resto queda como texto", () => {
    const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
    const abilities = Abilities.parse(json("abilities/mage.json"));
    const hit = bySpell(432639); // «Mejora un 1,0% tu probabilidad de golpear» (aura 54 + gemela 55)
    const dummy = all.find((e) => e.auras.length > 0 && e.auras.every((a) => a.aura === 4 || a.aura === 42) && e.text)!;
    const fx = collectStatEffects({ cls: mage, classBuild: {}, legacy: null, legacyBuild: {}, race: null, abilities, gearEffects: [hit, dummy] });
    const line = fx.totals.find((t) => t.category === "Probabilidad de impacto");
    expect(line).toMatchObject({ value: 1, scope: null });
    expect(line!.sources.every((s) => s.from === "gear")).toBe(true);
    expect(fx.conditional.find((c) => c.source.name === dummy.name)).toMatchObject({ active: false, text: dummy.text });
    expect(fx.conditional.some((c) => c.source.name === hit.name)).toBe(false);
  });

  it("crítico con hechizos (57), armadura (674), celeridad (342 + 65), esquive/parada del enemigo (593) y resistencia a controles (117) también se reflejan", () => {
    const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
    const abilities = Abilities.parse(json("abilities/mage.json"));
    const fx = collectStatEffects({ cls: mage, classBuild: {}, legacy: null, legacyBuild: {}, race: null, abilities, gearEffects: [bySpell(21092), bySpell(1300945), bySpell(1213289), bySpell(1301126)] });
    const find = (label: string) => fx.totals.find((t) => t.label === label);
    // «+2 % de crítico con hechizos»: solo a las habilidades de hechizo que pueden ser críticas (no a las físicas ni a los buffs)
    const crit = find("probabilidad de crítico con hechizos")!;
    expect(crit.value).toBe(2);
    expect(crit.scope).toContain("Bola de Fuego");
    expect(crit.scope).not.toContain("Armadura de mago");
    expect(find("celeridad de ataque y de lanzamiento")).toMatchObject({ value: 1, unit: "%" });
    expect(find("probabilidad de que el enemigo esquive o pare tus ataques")).toMatchObject({ value: -2 });
    expect(find("probabilidad de que te afecten los efectos de miedo")).toMatchObject({ value: -8, category: "Defensa" });
    // «+150 p. de armadura» suma a la armadura extra del equipo
    expect(stats(15693)).toEqual({ "extra-armor": 150 });
    // La velocidad de lanzamiento gemela (65) no duplica la celeridad ni queda como texto aparte
    expect(fx.conditional.some((c) => c.source.name === bySpell(1300945).name)).toBe(false);
  });

  it("modificadores de habilidades del equipo (auras 107/108) con su mascara, en el formato de los talentos", () => {
    const withMods = all.filter((e) => gearSpellModifiers([e]).length > 0);
    expect(withMods.length).toBeGreaterThan(50);
    const m = gearSpellModifiers([withMods[0]!])[0]!;
    expect(m.mask.some((x) => x !== 0)).toBe(true);
    expect(m.source.nodeId).toBe(0);
  });

  it("un conjunto completo activa sus bonos por piezas y los suma a las estadísticas del equipo", () => {
    const set = items.sets.find((s) => s.bonuses.some((b) => b.threshold === 2 && classifyGearAuras(b.auras, b.text).stats.length > 0) && s.itemIds.filter((id) => data.items.has(id)).length >= 2)!;
    expect(set).toBeTruthy();
    const pieces = set.itemIds.map((id) => data.items.get(id)).filter((i): i is NonNullable<typeof i> => !!i);
    const gear: GearSelection = {};
    const used = new Set<string>();
    for (const p of pieces) {
      const slot = slotsForItem(p).find((s) => !used.has(s));
      if (slot) {
        used.add(slot);
        gear[slot] = { itemId: p.id };
      }
    }
    const worn = Object.keys(gear).length;
    const active = activeGearEffects(gear, data).filter((e) => e.kind === "set");
    expect(active.map((e) => e.spellId).sort()).toEqual(set.bonuses.filter((b) => b.threshold <= worn).map((b) => b.spellId).filter((v, i, a) => a.indexOf(v) === i).sort());
    const summary = summarizeGear(gear, { classId: 1, raceId: 1, level: 60 }, data);
    const bonus = set.bonuses.find((b) => b.threshold === 2 && classifyGearAuras(b.auras, b.text).stats.length > 0)!;
    const key = classifyGearAuras(bonus.auras, bonus.text).stats[0]!;
    const line = summary.lines.find((l) => l.key === key.key)!;
    expect(line.sources.some((s) => s.origin === "set" && s.value === key.value)).toBe(true);
  });
});
