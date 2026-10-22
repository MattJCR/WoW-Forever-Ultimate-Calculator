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
  /** Valor antes de talentos: atributo base de Classic, o vida/mana con el aporte de aguante/intelecto (sin %) y con el del equipo. */
  base: number;
  /** Puntos planos del equipo, ya sumados a la base antes de aplicar los % de talentos (atributos). 0 sin equipo. */
  gear: number;
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
  /**
   * Poder de ataque por atributo de la clase (ChrClasses, client-db2); sin él no hay filas de poder de ataque.
   * `baseMelee` / `baseRanged`: poder de ataque base de la clase a ese nivel (`baseAttackPower`, `community`); 0 si se omiten.
   */
  attackPower?: { perStrength: number; perAgility: number; rangedPerAgility: number; baseMelee?: number; baseRanged?: number } | null;
  /**
   * Suma de estadisticas del equipo por clave de objeto (`summarizeGear().stats`: strength, stamina, health, mana, attack-power,
   * ranged-attack-power, spell-power, spell-damage, healing-power...). Orden: objetos primero, luego los % de talentos, luego
   * las derivadas (vida por aguante, maná por intelecto, poder de ataque por atributo), como en Classic. `community`/confianza baja.
   */
  gear?: Record<string, number> | null;
}): DerivedStats {
  const { attributes, hpBase, manaBase, totals, attackPower } = input;
  const gear = input.gear ?? {};
  const gearAttr = [gear.strength ?? 0, gear.agility ?? 0, gear.stamina ?? 0, gear.intellect ?? 0, gear.spirit ?? 0];
  // Atributos sin talentos (clase y raza + equipo): lo que vale la base de las filas derivadas
  const plain = attributes.map((v, i) => v + gearAttr[i]!);
  const all = pct(totals, "all-stats", "%");
  const rows: DerivedRow[] = [];
  const finalAttr: Record<string, number> = {};

  ATTRIBUTES.forEach(({ key, label }, i) => {
    const own = pct(totals, key, "%");
    const factor = (1 + own.value / 100) * (1 + all.value / 100);
    const base = attributes[i]!;
    const final = Math.floor((base + gearAttr[i]!) * factor + 1e-9);
    finalAttr[key] = final;
    rows.push({ key, label, base, gear: gearAttr[i]!, bonusPct: Math.round((factor - 1) * 10000) / 100, flat: 0, final, sources: [...own.sources, ...all.sources] });
  });

  const healthPct = pct(totals, "health", "%");
  const healthGear = gear.health ?? 0;
  const healthBase = hpBase + healthFromStamina(finalAttr.sta!) + healthGear;
  rows.push({ key: "health", label: "Vida máxima", base: hpBase + healthFromStamina(plain[2]!) + healthGear, gear: healthGear, bonusPct: healthPct.value, flat: 0, final: Math.floor(healthBase * (1 + healthPct.value / 100) + 1e-9), sources: healthPct.sources });

  if (manaBase > 0) {
    const manaPct = pct(totals, "mana", "%");
    const manaFlat = pct(totals, "mana", "puntos");
    const manaGear = gear.mana ?? 0;
    const manaTotal = manaBase + manaFromIntellect(finalAttr.int!) + manaFlat.value + manaGear;
    rows.push({ key: "mana", label: "Maná máximo", base: manaBase + manaFromIntellect(plain[3]!) + manaGear, gear: manaGear, bonusPct: manaPct.value, flat: manaFlat.value, final: Math.floor(manaTotal * (1 + manaPct.value / 100) + 1e-9), sources: [...manaPct.sources, ...manaFlat.sources] });
  }

  // Poder de ataque por atributo (ChrClasses) y lo que los talentos dan como % de un atributo (Maña mental: 100 % del intelecto),
  // más el poder de ataque base de la clase (`community`: nivel × factor + constante, comprobado a nivel 60) y el del equipo.
  const fromStat = (target: StatTarget): { points: number; sources: StatSource[] } => {
    const lines = totals.filter((t) => t.target === target && t.ofStat);
    return { points: lines.reduce((n, t) => n + (t.value / 100) * (finalAttr[t.ofStat!] ?? 0), 0), sources: lines.flatMap((t) => t.sources) };
  };
  const attrIndex = { str: 0, agi: 1, sta: 2, int: 3, spi: 4 } as const;
  const push = (key: DerivedKey, label: string, base: number, extra: { points: number; sources: StatSource[] }, show: boolean) => {
    if (!show) return;
    rows.push({ key, label, base: Math.floor(base + 1e-9), gear: 0, bonusPct: 0, flat: Math.floor(extra.points + 1e-9), final: Math.floor(base + extra.points + 1e-9), sources: extra.sources });
  };
  if (attackPower) {
    // «Base» = sin talentos pero con el equipo (atributos y puntos de poder de ataque de los objetos)
    const apGear = gear["attack-power"] ?? 0;
    const baseMelee = attackPower.baseMelee ?? 0;
    const baseRanged = attackPower.baseRanged ?? 0;
    const ap = plain[attrIndex.str]! * attackPower.perStrength + plain[attrIndex.agi]! * attackPower.perAgility + apGear + baseMelee;
    const apFinal = finalAttr.str! * attackPower.perStrength + finalAttr.agi! * attackPower.perAgility + apGear + baseMelee;
    const melee = fromStat("attack-power");
    // Los atributos subidos por talentos entran en la base del poder de ataque: se muestra como «base» el valor sin talentos
    rows.push({ key: "ap", label: "Poder de ataque", base: Math.floor(ap + 1e-9), gear: apGear, bonusPct: 0, flat: Math.floor(apFinal - ap + melee.points + 1e-9), final: Math.floor(apFinal + melee.points + 1e-9), sources: melee.sources });
    // Como en Classic (confirmado por el usuario el 22/10/2026): el «poder de ataque» de un objeto suma al cuerpo a cuerpo Y a distancia; el «poder de ataque a distancia» solo a distancia
    const rapGear = (gear["ranged-attack-power"] ?? 0) + apGear;
    const rap = plain[attrIndex.agi]! * attackPower.rangedPerAgility + rapGear + baseRanged;
    const rapFinal = finalAttr.agi! * attackPower.rangedPerAgility + rapGear + baseRanged;
    const ranged = fromStat("ranged-attack-power");
    if (attackPower.rangedPerAgility > 0 || ranged.points > 0 || rapGear > 0 || baseRanged > 0) rows.push({ key: "rap", label: "Poder de ataque a distancia", base: Math.floor(rap + 1e-9), gear: rapGear, bonusPct: 0, flat: Math.floor(rapFinal - rap + ranged.points + 1e-9), final: Math.floor(rapFinal + ranged.points + 1e-9), sources: ranged.sources });
  }
  const sd = fromStat("spell-damage");
  const sh = fromStat("spell-healing");
  // Poder con hechizos del equipo: el generico suma a daño y sanación; «daño» y «sanación» solo a la suya (por escuela, aparte)
  const spellGear = { damage: (gear["spell-power"] ?? 0) + (gear["spell-damage"] ?? 0), healing: (gear["spell-power"] ?? 0) + (gear["healing-power"] ?? 0) };
  push("spell-damage", "Poder con hechizos (daño)", spellGear.damage, sd, sd.points > 0 || spellGear.damage > 0);
  push("spell-healing", "Poder con hechizos (sanación)", spellGear.healing, sh, sh.points > 0 || spellGear.healing > 0);
  return { rows };
}
