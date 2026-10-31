import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, Enchants, Items } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { classifyGearAuras, collectStatEffects, enchantEffectText, enchantStatLines, gearSpellModifiers, indexClass, isZoneOnlyEffect, type GearEffectSource } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70707");
const has = existsSync(join(D, "items.json")) && existsSync(join(D, "enchants.json")) && existsSync(join(D, "classes", "mage.json"));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

/**
 * AUDITORÍA del equipo (sesión 12): encantamientos, bonos de conjunto y efectos de objeto contrastados con el cliente y con la
 * lectura de la comunidad. Las listas son EXACTAS: si un parche las cambia la prueba falla y obliga a revisarlas (regla 8 del proyecto).
 */
describe.skipIf(!has)("auditoría del equipo: encantamientos frente a la comunidad", () => {
  const enchants = Enchants.parse(json("enchants.json"));
  const unique = [...new Map(enchants.enchants.map((e) => [e.effectId, e])).values()];

  /** Estadística → dimensiones comparables (el poder con hechizos genérico es daño y sanación; la armadura «sin modificadores» es armadura extra; el poder de ataque gemelo cuenta una vez). */
  const dims = (lines: { key: string | null; value: number }[]): Record<string, number> => {
    const r: Record<string, number> = {};
    const add = (k: string, v: number) => (r[k] = (r[k] ?? 0) + v);
    for (const { key: k, value } of lines) {
      const key = k ?? "?";
      if (key === "spell-power") {
        add("spell-damage", value);
        add("healing-power", value);
      } else if (key === "armor-no-mods") add("extra-armor", value);
      else add(key, value);
    }
    if (r["ranged-attack-power"] !== undefined && r["ranged-attack-power"] === r["attack-power"]) delete r["ranged-attack-power"];
    return r;
  };

  it("el cliente y la comunidad no se contradicen en ninguna cifra, y lo que la comunidad tiene lo tenemos", () => {
    const conflicts: string[] = [];
    const missing: string[] = [];
    for (const e of unique) {
      const ours = dims(enchantStatLines(e));
      for (const [k, v] of Object.entries(dims(e.communityStats))) {
        if (ours[k] === undefined) missing.push(`${e.effectId}:${k}`);
        else if (ours[k] !== v) conflicts.push(`${e.effectId} ${k}: cliente ${ours[k]}, comunidad ${v}`);
      }
    }
    expect(conflicts).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("solo se rellena con la comunidad lo que el cliente no trae: 3 encantamientos de la Plaga sin auras y «Espíritu +4» (el efecto del cliente contradice su nombre)", () => {
    const filled = unique.filter((e) => enchantStatLines(e).some((l) => l.source === "community")).map((e) => e.effectId);
    expect(filled).toEqual([2715, 2716, 2717, 8203]);
  });

  it("estadísticas que da el cliente y la comunidad no modela: daño de arma, profesiones (ningún dato se pierde)", () => {
    const extra = new Map<string, number[]>();
    for (const e of unique) {
      const community = dims(e.communityStats);
      for (const k of Object.keys(dims(enchantStatLines(e)))) if (community[k] === undefined) extra.set(k, [...(extra.get(k) ?? []), e.effectId]);
    }
    expect([...extra.keys()].sort()).toEqual(["physical-damage", "profession-fishing", "profession-herbalism", "profession-mining", "profession-skinning"]);
    expect(extra.get("physical-damage")).toHaveLength(13);
  });

  it("el nombre del cliente no coincide con la cifra de su efecto en 2 encantamientos (3 hasta el 70685: el hotfix corrige «Defensa +6», que ya trae su 6; el cliente y la comunidad coinciden en la cifra del efecto): se usa la del efecto", () => {
    const differs: string[] = [];
    for (const e of unique) {
      const lines = enchantStatLines(e).filter((l) => l.source === "client");
      const nums = [...e.name.matchAll(/\d+/g)].map((m) => Number(m[0]));
      if (lines.length === 0 || nums.length === 0) continue;
      if (!lines.some((l) => nums.includes(l.value))) differs.push(`${e.effectId} «${e.name}» → ${lines.map((l) => `${l.key}=${l.value}`).join(", ")}`);
    }
    expect(differs).toEqual(["925 «Defensa +5» → defense=2", "2618 «Agilidad +15» → agility=9"]);
  });

  it("el encantamiento 7664 («+$1220596M1% de probabilidad de golpe crítico») ya no lleva marcadores y su porcentaje sale de su hechizo", () => {
    const e = unique.find((x) => x.effectId === 7664)!;
    expect(e.name).toBe("+1% de probabilidad de golpe crítico");
    expect(e.effects[0]!.auras.some((a) => a.aura === 52 && a.value === 1)).toBe(true);
    expect(unique.filter((x) => /\$/.test(x.name))).toEqual([]);
  });
});

describe.skipIf(!has)("auditoría del equipo: bonos de conjunto, efectos de objeto y de encantamiento", () => {
  const items = Items.parse(json("items.json"));
  const enchants = Enchants.parse(json("enchants.json"));
  const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
  const abilities = Abilities.parse(json("abilities/mage.json"));
  const all: GearEffectSource[] = [
    ...items.items.flatMap((i) => i.effects.filter((e) => e.trigger === 1).map((e) => ({ kind: "item" as const, name: e.name, origin: i.name, spellId: e.spellId, text: e.text, auras: isZoneOnlyEffect(e.text) ? [] : e.auras, slot: null, itemId: i.id }))),
    ...items.sets.flatMap((s) => s.bonuses.map((b) => ({ kind: "set" as const, name: b.name, origin: s.name, spellId: b.spellId, text: b.text, auras: b.auras, slot: null, itemId: null }))),
    ...enchants.enchants.flatMap((x) => x.effects.filter((e) => e.trigger === 1).map((e) => ({ kind: "enchant" as const, name: e.name || x.name, origin: x.name, spellId: e.spellId, text: enchantEffectText(e, x), auras: e.auras, slot: null, itemId: null }))),
  ];
  const unique = [...new Map(all.map((e) => [e.spellId, e])).values()];

  /** Auras que el motor deja como texto del cliente (nada se descarta en silencio), con el motivo. Una aura nueva aquí obliga a decidir. */
  const TEXT_ONLY: Record<number, string> = {
    4: "efecto «dummy»: el cliente no detalla qué hace (procs de objeto, invocaciones, consumibles)",
    14: "reducción del daño con hechizos recibido (de un tipo de daño): sin fila propia",
    15: "escudo de daño (espinas): daño al atacante, condicional",
    17: "detección de sigilo",
    19: "estado cosmético («en paz con el mundo»)",
    22: "aura de grupo (armadura extra a los miembros del grupo cercanos)",
    23: "mascota: no hay mascota en la calculadora",
    29: "atributo condicionado a una habilidad («cuando Temeridad está activa…»)",
    30: "habilidad de profesión sin clave propia (forzar cerraduras)",
    31: "velocidad de carrera con hechizo sin descripción: la cifra no se confirma",
    33: "velocidad reducida (efecto negativo de un objeto de broma)",
    42: "proc: probabilidad al golpear o al recibir un golpe (se ve como texto)",
    43: "daño periódico dummy (daño al bloquear)",
    56: "ilusión permanente (cosmético)",
    58: "velocidad de natación",
    59: "daño físico plano contra un tipo de criatura (armas «Matanza de…»): sin estadística propia",
    69: "absorción de daño (efecto de uso/proc)",
    72: "coste de hechizos de una escuela reducido: sin fila propia",
    77: "inmunidad (desarme)",
    107: "modificador de habilidad que el texto no confirma o que no afecta a la clase del ejemplo (las cifras entran en la tarjeta de cada habilidad cuando el texto las nombra)",
    108: "modificador porcentual de habilidad (ídem)",
    109: "habilidad con componente curativo adicional (conjuntos de sacerdote)",
    112: "daño plano a un hechizo concreto (ídem)",
    117: "resistencia a un control sin texto del cliente (mecánica no confirmada)",
    129: "velocidad de movimiento solo en zonas concretas",
    130: "velocidad de montura",
    144: "reducción del daño por caídas",
    154: "nivel de sigilo",
    155: "respiración acuática",
    226: "velocidad de ataque alterna (Péndulo de Fatalidad)",
    255: "reducción de daño condicionada (tejehierro)",
    275: "permiso de lanzar habilidades en forma (Druida)",
    305: "suelo de velocidad de movimiento",
    319: "velocidad de ataque alterna (Péndulo de Fatalidad)",
    332: "concede una habilidad nueva",
    436: "estado cosmético",
    470: "metabolismo de la comida",
    608: "daño periódico que puede ser crítico (talento de conjunto)",
  };

  it("cada efecto es una estadística plana, un porcentaje, un modificador de habilidad o texto con motivo; ninguna aura queda sin decidir", () => {
    const counts: Record<string, number> = { flat: 0, fx: 0, mods: 0, text: 0, noAuras: 0 };
    const unknown = new Set<number>();
    for (const e of unique) {
      const { stats } = classifyGearAuras(e.auras, e.text, { trustValues: e.kind === "enchant" });
      const fx = collectStatEffects({ cls: mage, classBuild: {}, legacy: null, legacyBuild: {}, race: null, abilities, gearEffects: [e] });
      if (stats.length > 0) counts.flat!++;
      else if (fx.totals.length > 0) counts.fx!++;
      else if (gearSpellModifiers([e]).length > 0) counts.mods!++;
      else if (e.auras.length === 0) counts.noAuras!++;
      else {
        counts.text!++;
        for (const a of e.auras) if (!TEXT_ONLY[a.aura]) unknown.add(a.aura);
      }
    }
    expect([...unknown].sort((a, b) => a - b), "auras sin decidir").toEqual([]);
    expect(counts.flat!).toBeGreaterThan(280);
    expect(counts.fx!).toBeGreaterThan(350);
    expect(counts.flat! + counts.fx! + counts.mods! + counts.text! + counts.noAuras!).toBe(unique.length);
  });

  it("cada cifra plana sumada aparece en el texto del cliente (o en el nombre del encantamiento, que el juego enseña)", () => {
    const wrong: string[] = [];
    for (const e of unique) {
      if (e.kind === "enchant") continue; // se fía del valor del hechizo (ver enchantStatLines) y se audita arriba
      const { stats, consumed } = classifyGearAuras(e.auras, e.text);
      for (const a of e.auras) if (consumed.has(a.index) && a.aura !== 189 && !a.levelScaled && !new RegExp(`(^|[^\\d,.])${String(Math.abs(a.value)).replace(".", ",")}([^\\d]|$)`).test(e.text.replace(/(\d)\.(\d{3})/g, "$1$2"))) wrong.push(`${e.spellId} «${e.name}»: ${a.aura}=${a.value}`);
      expect(new Set(stats.map((s) => s.key)).size).toBe(stats.length);
    }
    expect(wrong).toEqual([]);
  });

  it("los bonos «contra criaturas» (poder de ataque 102 y daño con hechizos 59 / 180) se cuantifican por tipo, sin contar dos veces el gemelo de distancia", () => {
    const stats = (id: number) => Object.fromEntries(classifyGearAuras(unique.find((e) => e.spellId === id)!.auras, unique.find((e) => e.spellId === id)!.text).stats.map((s) => [s.key, s.value]));
    expect(stats(1301078)).toEqual({ "attack-power-vs-beast": 36 }); // «+36 p. de poder de ataque contra bestias»
    expect(stats(1301079)).toEqual({ "spell-damage-vs-elemental": 21 });
    expect(stats(1301094)).toEqual({ "spell-damage-vs-demon": 21 });
    expect(stats(18074)).toEqual({ "attack-power-vs-undead": 30 });
    expect(stats(1292025)).toEqual({ "attack-power-vs-humanoid": 15 });
    expect(stats(1308237)).toEqual({ "spell-damage-vs-dragonkin": 53 });
    // la pala de asaltatumbas: +12 de poder de ataque y otros 12 contra no-muertos («duplicado»)
    expect(stats(1319047)).toEqual({ "attack-power": 12, "attack-power-vs-undead": 12 });
  });

  it("valor de bloqueo (274), salud y maná planos (34 / 35), salud cada 5 s (161) y habilidades con armas y de profesión (30)", () => {
    const stats = (id: number) => Object.fromEntries(classifyGearAuras(unique.find((e) => e.spellId === id)!.auras, unique.find((e) => e.spellId === id)!.text, { trustValues: true }).stats.map((s) => [s.key, s.value]));
    expect(stats(23562)).toEqual({ "block-value": 30 });
    expect(stats(15345)).toEqual({ mana: 150 }); // Maná +150
    expect(stats(15388)).toEqual({ health: 100 }); // PS +100
    expect(stats(21347)).toEqual({ "health-regen": 15 });
    expect(stats(15763)).toEqual({ "skill-swords": 6 });
    expect(stats(7534)).toEqual({ "skill-daggers": 1 });
    expect(stats(24362)).toEqual({ "skill-fist-weapons": 4 });
    expect(stats(13611)).toEqual({ "profession-mining": 2 });
    expect(stats(13615)).toEqual({ "profession-fishing": 2 });
  });
});
