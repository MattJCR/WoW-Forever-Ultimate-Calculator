import type { Abilities, Ability, AbilityRank, RuleEffect, RuleScope, TalentRules } from "@wfuc/schema";
import { rankOf, type Build, type ClassIndex } from "./rules.js";

/** Un efecto de una regla de talento ya resuelto al rango escogido. */
export interface RuleLine {
  source: { name: string | null; spellId: number; rank: number; maxRank: number };
  /** Texto en espanol con las cifras del rango ya puestas. */
  text: string;
  /** Cifra principal ({v}), con su factor aplicado. */
  value: number;
  unit: RuleEffect["unit"];
  scope: RuleScope;
  action: RuleEffect["action"];
}

const fmt = (n: number): string => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

/**
 * Efectos de los talentos escogidos que el cliente guarda como efectos genericos (auras 4 y 42) y que clasificamos a mano
 * en data/rules (procedencia assumption): la cifra por rango es del cliente; el alcance y el texto, nuestros.
 * Solo cuentan los talentos pasivos (los que dan una habilidad activa no entran).
 */
export function ruleLines(rules: TalentRules | null, cls: ClassIndex, build: Build): RuleLine[] {
  if (!rules) return [];
  const out: RuleLine[] = [];
  for (const r of rules.rules) {
    const item = cls.ordered.find((i) => i.talent.spellId === r.spellId);
    if (!item) continue;
    const rank = rankOf(build, item.talent.nodeId);
    if (rank === 0 || !item.talent.passive) continue;
    for (const e of r.effects) {
      const raw = item.talent.rankValues[rank - 1]?.[e.index];
      if (raw === null || raw === undefined) continue;
      const value = raw * e.factor;
      let text = e.label.replace(/\{v\}/g, fmt(value));
      for (const [key, x] of Object.entries(e.extras)) {
        const extra = item.talent.rankValues[rank - 1]?.[x.index];
        if (extra !== null && extra !== undefined) text = text.replace(new RegExp(`\\{${key}\\}`, "g"), fmt(extra * x.factor));
      }
      out.push({ source: { name: item.talent.name, spellId: item.talent.spellId, rank, maxRank: item.talent.maxRank }, text, value, unit: e.unit, scope: e.scope, action: e.action });
    }
  }
  return out;
}

/** Efectos de hechizo que hacen daño de arma o físico (daño de escuela 2, drenar salud 9 = Espiral mortal, daño de arma 17/31/58, arma normalizada 121): el extractor solo marca como `direct-damage` el 2. */
const WEAPON_DAMAGE_EFFECTS: ReadonlySet<number> = new Set([2, 9, 17, 31, 58, 121]);
const EFFECT_DUMMY = 3;

/**
 * El rango hace daño: efectos de daño o periódicos, de arma, y (solo escuela física) un efecto «dummy» cuyo texto habla de daño
 * (Ejecutar aplica su daño por código del juego).
 */
export const dealsDamage = (rank: AbilityRank): boolean =>
  rank.effects.some((e) => e.kind === "direct-damage" || e.kind === "periodic-damage" || WEAPON_DAMAGE_EFFECTS.has(e.effect)) ||
  (rank.schoolMask === 1 && rank.effects.some((e) => e.effect === EFFECT_DUMMY) && /daño/i.test(rank.description));

/** El rango hace sanación (directa o periódica). */
export const healsTarget = (rank: AbilityRank): boolean => rank.effects.some((e) => e.kind === "direct-heal" || e.kind === "periodic-heal");

/** Solo el daño y la sanación pueden ser críticos (Robar, las conjuraciones, los buffs y los escudos no). */
export const canCrit = (rank: AbilityRank): boolean => dealsDamage(rank) || healsTarget(rank);

/** true si la regla afecta a esta habilidad (por nombre, por escuela o a todas; damagingOnly = solo las que hacen daño). */
export function ruleAppliesTo(line: RuleLine, ability: Ability, rank: AbilityRank): boolean {
  const s = line.scope;
  if (s.damagingOnly && !dealsDamage(rank)) return false;
  if (s.spells?.includes(ability.name)) return true;
  if (s.schools?.some((bit) => (rank.schoolMask & bit) !== 0)) return true;
  return s.all === true;
}

/** Nombres de las habilidades a las que afecta (null = todas). */
export function ruleScopeNames(line: RuleLine, abilities: Abilities | null): string[] | null {
  if (line.scope.all && !line.scope.damagingOnly) return null;
  if (!abilities) return [];
  const names = abilities.abilities.filter((a) => a.ranks.some((r) => ruleAppliesTo(line, a, r))).map((a) => a.name);
  return line.scope.all && names.length === abilities.abilities.length ? null : names;
}

/** Cifra extra de la regla aplicada a una habilidad concreta (p. ej. el maná que devuelve Maestro de los elementos). */
export function ruleAbilityDetail(line: RuleLine, rank: AbilityRank): { text: string; manaReturn: number | null } {
  if (line.action === "mana-return-pct-of-cost" && rank.cost !== null) {
    const manaReturn = Math.round((rank.cost * line.value) / 100);
    return { text: `${line.text} (≈ ${fmt(manaReturn)} de maná con este rango)`, manaReturn };
  }
  return { text: line.text, manaReturn: null };
}
