import type { Abilities, Race, Talent, TalentRules } from "@wfuc/schema";
import { describeEquipped, meetsEquipped, type EquippedState } from "./equipped.js";
import { raceBonuses } from "./race.js";
import { rankOf, type Build, type ClassIndex } from "./rules.js";
import { ruleLines, ruleScopeNames, dealsDamage, canCrit } from "./talent-rules.js";
import { auraNumberInText, classifyGearAuras, remainingAuras, type GearEffectSource } from "./gear-effects.js";
import { AURA_ADD_FLAT_MODIFIER, AURA_ADD_PCT_MODIFIER, opLabel } from "./spell-mods.js";

/** Categorias del resumen de efectos (el orden es el de la tabla). */
export const STAT_CATEGORIES = [
  "Probabilidad de crítico",
  "Probabilidad de impacto",
  "Bonus de daño crítico",
  "Daño y curación",
  "Daño periódico",
  "Efecto 1 / 2 / 3 de los hechizos",
  "Tiempo de lanzamiento",
  "Coste",
  "Enfriamiento",
  "Alcance y radio",
  "Duración",
  "Amenaza",
  "Retroceso al lanzar",
  "Atributos, salud y recursos",
  "Celeridad",
  "Defensa",
  "Regeneración",
  "Velocidad de movimiento",
  "Otros modificadores",
] as const;
export type StatCategory = (typeof STAT_CATEGORIES)[number];

/** A que estadistica base se aplica una cifra (para la tabla de estadisticas con talentos); ausente = no es una estadistica base. */
export type StatTarget = "str" | "agi" | "sta" | "int" | "spi" | "all-stats" | "health" | "mana" | "rage" | "energy" | "spell-damage" | "spell-healing" | "attack-power" | "ranged-attack-power";

export interface StatSource {
  from: "class" | "legacy" | "race" | "gear";
  name: string;
  rank: number;
  maxRank: number;
}

/** Una cifra concreta de un talento, de Legacy o de la raza, ya clasificada. */
export interface StatLine {
  category: StatCategory;
  /** Que se modifica, en una frase ("probabilidad de crítico", "tiempo de lanzamiento"...). */
  label: string;
  value: number;
  unit: "%" | "puntos porcentuales" | "s" | "m" | "puntos";
  /** Habilidades o conjunto a los que se aplica; null = a todo el personaje. */
  scope: string[] | null;
  /** Estadistica base a la que se aplica (atributo, salud o recurso), si la cifra modifica una. */
  target?: StatTarget;
  /** Si el valor es un % de otra estadística (poder con hechizos o de ataque «= N % de tu intelecto»): cuál. */
  ofStat?: "int" | "spi" | "str" | "agi" | "sta";
  /**
   * Máscara de escuelas (1 físico, 2 Sagrado, 4 Fuego, 8 Naturaleza, 16 Escarcha, 32 Sombras, 64 Arcano) de las auras que dependen de la escuela del
   * hechizo: daño infligido (79) y amenaza (10). Con ella el motor aplica la cifra a las habilidades de esa escuela (`scope` solo lleva los nombres para mostrar).
   */
  schoolMask?: number;
  source: StatSource;
}

/** Una linea ya sumada: todas las cifras de la misma categoria, etiqueta, unidad y alcance. */
export interface StatTotal extends Omit<StatLine, "source"> {
  sources: StatSource[];
}

/** Efecto que el motor no sabe cuantificar (procs, efectos con condicion...): se muestra con el texto del cliente. */
export interface ConditionalEffect {
  source: StatSource;
  text: string;
  /** El talento da una habilidad activa: sus auras solo valen mientras esta activa. */
  active: boolean;
  /** El talento exige un objeto equipado que el personaje no lleva (SpellEquippedItems): no suma hasta que lo lleve. Texto del requisito. */
  blocked?: string;
}

/** Efecto condicional cuantificado con una regla clasificada a mano (Ignicion, Trizar...). */
export interface RuleEffectView {
  source: StatSource;
  text: string;
  /** Habilidades a las que afecta (null = todas). */
  scope: string[] | null;
}

export interface StatEffects {
  totals: StatTotal[];
  ruleEffects: RuleEffectView[];
  conditional: ConditionalEffect[];
  /** Cuantos talentos escogidos aportan cifras sumadas, y cuantos solo texto. */
  counts: { quantified: number; conditionalOnly: number };
}

const SCHOOLS: [number, string][] = [
  [1, "físico"],
  [2, "Sagrado"],
  [4, "Fuego"],
  [8, "Naturaleza"],
  [16, "Escarcha"],
  [32, "Sombras"],
  [64, "Arcano"],
];
const schoolsOf = (mask: number): string[] | null => {
  if (mask === 127 || mask === 0) return null;
  if (mask === 126) return ["hechizos mágicos"];
  return SCHOOLS.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name);
};
const STATS = ["Fuerza", "Agilidad", "Aguante", "Intelecto", "Espíritu"];
const STAT_TARGETS: StatTarget[] = ["str", "agi", "sta", "int", "spi"];
/** Recurso de `EffectMiscValue` (0 maná, 1 ira, 3 energía) a objetivo de estadística. */
const POWER_TARGETS: Record<number, StatTarget> = { 0: "mana", 1: "rage", 3: "energy" };
/** Tipos de criatura (mascara del cliente) para el dano contra criaturas (aura 168). */
const CREATURE_TYPES: [number, string][] = [
  [1, "bestias"],
  [2, "dragonantes"],
  [4, "demonios"],
  [8, "elementales"],
  [16, "gigantes"],
  [32, "no-muertos"],
  [64, "humanoides"],
  [256, "mecánicos"],
];
/** Aura 30 (habilidad): 95 = Defensa. */
const SKILL_DEFENSE = 95;
const POWER_NAMES: Record<number, string> = { 0: "maná", 1: "ira", 3: "energía" };
/** Mecanicas de control (aura 232): numero de Mechanics del cliente -> nombre. Solo las comprobadas contra el texto de los talentos. */
const MECHANICS: Record<number, string> = { 2: "desorientación", 5: "miedo", 7: "inmovilización", 9: "silencio", 11: "ralentización", 12: "aturdimiento" };
/** Aura 117 (resistencia a que un efecto te golpee): las mecanicas de arriba y la interrupcion (26), comprobadas contra el texto del cliente. */
const RESIST_MECHANICS: Record<number, string> = { ...MECHANICS, 26: "interrupción" };

const matches = (mask: number[], rankMask: number[]): boolean => mask.some((m, i) => m !== 0 && (m & (rankMask[i] ?? 0)) !== 0);

/** Habilidades fisicas que hacen dano (las que se benefician del critico cuerpo a cuerpo); null si no hay libro de hechizos. */
function meleeDamageAbilities(abilities: Abilities | null): string[] | null {
  if (!abilities) return null;
  return abilities.abilities.filter((a) => a.ranks.some((r) => r.schoolMask === 1 && dealsDamage(r))).map((a) => a.name);
}

/** Habilidades de hechizo que pueden ser criticas (las que se benefician del critico con hechizos); null si no hay libro de hechizos. */
function spellCritAbilities(abilities: Abilities | null): string[] | null {
  if (!abilities) return null;
  return abilities.abilities.filter((a) => a.ranks.some((r) => r.schoolMask !== 1 && canCrit(r))).map((a) => a.name);
}

/** Nombres de las habilidades a las que afecta una mascara de clase (null si no hay datos de habilidades de la clase). */
function abilitiesFor(mask: number[], abilities: Abilities | null): string[] | null {
  if (!abilities) return null;
  if (mask.every((m) => m === 0)) return null;
  // Tambien las que llevan un efecto en un hechizo disparado con esa mascara (los venenos)
  const names = abilities.abilities.filter((a) => a.ranks.some((r) => matches(mask, r.classMask) || r.effects.some((e) => e.classMask !== null && matches(mask, e.classMask)) || r.procs.some((p) => matches(mask, p.classMask)))).map((a) => a.name);
  return names.length > 0 ? names : [];
}

/**
 * Auras sin mascara de clase cuya cifra se ha comprobado contra el texto del cliente (el valor aparece en la descripcion).
 * Devuelve null si el motor no sabe cuantificarla.
 */
function generalLine(aura: number, misc: number, value: number, miscB = 0): Omit<StatLine, "source"> | null {
  switch (aura) {
    case 290:
      return { category: "Probabilidad de crítico", label: "probabilidad de crítico", value, unit: "puntos porcentuales", scope: null };
    case 57:
      // Critico con hechizos: el alcance (habilidades de hechizo que pueden ser criticas) lo pone talentLines
      return { category: "Probabilidad de crítico", label: "probabilidad de crítico con hechizos", value, unit: "puntos porcentuales", scope: null };
    case 52:
      // Cuerpo a cuerpo: el alcance (habilidades fisicas con dano) lo pone talentLines, que conoce el libro de hechizos
      return { category: "Probabilidad de crítico", label: "probabilidad de crítico cuerpo a cuerpo", value, unit: "puntos porcentuales", scope: null };
    case 30:
      return misc === SKILL_DEFENSE ? { category: "Defensa", label: "habilidad en defensa", value, unit: "puntos", scope: null } : null;
    case 133:
      return { category: "Atributos, salud y recursos", label: "salud máxima", value, unit: "%", scope: null, target: "health" };
    case 134:
      return { category: "Regeneración", label: "regeneración de maná en combate (% de la regeneración por espíritu)", value, unit: "%", scope: null };
    case 49:
      return { category: "Defensa", label: "probabilidad de esquivar", value, unit: "puntos porcentuales", scope: null };
    case 47:
      return { category: "Defensa", label: "probabilidad de parar", value, unit: "puntos porcentuales", scope: null };
    case 51:
      return { category: "Defensa", label: "probabilidad de bloquear", value, unit: "puntos porcentuales", scope: null };
    case 79:
      return { category: "Daño y curación", label: "daño infligido", value, unit: "%", scope: schoolsOf(misc), schoolMask: misc };
    // Poder con hechizos / de ataque como % de un atributo (cliente: 174 daño [misc = escuela, miscB = atributo], 175 sanación, 598 poder de ataque, 580 a distancia;
    // comprobado con el texto «hasta un 30 % de tu intelecto» y las notas de Blizzard: Campeón de la Luz 10/20/30 % del intelecto)
    case 174:
    case 175:
    case 580:
    case 598: {
      const stat = aura === 174 ? miscB : misc;
      const ofStat = (["str", "agi", "sta", "int", "spi"] as const)[stat];
      if (!ofStat) return null;
      const target: StatTarget = aura === 174 ? "spell-damage" : aura === 175 ? "spell-healing" : aura === 598 ? "attack-power" : "ranged-attack-power";
      const what = { "spell-damage": "poder con hechizos (daño)", "spell-healing": "poder con hechizos (sanación)", "attack-power": "poder de ataque", "ranged-attack-power": "poder de ataque a distancia" }[target];
      return { category: "Daño y curación", label: `${what}: % de tu ${STATS[stat]!.toLowerCase()}`, value, unit: "%", scope: null, target, ofStat };
    }
    case 122:
      return { category: "Daño y curación", label: "daño del arma de la mano izquierda", value, unit: "%", scope: null };
    case 178: {
      // Maximo de recurso en %: misc 0 = maná (Vitalidad vil, comprobado con el texto del cliente)
      const t = POWER_TARGETS[misc];
      return t ? { category: "Atributos, salud y recursos", label: `${POWER_NAMES[misc] ?? "recurso"} máximo`, value, unit: "%", scope: null, target: t } : null;
    }
    case 232:
      // Solo las reducciones de duracion (valor negativo) de mecanicas comprobadas: el cliente trae valores positivos que no cuadran con el texto (Voluntad férrea, mecanica 1)
      return value < 0 && MECHANICS[misc] ? { category: "Defensa", label: `duración de ${MECHANICS[misc]} sobre ti`, value, unit: "%", scope: null } : null;
    case 31:
      return { category: "Velocidad de movimiento", label: "velocidad de movimiento", value, unit: "%", scope: null };
    case 172:
      return { category: "Velocidad de movimiento", label: "velocidad de movimiento sobre montura", value, unit: "%", scope: null };
    case 142:
      return misc === 1 ? { category: "Atributos, salud y recursos", label: "armadura de tus objetos", value, unit: "%", scope: null } : null;
    case 87:
      return { category: "Defensa", label: "daño recibido", value, unit: "%", scope: schoolsOf(misc) };
    case 10:
      return { category: "Amenaza", label: "amenaza generada", value, unit: "%", scope: schoolsOf(misc), schoolMask: misc };
    case 35:
      return { category: "Atributos, salud y recursos", label: `${POWER_NAMES[misc] ?? "recurso"} máximo`, value, unit: "puntos", scope: null, ...(POWER_TARGETS[misc] ? { target: POWER_TARGETS[misc] } : {}) };
    case 54:
    case 55:
      return { category: "Probabilidad de impacto", label: value < 0 ? "probabilidad de impacto de los enemigos contra ti" : "probabilidad de impacto", value, unit: "puntos porcentuales", scope: null };
    case 240:
      return { category: "Probabilidad de impacto", label: "probabilidad de que el enemigo esquive o pare tus ataques", value: -value, unit: "puntos porcentuales", scope: null };
    case 593:
      // «Reduce un 2 % la probabilidad de que tus ataques se esquiven o paren» (el cliente guarda −2, una vez para esquivar y otra para parar)
      return { category: "Probabilidad de impacto", label: "probabilidad de que el enemigo esquive o pare tus ataques", value: -Math.abs(value), unit: "puntos porcentuales", scope: null };
    case 117:
      // «Reduce un 8 % la probabilidad de golpearte de los efectos de miedo»
      return RESIST_MECHANICS[misc] ? { category: "Defensa", label: `probabilidad de que te afecten los efectos de ${RESIST_MECHANICS[misc]}`, value: -Math.abs(value), unit: "puntos porcentuales", scope: null } : null;
    case 342:
      return { category: "Celeridad", label: "celeridad de ataque y de lanzamiento", value, unit: "%", scope: null };
    case 185:
    case 186:
      return { category: "Defensa", label: "probabilidad de ser alcanzado por hechizos y ataques a distancia", value, unit: "puntos porcentuales", scope: null };
    case 280:
      return { category: "Daño y curación", label: "armadura del objetivo ignorada", value, unit: "%", scope: null };
    case 168: {
      const types = CREATURE_TYPES.filter(([bit]) => (misc & bit) !== 0).map(([, n]) => n);
      return { category: "Daño y curación", label: "daño infligido", value, unit: "%", scope: types.length > 0 ? [`contra ${types.join(" y ")}`] : null };
    }
    default:
      return null;
  }
}

/**
 * Aura 137 (atributo en %): el atributo esta en `EffectMiscValue[1]` como mascara (comprobado en el cliente: Mente Arcana
 * = 8 intelecto, Fuerza divina = 1, Dureza = 4; el [0] vale 0 en casi todos). Si la mascara es 0 se usa el indice del [0].
 * Devuelve los indices de atributo afectados (5 = todos).
 */
function statIndices(misc: number, miscB: number): number[] {
  const mask = miscB & 31 ? miscB & 31 : misc === -1 ? 31 : misc >= 0 && misc <= 4 ? 1 << misc : 0;
  return [0, 1, 2, 3, 4].filter((i) => (mask & (1 << i)) !== 0);
}

function statPercentLines(misc: number, miscB: number, value: number): Omit<StatLine, "source">[] {
  const idx = statIndices(misc, miscB);
  if (idx.length === 5) return [{ category: "Atributos, salud y recursos", label: "todos los atributos", value, unit: "%", scope: null, target: "all-stats" }];
  return idx.map((i) => ({ category: "Atributos, salud y recursos" as const, label: STATS[i]!, value, unit: "%" as const, scope: null, target: STAT_TARGETS[i]! }));
}

/** Cifra de un modificador de hechizos (aura 107 plano / 108 porcentual): categoria, etiqueta y unidad segun la operacion. */
function modifierLine(aura: number, op: number, value: number): Omit<StatLine, "source" | "scope"> | null {
  const flat = aura === AURA_ADD_FLAT_MODIFIER;
  const pct = aura === AURA_ADD_PCT_MODIFIER;
  if (!flat && !pct) return null;
  const pctUnit = "%" as const;
  switch (op) {
    case 0:
      return { category: "Daño y curación", label: "daño y curación", value, unit: flat ? "puntos" : pctUnit };
    case 22:
      return { category: "Daño periódico", label: "daño y curación periódicos", value, unit: flat ? "puntos" : pctUnit };
    case 3:
    case 12:
    case 23:
      return { category: "Efecto 1 / 2 / 3 de los hechizos", label: opLabel(op), value, unit: flat ? "puntos" : pctUnit };
    case 8:
      return { category: "Daño y curación", label: "todos los efectos", value, unit: flat ? "puntos" : pctUnit };
    case 7:
      return { category: "Probabilidad de crítico", label: "probabilidad de crítico", value, unit: "puntos porcentuales" };
    case 16:
      return { category: "Probabilidad de impacto", label: "probabilidad de impacto", value, unit: "puntos porcentuales" };
    case 15:
      return { category: "Bonus de daño crítico", label: "bonus de daño crítico", value, unit: pctUnit };
    case 10:
      return { category: "Tiempo de lanzamiento", label: "tiempo de lanzamiento", value: flat ? value / 1000 : value, unit: flat ? "s" : pctUnit };
    case 14:
      return { category: "Coste", label: "coste", value, unit: flat ? "puntos" : pctUnit };
    case 11:
      return { category: "Enfriamiento", label: "enfriamiento", value: flat ? value / 1000 : value, unit: flat ? "s" : pctUnit };
    case 21:
      return { category: "Enfriamiento", label: "enfriamiento global", value: flat ? value / 1000 : value, unit: flat ? "s" : pctUnit };
    case 5:
      return { category: "Alcance y radio", label: "alcance", value, unit: flat ? "m" : pctUnit };
    case 6:
      return { category: "Alcance y radio", label: "radio", value, unit: flat ? "m" : pctUnit };
    case 1:
      return { category: "Duración", label: "duración", value: flat ? value / 1000 : value, unit: flat ? "s" : pctUnit };
    case 2:
      return { category: "Amenaza", label: "amenaza", value, unit: pctUnit };
    case 9:
      return { category: "Retroceso al lanzar", label: "retroceso ignorado", value, unit: pctUnit };
    default:
      return { category: "Otros modificadores", label: opLabel(op), value, unit: flat ? "puntos" : pctUnit };
  }
}

/** El cliente guarda la ira x10 (coste 30 = 3 de ira, generar 60 = 6 de ira); la energía y el maná no. */
const RAGE_SCALE = 10;
const EFFECT_ENERGIZE = 30;
const POWER_RAGE = 1;
/** El texto del cliente nombra la cifra (en valor absoluto, con coma decimal o miles con punto). */
const textHasNumber = (text: string, value: number): boolean => {
  const nums = [...text.replace(/(\d)\.(\d{3})/g, "$1$2").matchAll(/\d+(?:,\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  return nums.includes(Math.abs(value));
};
const costTypeOf = (name: string, abilities: Abilities): string | null => abilities.abilities.find((a) => a.name === name)?.ranks[0]?.costType ?? null;
/** Todas las habilidades del alcance generan ira con un efecto de energizar (Cargar). */
const generatesRage = (scope: string[], abilities: Abilities): boolean =>
  scope.length > 0 && scope.every((n) => abilities.abilities.find((a) => a.name === n)?.ranks.some((r) => r.effects.some((e) => e.effect === EFFECT_ENERGIZE && e.miscValue === POWER_RAGE)));

/** Texto de un «daño infligido» condicionado al equipo o al estado del personaje (no es un bono permanente). */
const CONDITIONAL_DAMAGE_TEXT = /con (las )?(varitas|armas)|armas (cuerpo a cuerpo|a distancia)|de (una|dos) manos?|mientras/i;

function talentLines(talent: Pick<Talent, "effectInfo" | "rankValues" | "descriptions"> & { equipped?: Talent["equipped"] }, rank: number, source: StatSource, abilities: Abilities | null, equippedChecked = false): { lines: StatLine[]; unclassified: boolean } {
  const lines: StatLine[] = [];
  let unclassified = false;
  for (const info of talent.effectInfo) {
    const value = talent.rankValues[rank - 1]?.[info.index];
    if (value === null || value === undefined) continue;
    if (info.aura === AURA_ADD_FLAT_MODIFIER || info.aura === AURA_ADD_PCT_MODIFIER) {
      // Un modificador de hechizos con la mascara vacia no afecta a ninguna habilidad (Aluvión trae un +15 % periodico asi): se conserva como texto
      if (info.classMask.every((x) => x === 0)) {
        unclassified = true;
        continue;
      }
      // «Efecto 1/2/3» con una cifra que el texto del cliente no dice (Instinto feral: +15 = 3 niveles de detección; Armas de espíritu: 86): no se muestra como cifra
      if ([3, 12, 23].includes(info.miscValue) && !textHasNumber(talent.descriptions[rank - 1] ?? "", value)) {
        unclassified = true;
        continue;
      }
      const m = modifierLine(info.aura, info.miscValue, value);
      const scope = abilitiesFor(info.classMask, abilities);
      if (m && info.aura === AURA_ADD_FLAT_MODIFIER && abilities && scope && scope.length > 0) {
        // Coste plano: la ira va x10 en el cliente. Si el alcance incluye alguna habilidad de ira se divide (Ferocidad: -50 para las de ira, -5 para las de energia, como su texto)
        if (info.miscValue === 14 && scope.some((n) => costTypeOf(n, abilities) === "rage")) m.value = value / RAGE_SCALE;
        // «Todos los efectos» plano sobre una habilidad que genera ira (Embestir mejorado: +6 de ira de Cargar)
        else if (info.miscValue === 8 && generatesRage(scope, abilities)) {
          m.value = value / RAGE_SCALE;
          m.label = "ira generada";
          m.category = "Otros modificadores";
        }
      }
      if (m) lines.push({ ...m, scope, source });
      continue;
    }
    if (info.aura === 137) {
      const found = statPercentLines(info.miscValue, info.miscValueB, value);
      if (found.length > 0) lines.push(...found.map((l) => ({ ...l, source })));
      else unclassified = true;
      continue;
    }
    // Impacto a distancia (55) junto a impacto cuerpo a cuerpo (54): el cliente lo guarda aparte (a veces con otra cifra); el texto da una sola
    if (info.aura === 55 && talent.effectInfo.some((e) => e.aura === 54)) continue;
    // Celeridad de ataque y de lanzamiento (342) junto a la velocidad de lanzamiento (65): la misma cifra, el texto da una sola
    if (info.aura === 65 && talent.effectInfo.some((e) => e.aura === 342)) continue;
    // Daño infligido (79) que depende del equipo o de un estado (varitas, armas de una o dos manos, a distancia, escudo, sin mascota): el cliente no trae la condicion
    // (SpellEquippedItems no esta exportada) pero el texto si; no se suma como un bono permanente del personaje, se conserva como texto
    // Si el talento trae su requisito de objeto (SpellEquippedItems) y ya se comprobó con el equipo, no hace falta el texto
    if (info.aura === 79 && CONDITIONAL_DAMAGE_TEXT.test(talent.descriptions[rank - 1] ?? "") && !(equippedChecked && (talent.equipped?.length ?? 0) > 0)) {
      unclassified = true;
      continue;
    }
    const g = generalLine(info.aura, info.miscValue, value, info.miscValueB);
    if (g && info.aura === 52) lines.push({ ...g, scope: meleeDamageAbilities(abilities), source });
    else if (g && info.aura === 57) lines.push({ ...g, scope: spellCritAbilities(abilities), source });
    else if (g) lines.push({ ...g, source });
    else unclassified = true;
  }
  // Auras gemelas del mismo talento con la misma cifra (impacto cuerpo a cuerpo y de hechizos, etc.): una sola linea
  const unique = lines.filter((l, i) => lines.findIndex((o) => o.category === l.category && o.label === l.label && o.value === l.value && o.unit === l.unit && (o.scope?.join("|") ?? "*") === (l.scope?.join("|") ?? "*")) === i);
  return { lines: unique, unclassified };
}

/**
 * Suma de los efectos de los talentos (de clase y de Legacy) y de la raza, por categoria. Las cifras con el mismo
 * alcance se suman (dos talentos que dan +critico a las mismas habilidades dan un solo total); lo que el motor no sabe
 * cuantificar (procs, efectos con condicion) va aparte con el texto del cliente.
 * Los talentos que dan una habilidad activa NO suman: sus auras solo valen mientras esta activa.
 */
export function collectStatEffects(input: {
  cls: ClassIndex;
  classBuild: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  race: Race | null;
  abilities: Abilities | null;
  rules?: TalentRules | null;
  /** Bonos de conjunto activos y efectos al equipar (`activeGearEffects`); sus estadisticas planas ya van en el equipo, aqui entran los porcentajes y modificadores. */
  gearEffects?: GearEffectSource[];
  /** Lo que lleva el personaje (`equippedStateOf`): con él, los talentos que exigen un objeto (arma a dos manos, varita, escudo...) solo suman si lo lleva. null = sin equipo elegido. */
  equipped?: EquippedState;
}): StatEffects {
  const lines: StatLine[] = [];
  const conditional: ConditionalEffect[] = [];
  const equipped = input.equipped ?? null;
  const ruled = ruleLines(input.rules ?? null, input.cls, input.classBuild);
  const ruledSpells = new Set(ruled.map((r) => r.source.spellId));
  const ruleEffects: RuleEffectView[] = ruled.map((r) => ({ source: { from: "class" as const, name: r.source.name ?? `Hechizo ${r.source.spellId}`, rank: r.source.rank, maxRank: r.source.maxRank }, text: r.text, scope: ruleScopeNames(r, input.abilities) }));
  let quantified = 0;
  let conditionalOnly = 0;

  const addTree = (idx: ClassIndex, build: Build, from: "class" | "legacy") => {
    for (const { talent } of idx.ordered) {
      const rank = rankOf(build, talent.nodeId);
      if (rank === 0) continue;
      const source: StatSource = { from, name: talent.name ?? `Hechizo ${talent.spellId}`, rank, maxRank: talent.maxRank };
      const text = talent.descriptions[rank - 1] ?? "";
      if (!talent.passive) {
        conditional.push({ source, text, active: true });
        conditionalOnly++;
        continue;
      }
      // Requisito de objeto equipado: con equipo elegido, solo suma si lo lleva; si no, se conserva el texto con el motivo
      if (!meetsEquipped(talent.equipped, equipped)) {
        conditional.push({ source, text, active: false, blocked: `Necesitas llevar ${describeEquipped(talent.equipped)}` });
        continue;
      }
      const { lines: found, unclassified } = talentLines(talent, rank, source, from === "class" ? input.abilities : null, equipped !== null);
      lines.push(...found);
      if (found.length > 0) quantified++;
      if ((unclassified || found.length === 0) && !(from === "class" && ruledSpells.has(talent.spellId))) {
        // Lo que no se pudo cuantificar se conserva con su texto: nada se descarta en silencio
        conditional.push({ source, text, active: false });
        if (found.length === 0) conditionalOnly++;
      }
    }
  };
  addTree(input.cls, input.classBuild, "class");
  if (input.legacy) addTree(input.legacy, input.legacyBuild, "legacy");

  // Equipo: lo que no es una estadistica plana (ya sumada en el equipo) se clasifica como un talento. Solo se cuantifica si el texto del cliente nombra la cifra.
  for (const e of input.gearEffects ?? []) {
    const source: StatSource = { from: "gear", name: e.name, rank: 1, maxRank: 1 };
    const { consumed } = classifyGearAuras(e.auras, e.text);
    const rest = remainingAuras(e.auras, consumed);
    const named = rest.filter((a) => auraNumberInText(a, e.text) && !a.levelScaled);
    const rankValues: (number | null)[] = [];
    for (const a of named) rankValues[a.index] = a.value;
    const { lines: found, unclassified } = talentLines({ effectInfo: named, rankValues: [rankValues], descriptions: [e.text] }, 1, source, input.abilities);
    lines.push(...found);
    if (e.text && (rest.length > 0 && (unclassified || found.length === 0 || named.length < rest.length))) conditional.push({ source, text: e.text, active: false });
    else if (e.text && e.auras.length === 0) conditional.push({ source, text: e.text, active: false });
  }

  if (input.race) {
    const b = raceBonuses(input.race, input.cls.data.classId);
    for (const p of b.passives) {
      const source: StatSource = { from: "race", name: `${input.race.name}: ${p.racialName}`, rank: 1, maxRank: 1 };
      const line = raceLine(p.effect.kind, p.effect.value, p.effect.miscValue);
      if (line) lines.push({ ...line, source });
    }
  }

  // Suma: misma categoria, etiqueta, unidad y alcance
  const merged = new Map<string, StatTotal>();
  for (const l of lines) {
    const key = [l.category, l.label, l.unit, l.scope?.join("|") ?? "*", l.schoolMask ?? "-"].join("#");
    const hit = merged.get(key);
    if (hit) {
      hit.value += l.value;
      hit.sources.push(l.source);
    } else merged.set(key, { category: l.category, label: l.label, value: l.value, unit: l.unit, scope: l.scope, ...(l.target ? { target: l.target } : {}), ...(l.ofStat ? { ofStat: l.ofStat } : {}), ...(l.schoolMask !== undefined ? { schoolMask: l.schoolMask } : {}), sources: [l.source] });
  }
  const order = (c: StatCategory) => STAT_CATEGORIES.indexOf(c);
  const totals = [...merged.values()]
    .map((t) => ({ ...t, value: Math.round(t.value * 100) / 100 }))
    .sort((a, b) => order(a.category) - order(b.category) || (a.scope === null ? -1 : 0) - (b.scope === null ? -1 : 0) || a.label.localeCompare(b.label));
  return { totals, ruleEffects, conditional, counts: { quantified: quantified + ruledSpells.size, conditionalOnly } };
}

/** Efectos pasivos de la raza (kinds de races.json) como lineas de estadisticas. */
function raceLine(kind: string | null, value: number, misc: number | null): Omit<StatLine, "source"> | null {
  switch (kind) {
    case "crit-chance":
      return { category: "Probabilidad de crítico", label: "probabilidad de crítico", value, unit: "puntos porcentuales", scope: null };
    case "spirit-pct":
      return { category: "Atributos, salud y recursos", label: "Espíritu", value, unit: "%", scope: null, target: "spi" };
    case "max-power-pct": {
      const power = misc === 1 ? "ira" : misc === 3 ? "energía" : "maná";
      return { category: "Atributos, salud y recursos", label: `${power} máximo`, value, unit: "%", scope: null, ...(POWER_TARGETS[misc ?? 0] ? { target: POWER_TARGETS[misc ?? 0] } : {}) };
    }
    case "health-pct":
      return { category: "Atributos, salud y recursos", label: "salud máxima", value, unit: "%", scope: null, target: "health" };
    case "crit-damage-bonus":
      return { category: "Bonus de daño crítico", label: "bonus de daño crítico", value, unit: "%", scope: null };
    case "crit-healing-bonus":
      return { category: "Bonus de daño crítico", label: "bonus de sanación crítica", value, unit: "%", scope: null };
    case "dodge-pct":
      return { category: "Defensa", label: "probabilidad de esquivar", value, unit: "puntos porcentuales", scope: null };
    case "damage-vs-creature":
      return { category: "Daño y curación", label: "daño infligido", value, unit: "%", scope: [misc === 1 ? "bestias" : misc === 8 ? "elementales" : "ciertas criaturas"] };
    case "haste-spell-pct":
      return { category: "Celeridad", label: "celeridad con hechizos", value, unit: "%", scope: null };
    case "haste-melee-pct":
      return { category: "Celeridad", label: "celeridad cuerpo a cuerpo", value, unit: "%", scope: null };
    case "haste-ranged-pct":
      return { category: "Celeridad", label: "celeridad a distancia", value, unit: "%", scope: null };
    case "haste-melee-ranged-pct":
      return { category: "Celeridad", label: "celeridad cuerpo a cuerpo y a distancia", value, unit: "%", scope: null };
    case "health-regen-pct":
      return { category: "Regeneración", label: "regeneración de salud", value, unit: "%", scope: null };
    case "health-regen-combat-pct":
      return { category: "Regeneración", label: "regeneración de salud que continúa en combate", value, unit: "%", scope: null };
    case "stun-duration-pct":
      return { category: "Defensa", label: "duración de aturdimientos", value, unit: "%", scope: null };
    case "movement-speed-pct":
      return { category: "Velocidad de movimiento", label: "velocidad de movimiento", value, unit: "%", scope: null };
    case "mounted-speed-pct":
      return { category: "Velocidad de movimiento", label: "velocidad al montar", value, unit: "%", scope: null };
    default:
      return null;
  }
}
