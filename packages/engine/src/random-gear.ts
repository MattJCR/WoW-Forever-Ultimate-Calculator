import { canEquip, equipItem, slotsForItem, type GearContext, type GearData, type GearSelection, type GearSlot } from "./gear.js";
import type { Item } from "@wfuc/schema";

/** Ranuras que se rellenan, las armas primero (una de dos manos deja libre la mano izquierda). Camisa y tabardo son cosméticos y se dejan vacíos. */
const SLOTS: GearSlot[] = ["mainHand", "head", "shoulder", "back", "chest", "wrist", "hands", "waist", "legs", "feet", "neck", "finger1", "finger2", "trinket1", "trinket2", "offHand", "ranged"];

/** Objetos de prueba o internos del cliente que no tienen sentido en un equipo aleatorio. */
const JUNK = /\[DNT\]|DNT\)|Placeholder|^Deprecated|^\d+ (Epic|Green|Blue|Rare|Common)\b/i;

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
 * competencias, manos, objetos únicos). Una ranura sin ningún objeto posible se queda vacía. Sin encantamientos, sufijos ni mejoras.
 */
export function randomGear(data: GearData, ctx: GearContext, rng: () => number = Math.random, tries = 80): GearSelection {
  let gear: GearSelection = {};
  for (const slot of SLOTS) {
    const pool = poolOf(data, slot);
    if (pool.length === 0) continue;
    for (let n = 0; n < tries; n++) {
      const item = pool[Math.floor(rng() * pool.length)]!;
      if (item.requiredLevel > ctx.level || !canEquip(item, slot, ctx, data, gear).ok) continue;
      gear = equipItem(gear, slot, item, data.items);
      break;
    }
  }
  return gear;
}
