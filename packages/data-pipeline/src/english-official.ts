import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { int, openRawTables, type RawTables } from "./csv.js";
import type { SpellTables } from "./spell-tables.js";
import { renderSpellText, withRenderLocale, type Rendered } from "./spell-text.js";
import { TraitIndex } from "./trait-index.js";

/**
 * Textos oficiales del juego en inglés (data/external/enus, ver tools/extract/fetch-enus-tables.mjs): las mismas tablas del juego
 * que el cliente trae en español, pero en inglés. Las plantillas inglesas se renderizan con los datos de hechizos del cliente
 * (efectos, duraciones, curvas de rango), así que las cifras son las del cliente y no las de otra versión.
 */
export interface OfficialEnglish {
  /** Build de las tablas inglesas (puede ser posterior al del cliente; los textos cambian poco, las cifras salen del cliente). */
  tablesBuild: string;
  /** Hechizos del cliente con los textos en inglés. */
  spells: SpellTables;
  /** TraitIndex con las definiciones y los hechizos en inglés (textos de talentos, nodos sin asignar y nodos inactivos). */
  trait: TraitIndex;
  itemNames: Map<number, string>;
  /** Calidad con que se consultaron los nombres de `ItemNamesExtra.csv` (objetos que las tablas no traen): sirve para comprobar que es el mismo objeto. */
  itemQuality: Map<number, number>;
  itemSets: Map<number, string>;
  /** Hechizos con texto en inglés. */
  hasSpell(spellId: number): boolean;
}

const read = (raw: RawTables, table: string) => raw.table(table);

/** Carga las tablas inglesas; null si no están descargadas. */
export function loadOfficialEnglish(dir: string, clientRaw: RawTables, clientSpells: SpellTables): OfficialEnglish | null {
  if (!existsSync(join(dir, "Spell.csv"))) return null;
  const raw = openRawTables(dir);
  const descriptions = new Map<string, string>();
  const auraDescriptions = new Map<string, string>();
  for (const r of read(raw, "Spell")) {
    descriptions.set(r.ID!, r.Description_lang ?? "");
    auraDescriptions.set(r.ID!, r.AuraDescription_lang ?? "");
  }
  const names = new Map(read(raw, "SpellName").map((r) => [r.ID!, r.Name_lang ?? ""] as const));
  const spells = clientSpells.withTexts({ descriptions, auraDescriptions, names });

  const trait = new TraitIndex(clientRaw, spells);
  const english = new Map(read(raw, "TraitDefinition").map((r) => [r.ID!, r] as const));
  for (const [id, def] of trait.defById) {
    // Sin definicion inglesa, el override español no sirve: se usa el texto del hechizo en inglés
    trait.defById.set(id, { ...def, OverrideDescription_lang: english.get(id)?.OverrideDescription_lang ?? "", OverrideName_lang: english.get(id)?.OverrideName_lang ?? "" });
  }

  const tablesBuild = existsSync(join(dir, "BUILD.txt")) ? readFileSync(join(dir, "BUILD.txt"), "utf8").trim() : "";
  const itemNames = new Map(read(raw, "ItemSparse").filter((r) => r.Display_lang).map((r) => [int(r.ID), r.Display_lang!] as const));
  // Nombres consultados aparte (tools/extract/fetch-enus-items.mjs) para los objetos que las tablas no traen
  const itemQuality = new Map<number, number>();
  if (existsSync(join(dir, "ItemNamesExtra.csv"))) {
    for (const r of read(raw, "ItemNamesExtra")) {
      if (!r.Display_lang || itemNames.has(int(r.ID))) continue;
      itemNames.set(int(r.ID), r.Display_lang);
      itemQuality.set(int(r.ID), int(r.Quality));
    }
  }
  const itemSets = new Map(read(raw, "ItemSet").filter((r) => r.Name_lang).map((r) => [int(r.ID), r.Name_lang!] as const));
  return {
    tablesBuild,
    spells,
    trait,
    itemNames,
    itemQuality,
    itemSets,
    hasSpell: (spellId) => !!(descriptions.get(String(spellId)) || auraDescriptions.get(String(spellId)) || names.get(String(spellId))),
  };
}

/** Texto inglés de un hechizo a nivel 60 sin talentos (`text`) y como plantilla con huecos `{{tipo:hechizo:efecto|valor}}` (`template`). */
export function renderSpellEnglish(oe: OfficialEnglish, spellId: number): { text: Rendered; template: Rendered } | null {
  const source = oe.spells.clientDescription(spellId);
  if (!source) return null;
  return withRenderLocale("en", () => ({
    text: renderSpellText(oe.spells, source, { spellId, rank: 1, curves: new Map() }),
    template: renderSpellText(oe.spells, source, { spellId, rank: 1, curves: new Map(), slots: true }),
  }));
}

const NUMBER_WORDS: Record<string, string> = { dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
const NUMBER_WORD = /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|two|three|four|five|six|seven|eight|nine|ten)\b/g;

const plainOf = (text: string): string => text.replace(/\{\{[^|}]*\|([^}]*)\}\}/g, "$1");

/** Cifras escritas con dígitos (sin separar miles ni decimales por idioma): «1,5» y «1.5» cuentan igual. */
export function numbersOf(text: string): string[] {
  return (plainOf(text).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", "."))));
}

/** Cifras escritas con letra («tres objetivos», «three targets»). */
const wordNumbersOf = (text: string): string[] => (plainOf(text).toLowerCase().match(NUMBER_WORD) ?? []).map((w) => NUMBER_WORDS[w]!);

/** Resta una cifra de cada vez (multiconjunto). */
function without(from: string[], other: string[]): string[] {
  const rest = [...other];
  const out: string[] = [];
  for (const n of from) {
    const i = rest.indexOf(n);
    if (i >= 0) rest.splice(i, 1);
    else out.push(n);
  }
  return out;
}

/**
 * Las cifras de los dos textos son las mismas. Se ignora el «1» suelto («solo puede haber 1 aspecto» / «only one Aspect») y una cifra que
 * un texto escribe con dígitos y el otro con letra («hasta 3 objetivos» / «un máximo de tres objetivos») cuenta como la misma.
 */
export function sameNumbers(a: string, b: string): boolean {
  const x = numbersOf(a).filter((n) => n !== "1");
  const y = numbersOf(b).filter((n) => n !== "1");
  const onlyA = without(x, y);
  const onlyB = without(y, x);
  const wordsA = wordNumbersOf(a);
  const wordsB = wordNumbersOf(b);
  if (onlyA.every((n) => wordsB.includes(n)) && onlyB.every((n) => wordsA.includes(n))) return true;
  return [...new Set(x)].sort().join(",") === [...new Set(y)].sort().join(",");
}

/** Marcadores que el cliente deja sin resolver (formulas con el personaje, referencias a otros textos): se ocultan con «…», como hace el motor. */
export function hideUnresolved(text: string): string {
  return text.replace(/\$\{[^{}]*\}/g, "…").replace(/\$@[A-Za-z]+\d*/g, "").replace(/\$\d*[A-Za-z]\w*/g, "…");
}
