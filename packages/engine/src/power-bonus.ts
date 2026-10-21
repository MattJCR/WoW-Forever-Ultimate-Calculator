import type { AbilityEffect } from "@wfuc/schema";
import type { DerivedStats } from "./derived-stats.js";
import type { ModifiedAbility, ModifiedEffect } from "./spell-mods.js";

/**
 * Lo que suman el poder con hechizos y el poder de ataque al daño y la curación de una habilidad. **Estimación**: el cliente trae el
 * coeficiente de poder con hechizos de cada efecto (`client-db2`), pero no dice si Forever lo aplica como Classic, y no trae
 * coeficientes de poder de ataque (los golpes de arma usan la formula de Classic: arma + poder de ataque ÷ 14 × velocidad, `community`).
 * Nunca se mezcla con las cifras base: la tarjeta lo enseña aparte.
 */

/** Daño de un arma equipada, para los golpes de arma. */
export interface PowerWeapon {
  min: number;
  max: number;
  speed: number;
  /** Velocidad normalizada de Classic (daga 1,7, una mano 2,4, dos manos 3,3, a distancia 2,8). */
  normalizedSpeed: number;
}

export interface PowerContext {
  /** Poder con hechizos de daño y de sanación finales (talentos, equipo y atributos). */
  spellDamage: number;
  spellHealing: number;
  /** Poder con hechizos de una escuela concreta que da el equipo («+30 de daño de Fuego»), por máscara de escuela (2 Sagrado ... 64 Arcano). */
  schoolPower: Record<number, number>;
  attackPower: number;
  rangedAttackPower: number;
  mainHand: PowerWeapon | null;
  ranged: PowerWeapon | null;
}

const SCHOOL_KEYS: Record<number, string> = { 2: "holy-power", 4: "fire-power", 8: "nature-power", 16: "frost-power", 32: "shadow-power", 64: "arcane-power" };
const rowFinal = (d: DerivedStats, key: string): number => d.rows.find((r) => r.key === key)?.final ?? 0;

/** Contexto de poder a partir de las estadísticas finales (`deriveStats`), las del equipo (`summarizeGear().stats`) y las armas llevadas. */
export function powerContext(derived: DerivedStats, gearStats: Record<string, number> | null, weapons: { slot: string; min: number; max: number; speed: number; normalizedSpeed: number }[]): PowerContext {
  const weapon = (slot: string): PowerWeapon | null => {
    const w = weapons.find((x) => x.slot === slot);
    return w ? { min: w.min, max: w.max, speed: w.speed, normalizedSpeed: w.normalizedSpeed } : null;
  };
  return {
    spellDamage: rowFinal(derived, "spell-damage"),
    spellHealing: rowFinal(derived, "spell-healing"),
    schoolPower: Object.fromEntries(Object.entries(SCHOOL_KEYS).map(([mask, key]) => [Number(mask), gearStats?.[key] ?? 0])),
    attackPower: rowFinal(derived, "ap"),
    rangedAttackPower: rowFinal(derived, "rap"),
    mainHand: weapon("mainHand"),
    ranged: weapon("ranged"),
  };
}

export interface SpellPowerBonus {
  effectIndex: number;
  heal: boolean;
  periodic: boolean;
  /** Poder con hechizos que se aplica (de daño o de sanación, más el de la escuela si la hay). */
  power: number;
  /** Fracción del poder (coeficiente del cliente con los % de daño de los talentos). */
  coefficient: number;
  /** Ticks del efecto periódico (1 si es directo). */
  ticks: number;
  /** Lo que suma el poder por golpe o por tick. */
  perHit: number;
  /** Lo que suma en total (perHit × ticks). */
  total: number;
  /** Cifra del efecto con el poder sumado (por golpe o por tick). */
  final: { min: number; max: number; average: number };
}

export interface WeaponPowerEstimate {
  min: number;
  max: number;
  average: number;
  ranged: boolean;
  /** Cómo sale la cifra, en una línea. */
  formula: string;
}

export interface PowerEstimate {
  spell: SpellPowerBonus[];
  weapon: WeaponPowerEstimate | null;
}

const WEAPON_PERCENT = 31;
const WEAPON_NORMALIZED = 121;
/** Un coeficiente exactamente 1 es el valor de relleno de la columna salvo en los hechizos de 3,5 s o más (Bola de Fuego, Pirodescarga...). */
const FILLER_COEFFICIENT = 1;
const FULL_COEFFICIENT_CAST_MS = 3500;
const MELEE_RANGE_YD = 8;

const isPeriodic = (e: AbilityEffect): boolean => e.periodMs !== null && e.kind !== "direct-heal" && (e.kind.startsWith("periodic") || e.viaSpellId !== null);

function spellBonus(m: ModifiedAbility, me: ModifiedEffect, ctx: PowerContext): SpellPowerBonus | null {
  const e = me.effect;
  const heal = e.kind === "direct-heal" || e.kind === "periodic-heal";
  if (!(e.kind === "direct-damage" || e.kind === "periodic-damage" || heal) || me.coefficient === null || me.coefficient <= 0) return null;
  // El daño físico no usa el poder con hechizos
  if (!heal && m.rank.schoolMask === 1) return null;
  const periodic = isPeriodic(e);
  if (e.coefficient === FILLER_COEFFICIENT && (periodic || m.rank.castMs < FULL_COEFFICIENT_CAST_MS)) return null;
  const duration = e.durationMs ?? m.durationMs;
  const ticks = periodic ? (duration && e.periodMs ? Math.round(duration / e.periodMs) : 0) : 1;
  if (ticks <= 0) return null;
  const power = heal ? ctx.spellHealing : ctx.spellDamage + (ctx.schoolPower[m.rank.schoolMask] ?? 0);
  if (power <= 0) return null;
  const perHit = power * me.coefficient;
  return {
    effectIndex: e.index,
    heal,
    periodic,
    power,
    coefficient: me.coefficient,
    ticks,
    perHit,
    total: perHit * ticks,
    final: { min: me.final.min + perHit, max: me.final.max + perHit, average: me.final.average + perHit },
  };
}

/**
 * Golpe de arma con poder de ataque (Classic): cada efecto de daño de arma suma `plano + arma + PA ÷ 14 × velocidad` (la velocidad
 * normalizada en los golpes normalizados, efecto 121) y el efecto «% de daño de arma» (31) multiplica el total. Sin ningún efecto plano,
 * `arma + PA ÷ 14 × velocidad`. Usa el arma a distancia si la habilidad tiene alcance. Estimación: sin confirmar en Forever.
 */
function weaponEstimate(m: ModifiedAbility, ctx: PowerContext): WeaponPowerEstimate | null {
  if (m.weaponEffects.length === 0) return null;
  const ranged = m.rank.rangeYd !== null && m.rank.rangeYd > MELEE_RANGE_YD && m.rank.rangeYd < 1000;
  const weapon = ranged ? ctx.ranged : ctx.mainHand;
  if (!weapon) return null;
  const ap = ranged ? ctx.rangedAttackPower : ctx.attackPower;
  const flats = m.weaponEffects.filter((x) => x.effect.effect !== WEAPON_PERCENT);
  const pct = m.weaponEffects.filter((x) => x.effect.effect === WEAPON_PERCENT).reduce((n, x) => n * (x.final.average / 100), 1);
  const parts = flats.length > 0 ? flats.map((x) => ({ flat: x.final, speed: x.effect.effect === WEAPON_NORMALIZED ? weapon.normalizedSpeed : weapon.speed })) : [{ flat: { min: 0, max: 0, average: 0 }, speed: weapon.speed }];
  let min = 0;
  let max = 0;
  for (const p of parts) {
    const apPart = (ap / 14) * p.speed;
    min += p.flat.min + weapon.min + apPart;
    max += p.flat.max + weapon.max + apPart;
  }
  min *= pct;
  max *= pct;
  const speed = parts[0]!.speed;
  const fmt = (n: number): string => String(Math.round(n * 10) / 10).replace(".", ",");
  const formula = `arma ${fmt(weapon.min)}–${fmt(weapon.max)} + ${Math.round(ap)} de poder de ataque ÷ 14 × ${fmt(speed)} s${flats.length > 0 && flats.some((x) => x.final.average !== 0) ? " + daño plano" : ""}${pct !== 1 ? ` × ${fmt(pct * 100)} %` : ""}`;
  return { min, max, average: (min + max) / 2, ranged, formula };
}

/** Estimación de lo que suma el poder del personaje a esta habilidad; `ctx` null = sin datos (no hay raza ni equipo). */
export function powerEstimate(m: ModifiedAbility, ctx: PowerContext | null): PowerEstimate {
  if (!ctx) return { spell: [], weapon: null };
  return { spell: m.effects.map((me) => spellBonus(m, me, ctx)).filter((x): x is SpellPowerBonus => x !== null), weapon: weaponEstimate(m, ctx) };
}
