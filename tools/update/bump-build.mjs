// Cambia el build escrito a mano en el código, las pruebas y las herramientas (paso «Regenerar» de la skill
// forever-patch-review). Solo toca ficheros versionados; nunca `data/`, `docs/` ni `apps/web/public/`.
// El build de los modelos 3D (`data/models/<build>`) se trata aparte: no se cambia hasta regenerarlos
// (añade --models para incluirlo: tools/model/*, apps/web/src/viewer/config.ts).
//
// Uso: node tools/update/bump-build.mjs <viejo> <nuevo> [--models] [--dry-run]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const [from, to] = args.filter((a) => !a.startsWith("--"));
const withModels = args.includes("--models");
const dry = args.includes("--dry-run");
if (!/^\d+\.\d+\.\d+\.\d+$/.test(from ?? "") || !/^\d+\.\d+\.\d+\.\d+$/.test(to ?? "")) {
  console.error("Uso: node tools/update/bump-build.mjs 1.60.1.70450 1.60.1.70532 [--models] [--dry-run]");
  process.exit(2);
}

const MODEL_FILES = [/^tools\/model\//, /^apps\/web\/src\/viewer\/config\.ts$/];
// patch-check.test.mjs fija a propósito el parche 70532 -> 70658 (reproduce hallazgos conocidos): no debe seguir al build vigente
const SKIP = [/^tools\/update\/test\/patch-check\.test\.mjs$/, /^data\//, /^docs\//, /^apps\/web\/public\//, /^apps\/web\/dist\//, /^node_modules\//, /\.(glb|webp|png|jpg|bin)$/];

const files = execFileSync("git", ["grep", "-l", "-F", from], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !SKIP.some((r) => r.test(f)))
  .filter((f) => withModels || !MODEL_FILES.some((r) => r.test(f)));

let total = 0;
for (const f of files) {
  const text = readFileSync(join(root, f), "utf8");
  const n = text.split(from).length - 1;
  total += n;
  console.log(`${dry ? "(simulado) " : ""}${f}: ${n}`);
  if (!dry) writeFileSync(join(root, f), text.split(from).join(to));
}
console.log(`${files.length} ficheros, ${total} cambios${dry ? " (simulado)" : ""}.`);
if (!withModels) console.log("Modelos 3D sin tocar (tools/model, viewer/config.ts): regenerarlos o repetir con --models.");
