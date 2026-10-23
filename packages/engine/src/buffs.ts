import type { Buff, Buffs } from "@wfuc/schema";
import { classifyGearAuras, type GearEffectSource } from "./gear-effects.js";
import { masksIntersect, type SpellModifier } from "./spell-mods.js";

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

/**
 * Lo que los talentos (y la Legacy) mejoran de un beneficio: los modificadores de hechizos cuya máscara cruza la del hechizo del beneficio
 * (Fuego interno mejorado +45 % de armadura, Égida demoníaca +30 %, Custodia de Escarcha, Protección Arcana, Encontrar camino, Aspecto del mono
 * mejorado). «Todos los efectos» (operación 8) escala todas sus cifras y «efecto 1/2/3» (3, 12, 23) la del efecto de ese índice. Sin máscara no se mejora.
 */
export function improveBuff(b: Buff, modifiers: readonly SpellModifier[]): Buff {
  const own = b.classMask ? modifiers.filter((m) => masksIntersect(m.mask, b.classMask!)) : [];
  if (own.length === 0) return b;
  const auras = b.auras.map((a) => {
    const ops = [8, [3, 12, 23][a.index] ?? -1];
    const total = (kind: SpellModifier["kind"]): number => own.filter((m) => m.kind === kind && ops.includes(m.op)).reduce((n, m) => n + m.value, 0);
    const flat = total("flat");
    const pct = total("pct");
    return flat === 0 && pct === 0 ? a : { ...a, value: Math.round((a.value + flat) * (1 + pct / 100)) };
  });
  return { ...b, auras };
}

/** Un beneficio como efecto de equipo (`kind: "buff"`): sus auras se cuantifican como las de un conjunto o un encantamiento. */
export const buffAsEffect = (b: Buff, modifiers: readonly SpellModifier[] = []): GearEffectSource => {
  const imp = improveBuff(b, modifiers);
  return { kind: "buff", name: imp.name, origin: imp.name, spellId: imp.id, text: imp.text || imp.name, auras: imp.auras, slot: null, itemId: null };
};

export function buffEffects(selected: ReadonlySet<number>, index: BuffIndex, modifiers: readonly SpellModifier[] = []): GearEffectSource[] {
  return [...selected].flatMap((id) => {
    const b = index.byId.get(id);
    return b ? [buffAsEffect(b, modifiers)] : [];
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
