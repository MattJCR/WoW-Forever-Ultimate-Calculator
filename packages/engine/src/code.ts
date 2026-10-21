import { canAdd, rankOf, validateBuild, type Blocker, type Build, type ClassIndex } from "./rules.js";

/**
 * Codigo corto de un build (formato 2): `V2` + una entrada por talento con puntos, ordenadas por nodeId. Cada entrada es el
 * nodeId (el primero absoluto, los demas como diferencia con el anterior) en base 36 minuscula seguido del rango como letra
 * mayuscula (A = 1 ... E = 5). Ejemplo: nodos 105762 (rango 3) y 105765 (rango 1) -> `V2` + `29luC` + `3A`. Un build vacio es
 * la cadena vacia.
 *
 * Identifica cada talento por su nodo y NO por su posicion en la rejilla: un hotfix que quita, anade o mueve talentos no
 * descoloca los demas, y la lectura (`decodeBuildReport`) conserva lo que sigue siendo valido y cuenta lo que se pierde.
 * Los codigos del formato 1 (un digito por talento y posicion, con guiones) se siguen leyendo si encajan con los datos actuales.
 */
export const CODE_PREFIX = "V2";
const ENTRY = /([0-9a-z]+)([A-E])/g;
const FORMAT2 = /^V2(?:[0-9a-z]+[A-E])*$/;
const FORMAT1 = /^[0-9]*(?:-[0-9]*)*$/;

export function encodeBuild(idx: ClassIndex, build: Build): string {
  const ids = idx.ordered
    .map((i) => i.talent.nodeId)
    .filter((id) => rankOf(build, id) > 0)
    .sort((a, b) => a - b);
  let prev = 0;
  let out = "";
  for (const id of ids) {
    out += (id - prev).toString(36) + String.fromCharCode(64 + rankOf(build, id));
    prev = id;
  }
  return out ? CODE_PREFIX + out : "";
}

/** Un talento del enlace que no se ha podido aplicar tal cual. */
export interface LostPoints {
  nodeId: number;
  /** Nombre si el nodo sigue existiendo; null si ya no esta en los datos. */
  name: string | null;
  wanted: number;
  kept: number;
  reason: Blocker | "removed" | "max-rank-lowered";
}

export interface DecodeReport {
  build: Build;
  /** Puntos del enlace que no se han podido conservar (vacio = el enlace encaja exactamente con los datos). */
  lost: LostPoints[];
  /** El texto no es un codigo (ni del formato 2 ni del 1). */
  malformed: boolean;
  /** Se leyo con el formato 1 (posicional); si los datos cambiaron desde que se creo, puede no coincidir. */
  legacyFormat: boolean;
}

/**
 * Lee un codigo con tolerancia: ignora los nodos que ya no existen, recorta los rangos que bajaron y coloca los puntos
 * respetando las reglas (filas, prerrequisitos, maximo de puntos); lo que no cabe se lista en `lost` en vez de invalidar todo.
 */
export function decodeBuildReport(idx: ClassIndex, code: string): DecodeReport {
  const empty = (extra: Partial<DecodeReport> = {}): DecodeReport => ({ build: {}, lost: [], malformed: false, legacyFormat: false, ...extra });
  if (code === "") return empty();
  if (FORMAT1.test(code)) return decodePositional(idx, code);
  if (!FORMAT2.test(code)) return empty({ malformed: true });

  const wanted = new Map<number, number>();
  let id = 0;
  for (const m of code.slice(CODE_PREFIX.length).matchAll(ENTRY)) {
    id += Number.parseInt(m[1]!, 36);
    wanted.set(id, m[2]!.charCodeAt(0) - 64);
  }
  return place(idx, wanted);
}

/** Coloca los rangos pedidos en un build valido; devuelve lo que no ha cabido. */
function place(idx: ClassIndex, wanted: Map<number, number>, legacyFormat = false): DecodeReport {
  const lost: LostPoints[] = [];
  const target = new Map<number, number>();
  for (const [nodeId, rank] of wanted) {
    const item = idx.byNode.get(nodeId);
    if (!item) {
      lost.push({ nodeId, name: idx.inactiveByNode.get(nodeId)?.name ?? null, wanted: rank, kept: 0, reason: idx.inactiveByNode.has(nodeId) ? "inactive" : "removed" });
      continue;
    }
    if (rank > item.talent.maxRank) lost.push({ nodeId, name: item.talent.name ?? null, wanted: rank, kept: item.talent.maxRank, reason: "max-rank-lowered" });
    target.set(nodeId, Math.min(rank, item.talent.maxRank));
  }
  // Se anade punto a punto en el orden de la rejilla hasta que no haya progreso: asi los prerrequisitos y las filas
  // superiores se rellenan antes que lo que depende de ellos.
  let build: Build = {};
  let progress = true;
  while (progress) {
    progress = false;
    for (const { talent } of idx.ordered) {
      const goal = target.get(talent.nodeId) ?? 0;
      while (rankOf(build, talent.nodeId) < goal && canAdd(idx, build, talent.nodeId).ok) {
        build = { ...build, [talent.nodeId]: rankOf(build, talent.nodeId) + 1 };
        progress = true;
      }
    }
  }
  for (const [nodeId, goal] of target) {
    const have = rankOf(build, nodeId);
    if (have >= goal) continue;
    const prior = lost.find((l) => l.nodeId === nodeId);
    const reason = canAdd(idx, build, nodeId).reason ?? "row-locked";
    if (prior) {
      prior.kept = have;
      prior.reason = reason;
    } else lost.push({ nodeId, name: idx.byNode.get(nodeId)!.talent.name ?? null, wanted: goal, kept: have, reason });
  }
  return { build, lost, malformed: false, legacyFormat };
}

/** Formato 1: un digito por talento en orden (especializacion, fila, columna), con '-' entre especializaciones. */
function decodePositional(idx: ClassIndex, code: string): DecodeReport {
  const parts = code.split("-");
  if (parts.length !== idx.data.specs.length) return { build: {}, lost: [], malformed: true, legacyFormat: true };
  const wanted = new Map<number, number>();
  for (const spec of idx.data.specs) {
    const digits = parts[spec.index]!;
    const talents = idx.ordered.filter((i) => i.specIndex === spec.index);
    if (digits.length > talents.length) return { build: {}, lost: [], malformed: true, legacyFormat: true };
    for (let i = 0; i < digits.length; i++) {
      const rank = Number(digits[i]);
      if (rank > 0) wanted.set(talents[i]!.talent.nodeId, rank);
    }
  }
  return place(idx, wanted, true);
}

/**
 * Devuelve el build si el codigo encaja EXACTAMENTE con los datos actuales y null si no (incluye la perdida de puntos).
 * Para leer enlaces de otros parches usa `decodeBuildReport`.
 */
export function decodeBuild(idx: ClassIndex, code: string): Build | null {
  const r = decodeBuildReport(idx, code);
  return r.malformed || r.lost.length > 0 || !validateBuild(idx, r.build).ok ? null : r.build;
}
