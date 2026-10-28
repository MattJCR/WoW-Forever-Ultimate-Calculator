import type { Enchant, ItemProc, ItemSpellAura } from "@wfuc/schema";
import type { GearData, GearSelection, GearSlot } from "./gear.js";
import { GEAR_SLOTS } from "./gear.js";
import { attackPowerVsKey, spellDamageVsKey } from "./item-stat-keys.js";
import { AURA_ADD_FLAT_MODIFIER, AURA_ADD_PCT_MODIFIER, type SpellModifier } from "./spell-mods.js";

/**
 * Bonos de conjunto y efectos «al equipar» de los objetos: son hechizos con auras, como los talentos. Aquí se separan en:
 *  - estadisticas planas (atributos, poder de ataque, poder con hechizos, puntuaciones...) que se suman a las del equipo, y
 *  - el resto (porcentajes, modificadores de habilidades), que entran en los efectos sumados con origen «equipo».
 * Procedencia `client-db2` (hechizo y valor del cliente). Una cifra solo se cuantifica si el texto del cliente la nombra: lo
 * demas (procs, efectos «dummy») se queda como texto.
 */

export interface GearEffectSource {
  kind: "set" | "item" | "enchant" | "buff";
  /** Nombre del bono o del efecto del objeto (el del hechizo del cliente). */
  name: string;
  /** Conjunto o ranura de origen, para mostrarlo. */
  origin: string;
  spellId: number;
  text: string;
  auras: ItemSpellAura[];
  /** Proc del bono de conjunto (si lo es). */
  proc?: ItemProc | null;
  /** Ranura y objeto de los efectos de objeto y de encantamiento (null en los conjuntos). */
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
/** Máscara de tipos de criatura de las auras «contra criaturas» (bit = tipo − 1: 1 bestia, 2 dragonante, 4 demonio, 8 elemental, 16 gigante, 32 no-muerto, 64 humanoide, 256 mecánico). */
const CREATURE_MASK_KEYS: [number, string][] = [[1, "beast"], [2, "dragonkin"], [4, "demon"], [8, "elemental"], [16, "giant"], [32, "undead"], [64, "humanoid"], [256, "mechanical"]];
const creatureKeys = (mask: number, toKey: (creature: string) => string): string[] => CREATURE_MASK_KEYS.filter(([bit]) => (mask & bit) !== 0).map(([, c]) => toKey(c));
/** Aura 30 (habilidad): SkillLine -> clave de estadística del equipo (95 defensa, armas y profesiones de Classic). */
const SKILL_LINE_KEYS: Record<number, string> = {
  95: "defense", 43: "skill-swords", 44: "skill-axes", 45: "skill-bows", 46: "skill-guns", 54: "skill-maces", 55: "skill-2h-swords",
  118: "skill-dual-wield", 136: "skill-staves", 160: "skill-2h-maces", 162: "skill-fist-weapons", 172: "skill-2h-axes", 173: "skill-daggers",
  176: "skill-thrown", 226: "skill-crossbows", 228: "skill-wands", 229: "skill-polearms",
  182: "profession-herbalism", 186: "profession-mining", 356: "profession-fishing", 393: "profession-skinning",
};
const SCHOOL_POWER: Record<number, string> = { 2: "holy-power", 4: "fire-power", 8: "nature-power", 16: "frost-power", 32: "shadow-power", 64: "arcane-power" };
const SCHOOL_RESISTANCE: Record<number, string> = { 2: "holy-resistance", 4: "fire-resistance", 8: "nature-resistance", 16: "frost-resistance", 32: "shadow-resistance", 64: "arcane-resistance" };
const ALL_MAGIC = 126;
/** Máscaras de «todas las escuelas»: 126 = mágicas; 127 = también físico (Armadura vil); 124 = las cinco de las resistencias (sin Sagrado). */
const isAllMagic = (mask: number): boolean => mask === ALL_MAGIC || mask === 127;
const isAllResistances = (mask: number): boolean => mask === ALL_MAGIC || mask === 124;
const HOLY_SCHOOL = 2;
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
 * cuentan una vez. Solo se cuantifica lo que el texto del cliente confirma (el valor aparece en la descripcion); `trustValues` (encantamientos,
 * cuyo hechizo suele no tener descripcion y cuyo nombre a veces no coincide con la cifra real) se fia del valor del hechizo.
 */
export function classifyGearAuras(auras: ItemSpellAura[], text: string, options: { trustValues?: boolean } = {}): { stats: GearStatValue[]; consumed: Set<number> } {
  const stats: GearStatValue[] = [];
  const consumed = new Set<number>();
  const take = (a: ItemSpellAura, ...out: GearStatValue[]) => {
    stats.push(...out);
    consumed.add(a.index);
  };
  const find = (aura: number, value: number) => auras.find((x) => x.aura === aura && x.value === value && !consumed.has(x.index));
  for (const a of auras) {
    // Los valores que escalan con el nivel solo se aceptan en beneficios y encantamientos (`trustValues`): su rango máximo se lanza a nivel 60
    if (consumed.has(a.index) || (a.levelScaled && !options.trustValues)) continue;
    const v = a.value;
    if (a.aura !== 189 && !options.trustValues && !textHasNumber(text, v)) continue;
    switch (a.aura) {
      case 29: // atributo plano (-1 = todos)
        if (a.miscValue === -1) take(a, ...ATTRIBUTE_KEYS.map((key) => ({ key, value: v })));
        else if (ATTRIBUTE_KEYS[a.miscValue]) take(a, { key: ATTRIBUTE_KEYS[a.miscValue]!, value: v });
        break;
      case 99: {
        // «+N poder de ataque»: el cliente lo guarda como dos auras (cuerpo a cuerpo y a distancia) y es una sola estadística, que suma a las dos (como Classic)
        const twin = find(124, v);
        take(a, { key: "attack-power", value: v });
        if (twin) consumed.add(twin.index);
        break;
      }
      case 124:
        take(a, { key: "ranged-attack-power", value: v });
        break;
      case 13: {
        // Daño de hechizos por escuela; todas las escuelas magicas junto a la sanación gemela = poder con hechizos
        const twin = isAllMagic(a.miscValue) ? find(135, v) : undefined;
        if (twin) {
          take(a, { key: "spell-power", value: v });
          consumed.add(twin.index);
        } else if (isAllMagic(a.miscValue)) take(a, { key: "spell-damage", value: v });
        else if (a.miscValue === 1) take(a, { key: "physical-damage", value: v }); // «+N de daño» físico: se suma a cada golpe de arma
        else if (SCHOOL_POWER[a.miscValue]) take(a, { key: SCHOOL_POWER[a.miscValue]!, value: v });
        break;
      }
      case 135:
        take(a, { key: "healing-power", value: v });
        break;
      case 30: // habilidad (SkillLine): defensa, armas y profesiones
        if (SKILL_LINE_KEYS[a.miscValue]) take(a, { key: SKILL_LINE_KEYS[a.miscValue]!, value: v });
        break;
      case 34: // salud máxima (plana)
        if (v > 0) take(a, { key: "health", value: v });
        break;
      case 35: // poder máximo (plano): misc 0 = maná
        if (a.miscValue === 0 && v > 0) take(a, { key: "mana", value: v });
        break;
      case 274: // valor de bloqueo del escudo
        if (a.miscValue === 0) take(a, { key: "block-value", value: v });
        break;
      case 161: // «Restaura N p. de salud cada 5 s»
        if (a.miscValue === 0 && v > 0) take(a, { key: "health-regen", value: v });
        break;
      case 102: // poder de ataque contra tipos de criatura (el 131 gemelo es el de distancia: cuenta una vez)
      case 131: {
        const keys = creatureKeys(a.miscValue, attackPowerVsKey);
        if (keys.length === 0) break;
        const twin = a.aura === 102 ? auras.find((x) => x.aura === 131 && x.value === v && x.miscValue === a.miscValue && !consumed.has(x.index)) : undefined;
        take(a, ...keys.map((key) => ({ key, value: v })));
        if (twin) consumed.add(twin.index);
        break;
      }
      case 59: // daño contra tipos de criatura: con hechizos si el texto lo dice (el de las armas «Matanza de bestias» es daño físico: texto)
      case 180: {
        if (a.aura === 59 && !/hechizos/i.test(text)) break;
        const keys = creatureKeys(a.miscValue, spellDamageVsKey);
        if (keys.length > 0) take(a, ...keys.map((key) => ({ key, value: v })));
        break;
      }
      case 674: // «+150 p. de armadura» (aura propia de Forever, valor confirmado por el texto)
        if (a.miscValue === 1 && v > 0) take(a, { key: "extra-armor", value: v });
        break;
      case 85: // regeneracion de maná cada 5 s
        if (a.miscValue === 0) take(a, { key: "mana-per-5", value: v });
        break;
      case 22: // resistencias
        if (isAllResistances(a.miscValue)) take(a, ...Object.entries(SCHOOL_RESISTANCE).filter(([school]) => Number(school) !== HOLY_SCHOOL).map(([, key]) => ({ key, value: v }))); // «todas las resistencias»: sin Sagrado, como en los objetos
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
 * Texto con el que se confirman las cifras de un hechizo de encantamiento: el del hechizo y, como muchos no lo traen («Desvío inferior» no
 * tiene descripción), el nombre del encantamiento, que es lo que el juego enseña («Defensa +3»). Una cifra solo se cuantifica si aparece en alguno.
 */
export const enchantEffectText = (e: { text: string }, enchant: { name: string }): string => [e.text, enchant.name].filter(Boolean).join(" · ");

/**
 * Bonos de conjunto activos (por piezas distintas del conjunto que llevas), efectos «al equipar» de los objetos que llevas y hechizos «al
 * equipar» de sus encantamientos. Un bono de conjunto cuenta una vez; un efecto de objeto cuenta por objeto (si dos objetos llevan el mismo
 * hechizo se suma dos veces: sin confirmar en el juego, `assumption`).
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
    const enchant = worn?.enchantId ? data.enchants.get(worn.enchantId) : undefined;
    for (const e of enchant?.effects ?? []) {
      if (e.trigger !== 1 || e.auras.length === 0) continue;
      out.push({ kind: "enchant", name: e.name || enchant!.name, origin: enchant!.name, spellId: e.spellId, text: enchantEffectText(e, enchant!), auras: e.auras, slot, itemId: item.id });
    }
    const temp = worn?.tempId ? data.enhancements.get(worn.tempId) : undefined;
    for (const e of temp?.effects ?? []) {
      if (e.trigger !== 1 || e.auras.length === 0) continue;
      out.push({ kind: "enchant", name: e.name || temp!.name, origin: temp!.name, spellId: e.spellId, text: enchantEffectText(e, temp!), auras: e.auras, slot, itemId: item.id });
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
      out.push({ kind: "set", name: b.name || def.name, origin: `${def.name} (${b.threshold})`, spellId: b.spellId, text: b.text, auras: b.auras, proc: b.proc, slot: null, itemId: null });
    }
  }
  return out;
}

export interface EnchantStatLine {
  key: string;
  value: number;
  /** client = estadistica directa o aura del hechizo del cliente; community = la lectura de la comunidad, solo donde el cliente no trae la cifra. */
  source: "client" | "community";
}

/**
 * Estadisticas planas de un encantamiento: las del cliente (efectos de estadistica, resistencia y daño de arma, y las auras de su hechizo
 * «al equipar», fiandose del valor del hechizo) y, solo para lo que el cliente no trae (hechizos sin auras, como los de la Plaga), la lectura de
 * la comunidad. Si los dos traen la misma estadistica, manda el cliente. El poder con hechizos generico cubre daño y sanacion.
 */
export function enchantStatLines(enchant: Pick<Enchant, "name" | "stats" | "effects" | "communityStats">): EnchantStatLine[] {
  const out: EnchantStatLine[] = [];
  for (const s of enchant.stats) out.push({ key: s.key ?? `type:${s.type}`, value: s.value, source: "client" });
  for (const e of enchant.effects) {
    if (e.trigger !== 1) continue;
    for (const s of classifyGearAuras(e.auras, enchantEffectText(e, enchant), { trustValues: true }).stats) out.push({ key: s.key, value: s.value, source: "client" });
  }
  const has = (...keys: string[]): boolean => out.some((s) => keys.includes(s.key));
  const damageCovered = has("spell-power", "spell-damage");
  const healingCovered = has("spell-power", "healing-power");
  for (const c of enchant.communityStats) {
    const key = c.key ?? `type:${c.type}`;
    const add = (k: string) => out.push({ key: k, value: c.value, source: "community" });
    if (key === "spell-power") {
      if (!damageCovered && !healingCovered) add("spell-power");
      else if (!damageCovered) add("spell-damage");
      else if (!healingCovered) add("healing-power");
    } else if (key === "spell-damage") {
      if (!damageCovered) add(key);
    } else if (key === "healing-power") {
      if (!healingCovered) add(key);
    } else if (key === "armor-no-mods") {
      if (!has("extra-armor", "armor-no-mods")) add(key);
    } else if (!has(key)) add(key);
  }
  return out;
}

/**
 * Avisos sobre las cifras de un encantamiento para enseñarlos: `nameDiffers` = el nombre que enseña el juego («Defensa +5») no trae la cifra del
 * efecto del cliente (2) y se usa la del efecto, que la comunidad confirma; `fromCommunity` = el cliente no detalla el efecto y la cifra es de la comunidad.
 */
export function enchantNotes(enchant: Pick<Enchant, "name" | "stats" | "effects" | "communityStats">): { nameDiffers: { nameValue: number; effectValue: number } | null; fromCommunity: boolean } {
  const lines = enchantStatLines(enchant);
  const client = lines.filter((l) => l.source === "client");
  const nums = [...enchant.name.matchAll(/d+/g)].map((m) => Number(m[0]));
  const nameDiffers = client.length > 0 && nums.length > 0 && !client.some((l) => nums.includes(l.value)) ? { nameValue: nums[0]!, effectValue: client[0]!.value } : null;
  return { nameDiffers, fromCommunity: lines.some((l) => l.source === "community") };
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
