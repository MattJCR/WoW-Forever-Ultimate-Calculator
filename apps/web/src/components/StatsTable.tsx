import { baseAttackPower, classBaseOf, deriveCombatStats, deriveStats, type CombatGroup, type CombatRow, type StatEffects } from "@wfuc/engine";
import type { BaseStats, ClientStats, CombatFormulas, CombatRatings, Manifest } from "@wfuc/schema";
import { BaseStats as BaseStatsSchema, ClientStats as ClientStatsSchema, CombatFormulas as CombatFormulasSchema } from "@wfuc/schema";
import { getJson, useAsync } from "../data";
import { fmtNum, tr, trn } from "../i18n";

/**
 * Estadisticas brutas base de la raza y clase escogidas, a tres niveles (el minimo que exigen los talentos, el 30 de
 * la beta y el 60). No vienen del cliente de Forever sino de Classic Era (ver DATA-FINDINGS): se marcan como estimacion.
 */
/** Equipo que se suma: sus estadisticas y el nivel minimo al que se puede llevar todo (las columnas de nivel menor no lo llevan). */
export interface GearForStats {
  stats: Record<string, number>;
  minLevel: number;
  /** Armadura base de las piezas. */
  armor: number;
  /** Parte de la armadura que es armadura extra de piezas verdes (no recibe el % de los talentos). */
  bonusArmor?: number;
  /** Puntuaciones -> % (null = no cargadas). */
  ratings: CombatRatings | null;
}

export function StatsTable({ manifest, raceId, raceName, classId, level, fx, fxReady, gear }: { manifest: Manifest; raceId: number | null; raceName: string | null; classId: number; level: number; fx: StatEffects | null; /** Los efectos ya llevan el libro de hechizos de la clase (sin el, las cifras de habilidades concretas parecerian del personaje entero). */ fxReady: boolean; gear?: GearForStats | null }) {
  const state = useAsync(manifest.stats.file, () => getJson(manifest.stats.file, (v) => BaseStatsSchema.parse(v)));
  const clientEntry = manifest.clientStats;
  const clientState = useAsync(clientEntry?.file ?? "none", () => (clientEntry ? getJson(clientEntry.file, (v) => ClientStatsSchema.parse(v)) : Promise.resolve(null)));
  const client = clientState.status === "ready" ? clientState.value : null;
  const formulasEntry = manifest.combatFormulas;
  const formulasState = useAsync(formulasEntry?.file ?? "none", () => (formulasEntry ? getJson(formulasEntry.file, (v) => CombatFormulasSchema.parse(v)) : Promise.resolve(null)));
  const formulas = formulasState.status === "ready" ? formulasState.value : null;
  if (raceId === null) return <p className="muted">{tr("Elige una raza en el paso «Raza» para ver las estadísticas base.")}</p>;
  if (state.status === "loading") return <p className="muted">{tr("Cargando estadísticas…")}</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;
  return <Table data={state.value} raceId={raceId} raceName={raceName} classId={classId} level={level} fx={fx} fxReady={fxReady} client={client} formulas={formulas} gear={gear ?? null} />;
}

const fmt = (n: number): string => fmtNum(n, 2);

function Table({ data, raceId, raceName, classId, level, fx, fxReady, client, formulas, gear }: { data: BaseStats; raceId: number; raceName: string | null; classId: number; level: number; fx: StatEffects | null; fxReady: boolean; client: ClientStats | null; formulas: CombatFormulas | null; gear: GearForStats | null }) {
  const combo = data.combos.find((c) => c.raceId === raceId && c.classId === classId);
  const base = data.classBase.find((c) => c.classId === classId);
  if (!combo || !base) {
    return (
      <p className="muted">
        {tr("Sin estadísticas base para {race}: no existe en Classic Era y el cliente de la beta no las trae (los valores se calculan en el servidor).", { race: raceName ?? tr("esta raza") })}
      </p>
    );
  }
  // Maná base de Forever: lo trae el cliente (PlayerExpectedStat); la vida base sigue siendo la de Classic
  const clientClass = client?.classes.find((c) => c.classId === classId) ?? null;
  const manaAt = (l: number): number => clientClass?.levels.find((x) => x.level === l)?.baseMana ?? base.mana[l - 1]!;
  // Poder de ataque base de la clase a este nivel (comunidad: el cliente no lo trae)
  const apBase = baseAttackPower(formulas ? classBaseOf(formulas, classId) : null, level);
  // Valores finales a este nivel, con los % de talentos, Legacy y raza y el equipo ya aplicados
  const derived = fx
    ? deriveStats({
        attributes: combo.stats[level - 1] as [number, number, number, number, number],
        hpBase: base.hp[level - 1]!,
        manaBase: manaAt(level),
        totals: fx.totals,
        gear: gear && level >= gear.minLevel ? gear.stats : null,
        attackPower: clientClass ? { perStrength: clientClass.attackPowerPerStrength, perAgility: clientClass.attackPowerPerAgility, rangedPerAgility: clientClass.rangedAttackPowerPerAgility, baseMelee: apBase.melee, baseRanged: apBase.ranged } : null,
      })
    : null;
  if (!derived) return <p className="muted">{tr("Cargando talentos…")}</p>;
  // Combate: armadura, crítico, impacto, celeridad, defensa, regeneración, resistencias y demás bonos del personaje (equipo + talentos + Legacy + raza)
  const gearHere = gear && level >= gear.minLevel ? gear : null;
  const combat =
    fx && fxReady
      ? deriveCombatStats({ derived, totals: fx.totals, gear: gearHere ? { stats: gearHere.stats, armor: gearHere.armor, bonusArmor: gearHere.bonusArmor, ratings: gearHere.ratings } : null, classStats: clientClass?.levels.find((l) => l.level === level) ?? null, rules: formulas ? { formulas, classId } : null })
      : null;
  const groups = combat ? COMBAT_GROUPS.map((g) => ({ group: g, rows: combat.rows.filter((r) => r.group === g) })).filter((g) => g.rows.length > 0) : [];
  return (
    <>
      <table className="stats-table">
        <thead>
          <tr>
            <th scope="col">{tr("Estadística")}</th>
            <th scope="col">{tr("Nivel {level}", { level })}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="fx-cat">
            <th colSpan={2} scope="colgroup">
              {tr("Atributos y recursos")}
            </th>
          </tr>
          {derived.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{trn(r.label)}</th>
              <td className={r.final !== r.base ? "pos" : undefined}>
                {r.final !== r.base && <small className="stat-delta">{r.final > r.base ? "+" : ""}{fmt(r.final - r.base)}</small>}
                <b>{fmt(r.final)}</b>
              </td>
            </tr>
          ))}
        </tbody>
        {groups.map((g) => (
          <tbody key={g.group}>
            <tr className="fx-cat">
              <th colSpan={2} scope="colgroup">
                {tr(g.group)}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.key} title={r.note ? trn(r.note) : undefined}>
                <th scope="row">
                  {trn(r.label)}
                  {r.parts.length > 1 && <small className="muted stat-parts"> {r.parts.map((p) => `${trn(p.label)} ${signed(p.value, r.unit)}`).join(" · ")}</small>}
                </th>
                <td className={r.value !== 0 ? "pos" : undefined}>
                  <b>{valueText(r)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {!fxReady && <p className="muted small">{tr("Calculando armadura, crítico, impacto y demás estadísticas de combate…")}</p>}
      <p className="muted small">
        <span className="tag tag-unassigned">{tr("Cliente + Classic · estimación")}</span> {tr("Valores finales con tus talentos, Puntos de Legado, raza y equipo ya aplicados, redondeados hacia abajo. La base de atributos y la vida salen de Classic Era más la diferencia de raza medida por la comunidad (la beta solo llega al nivel {max}); porcentajes, maná base, poder de ataque por atributo y crítico por atributo son del cliente; el crítico base, el esquive base, el poder de ataque base de la clase, la armadura por agilidad y la regeneración por espíritu son de la comunidad (hojas de personaje y tooltips del juego a nivel 60). El equipo solo cuenta desde el nivel que exige el objeto más exigente", { max: data.betaMaxLevel })}{gear ? ` (${tr("nivel {n}", { n: gear.minLevel })})` : ""}.
      </p>
      {groups.length > 0 && (
        <p className="muted small">
          <span className="tag tag-inactive">{tr("Estimación")}</span> {tr("Combate: las puntuaciones del equipo se pasan a % con las constantes de la comunidad (impacto 10, crítico 14, celeridad 10, esquivar 12, parada 15 y bloqueo 5 por 1 %). El crítico base de la clase, el esquive base, la armadura por agilidad y la regeneración por espíritu también son de la comunidad (confianza baja: medidos a nivel 60; en otros niveles son los de Classic). No incluyen la defensa base, la parada ni el bloqueo base. Los bonos de una habilidad concreta se ven en su tarjeta; los condicionales (procs, estados) quedan como texto en el paso Equipo.")}
        </p>
      )}
    </>
  );
}

const COMBAT_GROUPS: CombatGroup[] = ["Ataque", "Defensa", "Poder", "Recursos", "Resistencias", "Otros bonos"];

const signed = (v: number, unit: CombatRow["unit"]): string => `${v > 0 ? "+" : ""}${fmt(v)}${unit === "%" ? " %" : ""}`;
const valueText = (r: CombatRow): string => `${r.unit === "%" && r.value > 0 && r.group === "Otros bonos" ? "+" : ""}${fmt(r.value)}${r.unit === "%" ? " %" : ""}`;
