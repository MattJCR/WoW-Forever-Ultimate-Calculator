import { int, type RawTables } from "./csv.js";
import type { ItemSources, ItemSourceEntry } from "./model.js";

/** Nombre en inglés de las profesiones de fabricación (SkillLine del cliente), para la web en inglés. */
export const SKILL_EN: Record<number, string> = {
  129: "First Aid", 164: "Blacksmithing", 165: "Leatherworking", 171: "Alchemy", 185: "Cooking", 186: "Mining",
  197: "Tailoring", 202: "Engineering", 333: "Enchanting", 755: "Jewelcrafting", 182: "Herbalism", 393: "Skinning", 356: "Fishing",
};

/**
 * Fuente «Fabricado» de cada objeto, del cliente (`client-db2`): un hechizo de profesión (`SkillLineAbility`, sin los de raza/clase)
 * cuyo efecto crea el objeto (`SpellEffect.Effect` 24, `EffectItemType`). `minSkill` = habilidad mínima de la profesión para aprenderla.
 */
export function buildItemSources(raw: RawTables, build: string, itemIds: Set<number>): ItemSources {
  const skillNames = new Map(raw.table("SkillLine").map((r) => [int(r.ID), r.DisplayName_lang ?? ""]));
  const abilitiesBySpell = new Map<string, { skillLine: number; minSkill: number }[]>();
  for (const a of raw.table("SkillLineAbility")) {
    if (int(a.AcquireMethod) === 2) continue; // habilidades de raza o clase, no de profesión
    const list = abilitiesBySpell.get(a.Spell!) ?? [];
    list.push({ skillLine: int(a.SkillLine), minSkill: int(a.MinSkillLineRank) });
    abilitiesBySpell.set(a.Spell!, list);
  }
  const items: Record<string, ItemSourceEntry[]> = {};
  for (const e of raw.table("SpellEffect")) {
    if (int(e.Effect) !== 24) continue;
    const itemId = int(e.EffectItemType);
    if (!itemIds.has(itemId)) continue;
    for (const a of abilitiesBySpell.get(e.SpellID!) ?? []) {
      const skill = skillNames.get(a.skillLine);
      if (!skill) continue;
      const list = (items[String(itemId)] ??= []);
      if (list.some((x) => x.kind === "crafted" && x.skillLine === a.skillLine)) continue;
      list.push({ kind: "crafted", skillLine: a.skillLine, skill, skillEn: SKILL_EN[a.skillLine] ?? skill, minSkill: a.minSkill });
    }
  }
  return { schemaVersion: 1, build, items };
}
