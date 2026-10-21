import type { ItemSpellAura } from "@wfuc/schema";
import type { GearData, GearSelection, GearSlot } from "./gear.js";
import { GEAR_SLOTS } from "./gear.js";
import { AURA_ADD_FLAT_MODIFIER, AURA_ADD_PCT_MODIFIER, type SpellModifier } from "./spell-mods.js";

/**
 * Bonos de conjunto y efectos «al equipar» de los objetos: son hechizos con auras, como los talentos. Aquí se separan en:
 *  - estadisticas planas (atributos, poder de ataque, poder con hechizos, puntuaciones...) que se suman a las del equipo, y
 *  - el resto (porcentajes, modificadores de habilidades), que entran en los efectos sumados con origen «equipo».
 * Procedencia `client-db2` (hechizo y valor del cliente). Una cifra solo se cuantifica si el texto del cliente la nombra: lo
 * demas (procs, efectos «dummy») se queda como texto.
 */

export interface GearEffectSource {
  kind: "set" | "item";
  /** Nombre del bono o del efecto del objeto (el del hechizo del cliente). */
  name: string;
  /** Conjunto o ranura de origen, para mostrarlo. */
  origin: string;
  spellId: number;
  text: string;
  auras: ItemSpellAura[];
  /** Ranura y objeto de los efectos de objeto (null en los conjuntos). */
  slot: GearSlot | null;
  itemId: number | null;
}

export interface GearStatValue {
  key: string;
  value: number;
}

/** El texto del cliente nombra la cifra (en valor absoluto, con coma decimal o miles con punto). */
export const textHasNumber = (text: string, value: number): boolean => {
  const nums = [...text.replace(/(\d)\.(\d{3})/g, "$1$2").matchAll(/\d+(?:,\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  return nums.includes(Math.abs(value));
};

/**
 * ¿El texto del cliente nombra la cifra de esta aura? Los modificadores planos de tiempo (duracion, lanzamiento, enfriamiento) vienen
 * en milisegundos y el texto los da en segundos («-1500» = «1,5 s»).
 */
export const auraNumberInText = (a: ItemSpellAura, text: string): boolean => {
  const inMs = a.aura === AURA_ADD_FLAT_MODIFIER && [1, 10, 11, 21].includes(a.miscValue);
  return textHasNumber(text, inMs ? a.value / 1000 : a.value);
};

const ATTRIBUTE_KEYS = ["strength", "agility", "stamina", "intellect", "spirit"];
const SCHOOL_POWER: Record<number, string> = { 2: "holy-power", 4: "fire-power", 8: "nature-power", 16: "frost-power", 32: "shadow-power", 64: "arcane-power" };
const SCHOOL_RESISTANCE: Record<number, string> = { 2: "holy-resistance", 4: "fire-resistance", 8: "nature-resistance", 16: "frost-resistance", 32: "shadow-resistance", 64: "arcane-resistance" };
const ALL_MAGIC = 126;
/** Auras 189 (puntuacion): la mascara es de tipos de puntuacion del juego (bit 5-7 impacto, 8-10 critico, 17-19 celeridad, 2 esquivar, 3 parada, 4 bloqueo, 23 pericia). */
const RATING_GROUPS: [number, string][] = [
  [1 << 2, "dodge-rating"],
  [1 << 3, "parry-rating"],
  [1 << 4, "block-rating"],
  [(1 << 5) | (1 << 6) | (1 << 7), "hit-rating"],
  [(1 << 8) | (1 << 9) | (1 << 10), "crit-rating"],
  [(1 << 17) | (1 << 18) | (1 << 19), "haste-rating"],
  [1 << 23, "expertise-rating"],
];
const ratingKey = (mask: number): string | null => {
  const hit = RATING_GROUPS.filter(([bits]) => (mask & bits) !== 0);
  return hit.length === 1 && (mask & ~hit[0]![0]) === 0 ? hit[0]![1] : null;
};

/**
 * Separa las auras de un hechizo en estadisticas planas del equipo. `consumed` = indices de efecto ya contados aqui (no deben volver
 * a sumarse como porcentaje). Las auras gemelas (poder de ataque cuerpo a cuerpo y a distancia; daño y sanación con hechizos) se
 * cuentan una vez. Solo se cuantifica lo que el texto del cliente confirma (el valor aparece en la descripcion).
 */
export function classifyGearAuras(auras: ItemSpellAura[], text: string): { stats: GearStatValue[]; consumed: Set<number> } {
  const stats: GearStatValue[] = [];
  const consumed = new Set<number>();
  const take = (a: ItemSpellAura, ...out: GearStatValue[]) => {
    stats.push(...out);
    consumed.add(a.index);
  };
  const find = (aura: number, value: number) => auras.find((x) => x.aura === aura && x.value === value && !consumed.has(x.index));
  for (const a of auras) {
    if (consumed.has(a.index) || a.levelScaled) continue;
    const v = a.value;
    if (a.aura !== 189 && !textHasNumber(text, v)) continue;
    switch (a.aura) {
      case 29: // atributo plano (-1 = todos)
        if (a.miscValue === -1) take(a, ...ATTRIBUTE_KEYS.map((key) => ({ key, value: v })));
        else if (ATTRIBUTE_KEYS[a.miscValue]) take(a, { key: ATTRIBUTE_KEYS[a.miscValue]!, value: v });
        break;
      case 99: {
        // «+N poder de ataque»: el cliente lo guarda como dos auras (cuerpo a cuerpo y a distancia)
        const twin = find(124, v);
        if (twin) {
          take(a, { key: "attack-power", value: v }, { key: "ranged-attack-power", value: v });
          consumed.add(twin.index);
        } else take(a, { key: "attack-power", value: v });
        break;
      }
      case 124:
        take(a, { key: "ranged-attack-power", value: v });
        break;
      case 13: {
        // Daño de hechizos por escuela; todas las escuelas magicas junto a la sanación gemela = poder con hechizos
        const twin = a.miscValue === ALL_MAGIC ? find(135, v) : undefined;
        if (twin) {
          take(a, { key: "spell-power", value: v });
          consumed.add(twin.index);
        } else if (a.miscValue === ALL_MAGIC) take(a, { key: "spell-damage", value: v });
        else if (SCHOOL_POWER[a.miscValue]) take(a, { key: SCHOOL_POWER[a.miscValue]!, value: v });
        break;
      }
      case 135:
        take(a, { key: "healing-power", value: v });
        break;
      case 30: // habilidad: 95 = defensa
        if (a.miscValue === 95) take(a, { key: "defense", value: v });
        break;
      case 674: // «+150 p. de armadura» (aura propia de Forever, valor confirmado por el texto)
        if (a.miscValue === 1 && v > 0) take(a, { key: "extra-armor", value: v });
        break;
      case 85: // regeneracion de maná cada 5 s
        if (a.miscValue === 0) take(a, { key: "mana-per-5", value: v });
        break;
      case 22: // resistencias
        if (a.miscValue === ALL_MAGIC) take(a, ...Object.values(SCHOOL_RESISTANCE).map((key) => ({ key, value: v })));
        else if (SCHOOL_RESISTANCE[a.miscValue]) take(a, { key: SCHOOL_RESISTANCE[a.miscValue]!, value: v });
        break;
      case 123: // penetracion de hechizos (el cliente la guarda negativa)
        if (v < 0) take(a, { key: "spell-penetration", value: -v });
        break;
      case 189: {
        const key = ratingKey(a.miscValue);
        if (key) take(a, { key, value: v });
        break;
      }
    }
  }
  return { stats, consumed };
}

/** Efectos de aura que no son estadisticas planas: los que sobran tras `classifyGearAuras`. */
export const remainingAuras = (auras: ItemSpellAura[], consumed: Set<number>): ItemSpellAura[] => auras.filter((a) => !consumed.has(a.index));

/**
 * Efectos que solo valen en un tipo de zona («… 7 p. más en una zona de bosque o pradera»): son un segundo hechizo que se suma al principal
 * solo allí, así que NO son un bono permanente. Se conservan como texto, sin cifras (la comunidad los cuenta una sola vez, el principal).
 */
export const isZoneOnlyEffect = (text: string): boolean => /en una zona/i.test(text);

/**
 * Bonos de conjunto activos (por piezas distintas del conjunto que llevas) y efectos «al equipar» de los objetos que llevas.
 * Un bono de conjunto cuenta una vez; un efecto de objeto cuenta por objeto (si dos objetos llevan el mismo hechizo se suma dos
 * veces: sin confirmar en el juego, `assumption`).
 */
export function activeGearEffects(gear: GearSelection, data: GearData): GearEffectSource[] {
  const out: GearEffectSource[] = [];
  const piecesBySet = new Map<number, Set<number>>();
  for (const slot of GEAR_SLOTS) {
    const worn = gear[slot];
    const item = worn ? data.items.get(worn.itemId) : undefined;
    if (!item) continue;
    for (const e of item.effects) {
      if (e.trigger !== 1 || e.auras.length === 0) continue;
      out.push({ kind: "item", name: e.name || item.name, origin: item.name, spellId: e.spellId, text: e.text, auras: isZoneOnlyEffect(e.text) ? [] : e.auras, slot, itemId: item.id });
    }
    if (item.itemSetId !== null) {
      const set = piecesBySet.get(item.itemSetId) ?? new Set<number>();
      set.add(item.id);
      piecesBySet.set(item.itemSetId, set);
    }
  }
  for (const [setId, pieces] of piecesBySet) {
    const def = data.sets.find((s) => s.id === setId);
    if (!def) continue;
    const seen = new Set<number>();
    for (const b of def.bonuses) {
      if (pieces.size < b.threshold || seen.has(b.spellId)) continue;
      seen.add(b.spellId);
      out.push({ kind: "set", name: b.name || def.name, origin: `${def.name} (${b.threshold})`, spellId: b.spellId, text: b.text, auras: b.auras, slot: null, itemId: null });
    }
  }
  return out;
}

/** Modificadores de habilidades (auras 107/108) de los efectos del equipo, en el mismo formato que los de los talentos. */
export function gearSpellModifiers(effects: GearEffectSource[]): SpellModifier[] {
  const out: SpellModifier[] = [];
  for (const e of effects) {
    for (const a of e.auras) {
      if (a.aura !== AURA_ADD_FLAT_MODIFIER && a.aura !== AURA_ADD_PCT_MODIFIER) continue;
      if (a.classMask.every((m) => m === 0) || !auraNumberInText(a, e.text)) continue;
      out.push({ source: { name: e.name, spellId: e.spellId, nodeId: 0, rank: 1, maxRank: 1 }, kind: a.aura === AURA_ADD_FLAT_MODIFIER ? "flat" : "pct", op: a.miscValue, value: a.value, mask: a.classMask });
    }
  }
  return out;
}
