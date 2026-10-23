import type { Abilities, Ability, AbilityEffect, AbilityRank } from "@wfuc/schema";

/** Rango mas alto que el personaje ya puede tener a ese nivel (null si aun no aprende ninguno). */
export function rankAtLevel(ability: Ability, level: number): AbilityRank | null {
  let best: AbilityRank | null = null;
  for (const r of ability.ranks) if (r.level <= level) best = r;
  return best;
}

/**
 * Valor de un efecto a un nivel del personaje. El valor medio crece `perLevel` por nivel por encima del nivel al que se
 * aprende el rango, hasta su nivel maximo (SpellLevels.MaxLevel). La dispersion NO escala: es fija, base * variacion, y el
 * rango queda centrado en la media (media -/+ dispersion/2). Comprobado contra la referencia: 91 de 91 rangos de dano
 * directo del Mago (a nivel min(60, nivel maximo del rango)).
 */
export function effectAt(effect: AbilityEffect, rank: AbilityRank, level: number): { min: number; max: number; average: number } {
  // Un efecto de un hechizo disparado escala con los niveles del propio hechizo (Nova de Fuego: base 12, maximo 17)
  const base = effect.levels?.base ?? rank.level;
  const cap = (effect.levels ? effect.levels.max : rank.maxLevel) ?? level;
  const levelsAbove = Math.max(0, Math.min(level, cap) - base);
  // Variables de nivel de Forever: el valor es un porcentaje de a + b x nivel + c x nivel^2 (Pua mental 132 % -> 248 a nivel 60)
  const k = effect.levelPoly ? (effect.levelPoly[0] + effect.levelPoly[1] * level + effect.levelPoly[2] * level * level) / 100 : 1;
  const scaled = (effect.base + effect.perLevel * levelsAbove) * k;
  const spread = effect.base * effect.variance * k;
  const min = Math.round(scaled - spread / 2);
  const max = Math.round(scaled + spread / 2);
  return { min, max, average: scaled };
}

/**
 * Efectos de daño de arma: 31 = «X % de daño de arma» (el valor es un porcentaje), 17/58/121 = daño plano que se suma
 * al del arma (121 normalizado). El extractor los deja como `other`, pero los modificadores de daño de los talentos
 * (Oportunidad: +10 % a Puñalada, Emboscada, Mutilar…) les afectan igual que al daño de un hechizo.
 */
export const WEAPON_PERCENT_EFFECT = 31;
export const WEAPON_FLAT_EFFECTS: ReadonlySet<number> = new Set([17, 58, 121]);
export const isWeaponDamageEffect = (e: AbilityEffect): boolean => e.effect === WEAPON_PERCENT_EFFECT || WEAPON_FLAT_EFFECTS.has(e.effect);

/**
 * Golpes con el arma cuyo efecto el cliente deja en «dummy» sin cifra (Puyazo y Cuchillo envenenado rango 1: «infligir daño normal» con el arma de la
 * mano izquierda): se tratan como daño de arma normalizado (efecto 121, 100 %), como el rango 2 de Cuchillo envenenado y Golpe siniestro. Si el rango ya
 * trae efectos de daño de arma, esos.
 */
export function weaponDamageEffects(rank: AbilityRank): AbilityEffect[] {
  const real = rank.effects.filter(isWeaponDamageEffect);
  if (real.length > 0 || rank.effects.some((e) => e.kind === "direct-damage" || e.kind === "periodic-damage")) return real;
  const dummy = rank.effects.find((e) => e.index === 0 && e.effect === 3 && e.kind === "other" && e.base === 0);
  return dummy && /infligir da[ñn]o normal/i.test(rank.description) ? [{ ...dummy, effect: 121 }] : real;
}

/**
 * Ejecutar: el cliente aplica su daño por código del juego y deja un efecto «dummy» con la cifra del texto («causando 600 p. de daño»). Índice del efecto
 * y, si el texto la da, la cifra extra por cada punto de ira sobrante; null si el rango no es de este tipo.
 */
export function dummyDamageOf(rank: AbilityRank): { index: number; perExtraRage: number | null } | null {
  if (rank.schoolMask !== 1) return null;
  if (rank.effects.some((e) => e.kind === "direct-damage" || e.kind === "periodic-damage" || isWeaponDamageEffect(e))) return null;
  const e = rank.effects.find((x) => x.index === 0 && x.effect === 3 && x.kind === "other" && x.base > 0);
  if (!e || !/causando [\d.,]+ p\. de da[ñn]o/i.test(rank.description)) return null;
  const extra = /en ([\d.,]+) p\. de da[ñn]o extra/i.exec(rank.description);
  return { index: e.index, perExtraRage: extra ? Number(extra[1]!.replace(/\./g, "").replace(",", ".")) : null };
}

export const isDamageOrHeal = (e: AbilityEffect): boolean => e.kind !== "other" && e.kind !== "absorb";

export function findAbility(data: Abilities, name: string): Ability | undefined {
  return data.abilities.find((a) => a.name === name);
}
