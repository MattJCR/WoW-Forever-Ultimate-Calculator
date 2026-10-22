import { GEAR_SLOTS, SLOT_LABEL, enchantStatLines, ratingPercents, suffixStats, type GearData, type GearSelection, type GearSlot, type GearSummary } from "@wfuc/engine";
import type { CombatRatings, Item, ItemSourceEntry, ItemStat } from "@wfuc/schema";
import { fmtNum, isEnglish, itemName, itemSetName, spellEn, tr, trn } from "../i18n";

/** Color de calidad del juego (0 pobre ... 6 artefacto). */
export const QUALITY_COLORS = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80"];
export const QUALITY_NAMES = ["Pobre", "Común", "Poco común", "Raro", "Épico", "Legendario", "Artefacto"];
export const qualityColor = (q: number): string => QUALITY_COLORS[q] ?? QUALITY_COLORS[1]!;
export const qualityName = (q: number): string => tr(QUALITY_NAMES[q] ?? "Común");

/** Nombre de un objeto en el idioma elegido (el inglés es de la comunidad; si falta, el del cliente). */
export const iName = (i: { id: number; name: string }): string => itemName(i.id, i.name);
/** Nombre de un conjunto de objetos en el idioma elegido. */
export const setLabel = (s: { id?: number; setId?: number; name: string }): string => itemSetName(s.id ?? s.setId ?? -1, s.name);
/**
 * Texto de un efecto de objeto o de un bonus de conjunto en el idioma elegido: el inglés del juego si lo hay (sus cifras ya se han
 * contrastado con las del cliente); si no, el texto del cliente, y como último recurso el nombre del hechizo.
 */
export const effectLabel = (e: { spellId: number; text: string; name: string }): string => {
  const en = isEnglish() ? spellEn(e.spellId) : null;
  return en?.description || e.text || en?.name || e.name || tr("hechizo {id}", { id: e.spellId });
};
/** Líneas de la tarjeta de un objeto con su fuente (hoy solo la profesión que lo fabrica). */
export function sourceLines(entries: ItemSourceEntry[]): string[] {
  const out: string[] = [];
  for (const s of entries) {
    out.push(tr("Fabricado: {skill} ({n})", { skill: isEnglish() ? s.skillEn : s.skill, n: s.minSkill }));
  }
  return out;
}

/** Nombre de un sufijo o encantamiento: el cliente no los trae; `nameEn` es el de la comunidad. */
export const nameOf = (x: { name: string; nameEn?: string | null }): string => (isEnglish() && x.nameEn ? x.nameEn : x.name);
/** Ranura en el idioma elegido. */
export const slotLabel = (s: GearSlot): string => tr(SLOT_LABEL[s]);

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
  "skill-2h-axes": "de habilidad con hachas de dos manos",
  "skill-2h-maces": "de habilidad con mazas de dos manos",
  "skill-2h-swords": "de habilidad con espadas de dos manos",
  "skill-axes": "de habilidad con hachas",
  "skill-bows": "de habilidad con arcos",
  "skill-crossbows": "de habilidad con ballestas",
  "skill-daggers": "de habilidad con dagas",
  "skill-dual-wield": "de habilidad con doble empuñadura",
  "skill-fist-weapons": "de habilidad con armas de puño",
  "skill-guns": "de habilidad con armas de fuego",
  "skill-maces": "de habilidad con mazas",
  "skill-polearms": "de habilidad con armas de asta",
  "skill-staves": "de habilidad con báculos",
  "skill-swords": "de habilidad con espadas",
  "skill-thrown": "de habilidad con armas arrojadizas",
  "skill-wands": "de habilidad con varitas",
  "profession-alchemy": "de habilidad en alquimia",
  "profession-blacksmithing": "de habilidad en herrería",
  "profession-enchanting": "de habilidad en encantamiento",
  "profession-engineering": "de habilidad en ingeniería",
  "profession-jewelcrafting": "de habilidad en joyería",
  "profession-leatherworking": "de habilidad en peletería",
  "profession-herbalism": "de habilidad en herboristería",
  "profession-mining": "de habilidad en minería",
  "profession-skinning": "de habilidad en desuello",
  "profession-cooking": "de habilidad en cocina",
  "profession-first-aid": "de habilidad en primeros auxilios",
  "profession-fishing": "de habilidad en pesca",
  "profession-tailoring": "de habilidad en sastrería",
  "fire-penetration": "de penetración de Fuego",
  "nature-penetration": "de penetración de Naturaleza",
  "frost-penetration": "de penetración de Escarcha",
  "shadow-penetration": "de penetración de Sombras",
  "arcane-penetration": "de penetración de Arcano",
  "attack-power-vs-humanoid": "de poder de ataque contra humanoides",
  "attack-power-vs-elemental": "de poder de ataque contra elementales",
  "attack-power-vs-demon": "de poder de ataque contra demonios",
  "attack-power-vs-undead": "de poder de ataque contra no-muertos",
  "attack-power-vs-dragonkin": "de poder de ataque contra dragonantes",
  "attack-power-vs-giant": "de poder de ataque contra gigantes",
  "attack-power-vs-beast": "de poder de ataque contra bestias",
  "attack-power-vs-mechanical": "de poder de ataque contra mecánicos",
  "spell-damage-vs-humanoid": "de daño con hechizos contra humanoides",
  "spell-damage-vs-elemental": "de daño con hechizos contra elementales",
  "spell-damage-vs-demon": "de daño con hechizos contra demonios",
  "spell-damage-vs-undead": "de daño con hechizos contra no-muertos",
  "spell-damage-vs-dragonkin": "de daño con hechizos contra dragonantes",
  "spell-damage-vs-giant": "de daño con hechizos contra gigantes",
  "spell-damage-vs-beast": "de daño con hechizos contra bestias",
  "spell-damage-vs-mechanical": "de daño con hechizos contra mecánicos",
  "untyped": "de estadística sin tipo en el cliente",
};

/** Nombre corto de la estadistica para tablas («Fuerza», «Puntuación de crítico»…). */
export const statName = (key: string): string => {
  const raw = STAT_LABELS[key];
  if (!raw) return key.startsWith("type:") ? tr("Estadística sin interpretar (tipo {n})", { n: key.slice(5) }) : key;
  if (isEnglish()) {
    const en = tr(raw);
    return en.charAt(0).toUpperCase() + en.slice(1);
  }
  const s = raw.replace(/^de /, "").replace(/^p\. de /, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** «+17 de Fuerza» como en el tooltip del juego. */
export const statLine = (s: { key: string | null; type: number; value: number }): string => {
  const key = s.key ?? `type:${s.type}`;
  const label = STAT_LABELS[key];
  const sign = s.value < 0 ? "" : "+";
  if (!label) return `${sign}${s.value} ${tr("(estadística sin interpretar, tipo {n})", { n: s.type })}`;
  return `${sign}${s.value} ${tr(label)}`;
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

export const itemTypeLabel = (i: Pick<Item, "classId" | "subclassId">): string | null => {
  const es = (i.classId === 4 ? ARMOR_TYPE[i.subclassId] : i.classId === 2 ? WEAPON_TYPE[i.subclassId] : null) ?? null;
  return es ? tr(es) : null;
};
export const inventoryLabel = (n: number): string => tr(INVENTORY_LABEL[n] ?? "—");
export const bondingLabel = (n: number): string | undefined => (BONDING[n] ? tr(BONDING[n]!) : undefined);
export const effectPrefix = (n: number): string => tr(EFFECT_PREFIX[n] ?? "Efecto");

export const BONDING: Record<number, string> = { 1: "Se liga al recogerlo", 2: "Se liga al equiparlo", 3: "Se liga al usarlo", 4: "Objeto de misión" };

/** ItemEffect.TriggerType -> prefijo del tooltip. */
export const EFFECT_PREFIX: Record<number, string> = { 0: "Uso", 1: "Equipar", 2: "Probabilidad al golpear" };

const CLASS_NAMES: Record<number, string> = { 1: "Guerrero", 2: "Paladín", 3: "Cazador", 4: "Pícaro", 5: "Sacerdote", 6: "Caballero de la Muerte", 7: "Chamán", 8: "Mago", 9: "Brujo", 10: "Monje", 11: "Druida" };
/** Clases que pueden usar el objeto segun su mascara (null = todas). */
export function allowedClassNames(mask: number): string[] | null {
  if (mask === -1 || mask === 0) return null;
  const names = Object.entries(CLASS_NAMES).filter(([id]) => (mask & (1 << (Number(id) - 1))) !== 0).map(([, n]) => tr(n));
  return names.length >= 9 ? null : names;
}

/** Resumen corto de las estadisticas de un objeto para la lista del selector. */
export const shortStats = (stats: ItemStat[], max = 4): string => stats.slice(0, max).map(statLine).join(" · ");


/**
 * Líneas del equipo para «Copiar build para IA»: cada ranura con su objeto, sufijo y encantamiento, los totales con su
 * conversión a %, los conjuntos y los efectos de objeto, y los avisos de lo que no se puede llevar. Texto del cliente tal cual.
 */
export function gearLinesForAI(args: { gear: GearSelection; summary: GearSummary; data: GearData; ratings: CombatRatings | null; level: number; code: string }): string[] {
  const { gear, summary, data, ratings, level, code } = args;
  const lines: string[] = [];
  lines.push(`Equipment (character level ${level} for the equip checks; item data from the beta client, stats = client budget tables; random-suffix values are estimates; code g=${code})`);
  for (const slot of GEAR_SLOTS) {
    const worn = gear[slot];
    if (!worn) continue;
    const item = data.items.get(worn.itemId);
    if (!item) {
      lines.push(`- ${SLOT_LABEL[slot]}: item ${worn.itemId} (no longer in the data)`);
      continue;
    }
    const suffix = worn.suffixId ? data.suffixes.get(worn.suffixId) : undefined;
    const enchant = worn.enchantId ? data.enchants.get(worn.enchantId) : undefined;
    const stats = [...item.stats, ...(suffix ? suffixStats(item, suffix) : [])].map(statLine);
    const extra = [suffix ? suffix.name : "", enchant ? `Enchant: ${enchant.name}${enchantStatLines(enchant).length ? ` (${enchantStatLines(enchant).map((s) => statLine({ key: s.key, type: 0, value: s.value })).join(", ")})` : ""}` : ""].filter(Boolean);
    lines.push(`- ${SLOT_LABEL[slot]}: ${item.name}${extra.length ? ` [${extra.join("; ")}]` : ""} (item level ${item.itemLevel}${item.requiredLevel ? `, requires level ${item.requiredLevel}` : ""})${stats.length ? `: ${stats.join(", ")}` : ""}`);
  }
  const armor = summary.armor + (summary.stats["extra-armor"] ?? 0);
  const totals = [...summary.lines].filter((l) => l.key !== "extra-armor").map((l) => `${fmtNum(l.value, 2)} ${statName(l.key)}`);
  if (armor > 0) totals.unshift(`${fmtNum(Math.round(armor), 2)} Armor`);
  if (totals.length) lines.push(`Gear totals: ${totals.join(", ")}.`);
  const pcts = ratings ? ratingPercents(summary.stats, ratings) : [];
  if (pcts.length) lines.push(`Ratings as percentages (one rating per hit/crit/haste in Forever, same at every level; community-measured, not confirmed): ${pcts.map((p) => `${p.label} ${fmtNum(p.value, 2)}${p.unit === "%" ? " %" : ""}`).join(", ")}.`);
  for (const s of summary.sets) lines.push(`Set ${setLabel(s)} (${s.count}/${s.total}): ${s.bonuses.map((b) => `(${b.threshold})${b.active ? " [active]" : ""} ${effectLabel(b)}`).join(" | ")}`);
  for (const e of summary.effects) lines.push(`Item effect, ${e.itemName} (${EFFECT_PREFIX[e.effect.trigger] ?? "Efecto"}): ${effectLabel(e.effect).replace(/\s*\n+\s*/g, " ").trim()}`);
  for (const p of summary.problems) lines.push(`Warning: ${SLOT_LABEL[p.slot]} cannot be worn here (${p.reasons.join("; ")}); it is still counted.`);
  if (summary.incomplete) lines.push("Warning: some items come from the community without stats, so their contribution is missing.");
  lines.push("Hit/crit ratings feed the ability chances; spell power and attack power are shown apart as a Classic-style estimate in each ability card, not mixed into the base numbers.", "");
  return lines;
}
