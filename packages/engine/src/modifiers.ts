import { rankOf, type Build, type ClassIndex } from "./rules.js";

/**
 * Talentoso (Legacy, hechizo 1225474): "Empiezas a obtener puntos de talento en cada nivel a partir del nivel N, en vez
 * de a partir del nivel 10, pero seguiras sin poder conseguir mas de 51 puntos de talento en total". N es el primer
 * valor de efecto del rango (9, 8, 7, 6, 5 para los rangos 1 a 5): sale de los datos del cliente.
 * Por eso Legacy se elige ANTES que los talentos de clase: cambia el nivel que exigen.
 */
export const TALENTED_SPELL_ID = 1225474;

/** Nivel del primer punto de talento: el de la clase, o el que fija Talentoso si es menor. */
export function firstPointLevel(cls: ClassIndex, legacy: ClassIndex | null, legacyBuild: Build): { level: number; fromLegacy: boolean } {
  const base = cls.data.rules.firstPointLevel ?? 10;
  const talented = legacy?.ordered.find((i) => i.talent.spellId === TALENTED_SPELL_ID);
  const rank = talented ? rankOf(legacyBuild, talented.talent.nodeId) : 0;
  const value = talented && rank > 0 ? talented.talent.rankValues[rank - 1]?.[0] : null;
  if (typeof value === "number" && value > 0 && value < base) return { level: value, fromLegacy: true };
  return { level: base, fromLegacy: false };
}

/** Nivel necesario para los puntos de clase gastados, teniendo en cuenta las ventajas de Legacy que lo cambian. */
export function characterRequiredLevel(cls: ClassIndex, classPoints: number, legacy: ClassIndex | null, legacyBuild: Build): number {
  const { level } = firstPointLevel(cls, legacy, legacyBuild);
  return classPoints <= 0 ? 1 : level - 1 + classPoints;
}
