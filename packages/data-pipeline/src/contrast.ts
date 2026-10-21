import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Abilities, AbilityContrast, ClassTalents, Races } from "./model.js";

/** Forma minima del export de la referencia que usamos (CC BY 4.0). */
interface TfTalent {
  name: string;
  max: number;
  row: number;
  col: number;
}
interface TfExport {
  talents: { trees: { name: string; talents: TfTalent[] }[] };
}

export interface ContrastReport {
  className: string | null;
  file: string;
  specs: { index: number; ours: number; theirs: number; theirsName: string; maxRankMismatches: string[]; positionOnlyOurs: string[]; positionOnlyTheirs: string[] }[];
  totals: { ours: number; theirs: number };
  ok: boolean;
}

/**
 * Compara nuestro arbol (cliente) con el de la referencia. Sus nombres estan en ingles y los
 * nuestros en el idioma del cliente, asi que se compara por posicion y rango maximo, no por nombre.
 * Sus filas/columnas empiezan en 1. El cliente manda: las diferencias se informan, no se corrigen.
 */
export function contrastClass(cls: ClassTalents, tfDir: string): ContrastReport | null {
  const file = join(tfDir, `${(cls.classToken ?? "").toLowerCase()}.json`);
  if (!existsSync(file)) return null;
  const tf = JSON.parse(readFileSync(file, "utf8")) as TfExport;

  const specs = cls.specs.map((spec) => {
    const theirs = tf.talents.trees[spec.index];
    const theirsMap = new Map((theirs?.talents ?? []).map((t) => [`${t.row - 1},${t.col - 1}`, t]));
    const oursMap = new Map(spec.talents.map((t) => [`${t.row},${t.col}`, t]));
    const maxRankMismatches: string[] = [];
    for (const [pos, t] of oursMap) {
      const o = theirsMap.get(pos);
      if (o && o.max !== t.maxRank) maxRankMismatches.push(`${pos}: cliente ${t.maxRank} vs web ${o.max} (${o.name})`);
    }
    return {
      index: spec.index,
      ours: spec.talents.length,
      theirs: theirs?.talents.length ?? 0,
      theirsName: theirs?.name ?? "?",
      maxRankMismatches,
      positionOnlyOurs: [...oursMap.keys()].filter((p) => !theirsMap.has(p)),
      positionOnlyTheirs: [...theirsMap.keys()].filter((p) => !oursMap.has(p)),
    };
  });

  const totals = {
    ours: specs.reduce((s, x) => s + x.ours, 0),
    theirs: tf.talents.trees.reduce((s, t) => s + t.talents.length, 0),
  };
  const ok = specs.every((s) => s.maxRankMismatches.length === 0 && s.positionOnlyOurs.length === 0 && s.positionOnlyTheirs.length === 0);
  return { className: cls.className, file, specs, totals, ok };
}

/** Nombre de raza de la referencia -> ChrRaces.ID del cliente. */
const TF_RACE_IDS: Record<string, number> = {
  Human: 1, Orc: 2, Dwarf: 3, "Night Elf": 4, Undead: 5, Tauren: 6, Gnome: 7, Troll: 8,
  "Skyborne (High Order)": 95, "Skyborne (Windshaper)": 96,
};

export interface RaceContrast {
  ok: boolean;
  /** Por clase: razas que el cliente permite y la web no, y al reves (por ChrRaces.ID). */
  classes: { className: string; onlyClient: number[]; onlyWeb: number[] }[];
  /** Razas cuyo numero de habilidades raciales difiere de las de la web. */
  racialCountMismatches: string[];
}

/** Compara la matriz raza/clase (CharBaseInfo) y el numero de raciales con la referencia. El cliente manda. */
export function contrastRaces(races: Races, classes: { classId: number; className: string; token: string }[], tfDir: string): RaceContrast | null {
  const out: RaceContrast = { ok: true, classes: [], racialCountMismatches: [] };
  let found = false;
  const webRacials = new Map<number, number>();
  for (const cls of classes) {
    const file = join(tfDir, `${cls.token.toLowerCase()}.json`);
    if (!existsSync(file)) continue;
    found = true;
    const tf = JSON.parse(readFileSync(file, "utf8")) as { races: Record<string, string[]>; racials: Record<string, { race: string; abilities: unknown[] }[]> };
    const web = new Set(Object.values(tf.races).flat().map((n) => TF_RACE_IDS[n]).filter((id): id is number => id !== undefined));
    for (const list of Object.values(tf.racials)) for (const r of list) if (TF_RACE_IDS[r.race] !== undefined) webRacials.set(TF_RACE_IDS[r.race]!, r.abilities.length);
    const mine = new Set(races.races.filter((r) => r.classIds.includes(cls.classId)).map((r) => r.id));
    const onlyClient = [...mine].filter((id) => !web.has(id)).sort((a, b) => a - b);
    const onlyWeb = [...web].filter((id) => !mine.has(id)).sort((a, b) => a - b);
    if (onlyClient.length || onlyWeb.length) out.ok = false;
    out.classes.push({ className: cls.className, onlyClient, onlyWeb });
  }
  if (!found) return null;
  for (const r of races.races) {
    const theirs = webRacials.get(r.id);
    if (theirs !== undefined && theirs !== r.racials.length) {
      out.ok = false;
      out.racialCountMismatches.push(`${r.name}: ${r.racials.length} en el cliente vs ${theirs} en la web`);
    }
  }
  return out;
}

/** Forma minima del libro de hechizos de la referencia: spell_desc (id de hechizo del cliente) y spellbook.gone. */
interface TfSpellbook {
  spell_desc: Record<string, { id?: number; l?: string[][]; nt?: number }>;
  spellbook: { gone?: string[]; tabs?: { name: string; spells: [string, string][] }[] };
}

const WEAPON_RANGED = /^(Attack|Shoot|Throw|Shoot Bow|Shoot Crossbow|Shoot Gun|Languages)$/;

export interface AbilityContrastReport {
  /** Habilidades por estado. */
  listed: number;
  partial: string[];
  notListed: string[];
  retired: string[];
  /** Hechizos que la referencia lista (con id) y que no estan en nuestro libro de hechizos (los pasivos generales no cuentan). */
  tfOnly: string[];
  /** Entradas de `gone` de la referencia: con el nombre de nuestra habilidad, o null si no hay equivalente en nuestros datos. */
  gone: { tfName: string; ours: string | null; found: boolean }[];
}

/**
 * Contrasta el libro de hechizos del cliente con el de la referencia por id de hechizo (los nombres estan en idiomas
 * distintos). Marca cada habilidad en `talentsForever` y devuelve el informe. Lo que la referencia no lista NO se descarta: se
 * conserva con su marca para que la web lo avise y se pueda confirmar en el juego. `goneMap` = data/rules/tf-gone.json.
 */
export function contrastAbilities(
  abilities: Abilities,
  token: string,
  tfDir: string,
  goneMap: Record<string, string | null>,
  /** Retiradas que ademas confirma una fuente oficial: nombre en ingles -> fuente (tf-gone.json › official). */
  official: Record<string, string> = {},
): { abilities: Abilities; report: AbilityContrastReport } | null {
  const file = join(tfDir, `${token.toLowerCase()}.json`);
  if (!existsSync(file)) return null;
  const tf = JSON.parse(readFileSync(file, "utf8")) as TfSpellbook;
  const tfIds = new Map<number, string>();
  for (const [key, v] of Object.entries(tf.spell_desc)) if (v.id) tfIds.set(v.id, key);
  const retired = new Map(Object.values(goneMap).filter((n): n is string => !!n).map((n) => [n, true]));
  const goneByOurs = new Map(Object.entries(goneMap).filter(([, n]) => !!n).map(([en, n]) => [n as string, en]));

  const report: AbilityContrastReport = { listed: 0, partial: [], notListed: [], retired: [], tfOnly: [], gone: [] };
  const ours = new Set<number>();
  const out = abilities.abilities.map((a) => {
    for (const r of a.ranks) ours.add(r.spellId);
    const n = a.ranks.filter((r) => tfIds.has(r.spellId)).length;
    let contrast: AbilityContrast;
    if (retired.has(a.name)) {
      contrast = { status: "retired", listedRanks: n, note: `La referencia la da por retirada de Forever (${goneByOurs.get(a.name)})${official[goneByOurs.get(a.name) ?? ""] ? `; lo confirma Blizzard: ${official[goneByOurs.get(a.name) ?? ""]}` : ""}` };
      report.retired.push(a.name);
    } else if (n === a.ranks.length) {
      contrast = { status: "listed", listedRanks: n, note: null };
      report.listed++;
    } else if (n > 0) {
      contrast = { status: "partial", listedRanks: n, note: `La referencia solo lista ${n} de sus ${a.ranks.length} rangos` };
      report.partial.push(`${a.name} ${n}/${a.ranks.length}`);
    } else {
      const rune = a.ranks.every((r) => r.acquireMethod === 3);
      contrast = {
        status: "not-listed",
        listedRanks: 0,
        note: rune
          ? "Habilidad de runa de Forever (AcquireMethod 3): La referencia no la lista, solo hay cifras del cliente"
          : "Aprendible en el cliente, pero la referencia no la lista: solo hay cifras del cliente (confirmar en el juego)",
      };
      report.notListed.push(a.name);
    }
    return { ...a, talentsForever: contrast };
  });
  // Pestanas de mascota/demonio de la referencia (Cazador «Pets», Brujo «Demons»): habilidades de la mascota, fuera del libro del jugador
  const petSpells = new Set<string>();
  for (const tab of tf.spellbook.tabs ?? []) if (/^(Pets|Demons)$/.test(tab.name)) for (const [n, r] of tab.spells) petSpells.add(`${n}|${r ?? ""}`);
  for (const [id, key] of tfIds) {
    if (ours.has(id)) continue;
    const [, name = "", rank = ""] = key.split("|");
    if (petSpells.has(`${name}|${rank}`)) continue;
    const text = JSON.stringify(tf.spell_desc[key]);
    // No son habilidades de clase de nuestro libro: pasivas, ataques a distancia con arma (Lanzar, Disparar) y rastreos (Sentido de no-muertos)
    if (rank === "Passive" || /"Passive"/.test(text) || WEAPON_RANGED.test(name) || /racking/.test(text)) continue;
    report.tfOnly.push(`${name} ${rank}`.trim());
  }
  for (const [tfName, name] of Object.entries(goneMap)) report.gone.push({ tfName, ours: name, found: name ? abilities.abilities.some((a) => a.name === name) : false });
  return { abilities: { ...abilities, abilities: out }, report };
}

interface TfLegacy {
  legacy: { source?: string; points?: number; trees: { name: string; perks: { name: string; max: number; row: number; col: number; ranks: string[] }[] }[] };
}

export interface LegacyContrast {
  /** Build del cliente del que dice venir el export de la referencia (puede ser mas antiguo que el nuestro). */
  tfSource: string | null;
  perks: number;
  matchedPositions: number;
  /** Diferencias de posicion, rango maximo o cifras por rango (el cliente manda). */
  diffs: string[];
}

const numbersOf = (s: string | undefined): string => [...(s ?? "").replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]!).sort().join(",");

/** Compara las ventajas de Legacy (por posicion, rango maximo y cifras de cada rango) con las del export de la referencia (iguales en todas sus clases). */
export function contrastLegacy(legacy: ClassTalents, tfDir: string): LegacyContrast | null {
  const file = join(tfDir, "paladin.json");
  if (!existsSync(file)) return null;
  const tf = (JSON.parse(readFileSync(file, "utf8")) as TfLegacy).legacy;
  const out: LegacyContrast = { tfSource: tf.source ?? null, perks: 0, matchedPositions: 0, diffs: [] };
  tf.trees.forEach((tree, si) => {
    const spec = legacy.specs[si];
    if (!spec) return;
    for (const p of tree.perks) {
      out.perks++;
      const o = spec.talents.find((x) => x.row === p.row - 1 && x.col === p.col - 1);
      if (!o) {
        out.diffs.push(`${tree.name}: «${p.name}» de la referencia (fila ${p.row}, col ${p.col}) no está en esa posición del cliente`);
        continue;
      }
      out.matchedPositions++;
      if (o.maxRank !== p.max) out.diffs.push(`${tree.name}: «${p.name}» rango máximo la referencia ${p.max} vs cliente ${o.maxRank}`);
      for (let r = 0; r < Math.min(p.max, o.maxRank); r++) {
        if (numbersOf(p.ranks[r]) !== numbersOf(o.descriptions[r])) out.diffs.push(`${tree.name}: «${p.name}» rango ${r + 1}: La referencia «${p.ranks[r]}» vs cliente «${o.descriptions[r]}»`);
      }
    }
    for (const o of spec.talents) if (!tree.perks.some((p) => p.row - 1 === o.row && p.col - 1 === o.col)) out.diffs.push(`${spec.name}: «${o.name}» del cliente (fila ${o.row + 1}, col ${o.col + 1}) no está en la referencia`);
  });
  return out;
}

export interface OrphanContrast {
  total: number;
  /** Entradas cuyas cifras (rango 1) coinciden con un talento o ventaja de Legacy que la referencia lista (la referencia no trae ids de hechizo: se compara por las cifras del texto). */
  withTfTwin: number;
  /** Entradas sin gemela en la referencia: con cifras (p. ej. Estudio dedicado con 3 esencias) o sin cifras (textos vacios, «NYI»). */
  withoutTfTwin: { name: string; numbers: string }[];
}

/** Contrasta las entradas de talento sin nodo del cliente (unassigned.json) con los talentos y ventajas de Legacy de la referencia. */
export function contrastOrphans(orphans: { name: string | null; descriptions: string[] }[], tfDir: string): OrphanContrast | null {
  if (!existsSync(tfDir)) return null;
  const twin = new Set<string>();
  for (const f of readdirSync(tfDir).filter((x) => x.endsWith(".json"))) {
    const tf = JSON.parse(readFileSync(join(tfDir, f), "utf8")) as TfExport & { legacy: TfLegacy["legacy"] };
    for (const t of tf.talents.trees) for (const x of t.talents as unknown as { desc: string[] }[]) twin.add(numbersOf(x.desc[0]));
    for (const t of tf.legacy.trees) for (const x of t.perks) twin.add(numbersOf(x.ranks[0]));
  }
  twin.delete("");
  const out: OrphanContrast = { total: orphans.length, withTfTwin: 0, withoutTfTwin: [] };
  for (const o of orphans) {
    const k = numbersOf(o.descriptions[0]);
    if (k && twin.has(k)) out.withTfTwin++;
    else out.withoutTfTwin.push({ name: o.name ?? "(sin nombre)", numbers: k });
  }
  return out;
}
