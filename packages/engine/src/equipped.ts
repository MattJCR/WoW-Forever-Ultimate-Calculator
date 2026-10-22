import type { EquippedRequirement } from "@wfuc/schema";
import { GEAR_SLOTS, type GearData, type GearSelection, type GearSlot } from "./gear.js";

/**
 * Requisitos de objeto equipado de los hechizos (SpellEquippedItems, `client-db2`): «Especialización en armas de dos manos» solo vale con un
 * arma a dos manos, «Bastión» con escudo, «Especialización en varitas» con una varita, Mutilar exige una daga... El cliente trae las
 * máscaras de clase, subtipo y tipo de ranura del objeto; aquí se comprueban contra lo que lleva el personaje.
 */

/** Lo que importa de un objeto llevado para comprobar un requisito. */
export interface WornItem {
  slot: GearSlot;
  itemClass: number;
  subclassId: number;
  inventoryType: number;
}

/** Lo que lleva el personaje (null = no se ha elegido equipo: los requisitos no se comprueban). */
export type EquippedState = { items: WornItem[] } | null;

const WEAPON = 2;
const ARMOR = 4;
/** Tipo de ranura «arma de la mano izquierda» (INVTYPE_WEAPONOFFHAND): el requisito de doble empuñadura lo exige. */
const OFF_HAND_WEAPON = 22;

/** Objetos llevados y contados (`counted`: ya filtrados por nivel). Sin ningún objeto devuelve null: sin equipo elegido no se aplica ningún requisito. */
export function equippedStateOf(counted: GearSelection, data: Pick<GearData, "items">): EquippedState {
  const items: WornItem[] = [];
  for (const slot of GEAR_SLOTS) {
    const worn = counted[slot];
    const item = worn ? data.items.get(worn.itemId) : undefined;
    if (item) items.push({ slot, itemClass: item.classId, subclassId: item.subclassId, inventoryType: item.inventoryType });
  }
  return items.length > 0 ? { items } : null;
}

const bit = (mask: number, n: number): boolean => n >= 0 && n < 31 && (mask & (1 << n)) !== 0;

/** ¿Este objeto cumple la fila? Un arma en la mano izquierda cuenta también como «arma de la mano izquierda». */
function itemMeets(req: EquippedRequirement, item: WornItem): boolean {
  if (item.itemClass !== req.itemClass) return false;
  if (req.subclassMask !== 0 && !bit(req.subclassMask, item.subclassId)) return false;
  if (req.invTypeMask !== 0) {
    const asOffHand = item.slot === "offHand" && item.itemClass === WEAPON && bit(req.invTypeMask, OFF_HAND_WEAPON);
    if (!bit(req.invTypeMask, item.inventoryType) && !asOffHand) return false;
  }
  return true;
}

/** Sin requisito, o sin equipo elegido, se da por cumplido; con equipo, basta con que una fila la cumpla algún objeto llevado. */
export function meetsEquipped(reqs: EquippedRequirement[] | undefined, state: EquippedState): boolean {
  if (!reqs || reqs.length === 0 || state === null) return true;
  return reqs.some((r) => state.items.some((it) => itemMeets(r, it)));
}

const WEAPON_SUBCLASS_NAME: Record<number, string> = {
  0: "un hacha de una mano", 1: "un hacha de dos manos", 2: "un arco", 3: "un arma de fuego", 4: "una maza de una mano", 5: "una maza de dos manos",
  6: "un arma de asta", 7: "una espada de una mano", 8: "una espada de dos manos", 10: "un bastón", 13: "un arma de puño", 15: "una daga",
  16: "un arma arrojadiza", 18: "una ballesta", 19: "una varita",
};
const bits = (mask: number): number[] => Array.from({ length: 31 }, (_, i) => i).filter((i) => bit(mask, i));
const sameBits = (mask: number, list: number[]): boolean => {
  const have = bits(mask);
  return have.length === list.length && list.every((n) => have.includes(n));
};

/** Descripción corta del requisito, en español: «una varita», «un arma a dos manos», «un escudo», «una daga»... */
export function describeEquipped(reqs: EquippedRequirement[]): string {
  const names = reqs.map((r) => {
    if (r.itemClass === ARMOR) return bits(r.subclassMask).includes(6) && bits(r.subclassMask).length === 1 ? "un escudo" : "una armadura concreta";
    if (r.itemClass !== WEAPON) return "un objeto concreto";
    const have = bits(r.subclassMask);
    if (r.subclassMask === 0) return r.invTypeMask !== 0 && bit(r.invTypeMask, OFF_HAND_WEAPON) ? "un arma en la mano izquierda" : "un arma";
    const inOffHand = r.invTypeMask !== 0 && bit(r.invTypeMask, OFF_HAND_WEAPON) ? " en la mano izquierda" : "";
    if (have.length === 1) return `${WEAPON_SUBCLASS_NAME[have[0]!] ?? "un arma"}${inOffHand}`;
    if (sameBits(r.subclassMask, [2, 3, 18])) return "un arma a distancia";
    if (have.every((n) => [1, 5, 6, 8, 10, 12, 17].includes(n))) return `un arma a dos manos${inOffHand}`;
    if (have.every((n) => [0, 4, 7, 11, 13, 15].includes(n))) return `un arma de una mano${inOffHand}`;
    if (have.every((n) => [0, 1, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 17].includes(n))) return `un arma cuerpo a cuerpo${inOffHand}`;
    return `un arma concreta${inOffHand}`;
  });
  return [...new Set(names)].join(" o ");
}
