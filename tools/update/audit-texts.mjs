#!/usr/bin/env node
// Audita TODOS los textos en español que la web enseña (talentos, rangos de habilidad, raciales, raciales de clase) contra lo que debe
// cumplir un texto bueno, y las raciales también contra su inglés oficial. Solo lee data/forever/<build>; no toca el cliente.
//
// Comprueba:
//  1. Marcadores del cliente sin resolver ($s1, ${…}, {{…}}, |n) en el texto mostrado.
//  2. Texto vacío.
//  3. Redacción sospechosa: «durante <número> » sin unidad (errata típica: «…de salud durante 1383 y…», cuando es «por 1383»), 
//  4. Raciales y raciales de clase: las cifras del español son las del inglés oficial (i18n/en.json).
//  5. Raciales: cada hechizo trae texto completo (los que no, se listan: se enseña el resumen de la tabla).
//
// Uso: node tools/update/audit-texts.mjs [build] [--strict]   (por defecto el build del manifest más reciente; --strict sale con 1 si hay hallazgos)
// Cada hallazgo es una pista para revisar contra el texto en bruto del cliente (data/raw/<build>-hotfix/Spell.csv), no una sentencia.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const build = args.find((a) => !a.startsWith("--")) ?? readdirSync(join(root, "data", "forever")).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort().at(-1);
const dir = join(root, "data", "forever", build);
const readJson = (rel) => (existsSync(join(dir, rel)) ? JSON.parse(readFileSync(join(dir, rel), "utf8")) : null);

const findings = [];
const add = (where, problem, text) => findings.push({ where, problem, text: String(text).replace(/\s+/g, " ").slice(0, 220) });

const MARKERS = /\$[A-Za-z0-9<{@]|\{\{|\}\}|\|n|\$\{/;
const DURANTE = /\bdurante \d[\d.,]*(?! ?(?:s\b|seg|min|h\b|horas?|segundos|minutos|veces|turnos|ticks|%))\s+(?:y|e|para|y\s)\b/i;

function checkText(where, text) {
  if (typeof text !== "string") return;
  if (!text.trim()) return add(where, "texto vacío", "");
  if (MARKERS.test(text)) add(where, "marcador del cliente sin resolver", text);
  if (DURANTE.test(text)) add(where, "«durante <cifra>» sin unidad (¿errata del cliente?)", text);
}

// ---- 1-3: talentos y habilidades de las 9 clases, Legacy
let counted = 0;
for (const f of existsSync(join(dir, "classes")) ? readdirSync(join(dir, "classes")).filter((x) => x.endsWith(".json")) : []) {
  const cls = readJson(`classes/${f}`);
  for (const t of [...cls.specs.flatMap((s) => s.talents), ...(cls.inactiveTalents ?? [])]) {
    (t.descriptions ?? []).forEach((d, i) => checkText(`${cls.className}: talento ${t.name} r${i + 1}`, d));
    counted += t.descriptions?.length ?? 0;
  }
}
for (const f of existsSync(join(dir, "abilities")) ? readdirSync(join(dir, "abilities")).filter((x) => x.endsWith(".json")) : []) {
  const ab = readJson(`abilities/${f}`);
  for (const a of ab.abilities) for (const r of a.ranks) {
    checkText(`clase ${ab.classId}: habilidad ${a.name} r${r.rank}`, r.description);
    counted++;
  }
}
const legacy = readJson("legacy.json");
for (const t of legacy?.specs?.flatMap((s) => s.talents) ?? []) (t.descriptions ?? []).forEach((d, i) => { checkText(`Legacy: ${t.name} r${i + 1}`, d); counted++; });

// ---- 4-5: raciales y raciales de clase, con su inglés oficial
const races = readJson("races.json")?.races ?? [];
const en = readJson("i18n/en.json");
const nums = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", ".")))).filter((n) => n !== "1").sort().join(",");
const parity = (where, es, enText) => {
  if (!enText) return add(where, "sin texto en inglés", es);
  if (nums(es) !== nums(enText)) add(where, `cifras distintas ES/EN (${nums(es)} ≠ ${nums(enText)})`, `${es}  ||  ${enText}`);
};
for (const r of races) {
  r.racials.forEach((a) => {
    checkText(`${r.name}: racial ${a.name} (resumen)`, a.description);
    for (const s of a.spells) {
      counted++;
      if (s.description === null || s.description === undefined) { add(`${r.name}: racial ${a.name} hechizo ${s.spellId}`, "sin texto completo (se enseña el resumen)", a.description); continue; }
      checkText(`${r.name}: racial ${a.name} hechizo ${s.spellId}`, s.description);
      parity(`${r.name}: racial ${a.name} hechizo ${s.spellId}`, s.description, en?.races?.[r.id]?.racials?.[a.order]?.spellTexts?.[s.spellId]);
    }
  });
  for (const c of r.classRacials ?? []) {
    counted++;
    checkText(`${r.name}: racial de clase ${c.name}`, c.description);
    parity(`${r.name}: racial de clase ${c.name}`, c.description, en?.spells?.[c.spellId]?.description);
  }
}

console.log(`# Auditoría de textos del build ${build}\n`);
console.log(`Textos revisados: ${counted}. Hallazgos: ${findings.length}.\n`);
const byProblem = new Map();
for (const f of findings) byProblem.set(f.problem.replace(/\(.*\)/, "").trim(), (byProblem.get(f.problem.replace(/\(.*\)/, "").trim()) ?? 0) + 1);
for (const [p, n] of byProblem) console.log(`- ${p}: ${n}`);
console.log();
for (const f of findings) console.log(`- [${f.problem}] ${f.where}\n    ${f.text}`);
process.exit(strict && findings.length ? 1 : 0);
