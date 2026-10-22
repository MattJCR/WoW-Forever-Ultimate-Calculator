import type { ClassStatLevel, CombatFormulas, CombatRatings } from "@wfuc/schema";
import { classBaseOf, dodgePerAgility, spiritManaPer5s } from "./class-base.js";
import type { DerivedStats } from "./derived-stats.js";
import { ratingPercents } from "./gear.js";
import { attackPowerVsKey, CREATURE_TYPES, PENETRATION_SCHOOLS, PROFESSION_SKILLS, spellDamageVsKey, WEAPON_SKILLS } from "./item-stat-keys.js";
import type { SwingEstimate } from "./power-bonus.js";
import type { ProcEstimate } from "./procs.js";
import type { StatSource, StatTotal } from "./stat-effects.js";

/**
 * Estadisticas de combate del personaje con TODO sumado: equipo (piezas, sufijo, encantamiento, conjuntos y efectos al equipar),
 * talentos, Puntos de Legado y raza. Complementa a `deriveStats` (atributos, vida, maná, poder): armadura, critico, impacto,
 * celeridad, defensa, regeneracion, resistencias y el resto de bonos que valen para todo el personaje.
 *
 * Procedencia mezclada y separada siempre en `parts`: las cifras de talentos, Legacy y raza son del cliente (`client-db2`); el critico
 * por atributo tambien (`PlayerExpectedStat`); la conversion puntuacion → % es de la comunidad (`community`, 10 / 14 / 10 por 1 %, constante
 * por nivel); lo que Forever no trae en el cliente (critico base y esquive base de la clase, armadura por agilidad, regeneracion por espiritu)
 * sale de la comunidad (`community`, hojas de personaje y tooltips del juego; `combat-formulas.json`) y cada fila lo dice en `parts` y `note`.
 */

export type CombatGroup = "Ataque" | "Armas" | "Habilidades" | "Defensa" | "Poder" | "Contra criaturas" | "Recursos" | "Resistencias" | "Otros bonos";

export interface CombatPart {
  label: string;
  value: number;
}

export interface CombatRow {
  key: string;
  group: CombatGroup;
  label: string;
  value: number;
  unit: "%" | "pts" | "";
  /** De donde sale la cifra, por origen. */
  parts: CombatPart[];
  /** Lo que la cifra NO incluye (o su confianza). */
  note?: string;
  sources: StatSource[];
}

export interface CombatStats {
  rows: CombatRow[];
  /** Celeridad total (%) por tipo de ataque: puntuacion del equipo + talentos, Legacy y raza. */
  haste: { spell: number; melee: number; ranged: number };
}

/** Equipo que se suma (lo que `summarizeGear` devuelve y la conversion de puntuaciones). */
export interface CombatGearInput {
  /** `summarizeGear().stats`. */
  stats: Record<string, number>;
  /** Armadura base de las piezas (`summarizeGear().armor`). */
  armor: number;
  /** Parte de `armor` que es armadura extra de piezas verdes (no recibe el % de los talentos). */
  bonusArmor?: number;
  ratings: Pick<CombatRatings, "ratings"> | null;
}

const NOTE_BASE_CRIT = "Incluye el crítico base de la clase (comunidad, hojas de personaje de nivel 60): el cliente no lo trae.";
const NOTE_DEFENSE = "No incluye el 5 % base de la tabla de ataque ni la habilidad de defensa base (no están en el cliente).";
const NOTE_WEAPON_SKILL = "Puntos de habilidad con ese tipo de arma que da el equipo (cliente). El cliente no trae su efecto en la tabla de ataque, así que no se suman al impacto ni al crítico.";
const NOTE_VS_CREATURE = "Solo vale contra ese tipo de criatura: no entra en el total de arriba. Elige el tipo en «Tipo de criatura» de la lista de habilidades para sumarlo a su daño.";
const round2 = (n: number): number => Math.round(n * 100) / 100;

const PP ="puntos porcentuales";
const isPct = (t: StatTotal): boolean => t.unit === PP || t.unit === "%";
const sum = (lines: StatTotal[]): number => round2(lines.reduce((n, l) => n + l.value, 0));
const sourcesOf = (lines: StatTotal[]): StatSource[] => lines.flatMap((l) => l.sources);

/** Resistencia y poder por escuela del equipo: clave de objeto -> nombre. */
const RESISTANCES: [string, string][] = [
  ["holy-resistance", "Sagrado"],
  ["fire-resistance", "Fuego"],
  ["nature-resistance", "Naturaleza"],
  ["frost-resistance", "Escarcha"],
  ["shadow-resistance", "Sombras"],
  ["arcane-resistance", "Arcano"],
];
const SCHOOL_POWERS: [string, string][] = [
  ["holy-power", "Sagrado"],
  ["fire-power", "Fuego"],
  ["nature-power", "Naturaleza"],
  ["frost-power", "Escarcha"],
  ["shadow-power", "Sombras"],
  ["arcane-power", "Arcano"],
];

/**
 * Cifras de talentos, Legacy, raza y equipo que valen para todo el personaje y que NO son un atributo ni una estadistica ya calculada
 * en `deriveStats`, pero que no tienen fila propia: se listan tal cual en «Otros bonos» para que nada se pierda. Son auras que no dependen
 * de una habilidad (el alcance en `scope` es de escuela o tipo de criatura, no de habilidades).
 */
const CHARACTER_WIDE_LABELS = new Set([
  "daño infligido",
  "daño recibido",
  "amenaza generada",
  "armadura del objetivo ignorada",
  "daño del arma de la mano izquierda",
]);

/**
 * `totals` debe haberse calculado con el libro de hechizos de la clase cargado: sin el, las cifras que afectan a habilidades concretas
 * salen sin alcance (`scope: null`) y se confundirian con las del personaje entero.
 */
export function deriveCombatStats(input: {
  derived: DerivedStats;
  totals: StatTotal[];
  gear?: CombatGearInput | null;
  /** Critico por atributo del cliente (clase y nivel); null = sin datos. */
  classStats: ClassStatLevel | null;
  /** Reglas de la comunidad (critico y esquive base de la clase, armadura por agilidad, regeneracion por espiritu); sin ellas esas filas no se calculan. */
  rules?: { formulas: CombatFormulas; classId: number } | null;
  /** Golpes automáticos de las armas llevadas (`autoAttacks`): salen como filas de «Armas». */
  swings?: SwingEstimate[];
  /** Procs de daño del equipo (`estimateProcs`): salen como filas de «Armas». */
  procs?: ProcEstimate[];
}): CombatStats {
  const { derived, totals, classStats } = input;
  const classBase = input.rules ? classBaseOf(input.rules.formulas, input.rules.classId) : null;
  const gear = input.gear ?? null;
  const gearStats = gear?.stats ?? {};
  const ratings = gear?.ratings ? ratingPercents(gearStats, gear.ratings) : [];
  const rating = (stat: string): number => ratings.find((r) => r.stat === stat)?.value ?? 0;
  const final = (key: string): number => derived.rows.find((r) => r.key === key)?.final ?? 0;
  const used = new Set<StatTotal>();
  const take = (pred: (t: StatTotal) => boolean): StatTotal[] => {
    const found = totals.filter((t) => !used.has(t) && pred(t));
    for (const t of found) used.add(t);
    return found;
  };
  const rows: CombatRow[] = [];
  const add = (row: Omit<CombatRow, "sources"> & { sources?: StatSource[] }) => rows.push({ ...row, sources: row.sources ?? [] });
  const part = (label: string, value: number): CombatPart[] => (value !== 0 ? [{ label, value: round2(value) }] : []);

  // --- Ataque -----------------------------------------------------------------------------------------------------
  const critAll = take((t) => t.category === "Probabilidad de crítico" && t.label === "probabilidad de crítico" && t.scope === null && isPct(t));
  const critMelee = take((t) => t.category === "Probabilidad de crítico" && t.label === "probabilidad de crítico cuerpo a cuerpo" && isPct(t));
  const critSpellOnly = take((t) => t.category === "Probabilidad de crítico" && t.label === "probabilidad de crítico con hechizos" && isPct(t));
  const critGear = rating("crit-rating");
  const common = [...part("talentos, Legacy y raza", sum(critAll)), ...part("puntuación de tu equipo", critGear)];
  const baseCritPhysical = classBase?.physicalCritPct ?? 0;
  const baseCritSpell = classBase?.spellCritPct ?? 0;
  const agiCrit = classStats && classStats.critPerAgility > 0 ? round2(final("agi") * classStats.critPerAgility * 100) : 0;
  const intCrit = classStats && classStats.spellCritPerIntellect > 0 ? round2(final("int") * classStats.spellCritPerIntellect * 100) : 0;
  if ((classStats && classStats.critPerAgility > 0) || sum(critMelee) !== 0) {
    const parts = [...part("base de la clase", baseCritPhysical), ...part(`agilidad (${final("agi")})`, agiCrit), ...part("crítico cuerpo a cuerpo de talentos y raza", sum(critMelee)), ...common];
    add({ key: "crit-melee", group: "Ataque", label: "Crítico (cuerpo a cuerpo y a distancia)", value: round2(parts.reduce((n, p) => n + p.value, 0)), unit: "%", parts, note: NOTE_BASE_CRIT, sources: [...sourcesOf(critAll), ...sourcesOf(critMelee)] });
  }
  if ((classStats && classStats.spellCritPerIntellect > 0) || sum(critSpellOnly) !== 0) {
    const parts = [...part("base de la clase", baseCritSpell), ...part(`intelecto (${final("int")})`, intCrit), ...part("crítico con hechizos de talentos, equipo y raza", sum(critSpellOnly)), ...common];
    add({ key: "crit-spell", group: "Ataque", label: "Crítico con hechizos", value: round2(parts.reduce((n, p) => n + p.value, 0)), unit: "%", parts, note: NOTE_BASE_CRIT, sources: [...sourcesOf(critAll), ...sourcesOf(critSpellOnly)] });
  }
  // Sin atributo que de critico (Guerrero o Mago sin la otra via) pero con bonos: se enseñan igual para no perderlos
  if (!rows.some((r) => r.key.startsWith("crit-")) && (sum(critAll) !== 0 || critGear !== 0)) {
    add({ key: "crit-other", group: "Ataque", label: "Crítico", value: round2(sum(critAll) + critGear), unit: "%", parts: common, note: NOTE_BASE_CRIT, sources: sourcesOf(critAll) });
  }

  const hitLines = take((t) => t.category === "Probabilidad de impacto" && t.label === "probabilidad de impacto" && t.scope === null && isPct(t));
  const hitGear = rating("hit-rating");
  if (sum(hitLines) !== 0 || hitGear !== 0) {
    const parts = [...part("talentos, Legacy y raza", sum(hitLines)), ...part("puntuación de tu equipo", hitGear)];
    add({ key: "hit", group: "Ataque", label: "Impacto (bonificación)", value: round2(sum(hitLines) + hitGear), unit: "%", parts, note: "Se suma a 100 % menos el fallo de la tabla contra el objetivo (cada habilidad lo calcula con su tipo de ataque).", sources: sourcesOf(hitLines) });
  }
  const evadeLines = take((t) => t.category === "Probabilidad de impacto" && t.label === "probabilidad de que el enemigo esquive o pare tus ataques");
  if (evadeLines.length > 0) add({ key: "enemy-evade", group: "Ataque", label: "Esquive y parada del enemigo contra ti", value: sum(evadeLines), unit: "%", parts: part("talentos, Legacy y raza", sum(evadeLines)), sources: sourcesOf(evadeLines) });

  // Celeridad: una sola puntuacion en Forever para hechizos, cuerpo a cuerpo y a distancia
  const hasteGear = rating("haste-rating");
  const hasteAll = take((t) => t.category === "Celeridad" && t.label === "celeridad de ataque y de lanzamiento");
  const hasteSpell = [...take((t) => t.category === "Celeridad" && t.label === "celeridad con hechizos"), ...hasteAll];
  const hasteMelee = [...take((t) => t.category === "Celeridad" && (t.label === "celeridad cuerpo a cuerpo" || t.label === "celeridad cuerpo a cuerpo y a distancia")), ...hasteAll];
  const hasteRanged = take((t) => t.category === "Celeridad" && t.label === "celeridad a distancia");
  const hasteBoth = [...hasteMelee.filter((t) => t.label === "celeridad cuerpo a cuerpo y a distancia"), ...hasteAll];
  const haste = {
    spell: round2(hasteGear + sum(hasteSpell)),
    melee: round2(hasteGear + sum(hasteMelee)),
    ranged: round2(hasteGear + sum(hasteRanged) + sum(hasteBoth)),
  };
  const hasteRow = (key: string, label: string, lines: StatTotal[], value: number) => {
    if (value === 0) return;
    add({ key, group: "Ataque", label, value, unit: "%", parts: [...part("talentos, Legacy y raza", sum(lines)), ...part("puntuación de tu equipo", hasteGear)], note: "Reduce el tiempo de lanzamiento y la velocidad de ataque (estimación: la puntuación por 1 % es de la comunidad).", sources: sourcesOf(lines) });
  };
  hasteRow("haste-spell", "Celeridad con hechizos", hasteSpell, haste.spell);
  hasteRow("haste-melee", "Celeridad cuerpo a cuerpo", hasteMelee, haste.melee);
  hasteRow("haste-ranged", "Celeridad a distancia", [...hasteRanged, ...hasteBoth], haste.ranged);

  const expertise = rating("expertise-rating");
  if (expertise !== 0) add({ key: "expertise", group: "Ataque", label: "Pericia", value: round2(expertise), unit: "pts", parts: part("puntuación de tu equipo", expertise) });
  const penetration = gearStats["spell-penetration"] ?? 0;
  if (penetration !== 0) add({ key: "spell-pen", group: "Ataque", label: "Penetración de hechizos", value: penetration, unit: "pts", parts: part("tu equipo", penetration) });
  const armorIgnored = take((t) => t.label === "armadura del objetivo ignorada");
  if (armorIgnored.length > 0) add({ key: "armor-ignored", group: "Ataque", label: "Armadura del objetivo ignorada", value: sum(armorIgnored), unit: "%", parts: part("talentos, Legacy y raza", sum(armorIgnored)), sources: sourcesOf(armorIgnored) });

  // --- Armas: golpes automáticos (daño por segundo con la celeridad) ---------------------------------------------------
  const swingName = { main: "la mano derecha", off: "la mano izquierda", ranged: "el arma a distancia" } as const;
  for (const sw of input.swings ?? []) {
    add({
      key: `swing-${sw.hand}`,
      group: "Armas",
      label: `Daño por segundo con ${swingName[sw.hand]}`,
      value: round2(sw.dps),
      unit: "",
      parts: [],
      note: `Golpe de ${Math.round(sw.min)}–${Math.round(sw.max)} cada ${round2(sw.hastedSpeed)} s (${sw.formula}). Estimación con las reglas de Classic: sin críticos ni fallos.`,
    });
  }
  for (const p of input.procs ?? []) {
    add({
      key: `proc-${p.source.spellId}`,
      group: "Armas",
      label: `Proc de ${p.source.name}: daño por segundo`,
      value: round2(p.dps),
      unit: "",
      parts: [],
      note: `${p.source.origin}: ${Math.round(p.damagePerProc)} de daño por proc, ${round2(p.perSecond)} procs por segundo (${p.basis}${p.capped ? ", limitado por el enfriamiento interno" : ""}). Estimación: sin críticos, resistencias ni mitigación; ${p.source.proc.source === "community" ? "los procs por minuto de los objetos antiguos son de la comunidad (el cliente no los trae)." : "tasa y daño del cliente."}`,
    });
  }
  if (input.rules && (input.swings ?? []).some((x) => x.hand === "main") && (input.swings ?? []).some((x) => x.hand === "off")) {
    add({
      key: "dual-wield-miss",
      group: "Ataque",
      label: "Fallo extra de los golpes automáticos con dos armas",
      value: input.rules.formulas.dualWieldMissPenalty,
      unit: "%",
      parts: [],
      note: "Se suma al fallo de la tabla en los ataques automáticos de las dos manos (comunidad); los golpes especiales no lo tienen.",
    });
  }

  // --- Defensa ----------------------------------------------------------------------------------------------------
  const armorPct = take((t) => t.label === "armadura de tus objetos");
  const pieces = gear?.armor ?? 0;
  const extra = gearStats["extra-armor"] ?? 0;
  const noMods = gearStats["armor-no-mods"] ?? 0;
  const agiArmor = input.rules ? Math.floor(final("agi") * input.rules.formulas.armorPerAgility) : 0;
  if (pieces + extra + noMods + agiArmor > 0) {
    const bonus = Math.min(gear?.bonusArmor ?? 0, pieces);
    const fromPieces = (pieces - bonus) * (1 + sum(armorPct) / 100) + bonus;
    const parts = [...part("piezas", pieces), ...part(`+${sum(armorPct)} % de talentos a la armadura de las piezas`, round2(fromPieces - pieces)), ...part("armadura extra de objetos y encantamientos", extra), ...part("armadura sin modificadores", noMods), ...part(`agilidad (${final("agi")} × ${input.rules?.formulas.armorPerAgility ?? 0})`, agiArmor)];
    add({ key: "armor", group: "Defensa", label: "Armadura", value: Math.round(fromPieces + extra + noMods + agiArmor), unit: "pts", parts, note: input.rules ? "Incluye la armadura por agilidad (comunidad, `community`)." : "No incluye la armadura por agilidad (no está en el cliente).", sources: sourcesOf(armorPct) });
  } else if (armorPct.length > 0) {
    add({ key: "armor-pct", group: "Defensa", label: "Armadura de tus objetos", value: sum(armorPct), unit: "%", parts: part("talentos, Legacy y raza", sum(armorPct)), sources: sourcesOf(armorPct) });
  }
  const defSkill = take((t) => t.label === "habilidad en defensa");
  const defGear = rating("defense");
  if (sum(defSkill) + defGear !== 0) add({ key: "defense", group: "Defensa", label: "Habilidad de defensa", value: round2(sum(defSkill) + defGear), unit: "pts", parts: [...part("talentos, Legacy y raza", sum(defSkill)), ...part("tu equipo", defGear)], note: NOTE_DEFENSE, sources: sourcesOf(defSkill) });
  const avoid = (key: string, label: string, statLabel: string, stat: string) => {
    const lines = take((t) => t.category === "Defensa" && t.label === statLabel);
    const fromGear = rating(stat);
    if (sum(lines) + fromGear === 0) return;
    add({ key, group: "Defensa", label, value: round2(sum(lines) + fromGear), unit: "%", parts: [...part("talentos, Legacy y raza", sum(lines)), ...part("puntuación de tu equipo", fromGear)], note: NOTE_DEFENSE, sources: sourcesOf(lines) });
  };
  // Esquivar: base de la clase + agilidad (misma cifra que el crítico por agilidad del cliente; el doble en pícaro y cazador) + talentos + puntuación del equipo
  if (classBase) {
    const lines = take((t) => t.category === "Defensa" && t.label === "probabilidad de esquivar");
    const fromGear = rating("dodge-rating");
    const perAgi = dodgePerAgility(classBase, classStats);
    const fromAgi = round2(final("agi") * perAgi);
    const parts = [...part("base de la clase", classBase.dodgePct), ...part(`agilidad (${final("agi")})`, fromAgi), ...part("talentos, Legacy y raza", sum(lines)), ...part("puntuación de tu equipo", fromGear)];
    add({ key: "dodge", group: "Defensa", label: "Esquivar", value: round2(parts.reduce((n, p) => n + p.value, 0)), unit: "%", parts, note: "Esquive base de la clase (comunidad, hojas de nivel 60) y de la agilidad (misma cifra que el crítico por agilidad del cliente; el doble en pícaro y cazador). No incluye la habilidad de defensa base.", sources: sourcesOf(lines) });
  } else {
    avoid("dodge", "Esquivar", "probabilidad de esquivar", "dodge-rating");
  }
  avoid("parry", "Parar", "probabilidad de parar", "parry-rating");
  avoid("block", "Bloquear", "probabilidad de bloquear", "block-rating");
  if ((gearStats["block-value"] ?? 0) !== 0) add({ key: "block-value", group: "Defensa", label: "Valor de bloqueo", value: gearStats["block-value"]!, unit: "pts", parts: part("tu equipo", gearStats["block-value"]!) });
  // El resto de la categoria Defensa (duracion de controles, daño recibido, ser alcanzado a distancia...) va tal cual
  for (const t of take((x) => x.category === "Defensa" && x.scope === null)) {
    add({ key: `def:${t.label}`, group: "Defensa", label: t.label.charAt(0).toUpperCase() + t.label.slice(1), value: t.value, unit: isPct(t) ? "%" : "pts", parts: part("talentos, Legacy y raza", t.value), sources: t.sources });
  }

  // --- Poder por escuela del equipo -------------------------------------------------------------------------------
  for (const [key, name] of SCHOOL_POWERS) {
    const v = gearStats[key] ?? 0;
    if (v !== 0) add({ key, group: "Poder", label: `Poder con hechizos de ${name} (equipo)`, value: v, unit: "pts", parts: part("tu equipo", v), note: "Se suma al poder con hechizos solo en los hechizos de esa escuela." });
  }

  const physical = gearStats["physical-damage"] ?? 0;
  if (physical !== 0) add({ key: "physical-damage", group: "Poder", label: "Daño físico (equipo)", value: physical, unit: "pts", parts: part("tu equipo", physical), note: "«+N de daño»: se suma a cada golpe de arma, de las dos manos (golpes automáticos y habilidades de daño de arma; no a los sangrados ni a los hechizos)." });

  // --- Recursos ---------------------------------------------------------------------------------------------------
  if (input.rules && derived.rows.some((r) => r.key === "mana")) {
    const spi = final("spi");
    add({ key: "spirit-regen", group: "Recursos", label: "Maná cada 5 s por espíritu (sin lanzar hechizos)", value: spiritManaPer5s(input.rules.formulas, spi), unit: "pts", parts: [{ label: `espíritu (${spi})`, value: spiritManaPer5s(input.rules.formulas, spi) }], note: "Fórmula de la comunidad medida con el tooltip del juego (igual para todas las clases; `community`, confianza baja). Mientras lanzas hechizos (regla de los 5 segundos) solo cuenta la parte que den talentos y objetos." });
  }
  const mp5 = gearStats["mana-per-5"] ?? 0;
  if (mp5 !== 0) add({ key: "mp5", group: "Recursos", label: "Maná cada 5 s (equipo)", value: mp5, unit: "pts", parts: part("tu equipo", mp5), note: "Se suma a la regeneración por espíritu (también mientras lanzas hechizos)." });
  const hp5 = gearStats["health-regen"] ?? 0;
  if (hp5 !== 0) add({ key: "hp5", group: "Recursos", label: "Vida cada 5 s (equipo)", value: hp5, unit: "pts", parts: part("tu equipo", hp5) });
  for (const t of take((x) => x.category === "Regeneración" && x.scope === null)) {
    add({ key: `regen:${t.label}`, group: "Recursos", label: t.label.charAt(0).toUpperCase() + t.label.slice(1), value: t.value, unit: isPct(t) ? "%" : "pts", parts: part("talentos, Legacy y raza", t.value), sources: t.sources });
  }

  // --- Resistencias -----------------------------------------------------------------------------------------------
  for (const [key, name] of RESISTANCES) {
    const v = gearStats[key] ?? 0;
    if (v !== 0) add({ key, group: "Resistencias", label: `Resistencia a ${name}`, value: v, unit: "pts", parts: part("tu equipo", v) });
  }

  // --- Habilidades con armas y de profesión (equipo) ---------------------------------------------------------------
  for (const s of WEAPON_SKILLS) {
    const v = gearStats[`skill-${s.key}`] ?? 0;
    if (v !== 0) add({ key: `skill-${s.key}`, group: "Habilidades", label: `Habilidad con ${s.label}`, value: v, unit: "pts", parts: part("tu equipo", v), note: NOTE_WEAPON_SKILL });
  }
  for (const s of PROFESSION_SKILLS) {
    const v = gearStats[`profession-${s.key}`] ?? 0;
    if (v !== 0) add({ key: `profession-${s.key}`, group: "Habilidades", label: `Habilidad en ${s.label}`, value: v, unit: "pts", parts: part("tu equipo", v) });
  }
  // Perforación de resistencias por escuela (la genérica de hechizos ya tiene su fila en «Ataque»)
  for (const s of PENETRATION_SCHOOLS) {
    const v = gearStats[`${s.key}-penetration`] ?? 0;
    if (v !== 0) add({ key: `${s.key}-penetration`, group: "Ataque", label: `Penetración de ${s.label}`, value: v, unit: "pts", parts: part("tu equipo", v), note: "Solo para los hechizos de esa escuela." });
  }
  // Bonos que solo valen contra un tipo de criatura: no se suman al total, se eligen en «Tipo de criatura» de las habilidades
  for (const c of CREATURE_TYPES) {
    const ap = gearStats[attackPowerVsKey(c.key)] ?? 0;
    if (ap !== 0) add({ key: attackPowerVsKey(c.key), group: "Contra criaturas", label: `Poder de ataque contra ${c.label}`, value: ap, unit: "pts", parts: part("tu equipo", ap), note: NOTE_VS_CREATURE });
    const sd = gearStats[spellDamageVsKey(c.key)] ?? 0;
    if (sd !== 0) add({ key: spellDamageVsKey(c.key), group: "Contra criaturas", label: `Daño con hechizos contra ${c.label}`, value: sd, unit: "pts", parts: part("tu equipo", sd), note: NOTE_VS_CREATURE });
  }

  // --- Otros bonos del personaje ----------------------------------------------------------------------------------
  // Lo que queda y vale para todo el personaje: velocidad, daño infligido por escuela, amenaza... (las cifras de habilidades concretas van en la tarjeta de cada una)
  const rest = take((t) => !t.target && !t.ofStat && (t.scope === null ? !["Coste", "Tiempo de lanzamiento", "Enfriamiento", "Alcance y radio", "Duración", "Efecto 1 / 2 / 3 de los hechizos", "Otros modificadores", "Retroceso al lanzar", "Daño periódico"].includes(t.category) : CHARACTER_WIDE_LABELS.has(t.label)));
  for (const t of rest) {
    const scope = t.scope && t.scope.length > 0 ? ` (${t.scope.join(", ")})` : "";
    add({ key: `other:${t.category}:${t.label}:${scope}`, group: "Otros bonos", label: `${t.label.charAt(0).toUpperCase() + t.label.slice(1)}${scope}`, value: t.value, unit: isPct(t) ? "%" : t.unit === "s" || t.unit === "m" ? "" : "pts", parts: part("talentos, Legacy y raza", t.value), sources: t.sources });
  }

  return { rows, haste };
}

/** Celeridad (%) que se aplica a una habilidad: fisica = cuerpo a cuerpo (o a distancia si tiene alcance), el resto = hechizos. */
export function hasteFor(haste: CombatStats["haste"], rank: { schoolMask: number; rangeYd: number | null }): number {
  if (rank.schoolMask !== 1) return haste.spell;
  const ranged = rank.rangeYd !== null && rank.rangeYd > 8 && rank.rangeYd < 1000;
  return ranged ? haste.ranged : haste.melee;
}
