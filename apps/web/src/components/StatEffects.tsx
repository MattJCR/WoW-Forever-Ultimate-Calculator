import { collectStatEffects, STAT_CATEGORIES, type Build, type ClassIndex, type StatEffects, type StatSource, type StatTotal } from "@wfuc/engine";
import type { Manifest, Race } from "@wfuc/schema";
import { Abilities as AbilitiesSchema, TalentRules as TalentRulesSchema } from "@wfuc/schema";
import { useMemo } from "react";
import { getJson, useAsync } from "../data";

const fmt = (n: number): string => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

const valueText = (t: StatTotal): string => {
  const sign = t.value > 0 ? "+" : "";
  if (t.unit === "puntos porcentuales") return `${sign}${fmt(t.value)} %`;
  if (t.unit === "%") return `${sign}${fmt(t.value)} %`;
  if (t.unit === "s") return `${sign}${fmt(t.value)} s`;
  if (t.unit === "m") return `${sign}${fmt(t.value)} m`;
  return `${sign}${fmt(t.value)}`;
};

const sourceText = (s: StatSource): string => (s.maxRank > 1 ? `${s.name} ${s.rank}/${s.maxRank}` : s.name);
const FROM: Record<StatSource["from"], string> = { class: "talento", legacy: "Puntos de Legado", race: "raza" };

export interface EffectsInput {
  manifest: Manifest;
  cls: ClassIndex;
  classBuild: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  race: Race | null;
}

/** Efectos sumados de talentos, Legacy y raza (carga las habilidades y reglas de la clase); `fx` es null mientras carga. */
export function useStatEffects({ manifest, cls, classBuild, legacy, legacyBuild, race }: EffectsInput): { fx: StatEffects | null; loading: boolean } {
  const entry = manifest.abilities.find((a) => a.classId === cls.data.classId);
  const state = useAsync(entry?.file ?? "none", () => (entry ? getJson(entry.file, (v) => AbilitiesSchema.parse(v)) : Promise.resolve(null)));
  const abilities = state.status === "ready" ? state.value : null;
  const ruleEntry = manifest.rules.find((a) => a.classId === cls.data.classId);
  const rulesState = useAsync(ruleEntry?.file ?? "none", () => (ruleEntry ? getJson(ruleEntry.file, (v) => TalentRulesSchema.parse(v)) : Promise.resolve(null)));
  const rules = rulesState.status === "ready" ? rulesState.value : null;
  const fx = useMemo(() => collectStatEffects({ cls, classBuild, legacy, legacyBuild, race, abilities, rules }), [cls, classBuild, legacy, legacyBuild, race, abilities, rules]);
  return { fx, loading: state.status === "loading" || rulesState.status === "loading" };
}

/**
 * Suma de todo lo que aportan los talentos de clase, las ventajas de Legacy y la raza, por categoria y con las
 * habilidades a las que se aplica cada cifra. Lo que no se puede reducir a una cifra (procs, efectos con condicion,
 * habilidades activas) va debajo con el texto del cliente: nada se deja fuera.
 */
export function StatEffectsView({ fx, loading }: { fx: StatEffects | null; loading: boolean }) {
  if (loading || !fx) return <p className="muted">Calculando…</p>;
  const byCategory = STAT_CATEGORIES.map((c) => ({ category: c, rows: fx.totals.filter((t) => t.category === c) })).filter((g) => g.rows.length > 0);

  return (
    <>
      {byCategory.length === 0 ? (
        <p className="muted">Aún no hay cifras que sumar: gasta puntos en talentos o Puntos de Legado, o elige una raza.</p>
      ) : (
        <table className="stats-table fx-table">
          <thead>
            <tr>
              <th scope="col">Efecto</th>
              <th scope="col">Total</th>
              <th scope="col">Se aplica a</th>
              <th scope="col">Procede de</th>
            </tr>
          </thead>
          {byCategory.map((g) => (
            <tbody key={g.category}>
              <tr className="fx-cat">
                <th colSpan={4} scope="colgroup">
                  {g.category}
                </th>
              </tr>
              {g.rows.map((t, i) => (
                <tr key={`${t.label}-${t.unit}-${t.scope?.join("|") ?? "*"}-${i}`}>
                  <th scope="row">{t.label}</th>
                  <td className={t.value < 0 && t.category !== "Coste" && t.category !== "Tiempo de lanzamiento" && t.category !== "Enfriamiento" ? "neg" : "pos"}>
                    <b>{valueText(t)}</b>
                  </td>
                  <td>{t.scope === null ? <span className="muted">Todo el personaje</span> : t.scope.length === 0 ? <span className="muted">Habilidades de la clase</span> : t.scope.join(", ")}</td>
                  <td>
                    {t.sources.map((s, k) => (
                      <span key={k} className="chip" title={FROM[s.from]}>
                        {sourceText(s)}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}

      {fx.ruleEffects.length > 0 && (
        <>
          <h5 className="fx-sub">Efectos condicionales con cifra (procs, estados y efectos al golpear)</h5>
          <table className="stats-table fx-table">
            <tbody>
              {fx.ruleEffects.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{r.text}</th>
                  <td>{r.scope === null ? <span className="muted">Todos los hechizos</span> : r.scope.length === 0 ? <span className="muted">Habilidades de la clase</span> : r.scope.join(", ")}</td>
                  <td>
                    <span className="chip" title="talento">
                      {sourceText(r.source)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            <span className="tag tag-inactive">Clasificación propia</span> La cifra de cada rango es del cliente, pero a qué hechizos afecta y qué hace lo hemos clasificado a mano a partir del texto del talento (el cliente lo guarda como un efecto genérico).
          </p>
        </>
      )}

      {fx.conditional.length > 0 && (
        <details className="fx-cond" open>
          <summary>
            Efectos con condición o sin cifra sumable ({fx.conditional.length}) <span className="muted small">— procs, habilidades activas y utilidades; texto del cliente</span>
          </summary>
          <ul className="effects">
            {fx.conditional.map((c, i) => (
              <li key={i}>
                <b>{c.source.name}</b> <span className="rank-chip">{c.source.rank}/{c.source.maxRank}</span> <span className="muted small">{FROM[c.source.from]}{c.active ? " · habilidad activa: solo vale mientras está activa" : ""}</span>
                <p>{c.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">
        <span className="tag tag-unassigned">Cliente</span> Cifras de los hechizos de la beta. {fx.counts.quantified} talentos aportan cifras sumadas y {fx.counts.conditionalOnly} solo tienen texto. Las cifras con el mismo alcance se suman.
        Los porcentajes de atributos, salud y maná se aplican en la tabla «Estadísticas base».
      </p>
    </>
  );
}
