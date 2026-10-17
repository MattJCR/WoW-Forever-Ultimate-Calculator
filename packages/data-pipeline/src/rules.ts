import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abilities, ClassTalents, TalentRules } from "./model.js";
import { RuleEffect } from "./model.js";

/** Bits de escuela validos (SpellMisc.SchoolMask). */
const SCHOOL_BITS = new Set([1, 2, 4, 8, 16, 32, 64]);

interface RulesFile {
  provenance: TalentRules["provenance"];
  classes: Record<string, { spellId: number; effects: unknown[] }[]>;
}

/**
 * Reglas de talentos clasificadas a mano (data/rules/talent-effects.json). Se validan contra los datos del cliente:
 * el hechizo debe ser un talento de la clase, el indice de efecto debe existir en cada rango, las habilidades del alcance
 * deben existir y los marcadores de la plantilla deben tener cifra. Lo que no cuadra se avisa (y la regla se descarta).
 */
export function buildRules(cls: ClassTalents, abilities: Abilities | null, build: string): TalentRules | null {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/rules/talent-effects.json");
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8")) as RulesFile;
  const list = raw.classes[String(cls.classId)];
  if (!list) return null;

  const warnings: string[] = [];
  const talents = new Map(cls.specs.flatMap((s) => s.talents).map((t) => [t.spellId, t]));
  const abilityNames = new Set(abilities?.abilities.map((a) => a.name) ?? []);
  const rules: TalentRules["rules"] = [];

  for (const r of list) {
    const talent = talents.get(r.spellId);
    if (!talent) {
      warnings.push(`Regla del hechizo ${r.spellId}: no es un talento de ${cls.className}`);
      continue;
    }
    const effects: TalentRules["rules"][number]["effects"] = [];
    for (const [i, e] of r.effects.entries()) {
      const eff = RuleEffect.parse(e);
      const where = `${talent.name} (regla ${i + 1})`;
      const indexes = [eff.index, ...Object.values(eff.extras).map((x) => x.index)];
      if (indexes.some((ix) => talent.rankValues.some((v) => v[ix] === null || v[ix] === undefined))) {
        warnings.push(`${where}: el indice de efecto no existe en todos los rangos`);
        continue;
      }
      const keys = [...eff.label.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      const missing = keys.filter((k) => k !== "v" && !(k in eff.extras));
      if (missing.length > 0) {
        warnings.push(`${where}: la plantilla usa {${missing.join("}, {")}} sin definir en extras`);
        continue;
      }
      const badSchool = (eff.scope.schools ?? []).filter((b) => !SCHOOL_BITS.has(b));
      if (badSchool.length > 0) {
        warnings.push(`${where}: escuelas no validas ${badSchool.join(", ")}`);
        continue;
      }
      const unknown = (eff.scope.spells ?? []).filter((n) => abilities && !abilityNames.has(n));
      if (unknown.length > 0) {
        warnings.push(`${where}: habilidades que no existen: ${unknown.join(", ")}`);
        continue;
      }
      if (!eff.scope.all && !eff.scope.schools && !eff.scope.spells) {
        warnings.push(`${where}: sin alcance`);
        continue;
      }
      effects.push(eff);
    }
    if (effects.length > 0) rules.push({ spellId: r.spellId, name: talent.name, effects });
  }

  return { schemaVersion: 1, build, classId: cls.classId, provenance: raw.provenance, rules, warnings };
}
