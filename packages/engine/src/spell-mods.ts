import type { AbilityEffect, AbilityRank } from "@wfuc/schema";
import { effectAt, isWeaponDamageEffect, WEAPON_PERCENT_EFFECT } from "./abilities.js";
import { rankOf, type Build, type ClassIndex } from "./rules.js";

/** Auras de talento que modifican hechizos concretos (SpellEffect.EffectAura). */
export const AURA_ADD_FLAT_MODIFIER = 107;
export const AURA_ADD_PCT_MODIFIER = 108;
/** Operacion 18 = probabilidad de exito: en los venenos, la de aplicarlos con cada golpe (Venenos mejorados +10). */
export const OP_CHANCE = 18;
/** Operaciones: 1 duracion, 4 cargas, 6 radio. */
export const OP_DURATION = 1;
export const OP_CHARGES = 4;
export const OP_RADIUS = 6;

/** Operacion de un modificador (EffectMiscValue en las auras 107/108; SpellModOp del cliente). */
export const SPELL_MOD_OPS: Record<number, string> = {
  0: "daño",
  1: "duración",
  2: "amenaza",
  3: "efecto 1",
  4: "cargas",
  5: "alcance",
  6: "radio",
  7: "probabilidad de crítico",
  8: "todos los efectos",
  9: "retroceso al lanzar",
  10: "tiempo de lanzamiento",
  11: "enfriamiento",
  12: "efecto 2",
  14: "coste",
  15: "bonus de daño crítico",
  16: "probabilidad de impacto",
  17: "objetivos extra",
  18: "probabilidad de activación",
  19: "tiempo de activación",
  20: "multiplicador de daño",
  21: "enfriamiento global",
  22: "daño periódico",
  23: "efecto 3",
  24: "multiplicador de bonus",
  // Comprobadas contra el texto del cliente: Protección Arcana (27, -33 %), Venenos inmundos (28, +40 %), Cauce de salud mejorado (32, -30 %)
  27: "maná perdido por daño recibido",
  28: "resistencia a ser disipado",
  32: "coste de salud",
};
export const opLabel = (op: number): string => SPELL_MOD_OPS[op] ?? `operación ${op}`;

export interface SpellModifier {
  source: { name: string | null; spellId: number; nodeId: number; rank: number; maxRank: number };
  kind: "flat" | "pct";
  /** SpellModOp (ver SPELL_MOD_OPS). */
  op: number;
  /** Valor del rango escogido: puntos (plano) o porcentaje. */
  value: number;
  /** Mascara de clase de las habilidades a las que afecta. */
  mask: number[];
}

/** Dos mascaras de clase comparten algun bit. */
export const masksIntersect = (a: number[], b: number[]): boolean => a.some((m, i) => m !== 0 && (m & (b[i] ?? 0)) !== 0);
const matches = (mask: number[], rank: AbilityRank): boolean => masksIntersect(mask, rank.classMask);

/**
 * Modificadores de hechizos que dan los talentos escogidos (de clase o de Legacy). Solo cuentan los talentos pasivos:
 * los de habilidad activa (Poder Arcano...) solo valen mientras esa habilidad esta activa, no son permanentes.
 */
export function spellModifiersOf(idx: ClassIndex, build: Build): SpellModifier[] {
  const out: SpellModifier[] = [];
  for (const { talent } of idx.ordered) {
    const rank = rankOf(build, talent.nodeId);
    if (rank === 0 || !talent.passive) continue;
    for (const info of talent.effectInfo) {
      if (info.aura !== AURA_ADD_FLAT_MODIFIER && info.aura !== AURA_ADD_PCT_MODIFIER) continue;
      const value = talent.rankValues[rank - 1]?.[info.index];
      if (value === null || value === undefined) continue;
      out.push({
        source: { name: talent.name, spellId: talent.spellId, nodeId: talent.nodeId, rank, maxRank: talent.maxRank },
        kind: info.aura === AURA_ADD_FLAT_MODIFIER ? "flat" : "pct",
        op: info.miscValue,
        value,
        mask: info.classMask,
      });
    }
  }
  return out;
}

/** Los modificadores cuya mascara cruza la de la propia habilidad (coste, lanzamiento, enfriamiento, alcance, efectos propios). */
export const modifiersFor = (rank: AbilityRank, mods: SpellModifier[]): SpellModifier[] => mods.filter((m) => matches(m.mask, rank));

/**
 * Todos los modificadores que afectan a la habilidad: los de su propia mascara y los que cruzan la mascara de un hechizo disparado
 * que lleva uno de sus efectos (el veneno instantaneo que aplica «Veneno instantaneo» es el que hace el daño y el que modifican los talentos).
 */
export const allModifiersFor = (rank: AbilityRank, mods: SpellModifier[]): SpellModifier[] =>
  mods.filter((m) => matches(m.mask, rank) || rank.effects.some((e) => e.classMask !== null && masksIntersect(m.mask, e.classMask)) || (m.op === OP_CHANCE && rank.procs.some((p) => masksIntersect(m.mask, p.classMask))));

export interface ModifiedEffect {
  effect: AbilityEffect;
  /** Sin talentos. */
  base: { min: number; max: number; average: number };
  /** Con talentos. */
  final: { min: number; max: number; average: number };
  /** Fraccion de poder con hechizos (con los porcentajes de talentos aplicados). */
  coefficient: number | null;
}

/** Duracion de un hechizo citado por el texto (`{{d:hechizo:1}}`, p. ej. la placa de hielo de una trampa) con los talentos que cruzan SU mascara. */
export interface ModifiedViaDuration {
  spellId: number;
  base: number;
  final: number;
}

/** Cargas citadas por el texto (`$n`) con «cargas» (operacion 4) de los talentos. */
export interface ModifiedCharges {
  spellId: number;
  base: number;
  final: number;
}

/** Una probabilidad de activacion del texto (`$NNNh%`) con los modificadores de los talentos. */
export interface ModifiedProc {
  spellId: number;
  base: number;
  final: number;
}

export interface ModifiedAbility {
  rank: AbilityRank;
  level: number;
  applied: SpellModifier[];
  costType: AbilityRank["costType"];
  cost: number | null;
  costPctOfBase: number | null;
  castMs: number;
  cooldownMs: number | null;
  rangeYd: number | null;
  durationMs: number | null;
  /** Puntos porcentuales de probabilidad de critico que suman los talentos. */
  critChanceBonus: number;
  /** % extra de bonus de daño critico. */
  critDamageBonusPct: number;
  /** Puntos porcentuales de probabilidad de impacto. */
  hitChanceBonus: number;
  /** % de retroceso (pushback) que se ignora. */
  pushbackResistPct: number;
  threatPct: number;
  effects: ModifiedEffect[];
  /**
   * Efectos de daño de arma (31 = «X % de daño de arma», 17/58/121 = daño plano de arma), con los modificadores de daño de los
   * talentos. Aparte de `effects` porque su valor no es un rango «mín–máx» de daño; los usa el texto de la habilidad.
   */
  weaponEffects: ModifiedEffect[];
  /** Resto de efectos (auras de velocidad, aturdimientos, escudos…) con «todos los efectos» y «efecto 1/2/3» de los talentos. */
  otherEffects: ModifiedEffect[];
  /** Radio máximo (m) con «radio» (operación 6) de los talentos; null si la habilidad no es de área. */
  radiusYd: number | null;
  /** Cargas que cita el texto (Fuego interno: 20 → 32 con Fuego interno mejorado). */
  charges: ModifiedCharges[];
  /** Duración de los hechizos citados por el texto (no el propio), con «duración» de los talentos que cruzan su máscara. */
  viaDurations: ModifiedViaDuration[];
  /** Probabilidades de activación que cita el texto (el «20 % de probabilidad» de un veneno), con «probabilidad de éxito» de los talentos. */
  procs: ModifiedProc[];
  /** Modificadores que se muestran pero el motor aun no calcula (operacion sin formula). */
  uncomputed: SpellModifier[];
}

const sum = (mods: SpellModifier[], kind: SpellModifier["kind"], ...ops: number[]): number =>
  mods.filter((m) => m.kind === kind && ops.includes(m.op)).reduce((n, m) => n + m.value, 0);

/** Aplica primero los modificadores planos y despues los porcentuales (suman entre si). */
const modify = (value: number, mods: SpellModifier[], ...ops: number[]): number => (value + sum(mods, "flat", ...ops)) * (1 + sum(mods, "pct", ...ops) / 100);

const COMPUTED_OPS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 18, 22, 23]);

/**
 * Calcula una habilidad a un nivel con los modificadores de los talentos. Convencion (como el servidor de Classic):
 * "daño" (0) afecta a los efectos directos, "daño periodico" (22) a los periodicos, "efecto 1/2/3" a ese efecto y
 * "todos los efectos" (8) a todos. El porcentaje de daño tambien escala el coeficiente de poder con hechizos.
 */
export function applyModifiers(rank: AbilityRank, level: number, all: SpellModifier[]): ModifiedAbility {
  const own = modifiersFor(rank, all);
  const applied = allModifiersFor(rank, all);
  // Un efecto de otro hechizo (disparado o citado) con mascara propia se modifica con lo que cruza ESA mascara; sin ella, con las
  // operaciones generales de los modificadores de la habilidad (el indice del efecto es el del hechizo original)
  const modsOf = (e: AbilityEffect): SpellModifier[] =>
    e.viaSpellId === null ? own : e.classMask !== null ? applied.filter((m) => masksIntersect(m.mask, e.classMask!)) : own.filter((m) => m.op === 0 || m.op === 8 || m.op === 22);
  const effects: ModifiedEffect[] = rank.effects
    .filter((e) => e.kind !== "other" && e.kind !== "absorb")
    .map((e) => {
      const base = effectAt(e, rank, level);
      const direct = e.kind === "direct-damage" || e.kind === "direct-heal";
      const effectOps = [8, [3, 12, 23][e.index] ?? -1];
      const ops = [...effectOps, direct ? 0 : 22].filter((o) => o >= 0);
      const mods = modsOf(e);
      const flat = sum(mods, "flat", ...ops);
      const pct = sum(mods, "pct", ...ops);
      const factor = 1 + pct / 100;
      return {
        effect: e,
        base,
        final: { min: (base.min + flat) * factor, max: (base.max + flat) * factor, average: (base.average + flat) * factor },
        coefficient: e.coefficient === null ? null : e.coefficient * factor,
      };
    });
  // Daño de arma: el % de daño de los talentos multiplica tanto el % de arma como el daño plano que se suma; los puntos planos
  // (aura 107) solo se suman al daño plano, nunca al porcentaje del arma
  const weaponEffects: ModifiedEffect[] = rank.effects.filter(isWeaponDamageEffect).map((e) => {
    const base = effectAt(e, rank, level);
    const ops = [8, 0, [3, 12, 23][e.index] ?? -1].filter((o) => o >= 0);
    const mods = modsOf(e);
    const flat = e.effect === WEAPON_PERCENT_EFFECT ? 0 : sum(mods, "flat", ...ops);
    const factor = 1 + sum(mods, "pct", ...ops) / 100;
    return { effect: e, base, final: { min: (base.min + flat) * factor, max: (base.max + flat) * factor, average: (base.average + flat) * factor }, coefficient: null };
  });
  // Resto de efectos (reducciones de velocidad, aturdimientos, auras...): solo los modifican «todos los efectos» y «efecto 1/2/3»
  const otherEffects: ModifiedEffect[] = rank.effects
    .filter((e) => (e.kind === "other" || e.kind === "absorb") && !isWeaponDamageEffect(e))
    .map((e) => {
      const base = effectAt(e, rank, level);
      const ops = [8, [3, 12, 23][e.index] ?? -1].filter((o) => o >= 0);
      const mods = modsOf(e);
      const flat = sum(mods, "flat", ...ops);
      const factor = 1 + sum(mods, "pct", ...ops) / 100;
      return { effect: e, base, final: { min: (base.min + flat) * factor, max: (base.max + flat) * factor, average: (base.average + flat) * factor }, coefficient: null };
    });
  // Probabilidad de activacion: plano (puntos) y despues porcentaje, con tope del 100 %; solo los modificadores que cruzan la mascara de SU hechizo
  const procs: ModifiedProc[] = rank.procs.map((p) => {
    const mods = all.filter((m) => m.op === OP_CHANCE && masksIntersect(m.mask, p.classMask));
    return { spellId: p.spellId, base: p.chance, final: Math.min(100, (p.chance + sum(mods, "flat", OP_CHANCE)) * (1 + sum(mods, "pct", OP_CHANCE) / 100)) };
  });
  // Radio (los efectos de area pueden vivir en un hechizo disparado: se cruza con todos los modificadores aplicables)
  const radiusYd = rank.radiusYd === null ? null : Math.max(0, modify(rank.radiusYd, applied, OP_RADIUS));
  // Cargas (SpellAuraOptions.ProcCharges del hechizo citado, que suele ser el propio)
  const charges: ModifiedCharges[] = rank.charges.map((c) => ({ spellId: c.spellId, base: c.charges, final: Math.max(0, Math.round(modify(c.charges, c.spellId === rank.spellId ? own : applied, OP_CHARGES))) }));
  // Duracion de los hechizos citados: se cruza con la mascara del hechizo (la del efecto que lo lleva)
  const viaDurations: ModifiedViaDuration[] = [];
  for (const e of rank.effects) {
    if (e.viaSpellId === null || e.durationMs === null || viaDurations.some((v) => v.spellId === e.viaSpellId)) continue;
    const mods = e.classMask !== null ? applied.filter((m) => masksIntersect(m.mask, e.classMask!)) : own;
    viaDurations.push({ spellId: e.viaSpellId, base: e.durationMs, final: Math.max(0, Math.round(modify(e.durationMs, mods, OP_DURATION))) });
  }
  const cost = rank.cost === null ? null : modify(rank.cost, own, 14);
  return {
    rank,
    level,
    applied,
    costType: rank.costType,
    cost: cost === null ? null : Math.max(0, Math.round(cost)),
    costPctOfBase: rank.costPctOfBase === null ? null : Math.max(0, modify(rank.costPctOfBase, own, 14)),
    castMs: Math.max(0, Math.round(modify(rank.castMs, own, 10))),
    cooldownMs: rank.cooldownMs === null ? null : Math.max(0, Math.round(modify(rank.cooldownMs, own, 11))),
    rangeYd: rank.rangeYd === null ? null : Math.max(0, modify(rank.rangeYd, own, 5)),
    durationMs: rank.durationMs === null ? null : Math.max(0, Math.round(modify(rank.durationMs, own, 1))),
    // Crítico, impacto y amenaza se tiran en el hechizo que hace el daño (Mutilar: el golpe de arma), no en el que lo lanza
    critChanceBonus: sum(applied, "flat", 7) + sum(applied, "pct", 7),
    critDamageBonusPct: sum(applied, "pct", 15) + sum(applied, "flat", 15),
    hitChanceBonus: sum(applied, "flat", 16) + sum(applied, "pct", 16),
    pushbackResistPct: sum(own, "pct", 9) + sum(own, "flat", 9),
    threatPct: sum(applied, "pct", 2),
    effects,
    weaponEffects,
    otherEffects,
    radiusYd,
    charges,
    viaDurations,
    procs,
    uncomputed: applied.filter((m) => !COMPUTED_OPS.has(m.op)),
  };
}
