import type { ClassicEra } from "./stats.js";

export const STAT_NAMES = ["str", "agi", "sta", "int", "spi"] as const;
const HUMAN = 1;
const GNOME = 7;
/** Atributos con un porcentaje racial ya aplicado en Classic (no comparables entre razas): espiritu del Humano, intelecto del Gnomo. */
const isBaked = (race: number, stat: number): boolean => (race === HUMAN && stat === 4) || (race === GNOME && stat === 3);

export interface Anomaly {
  raceId: number;
  classId: number;
  level: number;
  stat: (typeof STAT_NAMES)[number];
  value: number;
  /** Lo que darian las demas razas (mediana de su valor + la diferencia racial tipica). */
  expected: number;
  /** true = se ha corregido (solo intercambios de intelecto/espiritu demostrables); false = se deja el valor de la fuente. */
  corrected: boolean;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/**
 * Busca valores aislados que no encajan: en Classic la diferencia entre dos razas de la misma clase es casi constante
 * en todos los niveles, asi que un nivel cuya diferencia se aparta >= 2 de la tipica frente a (casi) todas las demas
 * razas es un error de la fuente (cmangos reconstruye estas tablas a partir de datos del juego). Solo se corrige el
 * intercambio inequivoco de intelecto y espiritu (ambos encajan al darles la vuelta); lo demas se informa.
 * Opera sobre una copia: `levelStats` no se modifica; devuelve la copia corregida y la lista.
 */
export function auditLevelStats(source: ClassicEra["levelStats"]): { levelStats: ClassicEra["levelStats"]; anomalies: Anomaly[] } {
  const levelStats: ClassicEra["levelStats"] = JSON.parse(JSON.stringify(source));
  const races = Object.keys(levelStats).map(Number);
  type Flag = { raceId: number; classId: number; level: number; stat: number; expected: number };
  const flags: Flag[] = [];

  for (const r of races) {
    for (const cls of Object.keys(levelStats[r]!)) {
      const rows = levelStats[r]![cls]!;
      for (let s = 0; s < 5; s++) {
        const votes = new Array<number>(rows.length).fill(0);
        const guesses: number[][] = rows.map(() => []);
        let others = 0;
        for (const o of races) {
          const orows = levelStats[o]?.[cls];
          if (o === r || !orows || isBaked(o, s) || isBaked(r, s)) continue;
          others++;
          const deltas = rows.map((row, l) => row[s]! - orows[l]![s]!);
          const typical = median(deltas);
          deltas.forEach((d, l) => {
            guesses[l]!.push(orows[l]![s]! + typical);
            if (Math.abs(d - typical) >= 2) votes[l]!++;
          });
        }
        if (others === 0) continue;
        votes.forEach((v, l) => {
          if (v >= Math.max(1, Math.ceil(others * 0.7))) flags.push({ raceId: r, classId: Number(cls), level: l + 1, stat: s, expected: median(guesses[l]!) });
        });
      }
    }
  }

  const anomalies: Anomaly[] = [];
  const done = new Set<Flag>();
  for (const f of flags) {
    if (done.has(f)) continue;
    // Intercambio inteligencia <-> espiritu en la misma fila
    const twin = flags.find((g) => g !== f && g.raceId === f.raceId && g.classId === f.classId && g.level === f.level && g.stat === (f.stat === 3 ? 4 : 3) && f.stat >= 3);
    const row = levelStats[f.raceId]![String(f.classId)]![f.level - 1]!;
    if (twin && Math.abs(row[4]! - (f.stat === 3 ? f.expected : twin.expected)) <= 1 && Math.abs(row[3]! - (f.stat === 3 ? twin.expected : f.expected)) <= 1) {
      const [intFlag, spiFlag] = f.stat === 3 ? [f, twin] : [twin, f];
      anomalies.push(
        { raceId: f.raceId, classId: f.classId, level: f.level, stat: "int", value: row[3]!, expected: intFlag.expected, corrected: true },
        { raceId: f.raceId, classId: f.classId, level: f.level, stat: "spi", value: row[4]!, expected: spiFlag.expected, corrected: true },
      );
      [row[3], row[4]] = [row[4]!, row[3]!];
      done.add(f).add(twin);
      continue;
    }
    anomalies.push({ raceId: f.raceId, classId: f.classId, level: f.level, stat: STAT_NAMES[f.stat]!, value: row[f.stat]!, expected: f.expected, corrected: false });
    done.add(f);
  }
  anomalies.sort((a, b) => a.raceId - b.raceId || a.classId - b.classId || a.level - b.level);
  return { levelStats, anomalies };
}
