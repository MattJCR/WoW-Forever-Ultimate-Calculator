import type { Race, RacialEffect, RacialSpell } from "@wfuc/schema";

/** Poder de SpellEffect.EffectMiscValue en `max-power-pct`. */
export type PowerKind = "mana" | "rage" | "energy";
const POWER_BY_MISC: Record<number, PowerKind> = { 0: "mana", 1: "rage", 3: "energy" };
const POWER_LABEL: Record<PowerKind, string> = { mana: "maná", rage: "ira", energy: "energía" };

/** Mascara de criatura del cliente (EffectMiscValue en `damage-vs-creature`). */
export const CREATURE_MASKS: Record<number, string> = { 1: "bestias", 8: "elementales" };

/** Un efecto numerico de una racial, ya elegida la variante de la clase. */
export interface RacialContribution {
  racialName: string;
  spellId: number;
  effect: RacialEffect;
}

export interface ActiveRacial {
  name: string;
  spellId: number;
  durationMs: number | null;
  cooldownMs: number | null;
  /** Solo los efectos que el motor sabe interpretar (kind != null). */
  effects: RacialEffect[];
}

/**
 * Bonificaciones de una raza para una clase. Todo sale de los hechizos de las raciales del cliente (`client-db2`):
 * los porcentajes son los puntos base de cada efecto. Solo cuentan las pasivas; las activas se listan aparte con su
 * duracion y enfriamiento. El +5 % de espiritu del Humano ya esta dentro de las estadisticas base de Classic: no hay que
 * sumarlo otra vez a esa tabla (`spiritPct` solo informa).
 */
export interface RaceBonuses {
  critChancePct: number;
  /** Espiritu: ya incluido en la tabla de estadisticas base de Classic. */
  spiritPct: number;
  maxPowerPct: Record<PowerKind, number>;
  healthPct: number;
  critDamageBonusPct: number;
  critHealingBonusPct: number;
  dodgePct: number;
  /** Dano extra contra un tipo de criatura (mascara del cliente). */
  damageVsCreature: { mask: number; label: string; pct: number }[];
  hastePct: { spell: number; melee: number; ranged: number };
  healthRegenPct: number;
  healthRegenInCombatPct: number;
  stunDurationPct: number;
  movementSpeedPct: number;
  mountedSpeedPct: number;
  /** Cada efecto pasivo que ha entrado en el total, para poder explicarlo. */
  passives: RacialContribution[];
  actives: ActiveRacial[];
}

const classBit = (classId: number): number => 1 << (classId - 1);
const appliesTo = (s: RacialSpell, classId: number): boolean => s.classMask === 0 || (s.classMask & classBit(classId)) !== 0;

export function raceBonuses(race: Race, classId: number): RaceBonuses {
  const out: RaceBonuses = {
    critChancePct: 0,
    spiritPct: 0,
    maxPowerPct: { mana: 0, rage: 0, energy: 0 },
    healthPct: 0,
    critDamageBonusPct: 0,
    critHealingBonusPct: 0,
    dodgePct: 0,
    damageVsCreature: [],
    hastePct: { spell: 0, melee: 0, ranged: 0 },
    healthRegenPct: 0,
    healthRegenInCombatPct: 0,
    stunDurationPct: 0,
    movementSpeedPct: 0,
    mountedSpeedPct: 0,
    passives: [],
    actives: [],
  };
  for (const racial of race.racials) {
    for (const spell of racial.spells.filter((s) => appliesTo(s, classId))) {
      if (racial.kind === "active") {
        out.actives.push({
          name: racial.name,
          spellId: spell.spellId,
          durationMs: spell.durationMs,
          cooldownMs: spell.cooldownMs,
          effects: spell.effects.filter((e) => e.kind !== null),
        });
        continue;
      }
      for (const e of spell.effects) {
        // Los efectos que viven en otro hechizo al que remite el texto (p. ej. ser fantasma) son condicionales: no cuentan
        if (!e.kind || e.fromSpellId !== null) continue;
        out.passives.push({ racialName: racial.name, spellId: spell.spellId, effect: e });
        add(out, e);
      }
    }
  }
  return out;
}

function add(out: RaceBonuses, e: RacialEffect): void {
  switch (e.kind) {
    case "crit-chance":
      out.critChancePct += e.value;
      break;
    case "spirit-pct":
      out.spiritPct += e.value;
      break;
    case "max-power-pct": {
      const power = POWER_BY_MISC[e.miscValue ?? 0];
      if (power) out.maxPowerPct[power] += e.value;
      break;
    }
    case "health-pct":
      out.healthPct += e.value;
      break;
    case "crit-damage-bonus":
      out.critDamageBonusPct += e.value;
      break;
    case "crit-healing-bonus":
      out.critHealingBonusPct += e.value;
      break;
    case "dodge-pct":
      out.dodgePct += e.value;
      break;
    case "damage-vs-creature": {
      const mask = e.miscValue ?? 0;
      out.damageVsCreature.push({ mask, label: CREATURE_MASKS[mask] ?? `tipo ${mask}`, pct: e.value });
      break;
    }
    case "haste-spell-pct":
      out.hastePct.spell += e.value;
      break;
    case "haste-melee-pct":
      out.hastePct.melee += e.value;
      break;
    case "haste-ranged-pct":
      out.hastePct.ranged += e.value;
      break;
    case "haste-melee-ranged-pct":
      out.hastePct.melee += e.value;
      out.hastePct.ranged += e.value;
      break;
    case "health-regen-pct":
      out.healthRegenPct += e.value;
      break;
    case "health-regen-combat-pct":
      out.healthRegenInCombatPct += e.value;
      break;
    case "stun-duration-pct":
      out.stunDurationPct += e.value;
      break;
    case "movement-speed-pct":
      out.movementSpeedPct += e.value;
      break;
    case "mounted-speed-pct":
      out.mountedSpeedPct += e.value;
      break;
    default:
      // attack-power-pct, spell-power-pct, damage-taken-pct, spell-modifier-pct: solo aparecen en activas
      break;
  }
}

/** Texto corto de un efecto modelado, para listas: «+2 % probabilidad de crítico». */
export function describeEffect(e: RacialEffect, spell?: Pick<RacialSpell, "durationMs" | "procChance" | "procCooldownMs">): string | null {
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v} %`;
  switch (e.kind) {
    case "crit-chance":
      return `${pct(e.value)} probabilidad de crítico`;
    case "spirit-pct":
      return `${pct(e.value)} espíritu`;
    case "max-power-pct":
      return `${pct(e.value)} ${POWER_LABEL[POWER_BY_MISC[e.miscValue ?? 0] ?? "mana"]} máximo`;
    case "health-pct":
      return `${pct(e.value)} salud máxima`;
    case "crit-damage-bonus":
      return `${pct(e.value)} bonus de daño crítico`;
    case "crit-healing-bonus":
      return `${pct(e.value)} bonus de sanación crítica`;
    case "dodge-pct":
      return `${pct(e.value)} esquivar`;
    case "damage-vs-creature":
      return `${pct(e.value)} daño contra ${CREATURE_MASKS[e.miscValue ?? 0] ?? "ciertas criaturas"}`;
    case "attack-power-pct":
      return `${pct(e.value)} poder de ataque`;
    case "ranged-attack-power-pct":
      return `${pct(e.value)} poder de ataque a distancia`;
    case "spell-power-pct":
      return `${pct(e.value)} poder con hechizos`;
    case "haste-spell-pct":
      return `${pct(e.value)} celeridad con hechizos`;
    case "haste-melee-pct":
      return `${pct(e.value)} celeridad cuerpo a cuerpo`;
    case "haste-ranged-pct":
      return `${pct(e.value)} celeridad a distancia`;
    case "haste-melee-ranged-pct":
      return `${pct(e.value)} celeridad cuerpo a cuerpo y a distancia`;
    case "health-regen-pct":
      return `${pct(e.value)} regeneración de salud`;
    case "health-regen-combat-pct":
      return `${e.value} % de la regeneración continúa en combate`;
    case "damage-taken-pct":
      return `${pct(e.value)} daño recibido`;
    case "stun-duration-pct":
      return `${pct(e.value)} duración de aturdimientos`;
    case "mana-regen-pct":
      return `${pct(e.value)} regeneración de maná`;
    case "movement-speed-pct":
      return `${pct(e.value)} velocidad de movimiento`;
    case "mounted-speed-pct":
      return `${pct(e.value)} velocidad al montar`;
    case "periodic-health-pct":
    case "periodic-mana-pct": {
      const what = e.kind === "periodic-health-pct" ? "salud" : "maná";
      const ticks = e.periodMs && spell?.durationMs ? Math.round(spell.durationMs / e.periodMs) : null;
      const every = e.periodMs ? ` cada ${e.periodMs / 1000} s` : "";
      return ticks ? `${e.value * ticks} % de la ${what} total (${e.value} %${every})` : `${e.value} % de la ${what} total${every}`;
    }
    case "proc-drain-health-pct":
      return `${spell?.procChance ? `${spell.procChance} % de probabilidad: ` : ""}drena hasta ${e.value} % de tu salud máxima${spell?.procCooldownMs ? ` (enfriamiento interno ${spell.procCooldownMs / 1000} s)` : ""}`;
    case "spell-modifier-pct":
      return e.miscValue === 14 ? `${pct(e.value)} coste` : e.miscValue === 22 ? `${pct(e.value)} daño periódico` : `${pct(e.value)} daño`;
    default:
      return null;
  }
}
