import { int, type RawTables } from "./csv.js";
import type { EquipRules, Proficiency } from "./model.js";

/** ItemSubclass de armadura (clase 4) -> habilidad del cliente (SkillLine): tela 415, cuero 414, malla 413, placas 293, escudo 433. */
const ARMOR_SKILL: Record<number, number> = { 1: 415, 2: 414, 3: 413, 4: 293, 6: 433 };
/** ItemSubclass de arma (clase 2) -> habilidad del cliente. */
const WEAPON_SKILL: Record<number, number> = {
  0: 44, 1: 172, 2: 45, 3: 46, 4: 54, 5: 160, 6: 229, 7: 43, 8: 55, 10: 136, 13: 473, 15: 173, 16: 176, 18: 226, 19: 228,
};
const DUAL_WIELD_SKILL = 118;

/** Mascaras de clase (1 << (classId - 1)) de las clases con reliquia; Classic: libro = Paladin, idolo = Druida, totem = Chaman. */
const RELIC_CLASS_MASK: Record<number, number> = { 7: 1 << 1, 8: 1 << 10, 9: 1 << 6 };

/**
 * Competencias de armadura y de armas por clase y nivel, tal cual las trae `SkillRaceClassInfo` (Flags/Availability no se interpretan:
 * solo clase y nivel minimo). Todas las filas tienen RaceMasks = -1, asi que no hay restriccion por raza (se comprueba y se avisa si cambia).
 */
export function buildEquipRules(raw: RawTables, build: string): EquipRules {
  const warnings: string[] = [];
  const bySkill = new Map<number, Proficiency[]>();
  for (const r of raw.table("SkillRaceClassInfo")) {
    const skill = int(r.SkillID);
    if (int(r["RaceMasks[0]"]) !== -1 || int(r["RaceMasks[1]"]) !== -1) warnings.push(`SkillRaceClassInfo ${r.ID}: la habilidad ${skill} tiene restriccion de raza (no se aplica)`);
    const list = bySkill.get(skill) ?? [];
    list.push({ classMask: int(r.ClassMask), minLevel: int(r.MinLevel) });
    bySkill.set(skill, list);
  }
  const pick = (skill: number, what: string): Proficiency[] => {
    const seen = new Set<string>();
    const list = (bySkill.get(skill) ?? [])
      .filter((p) => !seen.has(`${p.classMask}/${p.minLevel}`) && !!seen.add(`${p.classMask}/${p.minLevel}`))
      .sort((a, b) => a.classMask - b.classMask || a.minLevel - b.minLevel);
    if (list.length === 0) warnings.push(`${what}: la habilidad ${skill} no tiene filas en SkillRaceClassInfo`);
    return list;
  };
  const armor: EquipRules["armor"] = {};
  for (const [sub, skill] of Object.entries(ARMOR_SKILL)) armor[sub] = pick(skill, `armadura ${sub}`);
  const weapons: EquipRules["weapons"] = {};
  for (const [sub, skill] of Object.entries(WEAPON_SKILL)) weapons[sub] = pick(skill, `arma ${sub}`);
  const byClassMask: Record<string, number> = {};
  for (const [sub, mask] of Object.entries(RELIC_CLASS_MASK)) byClassMask[sub] = mask;
  return {
    schemaVersion: 1,
    build,
    provenance: "client-db2",
    armor,
    weapons,
    dualWield: pick(DUAL_WIELD_SKILL, "doble empuñadura"),
    relics: { provenance: "assumption", byClassMask },
    warnings,
  };
}
