import { int, type RawTables } from "./csv.js";
import { spellEffectInfo } from "./items.js";
import { resolveLevelFormulas } from "./level-formula.js";
import type { SpellTables } from "./spell-tables.js";
import type { Abilities, Buff, Buffs } from "./model.js";

/**
 * Beneficios («buffs») que un personaje puede tener y que suman a sus estadísticas: habilidades de clase (propias o de otras
 * clases: bendiciones, marcas, gritos, auras, aspectos, armaduras), tótems y consumibles. Todo sale del cliente (`client-db2`):
 * el hechizo que aplica el aura, sus efectos y su texto; el motor los cuantifica como los efectos de equipo.
 *
 * Qué entra: auras de estadística (atributos, poder de ataque, poder con hechizos, armadura, resistencias, crítico, impacto, celeridad,
 * esquive…) cuyo objetivo es uno mismo, un aliado, el grupo o la banda. Los perjuicios sobre el enemigo (maldiciones, gritos
 * desmoralizadores…) no son del personaje y se dejan fuera (objetivo enemigo).
 */

/** Auras de estadística que el motor sabe cuantificar o que se enseñan como texto del cliente. */
const BUFF_AURAS = new Set([
  29, 137, 99, 124, 13, 135, 22, 674, 142, 31, 65, 319, 140, 342, 52, 57, 54, 55, 49, 47, 51, 133, 34, 35, 85, 161, 79, 87, 290, 134, 102, 131, 59, 180, 30, 274, 117,
]);
/** SpellEffect.ImplicitTarget[0] amistosos: 1 uno mismo, 20 grupo, 21 aliado, 56/57/153 banda y bendiciones superiores. */
const FRIENDLY_TARGETS = new Set([1, 20, 21, 56, 57, 153]);

/** Duración mínima (ms) para contar como mejora duradera; las cortas son efectos de reutilización (Venas heladas…). */
export const LASTING_MS = 60_000;
/** Nivel máximo de Forever (rangos de hechizo que se aprenden como mucho a este nivel). */
const MAX_LEVEL = 60;

/**
 * Grupos de exclusión: dos beneficios del mismo grupo no se acumulan (una sola bendición de cada tipo, un solo aspecto, una sola armadura…).
 * Procedencia `assumption` (reglas de Classic): el cliente no las trae. Por defecto cada hechizo es su propio grupo.
 */
const GROUPS: [RegExp, string][] = [
  [/^Aspecto /, "aspect"],
  [/^Armadura (de Escarcha|de hielo|de mago)$/, "mage-armor"],
  [/^(Armadura vil|Piel de demonio|Armadura demoníaca)$/, "warlock-armor"],
  [/^(Bendición|Bendición superior) de(l)? (poderío|Poderío)$/, "blessing-might"],
  [/^(Bendición|Bendición superior) de (Sabiduría|sabiduría)$/, "blessing-wisdom"],
  [/^(Bendición|Bendición superior) de (los )?(Reyes|reyes)$/, "blessing-kings"],
  [/^(Marca|Regalo) de lo (salvaje|Salvaje)$/, "wild"],
  [/^Cuerno de Lordaeron$/, "blessing-might"], // «Incompatible con Bendición de poderío» (texto del cliente)
  [/^(Palabra de poder: entereza|Rezo de entereza)$/, "fortitude"],
  [/^(Espíritu divino|Rezo de espíritu)$/, "divine-spirit"],
  [/^(Protección de las Sombras|Rezo de protección de las sombras)$/, "shadow-protection"],
  [/^(Intelecto Arcano|Resplandor Arcano)$/, "arcane-intellect"],
];

const groupOf = (name: string, spellId: number): string => GROUPS.find(([re]) => re.test(name))?.[1] ?? `spell-${spellId}`;

/** Auras de un hechizo que valen para el personaje (estadística y objetivo amistoso); vacío si no hay ninguna. */
function friendlyAuras(spells: SpellTables, spellId: number): Buff["auras"] {
  const out: Buff["auras"] = [];
  const info = spellEffectInfo(spells, spellId);
  for (const a of info.auras) {
    const e = spells.effect(spellId, a.index);
    if (!e || !BUFF_AURAS.has(a.aura) || !FRIENDLY_TARGETS.has(int(e["ImplicitTarget[0]"]))) continue;
    out.push(a);
  }
  // Un beneficio cuyas cifras son todas 0 (aura que solo marca un estado: Aspecto del falcón) no suma nada
  return out.some((a) => Math.abs(a.value) > 0) ? out : [];
}

/** Consumibles: subclases de objeto de clase 0 que dan un beneficio (1 poción, 2 elixir, 3 frasco, 4 pergamino, 5 comida, 8 otros). */
const CONSUMABLE_KINDS: Record<number, Buff["category"]> = { 1: "potion", 2: "elixir", 3: "flask", 4: "scroll", 5: "food", 8: "other" };
const JUNK_NAME = /Deprecated|DEPRECATED|\(OLD\)|\bOLD\b|\(DND\)|\bTEST\b|\(DNT\)|\[PH\]/;

export interface BuffRules {
  /** Hechizos extra (tótems, Pacto de sangre…) que no están en el libro de hechizos: nombre del cliente y clase. Se elige el rango de mayor cifra. */
  extraSpells: { classId: number; name: string; category: Buff["category"] }[];
  /** Beneficios cuyo texto trae una fórmula del nivel del lanzador: se evalúa a nivel 60 y esa cifra sustituye al valor de las auras indicadas. */
  levelFormulas: { classId: number; name: string; auras: number[]; note: string }[];
  /** Beneficios que se dejan fuera con su motivo (la cifra depende de algo que el personaje no tiene fijo). */
  skip: { classId: number; name: string; reason: string }[];
}


export function buildBuffs(raw: RawTables, build: string, spells: SpellTables, abilities: Abilities[], rules: BuffRules, warnings: string[]): Buffs {
  const buffs = new Map<number, Buff>();
  const add = (b: Buff) => {
    const skipped = rules.skip.find((x) => x.name === b.name && x.classId === b.classId);
    if (skipped) {
      warnings.push(`beneficio «${b.name}» omitido: ${skipped.reason}`);
      return;
    }
    // El aura de algunos beneficios trae otra cifra que la fórmula del nivel del lanzador de su texto («${$PL*1.5} p. de poder de ataque»): las reglas
    // dicen qué auras toman la cifra de la fórmula evaluada a nivel 60. Sin regla, un texto con fórmula sin resolver se deja fuera.
    const rule = rules.levelFormulas.find((x) => x.name === b.name && x.classId === b.classId);
    if (rule) {
      const resolved = resolveLevelFormulas(spells.description(b.id) ?? "", MAX_LEVEL);
      if (!resolved || resolved.values.length === 0) {
        warnings.push(`beneficio «${b.name}» omitido: no se pudo evaluar la fórmula del nivel del lanzador`);
        return;
      }
      b = { ...b, auras: b.auras.map((a) => (rule.auras.includes(a.aura) ? { ...a, value: resolved.values[0]! } : a)) };
    }
    if (/\$\{/.test(b.text)) {
      warnings.push(`beneficio «${b.name}» omitido: su texto depende del nivel del lanzador (${b.text.match(/\$\{[^}]*\}/)?.[0]})`);
      return;
    }
    if (!buffs.has(b.id)) buffs.set(b.id, b);
  };
  const text = (spellId: number) => {
    const t = spellEffectInfo(spells, spellId);
    return { text: t.text, textComplete: t.textComplete };
  };

  // --- Habilidades de clase: el rango más alto de cada una ---------------------------------------------------------
  for (const cls of abilities) {
    for (const a of cls.abilities) {
      const rank = a.ranks.at(-1);
      if (!rank) continue;
      const auras = friendlyAuras(spells, rank.spellId);
      if (auras.length === 0) continue;
      add({
        id: rank.spellId,
        category: "class",
        classId: cls.classId,
        name: a.name,
        nameEn: null,
        itemId: null,
        iconFileDataId: a.iconFileDataId ?? spells.iconFileDataId(rank.spellId),
        durationMs: spells.durationMs(rank.spellId),
        group: groupOf(a.name, rank.spellId),
        classMask: rank.classMask,
        auras,
        ...text(rank.spellId),
      });
    }
  }

  // --- Hechizos extra: tótems y auras de mascota que el libro de hechizos no trae ---------------------------------------
  const classSet = new Map(raw.table("SpellClassOptions").map((r) => [r.SpellID!, int(r.SpellClassSet)]));
  const classMask = new Map(raw.table("SpellClassOptions").map((r) => [Number(r.SpellID), [0, 1, 2, 3].map((i) => int(r[`SpellClassMask[${i}]`]))]));
  // Solo rangos que se aprenden a nivel 60 o antes (los de nivel mayor son de contenido posterior)
  const baseLevel = new Map(raw.table("SpellLevels").map((r) => [r.SpellID!, int(r.BaseLevel)]));
  const CLASS_SET: Record<number, number> = { 1: 4, 2: 10, 3: 9, 4: 8, 5: 6, 7: 11, 8: 3, 9: 5, 11: 7 };
  const byName = new Map<string, { id: number; value: number }>();
  for (const extra of rules.extraSpells) {
    const set = CLASS_SET[extra.classId];
    let best: { id: number; value: number } | null = null;
    for (const [id, s] of classSet) {
      if (s !== set || spells.name(Number(id)) !== extra.name || (baseLevel.get(id) ?? 0) > MAX_LEVEL) continue;
      const auras = friendlyAuras(spells, Number(id));
      const value = auras.reduce((n, x) => n + Math.abs(x.value), 0);
      if (auras.length > 0 && (!best || value > best.value)) best = { id: Number(id), value };
    }
    if (!best) {
      warnings.push(`buff extra «${extra.name}» (clase ${extra.classId}): sin hechizo con auras de estadística`);
      continue;
    }
    byName.set(extra.name, best);
    add({
      id: best.id,
      category: extra.category,
      classId: extra.classId,
      name: extra.name,
      nameEn: null,
      itemId: null,
      iconFileDataId: spells.iconFileDataId(best.id),
      durationMs: spells.durationMs(best.id),
      group: `spell-${best.id}`,
      classMask: classMask.get(best.id) ?? null,
      auras: friendlyAuras(spells, best.id),
      ...text(best.id),
    });
  }

  // --- Consumibles: objetos de uso cuyo hechizo (o el que dispara) aplica un aura de estadística ----------------------------
  const sparse = new Map(raw.table("ItemSparse").map((r) => [r.ID!, r]));
  const effectById = new Map(raw.table("ItemEffect").map((r) => [r.ID!, r]));
  const effectsByItem = new Map<string, string[]>();
  for (const x of raw.table("ItemXItemEffect")) effectsByItem.set(x.ItemID!, [...(effectsByItem.get(x.ItemID!) ?? []), x.ItemEffectID!]);
  const triggered = (spellId: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < spells.effectCount(spellId); i++) {
      const t = int(spells.effect(spellId, i)?.EffectTriggerSpell);
      if (t > 0) out.push(t);
    }
    return out;
  };
  const seen = new Set<number>();
  for (const item of raw.table("Item")) {
    if (int(item.ClassID) !== 0) continue;
    const category = CONSUMABLE_KINDS[int(item.SubclassID)];
    const s = sparse.get(item.ID!);
    if (!category || !s || JUNK_NAME.test(s.Display_lang ?? "")) continue;
    for (const eid of effectsByItem.get(item.ID!) ?? []) {
      const e = effectById.get(eid);
      if (!e || int(e.TriggerType) !== 0) continue;
      for (const spellId of [int(e.SpellID), ...triggered(int(e.SpellID))]) {
        const auras = friendlyAuras(spells, spellId);
        if (auras.length === 0 || seen.has(spellId)) continue;
        const duration = spells.durationMs(spellId);
        // Bebidas y comidas sin beneficio duradero no son consumibles de estadística; las pociones cuentan aunque duren poco
        if (!duration || (duration < LASTING_MS && category !== "potion")) continue;
        if (auras.every((a) => a.value <= 0 && a.aura !== 87)) continue; // solo perjuicios (bromas, malos efectos)
        seen.add(spellId);
        add({
          id: spellId,
          category,
          classId: null,
          name: s.Display_lang ?? "",
          nameEn: null,
          itemId: int(item.ID),
          iconFileDataId: int(item.IconFileDataID) || spells.iconFileDataId(spellId),
          durationMs: duration,
          group: `spell-${spellId}`,
          classMask: null,
          auras,
          ...text(spellId),
        });
      }
    }
  }

  const list = [...buffs.values()].sort((a, b) => (a.classId ?? 99) - (b.classId ?? 99) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "es"));
  return { schemaVersion: 1, build, provenance: "client-db2", buffs: list };
}
