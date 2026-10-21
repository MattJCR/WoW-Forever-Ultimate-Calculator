#!/usr/bin/env node
// Diferencias fila a fila entre dos exportaciones en bruto (data/raw/<A> frente a data/raw/<B>).
// Sirve para ver QUE hotfix del servidor cambio (y en que hechizo) antes de mirar el pipeline.
// Solo lee ficheros del repo; no toca el cliente.
// Uso: node tools/update/diff-raw.mjs <carpetaVieja> <carpetaNueva> [--out f.md] [--tables A,B]
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(new URL("../../packages/data-pipeline/package.json", import.meta.url));
const { parse } = require("csv-parse/sync");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const [oldDir, newDir] = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--")).map((p) => resolve(p));
if (!oldDir || !newDir) { console.error("Uso: diff-raw.mjs <vieja> <nueva> [--out f.md] [--tables A,B]"); process.exit(2); }

const read = (dir, t) => {
  const f = join(dir, `${t}.csv`);
  return existsSync(f) ? parse(readFileSync(f), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) : null;
};
const names = new Map((read(newDir, "SpellName") ?? []).map((r) => [r.ID, r.Name_lang]));
const spellOf = (t, r) => (t === "Spell" || t === "SpellName" ? r.ID : r.SpellID);
const label = (t, r) => { const s = spellOf(t, r); return s ? `${names.get(s) ?? "?"} (${s})` : ""; };
// Clave de fila: ID salvo CurvePoint (ID suelto no unico? se usa CurveID+OrderIndex).
const keyOf = (t, r) => (t === "CurvePoint" ? `${r.CurveID}/${r.OrderIndex}` : r.ID);

const only = flag("tables")?.split(",");
const tables = (only ?? readdirSync(newDir).filter((f) => f.endsWith(".csv")).map((f) => f.slice(0, -4))).sort();
const out = [`# Diferencias en bruto\n\n- Antes: ${oldDir}\n- Ahora: ${newDir}\n`];
let total = 0;
for (const t of tables) {
  const a = read(oldDir, t), b = read(newDir, t);
  if (!a || !b) { out.push(`\n## ${t}\n- tabla solo en ${a ? "la vieja" : "la nueva"}\n`); continue; }
  const ma = new Map(a.map((r) => [keyOf(t, r), r])), mb = new Map(b.map((r) => [keyOf(t, r), r]));
  const lines = [];
  for (const [k, r] of mb) {
    const o = ma.get(k);
    if (!o) { lines.push(`＋ ${label(t, r)} fila ${k}`); continue; }
    const ch = Object.keys(r).filter((c) => (o[c] ?? "") !== (r[c] ?? ""));
    if (ch.length) lines.push(`Δ ${label(t, r)} fila ${k}: ` + ch.map((c) => `${c}: ${String(o[c] ?? "").slice(0, 160)} → ${String(r[c] ?? "").slice(0, 160)}`).join(" | "));
  }
  for (const [k, r] of ma) if (!mb.has(k)) lines.push(`－ ${label(t, r)} fila ${k}`);
  if (lines.length) { out.push(`\n## ${t} (${lines.length})\n` + lines.map((l) => `- ${l}`).join("\n") + "\n"); total += lines.length; }
}
out.push(`\n---\nTotal de filas distintas: ${total}\n`);
const text = out.join("");
if (flag("out")) writeFileSync(resolve(flag("out")), text); else console.log(text);
console.error(`Total de filas distintas: ${total}`);
