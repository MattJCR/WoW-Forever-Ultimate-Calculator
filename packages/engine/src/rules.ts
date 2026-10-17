import type { ClassTalents, InactiveTalent, Talent } from "@wfuc/schema";

/** Rango gastado por nodo (nodeId -> rango). Los nodos sin entrada tienen rango 0. */
export type Build = Readonly<Record<number, number>>;

export interface IndexedTalent {
  talent: Talent;
  specIndex: number;
}

/** Vista indexada de una clase para consultar reglas rapido. */
export interface ClassIndex {
  data: ClassTalents;
  byNode: Map<number, IndexedTalent>;
  inactiveByNode: Map<number, InactiveTalent>;
  /** Talentos en orden estable (especializacion, fila, columna): base de la codificacion. */
  ordered: IndexedTalent[];
}

export function indexClass(data: ClassTalents): ClassIndex {
  const ordered: IndexedTalent[] = [];
  for (const spec of data.specs) {
    const sorted = [...spec.talents].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const talent of sorted) ordered.push({ talent, specIndex: spec.index });
  }
  return {
    data,
    byNode: new Map(ordered.map((i) => [i.talent.nodeId, i])),
    inactiveByNode: new Map(data.inactiveTalents.map((t) => [t.nodeId, t])),
    ordered,
  };
}

export const rankOf = (build: Build, nodeId: number): number => build[nodeId] ?? 0;

export function totalPoints(build: Build): number {
  let n = 0;
  for (const v of Object.values(build)) n += v;
  return n;
}

export function specPoints(idx: ClassIndex, build: Build, specIndex: number): number {
  let n = 0;
  for (const { talent, specIndex: s } of idx.ordered) if (s === specIndex) n += rankOf(build, talent.nodeId);
  return n;
}

/** Puntos gastados en la misma especializacion en filas estrictamente superiores a `row` (mas arriba). */
export function pointsAbove(idx: ClassIndex, build: Build, specIndex: number, row: number): number {
  let n = 0;
  for (const { talent, specIndex: s } of idx.ordered) if (s === specIndex && talent.row < row) n += rankOf(build, talent.nodeId);
  return n;
}

/** Nivel minimo para tener `total` puntos: el primer punto se gana en `firstPointLevel`. */
export function requiredLevel(idx: ClassIndex, total: number): number {
  const first = idx.data.rules.firstPointLevel ?? 10;
  return total <= 0 ? 1 : first - 1 + total;
}

export type Blocker =
  | "unknown-node"
  | "inactive"
  | "max-rank"
  | "no-points"
  | "row-locked"
  | "prerequisite"
  | "not-allocated"
  | "required-by-others";

export interface Check {
  ok: boolean;
  reason?: Blocker;
  /** Detalle para mostrar: puntos que faltan en filas superiores, o nodo prerrequisito. */
  detail?: { missingPoints?: number; prerequisiteNodeId?: number; dependentNodeId?: number };
}

/** Puntos que un talento tiene gastados en su grupo contador (para mostrar "X/N" en la interfaz). */
export function gateProgress(idx: ClassIndex, build: Build, talent: Talent, specIndex: number): { have: number; need: number } {
  const need = talent.requiredPoints;
  const have = talent.gate
    ? talent.gate.fromNodeIds.reduce((n, id) => n + rankOf(build, id), 0)
    : pointsAbove(idx, build, specIndex, talent.row);
  return { have, need };
}

/** Comprueba las reglas que dependen de otros nodos (no incluye limite de puntos ni rango maximo). */
function nodeRulesOk(idx: ClassIndex, build: Build, { talent, specIndex }: IndexedTalent): Check {
  const need = talent.requiredPoints;
  if (need > 0) {
    // Requisito exacto del cliente: puntos gastados entre los nodos del grupo contador (filas superiores en
    // las clases, todo el arbol en Legacy). Si el dato no lo trae, se usa la regla de "filas superiores".
    const have = talent.gate
      ? talent.gate.fromNodeIds.reduce((n, id) => n + rankOf(build, id), 0)
      : pointsAbove(idx, build, specIndex, talent.row);
    if (have < need) return { ok: false, reason: "row-locked", detail: { missingPoints: need - have } };
  }
  for (const p of talent.prerequisites) {
    const pre = idx.byNode.get(p.nodeId);
    // Regla supuesta (como en Classic): hace falta el rango maximo del nodo previo.
    if (!pre || rankOf(build, p.nodeId) < pre.talent.maxRank) {
      return { ok: false, reason: "prerequisite", detail: { prerequisiteNodeId: p.nodeId } };
    }
  }
  return { ok: true };
}

export function canAdd(idx: ClassIndex, build: Build, nodeId: number): Check {
  if (idx.inactiveByNode.has(nodeId)) return { ok: false, reason: "inactive" };
  const item = idx.byNode.get(nodeId);
  if (!item) return { ok: false, reason: "unknown-node" };
  if (rankOf(build, nodeId) >= item.talent.maxRank) return { ok: false, reason: "max-rank" };
  if (totalPoints(build) >= idx.data.rules.maxPoints) return { ok: false, reason: "no-points" };
  return nodeRulesOk(idx, build, item);
}

/** Quitar un punto es valido si el resultado sigue cumpliendo las reglas en todos los nodos con puntos. */
export function canRemove(idx: ClassIndex, build: Build, nodeId: number): Check {
  if (idx.inactiveByNode.has(nodeId)) return { ok: false, reason: "inactive" };
  const item = idx.byNode.get(nodeId);
  if (!item) return { ok: false, reason: "unknown-node" };
  if (rankOf(build, nodeId) <= 0) return { ok: false, reason: "not-allocated" };
  const after = { ...build, [nodeId]: rankOf(build, nodeId) - 1 };
  for (const other of idx.ordered) {
    if (other.talent.nodeId === nodeId || rankOf(after, other.talent.nodeId) === 0) continue;
    if (!nodeRulesOk(idx, after, other).ok) {
      return { ok: false, reason: "required-by-others", detail: { dependentNodeId: other.talent.nodeId } };
    }
  }
  // El propio nodo puede seguir con puntos pero perder un prerrequisito maximo (p. ej. quitar rango al previo)
  const self = rankOf(after, nodeId);
  if (self > 0 && !nodeRulesOk(idx, after, item).ok) return { ok: false, reason: "required-by-others" };
  return { ok: true };
}

export function addPoint(idx: ClassIndex, build: Build, nodeId: number): Build {
  return canAdd(idx, build, nodeId).ok ? { ...build, [nodeId]: rankOf(build, nodeId) + 1 } : build;
}

export function removePoint(idx: ClassIndex, build: Build, nodeId: number): Build {
  if (!canRemove(idx, build, nodeId).ok) return build;
  const next = { ...build, [nodeId]: rankOf(build, nodeId) - 1 };
  if (next[nodeId] === 0) delete (next as Record<number, number>)[nodeId];
  return next;
}

export interface Validation {
  ok: boolean;
  errors: string[];
}

/** Valida un build completo (p. ej. uno decodificado de la URL). */
export function validateBuild(idx: ClassIndex, build: Build): Validation {
  const errors: string[] = [];
  for (const [id, rank] of Object.entries(build)) {
    const item = idx.byNode.get(Number(id));
    if (!item) {
      errors.push(`Nodo ${id} desconocido o no activo`);
      continue;
    }
    if (rank < 0 || rank > item.talent.maxRank) errors.push(`${item.talent.name ?? id}: rango ${rank} fuera de 0..${item.talent.maxRank}`);
  }
  if (totalPoints(build) > idx.data.rules.maxPoints) errors.push(`Mas de ${idx.data.rules.maxPoints} puntos`);
  for (const item of idx.ordered) {
    if (rankOf(build, item.talent.nodeId) > 0) {
      const c = nodeRulesOk(idx, build, item);
      if (!c.ok) errors.push(`${item.talent.name ?? item.talent.nodeId}: incumple ${c.reason}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
