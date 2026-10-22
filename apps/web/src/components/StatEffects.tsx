import { activatableTalents, collectStatEffects, STAT_CATEGORIES, type Build, type EquippedState, type GearEffectSource, type ClassIndex, type StatEffects, type StatSource, type StatTotal } from "@wfuc/engine";
import type { Manifest, Race } from "@wfuc/schema";
import { Abilities as AbilitiesSchema, TalentRules as TalentRulesSchema } from "@wfuc/schema";
import { useMemo } from "react";
import { getJson, useAsync } from "../data";
import { fmtNum, nm, registerAbilities, registerTalents, tr, trn } from "../i18n";

const fmt = (n: number): string => fmtNum(n, 2);

const valueText = (t: StatTotal): string => {
  const sign = t.value > 0 ? "+" : "";
  if (t.unit === "puntos porcentuales") return `${sign}${fmt(t.value)} %`;
  if (t.unit === "%") return `${sign}${fmt(t.value)} %`;
  if (t.unit === "s") return `${sign}${fmt(t.value)} s`;
  if (t.unit === "m") return `${sign}${fmt(t.value)} m`;
  return `${sign}${fmt(t.value)}`;
};

const sourceText = (s: StatSource): string => (s.maxRank > 1 ? `${nm(s.name)} ${s.rank}/${s.maxRank}` : nm(s.name));
const FROM: Record<StatSource["from"], string> = { class: "talento", legacy: "Puntos de Legado", race: "raza", gear: "equipo" };
const fromText = (f: StatSource["from"]): string => tr(FROM[f]);

export interface EffectsInput {
  manifest: Manifest;
  cls: ClassIndex;
  classBuild: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  race: Race | null;
  /** Bonos de conjunto y efectos al equipar activos (ya filtrados por el nivel del personaje). */
  gearEffects?: GearEffectSource[];
  /** Lo que lleva el personaje (para los talentos que exigen un arma o un escudo); null = sin equipo elegido. */
  equipped?: EquippedState;
  /** Talentos de habilidad activa que se dan por activos (nodeId). */
  active?: ReadonlySet<number> | null;
}

/** Efectos sumados de talentos, Legacy y raza (carga las habilidades y reglas de la clase); `fx` es null mientras carga. */
export function useStatEffects({ manifest, cls, classBuild, legacy, legacyBuild, race, gearEffects, equipped, active }: EffectsInput): { fx: StatEffects | null; loading: boolean } {
  const entry = manifest.abilities.find((a) => a.classId === cls.data.classId);
  const state = useAsync(entry?.file ?? "none", () => (entry ? getJson(entry.file, (v) => AbilitiesSchema.parse(v)) : Promise.resolve(null)));
  const abilities = state.status === "ready" ? state.value : null;
  if (abilities) registerAbilities(abilities);
  registerTalents(cls.data);
  if (legacy) registerTalents(legacy.data);
  const ruleEntry = manifest.rules.find((a) => a.classId === cls.data.classId);
  const rulesState = useAsync(ruleEntry?.file ?? "none", () => (ruleEntry ? getJson(ruleEntry.file, (v) => TalentRulesSchema.parse(v)) : Promise.resolve(null)));
  const rules = rulesState.status === "ready" ? rulesState.value : null;
  const fx = useMemo(() => collectStatEffects({ cls, classBuild, legacy, legacyBuild, race, abilities, rules, gearEffects, equipped, active }), [cls, classBuild, legacy, legacyBuild, race, abilities, rules, gearEffects, equipped, active]);
  return { fx, loading: state.status === "loading" || rulesState.status === "loading" };
}

/**
 * Suma de todo lo que aportan los talentos de clase, las ventajas de Legacy y la raza, por categoria y con las
 * habilidades a las que se aplica cada cifra. Lo que no se puede reducir a una cifra (procs, efectos con condicion,
 * habilidades activas) va debajo con el texto del cliente: nada se deja fuera.
 */
export function StatEffectsView({ fx, loading }: { fx: StatEffects | null; loading: boolean }) {
  if (loading || !fx) return <p className="muted">{tr("Calculando…")}</p>;
  const byCategory = STAT_CATEGORIES.map((c) => ({ category: c, rows: fx.totals.filter((t) => t.category === c) })).filter((g) => g.rows.length > 0);

  return (
    <>
      {byCategory.length === 0 ? (
        <p className="muted">{tr("Aún no hay cifras que sumar: gasta puntos en talentos o Puntos de Legado, o elige una raza.")}</p>
      ) : (
        <table className="stats-table fx-table">
          <thead>
            <tr>
              <th scope="col">{tr("Efecto")}</th>
              <th scope="col">{tr("Total")}</th>
              <th scope="col">{tr("Se aplica a")}</th>
              <th scope="col">{tr("Procede de")}</th>
            </tr>
          </thead>
          {byCategory.map((g) => (
            <tbody key={g.category}>
              <tr className="fx-cat">
                <th colSpan={4} scope="colgroup">
                  {tr(g.category)}
                </th>
              </tr>
              {g.rows.map((t, i) => (
                <tr key={`${t.label}-${t.unit}-${t.scope?.join("|") ?? "*"}-${i}`}>
                  <th scope="row">{trn(t.label)}</th>
                  <td className={t.value < 0 && t.category !== "Coste" && t.category !== "Tiempo de lanzamiento" && t.category !== "Enfriamiento" ? "neg" : "pos"}>
                    <b>{valueText(t)}</b>
                  </td>
                  <td>{t.scope === null ? <span className="muted">{tr("Todo el personaje")}</span> : t.scope.length === 0 ? <span className="muted">{tr("Habilidades de la clase")}</span> : t.scope.map(trn).join(", ")}</td>
                  <td>
                    {t.sources.map((s, k) => (
                      <span key={k} className="chip chip-info" title={fromText(s.from)}>
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
          <h5 className="fx-sub">{tr("Efectos condicionales con cifra (procs, estados y efectos al golpear)")}</h5>
          <table className="stats-table fx-table">
            <tbody>
              {fx.ruleEffects.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{trn(r.text)}</th>
                  <td>{r.scope === null ? <span className="muted">{tr("Todos los hechizos")}</span> : r.scope.length === 0 ? <span className="muted">{tr("Habilidades de la clase")}</span> : r.scope.map(trn).join(", ")}</td>
                  <td>
                    <span className="chip chip-info" title={tr("talento")}>
                      {sourceText(r.source)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            <span className="tag tag-inactive">{tr("Clasificación propia")}</span> {tr("La cifra de cada rango es del cliente, pero a qué hechizos afecta y qué hace lo hemos clasificado a mano a partir del texto del talento (el cliente lo guarda como un efecto genérico).")}
          </p>
        </>
      )}

      <ConditionalEffects fx={fx} open />
      <p className="muted small">
        <span className="tag tag-unassigned">{tr("Cliente")}</span> {tr("Cifras de los hechizos de la beta. {a} talentos aportan cifras sumadas y {b} solo tienen texto. Las cifras con el mismo alcance se suman. Los porcentajes de atributos, salud y maná se aplican en la tabla «Estadísticas base».", { a: fx.counts.quantified, b: fx.counts.conditionalOnly })}
      </p>
    </>
  );
}

/**
 * Efectos de talentos que no suman una cifra permanente: habilidades activas, procs y los que exigen un objeto equipado que no llevas
 * (con el motivo). Texto del cliente: nada se descarta en silencio.
 */
export function ConditionalEffects({ fx, open = false }: { fx: StatEffects; open?: boolean }) {
  if (fx.conditional.length === 0) return null;
  const blocked = fx.conditional.filter((c) => c.blocked).length;
  return (
    <details className="fx-cond" open={open}>
      <summary>
        {tr("Efectos con condición o sin cifra sumable")} ({fx.conditional.length}){blocked > 0 ? ` · ${tr("{n} esperan un objeto equipado", { n: blocked })}` : ""} <span className="muted small">— {tr("procs, habilidades activas y utilidades; texto del cliente")}</span>
      </summary>
      <ul className="effects">
        {fx.conditional.map((c, i) => (
          <li key={i}>
            <b>{nm(c.source.name)}</b> <span className="rank-chip">{c.source.rank}/{c.source.maxRank}</span> <span className="muted small">{fromText(c.source.from)}{c.active ? ` · ${tr("habilidad activa: solo vale mientras está activa")}` : ""}</span>
            {c.blocked && <p className="fx-blocked"><b>{tr("No suma ahora")}</b>: {trn(c.blocked)}</p>}
            <p>{trn(c.text)}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Habilidades activas de tus talentos cuyo efecto son modificadores de hechizos (Poder Arcano: +30 % de daño y de coste; Presencia mental;
 * Sangre fría…). Marcarlas hace que el resumen y las habilidades se calculen «con ella activa»; solo vale mientras dura en el juego.
 */
export function ActiveStates({ cls, classBuild, active, onChange }: { cls: ClassIndex; classBuild: Build; active: ReadonlySet<number>; onChange: (next: Set<number>) => void }) {
  const options = useMemo(() => activatableTalents(cls, classBuild), [cls, classBuild]);
  if (options.length === 0) return null;
  const toggle = (nodeId: number, on: boolean) => {
    const next = new Set(active);
    if (on) next.add(nodeId);
    else next.delete(nodeId);
    onChange(next);
  };
  return (
    <section className="card active-states" aria-label={tr("Habilidades activas")}>
      <header>
        <h3>{tr("Habilidades activas")}</h3>
        <p className="muted small">{tr("Márcalas para calcular con ellas activas. Solo valen mientras duran en el juego (los de «tu próximo hechizo» cuentan para una sola tirada).")}</p>
      </header>
      <ul>
        {options.map((o) => (
          <li key={o.nodeId}>
            <label>
              <input type="checkbox" checked={active.has(o.nodeId)} onChange={(e) => toggle(o.nodeId, e.target.checked)} />
              <span>
                <b>{nm(o.name)}</b> {o.maxRank > 1 && <span className="rank-chip">{o.rank}/{o.maxRank}</span>}
                <span className="muted small active-text">{trn(o.text)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
