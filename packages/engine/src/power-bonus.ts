import type { AbilityEffect } from "@wfuc/schema";
import type { DerivedStats } from "./derived-stats.js";
import { attackPowerVsKey, spellDamageVsKey } from "./item-stat-keys.js";
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
  /** false en las varitas: su daño no usa el poder de ataque. */
  usesAttackPower: boolean;
  /** «+N de daño» del encantamiento y de la mejora temporal de esta arma: se suma a cada golpe suyo. */
  bonus?: number;
  /** Nombre en la fórmula en lugar de «arma» (formas del druida: «Forma felina (sin arma)»). */
  name?: string;
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
  /** Arma de la mano izquierda (`offHandFactor` = fracción de daño que hace). */
  offHand: PowerWeapon | null;
  ranged: PowerWeapon | null;
  /** «+N de daño» (tipo 83) del equipo: se suma a cada golpe de arma, de las dos manos. */
  physicalDamage: number;
  /** Fracción del daño que hace la mano izquierda (Classic 0,5; suposición sin medir en Forever). */
  offHandFactor: number;
}

/** ItemSubClass de las varitas. */
const WAND_SUBCLASS = 19;

/**
 * Fracción de daño de la mano izquierda: la base (0,5, confirmada por el usuario el 22/10/2026) por el «daño del arma de la mano izquierda» de talentos,
 * Legacy y equipo (Especialización en doble empuñadura: +10 % → 0,5 × 1,1).
 */
export function offHandFactorOf(base: number, totals: { label: string; value: number }[]): number {
  const bonus = totals.filter((t) => t.label === "daño del arma de la mano izquierda").reduce((n, t) => n + t.value, 0);
  return base * (1 + bonus / 100);
}

const SCHOOL_KEYS: Record<number, string> = { 2: "holy-power", 4: "fire-power", 8: "nature-power", 16: "frost-power", 32: "shadow-power", 64: "arcane-power" };
const rowFinal = (d: DerivedStats, key: string): number => d.rows.find((r) => r.key === key)?.final ?? 0;

/** Contexto de poder a partir de las estadísticas finales (`deriveStats`), las del equipo (`summarizeGear().stats`) y las armas llevadas. */
export function powerContext(derived: DerivedStats, gearStats: Record<string, number> | null, weapons: { slot: string; min: number; max: number; speed: number; normalizedSpeed: number; subclassId?: number; bonusDamage?: number }[], options: { offHandFactor?: number; creatureType?: string | null } = {}): PowerContext {
  // «+N de poder de ataque / daño con hechizos contra bestias…»: solo cuenta si el objetivo es de ese tipo de criatura (`creatureType`)
  const vsAttack = options.creatureType ? (gearStats?.[attackPowerVsKey(options.creatureType)] ?? 0) : 0;
  const vsSpell = options.creatureType ? (gearStats?.[spellDamageVsKey(options.creatureType)] ?? 0) : 0;
  const weapon = (slot: string): PowerWeapon | null => {
    const w = weapons.find((x) => x.slot === slot);
    return w ? { min: w.min, max: w.max, speed: w.speed, normalizedSpeed: w.normalizedSpeed, usesAttackPower: w.subclassId !== WAND_SUBCLASS, bonus: w.bonusDamage ?? 0 } : null;
  };
  return {
    spellDamage: rowFinal(derived, "spell-damage") + vsSpell,
    spellHealing: rowFinal(derived, "spell-healing"),
    schoolPower: Object.fromEntries(Object.entries(SCHOOL_KEYS).map(([mask, key]) => [Number(mask), gearStats?.[key] ?? 0])),
    attackPower: rowFinal(derived, "ap") + vsAttack,
    rangedAttackPower: rowFinal(derived, "rap") + vsAttack,
    mainHand: weapon("mainHand"),
    offHand: weapon("offHand"),
    ranged: weapon("ranged"),
    physicalDamage: gearStats?.["physical-damage"] ?? 0,
    offHandFactor: options.offHandFactor ?? 0.5,
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

/** Lo que hace una mano en un golpe de arma: `plano + arma + «+N de daño» + PA ÷ 14 × velocidad`. */
function handDamage(flat: { min: number; max: number }, weapon: PowerWeapon, speed: number, ap: number, bonus: number): { min: number; max: number } {
  const apPart = (ap / 14) * speed;
  const own = weapon.bonus ?? 0;
  return { min: flat.min + weapon.min + own + bonus + apPart, max: flat.max + weapon.max + own + bonus + apPart };
}

/**
 * Golpe de arma con poder de ataque (Classic): cada efecto de daño de arma suma `plano + arma + «+N de daño» + PA ÷ 14 × velocidad` (la
 * velocidad normalizada en los golpes normalizados, efecto 121) y el efecto «% de daño de arma» (31) multiplica el total. Sin ningún efecto
 * plano, `arma + PA ÷ 14 × velocidad`. Usa el arma a distancia si la habilidad tiene alcance. Las que golpean con la mano izquierda
 * (`weaponHand`: «con ambas armas», «el arma de tu mano izquierda») usan también esa arma, con la fracción de daño de la mano izquierda
 * (Classic 0,5). Estimación: sin confirmar en Forever. Sin las armas que necesita no hay estimación.
 */
function weaponEstimate(m: ModifiedAbility, ctx: PowerContext): WeaponPowerEstimate | null {
  if (m.weaponEffects.length === 0) return null;
  const ranged = m.rank.rangeYd !== null && m.rank.rangeYd > MELEE_RANGE_YD && m.rank.rangeYd < 1000;
  // Lanzar el arma de la mano izquierda (Cuchillo envenenado) es a distancia pero usa esa arma, con la fracción de la mano izquierda
  const thrownOffHand = ranged && m.rank.weaponHand === "off";
  const hand = ranged && !thrownOffHand ? "main" : m.rank.weaponHand;
  const hands: { weapon: PowerWeapon; factor: number; label: string }[] = [];
  if (thrownOffHand) {
    if (ctx.offHand) hands.push({ weapon: ctx.offHand, factor: ctx.offHandFactor, label: "mano izquierda " });
  } else if (ranged) {
    if (ctx.ranged) hands.push({ weapon: ctx.ranged, factor: 1, label: "" });
  } else {
    if (hand !== "off" && ctx.mainHand) hands.push({ weapon: ctx.mainHand, factor: 1, label: hand === "both" ? "mano derecha " : "" });
    if (hand !== "main" && ctx.offHand) hands.push({ weapon: ctx.offHand, factor: ctx.offHandFactor, label: hand === "both" ? "mano izquierda " : "mano izquierda " });
  }
  const needed = ranged || hand === "main" ? 1 : hand === "off" ? 1 : 2;
  if (hands.length < needed) return null;
  const apOf = (w: PowerWeapon): number => (w.usesAttackPower ? (ranged ? ctx.rangedAttackPower : ctx.attackPower) : 0);
  const flats = m.weaponEffects.filter((x) => x.effect.effect !== WEAPON_PERCENT);
  // Daño plano y % de arma sin el factor de % de daño (talentos y daño infligido): ese factor multiplica el golpe entero, una sola vez
  const flatOf = (x: ModifiedAbility["weaponEffects"][number]) => ({ min: x.base.min + (x.flat ?? 0), max: x.base.max + (x.flat ?? 0), average: x.base.average + (x.flat ?? 0) });
  const pct = m.weaponEffects.filter((x) => x.effect.effect === WEAPON_PERCENT).reduce((n, x) => n * (x.base.average / 100), 1);
  const factor = m.weaponEffects[0]?.factor ?? 1;
  const fmt = (n: number): string => String(Math.round(n * 10) / 10).replace(".", ",");
  let min = 0;
  let max = 0;
  const texts: string[] = [];
  for (const h of hands) {
    const parts = flats.length > 0 ? flats.map((x) => ({ flat: flatOf(x), speed: x.effect.effect === WEAPON_NORMALIZED ? h.weapon.normalizedSpeed : h.weapon.speed })) : [{ flat: { min: 0, max: 0, average: 0 }, speed: h.weapon.speed }];
    let hMin = 0;
    let hMax = 0;
    for (const p of parts) {
      const d = handDamage(p.flat, h.weapon, p.speed, apOf(h.weapon), ctx.physicalDamage);
      hMin += d.min;
      hMax += d.max;
    }
    min += hMin * h.factor;
    max += hMax * h.factor;
    const speed = parts[0]!.speed;
    texts.push(
      `${h.weapon.name ?? `${h.label}arma ${fmt(h.weapon.min)}–${fmt(h.weapon.max)}`}${(h.weapon.bonus ?? 0) > 0 ? ` + ${fmt(h.weapon.bonus!)} de daño añadido al arma` : ""}${ctx.physicalDamage > 0 ? ` + ${fmt(ctx.physicalDamage)} de daño del equipo` : ""} + ${Math.round(apOf(h.weapon))} de poder de ataque ÷ 14 × ${fmt(speed)} s${flats.length > 0 && flats.some((x) => flatOf(x).average !== 0) ? " + daño plano" : ""}${h.factor !== 1 ? ` × ${fmt(h.factor * 100)} % (mano izquierda)` : ""}`,
    );
  }
  min *= pct * factor;
  max *= pct * factor;
  const total = pct * factor;
  const formula = `${texts.join(" ; ")}${total !== 1 ? ` × ${fmt(total * 100)} %` : ""}`;
  return { min, max, average: (min + max) / 2, ranged, formula };
}

/** Estimación de lo que suma el poder del personaje a esta habilidad; `ctx` null = sin datos (no hay raza ni equipo). */
export function powerEstimate(m: ModifiedAbility, ctx: PowerContext | null): PowerEstimate {
  if (!ctx) return { spell: [], weapon: null };
  return { spell: m.effects.map((me) => spellBonus(m, me, ctx)).filter((x): x is SpellPowerBonus => x !== null), weapon: weaponEstimate(m, ctx) };
}

export interface SwingEstimate {
  hand: "main" | "off" | "ranged";
  min: number;
  max: number;
  average: number;
  /** Velocidad del arma (s) y con la celeridad. */
  speed: number;
  hastedSpeed: number;
  /** Daño por segundo con la celeridad (los golpes de la mano izquierda ya llevan su fracción). */
  dps: number;
  /** Cómo sale la cifra, en una línea. */
  formula: string;
}

/**
 * Golpes automáticos (Classic): cada golpe hace `arma + «+N de daño» + PA ÷ 14 × velocidad` (poder de ataque a distancia para el arma a distancia);
 * la mano izquierda hace solo su fracción (Classic 0,5, suposición) y la celeridad acorta el tiempo entre golpes. Sin críticos ni fallos: es el daño
 * de un golpe que acierta. Estimación: reglas de Classic sin confirmar en Forever (`community`/`assumption`).
 */
export function autoAttacks(ctx: PowerContext, haste: { melee: number; ranged: number }): SwingEstimate[] {
  const fmt = (n: number): string => String(Math.round(n * 10) / 10).replace(".", ",");
  const swing = (hand: SwingEstimate["hand"], weapon: PowerWeapon, apRaw: number, hastePct: number, factor: number): SwingEstimate => {
    const ap = weapon.usesAttackPower ? apRaw : 0;
    const apPart = (ap / 14) * weapon.speed;
    const own = weapon.bonus ?? 0;
    const min = (weapon.min + own + ctx.physicalDamage + apPart) * factor;
    const max = (weapon.max + own + ctx.physicalDamage + apPart) * factor;
    const hastedSpeed = weapon.speed / (1 + hastePct / 100);
    const average = (min + max) / 2;
    return {
      hand,
      min,
      max,
      average,
      speed: weapon.speed,
      hastedSpeed,
      dps: average / hastedSpeed,
      formula: `arma ${fmt(weapon.min)}–${fmt(weapon.max)}${own > 0 ? ` + ${fmt(own)} de daño añadido al arma` : ""}${ctx.physicalDamage > 0 ? ` + ${fmt(ctx.physicalDamage)} de daño del equipo` : ""} + ${Math.round(ap)} de poder de ataque ÷ 14 × ${fmt(weapon.speed)} s${factor !== 1 ? ` × ${fmt(factor * 100)} %` : ""}`,
    };
  };
  const out: SwingEstimate[] = [];
  if (ctx.mainHand) out.push(swing("main", ctx.mainHand, ctx.attackPower, haste.melee, 1));
  if (ctx.offHand) out.push(swing("off", ctx.offHand, ctx.attackPower, haste.melee, ctx.offHandFactor));
  if (ctx.ranged) out.push(swing("ranged", ctx.ranged, ctx.rangedAttackPower, haste.ranged, 1));
  return out;
}
