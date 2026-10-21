import type { BaseStats, Races } from "./model.js";
import { FOREVER_RACE_OFFSETS, RACE_OFFSETS_SOURCE } from "./race-offsets.js";
import { auditLevelStats } from "./stats-audit.js";

/** Contenido de data/external/classic-stats/classic-era.json (lo genera tools/extract/fetch-classic-stats.mjs). */
export interface ClassicEra {
  source: string;
  url: string;
  commit: string;
  license: string;
  stats: string[];
  levelStats: Record<string, Record<string, number[][]>>;
  classBase: Record<string, { hp: number[]; mana: number[] }>;
}

/** La beta de Forever solo llega al nivel 30 (dato del usuario, 2026-10-16); Classic llega al 60. */
const BETA_MAX_LEVEL = 30;

/**
 * Las tablas de Classic llevan ya aplicado el +5 % del espiritu del Humano; en Forever es una racial ("El espiritu humano",
 * client-db2) que el motor aplica aparte, asi que se retira de TODAS las filas, tambien de las del Humano. `unbake` busca la x
 * cuyo `bake(x)` (x * 1,05 hacia abajo) es el valor de Classic.
 */
const HUMAN = 1;
/** x * 1,05 hacia abajo con aritmetica entera: asi sale el espiritu del Humano en Classic (Paladin 75 -> 78, Brujo 115 -> 120, Picaro 50 -> 52). */
const bake = (x: number): number => Math.floor((21 * x) / 20);
const unbake = (v: number): number => {
  for (let x = v; x >= v - 12; x--) if (bake(x) === v) return x;
  return Math.round(v / 1.05);
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const GNOME = 7;

/**
 * Estadisticas base de cada raza/clase de Forever.
 *
 * Modelo (el de Forever segun la comunidad, contrastado con Classic): atributos de la raza = base de la clase "como Humano,
 * sin racial" + desplazamiento de la raza (`race-offsets.ts`, constante por nivel). La base de la clase sale de las tablas de
 * Classic Era del Humano (coinciden con las hojas de Forever a nivel 60 en las clases que comparten); el espiritu del Humano de
 * Classic lleva su +5 % ya aplicado y se retira (en Forever es una racial que el motor aplica aparte). Las clases sin Humano en Classic (Cazador, Chaman, Druida)
 * toman la base de otra raza de Classic restandole la diferencia racial de Classic (mediana sobre las clases compartidas con el
 * Humano). Intelecto del Gnomo = base + 3 (exacto: su +5 % de Classic no existe en Forever, la Mente expansiva da +5 % de mana).
 */
export function buildBaseStats(races: Races, classic: ClassicEra, build: string): BaseStats {
  const warnings: string[] = [];
  const maxLevel = 60;
  // Auditoria de la fuente: se corrigen los intercambios inequivocos y se informa del resto (ver stats-audit.ts)
  const { levelStats, anomalies: sourceAnomalies } = auditLevelStats(classic.levelStats);
  const classicRow = (race: number, cls: number): number[][] | null => levelStats[race]?.[cls] ?? null;
  const racesWithData = Object.keys(levelStats).map(Number);

  // Base "Humano sin racial" de las clases que el Humano tiene en Classic
  const humanPre = (cls: number): number[][] | null => {
    const rows = classicRow(HUMAN, cls);
    return rows ? rows.map((r) => [r[0]!, r[1]!, r[2]!, r[3]!, unbake(r[4]!)]) : null;
  };
  const sharedWithHuman = Object.keys(levelStats[HUMAN] ?? {}).map(Number);
  /** Diferencia racial de Classic respecto al Humano (sin racial): mediana de todos los niveles y clases compartidas. */
  const classicDelta = (race: number): number[] | null => {
    const diffs: number[][] = [[], [], [], [], []];
    for (const cls of sharedWithHuman) {
      const a = classicRow(race, cls);
      const h = humanPre(cls);
      if (!a || !h) continue;
      for (let l = 0; l < maxLevel; l++) for (let i = 0; i < 5; i++) diffs[i]!.push(a[l]![i]! - h[l]![i]!);
    }
    return diffs[0]!.length === 0 ? null : diffs.map(median);
  };

  // Base de cada clase y, si no es la del Humano, de que raza de Classic se dedujo
  const basePre = new Map<number, { rows: number[][]; derivedFrom: number | null }>();
  const classIds = [...new Set(races.races.flatMap((r) => r.classIds))].sort((a, b) => a - b);
  for (const cls of classIds) {
    const own = humanPre(cls);
    if (own) {
      basePre.set(cls, { rows: own, derivedFrom: null });
      continue;
    }
    // El intelecto del Gnomo lleva el +5 % de Classic: no sirve de referencia
    for (const ref of racesWithData.filter((r) => r !== HUMAN && r !== GNOME)) {
      const rows = classicRow(ref, cls);
      const delta = rows ? classicDelta(ref) : null;
      if (!rows || !delta) continue;
      basePre.set(cls, { rows: rows.map((row) => row.map((v, i) => Math.max(0, v - delta[i]!))), derivedFrom: ref });
      break;
    }
  }

  const combos: BaseStats["combos"] = [];
  const missing: BaseStats["missing"] = [];
  const usedSources = new Set<string>();
  for (const race of races.races) {
    const offset = FOREVER_RACE_OFFSETS[race.id];
    for (const classId of race.classIds) {
      const base = basePre.get(classId);
      if (!base || !offset) {
        missing.push({ raceId: race.id, classId });
        continue;
      }
      usedSources.add(`${base.derivedFrom ?? HUMAN}/${classId}`);
      // El espiritu del Humano va SIN su +5 %: en Forever es una racial ("El espiritu humano") que el motor aplica aparte
      const stats = base.rows.map((row) => row.map((v, i) => Math.max(0, v + offset[i]!)));
      const hadClassicRow = !!classicRow(race.id, classId);
      const isNew = race.id <= 8 && !hadClassicRow; // combinacion que Classic no tenia (las 6 nuevas de Forever)
      const notes: string[] = [];
      if (race.id === GNOME) notes.push("Forever: Mente expansiva del Gnomo da +5 % de mana maximo, no de intelecto (el +5 % de Classic se retira: intelecto = base del Humano + 3).");
      if (race.id === HUMAN) notes.push("Espiritu sin el +5 % de El espiritu humano: es una racial y se aplica aparte (Classic lo traia ya sumado; la comunidad lee 20 de espiritu a nivel 1 en la hoja del Humano).");
      if (race.id >= 95) notes.push("Cielonato: sin datos de Classic; base del Humano + diferencia medida en la beta por la comunidad (-1 fuerza, +1 agilidad, -1 aguante, +1 intelecto).");
      if (base.derivedFrom !== null) notes.push(`La base de esta clase no existia para el Humano en Classic: se deduce de la raza ${base.derivedFrom} de Classic.`);
      combos.push({
        raceId: race.id,
        classId,
        provenance: isNew ? "assumption" : "community",
        derivedFromRaceId: isNew || base.derivedFrom !== null ? base.derivedFrom : null,
        note: notes.length > 0 ? notes.join(" ") : null,
        stats,
      });
    }
  }

  // Solo se informa de los valores dudosos de las filas de Classic que de verdad se usan
  const anomalies = sourceAnomalies.filter((a) => usedSources.has(`${a.raceId}/${a.classId}`));
  if (missing.length > 0) warnings.push(`Sin estadisticas para ${missing.length} combinaciones raza/clase`);

  const classBase = classIds.flatMap((classId) => {
    const c = classic.classBase[classId];
    if (!c) {
      warnings.push(`Sin vida/mana base para la clase ${classId}`);
      return [];
    }
    return [{ classId, hp: c.hp, mana: c.mana }];
  });

  return {
    schemaVersion: 1,
    build,
    source: { name: "Estadísticas base de Classic Era (comunidad)", url: "", commit: "", license: "Solo se usan cifras" },
    raceOffsets: {
      source: RACE_OFFSETS_SOURCE,
      provenance: "community",
      note: "Diferencias de raza medidas en la beta por la comunidad en hojas de nivel 1 (sin raciales multiplicativas); sustituyen a las de Classic. Se suponen constantes por nivel.",
      offsets: Object.entries(FOREVER_RACE_OFFSETS).map(([raceId, delta]) => ({ raceId: Number(raceId), delta })),
    },
    statNames: classic.stats,
    maxLevel,
    betaMaxLevel: BETA_MAX_LEVEL,
    classBase,
    anomalies,
    combos,
    missing,
    warnings,
  };
}
