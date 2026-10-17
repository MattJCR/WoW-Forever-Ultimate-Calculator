import type { StatSource, StatTarget, StatTotal } from "./stat-effects.js";

/**
 * Estadisticas brutas con los porcentajes de talentos, Legacy y raza ya aplicados.
 *
 * Origen mezclado y separado siempre: los % salen del cliente (`StatTotal`), pero la vida por aguante y el mana por
 * intelecto son las de Classic Era 1.12 (`community`, confianza baja): el cliente de Forever solo trae `HpPerSta`
 * (retail, 10 plano) y no sabemos si Forever lo cambia. Las estadisticas base tambien son de Classic.
 */
export type DerivedKey = "str" | "agi" | "sta" | "int" | "spi" | "health" | "mana" | "ap" | "rap" | "spell-damage" | "spell-healing";

export interface DerivedRow {
  key: DerivedKey;
  label: string;
  /** Valor antes de talentos: atributo base de Classic, o vida/mana con el aporte de aguante/intelecto (sin %). */
  base: number;
  /** % acumulado de talentos, Legacy y raza (el de «todos los atributos» ya va multiplicado dentro). */
  bonusPct: number;
  /** Puntos planos de talentos (p. ej. maná máximo). */
  flat: number;
  /** Resultado, redondeado hacia abajo como hace el juego. */
  final: number;
  sources: StatSource[];
}

export interface DerivedStats {
  rows: DerivedRow[];
}

const ATTRIBUTES: { key: Extract<DerivedKey, "str" | "agi" | "sta" | "int" | "spi">; label: string }[] = [
  { key: "str", label: "Fuerza" },
  { key: "agi", label: "Agilidad" },
  { key: "sta", label: "Aguante" },
  { key: "int", label: "Intelecto" },
  { key: "spi", label: "Espíritu" },
];

/** Classic: los primeros 20 puntos de aguante dan 1 de vida cada uno y el resto 10. */
export const healthFromStamina = (sta: number): number => Math.min(20, sta) + Math.max(0, sta - 20) * 10;
/** Classic: los primeros 20 puntos de intelecto dan 1 de maná cada uno y el resto 15. */
export const manaFromIntellect = (int: number): number => Math.min(20, int) + Math.max(0, int - 20) * 15;

const pct = (totals: StatTotal[], target: StatTarget, unit: StatTotal["unit"]): { value: number; sources: StatSource[] } => {
  const hit = totals.filter((t) => t.target === target && t.unit === unit);
  return { value: hit.reduce((n, t) => n + t.value, 0), sources: hit.flatMap((t) => t.sources) };
};

/**
 * Aplica los efectos sumados a las estadisticas base de un nivel. Los % se multiplican (en el juego cada aura de
 * porcentaje multiplica) pero cada linea ya viene sumada con las del mismo alcance, asi que dos talentos que dan el
 * mismo atributo se suman entre si. La vida y el mana (aguante e intelecto ya con su %) llevan su propio %.
 * `manaBase` = 0 (clases sin maná: Guerrero, Pícaro) omite la fila de maná.
 */
export function deriveStats(input: {
  attributes: [number, number, number, number, number];
  hpBase: number;
  manaBase: number;
  totals: StatTotal[];
  /** Poder de ataque por atributo de la clase (ChrClasses, client-db2); sin él no hay filas de poder de ataque. */
  attackPower?: { perStrength: number; perAgility: number; rangedPerAgility: number } | null;
}): DerivedStats {
  const { attributes, hpBase, manaBase, totals, attackPower } = input;
  const all = pct(totals, "all-stats", "%");
  const rows: DerivedRow[] = [];
  const finalAttr: Record<string, number> = {};

  ATTRIBUTES.forEach(({ key, label }, i) => {
    const own = pct(totals, key, "%");
    const factor = (1 + own.value / 100) * (1 + all.value / 100);
    const base = attributes[i]!;
    const final = Math.floor(base * factor + 1e-9);
    finalAttr[key] = final;
    rows.push({ key, label, base, bonusPct: Math.round((factor - 1) * 10000) / 100, flat: 0, final, sources: [...own.sources, ...all.sources] });
  });

  const healthPct = pct(totals, "health", "%");
  const healthBase = hpBase + healthFromStamina(finalAttr.sta!);
  rows.push({ key: "health", label: "Vida máxima", base: hpBase + healthFromStamina(attributes[2]), bonusPct: healthPct.value, flat: 0, final: Math.floor(healthBase * (1 + healthPct.value / 100) + 1e-9), sources: healthPct.sources });

  if (manaBase > 0) {
    const manaPct = pct(totals, "mana", "%");
    const manaFlat = pct(totals, "mana", "puntos");
    const manaTotal = manaBase + manaFromIntellect(finalAttr.int!) + manaFlat.value;
    rows.push({ key: "mana", label: "Maná máximo", base: manaBase + manaFromIntellect(attributes[3]), bonusPct: manaPct.value, flat: manaFlat.value, final: Math.floor(manaTotal * (1 + manaPct.value / 100) + 1e-9), sources: [...manaPct.sources, ...manaFlat.sources] });
  }

  // Poder de ataque por atributo (ChrClasses) y lo que los talentos dan como % de un atributo (Maña mental: 100 % del intelecto).
  // No incluye el poder de ataque base por nivel ni el del equipo (el cliente no los trae).
  const fromStat = (target: StatTarget): { points: number; sources: StatSource[] } => {
    const lines = totals.filter((t) => t.target === target && t.ofStat);
    return { points: lines.reduce((n, t) => n + (t.value / 100) * (finalAttr[t.ofStat!] ?? 0), 0), sources: lines.flatMap((t) => t.sources) };
  };
  const attrIndex = { str: 0, agi: 1, sta: 2, int: 3, spi: 4 } as const;
  const push = (key: DerivedKey, label: string, base: number, extra: { points: number; sources: StatSource[] }, show: boolean) => {
    if (!show) return;
    rows.push({ key, label, base: Math.floor(base + 1e-9), bonusPct: 0, flat: Math.floor(extra.points + 1e-9), final: Math.floor(base + extra.points + 1e-9), sources: extra.sources });
  };
  if (attackPower) {
    const ap = attributes[attrIndex.str] * attackPower.perStrength + attributes[attrIndex.agi] * attackPower.perAgility;
    const apFinal = finalAttr.str! * attackPower.perStrength + finalAttr.agi! * attackPower.perAgility;
    const melee = fromStat("attack-power");
    // Los atributos subidos por talentos entran en la base del poder de ataque: se muestra como «base» el valor sin talentos
    rows.push({ key: "ap", label: "Poder de ataque (de atributos)", base: Math.floor(ap + 1e-9), bonusPct: 0, flat: Math.floor(apFinal - ap + melee.points + 1e-9), final: Math.floor(apFinal + melee.points + 1e-9), sources: melee.sources });
    const rap = attributes[attrIndex.agi] * attackPower.rangedPerAgility;
    const rapFinal = finalAttr.agi! * attackPower.rangedPerAgility;
    const ranged = fromStat("ranged-attack-power");
    if (attackPower.rangedPerAgility > 0 || ranged.points > 0) rows.push({ key: "rap", label: "Poder de ataque a distancia (de atributos)", base: Math.floor(rap + 1e-9), bonusPct: 0, flat: Math.floor(rapFinal - rap + ranged.points + 1e-9), final: Math.floor(rapFinal + ranged.points + 1e-9), sources: ranged.sources });
  }
  const sd = fromStat("spell-damage");
  const sh = fromStat("spell-healing");
  push("spell-damage", "Poder con hechizos de tus talentos (daño)", 0, sd, sd.points > 0);
  push("spell-healing", "Poder con hechizos de tus talentos (sanación)", 0, sh, sh.points > 0);
  return { rows };
}
