import type { AbilityRank, ClassStatLevel, CombatFormulas } from "@wfuc/schema";
import type { AbilityEffectLine } from "./ability-summary.js";
import { canCrit } from "./talent-rules.js";

/** Objetivo contra el que se calcula el impacto: del mismo nivel o un jefe (+3 niveles). */
export type TargetOption = "same" | "boss";

/** Atributos base del personaje a ese nivel (Classic, estimacion): los que dan critico. */
export interface BaseStatValues {
  agi: number;
  int: number;
}

export interface Chances {
  kind: "spell" | "melee";
  hit: {
    /** % de fallo de la tabla de Classic contra el objetivo. */
    missPct: number;
    /** Puntos porcentuales de impacto de tus talentos, Legacy y raza. */
    bonusPct: number;
    /** Puntos porcentuales de impacto de la puntuación del equipo (Forever tiene una sola puntuación de impacto; `community`). */
    gearPct: number;
    cap: number;
    /** Probabilidad de impacto: 100 - fallo + bonos, con tope. */
    total: number;
    capped: boolean;
  };
  crit: {
    /** Puntos porcentuales de critico por tu estadistica (null = no disponible, ver `unavailable`). */
    fromStat: number | null;
    stat: "int" | "agi" | null;
    statValue: number | null;
    statPerPercent: number | null;
    /** Puntos porcentuales de critico de talentos, Legacy y raza para esta habilidad. */
    bonusPct: number;
    /** Puntos porcentuales de crítico de la puntuación del equipo (una sola puntuación de crítico en Forever; `community`). 0 sin equipo o si no puede ser crítica. */
    gearPct: number;
    /** Critico base de la clase (hechizos o fisico segun la habilidad), de la comunidad: hojas de personaje de nivel 60 (`community`). 0 si la clase no tiene o no hay dato. */
    baseClassPct: number;
    /** baseClassPct + fromStat + bonusPct + gearPct: lo que enseña la hoja del personaje. null si no se puede calcular (ver `unavailable`). */
    total: number | null;
    /** Critico que pierde esta habilidad contra el objetivo elegido (0 contra el mismo nivel y en hechizos): 3 % por habilidad de arma + critico de auras hasta 1,8 % contra un jefe (+3 niveles). */
    suppressionPct: number;
    /** total - suppressionPct (nunca negativo): el critico que tiene de verdad contra ese objetivo. null si total es null. */
    vsTargetPct: number | null;
    unavailable: string | null;
  };
}

const sumPoints = (lines: AbilityEffectLine[], category: AbilityEffectLine["category"]): number =>
  lines.filter((l) => l.category === category && (l.unit === "puntos porcentuales" || l.unit === "%")).reduce((n, l) => n + l.value, 0);

/** Porcentajes que dan las puntuaciones de impacto y de crítico del equipo (`ratingPercents`); 0 si no las hay. */
export interface GearChanceBonus {
  hitPct: number;
  critPct: number;
}

/**
 * Probabilidades de impacto y de critico de una habilidad. Mezcla dos orígenes y los separa siempre:
 *  - los bonos de talentos, Legacy y raza, que salen del cliente (`lines`), y el aporte del atributo al critico, que tambien sale del cliente
 *    (`PlayerExpectedStat`: critico por punto de agilidad o de intelecto, para cada clase y nivel; `client-db2`), y
 *  - la tabla de fallo, que es de Classic Era (estimacion de confianza baja: el cliente no trae las tablas de impacto de Forever).
 * El critico base de la clase y la supresion de critico contra un jefe son de la comunidad (`community`, confianza baja; ver `combat-formulas.json`).
 * En Forever no hay 1 % minimo de fallo: el tope de impacto es 100 %.
 */
export function abilityChances(input: {
  rank: AbilityRank;
  classId: number;
  level: number;
  target: TargetOption;
  formulas: CombatFormulas;
  stats: BaseStatValues | null;
  /** Fila del cliente para esta clase y nivel (critico por atributo); null = no disponible. */
  classStats: ClassStatLevel | null;
  lines: AbilityEffectLine[];
  /** Puntuaciones del equipo convertidas a % (impacto y crítico); `stats` debe llevar ya los atributos del equipo. */
  gear?: GearChanceBonus | null;
}): Chances {
  const { rank, target, formulas, stats, classStats, lines } = input;
  const classBase = formulas.classBase.find((c) => c.classId === input.classId) ?? null;
  const gearHit = input.gear?.hitPct ?? 0;
  // Daño fisico = cuerpo a cuerpo / a distancia; el resto, hechizos
  const kind: Chances["kind"] = rank.schoolMask === 1 ? "melee" : "spell";
  const missPct = formulas.miss[kind][target];
  const cap = formulas.hitCap[kind];
  const hitBonus = sumPoints(lines, "Probabilidad de impacto");
  const raw = 100 - missPct + hitBonus + gearHit;
  const hit = { missPct, bonusPct: hitBonus, gearPct: gearHit, cap, total: Math.min(cap, Math.round(raw * 100) / 100), capped: raw > cap };

  const statKey: "int" | "agi" = kind === "spell" ? "int" : "agi";
  const perPoint = classStats ? (kind === "spell" ? classStats.spellCritPerIntellect : classStats.critPerAgility) : 0;
  const bonusPct = sumPoints(lines, "Probabilidad de crítico");
  let unavailable: string | null = null;
  if (!canCrit(rank)) unavailable = "Esta habilidad no hace daño ni sana: no puede ser crítica.";
  else if (!classStats) unavailable = "No hay datos de crítico del cliente para esta clase y nivel.";
  else if (perPoint <= 0) unavailable = `Tu clase no obtiene crítico ${kind === "spell" ? "de hechizo " : ""}del ${statKey === "int" ? "intelecto" : "la agilidad"} (según el cliente).`;
  else if (!stats) unavailable = "Elige una raza para usar tus estadísticas base.";
  const statValue = perPoint > 0 && stats ? stats[statKey] : null;
  const fromStat = !unavailable && statValue !== null ? Math.round(statValue * perPoint * 10000) / 100 : null;
  const gearCrit = canCrit(rank) ? Math.round((input.gear?.critPct ?? 0) * 100) / 100 : 0;
  const baseClassPct = canCrit(rank) && classBase ? (kind === "spell" ? classBase.spellCritPct : classBase.physicalCritPct) : 0;
  const total = fromStat === null ? null : Math.round((baseClassPct + fromStat + bonusPct + gearCrit) * 100) / 100;
  // Supresion de critico: solo fisica y contra un objetivo 3 o mas niveles superior (el cliente no trae la regla; comunidad)
  const suppressionPct =
    target === "boss" && canCrit(rank)
      ? kind === "melee"
        ? Math.round((formulas.critSuppression.meleeBossSkill + Math.min(Math.max(bonusPct + gearCrit, 0), formulas.critSuppression.meleeBossAuraMax)) * 100) / 100
        : formulas.critSuppression.spellBoss
      : 0;
  return {
    kind,
    hit,
    crit: {
      fromStat,
      stat: perPoint > 0 ? statKey : null,
      statValue,
      statPerPercent: perPoint > 0 ? Math.round((1 / (perPoint * 100)) * 10) / 10 : null,
      bonusPct,
      gearPct: gearCrit,
      baseClassPct,
      total,
      suppressionPct,
      vsTargetPct: total === null ? null : Math.max(0, Math.round((total - suppressionPct) * 100) / 100),
      unavailable,
    },
  };
}
