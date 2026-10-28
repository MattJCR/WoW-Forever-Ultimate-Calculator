import { canEquip, enchantOptions, equipItem, slotsForItem, suffixOptions, type GearContext, type GearData, type GearSelection, type GearSlot } from "./gear.js";
import type { Item } from "@wfuc/schema";

/** Ranuras que se rellenan, las armas primero (una de dos manos deja libre la mano izquierda). Camisa y tabardo son cosméticos y se dejan vacíos. */
const SLOTS: GearSlot[] = ["mainHand", "head", "shoulder", "back", "chest", "wrist", "hands", "waist", "legs", "feet", "neck", "finger1", "finger2", "trinket1", "trinket2", "offHand", "ranged"];

/** Objetos de prueba o internos del cliente que no tienen sentido en un equipo aleatorio. */
const JUNK = /\[DNT\]|DNT\)|Placeholder|^Deprecated|^\d+ (Epic|Green|Blue|Rare|Common)\b/i;

/** Probabilidad de que una pieza con encantamientos posibles lleve uno. */
const ENCHANT_CHANCE = 0.6;

const pools = new WeakMap<GearData, Map<GearSlot, Item[]>>();

/** Objetos que caben en la ranura: con datos, de calidad común o mejor y sin nombre de prueba (se calcula una vez por ranura). */
function poolOf(data: GearData, slot: GearSlot): Item[] {
  let bySlot = pools.get(data);
  if (!bySlot) pools.set(data, (bySlot = new Map()));
  let pool = bySlot.get(slot);
  if (!pool) {
    pool = [...data.items.values()].filter((i) => !i.placeholder && i.quality >= 1 && !JUNK.test(i.name) && slotsForItem(i).includes(slot));
    bySlot.set(slot, pool);
  }
  return pool;
}

/**
 * Equipo aleatorio que el personaje puede llevar: para cada ranura prueba objetos al azar hasta dar con uno que `canEquip` acepta (clase, nivel,
 * competencias, manos, objetos únicos). Una ranura sin ningún objeto posible se queda vacía. Un objeto que admite sufijo aleatorio lleva
 * uno y, a veces, la pieza lleva un encantamiento de los que caben en su ranura. Sin mejoras temporales de arma.
 */
export function randomGear(data: GearData, ctx: GearContext, rng: () => number = Math.random, tries = 80): GearSelection {
  let gear: GearSelection = {};
  for (const slot of SLOTS) {
    const pool = poolOf(data, slot);
    if (pool.length === 0) continue;
    for (let n = 0; n < tries; n++) {
      const item = pool[Math.floor(rng() * pool.length)]!;
      if (item.requiredLevel > ctx.level || !canEquip(item, slot, ctx, data, gear).ok) continue;
      const suffixes = suffixOptions(item, data);
      const enchants = enchantOptions(data, slot, item);
      const suffixId = suffixes.length ? suffixes[Math.floor(rng() * suffixes.length)]! : null;
      const enchantId = enchants.length && rng() < ENCHANT_CHANCE ? enchants[Math.floor(rng() * enchants.length)]!.effectId : null;
      gear = equipItem(gear, slot, item, data.items, { enchantId, suffixId });
      break;
    }
  }
  return gear;
}
