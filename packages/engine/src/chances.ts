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
    /** fromStat + bonusPct; NO incluye el critico base de la clase (el cliente no lo trae y las fuentes se contradicen). */
    total: number | null;
    unavailable: string | null;
  };
}

const sumPoints = (lines: AbilityEffectLine[], category: AbilityEffectLine["category"]): number =>
  lines.filter((l) => l.category === category && (l.unit === "puntos porcentuales" || l.unit === "%")).reduce((n, l) => n + l.value, 0);

/**
 * Probabilidades de impacto y de critico de una habilidad. Mezcla dos orígenes y los separa siempre:
 *  - los bonos de talentos, Legacy y raza, que salen del cliente (`lines`), y el aporte del atributo al critico, que tambien sale del cliente
 *    (`PlayerExpectedStat`: critico por punto de agilidad o de intelecto, para cada clase y nivel; `client-db2`), y
 *  - la tabla de fallo, que es de Classic Era (estimacion de confianza baja: el cliente no trae las tablas de impacto de Forever).
 * No incluye el critico base de la clase (el cliente no lo trae; ForeverDB y Warcraft Tavern tampoco lo dan).
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
}): Chances {
  const { rank, target, formulas, stats, classStats, lines } = input;
  // Daño fisico = cuerpo a cuerpo / a distancia; el resto, hechizos
  const kind: Chances["kind"] = rank.schoolMask === 1 ? "melee" : "spell";
  const missPct = formulas.miss[kind][target];
  const cap = formulas.hitCap[kind];
  const hitBonus = sumPoints(lines, "Probabilidad de impacto");
  const raw = 100 - missPct + hitBonus;
  const hit = { missPct, bonusPct: hitBonus, cap, total: Math.min(cap, Math.round(raw * 100) / 100), capped: raw > cap };

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
  return {
    kind,
    hit,
    crit: {
      fromStat,
      stat: perPoint > 0 ? statKey : null,
      statValue,
      statPerPercent: perPoint > 0 ? Math.round((1 / (perPoint * 100)) * 10) / 10 : null,
      bonusPct,
      total: fromStat === null ? null : Math.round((fromStat + bonusPct) * 100) / 100,
      unavailable,
    },
  };
}
