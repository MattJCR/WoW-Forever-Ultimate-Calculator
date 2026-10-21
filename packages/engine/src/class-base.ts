import type { ClassStatLevel, CombatFormulas } from "@wfuc/schema";

/**
 * Valores base de cada clase que el cliente de Forever no trae y que salen de la comunidad (`community`, `combat-formulas.json › classBase`):
 * critico base, esquive base y poder de ataque base. Se contrastaron con las hojas de personaje desnudas de nivel 60 de la beta; los valores
 * por nivel (poder de ataque) usan la formula de Classic, que reproduce esas cifras a nivel 60.
 */
export type ClassBase = CombatFormulas["classBase"][number];

export const classBaseOf = (formulas: Pick<CombatFormulas, "classBase">, classId: number): ClassBase | null => formulas.classBase.find((c) => c.classId === classId) ?? null;

/** Poder de ataque base de la clase (cuerpo a cuerpo y a distancia) a un nivel: nivel × perLevel + flat. A distancia es 0 para las clases sin dato. */
export function baseAttackPower(base: ClassBase | null, level: number): { melee: number; ranged: number } {
  if (!base) return { melee: 0, ranged: 0 };
  return {
    melee: Math.round(level * base.attackPower.perLevel + base.attackPower.flat),
    ranged: base.rangedAttackPower ? Math.round(level * base.rangedAttackPower.perLevel + base.rangedAttackPower.flat) : 0,
  };
}

/** Esquive por punto de agilidad (puntos porcentuales): el critico por agilidad del cliente × el factor de la clase (pícaro y cazador, el doble). */
export const dodgePerAgility = (base: ClassBase | null, stats: Pick<ClassStatLevel, "critPerAgility"> | null): number => (base && stats ? stats.critPerAgility * 100 * base.dodgePerAgilityFactor : 0);

/** Maná cada 5 s por espíritu sin lanzar hechizos: base + espíritu × factor, hacia abajo (tooltip del juego, `community`). */
export const spiritManaPer5s = (formulas: Pick<CombatFormulas, "spiritManaRegen">, spirit: number): number => Math.floor(formulas.spiritManaRegen.per5sBase + spirit * formulas.spiritManaRegen.per5sPerSpirit + 1e-9);
