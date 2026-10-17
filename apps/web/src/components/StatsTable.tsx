import { deriveStats, type StatEffects } from "@wfuc/engine";
import type { BaseStats, ClientStats, Manifest } from "@wfuc/schema";
import { BaseStats as BaseStatsSchema, ClientStats as ClientStatsSchema } from "@wfuc/schema";
import { useMemo } from "react";
import { getJson, useAsync } from "../data";

const STAT_LABELS = ["Fuerza", "Agilidad", "Aguante", "Intelecto", "Espíritu"];

/**
 * Estadisticas brutas base de la raza y clase escogidas, a tres niveles (el minimo que exigen los talentos, el 30 de
 * la beta y el 60). No vienen del cliente de Forever sino de Classic Era (ver DATA-FINDINGS): se marcan como estimacion.
 */
export function StatsTable({ manifest, raceId, raceName, classId, minLevel, fx }: { manifest: Manifest; raceId: number | null; raceName: string | null; classId: number; minLevel: number; fx: StatEffects | null }) {
  const state = useAsync(manifest.stats.file, () => getJson(manifest.stats.file, (v) => BaseStatsSchema.parse(v)));
  const clientEntry = manifest.clientStats;
  const clientState = useAsync(clientEntry?.file ?? "none", () => (clientEntry ? getJson(clientEntry.file, (v) => ClientStatsSchema.parse(v)) : Promise.resolve(null)));
  const client = clientState.status === "ready" ? clientState.value : null;
  if (raceId === null) return <p className="muted">Elige una raza en el paso «Raza» para ver las estadísticas base.</p>;
  if (state.status === "loading") return <p className="muted">Cargando estadísticas…</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;
  return <Table data={state.value} raceId={raceId} raceName={raceName} classId={classId} minLevel={minLevel} fx={fx} client={client} />;
}

const fmt = (n: number): string => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

function Table({ data, raceId, raceName, classId, minLevel, fx, client }: { data: BaseStats; raceId: number; raceName: string | null; classId: number; minLevel: number; fx: StatEffects | null; client: ClientStats | null }) {
  const combo = data.combos.find((c) => c.raceId === raceId && c.classId === classId);
  const base = data.classBase.find((c) => c.classId === classId);
  const issues = data.anomalies.filter((a) => a.raceId === raceId && a.classId === classId);
  const levels = useMemo(() => [...new Set([Math.max(1, minLevel), data.betaMaxLevel, data.maxLevel])].sort((a, b) => a - b), [data, minLevel]);
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
  const rows: { label: string; at: (level: number) => number }[] = [
    ...STAT_LABELS.map((label, i) => ({ label, at: (l: number) => combo.stats[l - 1]![i]! })),
    { label: "Vida base", at: (l) => base.hp[l - 1]! },
    { label: clientClass ? "Maná base (cliente)" : "Maná base", at: manaAt },
  ];
  // Con los % de talentos, Legacy y raza ya aplicados (cada nivel por separado: la vida y el maná dependen del aguante y el intelecto de ese nivel)
  const derived = fx
    ? levels.map((l) => deriveStats({
          attributes: combo.stats[l - 1] as [number, number, number, number, number],
          hpBase: base.hp[l - 1]!,
          manaBase: manaAt(l),
          totals: fx.totals,
          attackPower: clientClass ? { perStrength: clientClass.attackPowerPerStrength, perAgility: clientClass.attackPowerPerAgility, rangedPerAgility: clientClass.rangedAttackPowerPerAgility } : null,
        }))
    : null;
  const changed = derived?.[0]?.rows.filter((_, i) => derived.some((d) => d.rows[i]!.final !== d.rows[i]!.base)) ?? [];
  return (
    <>
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">Estadística</th>
            {levels.map((l) => (
              <th key={l} scope="col">
                Nivel {l}
                {l === data.betaMaxLevel ? <small> (tope beta)</small> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {levels.map((l) => (
                <td key={l}>{r.at(l)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {derived && (
        <>
          <h5 className="fx-sub">Con tus talentos, Legacy y raza</h5>
          <table className="stats-table">
            <thead>
              <tr>
                <th scope="col">Estadística</th>
                {levels.map((l) => (
                  <th key={l} scope="col">
                    Nivel {l}
                  </th>
                ))}
                <th scope="col">Procede de</th>
              </tr>
            </thead>
            <tbody>
              {derived[0]!.rows.map((r, i) => {
                const mod = derived.some((d) => d.rows[i]!.final !== d.rows[i]!.base);
                return (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    {derived.map((d, k) => {
                      const row = d.rows[i]!;
                      return (
                        <td key={levels[k]} className={mod ? "pos" : undefined}>
                          <b>{fmt(row.final)}</b>
                          {row.final !== row.base && <small className="muted"> ({fmt(row.base)}{row.bonusPct !== 0 ? ` +${fmt(row.bonusPct)} %` : ""}{row.flat !== 0 ? ` +${fmt(row.flat)}` : ""})</small>}
                        </td>
                      );
                    })}
                    <td>
                      {[...new Map(r.sources.map((s) => [s.name, s])).values()].map((s) => (
                        <span key={s.name} className="chip">
                          {s.maxRank > 1 ? `${s.name} ${s.rank}/${s.maxRank}` : s.name}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            <span className="tag tag-unassigned">Cliente + Classic · estimación</span> Los porcentajes, el maná base, el poder de ataque por atributo y el crítico por atributo son del cliente. La vida base y la regla de vida (10 por aguante) y maná (15 por intelecto), con los 20 primeros puntos a 1, son de Classic Era y coinciden con ForeverDB y Warcraft Tavern. El poder de ataque no incluye el base por nivel ni el equipo. Se redondea hacia abajo.
            {changed.length === 0 ? " Aún no tienes ningún talento, ventaja o raciales que cambien estas estadísticas." : " Entre paréntesis, el valor sin talentos."} Sin equipo; la celeridad, el crítico y la regeneración están en «Efectos sumados».
          </p>
        </>
      )}
      <p className="muted small">
        <span className={`tag ${combo.provenance === "community" ? "tag-unassigned" : "tag-inactive"}`}>
          {combo.provenance === "community" ? "Classic Era · estimación" : combo.derivedFromRaceId !== null ? "Combinación nueva · estimada" : "Classic Era · ajustada"}
        </span>{" "}
        {combo.provenance === "community"
          ? "Valores de Classic Era: el cliente de la beta no trae las estadísticas base. "
          : combo.derivedFromRaceId !== null
            ? "Esta raza/clase no existía en Classic: se calcula con la diferencia racial sobre otra raza (error típico ±1). "
            : "Valores de Classic Era con un ajuste. "}
        {combo.note ? `${combo.note} ` : ""}
        {issues.length > 0 && (
          <>
            Fuente de Classic con {issues.some((a) => !a.corrected) ? "valores dudosos" : "un error corregido"}:{" "}
            {issues.map((a) => `nivel ${a.level} ${STAT_LABELS[["str", "agi", "sta", "int", "spi"].indexOf(a.stat)]!.toLowerCase()} ${a.value} (esperable ~${Math.round(a.expected)})${a.corrected ? " corregido" : ""}`).join("; ")}.{" "}
          </>
        )}
        La beta solo llega al nivel {data.betaMaxLevel}; los valores hasta el {data.maxLevel} se confirmarán cuando se publiquen. No incluye equipo ni talentos; las bonificaciones de la raza van aparte.
      </p>
    </>
  );
}
