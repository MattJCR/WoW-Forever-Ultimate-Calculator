import { int, type RawTables } from "./csv.js";
import type { RacialAbility, Races } from "./model.js";
import { loadOverrides, looksEnglish } from "./language.js";
import { RACIAL_SKILL_LINES, pvpTrinketShare, racialSpells } from "./racial-spells.js";
import type { SpellTables } from "./spell-tables.js";

/**
 * El cliente de Forever es "unificado" y trae las 58 razas de retail en `ChrRaces`. Las jugables son las que
 * tienen filas en `CharBaseInfo` (matriz raza/clase): las 8 clasicas mas Cielonato (95 Alianza, 96 Horda).
 */
export function buildRaces(raw: RawTables, build: string, locale: string, spells: SpellTables): Races {
  const warnings: string[] = [];
  const overrides = loadOverrides(locale);
  const matrix = new Map<number, number[]>();
  for (const r of raw.table("CharBaseInfo")) {
    const list = matrix.get(int(r.RaceID)) ?? [];
    list.push(int(r.ClassID));
    matrix.set(int(r.RaceID), list);
  }

  const racialsByRace = new Map<number, RacialAbility[]>();
  for (const r of raw.table("ChrRaceRacialAbility")) {
    const parsed = parseRacialName(r.Name_lang ?? "");
    if (!parsed) warnings.push(`Habilidad racial ${r.ID}: no se entiende el nombre "${r.Name_lang}"`);
    const list = racialsByRace.get(int(r.ChrRacesID)) ?? [];
    list.push({
      name: parsed?.name ?? (r.Name_lang ?? ""),
      kind: parsed?.kind ?? "passive",
      description: r.Description_lang ?? "",
      iconFileDataId: int(r.Icon) || null,
      order: int(r.Order),
      textOrigin: "client" as const,
      spells: [],
      pvpTrinket: null,
    });
    racialsByRace.set(int(r.ChrRacesID), list);
  }

  const races: Races["races"] = [];
  for (const row of raw.table("ChrRaces")) {
    const id = int(row.ID);
    const classIds = matrix.get(id);
    if (!classIds) continue;
    const racials = (racialsByRace.get(id) ?? []).sort((a, b) => a.order - b.order);
    for (const a of racials) {
      a.spells = racialSpells(raw, spells, id, a.order, warnings);
      if (a.kind === "active") a.pvpTrinket = pvpTrinketShare(raw, spells, a.spells.map((s) => s.spellId));
      // Cielonato trae los nombres de sus raciales en ingles en ChrRaceRacialAbility, pero sus hechizos si tienen nombre en espanol
      const spellName = spells.name(a.spells[0]?.spellId ?? 0);
      if ((id === 95 || id === 96) && spellName && spellName !== a.name) a.name = spellName;
      const own = overrides.racials[a.name];
      if (own?.name) a.name = own.name;
      if (looksEnglish(a.description)) {
        if (own?.description) {
          a.description = own.description;
          a.textOrigin = "translated-by-us";
        } else a.textOrigin = "untranslated";
      } else if (own?.name) a.textOrigin = "translated-by-us";
    }
    if (racials.length === 0) warnings.push(`Raza ${id} (${row.Name_lang}): sin habilidades raciales en ChrRaceRacialAbility`);
    races.push({
      id,
      token: row.ClientFileString ?? "",
      name: row.Name_lang ?? "",
      nameFemale: row.Name_female_lang || null,
      // ChrRaces.Alliance: 0 = Alianza, 1 = Horda.
      faction: int(row.Alliance) === 1 ? "horde" : "alliance",
      classIds: [...new Set(classIds)].sort((a, b) => a - b),
      racialSkillLineId: RACIAL_SKILL_LINES[id] ?? null,
      racials,
    });
  }
  for (const id of matrix.keys()) {
    if (!races.some((r) => r.id === id)) warnings.push(`CharBaseInfo menciona la raza ${id}, que no esta en ChrRaces`);
  }
  // Orden de la web de referencia: Alianza y luego Horda, cada una por UiDisplayOrder del cliente (0 = sin orden: al final).
  const display = new Map(raw.table("ChrRaces").map((r) => [int(r.ID), int(r.UiDisplayOrder)]));
  const uiOrder = (id: number) => display.get(id) || 99;
  races.sort(
    (a, b) =>
      (a.faction === b.faction ? 0 : a.faction === "alliance" ? -1 : 1) || uiOrder(a.id) - uiOrder(b.id) || a.id - b.id,
  );

  return { schemaVersion: 1, build, locale, playableProvenance: "client-db2", races, warnings };
}

/**
 * "Humano - Activa - Voluntad de supervivencia" -> activa. Las de Cielonato vienen sin traducir
 * ("Skyborne - Alliance - Active - Walk on Air"). El nombre es siempre el ultimo tramo.
 */
export function parseRacialName(text: string): { name: string; kind: RacialAbility["kind"] } | null {
  const parts = text.split(" - ").map((s) => s.trim());
  if (parts.length < 3) return null;
  const kindText = parts[parts.length - 2]!.toLowerCase();
  const kind = kindText === "activa" || kindText === "active" ? "active" : kindText === "pasiva" || kindText === "passive" ? "passive" : null;
  return kind ? { name: parts[parts.length - 1]!, kind } : null;
}
