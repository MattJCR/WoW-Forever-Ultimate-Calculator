import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abilities, ClassTalents, EnglishText, Items, Races } from "./model.js";
import { TF_RACE_IDS } from "./contrast.js";
import type { WowsimsDb } from "./wowsims.js";

/** Nombre en ingles de cada clase (ChrClasses.Filename -> nombre). El cliente instalado solo trae esES. */
const CLASS_NAMES_EN: Record<string, string> = {
  WARRIOR: "Warrior", PALADIN: "Paladin", HUNTER: "Hunter", ROGUE: "Rogue", PRIEST: "Priest",
  SHAMAN: "Shaman", MAGE: "Mage", WARLOCK: "Warlock", DRUID: "Druid",
};

/** Forma minima del export de la referencia que usamos (CC BY 4.0). */
interface TfFile {
  talents: { trees: { name: string; talents: { name: string; max: number; row: number; col: number; desc: string[] }[] }[] };
  spell_desc: Record<string, { id?: number; d?: string; l?: [string, string][] }>;
  racials: Record<string, { race: string; abilities: [string, string, string?][] }[]>;
  legacy: { trees: { name: string; perks: { name: string; row: number; col: number; ranks: string[] }[] }[] };
}

export interface EnglishReport {
  talents: { ours: number; matched: number };
  legacy: { ours: number; matched: number };
  abilities: { ours: number; named: number; described: number };
  items: { ours: number; matched: number };
  races: { ours: number; matched: number };
  /** Raciales cuyo texto en inglés no tiene las mismas cifras que el del cliente (se emparejan por nombre, ver data/i18n/racials-en.json). */
  racialWarnings: string[];
}

/**
 * Textos en ingles para la opcion «English» de la web. Fuentes (ambas de la comunidad, nunca del cliente):
 * los talentos, Legacy, raciales y hechizos de la referencia externa (por posicion o por id de hechizo) y los nombres
 * de hechizo y objeto de la base de la comunidad (por id). Lo que no tiene ingles se omite: la web lo muestra en español.
 */
export function buildEnglish(
  build: string,
  classes: ClassTalents[],
  legacy: ClassTalents,
  races: Races,
  abilities: Abilities[],
  items: Items | undefined,
  tfDir: string,
  ws: WowsimsDb | null,
): { english: EnglishText; report: EnglishReport } {
  const tf = new Map<string, TfFile>();
  for (const c of classes) {
    const file = join(tfDir, `${(c.classToken ?? "").toLowerCase()}.json`);
    if (existsSync(file)) tf.set(c.classToken ?? "", JSON.parse(readFileSync(file, "utf8")) as TfFile);
  }
  const spellNames = new Map<number, string>();
  for (const s of (ws as unknown as { spellIcons?: { id: number; name: string }[] } | null)?.spellIcons ?? []) if (!spellNames.has(s.id)) spellNames.set(s.id, s.name);
  const tfSpells = new Map<number, { name: string; description: string | null; lines: string[] }>();
  for (const f of tf.values()) {
    for (const [key, v] of Object.entries(f.spell_desc)) {
      if (!v.id || tfSpells.has(v.id)) continue;
      const [, name = "", rank = ""] = key.split("|");
      // «Rank 3» no es parte del nombre; los pasivos y los rangos vacios (solo el nombre) no traen texto
      tfSpells.set(v.id, { name, description: v.d?.trim() ? v.d : null, lines: (v.l ?? []).map(([a, b]) => (b ? `${a}: ${b}` : a)).filter(Boolean) });
      void rank;
    }
  }

  const out: EnglishText = {
    schemaVersion: 1,
    build,
    provenance: "community",
    source: "Textos en inglés de datos de la comunidad (no del cliente, que solo trae español)",
    classes: {},
    legacyTrees: [],
    talents: {},
    spells: {},
    items: {},
    races: {},
  };
  const report: EnglishReport = {
    talents: { ours: 0, matched: 0 },
    legacy: { ours: 0, matched: 0 },
    abilities: { ours: 0, named: 0, described: 0 },
    items: { ours: 0, matched: 0 },
    races: { ours: 0, matched: 0 },
    racialWarnings: [],
  };

  // --- Clases, arboles y talentos (por posicion: las filas/columnas de la referencia empiezan en 1)
  for (const c of classes) {
    const token = c.classToken ?? "";
    const f = tf.get(token);
    out.classes[token] = { name: CLASS_NAMES_EN[token.toUpperCase()] ?? c.className ?? token, specs: c.specs.map((s, i) => f?.talents.trees[i]?.name ?? s.name ?? "") };
    c.specs.forEach((spec, si) => {
      const byPos = new Map((f?.talents.trees[si]?.talents ?? []).map((t) => [`${t.row - 1},${t.col - 1}`, t]));
      for (const t of spec.talents) {
        report.talents.ours++;
        const x = byPos.get(`${t.row},${t.col}`);
        if (!x) continue;
        report.talents.matched++;
        out.talents[t.nodeId] = { name: x.name, descriptions: x.desc };
      }
    });
    // Nodos no activos: no tienen posicion de rejilla; nombre por id de hechizo y texto por id si la referencia lo trae
    for (const t of c.inactiveTalents) {
      const sp = tfSpells.get(t.spellId);
      const name = sp?.name ?? spellNames.get(t.spellId);
      if (name) out.talents[t.nodeId] = { name, descriptions: sp?.description ? [sp.description] : [] };
    }
  }

  // --- Legacy (la referencia lo repite en cada clase; es de cuenta)
  const lf = [...tf.values()].find((f) => f.legacy?.trees?.length)?.legacy;
  out.legacyTrees = lf?.trees.map((t) => t.name) ?? [];
  legacy.specs.forEach((spec, si) => {
    const byPos = new Map((lf?.trees[si]?.perks ?? []).map((p) => [`${p.row - 1},${p.col - 1}`, p]));
    for (const t of spec.talents) {
      report.legacy.ours++;
      const p = byPos.get(`${t.row},${t.col}`);
      if (!p) continue;
      report.legacy.matched++;
      out.talents[t.nodeId] = { name: p.name, descriptions: p.ranks };
    }
  });

  // --- Habilidades: por id de hechizo de cada rango (la referencia trae el texto de nivel 60; la comunidad, solo el nombre)
  for (const ab of abilities) {
    for (const a of ab.abilities) {
      report.abilities.ours++;
      let named = false;
      let described = false;
      for (const r of a.ranks) {
        const sp = tfSpells.get(r.spellId);
        const name = sp?.name ?? spellNames.get(r.spellId);
        if (!name) continue;
        named = true;
        if (sp?.description) described = true;
        out.spells[r.spellId] = { name, description: sp?.description ?? null, lines: sp?.lines ?? [] };
      }
      if (named) report.abilities.named++;
      if (described) report.abilities.described++;
    }
  }

  // --- Razas y raciales (por posicion: 4 por raza, en el orden del cliente)
  const racialsByRace = new Map<number, { name: string; description: string }[]>();
  const raceNames = new Map<number, string>();
  for (const f of tf.values()) {
    for (const faction of Object.values(f.racials ?? {})) {
      for (const r of faction) {
        const id = TF_RACE_IDS[r.race];
        if (!id || racialsByRace.has(id)) continue;
        raceNames.set(id, r.race);
        racialsByRace.set(id, r.abilities.map(([name, description]) => ({ name, description })));
      }
    }
  }
  // El orden de las raciales de la comunidad no coincide con el del cliente: se emparejan por el nombre en inglés (data/i18n/racials-en.json)
  const namesFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/i18n/racials-en.json");
  const racialNames: Record<string, string> = existsSync(namesFile) ? (JSON.parse(readFileSync(namesFile, "utf8")) as { names: Record<string, string> }).names : {};
  const numbers = (s: string): string => [...new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? [])].sort().join(",");
  for (const r of races.races) {
    report.races.ours++;
    const en = racialsByRace.get(r.id);
    if (!en) continue;
    const racials: { name: string; description: string }[] = [];
    for (const a of r.racials) {
      const enName = racialNames[a.name];
      const hit = enName ? en.find((x) => x.name === enName) : undefined;
      if (!hit) {
        report.racialWarnings.push(`${r.name}: «${a.name}» sin pareja en inglés${enName ? ` (${enName})` : ""}`);
        continue;
      }
      // Las cifras del texto en inglés deben ser las del cliente (si hay cifras en los dos)
      if (numbers(a.description) && numbers(hit.description) && !numbers(hit.description).includes(numbers(a.description).split(",")[0]!)) report.racialWarnings.push(`${r.name}: «${a.name}» ↔ ${hit.name}: cifras ${numbers(a.description)} frente a ${numbers(hit.description)}`);
      racials[a.order] = hit;
    }
    report.races.matched++;
    out.races[r.id] = { name: raceNames.get(r.id) ?? r.token, racials: Array.from(racials, (x) => x ?? { name: "", description: "" }) };
  }

  // --- Objetos (nombre por id)
  if (items && ws) {
    const names = new Map(ws.items.map((i) => [i.id, i.name]));
    for (const i of items.items) {
      report.items.ours++;
      const n = names.get(i.id);
      if (!n) continue;
      report.items.matched++;
      out.items[i.id] = n;
    }
  }
  return { english: out, report };
}
