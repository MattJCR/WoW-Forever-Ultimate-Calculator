import { canAdd, rankOf, specPoints, type Build, type ClassIndex } from "@wfuc/engine";
import type { Talent } from "@wfuc/schema";
import { Background, LegacyBackground } from "./Background";
import { Icon } from "./Icon";

export const CELL = 46;
export const GAP = 22;
const COLS = 4;
const pos = (n: number) => n * (CELL + GAP);
const center = (n: number) => pos(n) + CELL / 2;

/** Posicion en pantalla de un elemento, para colocar una tarjeta flotante a su lado. */
export interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Talento al que apunta el cursor, el foco o la ultima eleccion: el panel de detalle lo muestra. */
export interface Focus {
  kind: "active" | "inactive";
  nodeId: number;
}

export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

interface Props {
  idx: ClassIndex;
  build: Build;
  specIndex: number;
  /** Talento elegido (el ultimo con el que se interactuo): lleva un aro. */
  selected: Focus | null;
  /** En pantallas estrechas solo se ve el arbol activo (el resto se elige con las pestanas). */
  active: boolean;
  onHover: (f: Focus | null) => void;
  onSelect: (f: Focus) => void;
  onAdd: (nodeId: number, max?: boolean) => void;
  onRemove: (nodeId: number) => void;
  onResetTree: (specIndex: number) => void;
}

/** Un arbol (especializacion de clase o arbol de Legacy): cabecera, arte de fondo, rejilla, flechas y marcadores de fila. */
export function TreePanel({ idx, build, specIndex, selected, active, onHover, onSelect, onAdd, onRemove, onResetTree }: Props) {
  const spec = idx.data.specs[specIndex]!;
  const rows = Math.max(1, ...spec.talents.map((t) => t.row + 1));
  const spent = specPoints(idx, build, specIndex);
  const isClass = idx.data.kind === "class";
  const byPos = new Map<string, Talent>(spec.talents.map((t) => [`${t.row},${t.col}`, t]));
  const width = pos(COLS) - GAP;
  const height = pos(rows) - GAP;

  // Puntos que pide cada fila (solo en las clases: 5, 10, 15...). Legacy los pide por nodo, no por fila.
  const rowGate = new Map<number, number>();
  if (isClass) for (const t of spec.talents) if (t.requiredPoints > 0) rowGate.set(t.row, Math.max(rowGate.get(t.row) ?? 0, t.requiredPoints));
  const nextRow = [...rowGate.values()].sort((a, b) => a - b).find((p) => p > spent);

  return (
    <section className={`tree${active ? " is-active" : ""}`} aria-label={`${spec.name ?? "Arbol"}`}>
      <div className="tree-inner">
        {spec.backgroundFile ? <Background name={spec.backgroundFile} /> : !isClass && <LegacyBackground />}
        <header className="tree-head">
          <Icon id={spec.iconFileDataId} name={spec.name} />
          <div className="tree-title">
            <h3>{spec.name ?? `Árbol ${specIndex + 1}`}</h3>
            {isClass && <span className="muted">{nextRow ? `próxima fila a los ${nextRow}` : "todas las filas abiertas"}</span>}
          </div>
          <span className="tree-points" title="Puntos gastados en este árbol">
            <b>{spent}</b> {spent === 1 ? "punto" : "puntos"}
          </span>
          <button type="button" className="btn btn-ghost btn-square" onClick={() => onResetTree(specIndex)} disabled={spent === 0} aria-label={`Reiniciar ${spec.name ?? "árbol"}`} title="Reiniciar este árbol">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
            </svg>
          </button>
        </header>

        <div className="grid-wrap">
          <div className="grid" style={{ width, height }}>
            <svg className="edges" width={width} height={height} aria-hidden="true">
              {spec.talents.flatMap((t) =>
                t.prerequisites.map((p) => {
                  const from = idx.byNode.get(p.nodeId);
                  if (!from || from.specIndex !== specIndex) return null;
                  const met = rankOf(build, p.nodeId) >= from.talent.maxRank;
                  const x1 = center(from.talent.col);
                  const y1 = pos(from.talent.row) + CELL;
                  const x2 = center(t.col);
                  const y2 = pos(t.row);
                  if (from.talent.row === t.row) {
                    // prerrequisito en la misma fila (Legacy): flecha horizontal
                    const left = from.talent.col < t.col;
                    const hy = pos(t.row) + CELL / 2;
                    const hx1 = left ? pos(from.talent.col) + CELL : pos(from.talent.col);
                    const hx2 = left ? pos(t.col) : pos(t.col) + CELL;
                    return (
                      <g key={`${p.nodeId}-${t.nodeId}`} className={met ? "edge met" : "edge"}>
                        <line x1={hx1} y1={hy} x2={hx2 + (left ? -7 : 7)} y2={hy} />
                        <polygon points={left ? `${hx2 - 1},${hy} ${hx2 - 10},${hy - 6} ${hx2 - 10},${hy + 6}` : `${hx2 + 1},${hy} ${hx2 + 10},${hy - 6} ${hx2 + 10},${hy + 6}`} />
                      </g>
                    );
                  }
                  return (
                    <g key={`${p.nodeId}-${t.nodeId}`} className={met ? "edge met" : "edge"}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2 - 7} />
                      <polygon points={`${x2},${y2 - 1} ${x2 - 6},${y2 - 10} ${x2 + 6},${y2 - 10}`} />
                    </g>
                  );
                }),
              )}
            </svg>

            {Array.from({ length: rows * COLS }, (_, i) => {
              const row = Math.floor(i / COLS);
              const col = i % COLS;
              const t = byPos.get(`${row},${col}`);
              if (!t) return null;
              const rank = rankOf(build, t.nodeId);
              const add = canAdd(idx, build, t.nodeId);
              const state = rank >= t.maxRank ? "maxed" : rank > 0 ? "partial" : add.ok ? "available" : "locked";
              const isSelected = selected?.kind === "active" && selected.nodeId === t.nodeId;
              return (
                <button
                  key={t.nodeId}
                  type="button"
                  className={`talent ${state}${isSelected ? " focus" : ""}`}
                  style={{ left: pos(col), top: pos(row), width: CELL, height: CELL }}
                  aria-label={`${t.name ?? "Talento"}, rango ${rank} de ${t.maxRank}`}
                  data-node={t.nodeId}
                  data-state={state}
                  onMouseEnter={() => onHover({ kind: "active", nodeId: t.nodeId })}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover({ kind: "active", nodeId: t.nodeId })}
                  onBlur={() => onHover(null)}
                  onClick={(e) => {
                    onAdd(t.nodeId, e.shiftKey);
                    onSelect({ kind: "active", nodeId: t.nodeId });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onRemove(t.nodeId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete" || e.key === "-") {
                      e.preventDefault();
                      onRemove(t.nodeId);
                    }
                  }}
                >
                  <Icon id={t.iconFileDataId} name={t.name} />
                  <span className="rank">
                    {rank}/{t.maxRank}
                  </span>
                </button>
              );
            })}
          </div>
          {[...rowGate].map(([row, points]) => (
            <span key={row} className={`row-mark${spent >= points ? " open" : ""}`} style={{ top: pos(row) + CELL / 2 - 9 }}>
              {points}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
