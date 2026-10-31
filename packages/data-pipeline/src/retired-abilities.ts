import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ability, Abilities } from "@wfuc/schema";

interface RetiredEntry {
  name: string;
  fromBuild: string;
  since: string;
  note: string;
}

/**
 * Conserva, marcadas como retiradas (`retired`), las habilidades que el cliente ya no trae o ya no enseña (data/rules/retired-abilities.json).
 * La ficha se copia del dataset de la última versión que la tenía. Devuelve los avisos (habilidad que el cliente vuelve a traer, dataset que falta).
 */
export function keepRetiredAbilities(data: Abilities, token: string, repoRoot: string): string[] {
  const file = join(repoRoot, "data", "rules", "retired-abilities.json");
  if (!existsSync(file)) return [];
  const entries = ((JSON.parse(readFileSync(file, "utf8")) as { classes?: Record<string, RetiredEntry[]> }).classes ?? {})[token] ?? [];
  const warnings: string[] = [];
  for (const e of entries) {
    if (data.abilities.some((a) => a.name === e.name)) {
      warnings.push(`«${e.name}» vuelve a estar en el cliente: quítala de data/rules/retired-abilities.json`);
      continue;
    }
    const source = join(repoRoot, "data", "forever", e.fromBuild, "abilities", `${token}.json`);
    if (!existsSync(source)) {
      warnings.push(`«${e.name}»: falta ${e.fromBuild}/abilities/${token}.json para conservarla`);
      continue;
    }
    const old = (JSON.parse(readFileSync(source, "utf8")) as { abilities: unknown[] }).abilities.find((a) => (a as { name?: string }).name === e.name);
    if (!old) {
      warnings.push(`«${e.name}» no está en ${e.fromBuild}/abilities/${token}.json`);
      continue;
    }
    const ability = Ability.parse(old);
    data.abilities.push({ ...ability, ranks: ability.ranks.map((r) => ({ ...r, retired: { since: e.since, fromBuild: e.fromBuild, note: e.note } })) });
  }
  return warnings;
}

/**
 * Inglés de las habilidades conservadas: el cliente ya no trae sus hechizos (ni en inglés), así que su nombre y texto se toman del
 * `i18n/en.json` del dataset del que se copió la ficha, si la referencia externa no los trae.
 */
export function seedRetiredEnglish(english: { spells: Record<string, any> }, abilities: Abilities[], repoRoot: string): void {
  const cache = new Map<string, Record<string, unknown>>();
  for (const file of abilities) {
    for (const a of file.abilities) {
      for (const r of a.ranks) {
        if (!r.retired || english.spells[r.spellId]?.description) continue;
        let spells = cache.get(r.retired.fromBuild);
        if (!spells) {
          const f = join(repoRoot, "data", "forever", r.retired.fromBuild, "i18n", "en.json");
          spells = existsSync(f) ? ((JSON.parse(readFileSync(f, "utf8")) as { spells: Record<string, unknown> }).spells ?? {}) : {};
          cache.set(r.retired.fromBuild, spells);
        }
        if (spells[r.spellId]) english.spells[r.spellId] = spells[r.spellId];
      }
    }
  }
}
