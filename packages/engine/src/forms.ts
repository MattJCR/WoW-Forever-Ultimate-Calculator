import type { Abilities, AbilityRank, CombatFormulas } from "@wfuc/schema";
import { effectAt, rankAtLevel, weaponDamageEffects } from "./abilities.js";
import type { PowerContext } from "./power-bonus.js";

/**
 * Formas del druida. Bajo forma felina o de oso no se golpea con el arma equipada: el golpe usa solo el poder de ataque de la forma (fuerza, agilidad,
 * y los puntos de la propia forma, que son del cliente y ya traen el término del nivel: felina 2 × nivel, oso 3 × nivel) y una velocidad fija (1 s el gato, 2,5 s el oso). **Estimación**: la fórmula del
 * poder de ataque de la forma y la velocidad son las de Classic (`assumption`, confianza baja); el cliente no las trae. No se cuenta el «+N de poder de
 * ataque solo bajo formas» de algunos objetos (efecto de objeto en texto).
 */

export type FormKey = "cat" | "bear";

export const FORM_LABEL: Record<FormKey, string> = { cat: "Forma felina", bear: "Forma de oso" };

const DRUID = 11;
const AURA_ATTACK_POWER = 99;

/** Forma en la que se lanza una habilidad de daño de arma del druida: las de energía son del gato y las de ira, del oso. */
export function formOfRank(rank: AbilityRank, classId: number): FormKey | null {
  if (classId !== DRUID || weaponDamageEffects(rank).length === 0) return null;
  return rank.costType === "energy" ? "cat" : rank.costType === "rage" ? "bear" : null;
}

/** Puntos de poder de ataque que da la propia forma (aura 99 de su hechizo, `client-db2`): felina 2 × nivel, oso 3 × nivel (el oso nefasto desde el 40); 0 si aún no se aprende. */
export function formFlatAttackPower(abilities: Abilities, form: FormKey, level: number): number {
  const names = form === "cat" ? ["Forma felina"] : ["Forma de oso nefasto", "Forma de oso"];
  for (const name of names) {
    const ability = abilities.abilities.find((a) => a.name === name);
    const rank = ability ? rankAtLevel(ability, level) : undefined;
    if (!rank) continue;
    const e = rank.effects.find((x) => x.aura === AURA_ATTACK_POWER);
    if (e) return effectAt(e, rank, level).average;
  }
  return 0;
}

/** Contexto de poder bajo una forma: el golpe sin arma (0–0) a la velocidad de la forma y con el poder de ataque de la forma; sin mano izquierda ni distancia. */
export function formPowerContext(
  base: PowerContext,
  input: { form: FormKey; forms: NonNullable<CombatFormulas["forms"]>; level: number; strength: number; agility: number; gearAttackPower: number; formFlatAttackPower: number },
): PowerContext {
  const f = input.forms[input.form];
  const ap = f.attackPower.perLevel * input.level + f.attackPower.perStrength * input.strength + f.attackPower.perAgility * input.agility + f.attackPower.flat + input.gearAttackPower + input.formFlatAttackPower;
  const weapon = { min: 0, max: 0, speed: f.weaponSpeed, normalizedSpeed: f.weaponSpeed, usesAttackPower: true, name: `${FORM_LABEL[input.form]} (sin arma)` };
  return { ...base, attackPower: Math.max(0, Math.floor(ap)), mainHand: weapon, offHand: null, ranged: null, physicalDamage: 0 };
}
