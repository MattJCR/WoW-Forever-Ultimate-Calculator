import type { UnassignedEntry, UnassignedTree } from "@wfuc/schema";
import { useMemo, useState } from "react";
import { DescText, Notes } from "../components/Detail";
import { Icon } from "../components/Icon";
import { loadUnassigned, useAsync } from "../data";
import { entryName, entryText, isEnglish, talentName, talentText, tr, trn, type Localized } from "../i18n";
import { plural } from "../messages";
import { usePrerenderHandoff } from "../seo/handoff";

const CELL = 46;
const GAP = 22;
const pos = (n: number) => n * (CELL + GAP);

/** Control de prueba libre: sube y baja rangos sin coste ni limites de puntos. */
function Stepper({ rank, max, onChange, name }: { rank: number; max: number; onChange: (r: number) => void; name: string }) {
  return (
    <span className="stepper" role="group" aria-label={tr("Rango de {name} (prueba libre)", { name })}>
      <button type="button" onClick={() => onChange(Math.max(0, rank - 1))} disabled={rank <= 0} aria-label={tr("Bajar rango")}>
        −
      </button>
      <b>
        {rank}/{max}
      </b>
      <button type="button" onClick={() => onChange(Math.min(max, rank + 1))} disabled={rank >= max} aria-label={tr("Subir rango")}>
        +
      </button>
    </span>
  );
}

/** Texto del rango mostrado: el del rango escogido o, con 0, el del primero (atenuado). En inglés, `localize` da el texto inglés de cada rango. */
function RankText({ descriptions, rank, complete, approximate, localize }: { descriptions: string[]; rank: number; complete: boolean; approximate: boolean; localize: (rankIndex: number, fallback: string) => Localized }) {
  const index = Math.max(rank, 1) - 1;
  const shown = localize(Math.min(index, Math.max(descriptions.length - 1, 0)), descriptions[index] ?? "");
  return (
    <div className={rank === 0 ? "dim-text" : undefined}>
      {descriptions.length > 1 && <h5>{rank === 0 ? tr("Rango 1") : tr("Rango {n}", { n: rank })}</h5>}
      {shown.text ? <DescText text={shown.text} /> : <p className="muted">{tr("Sin descripción en el cliente.")}</p>}
      {isEnglish() ? (
        <Notes approximate={approximate} complete={complete} english={shown.fromEnglish} ownEnglish={!!shown.own} missingEnglish={!!shown.text && !shown.fromEnglish} />
      ) : (
        <Notes approximate={approximate} complete={complete} />
      )}
    </div>
  );
}

/** Un arbol descartado en cuadricula, con sus requisitos y prerrequisitos, para ver como seria. Todo gratis. */
function PreviewTree({ tree }: { tree: UnassignedTree }) {
  /** Nombre del nodo en el idioma elegido (null si el nodo no tiene hechizo). */
  const nodeLabel = (n: { nodeId: number; name: string | null }): string | null => (n.name === null ? null : talentName(n.nodeId, n.name));
  const [ranks, setRanks] = useState<Record<number, number>>({});
  const [focus, setFocus] = useState<number | null>(null);
  const nodes = tree.nodes;
  const cols = Math.max(1, ...nodes.map((n) => n.col + 1));
  const rows = Math.max(1, ...nodes.map((n) => n.row + 1));
  const width = pos(cols) - GAP;
  const height = pos(rows) - GAP;
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const active = focus === null ? null : (byId.get(focus) ?? null);
  const set = (id: number, r: number) => setRanks((s) => ({ ...s, [id]: r }));
  const spent = Object.values(ranks).reduce((a, b) => a + b, 0);

  return (
    <div className="preview-tree">
      <div className="preview-scroll">
        <div className="grid" style={{ width, height }}>
          <svg className="edges" width={width} height={height} aria-hidden="true">
            {nodes.flatMap((n) =>
              n.prerequisites.map((p) => {
                const from = byId.get(p.nodeId);
                if (!from) return null;
                const x1 = pos(from.col) + CELL / 2;
                const y1 = pos(from.row) + CELL / 2;
                const x2 = pos(n.col) + CELL / 2;
                const y2 = pos(n.row) + CELL / 2;
                const met = (ranks[from.nodeId] ?? 0) >= (from.maxRank ?? 1);
                return <line key={`${p.nodeId}-${n.nodeId}`} className={met ? "edge-line met" : "edge-line"} x1={x1} y1={y1} x2={x2} y2={y2} />;
              }),
            )}
          </svg>
          {nodes.map((n) => {
            const max = n.maxRank ?? 1;
            const r = ranks[n.nodeId] ?? 0;
            const state = n.maxRank === null ? "locked" : r >= max ? "maxed" : r > 0 ? "partial" : "available";
            return (
              <button
                key={n.nodeId}
                type="button"
                className={`talent ${state}${focus === n.nodeId ? " focus" : ""}`}
                style={{ left: pos(n.col), top: pos(n.row), width: CELL, height: CELL }}
                aria-label={tr("{name}, rango {r} de {max} (prueba libre)", { name: nodeLabel(n) ?? tr("Nodo sin hechizo"), r, max })}
                disabled={n.maxRank === null}
                onMouseEnter={() => setFocus(n.nodeId)}
                onFocus={() => setFocus(n.nodeId)}
                onClick={(e) => set(n.nodeId, e.shiftKey ? max : Math.min(max, r + 1))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  set(n.nodeId, Math.max(0, r - 1));
                }}
              >
                <Icon id={n.iconFileDataId} name={nodeLabel(n)} />
                <span className="rank">
                  {r}/{max}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="preview-detail" aria-live="polite">
        <div className="tag tag-unassigned">{tr("datamining · prueba libre")}</div>
        {active ? (
          <>
            <div className="detail-head">
              <Icon id={active.iconFileDataId} name={nodeLabel(active)} />
              <div>
                <h4>{nodeLabel(active) ?? tr("(nodo sin hechizo)")}</h4>
                <p className="rank-line">{active.maxRank === null ? tr("sin entrada") : plural(active.maxRank, "rango", "rangos")}</p>
              </div>
            </div>
            {active.maxRank !== null && <Stepper rank={ranks[active.nodeId] ?? 0} max={active.maxRank} onChange={(r) => set(active.nodeId, r)} name={nodeLabel(active) ?? tr("nodo")} />}
            {active.maxRank !== null && (
              <RankText descriptions={active.descriptions} rank={ranks[active.nodeId] ?? 0} complete={active.descriptionsComplete} approximate={active.descriptionsApproximate} localize={(i, es) => talentText(active.nodeId, i, es)} />
            )}
            {active.requiredPoints > 0 && <p className="muted">{tr("Pediría")} {active.requiredPoints} {tr("puntos gastados en el árbol (no se aplica aquí")}).</p>}
            <dl>
              <dt>{tr("Nodo")}</dt>
              <dd>#{active.nodeId}</dd>
              {active.spellId !== null && (
                <>
                  <dt>{tr("Hechizo")}</dt>
                  <dd>#{active.spellId}</dd>
                </>
              )}
              <dt>{tr("Posición")}</dt>
              <dd>
                ({active.posX}, {active.posY})
              </dd>
            </dl>
          </>
        ) : (
          <p className="muted">{tr("Pasa el cursor por un nodo. Clic: subir rango · Clic derecho: bajar · Mayús + clic: al máximo.")}</p>
        )}
        <p className="muted small">
         {tr("Prueba libre")}: {spent} {spent === 1 ? tr("rango") : tr("rangos")} {tr("probados. No cuesta puntos, no tiene requisitos y no cuenta para el cálculo.")}
        </p>
      </aside>
    </div>
  );
}

/** Talento sin nodo (no esta colocado en ningun arbol): tarjeta con rangos gratis. */
function EntryCard({ e, versions = [] }: { e: UnassignedEntry; versions?: number[] }) {
  const [rank, setRank] = useState(0);
  const label = e.name === null ? null : entryName(e.entryId, e.name);
  return (
    <li className="entry-card">
      <Icon id={e.iconFileDataId} name={label} />
      <div className="entry-body">
        <div className="entry-top">
          <b>{label ?? tr("(sin nombre)")}</b>
          <Stepper rank={rank} max={e.maxRank} onChange={setRank} name={label ?? tr("talento")} />
        </div>
        <RankText descriptions={e.descriptions} rank={rank} complete={e.descriptionsComplete} approximate={e.descriptionsApproximate} localize={(i, es) => entryText(e.entryId, i, es)} />
        <p className="muted small">
          {e.className ? tr(e.className) : tr("sin clase")} · {versions.length > 1 ? `${tr("entradas")} ${versions.map((v) => `#${v}`).join(", ")}` : `${tr("entrada")} #${e.entryId}`}
          {e.spellId !== null ? ` · ${tr("hechizo")} #${e.spellId}` : ""}
        </p>
      </div>
    </li>
  );
}

/** Agrupa entradas del mismo hechizo (versiones de una misma ventaja). */
function groupBySpell(list: UnassignedEntry[]): { first: UnassignedEntry; versions: number[] }[] {
  const groups = new Map<string, UnassignedEntry[]>();
  for (const e of list) {
    const k = String(e.spellId ?? `e${e.entryId}`);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()].map((g) => ({ first: g[0]!, versions: g.map((x) => x.entryId) }));
}

export function UnassignedPage() {
  usePrerenderHandoff();
  const state = useAsync("unassigned", loadUnassigned);
  const [filter, setFilter] = useState("todas");

  const data = state.status === "ready" ? state.value : null;
  const classes = useMemo(() => (data ? [...new Set(data.orphanEntries.filter((e) => !e.isLegacy).map((e) => e.className ?? "Sin clase"))].sort() : []), [data]);

  if (state.status === "loading") return <p className="status">{tr("Cargando el datamining…")}</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;
  const { orphanEntries, alternativeTrees, build } = state.value;
  const legacyEntries = orphanEntries.filter((e) => e.isLegacy);
  // Ventajas de Legacy: las que NO estan en ningun arbol (agrupadas: cada una suele tener dos versiones) y los duplicados de las ya colocadas
  const legacyFree = groupBySpell(legacyEntries.filter((e) => !e.legacyPlaced));
  const legacyDup = legacyEntries.filter((e) => e.legacyPlaced);
  const entries = orphanEntries.filter((e) => !e.isLegacy);
  const shown = entries.filter((e) => filter === "todas" || (e.className ?? "Sin clase") === filter);
  // Con English elegido: cuántos talentos con texto siguen en español porque no tienen versión inglesa
  const untranslated = isEnglish() ? orphanEntries.filter((e) => e.descriptions.some(Boolean) && !entryText(e.entryId, 0, "").fromEnglish).length : 0;

  return (
    <div className="unassigned">
      <h2>{tr("Datamining")}</h2>
      <p className="muted">
       {tr("Lo que el cliente (build")} {build}) {tr("trae pero no forma parte de un árbol de clase activo ni de Puntos de Legado. Se ve como sería, con su descripción, y se puede probar subiendo y bajando rangos")}{" "}
        <strong>{tr("gratis")}</strong>: {tr("no cuesta puntos, no tiene requisitos y no cuenta en ningún build.")}
      </p>

      {isEnglish() && untranslated > 0 && <p className="muted small">{tr("Algunos de estos datos del cliente no tienen versión en inglés: se muestran en español.")}</p>}

      <section aria-labelledby="trees-title">
        <h3 id="trees-title">{tr("Árboles descartados")} ({alternativeTrees.length})</h3>
        <div className="tree-cards">
          {alternativeTrees.map((t) => (
            <details key={t.traitTreeId} className="tree-card" open={t.nodeCount > 1 && t.nodeCount <= 40 && t.traitTreeId === alternativeTrees.find((x) => x.nodeCount > 1)?.traitTreeId}>
              <summary>
                <span className="tag tag-unassigned">{tr("datamining")}</span>
                <strong>{tr("Árbol")} {t.traitTreeId}</strong>
                <span>{t.className ? tr(t.className) : tr("clase desconocida")}</span>
                <span className="muted">{plural(t.nodeCount, "nodo", "nodos")}</span>
              </summary>
              <p className="muted">{trn(t.reason)}.</p>
              {t.nodes.length === 0 ? <p className="muted">{tr("Sin nodos.")}</p> : <PreviewTree tree={t} />}
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="entries-title">
        <h3 id="entries-title">{tr("Talentos sin nodo")} ({entries.length})</h3>
        <p className="muted">{tr("Entradas de talento que el cliente define pero que ningún nodo usa, así que no tienen posición. Sube y baja su rango para ver cómo se leen.")}</p>
        <label className="filter">
         {tr("Clase")}{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="todas">{tr("Todas")} ({entries.length})</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {tr(c)}
              </option>
            ))}
          </select>
        </label>
        <ul className="entry-grid">
          {shown.map((e) => (
            <EntryCard key={e.entryId} e={e} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="legacy-title">
        <h3 id="legacy-title">{tr("Ventajas de Puntos de Legado que no están en ningún árbol")} ({legacyFree.length})</h3>
        <p className="muted">
         {tr("Ventajas de Puntos de Legado que el cliente define pero no coloca en ninguno de sus 3 árboles (se reconocen por su rango de hechizos, contiguo al de las colocadas). Cada una suele tener dos versiones de entrada; aquí se muestra una sola tarjeta por ventaja.")}
        </p>
        <ul className="entry-grid">
          {legacyFree.map(({ first, versions }) => (
            <EntryCard key={first.spellId ?? first.entryId} e={first} versions={versions} />
          ))}
        </ul>
        {legacyDup.length > 0 && (
          <details className="dup-details">
            <summary>{tr("Entradas repetidas de ventajas que sí están colocadas")} ({legacyDup.length})</summary>
            <p className="muted small">{tr("Son versiones antiguas o duplicadas de ventajas que ya aparecen en los árboles de Puntos de Legado (mismo hechizo). Se conservan por si hace falta compararlas.")}</p>
            <ul className="entry-grid">
              {legacyDup.map((e) => (
                <EntryCard key={e.entryId} e={e} />
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
