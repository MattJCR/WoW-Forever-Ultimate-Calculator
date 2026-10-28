// Auditoría de los textos que la web enseña. Solo lee `data/forever/<build>`, `data/raw/` y `data/i18n/`; no toca el cliente.
// Se ejecuta con `node --import tsx` (usa CLIENT_TEXT_FIXES y looksEnglish del pipeline).
//
// auditTexts(dir)        → hallazgos de un dataset (marcadores sin resolver, redacciones sospechosas, texto completo, paridad ES/EN).
// textTransitions(a, b)  → textos que cambian de origen entre dos datasets (inglés → español: la traducción propia sobra; español → inglés: falta una).
// staleFixes(rawDir)     → erratas conocidas del cliente (CLIENT_TEXT_FIXES) que el cliente ya corrigió (entonces sobran).
// staleOverrides(dir)    → traducciones propias (esES-overrides.json) que ya no se usan.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { CLIENT_TEXT_FIXES } from "../../../packages/data-pipeline/src/spell-tables.ts";

const require = createRequire(new URL("../../../packages/data-pipeline/package.json", import.meta.url));

const readJson = (dir, rel) => {
  const f = join(dir, rel);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};
const jsonFiles = (dir, sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((x) => x.endsWith(".json")) : []);

const MARKERS = /\$[A-Za-z0-9<{@]|\{\{|\}\}|\|n|\$\{/;
const DURANTE = /\bdurante \d[\d.,]*(?! ?(?:s\b|seg|min|h\b|horas?|segundos|minutos|veces|turnos|ticks|%))\s+(?:y|e|para|y\s)\b/i;
const nums = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", ".")))).filter((n) => n !== "1").sort().join(",");

export function auditTexts(dir) {
  const findings = [];
  let counted = 0;
  const add = (where, problem, text) => findings.push({ where, problem, text: String(text).replace(/\s+/g, " ").slice(0, 220) });
  const check = (where, text) => {
    counted++;
    if (typeof text !== "string") return;
    if (!text.trim()) return add(where, "texto vacío", "");
    if (MARKERS.test(text)) add(where, "marcador del cliente sin resolver", text);
    if (DURANTE.test(text)) add(where, "«durante <cifra>» sin unidad (¿errata del cliente?)", text);
  };
  const en = readJson(dir, "i18n/en.json");
  const parity = (where, es, enText, label = "cifras distintas ES/EN") => {
    if (!enText) return add(where, "sin texto en inglés", es);
    if (nums(es) !== nums(enText)) add(where, `${label} (${nums(es)} ≠ ${nums(enText)})`, `${es}  ||  ${enText}`);
  };

  // Talentos, habilidades y Legacy de las 9 clases
  for (const f of jsonFiles(dir, "classes")) {
    const cls = readJson(dir, `classes/${f}`);
    for (const t of [...cls.specs.flatMap((s) => s.talents), ...(cls.inactiveTalents ?? [])]) {
      (t.descriptions ?? []).forEach((d, i) => {
        check(`${cls.className}: talento ${t.name} r${i + 1}`, d);
        const e = en?.talents?.[t.nodeId]?.descriptions?.[i];
        if (e && nums(d) !== nums(e) && !t.descriptionsApproximate) add(`${cls.className}: talento ${t.name} r${i + 1}`, `cifras distintas ES/EN (${nums(d)} ≠ ${nums(e)})`, `${d}  ||  ${e}`);
      });
    }
  }
  for (const f of jsonFiles(dir, "abilities")) {
    const ab = readJson(dir, `abilities/${f}`);
    for (const a of ab.abilities) {
      for (const r of a.ranks) {
        check(`clase ${ab.classId}: habilidad ${a.name} r${r.rank}`, r.description);
        const e = en?.spells?.[r.spellId]?.description;
        if (e && r.descriptionComplete && nums(r.description) !== nums(e)) add(`clase ${ab.classId}: habilidad ${a.name} r${r.rank}`, `cifras distintas ES/EN (${nums(r.description)} ≠ ${nums(e)})`, `${r.description}  ||  ${e}`);
      }
    }
  }
  for (const t of readJson(dir, "legacy.json")?.specs?.flatMap((s) => s.talents) ?? []) (t.descriptions ?? []).forEach((d, i) => check(`Legacy: ${t.name} r${i + 1}`, d));

  // Raciales y raciales de clase, con su inglés oficial
  for (const r of readJson(dir, "races.json")?.races ?? []) {
    r.racials.forEach((a) => {
      check(`${r.name}: racial ${a.name} (resumen)`, a.description);
      for (const s of a.spells) {
        if (s.description === null || s.description === undefined) { add(`${r.name}: racial ${a.name} hechizo ${s.spellId}`, "sin texto completo (se enseña el resumen)", a.description); continue; }
        check(`${r.name}: racial ${a.name} hechizo ${s.spellId}`, s.description);
        parity(`${r.name}: racial ${a.name} hechizo ${s.spellId}`, s.description, en?.races?.[r.id]?.racials?.[a.order]?.spellTexts?.[s.spellId]);
      }
    });
    for (const c of r.classRacials ?? []) {
      check(`${r.name}: racial de clase ${c.name}`, c.description);
      parity(`${r.name}: racial de clase ${c.name}`, c.description, en?.spells?.[c.spellId]?.description);
    }
  }

  // Equipo, conjuntos, beneficios y encantamientos
  const items = readJson(dir, "items.json");
  for (const i of items?.items ?? []) {
    check(`objeto ${i.id} ${i.name}: nombre`, i.name);
    for (const e of i.effects ?? []) if (e.text) check(`objeto ${i.id} ${i.name}: efecto ${e.spellId}`, e.text);
  }
  for (const s of items?.sets ?? []) {
    check(`conjunto ${s.id} ${s.name}: nombre`, s.name);
    for (const b of s.bonuses) check(`conjunto ${s.id} ${s.name}: bono de ${b.threshold}`, b.text);
  }
  for (const b of readJson(dir, "buffs.json")?.buffs ?? []) check(`beneficio ${b.id} ${b.name}`, b.text);
  for (const w of readJson(dir, "weapon-enhancements.json")?.enhancements ?? []) {
    check(`mejora de arma ${w.itemId} ${w.name}`, w.text);
    for (const x of w.effects ?? []) if (x.text) check(`mejora de arma ${w.itemId} ${w.name}: efecto ${x.spellId}`, x.text);
  }
  for (const e of readJson(dir, "enchants.json")?.enchants ?? []) {
    check(`encantamiento ${e.effectId}/${e.spellId} ${e.name}: nombre`, e.name);
    for (const x of e.effects ?? []) if (x.text) check(`encantamiento ${e.effectId}/${e.spellId} ${e.name}: efecto`, x.text);
  }
  return { counted, findings };
}

const idOf = (f) => `${f.problem.replace(/\(.*\)/, "").trim()}|${f.where}`;

const problemKey = (f) => f.problem.replace(/\(.*\)/, "").trim();

/** Hallazgos ya revisados, con su motivo (`data/rules/text-audit-known.json`). Sin fichero, ninguno. */
export function loadKnownFindings(root) {
  const file = join(root, "data", "rules", "text-audit-known.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).entries ?? [] : [];
}

/**
 * Reparte los hallazgos de `auditTexts` en conocidos (con su motivo) y sin clasificar. `gone` son las entradas conocidas que ya no
 * ocurren (el cliente lo corrigió o el texto cambió): sobran en el fichero.
 */
export function classifyFindings(findings, known) {
  const matches = (k, f) => k.problem === problemKey(f) && (k.where !== undefined ? k.where === f.where : f.where.startsWith(k.wherePrefix));
  const used = new Set();
  const knownHits = [], unknown = [];
  for (const f of findings) {
    const k = known.find((e) => matches(e, f));
    if (k) { used.add(k); knownHits.push({ ...f, reason: k.reason }); } else unknown.push(f);
  }
  return { known: knownHits, unknown, gone: known.filter((k) => !used.has(k)) };
}

/** Hallazgos que están en `now` y no estaban en `before`: lo que el parche ha estropeado (o arreglado, a la inversa). */
export function newFindings(before, now) {
  const had = new Set(before.findings.map(idOf));
  const has = new Set(now.findings.map(idOf));
  return { appeared: now.findings.filter((f) => !had.has(idOf(f))), resolved: before.findings.filter((f) => !has.has(idOf(f))) };
}

/** Origen del texto de cada entidad con `textOrigin` (client | translated-by-us | untranslated). */
function originMap(dir) {
  const m = new Map();
  for (const f of jsonFiles(dir, "classes")) {
    const cls = readJson(dir, `classes/${f}`);
    for (const t of [...cls.specs.flatMap((s) => s.talents), ...(cls.inactiveTalents ?? [])]) m.set(`talento ${cls.className} · ${t.name} (nodo ${t.nodeId})`, t.textOrigin);
  }
  for (const f of jsonFiles(dir, "abilities")) {
    const ab = readJson(dir, `abilities/${f}`);
    for (const a of ab.abilities) for (const r of a.ranks) m.set(`habilidad ${a.name} r${r.rank} (${r.spellId})`, r.textOrigin);
  }
  for (const r of readJson(dir, "races.json")?.races ?? []) {
    for (const a of r.racials) m.set(`racial ${r.name} · ${a.name}`, a.textOrigin);
    for (const c of r.classRacials ?? []) m.set(`racial de clase ${r.name} · ${c.name}`, c.textOrigin);
  }
  for (const i of readJson(dir, "items.json")?.items ?? []) m.set(`objeto ${i.id} ${i.name}`, i.textOrigin);
  for (const b of readJson(dir, "buffs.json")?.buffs ?? []) m.set(`beneficio ${b.id} ${b.name}`, b.textOrigin);
  for (const w of readJson(dir, "weapon-enhancements.json")?.enhancements ?? []) m.set(`mejora de arma ${w.itemId} ${w.name}`, w.textOrigin);
  return m;
}

/** Textos cuyo origen cambia entre dos datasets. */
export function textTransitions(oldDir, newDir) {
  const a = originMap(oldDir), b = originMap(newDir);
  const out = { nowSpanish: [], backToEnglish: [], newlyUntranslated: [] };
  for (const [k, now] of b) {
    const before = a.get(k);
    if (before === undefined || before === now) continue;
    if (before !== "client" && now === "client") out.nowSpanish.push(`${k}: ${before} → client (el cliente ya lo trae en español: la traducción propia sobra)`);
    else if (before === "client" && now !== "client") out.backToEnglish.push(`${k}: client → ${now} (el texto vuelve a inglés)`);
    else if (now === "untranslated") out.newlyUntranslated.push(`${k}: ${before} → untranslated`);
  }
  // Y los que ya están sin traducir ahora: son los que piden traducción propia (necesita aprobación del usuario)
  out.untranslatedNow = [...b].filter(([, o]) => o === "untranslated").map(([k]) => k);
  return out;
}

/** Erratas conocidas (CLIENT_TEXT_FIXES) que ya no aparecen en el texto en bruto del cliente: el cliente las corrigió y la regla sobra. */
export function staleFixes(rawDir) {
  const file = join(rawDir, "Spell.csv");
  if (!existsSync(file)) return { checked: false, stale: [], active: [] };
  const { parse } = require("csv-parse/sync");
  const rows = parse(readFileSync(file), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  const text = rows.map((r) => `${r.Description_lang}\n${r.AuraDescription_lang}`).join("\n");
  const stale = [], active = [];
  for (const [wrong] of CLIENT_TEXT_FIXES) (text.includes(wrong) ? active : stale).push(wrong);
  return { checked: true, stale, active };
}

/** Variables de atributos o poder de ataque del personaje dentro de una fórmula del cliente (`${$o2+$SPI}`, `$AP`, `$<APRatio>`). */
const STAT_TOKEN = /\$(?:SPI|STR|AGI|STA|INT|AP|RAP|ap|rap|apm|sp|SP[A-Z]{2}|<[A-Za-z]*(?:AP|SP)[A-Za-z]*>)(?![A-Za-z])/g;

/**
 * Hechizos del dataset cuya fórmula en bruto suma atributos del personaje. El texto calculado enseña solo la base (el pipeline
 * evalúa esas variables a 0), así que no sale ningún marcador: es la manera de que algo así se vea (lección del 70658:
 * «Sacrificio oscuro» decía 1600 y en realidad suma el espíritu). Devuelve Map(spellId → { name, tokens }).
 */
export function statFormulas(rawDir, dir) {
  const file = join(rawDir, "Spell.csv");
  if (!existsSync(file)) return null;
  const ours = new Map();
  const flagged = new Set(); // hechizos cuya dependencia del personaje ya marca el dataset
  for (const r of readJson(dir, "races.json")?.races ?? []) for (const c of r.classRacials ?? []) if (c.scalesWith?.length) flagged.add(String(c.spellId));
  for (const f of jsonFiles(dir, "abilities")) for (const a of readJson(dir, `abilities/${f}`).abilities) for (const r of a.ranks) ours.set(String(r.spellId), `${a.name} r${r.rank}`);
  for (const r of readJson(dir, "races.json")?.races ?? []) {
    for (const c of r.classRacials ?? []) ours.set(String(c.spellId), `${r.name}: ${c.name}`);
    for (const a of r.racials) for (const s of a.spells) ours.set(String(s.spellId), `${r.name}: ${a.name}`);
  }
  const { parse } = require("csv-parse/sync");
  const rows = parse(readFileSync(file), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  const out = new Map();
  for (const row of rows) {
    const name = ours.get(row.ID);
    if (!name) continue;
    const tokens = [...new Set(`${row.Description_lang}\n${row.AuraDescription_lang}`.match(STAT_TOKEN) ?? [])];
    if (tokens.length) out.set(row.ID, { name, tokens, flagged: flagged.has(row.ID) });
  }
  return out;
}

/** Traducciones propias que ya no hacen falta: el hechizo ya está en español en el cliente (o ya no existe). */
export function staleOverrides(dir, root) {
  const file = join(root, "data", "i18n", "esES-overrides.json");
  if (!existsSync(file)) return { spells: [], checked: 0 };
  const own = JSON.parse(readFileSync(file, "utf8")).spells ?? {};
  const origin = new Map();
  for (const f of jsonFiles(dir, "classes")) {
    const cls = readJson(dir, `classes/${f}`);
    for (const t of [...cls.specs.flatMap((s) => s.talents), ...(cls.inactiveTalents ?? [])]) if (t.spellId) origin.set(String(t.spellId), t.textOrigin);
  }
  for (const f of jsonFiles(dir, "abilities")) for (const a of readJson(dir, `abilities/${f}`).abilities) for (const r of a.ranks) origin.set(String(r.spellId), r.textOrigin);
  for (const r of readJson(dir, "races.json")?.races ?? []) {
    for (const c of r.classRacials ?? []) origin.set(String(c.spellId), c.textOrigin);
    for (const a of r.racials) for (const s of a.spells) origin.set(String(s.spellId), a.textOrigin);
  }
  const spells = Object.keys(own).filter((id) => origin.get(id) === "client");
  return { spells, checked: Object.keys(own).filter((id) => origin.has(id)).length, total: Object.keys(own).length };
}
