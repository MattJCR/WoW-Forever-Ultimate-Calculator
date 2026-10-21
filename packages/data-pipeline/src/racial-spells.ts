import { int, type RawTables } from "./csv.js";
import type { RacialEffect, RacialSpell, RacialTrinketShare } from "./model.js";
import type { SpellTables } from "./spell-tables.js";

/**
 * SkillLine del cliente que da las habilidades raciales de cada raza (SkillLineAbility, AcquireMethod 2).
 * Cielonato (95 y 96) comparte la 2980; cada raza ve sus hechizos por RaceMasks[1].
 */
export const RACIAL_SKILL_LINES: Record<number, number> = { 1: 754, 2: 125, 3: 101, 4: 126, 5: 220, 6: 124, 7: 753, 8: 733, 95: 2980, 96: 2980 };

/**
 * Hechizo(s) del cliente de cada racial, en el orden de ChrRaceRacialAbility (0..3). ChrRaceRacialAbility solo trae
 * texto, asi que el enlace se hizo a mano por nombre/descripcion; el pipeline comprueba que cada hechizo esta de verdad
 * en la SkillLine racial de la raza (si no, avisa). Varios IDs = una variante por clase (ClassMask).
 */
export const RACIAL_SPELLS: Record<number, number[][]> = {
  1: [[1259718], [20600], [20597], [20598]], // Humano
  2: [[20572], [1299026], [20574], [20573]], // Orco
  3: [[20594], [2481], [1259719], [1259721]], // Enano
  4: [[1259799], [20580], [20582], [20585]], // Elfo de la noche
  5: [[7744], [20577], [5227], [1260189, 1260201]], // No-muerto
  6: [[20549], [20552], [1259918], [20550]], // Tauren
  7: [[20589], [1259812, 1259813, 1259817, 1259821, 1259823], [20591, 1259802, 1259803], [20593]], // Gnomo
  8: [[20554], [1260270], [20557], [20555]], // Trol
  95: [[1259416], [1259705], [1259710], [1259707]], // Cielonato (Orden Eminente)
  96: [[1259416], [1259686], [1259710], [1259707]], // Cielonato (Formavientos)
};

/** Aura del cliente -> significado. Cada una se comprobo contra el texto de las raciales que la usan. */
const AURA_KINDS: Record<number, RacialEffect["kind"]> = {
  290: "crit-chance",
  178: "max-power-pct",
  133: "health-pct",
  163: "crit-damage-bonus",
  50: "crit-healing-bonus",
  49: "dodge-pct",
  168: "damage-vs-creature",
  166: "attack-power-pct",
  167: "ranged-attack-power-pct",
  317: "spell-power-pct",
  65: "haste-spell-pct",
  319: "haste-melee-pct",
  140: "haste-ranged-pct",
  342: "haste-melee-ranged-pct",
  88: "health-regen-pct",
  116: "health-regen-combat-pct",
  87: "damage-taken-pct",
  108: "spell-modifier-pct",
  110: "mana-regen-pct",
  31: "movement-speed-pct",
  129: "movement-speed-pct",
  172: "mounted-speed-pct",
  130: "mounted-speed-pct",
  20: "periodic-health-pct",
  21: "periodic-mana-pct",
};
/** Toque de la tumba (no-muerto, una variante por clase): el efecto es un aura "dummy" cuyo valor es el % de salud maxima. */
const DUMMY_KINDS: Record<number, RacialEffect["kind"]> = { 1260189: "proc-drain-health-pct", 1260201: "proc-drain-health-pct" };
const AURA_DUMMY = 4;
const AURA_STAT_PCT = 137; // MOD_TOTAL_STAT_PERCENTAGE: solo el espiritu (miscValue 4) esta comprobado
const AURA_MECHANIC_DURATION = 232; // MOD_MECHANIC_DURATION: solo el aturdimiento (miscValue 12)

function classify(aura: number, misc: number | null): RacialEffect["kind"] {
  if (aura === AURA_STAT_PCT) return misc === 4 ? "spirit-pct" : null;
  if (aura === AURA_MECHANIC_DURATION) return misc === 12 ? "stun-duration-pct" : null;
  return AURA_KINDS[aura] ?? null;
}

/** Efectos de aura del hechizo (los que no son aura, como curar o disipar, no entran en el calculo). */
function effectsOf(spells: SpellTables, spellId: number, fromSpellId: number | null = null): RacialEffect[] {
  const out: RacialEffect[] = [];
  for (let i = 0; i < spells.effectCount(spellId); i++) {
    const e = spells.effect(spellId, i)!;
    const aura = int(e.EffectAura);
    if (aura === 0) continue;
    const misc = int(e["EffectMiscValue[0]"]);
    const kind = aura === AURA_DUMMY ? (DUMMY_KINDS[spellId] ?? null) : classify(aura, misc);
    out.push({ kind, aura, value: Number(e.EffectBasePointsF), miscValue: misc || null, periodMs: int(e.EffectAuraPeriod) || null, fromSpellId });
  }
  return out;
}

/**
 * Hechizos a los que remite el texto con `$NNNNsN`, `$NNNNd` o `$NNNNtN` (p. ej. Leyline remite a "Energizado"): su valor
 * vive alli. De ellos solo se conservan los efectos que el motor sabe interpretar.
 */
function referencedEffects(spells: SpellTables, spellId: number): RacialEffect[] {
  const refs = new Set<number>();
  for (const m of spells.description(spellId).matchAll(/\$(\d+)[sdt]\d?/g)) refs.add(Number(m[1]));
  refs.delete(spellId);
  const out: RacialEffect[] = [];
  for (const ref of refs) {
    for (const e of effectsOf(spells, ref, ref)) {
      // El mismo efecto en dos hechizos (p. ej. Leyline: con y sin nexo cerca) se cuenta una vez
      if (e.kind !== null && !out.some((o) => o.kind === e.kind && o.value === e.value && o.miscValue === e.miscValue && o.periodMs === e.periodMs)) out.push(e);
    }
  }
  return out;
}

/** Duracion: la del propio hechizo o, si la lleva otro (marcador `$26635d` de la descripcion), la de ese. */
function durationOf(spells: SpellTables, spellId: number): number | null {
  const own = spells.durationMs(spellId);
  if (own !== null) return own;
  const ref = /\$(\d+)d/.exec(spells.description(spellId));
  return ref ? spells.durationMs(Number(ref[1])) : null;
}

export function racialSpells(raw: RawTables, spells: SpellTables, raceId: number, order: number, warnings: string[]): RacialSpell[] {
  const ids = RACIAL_SPELLS[raceId]?.[order] ?? [];
  const skill = RACIAL_SKILL_LINES[raceId];
  const granted = new Map<number, { classMask: number }>();
  for (const r of raw.table("SkillLineAbility")) {
    if (int(r.SkillLine) === skill) granted.set(int(r.Spell), { classMask: int(r.ClassMask) });
  }
  return ids.map((spellId) => {
    const g = granted.get(spellId);
    if (!g) warnings.push(`Raza ${raceId} racial ${order}: el hechizo ${spellId} no esta en la SkillLine ${skill}`);
    return {
      spellId,
      // ClassMask 0 o -1 (todas) -> 0
      classMask: g && g.classMask > 0 ? g.classMask : 0,
      durationMs: durationOf(spells, spellId),
      cooldownMs: spells.cooldownMs(spellId),
      procChance: DUMMY_KINDS[spellId] ? spells.aura(spellId)?.procChance || null : null,
      procCooldownMs: DUMMY_KINDS[spellId] ? spells.aura(spellId)?.procCooldownMs || null : null,
      effects: [...effectsOf(spells, spellId), ...referencedEffects(spells, spellId)],
    };
  });
}

/** Categoria de enfriamiento del cliente de las insignias/abalorios de PvP ("PvP CC Removal Trinket", SpellCategory 2269). */
export const PVP_TRINKET_CATEGORY = 2269;
const AURA_MECHANIC_IMMUNITY = 77;
const EFFECT_DISPEL_MECHANIC = 108;
/** SpellMechanic del cliente -> nombre en espanol (solo los que quitan las insignias o raciales de control). */
const MECHANIC_NAMES: Record<number, string> = { 1: "embelesamiento", 5: "miedo", 7: "inmovilización", 10: "sueño", 11: "ralentización", 12: "aturdimiento", 17: "polimorfia" };

/** Mecanicas de control que quita un hechizo: inmunidad a la mecanica (aura 77) o disipar la mecanica (efecto 108). */
function removedMechanics(spells: SpellTables, spellId: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < spells.effectCount(spellId); i++) {
    const e = spells.effect(spellId, i)!;
    if (int(e.EffectAura) === AURA_MECHANIC_IMMUNITY || int(e.Effect) === EFFECT_DISPEL_MECHANIC) {
      const m = int(e["EffectMiscValue[0]"]);
      if (m > 0) out.add(m);
    }
  }
  return out;
}

/**
 * Posible enfriamiento compartido de una racial activa con la insignia de PvP. El cliente no enlaza ninguna racial con la
 * categoria de la insignia (se comprobo en las 1161 tablas DB2 del build 70450), asi que solo se avisa, como `assumption`,
 * de las raciales que quitan el mismo control que la insignia: el calculo sale de las mecanicas del cliente, no de una lista a mano.
 */
export function pvpTrinketShare(raw: RawTables, spells: SpellTables, racialSpellIds: number[]): RacialTrinketShare | null {
  const trinketSpells = raw.table("SpellCategories").filter((r) => int(r.Category) === PVP_TRINKET_CATEGORY).map((r) => int(r.SpellID));
  if (trinketSpells.length === 0) return null;
  const trinketMechanics = new Set<number>();
  for (const id of trinketSpells) for (const m of removedMechanics(spells, id)) trinketMechanics.add(m);
  const overlaps = new Set<number>();
  for (const id of racialSpellIds) for (const m of removedMechanics(spells, id)) if (trinketMechanics.has(m)) overlaps.add(m);
  if (overlaps.size === 0) return null;
  // Insignia clasica: la de mayor enfriamiento entre las que usan la categoria (5 min)
  const trinketCooldownMs = Math.max(...trinketSpells.map((id) => spells.cooldownMs(id) ?? 0));
  return {
    status: "unconfirmed",
    provenance: "assumption",
    overlaps: [...overlaps].sort((a, b) => a - b).map((m) => MECHANIC_NAMES[m] ?? `mecánica ${m}`),
    trinketCooldownMs,
  };
}
