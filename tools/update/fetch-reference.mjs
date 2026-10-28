#!/usr/bin/env node
// Descarga los 9 exports de la referencia externa a su carpeta de data/external/ (solo contraste; el cliente manda) y guarda
// ANTES una copia de los viejos fuera del repo, para poder comparar qué ha cambiado la referencia (data/external no está en git).
// La URL no se escribe aquí (regla 9 de CLAUDE.md): se pasa con --url o con la variable REFERENCE_EXPORT_URL; `{class}` se
// sustituye por el nombre de la clase en minúsculas. El valor concreto está en la skill forever-patch-review.
//
// Uso: node tools/update/fetch-reference.mjs --url "https://…/{class}.json" [--dry-run]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REFERENCE_DIR } from "./lib/run.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const template = opt("url", process.env.REFERENCE_EXPORT_URL);
const dry = args.includes("--dry-run");
if (!template?.includes("{class}")) { console.error('Falta la URL: --url "https://…/{class}.json" o REFERENCE_EXPORT_URL'); process.exit(2); }

const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
const dir = REFERENCE_DIR;
const backup = join(process.env.PATCH_CHECK_TMP ?? join(tmpdir(), "wfuc-patch-check"), `reference-before-${new Date().toISOString().slice(0, 10)}`);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

mkdirSync(dir, { recursive: true });
if (!dry) mkdirSync(backup, { recursive: true });
let changed = 0;
for (const c of CLASSES) {
  const res = await fetch(template.replace("{class}", c));
  if (!res.ok) { console.error(`${c}: HTTP ${res.status}`); process.exitCode = 1; continue; }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { console.error(`${c}: la respuesta no es JSON`); process.exitCode = 1; continue; }
  if (!json.talents?.trees || !json.spell_desc) { console.error(`${c}: no tiene la forma esperada (talents.trees, spell_desc)`); process.exitCode = 1; continue; }
  const file = join(dir, `${c}.json`);
  const before = existsSync(file) ? readFileSync(file) : null;
  const same = before && sha(before) === sha(Buffer.from(text));
  console.log(`${c.padEnd(8)} generado ${json.generated ?? "?"} ${same ? "· sin cambios" : before ? "· CAMBIADO" : "· nuevo"}`);
  if (!same) {
    changed++;
    if (!dry) {
      if (before) copyFileSync(file, join(backup, `${c}.json`));
      writeFileSync(file, text);
    }
  }
}
console.log(`${changed} exports ${dry ? "distintos (simulado)" : "actualizados"}${changed && !dry ? `; copia de los anteriores en ${backup}` : ""}. Actualiza la fecha en el ATTRIBUTION.md de esa carpeta.`);
