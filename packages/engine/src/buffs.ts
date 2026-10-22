import type { Buff, Buffs } from "@wfuc/schema";
import { classifyGearAuras, type GearEffectSource } from "./gear-effects.js";

/**
 * Beneficios («buffs») que se pueden activar en el Resumen: habilidades de clase (propias o de otras clases), tótems, mascotas y
 * consumibles. Cifras y texto del cliente (`client-db2`); las reglas de acumulación (`group`: una sola bendición de cada tipo, un
 * solo aspecto, una sola armadura…) son las de Classic (`assumption`). Entran en el cálculo como los efectos del equipo: las
 * estadísticas planas se suman al equipo y los porcentajes a los efectos sumados (`collectStatEffects`).
 */

export interface BuffIndex {
  list: Buff[];
  byId: Map<number, Buff>;
}

export const indexBuffs = (data: Buffs): BuffIndex => ({ list: data.buffs, byId: new Map(data.buffs.map((b) => [b.id, b])) });

/** Duración mínima (ms) de una mejora «duradera»; las más cortas son efectos de reutilización o pociones de combate. */
export const LASTING_BUFF_MS = 60_000;
export const isLastingBuff = (b: Pick<Buff, "durationMs">): boolean => b.durationMs === null || b.durationMs >= LASTING_BUFF_MS;

/**
 * Activa o desactiva un beneficio. Al activarlo se quitan los demás de su grupo (no se acumulan). Los ids que ya no existen
 * (un parche los retiró) se descartan.
 */
export function toggleBuff(selected: ReadonlySet<number>, buff: Pick<Buff, "id" | "group">, on: boolean, index: BuffIndex): Set<number> {
  const next = new Set([...selected].filter((id) => index.byId.has(id) && (!on || index.byId.get(id)!.group !== buff.group || id === buff.id)));
  if (on) next.add(buff.id);
  else next.delete(buff.id);
  return next;
}

/** Código del enlace: ids de hechizo en base 36 separados por «.». */
export const encodeBuffs = (selected: ReadonlySet<number>): string => [...selected].sort((a, b) => a - b).map((id) => id.toString(36)).join(".");

/** Lee un código; ignora lo mal formado y lo que ya no existe, y respeta los grupos de exclusión. */
export function decodeBuffs(code: string | null | undefined, index: BuffIndex): Set<number> {
  let out = new Set<number>();
  for (const part of (code ?? "").split(".").filter(Boolean)) {
    const id = parseInt(part, 36);
    const buff = Number.isFinite(id) ? index.byId.get(id) : undefined;
    if (buff) out = toggleBuff(out, buff, true, index);
  }
  return out;
}

/** Un beneficio como efecto de equipo (`kind: "buff"`): sus auras se cuantifican como las de un conjunto o un encantamiento. */
export const buffAsEffect = (b: Buff): GearEffectSource => ({ kind: "buff", name: b.name, origin: b.name, spellId: b.id, text: b.text || b.name, auras: b.auras, slot: null, itemId: null });

export function buffEffects(selected: ReadonlySet<number>, index: BuffIndex): GearEffectSource[] {
  return [...selected].flatMap((id) => {
    const b = index.byId.get(id);
    return b ? [buffAsEffect(b)] : [];
  });
}

/** Estadísticas planas (atributos, poder de ataque, armadura, resistencias…) que suman los beneficios; los porcentajes van por `collectStatEffects`. */
export function buffFlatStats(effects: GearEffectSource[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of effects) for (const s of classifyGearAuras(e.auras, e.text, { trustValues: true }).stats) out[s.key] = (out[s.key] ?? 0) + s.value;
  return out;
}

/** Suma dos tablas de estadísticas. */
export const addStats = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};
