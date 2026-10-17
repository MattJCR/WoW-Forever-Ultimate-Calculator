import type { ClientStats } from "./model.js";
import type { RawTables } from "./csv.js";

const num = (v: string | undefined): number => Number(v ?? 0) || 0;

/** Nivel maximo de la calculadora (la beta llega al 30, el juego al 60). */
const MAX_LEVEL = 60;

/**
 * Estadisticas por clase y nivel del cliente: `PlayerExpectedStat` (CritPerAgility, SpellCritPerIntellect, BaseMana, HPPerStamina; solo
 * ContentSetID 0) y `ChrClasses` (AttackPowerPerStrength, AttackPowerPerAgility, RangedAttackPowerPerAgility). Verificado: a nivel 30
 * reproduce las cifras de ForeverDB (agilidad por 1 % de critico: Guerrero 10,4, Paladin 10,7, Cazador 24, Picaro 13...), y a nivel 60
 * las de Classic que teniamos como estimacion (Mago 59,5 de intelecto, Picaro 29 de agilidad).
 */
export function buildClientStats(raw: RawTables, build: string): ClientStats {
  const byClass = new Map<number, ClientStats["classes"][number]["levels"]>();
  for (const r of raw.table("PlayerExpectedStat")) {
    if (num(r.ContentSetID) !== 0) continue;
    const level = num(r.Level);
    if (level < 1 || level > MAX_LEVEL) continue;
    const id = num(r.ClassID);
    const list = byClass.get(id) ?? [];
    list.push({ level, baseMana: num(r.BaseMana), hpPerStamina: num(r.HPPerStamina), critPerAgility: num(r.CritPerAgility), spellCritPerIntellect: num(r.SpellCritPerIntellect) });
    byClass.set(id, list);
  }
  const classes = raw
    .table("ChrClasses")
    .filter((c) => byClass.has(num(c.ID)))
    .map((c) => ({
      classId: num(c.ID),
      attackPowerPerStrength: num(c.AttackPowerPerStrength),
      attackPowerPerAgility: num(c.AttackPowerPerAgility),
      rangedAttackPowerPerAgility: num(c.RangedAttackPowerPerAgility),
      levels: byClass.get(num(c.ID))!.sort((a, b) => a.level - b.level),
    }))
    .sort((a, b) => a.classId - b.classId);
  return { schemaVersion: 1, build, provenance: "client-db2", maxLevel: MAX_LEVEL, classes };
}
