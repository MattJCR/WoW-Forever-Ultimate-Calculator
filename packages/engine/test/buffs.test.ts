import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, Buffs, ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { addStats, buffAsEffect, buffEffects, buffFlatStats, collectStatEffects, decodeBuffs, encodeBuffs, improveBuff, indexBuffs, indexClass, isLastingBuff, spellModifiersOf, toggleBuff } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70707");
const has = existsSync(join(D, "buffs.json")) && existsSync(join(D, "classes", "warrior.json"));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

/** Beneficios (sesión 12): habilidades de clase propias y de otras clases, tótems, mascota y consumibles, todo del cliente. */
describe.skipIf(!has)("beneficios (buffs) del cliente 1.60.1.70707", () => {
  const data = Buffs.parse(json("buffs.json"));
  const index = indexBuffs(data);
  const byName = (name: string, category?: string) => data.buffs.find((b) => b.name === name && (!category || b.category === category))!;
  const warrior = indexClass(ClassTalents.parse(json("classes/warrior.json")));
  const abilities = Abilities.parse(json("abilities/warrior.json"));

  it("hay beneficios de las nueve clases, tótems, mascota y consumibles; todos con cifras y del cliente", () => {
    expect(data.provenance).toBe("client-db2");
    const classes = new Set(data.buffs.filter((b) => b.category === "class").map((b) => b.classId));
    expect([...classes].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 11]);
    for (const c of ["totem", "pet", "camp", "profession", "potion", "elixir", "flask", "scroll", "food", "other"]) expect(data.buffs.some((b) => b.category === c), c).toBe(true);
    // Los pasivos de profesión son la única excepción: estimación de la comunidad, y dos no traen cifra (solo texto)
    expect(data.buffs.filter((b) => b.provenance !== "client-db2").map((b) => b.category)).toEqual(["profession", "profession", "profession"]);
    expect(data.buffs.filter((b) => b.category !== "profession").every((b) => b.auras.length > 0 && b.auras.some((a) => a.value !== 0))).toBe(true);
    expect(new Set(data.buffs.map((b) => b.id)).size).toBe(data.buffs.length);
  });

  it("cifras conocidas: Grito de guerra +139 de poder de ataque, Bendición de los Reyes +10 % a todo, Marca de lo salvaje, Fuerza de la Tierra", () => {
    expect(byName("Grito de guerra").auras.map((a) => [a.aura, a.value])).toEqual([[99, 139]]);
    expect(byName("Bendición de los Reyes").auras.map((a) => [a.aura, a.miscValue, a.value])).toEqual([[137, -1, 10]]);
    expect(buffFlatStats([byName("Marca de lo salvaje")].map((b) => ({ kind: "buff" as const, name: b.name, origin: b.name, spellId: b.id, text: b.text, auras: b.auras, slot: null, itemId: null })))).toMatchObject({ "extra-armor": 385, strength: 16, agility: 16, stamina: 16, intellect: 16, spirit: 16, "fire-resistance": 27 });
    expect(byName("Fuerza de la Tierra", "totem").auras.map((a) => a.value)).toEqual([53]);
  });

  it("los beneficios de cada grupo no se acumulan: una sola bendición de Poderío (normal o superior), un solo aspecto, una sola armadura de mago", () => {
    const might = byName("Bendición del poderío");
    const greater = byName("Bendición superior de poderío");
    expect(might.group).toBe(greater.group);
    let sel = toggleBuff(new Set(), might, true, index);
    sel = toggleBuff(sel, greater, true, index);
    expect([...sel]).toEqual([greater.id]);
    const hawk = byName("Aspecto del halcón");
    const monkey = byName("Aspecto del mono");
    expect([...toggleBuff(toggleBuff(new Set(), hawk, true, index), monkey, true, index)]).toEqual([monkey.id]);
    // Marcas de otras clases sí se acumulan con las de la propia
    const kings = byName("Bendición de los Reyes");
    expect(new Set([...toggleBuff(sel, kings, true, index)]).size).toBe(2);
    // Desmarcar quita solo ese
    expect([...toggleBuff(sel, greater, false, index)]).toEqual([]);
  });

  it("el código del enlace va y vuelve, y descarta lo que ya no existe", () => {
    const sel = new Set([byName("Grito de guerra").id, byName("Fuerza de la Tierra", "totem").id]);
    const code = encodeBuffs(sel);
    expect(code).toMatch(/^[0-9a-z.]+$/);
    expect([...decodeBuffs(code, index)].sort()).toEqual([...sel].sort());
    expect(decodeBuffs("zzzzzz.%%.", index).size).toBe(0);
    expect(decodeBuffs(null, index).size).toBe(0);
  });

  it("al sumarlos entran como equipo: el poder de ataque plano y el porcentaje de todas las estadísticas", () => {
    const picks = [byName("Grito de guerra"), byName("Bendición de los Reyes"), byName("Elixir de fuerza superior")];
    const sources = buffEffects(new Set(picks.map((b) => b.id)), index);
    expect(sources.every((s) => s.kind === "buff")).toBe(true);
    const flat = buffFlatStats(sources);
    expect(flat).toMatchObject({ "attack-power": 139, strength: 25 });
    expect(addStats({ "attack-power": 10 }, flat)["attack-power"]).toBe(149);
    const fx = collectStatEffects({ cls: warrior, classBuild: {}, legacy: null, legacyBuild: {}, race: null, abilities, gearEffects: sources });
    const all = fx.totals.find((t) => t.label === "todos los atributos");
    expect(all).toMatchObject({ value: 10, unit: "%" });
    expect(all!.sources.every((s) => s.from === "buff")).toBe(true);
    // Las cifras planas no se cuentan dos veces como porcentajes
    expect(fx.totals.some((t) => t.label.includes("poder de ataque") && t.value === 139)).toBe(false);
  });

  it("los consumibles «Endless» (hotfix del 22/10) suman la cifra de su texto del cliente", () => {
    const lines = (name: string) => {
      const fx = collectStatEffects({ cls: warrior, classBuild: {}, legacy: null, legacyBuild: {}, race: null, abilities, gearEffects: [buffAsEffect(byName(name))] });
      return fx.totals.map((t) => `${t.label} ${t.value}${t.unit === "%" ? "%" : ""}`);
    };
    expect(lines("Elixir de sanación interminable")).toEqual(["sanación realizada 2%"]); // «Increases healing done by 2%»
    expect(lines("Elixir de presteza interminable")).toEqual(["celeridad cuerpo a cuerpo y a distancia 4%"]); // «Increases Haste by 4%»
    expect(lines("Elixir de maná interminable")).toEqual(["regeneración de maná (%) 30%"]); // «Increases mana regeneration by 30%»
    expect(lines("Pergamino de entereza interminable")).toEqual(["Aguante 10%"]); // «Increases Stamina of nearby allies by 10%»
    expect(lines("Pergamino de velocidad interminable")).toEqual(["velocidad de movimiento 50%"]); // «Increases run speed … by 50%»
    expect(byName("Pergamino de velocidad interminable").durationMs).toBe(30_000); // el único pergamino corto
    expect(lines("Elixir de experiencia interminable")).toEqual([]); // solo texto: experiencia +200 %
    // Nombre y texto: traducción propia (el cliente los trae en inglés) con su aviso y el inglés oficial como nombre en inglés
    const own = data.buffs.filter((b) => /interminable$/.test(b.name));
    expect(own).toHaveLength(10);
    // El 70707 trae en español el texto de 3 (Elixir de crecimiento y de experiencia, Pergamino de velocidad): la traducción propia sobra y manda el cliente; las otras 7 siguen con aviso
    expect(own.filter((b) => b.textOrigin === "client").map((b) => b.name).sort()).toEqual(["Elixir de crecimiento interminable", "Elixir de experiencia interminable", "Pergamino de velocidad interminable"]);
    expect(own.filter((b) => b.textOrigin !== "client").every((b) => b.textOrigin === "translated-by-us")).toBe(true);
    expect(own.every((b) => /^(Elixir|Scroll) of Endless /.test(b.nameEn ?? ""))).toBe(true);
    expect(data.buffs.filter((b) => b.textOrigin !== "client" && !/interminable$/.test(b.name) && b.category !== "profession")).toEqual([]);
  });

  it("AUDITORÍA: 294 de los 311 beneficios se cuantifican por completo; quedan como texto las 11 pociones de protección (absorben daño, no suman estadísticas) y 7 más (sin estadística que sumar o con daño según el tipo de criatura)", () => {
    const text: string[] = [];
    for (const b of data.buffs) {
      const e = buffAsEffect(b);
      const fx = collectStatEffects({ cls: warrior, classBuild: {}, legacy: null, legacyBuild: {}, race: null, abilities, gearEffects: [e] });
      if (Object.keys(buffFlatStats([e])).length + fx.totals.length === 0 || fx.conditional.length > 0) text.push(b.name);
    }
    const absorb = text.filter((n) => /^Poción de protección/.test(n));
    expect(absorb).toHaveLength(11);
    for (const n of absorb) expect(byName(n).text).toMatch(/^Amortigua \d+ p\. de daño/);
    expect(text.filter((n) => !absorb.includes(n)).sort()).toEqual(["Bestias salvajes", "Elixir de crecimiento interminable", "Elixir de experiencia interminable", "Pergamino de Comprensión", "Pozo de maná", "Talento natural", "Té de espina de oro"]); // los dos «Endless»: experiencia y tamaño, sin estadísticas; Bestias salvajes (daño según el tipo de criatura), Talento natural (sin cifra) y Pozo de maná (restaura maná)
    expect(data.buffs.length).toBe(311); // 290 + los 10 consumibles «Endless» del hotfix del 22/10 + 9 objetos de campamento + 3 pasivos de profesión − 1 (70658: Ferocidad de Fengus deja de dar estadísticas)
  });

  it("los aumentos permanentes al consumir (sin duración) suman su cifra y cuentan como duraderos", () => {
    for (const [name, key] of [["Polvo de scorpok permanente", "agility"], ["Compuesto de córtex cerebral permanente", "intellect"], ["Chicle permanente de mollejas", "spirit"], ["IFRDHR permanente", "strength"], ["Cóctel de zumo de pulmón perpetuo", "stamina"]] as const) {
      const b = byName(name);
      expect(b.durationMs).toBeNull();
      expect(isLastingBuff(b)).toBe(true);
      expect(buffFlatStats([buffAsEffect(b)])).toEqual({ [key]: 25 });
    }
  });

  it("duraderos o temporales: las auras y aspectos sin límite y las bendiciones son duraderos; Venas heladas (20 s) no", () => {
    expect(isLastingBuff(byName("Aspecto del halcón"))).toBe(true);
    expect(isLastingBuff(byName("Bendición del poderío"))).toBe(true);
    expect(isLastingBuff(byName("Venas heladas"))).toBe(false);
    expect(data.buffs.filter(isLastingBuff).length).toBeGreaterThan(150);
  });
});

/** Mejoras de talento sobre los beneficios propios: los modificadores de hechizos cuya máscara cruza la del hechizo del beneficio (sesión 13). */
describe.skipIf(!has)("talentos que mejoran beneficios", () => {
  const data = Buffs.parse(json("buffs.json"));
  const classes = (token: string) => indexClass(ClassTalents.parse(json(`classes/${token}.json`)));
  const full = (idx: ReturnType<typeof classes>, name: string) => {
    const t = idx.ordered.find((i) => i.talent.name === name)!.talent;
    return { [t.nodeId]: t.maxRank } as Record<number, number>;
  };
  const buff = (name: string) => data.buffs.find((b) => b.name === name && b.category === "class")!;
  const armorOf = (b: ReturnType<typeof buff>) => b.auras.find((a) => a.aura === 674)?.value ?? 0;

  it("Fuego interno mejorado (+45 %) sube la armadura de Fuego interno; sin el talento no cambia", () => {
    const priest = classes("priest");
    const inner = buff("Fuego interno");
    const mods = spellModifiersOf(priest, full(priest, "Fuego interno mejorado"));
    expect(improveBuff(inner, [])).toBe(inner);
    expect(armorOf(improveBuff(inner, mods))).toBe(Math.round(armorOf(inner) * 1.45));
  });

  it("Égida demoníaca (+30 %) sube Armadura demoníaca y Piel de demonio", () => {
    const warlock = classes("warlock");
    const mods = spellModifiersOf(warlock, full(warlock, "Égida demoníaca"));
    for (const name of ["Armadura demoníaca", "Piel de demonio"]) {
      const b = buff(name);
      const improved = improveBuff(b, mods);
      expect(improved.auras.some((a, i) => a.value !== b.auras[i]!.value), name).toBe(true);
    }
  });

  it("un talento que no cruza la máscara del beneficio no lo cambia", () => {
    const priest = classes("priest");
    const mods = spellModifiersOf(priest, full(priest, "Fuego interno mejorado"));
    const fort = buff("Palabra de poder: entereza");
    expect(improveBuff(fort, mods)).toBe(fort);
  });
});
