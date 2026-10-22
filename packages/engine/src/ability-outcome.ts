import type { AbilityEffect, AbilityRank } from "@wfuc/schema";
import type { Chances } from "./chances.js";
import { applyModifiers, type ModifiedAbility, type ModifiedEffect, type SpellModifier } from "./spell-mods.js";
import { powerEstimate, type PowerContext, type PowerEstimate } from "./power-bonus.js";

/**
 * Resultado de una habilidad con todo sumado: lo que hace en un lanzamiento sin talentos, con tus talentos, Legacy, raza y equipo, y con tu poder
 * (poder con hechizos o de ataque), y lo que queda esperando críticos y fallos. Es el «total calculado del incremento y su efecto» del Resumen.
 *
 * Procedencia mezclada y separada: las cifras de cada efecto y los modificadores de los talentos son del cliente (`client-db2`); el poder con hechizos y de
 * ataque aplica las reglas de Classic (estimación, `community`); el crítico y el fallo salen de `abilityChances` (cliente + comunidad); el multiplicador de
 * crítico (×1,5 hechizos, ×2 físico) es de la comunidad. Solo el daño o la sanación directos pueden ser críticos (los periódicos no: regla de Classic).
 */

export interface OutcomeLine {
  /** Qué es la cifra: «Daño directo», «Daño periódico (6 ticks)», «Golpe de arma»... */
  label: string;
  /** Sin talentos ni poder. */
  base: number;
  /** Con talentos, Legacy, raza y equipo (modificadores), sin poder. */
  talents: number;
  /** Con el poder del personaje sumado. */
  total: number;
  /** El efecto puede ser crítico (directo o golpe de arma). */
  critable: boolean;
  heal: boolean;
}

/** Lo que cambia el total al quitar una fuente (talento, ventaja de Legacy o pieza de equipo): su aportación marginal. */
export interface OutcomeSource {
  name: string;
  /** Diferencia del total por lanzamiento con y sin esta fuente. */
  gain: number;
  gainPct: number;
}

export interface AbilityOutcome {
  /** Sana, hace daño o las dos cosas (el resultado se da por separado en `lines`). */
  lines: OutcomeLine[];
  /** Totales por lanzamiento: sin talentos, con talentos y con tu poder. */
  base: number;
  talents: number;
  total: number;
  /** Incremento por talentos, Legacy, raza y equipo: `talents - base` y en %. */
  talentGain: number;
  talentGainPct: number;
  /** Lo que suma tu poder: `total - talents`. */
  powerGain: number;
  /** Lo que suma cada talento o pieza (aportación marginal, no suman exactamente: los % se multiplican). */
  sources: OutcomeSource[];
  /** Esperado por lanzamiento con fallo y crítico; null si no se puede calcular (sin datos de crítico). */
  expected: number | null;
  critChancePct: number | null;
  critMultiplier: number | null;
  hitPct: number | null;
  /** Por segundo: esperado (o total si no hay) entre el tiempo de lanzamiento con celeridad, la canalización o el enfriamiento. */
  perSecond: { value: number; basis: "cast" | "channel" | "cooldown"; seconds: number } | null;
}

const isDirect = (e: AbilityEffect): boolean => e.kind === "direct-damage" || e.kind === "direct-heal";
const isHealKind = (e: AbilityEffect): boolean => e.kind === "direct-heal" || e.kind === "periodic-heal";
const isPeriodic = (e: AbilityEffect): boolean => e.periodMs !== null && e.kind !== "direct-heal" && (e.kind.startsWith("periodic") || e.viaSpellId !== null);

/** Ticks de un efecto periódico (1 si es directo). */
function ticksOf(e: AbilityEffect, m: ModifiedAbility): number {
  if (!isPeriodic(e)) return 1;
  const duration = e.durationMs ?? m.durationMs;
  return duration && e.periodMs ? Math.max(0, Math.round(duration / e.periodMs)) : 0;
}

/** Líneas de resultado de una habilidad: un efecto de daño o sanación por línea, y el golpe de arma si lo hay. */
function linesOf(base: ModifiedAbility, m: ModifiedAbility, est: PowerEstimate, estBase: PowerEstimate): OutcomeLine[] {
  const lines: OutcomeLine[] = [];
  for (const me of m.effects) {
    const e = me.effect;
    const heal = isHealKind(e);
    if (!(e.kind === "direct-damage" || e.kind === "periodic-damage" || heal)) continue;
    const ticks = ticksOf(e, m);
    if (ticks <= 0) continue;
    const baseEffect = base.effects.find((x: ModifiedEffect) => x.effect.index === e.index && x.effect.viaSpellId === e.viaSpellId);
    const bonus = est.spell.find((b) => b.effectIndex === e.index && b.periodic === isPeriodic(e) && b.heal === heal);
    const talents = me.final.average * ticks;
    lines.push({
      label: isPeriodic(e) ? `${heal ? "Curación" : "Daño"} periódico (${ticks} ticks)` : heal ? "Curación directa" : "Daño directo",
      base: (baseEffect?.final.average ?? me.base.average) * ticks,
      talents,
      total: talents + (bonus ? bonus.perHit * ticks : 0),
      critable: isDirect(e),
      heal,
    });
  }
  if (est.weapon) {
    // El golpe de arma ya incluye el arma y el poder de ataque: «sin talentos» es la misma cuenta con los modificadores sin talentos
    lines.push({ label: est.weapon.ranged ? "Golpe de arma a distancia" : "Golpe de arma", base: estBase.weapon?.average ?? est.weapon.average, talents: est.weapon.average, total: est.weapon.average, critable: true, heal: false });
  }
  return lines;
}

const sumOf = (lines: OutcomeLine[], key: "base" | "talents" | "total"): number => lines.reduce((n, l) => n + l[key], 0);

/** Multiplicador de un golpe crítico: 1 + (multiplicador − 1) × (1 + bonus de daño crítico de los talentos). */
export const critMultiplierOf = (formulaMultiplier: number, bonusPct: number): number => 1 + (formulaMultiplier - 1) * (1 + bonusPct / 100);

/**
 * Resultado de la habilidad. `modifiers` son TODOS los modificadores (talentos, Legacy, equipo) de `applyModifiers`: con ellos se calcula la aportación
 * de cada fuente quitándola. `chances` null = sin datos de crítico: no hay valor esperado. Devuelve null si la habilidad no hace daño ni sana.
 */
export function abilityOutcome(input: {
  rank: AbilityRank;
  level: number;
  modifiers: SpellModifier[];
  /** Daño infligido por escuela de talentos, raza y equipo (`damageDonePct`), en %. */
  damageDonePct?: number;
  power: PowerContext | null;
  chances: Chances | null;
  critMultiplier: { spell: number; physical: number } | null;
  /** Celeridad (%) que se aplica a esta habilidad (`hasteFor`). */
  hastePct?: number;
}): AbilityOutcome | null {
  const { rank, level, modifiers, power } = input;
  const dd = input.damageDonePct ?? 0;
  const m = applyModifiers(rank, level, modifiers, { damageDonePct: dd });
  const base = applyModifiers(rank, level, []);
  const est = powerEstimate(m, power);
  const estBase = powerEstimate(base, power);
  const lines = linesOf(base, m, est, estBase);
  if (lines.length === 0) return null;
  const totals = { base: sumOf(lines, "base"), talents: sumOf(lines, "talents"), total: sumOf(lines, "total") };

  // Aportación marginal de cada fuente: el total con todo menos el total quitando solo esa
  const names = new Set(modifiers.map((x) => x.source.name ?? `Hechizo ${x.source.spellId}`));
  const sources: OutcomeSource[] = [];
  for (const name of names) {
    const without = modifiers.filter((x) => (x.source.name ?? `Hechizo ${x.source.spellId}`) !== name);
    const mw = applyModifiers(rank, level, without, { damageDonePct: dd });
    const lw = linesOf(base, mw, powerEstimate(mw, power), estBase);
    const gain = totals.total - sumOf(lw, "total");
    if (Math.abs(gain) >= 0.5) sources.push({ name, gain, gainPct: sumOf(lw, "total") > 0 ? (gain / sumOf(lw, "total")) * 100 : 0 });
  }
  sources.sort((a, b) => b.gain - a.gain);

  // Fallo y crítico: el crítico solo en lo directo y los golpes de arma; el fallo, en todo lo que hace daño (las sanaciones no fallan)
  const { chances, critMultiplier } = input;
  const crit = chances?.crit.vsTargetPct ?? null;
  const physical = rank.schoolMask === 1;
  const multBase = critMultiplier ? (physical ? critMultiplier.physical : critMultiplier.spell) : null;
  const mult = multBase === null ? null : critMultiplierOf(multBase, m.critDamageBonusPct);
  const hit = chances ? chances.hit.total : null;
  let expected: number | null = null;
  if (crit !== null && mult !== null) {
    expected = 0;
    for (const l of lines) {
      const hitFactor = l.heal || hit === null ? 1 : hit / 100;
      const critFactor = l.critable ? 1 + (crit / 100) * (mult - 1) : 1;
      expected += l.total * hitFactor * critFactor;
    }
  } else if (hit !== null) {
    expected = lines.reduce((n, l) => n + l.total * (l.heal ? 1 : hit / 100), 0);
  }

  // Por segundo: el lanzamiento con celeridad, la canalización o, si es instantánea, el enfriamiento (usada en cuanto está lista)
  const hasteFactor = 1 + (input.hastePct ?? 0) / 100;
  let perSecond: AbilityOutcome["perSecond"] = null;
  const value = expected ?? totals.total;
  if (rank.channeled && m.durationMs) perSecond = { value: value / (m.durationMs / 1000 / hasteFactor), basis: "channel", seconds: m.durationMs / 1000 / hasteFactor };
  else if (m.castMs > 0) perSecond = { value: value / (m.castMs / 1000 / hasteFactor), basis: "cast", seconds: m.castMs / 1000 / hasteFactor };
  else if (m.cooldownMs && m.cooldownMs > 0) perSecond = { value: value / (m.cooldownMs / 1000), basis: "cooldown", seconds: m.cooldownMs / 1000 };

  return {
    lines,
    base: totals.base,
    talents: totals.talents,
    total: totals.total,
    talentGain: totals.talents - totals.base,
    talentGainPct: totals.base > 0 ? ((totals.talents - totals.base) / totals.base) * 100 : 0,
    powerGain: totals.total - totals.talents,
    sources,
    expected,
    critChancePct: crit,
    critMultiplier: mult,
    hitPct: hit,
    perSecond,
  };
}
