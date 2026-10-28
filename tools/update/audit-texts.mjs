#!/usr/bin/env node
// Audita TODOS los textos en español que la web enseña (talentos, rangos de habilidad, raciales, objetos, conjuntos, beneficios y
// encantamientos) y las raciales y habilidades también contra su inglés oficial. Solo lee data/forever/<build>; no toca el cliente.
// La lógica está en lib/texts.mjs (la reutiliza patch-check.mjs).
//
// Comprueba:
//  1. Marcadores del cliente sin resolver ($s1, ${…}, {{…}}, |n) en el texto mostrado.
//  2. Texto vacío.
//  3. Redacción sospechosa: «durante <número> » sin unidad (errata típica: «…de salud durante 1383 y…», cuando es «por 1383»).
//  4. Cifras ES ≠ EN en raciales, raciales de clase, talentos y habilidades.
//  5. Raciales: cada hechizo trae texto completo (los que no, se listan: se enseña el resumen de la tabla).
//  6. Erratas conocidas del cliente (CLIENT_TEXT_FIXES) que el cliente ya corrigió, y traducciones propias que ya sobran.
//
// Uso: node --import tsx tools/update/audit-texts.mjs [build] [--strict]   (por defecto el build más reciente de data/forever; --strict sale con 1 si hay hallazgos sin clasificar)
// Los hallazgos ya revisados (huecos del cliente) están en data/rules/text-audit-known.json con su motivo y no se listan.
// Cada hallazgo es una pista para revisar contra el texto en bruto del cliente (data/raw/<build>-hotfix/Spell.csv), no una sentencia.
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditTexts, classifyFindings, loadKnownFindings, staleFixes, staleOverrides } from "./lib/texts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const build = args.find((a) => !a.startsWith("--")) ?? readdirSync(join(root, "data", "forever")).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort().at(-1);
const dir = join(root, "data", "forever", build);

const { counted, findings } = auditTexts(dir);
console.log(`# Auditoría de textos del build ${build}\n`);
const cls = classifyFindings(findings, loadKnownFindings(root));
console.log(`Textos revisados: ${counted}. Hallazgos: ${findings.length} (${cls.known.length} conocidos con motivo en data/rules/text-audit-known.json, ${cls.unknown.length} sin clasificar).\n`);
for (const f of cls.unknown) console.log(`- [${f.problem}] ${f.where}\n    ${f.text}`);
if (cls.gone.length) console.log(`\nConocidos que ya no ocurren (quitarlos de text-audit-known.json): ${cls.gone.map((k) => `${k.problem} · ${k.where ?? k.wherePrefix}`).join("; ")}`);

const fixes = staleFixes(join(root, "data", "raw", `${build}-hotfix`));
console.log(`\nErratas conocidas del cliente (CLIENT_TEXT_FIXES): ${fixes.checked ? `${fixes.active.length} siguen en el cliente, ${fixes.stale.length} ya corregidas` : "sin volcado en bruto para comprobarlas"}`);
for (const s of fixes.stale) console.log(`- SOBRA (el cliente ya no trae este texto): ${s}`);
const own = staleOverrides(dir, root);
console.log(`Traducciones propias que ya sobran (el cliente trae el español): ${own.spells.length}${own.spells.length ? ` → hechizos ${own.spells.join(", ")}` : ""}`);
process.exit(strict && (cls.unknown.length || cls.gone.length || fixes.stale.length || own.spells.length) ? 1 : 0);
