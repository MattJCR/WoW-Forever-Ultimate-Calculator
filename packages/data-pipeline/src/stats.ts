import type { BaseStats, Races } from "./model.js";
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
 * Las tablas de Classic llevan ya aplicado el porcentaje racial de atributo. Auditados todos los atributos de las 8 razas
 * (la diferencia entre razas deberia ser constante por nivel): solo hay dos, el espiritu del Humano (+5 %, sigue igual en
 * Forever: no hay que sumarlo otra vez) y el intelecto del Gnomo (+5 %, Mente expansiva).
 *
 * En Forever la Mente expansiva del Gnomo da +5 % de mana maximo (client-db2), NO de intelecto, asi que su intelecto debe
 * ser el de la base sin bono. Se reconstruye exacto, no dividiendo: la base racial es una constante respecto al Humano,
 * `intelectoGnomo(nivel) = intelectoHumano(nivel) + D`, y el valor de Classic es esa base * 1,05 redondeada. Se busca la
 * D que reproduce los valores de Classic de todas las clases y niveles; si no llega al umbral, se cae a dividir entre 1,05.
 */
const GNOME = 7;
const HUMAN = 1;
const FIT_THRESHOLD = 0.95;
/** Redondeo al entero mas cercano de x * 1,05 con aritmetica entera (sin errores de coma flotante). */
const bake = (x: number): number => Math.floor((21 * x + 10) / 20);

/** D tal que bake(humano + D) = gnomo en el mayor numero de (clase, nivel); devuelve D y cuantos aciertos de cuantos. */
function fitGnomeIntOffset(levelStats: ClassicEra["levelStats"]): { d: number; hits: number; total: number } | null {
  const gnome = levelStats[GNOME];
  const human = levelStats[HUMAN];
  if (!gnome || !human) return null;
  let best: { d: number; hits: number; total: number } | null = null;
  for (let d = -10; d <= 10; d++) {
    let hits = 0;
    let total = 0;
    for (const [cls, rows] of Object.entries(gnome)) {
      const h = human[cls];
      if (!h) continue;
      for (let l = 0; l < rows.length; l++) {
        total++;
        if (bake(h[l]![3]! + d) === rows[l]![3]) hits++;
      }
    }
    if (total > 0 && (!best || hits > best.hits)) best = { d, hits, total };
  }
  return best;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Estadisticas base de cada raza/clase de Forever a partir de Classic Era. Las combinaciones que Classic no tenia
 * (Humano cazador, Enano chaman, Gnomo sacerdote, Orco mago, No-muerto paladin, Trol brujo) se estiman: la clase de
 * otra raza mas la diferencia racial (mediana sobre todas las clases y niveles que comparten). Error tipico: +-1.
 * Cielonato (95/96) no tiene ningun dato y queda en `missing`.
 */
export function buildBaseStats(races: Races, classic: ClassicEra, build: string): BaseStats {
  const warnings: string[] = [];
  const maxLevel = 60;
  // Auditoria de la fuente: se corrigen los intercambios inequivocos y se informa del resto (ver stats-audit.ts)
  const { levelStats, anomalies } = auditLevelStats(classic.levelStats);
  // Intelecto del Gnomo sin el +5 % que Classic ya traia (ver arriba)
  const fit = fitGnomeIntOffset(levelStats);
  const exactFit = !!fit && fit.hits / fit.total >= FIT_THRESHOLD;
  for (const [cls, rows] of Object.entries(levelStats[GNOME] ?? {})) {
    const human = levelStats[HUMAN]?.[cls];
    rows.forEach((row, l) => {
      row[3] = exactFit && human ? human[l]![3]! + fit!.d : Math.round(row[3]! / 1.05);
    });
  }
  const gnomeNote = exactFit
    ? `Forever: Mente expansiva del Gnomo da +5 % de mana maximo, no de intelecto. Intelecto sin ese bono = intelecto del Humano ${fit!.d >= 0 ? "+" : "-"} ${Math.abs(fit!.d)} (reproduce ${fit!.hits} de ${fit!.total} valores de Classic al aplicarle el +5 %; la base exacta de Forever solo se sabra con datos de Forever).`
    : "Forever: Mente expansiva del Gnomo da +5 % de mana maximo, no de intelecto; se retira del intelecto de Classic (valor / 1,05, aproximado).";
  if (fit && !exactFit) warnings.push(`Intelecto del Gnomo: la base exacta solo reproduce ${fit.hits}/${fit.total} valores de Classic (< ${FIT_THRESHOLD * 100} %); se usa la division por 1,05`);
  const exact = (race: number, cls: number) => levelStats[race]?.[cls] ?? null;
  const racesWithData = Object.keys(levelStats).map(Number);

  const raceDelta = (race: number, ref: number): number[] | null => {
    const diffs: number[][] = [[], [], [], [], []];
    for (const cls of Object.keys(levelStats[race] ?? {})) {
      const a = levelStats[race]![cls]!;
      const b = levelStats[ref]?.[cls];
      if (!b) continue;
      for (let l = 0; l < maxLevel; l++) for (let i = 0; i < 5; i++) diffs[i]!.push(a[l]![i]! - b[l]![i]!);
    }
    return diffs[0]!.length === 0 ? null : diffs.map(median);
  };

  const combos: BaseStats["combos"] = [];
  const missing: BaseStats["missing"] = [];
  for (const race of races.races) {
    for (const classId of race.classIds) {
      const hit = exact(race.id, classId);
      if (hit) {
        const gnome = race.id === GNOME;
        combos.push({ raceId: race.id, classId, provenance: gnome ? "assumption" : "community", derivedFromRaceId: null, note: gnome ? gnomeNote : null, stats: hit });
        continue;
      }
      // Sin fila en Classic: otra raza con esa clase + diferencia racial
      let made = false;
      if (racesWithData.includes(race.id)) {
        for (const ref of racesWithData) {
          const base = exact(ref, classId);
          const delta = base ? raceDelta(race.id, ref) : null;
          if (!base || !delta) continue;
          combos.push({
            raceId: race.id,
            classId,
            provenance: "assumption",
            derivedFromRaceId: ref,
            note: race.id === GNOME ? gnomeNote : null,
            stats: base.map((row) => row.map((v, i) => Math.max(0, v + delta[i]!))),
          });
          made = true;
          break;
        }
      }
      if (!made) missing.push({ raceId: race.id, classId });
    }
  }
  const unknown = [...new Set(missing.map((m) => m.raceId))].filter((id) => !racesWithData.includes(id));
  if (unknown.length > 0) warnings.push(`Sin estadisticas para las razas ${unknown.join(", ")} (no existen en Classic Era)`);

  const classIds = [...new Set(races.races.flatMap((r) => r.classIds))].sort((a, b) => a - b);
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
    source: { name: classic.source, url: classic.url, commit: classic.commit, license: classic.license },
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
