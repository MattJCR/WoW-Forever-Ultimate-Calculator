// Copia los datos normalizados (data/forever/<build>/) a public/data/ para que Vite los sirva y los
// incluya en el build estatico. Solo se publican JSON normalizados, nunca los CSV en bruto del cliente.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSeoIndex } from "./build-seo-index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const forever = join(root, "data", "forever");
const build = process.env.DATA_BUILD ?? readdirSync(forever).filter((d) => !d.endsWith("-static")).sort().at(-1);
if (!build || !existsSync(join(forever, build, "manifest.json"))) {
  console.error(`No hay datos en ${forever}. Ejecuta primero: npm run pipeline`);
  process.exit(1);
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../public/data");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(forever, build), out, { recursive: true });
console.log(`Datos ${build} -> ${out}`);
writeSeoIndex(out);

// Modelos 3D del probador (data/models/<build>/, los genera tools/model; aun no se versionan): solo si existen.
const models = join(root, "data", "models");
const modelsOut = resolve(dirname(fileURLToPath(import.meta.url)), "../public/models");
rmSync(modelsOut, { recursive: true, force: true });
if (existsSync(models)) {
  cpSync(models, modelsOut, { recursive: true });
  console.log(`Modelos -> ${modelsOut}`);
}
