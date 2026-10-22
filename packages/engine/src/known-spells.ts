import type { Abilities } from "@wfuc/schema";
import { rankOf, type Build, type ClassIndex } from "./rules.js";

/**
 * Hechizos que el personaje «conoce» para las condicionales de los textos del cliente (`$?s123[si][no]` = si conoces el hechizo 123,
 * `$?a123[...]` = si tienes el aura 123): los talentos y ventajas de Legacy escogidos (con cualquier rango) y las habilidades de la clase que
 * ya ha aprendido a ese nivel. Las habilidades de runa no cuentan: no se sabe cuáles ha grabado el personaje. Procedencia: client-db2.
 */
export function knownSpellIds(input: { cls: ClassIndex; classBuild: Build; legacy: ClassIndex | null; legacyBuild: Build; abilities: Abilities | null; level: number }): Set<number> {
  const known = new Set<number>();
  const addTree = (idx: ClassIndex, build: Build) => {
    for (const { talent } of idx.ordered) if (rankOf(build, talent.nodeId) > 0) known.add(talent.spellId);
  };
  addTree(input.cls, input.classBuild);
  if (input.legacy) addTree(input.legacy, input.legacyBuild);
  for (const a of input.abilities?.abilities ?? []) for (const r of a.ranks) if (r.level <= input.level && r.acquireMethod !== 3) known.add(r.spellId);
  return known;
}

/**
 * Valor de un efecto (0 = primero) de un talento escogido, al rango que tiene el personaje: las cifras que citan los textos de otras
 * habilidades (`$17245m1` en Enredaderas = +objetivos de Sobrecrecimiento). null si el talento no está escogido o no tiene ese valor.
 */
export function talentEffectValue(input: { cls: ClassIndex; classBuild: Build; legacy: ClassIndex | null; legacyBuild: Build }, spellId: number, effectIndex: number): number | null {
  for (const [idx, build] of [[input.cls, input.classBuild], [input.legacy, input.legacyBuild]] as const) {
    if (!idx) continue;
    for (const { talent } of idx.ordered) {
      if (talent.spellId !== spellId) continue;
      const rank = rankOf(build, talent.nodeId);
      if (rank > 0) return talent.rankValues[rank - 1]?.[effectIndex] ?? null;
    }
  }
  return null;
}
