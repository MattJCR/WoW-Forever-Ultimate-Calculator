import type { GearSlot } from "@wfuc/engine";
import type { Item, ItemStat } from "@wfuc/schema";

/** Color de calidad del juego (0 pobre ... 6 artefacto). */
export const QUALITY_COLORS = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80"];
export const QUALITY_NAMES = ["Pobre", "Común", "Poco común", "Raro", "Épico", "Legendario", "Artefacto"];
export const qualityColor = (q: number): string => QUALITY_COLORS[q] ?? QUALITY_COLORS[1]!;

/** Nombre de cada estadistica de objeto (ItemStat.key). Las puntuaciones se llaman «puntuación» como en la pestaña de ratings de Forever. */
export const STAT_LABELS: Record<string, string> = {
  strength: "de Fuerza",
  agility: "de Agilidad",
  stamina: "de Aguante",
  intellect: "de Intelecto",
  spirit: "de Espíritu",
  mana: "p. de maná",
  health: "p. de vida",
  defense: "de habilidad de defensa",
  "dodge-rating": "de puntuación de esquivar",
  "parry-rating": "de puntuación de parada",
  "block-rating": "de puntuación de bloqueo",
  "hit-rating": "de puntuación de impacto",
  "crit-rating": "de puntuación de crítico",
  "haste-rating": "de puntuación de celeridad",
  "expertise-rating": "de puntuación de pericia",
  "attack-power": "de poder de ataque",
  "ranged-attack-power": "de poder de ataque a distancia",
  "healing-power": "de poder de sanación",
  "spell-damage": "de daño de hechizos",
  "spell-power": "de poder con hechizos",
  "mana-per-5": "p. de maná cada 5 s",
  "health-regen": "p. de vida cada 5 s",
  "spell-penetration": "de penetración de hechizos",
  "block-value": "de valor de bloqueo",
  "extra-armor": "de armadura",
  "fire-resistance": "de resistencia al Fuego",
  "frost-resistance": "de resistencia a la Escarcha",
  "holy-resistance": "de resistencia a lo Sagrado",
  "shadow-resistance": "de resistencia a las Sombras",
  "nature-resistance": "de resistencia a la Naturaleza",
  "arcane-resistance": "de resistencia a lo Arcano",
  "holy-power": "de daño de hechizos Sagrados",
  "fire-power": "de daño de hechizos de Fuego",
  "nature-power": "de daño de hechizos de Naturaleza",
  "frost-power": "de daño de hechizos de Escarcha",
  "shadow-power": "de daño de hechizos de Sombras",
  "arcane-power": "de daño de hechizos Arcanos",
  "armor-no-mods": "de armadura (sin modificadores)",
};

/** Nombre corto de la estadistica para tablas («Fuerza», «Puntuación de crítico»…). */
export const statName = (key: string): string => {
  const raw = STAT_LABELS[key];
  if (!raw) return key.startsWith("type:") ? `Estadística sin interpretar (tipo ${key.slice(5)})` : key;
  const s = raw.replace(/^de /, "").replace(/^p\. de /, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** «+17 de Fuerza» como en el tooltip del juego. */
export const statLine = (s: { key: string | null; type: number; value: number }): string => {
  const key = s.key ?? `type:${s.type}`;
  const label = STAT_LABELS[key];
  const sign = s.value < 0 ? "" : "+";
  if (!label) return `${sign}${s.value} (estadística sin interpretar, tipo ${s.type})`;
  return `${sign}${s.value} ${label}`;
};

export const SLOT_ORDER_LEFT: GearSlot[] = ["head", "neck", "shoulder", "back", "chest", "shirt", "tabard", "wrist"];
export const SLOT_ORDER_RIGHT: GearSlot[] = ["hands", "waist", "legs", "feet", "finger1", "finger2", "trinket1", "trinket2"];
export const SLOT_ORDER_BOTTOM: GearSlot[] = ["mainHand", "offHand", "ranged"];

/** InventoryType del cliente -> texto del tooltip. */
export const INVENTORY_LABEL: Record<number, string> = {
  1: "Cabeza", 2: "Cuello", 3: "Hombros", 4: "Camisa", 5: "Pecho", 6: "Cintura", 7: "Piernas", 8: "Pies", 9: "Muñecas", 10: "Manos",
  11: "Dedo", 12: "Abalorio", 13: "Una mano", 14: "Mano izquierda", 15: "A distancia", 16: "Espalda", 17: "Dos manos", 19: "Tabardo",
  20: "Pecho", 21: "Mano derecha", 22: "Mano izquierda", 23: "Sostener en mano izquierda", 25: "Arrojadiza", 26: "A distancia", 28: "Reliquia",
};
const ARMOR_TYPE: Record<number, string> = { 1: "Tela", 2: "Cuero", 3: "Malla", 4: "Placas", 6: "Escudo", 7: "Libro", 8: "Ídolo", 9: "Tótem" };
const WEAPON_TYPE: Record<number, string> = {
  0: "Hacha", 1: "Hacha", 2: "Arco", 3: "Arma de fuego", 4: "Maza", 5: "Maza", 6: "Arma de asta", 7: "Espada", 8: "Espada", 10: "Bastón",
  13: "Arma de puño", 15: "Daga", 16: "Arrojadiza", 18: "Ballesta", 19: "Varita",
};

export const itemTypeLabel = (i: Pick<Item, "classId" | "subclassId">): string | null => (i.classId === 4 ? ARMOR_TYPE[i.subclassId] : i.classId === 2 ? WEAPON_TYPE[i.subclassId] : null) ?? null;

export const BONDING: Record<number, string> = { 1: "Se liga al recogerlo", 2: "Se liga al equiparlo", 3: "Se liga al usarlo", 4: "Objeto de misión" };

/** ItemEffect.TriggerType -> prefijo del tooltip. */
export const EFFECT_PREFIX: Record<number, string> = { 0: "Uso", 1: "Equipar", 2: "Probabilidad al golpear" };

const CLASS_NAMES: Record<number, string> = { 1: "Guerrero", 2: "Paladín", 3: "Cazador", 4: "Pícaro", 5: "Sacerdote", 6: "Caballero de la Muerte", 7: "Chamán", 8: "Mago", 9: "Brujo", 10: "Monje", 11: "Druida" };
/** Clases que pueden usar el objeto segun su mascara (null = todas). */
export function allowedClassNames(mask: number): string[] | null {
  if (mask === -1 || mask === 0) return null;
  const names = Object.entries(CLASS_NAMES).filter(([id]) => (mask & (1 << (Number(id) - 1))) !== 0).map(([, n]) => n);
  return names.length >= 9 ? null : names;
}

/** Resumen corto de las estadisticas de un objeto para la lista del selector. */
export const shortStats = (stats: ItemStat[], max = 4): string => stats.slice(0, max).map(statLine).join(" · ");
