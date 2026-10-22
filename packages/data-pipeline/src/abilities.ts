import { CLASS_ID_BY_SPELL_SET } from "./build.js";
import type { Poly } from "./desc-variables.js";
import { int, type RawTables, type Row } from "./csv.js";
import type { Abilities, Ability, AbilityEffect, AbilityRank, ClassTalents } from "./model.js";
import { renderSpellText, withoutConditions } from "./spell-text.js";
import type { SpellTables } from "./spell-tables.js";

/**
 * SkillLines del cliente que forman el libro de hechizos de cada clase (ChrClasses.ID -> SkillLine). Hoy solo el Mago
 * (Escarcha 6, Fuego 8, Arcano 237); el resto de clases se anade comprobando antes sus lineas (Brujo y Cazador mezclan
 * lineas de mascota).
 */
export const CLASS_SKILL_LINES: Record<number, number[]> = {
  1: [26, 256, 257], // Guerrero: Armas 26, Furia 256, Protección 257
  2: [594, 267, 184], // Paladín: Sagrado 594, Protección 267, Reprensión 184 (cruce con los id de la referencia)
  5: [56, 78, 613], // Sacerdote: Sombras 56, Disciplina 78, Sagrado 613 (cruce con los id de la referencia)
  3: [163, 51, 50], // Cazador: Punteria 163, Supervivencia 51, Bestias 50 (SIN las lineas de mascota 270 y 203-218...: sus habilidades son de la mascota)
  7: [373, 375, 374], // Chaman: Mejora 373, Elemental 375, Restauracion 374
  9: [355, 354, 593], // Brujo: Afliccion 355, Demonologia 354, Destruccion 593 (SIN las lineas de demonios 188/189/204/205)
  11: [134, 574, 573], // Druida: Combate feral 134, Equilibrio 574, Restauracion 573
  4: [38, 39, 40, 253], // Pícaro: Combate 38, Sutileza 39, Venenos 40, Asesinato 253
  8: [6, 8, 237], // Mago: Escarcha 6, Fuego 8, Arcano 237
};

/**
 * Hechizos que el cliente trae en la SkillLine de la clase (AcquireMethod 3) pero que no son habilidades del jugador sino
 * efectos auxiliares que lanza otra habilidad: la sanacion/dano de 1 punto de Luz Sagrada y Destello de Luz, las mitades de
 * Choque Sagrado (dano y sanacion) y los debilitamientos que deja cada Sentencia. La referencia tampoco los lista.
 * No hay marca en el cliente que los distinga de las habilidades de runa de Forever (mismo AcquireMethod, mismo ClassMask),
 * asi que se revisan a mano por clase.
 */
const AUXILIARY_SPELLS = new Set<number>([
  // Paladin: Luz Sagrada, Destello de Luz
  19982, 19981, 19980, 19968, 1313348, 1313349, 1313350, 1313351, 1313352,
  412020, 19993, 1313342, 1313343, 1313344, 1313345, 1313346,
  // Paladin: Choque Sagrado (dano / sanacion) y Tormenta divina (sanacion de la runa)
  25912, 25914, 25911, 25913, 25902, 25903, 407784,
  // Paladin: Sello de rectitud 21084 es un duplicado del rango 1 (20154) que lo sustituye al mismo nivel
  21084,
  // Sacerdote: descargas de Guardia de las Sombras, debilitamiento de Toque de debilidad, curacion de Renovar Pozo de Luz,
  // golpes de dano/sanacion de Penitencia (runa) y la rafaga que lanza Abrasamiento mental (413259 la dispara)
  28377, 28378, 28379, 28380, 28381, 28382, 2943, 19249, 19251, 19252, 19253, 19254, 7001,
  402284, 402289, 1240723, 1240727, 1240724, 1240730, 1316991, 1316993, 413260,
  // Mago: efectos de talentos que cuelgan de la SkillLine (sin coste, enfriamiento ni lanzamiento; la referencia tampoco los lista):
  // Gelido, Maestro de los elementos (1 p. de mana), Conjuro libre, Impacto, Mordiescarcha
  12484, 29077, 12536, 12355, 12494,
  // Cazador: DoT de Trampa de inmolacion, efecto de Trampa explosiva, mitades sin coste de Golpe de raptor (runa) y variantes del
  // Disparo de quimera (escorpido, serpiente, vibora: las dispara el principal 409433)
  13797, 14298, 14299, 14300, 14301, 13812, 14314, 14315,
  409691, 409693, 409748, 409750, 409751, 409752, 409754, 409755, 409495, 409493, 409494,
  // Chaman: descargas de Escudo de relampagos, sanacion de Escudo de tierra, mitades de curacion y dano de Guia ancestral
  26364, 26365, 26366, 26367, 26369, 26370, 26363, 408519, 409333, 409337,
  // Brujo: Efecto de piroinferno y el DoT de Pirosombra
  5857, 11681, 11682, 426325,
  // Druida: curacion final de Flor de vida, aluvion y duracion de Lluvia de estrellas, sangrado de Lanzarse al desgarre, aura de
  // la Forma de lechucico lunar, curacion de Semilla viviente
  408245, 439753, 439756, 9007, 9824, 9826, 24907, 414683,
  // Paladin: debilitamientos de las Sentencias (cruzado, justicia, furia, luz, sabiduria)
  20188, 20300, 20301, 20302, 20303, 20184, 20183, 20411, 20412, 20413, 20414, 20185, 20344, 20345, 20346, 20186, 20354, 20355,
]);

const ACQUIRE_RUNE = 3;
const SPELL_ATTR0_PASSIVE = 0x40;
const SPELL_ATTR1_CHANNELED = 0x44; // CHANNELED_1 | CHANNELED_2

/** SpellEffect.Effect: 2 = dano de escuela, 10 = sanar, 6 = aplicar aura (periodicas: 3 dano, 8 sanar, 20/21...). */
const EFFECT_SCHOOL_DAMAGE = 2;
const EFFECT_HEAL = 10;
const EFFECT_APPLY_AURA = 6;
/** Drenar salud (Espiral mortal): daño directo que ademas cura al lanzador. */
const EFFECT_HEALTH_LEECH = 9;
const AURA_PERIODIC_DAMAGE = 3;
const AURA_PERIODIC_HEAL = 8;
const AURA_SCHOOL_ABSORB = 69;

/** SpellMisc.Attributes[3] 0x1000000: el hechizo exige un arma en la mano izquierda (golpea con ella). */
const SPELL_ATTR3_REQ_OFFHAND = 0x1000000;

/** Con que arma(s) golpea una habilidad de daño de arma: lo dice el texto del cliente («con ambas armas», «el arma de tu mano izquierda») y el atributo del hechizo. */
export function weaponHandOf(attributes3: number, description: string): AbilityRank["weaponHand"] {
  if (/ambas armas/i.test(description)) return "both";
  if ((attributes3 & SPELL_ATTR3_REQ_OFFHAND) !== 0 || /(?:arma|armas) de (?:tu|la) mano izquierda|con tu mano izquierda/i.test(description)) return "off";
  return "main";
}

const POWER_TYPES: Record<number, AbilityRank["costType"]> = { 0: "mana", 1: "rage", 2: "focus", 3: "energy" };

function kindOf(effect: number, aura: number): AbilityEffect["kind"] {
  if (effect === EFFECT_SCHOOL_DAMAGE || effect === EFFECT_HEALTH_LEECH) return "direct-damage";
  if (effect === EFFECT_HEAL) return "direct-heal";
  if (effect === EFFECT_APPLY_AURA && aura === AURA_PERIODIC_DAMAGE) return "periodic-damage";
  if (effect === EFFECT_APPLY_AURA && aura === AURA_PERIODIC_HEAL) return "periodic-heal";
  if (effect === EFFECT_APPLY_AURA && aura === AURA_SCHOOL_ABSORB) return "absorb";
  return "other";
}

/** Efectos del hechizo con sus numeros; `via` = hechizo que lo dispara (null si es el propio) y `parentPeriodMs` el periodo del disparo. */
function effectsOf(spells: SpellTables, spellId: number, via: number | null, parentPeriodMs: number | null, levels: Map<string, Row>, hints: Map<string, Poly>, classOptions: Map<string, Row>): AbilityEffect[] {
  const co = via === null ? undefined : classOptions.get(String(spellId));
  const viaMask = co ? [0, 1, 2, 3].map((i) => int(co[`SpellClassMask[${i}]`])) : null;
  const out: AbilityEffect[] = [];
  for (let i = 0; i < spells.effectCount(spellId); i++) {
    const e = spells.effect(spellId, i)!;
    const effect = int(e.Effect);
    const aura = int(e.EffectAura);
    out.push({
      index: i,
      effect,
      aura,
      kind: kindOf(effect, aura),
      base: Number(e.EffectBasePointsF),
      perLevel: Number(e.EffectRealPointsPerLevel),
      variance: Number(e.Variance),
      coefficient: Number(e.EffectBonusCoefficient) || null,
      periodMs: int(e.EffectAuraPeriod) || parentPeriodMs,
      miscValue: int(e["EffectMiscValue[0]"]) || null,
      viaSpellId: via,
      levels: via === null ? null : triggeredLevels(levels.get(String(spellId))),
      levelPoly: hints.get(`${spellId}:${i + 1}`) ?? null,
      classMask: viaMask && viaMask.some((m) => m !== 0) ? viaMask : null,
      durationMs: via === null ? null : spells.durationMs(spellId),
    });
  }
  return out;
}

/** Niveles propios de un hechizo disparado (SpellLevels): solo si trae un nivel base; si no, escala con los del rango. */
function triggeredLevels(row: Row | undefined): AbilityEffect["levels"] {
  const base = int(row?.BaseLevel);
  return base > 0 ? { base, max: int(row?.MaxLevel) || null } : null;
}

/**
 * Efectos cuyo valor el texto multiplica por una variable de nivel de Forever (`$m1*$<damagepower>/100`, `$<healpower>*$m1/100`,
 * tambien con prefijo de hechizo `$413260m1`): `hechizo:efecto` (1-based) -> polinomio del nivel de la variable.
 */
function powerHints(spells: SpellTables, spellId: number): Map<string, Poly> {
  const out = new Map<string, Poly>();
  const text = spells.clientDescription(spellId);
  const add = (prefix: string | undefined, idx: string, name: string) => {
    const poly = spells.variablePolynomial(spellId, name);
    if (poly) out.set(`${prefix ? Number(prefix) : spellId}:${idx}`, poly);
  };
  for (const m of text.matchAll(/\$(\d*)[mMsS](\d)\s*\*\s*\$<(\w+)>\s*\/\s*100/g)) add(m[1], m[2]!, m[3]!);
  for (const m of text.matchAll(/\$<(\w+)>\s*\*\s*\$(\d*)[mMsS](\d)\s*\/\s*100/g)) add(m[2], m[3]!, m[1]!);
  return out;
}

const first = (rows: Row[], diffKey = "DifficultyID"): Map<string, Row> => {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const id = r.SpellID!;
    if (!m.has(id) || r[diffKey] === "0") m.set(id, r);
  }
  return m;
};

/**
 * Rangos de una misma habilidad con otro nombre en el cliente (los hotfixes renombraron un rango): se unen bajo el nombre
 * que usa el texto de la habilidad. No hay cadena de `SupercedesSpell` que los una (los totems no la traen) y unir por
 * esa cadena mezcla habilidades distintas (Forma de oso / Forma de oso nefasto), asi que la lista es manual y se
 * comprueba con el recuento de rangos de la referencia.
 */
const NAME_ALIASES: Record<string, string> = {
  "Tótem Corriente de sanación": "Tótem de corriente curativa",
  "Tótem Marea de maná": "Tótem de marea de maná",
  "Crear pirorroca": "Crear piedra de fuego",
  "Crear piedra de hechizo": "Crear piedra de hechizos",
};

/**
 * Habilidades que el cliente da a la clase sin ningun nivel (SpellLevels sin fila): se ofrecen desde el nivel 1.
 * Captar no-muertos (Paladin): en Classic la ensenaba el instructor a nivel 20; en Forever no tiene nivel (un humano o enano la entrena
 * a cualquier nivel y un no-muerto la conoce desde el principio), asi que el nivel 1 es la lectura fiel (`assumption` solo en el nivel).
 */
const LEARNED_WITHOUT_LEVEL = new Set([5502]);

/**
 * Habilidades de una clase tal como las da el cliente: los hechizos de su familia (SpellClassOptions), de sus SkillLines,
 * no pasivos y que se aprenden a un nivel (SpellLevels.BaseLevel > 0). Cada rango trae coste, tiempo de lanzamiento,
 * enfriamiento, alcance y sus efectos con base, variacion, puntos por nivel y coeficiente de poder con hechizos.
 */
export function buildAbilities(raw: RawTables, spells: SpellTables, classId: number, build: string, locale: string, classTalents?: ClassTalents): Abilities | null {
  const lines = CLASS_SKILL_LINES[classId];
  if (!lines) return null;
  const warnings: string[] = [];
  const familySet = Number(Object.entries(CLASS_ID_BY_SPELL_SET).find(([, id]) => id === classId)?.[0]);

  const classOptions = first(raw.table("SpellClassOptions"), "none");
  const levels = first(raw.table("SpellLevels"));
  const misc = first(raw.table("SpellMisc"));
  const power = first(raw.table("SpellPower"), "none");
  const castTimes = new Map(raw.table("SpellCastTimes").map((r) => [r.ID!, int(r.Base)]));
  const ranges = new Map(raw.table("SpellRange").map((r) => [r.ID!, r]));

  const lineSet = new Set(lines.map(String));
  const classBit = 1 << (classId - 1);
  const candidates = new Set<number>();
  /** Spells cuya fila de SkillLineAbility los marca para la clase (ClassMask), aunque no tengan SpellClassOptions (p. ej. Polvo cegador). */
  const classMarked = new Set<number>();
  const acquire = new Map<number, number>();
  for (const r of raw.table("SkillLineAbility")) {
    if (!lineSet.has(r.SkillLine!)) continue;
    candidates.add(int(r.Spell));
    acquire.set(int(r.Spell), int(r.AcquireMethod));
    if ((int(r.ClassMask) & classBit) !== 0) classMarked.add(int(r.Spell));
  }
  // Habilidades que enseña un talento: no tienen fila de nivel; se aprenden al nivel 10 + puntos que exige su fila
  const talentLevel = new Map<number, number>();
  for (const t of classTalents?.specs.flatMap((s) => s.talents) ?? []) if (!spells.isPassive(t.spellId)) talentLevel.set(t.spellId, 10 + t.requiredPoints);
  for (const id of talentLevel.keys()) candidates.add(id);

  /** Nombres de las habilidades normales (no de runa): una runa que los repite se separa. */
  const plainNames = new Set<string>();
  for (const id of candidates) {
    if (acquire.get(id) === ACQUIRE_RUNE || !spells.description(id)) continue;
    const n = spells.name(id)?.replace(/ (?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/, "");
    if (n) plainNames.add(n);
  }
  const baseNameOf = (id: number): string | undefined => spells.name(id)?.replace(/ (?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/, "");
  const byName = new Map<string, AbilityRank[]>();
  const iconOf = new Map<string, number | null>();
  for (const spellId of [...candidates].sort((a, b) => a - b)) {
    const co = classOptions.get(String(spellId));
    const inFamily = !!co && int(co.SpellClassSet) === familySet;
    if (!inFamily && !classMarked.has(spellId) && !talentLevel.has(spellId)) continue;
    // Hechizo auxiliar sin texto (Ejecutar: el 20647 aplica el dano por codigo del juego): no es un rango y desordenaria la numeracion
    if (!spells.description(spellId)) continue;
    if (AUXILIARY_SPELLS.has(spellId)) continue;
    const lv = levels.get(String(spellId));
    // Nivel de aprendizaje: BaseLevel; los venenos del Picaro lo traen en SpellLevel; las de talento, el de su fila
    const fromTalent = talentLevel.get(spellId);
    const baseLevel = fromTalent ?? (int(lv?.BaseLevel) || (classMarked.has(spellId) ? int(lv?.SpellLevel) : 0) || (LEARNED_WITHOUT_LEVEL.has(spellId) && classMarked.has(spellId) ? 1 : 0));
    const m = misc.get(String(spellId));
    if (baseLevel <= 0 || !m) continue;
    if (int(m["Attributes[0]"]) & SPELL_ATTR0_PASSIVE) continue;
    // Algunos rangos traen el numero romano en el nombre (Veneno instantaneo III): se agrupan bajo el nombre base
    const rawName = baseNameOf(spellId);
    if (!rawName) continue;
    const baseName = NAME_ALIASES[rawName] ?? rawName;
    // Habilidad de runa de Forever con el mismo nombre que una normal (Exorcismo): va aparte, no entre sus rangos
    const name = acquire.get(spellId) === ACQUIRE_RUNE && plainNames.has(baseName) ? `${baseName} (runa)` : baseName;

    const hints = powerHints(spells, spellId);
    const effects = effectsOf(spells, spellId, null, null, levels, hints, classOptions);
    // Efectos que viven en un hechizo disparado (canalizados: Misiles Arcanos lanza un hechizo por segundo)
    for (let i = 0; i < spells.effectCount(spellId); i++) {
      const e = spells.effect(spellId, i)!;
      const trigger = int(e.EffectTriggerSpell);
      if (trigger > 0) effects.push(...effectsOf(spells, trigger, trigger, int(e.EffectAuraPeriod) || null, levels, hints, classOptions).filter((x) => x.kind !== "other"));
    }

    const pw = power.get(String(spellId));
    const costType = pw ? (POWER_TYPES[int(pw.PowerType)] ?? "other") : null;
    const range = ranges.get(m.RangeIndex ?? "");
    const rangeYd = range ? Math.max(Number(range["RangeMax[0]"]), Number(range["RangeMax[1]"])) : 0;
    const channeled = (int(m["Attributes[1]"]) & SPELL_ATTR1_CHANNELED) !== 0;
    const rendered = renderSpellText(spells, spells.description(spellId), { spellId, rank: 1, curves: new Map() });
    // Misma descripcion con huecos {{tipo:hechizo:indice|base}}: el motor los rellena con el nivel y los talentos
    const template = renderSpellText(spells, spells.description(spellId), { spellId, rank: 1, curves: new Map(), slots: true });
    // Lo que cita el texto se busca en la rama sin talentos de las condicionales: la rama «con talento» la resuelve el motor
    const plain = withoutConditions(template.text);
    // Cargas citadas con $n (Fuego interno: «hasta que se hayan usado N cargas»)
    const charges: AbilityRank["charges"] = [...plain.matchAll(/\{\{n:(\d+):1\|(\d+)\}\}/g)].map((x) => ({ spellId: Number(x[1]), charges: Number(x[2]) }));
    // Radio maximo de los efectos de area (propios o de los hechizos disparados)
    let radiusYd = 0;
    for (const sid of [spellId, ...effects.filter((x) => x.viaSpellId !== null).map((x) => x.viaSpellId!)]) {
      for (let i = 0; i < spells.effectCount(sid); i++) radiusYd = Math.max(radiusYd, spells.radius(spells.effect(sid, i)!, 0) ?? 0);
    }

    // Probabilidades de activacion citadas con $NNNh%: cifra (SpellAuraOptions.ProcChance) y mascara del hechizo que las lleva
    const procs: AbilityRank["procs"] = [];
    for (const pm of plain.matchAll(/\{\{c:(\d+):1\|/g)) {
      const ref = Number(pm[1]);
      const chance = spells.aura(ref)?.procChance ?? 0;
      const pco = classOptions.get(String(ref));
      if (chance > 0 && !procs.some((x) => x.spellId === ref)) procs.push({ spellId: ref, chance, classMask: [0, 1, 2, 3].map((i) => int(pco?.[`SpellClassMask[${i}]`])) });
    }
    const rank: AbilityRank = {
      rank: 0,
      spellId,
      level: baseLevel,
      learnedByTalent: fromTalent !== undefined,
      acquireMethod: fromTalent !== undefined ? null : (acquire.get(spellId) ?? null),
      textOrigin: spells.textOrigin(spellId),
      maxLevel: int(lv?.MaxLevel) || null,
      costType,
      cost: pw && int(pw.ManaCost) > 0 ? int(pw.ManaCost) : null,
      costPctOfBase: pw && Number(pw.PowerCostPct) > 0 ? Number(pw.PowerCostPct) : null,
      castMs: Math.max(0, castTimes.get(m.CastingTimeIndex ?? "") ?? 0),
      channeled,
      durationMs: spells.durationMs(spellId),
      cooldownMs: spells.cooldownMs(spellId),
      rangeYd: rangeYd > 0 ? rangeYd : null,
      schoolMask: int(m.SchoolMask),
      classMask: [0, 1, 2, 3].map((i) => int(co?.[`SpellClassMask[${i}]`])),
      effects,
      procs,
      charges,
      radiusYd: radiusYd > 0 ? radiusYd : null,
      description: rendered.text,
      descriptionComplete: rendered.complete,
      descriptionTemplate: template.text,
      equipped: spells.equippedItems(spellId),
      weaponHand: weaponHandOf(int(m["Attributes[3]"]), rendered.text),
    };
    // Hechizos a los que remite el texto (p. ej. el dano por tick de Ventisca vive en otro hechizo): sus efectos tambien cuentan
    const have = new Set([spellId, ...effects.map((e) => e.viaSpellId ?? spellId)]);
    const cited = new Map<number, Set<number>>();
    for (const m of plain.matchAll(/\{\{(?![cn]:)[a-z]:(\d+):(\d+)(?:\*[\d.]+)?\|/g)) {
      const ref = Number(m[1]);
      (cited.get(ref) ?? cited.set(ref, new Set()).get(ref)!).add(Number(m[2]) - 1);
    }
    // Huecos de expresion `{{=EXPR;m:hechizo:efecto;...|valor}}`: tambien citan efectos
    for (const m of plain.matchAll(/\{\{=[^;|}]*((?:;[A-Za-z]:\d+:\d+)+)\|/g)) {
      for (const tok of m[1]!.slice(1).split(";")) {
        const [, r, i] = tok.split(":");
        (cited.get(Number(r)) ?? cited.set(Number(r), new Set()).get(Number(r))!).add(Number(i) - 1);
      }
    }
    for (const ref of cited.keys()) {
      if (have.has(ref)) continue;
      have.add(ref);
      rank.effects.push(...effectsOf(spells, ref, ref, null, levels, hints, classOptions).filter((x) => x.kind !== "other"));
    }
    // Efectos de otro tipo (auras de poder de ataque, escudos, resistencias) de los hechizos citados: solo los indices que el texto cita,
    // para que su cifra escale con el nivel (Forma de oso «$1178s4 de poder de ataque»: 30 base, 120 a nivel 60)
    for (const [ref, idxs] of cited) {
      if (ref === spellId) continue;
      for (const e of effectsOf(spells, ref, ref, null, levels, hints, classOptions)) {
        if (e.kind === "other" && idxs.has(e.index) && !rank.effects.some((x) => x.viaSpellId === ref && x.index === e.index)) rank.effects.push(e);
      }
    }
    // «Cada golpe tiene un N % de probabilidad de envenenar» escrito a mano (Veneno oculto): la cifra es la del texto y la mascara la de los
    // hechizos que llevan sus efectos (ya con los citados)
    const literal = /(\d+)% de probabilidad(?:es)? de envenenar/.exec(rank.descriptionTemplate);
    if (rank.procs.length === 0 && literal) {
      const masks = rank.effects.filter((x) => x.classMask !== null).map((x) => x.classMask!);
      const union = [0, 1, 2, 3].map((i) => masks.reduce((n, mk) => n | (mk[i] ?? 0), 0));
      rank.procs.push({ spellId, chance: Number(literal[1]), classMask: union });
      rank.descriptionTemplate = rank.descriptionTemplate.replace(literal[0], literal[0].replace(/^\d+/, `{{c:${spellId}:1|${literal[1]}}}`));
    }
    const list = byName.get(name) ?? [];
    list.push(rank);
    byName.set(name, list);
    if (!iconOf.has(name)) iconOf.set(name, spells.iconFileDataId(spellId));
  }

  const abilities: Ability[] = [];
  for (const [name, ranks] of byName) {
    ranks.sort((a, b) => a.level - b.level || a.spellId - b.spellId);
    ranks.forEach((r, i) => (r.rank = i + 1));
    // Los rangos de una habilidad comparten familia de efectos: la mascara de clase debe ser la misma
    const masks = new Set(ranks.map((r) => r.classMask.join(",")));
    if (masks.size > 1) warnings.push(`${name}: sus rangos tienen mascaras de clase distintas (${[...masks].join(" | ")})`);
    abilities.push({ name, iconFileDataId: iconOf.get(name) ?? null, ranks, talentsForever: null });
  }
  abilities.sort((a, b) => a.ranks[0]!.level - b.ranks[0]!.level || a.name.localeCompare(b.name));

  return { schemaVersion: 1, build, locale, classId, familySet, abilities, warnings };
}
