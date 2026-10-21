import { deriveStats, type StatEffects } from "@wfuc/engine";
import type { BaseStats, ClientStats, Manifest } from "@wfuc/schema";
import { BaseStats as BaseStatsSchema, ClientStats as ClientStatsSchema } from "@wfuc/schema";
import { getJson, useAsync } from "../data";

/**
 * Estadisticas brutas base de la raza y clase escogidas, a tres niveles (el minimo que exigen los talentos, el 30 de
 * la beta y el 60). No vienen del cliente de Forever sino de Classic Era (ver DATA-FINDINGS): se marcan como estimacion.
 */
/** Equipo que se suma: sus estadisticas y el nivel minimo al que se puede llevar todo (las columnas de nivel menor no lo llevan). */
export interface GearForStats {
  stats: Record<string, number>;
  minLevel: number;
}

export function StatsTable({ manifest, raceId, raceName, classId, level, fx, gear }: { manifest: Manifest; raceId: number | null; raceName: string | null; classId: number; level: number; fx: StatEffects | null; gear?: GearForStats | null }) {
  const state = useAsync(manifest.stats.file, () => getJson(manifest.stats.file, (v) => BaseStatsSchema.parse(v)));
  const clientEntry = manifest.clientStats;
  const clientState = useAsync(clientEntry?.file ?? "none", () => (clientEntry ? getJson(clientEntry.file, (v) => ClientStatsSchema.parse(v)) : Promise.resolve(null)));
  const client = clientState.status === "ready" ? clientState.value : null;
  if (raceId === null) return <p className="muted">Elige una raza en el paso «Raza» para ver las estadísticas base.</p>;
  if (state.status === "loading") return <p className="muted">Cargando estadísticas…</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;
  return <Table data={state.value} raceId={raceId} raceName={raceName} classId={classId} level={level} fx={fx} client={client} gear={gear ?? null} />;
}

const fmt = (n: number): string => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

function Table({ data, raceId, raceName, classId, level, fx, client, gear }: { data: BaseStats; raceId: number; raceName: string | null; classId: number; level: number; fx: StatEffects | null; client: ClientStats | null; gear: GearForStats | null }) {
  const combo = data.combos.find((c) => c.raceId === raceId && c.classId === classId);
  const base = data.classBase.find((c) => c.classId === classId);
  if (!combo || !base) {
    return (
      <p className="muted">
        Sin estadísticas base para {raceName ?? "esta raza"}: no existe en Classic Era y el cliente de la beta no las trae (los valores se calculan en el servidor).
      </p>
    );
  }
  // Maná base de Forever: lo trae el cliente (PlayerExpectedStat); la vida base sigue siendo la de Classic
  const clientClass = client?.classes.find((c) => c.classId === classId) ?? null;
  const manaAt = (l: number): number => clientClass?.levels.find((x) => x.level === l)?.baseMana ?? base.mana[l - 1]!;
  // Valores finales a este nivel, con los % de talentos, Legacy y raza y el equipo ya aplicados
  const derived = fx
    ? deriveStats({
        attributes: combo.stats[level - 1] as [number, number, number, number, number],
        hpBase: base.hp[level - 1]!,
        manaBase: manaAt(level),
        totals: fx.totals,
        gear: gear && level >= gear.minLevel ? gear.stats : null,
        attackPower: clientClass ? { perStrength: clientClass.attackPowerPerStrength, perAgility: clientClass.attackPowerPerAgility, rangedPerAgility: clientClass.rangedAttackPowerPerAgility } : null,
      })
    : null;
  if (!derived) return <p className="muted">Cargando talentos…</p>;
  return (
    <>
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">Estadística</th>
            <th scope="col">Nivel {level}</th>
          </tr>
        </thead>
        <tbody>
          {derived.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td className={r.final !== r.base ? "pos" : undefined}>
                <b>{fmt(r.final)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        <span className="tag tag-unassigned">Cliente + Classic · estimación</span> Valores finales con tus talentos, Puntos de Legado, raza y equipo ya aplicados, redondeados hacia abajo. La base de atributos y la vida salen de Classic Era más la diferencia de raza medida por la comunidad (la beta solo llega al nivel {data.betaMaxLevel}); porcentajes, maná base, poder de ataque y crítico por atributo son del cliente. El equipo solo cuenta desde el nivel que exige el objeto más exigente{gear ? ` (nivel ${gear.minLevel})` : ""}.
      </p>
    </>
  );
}
