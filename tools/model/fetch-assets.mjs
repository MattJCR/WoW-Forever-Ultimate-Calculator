// Descarga del cliente las texturas y modelos de objeto que hacen falta para unos objetos (o todos).
// Uso: node tools/model/fetch-assets.mjs --items=12422,60,39 | --all [--no-models]
// Texturas -> data/models/<build>/tex/<FileDataID>.webp ; modelos -> data/models/<build>/item/<FileDataID>.glb
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWebp } from "./casc.mjs";
import { BUILD } from "./tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(ROOT, "data", "models", BUILD);
const ap = JSON.parse(fs.readFileSync(path.join(dir, "appearance.json"), "utf8"));
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ids = process.argv.includes("--all") ? Object.keys(ap.items) : (arg("items") ?? "").split(",").filter(Boolean);

const texFiles = new Set();
const modelRes = new Set();
for (const id of ids) {
  const d = ap.display[ap.items[id]];
  if (!d) { console.log(`objeto ${id}: sin apariencia`); continue; }
  const res = [...(d.s ?? []).map((s) => s[1]), ...(d.m ?? []).map((m) => m[1]), ...(d.t ?? []).map((t) => t[2])];
  for (const r of res) for (const f of Object.values(ap.tex[r] ?? {})) texFiles.add(f);
  for (const m of d.m ?? []) if (m[0]) modelRes.add(m[0]);
}
fs.mkdirSync(path.join(dir, "tex"), { recursive: true });
let n = 0, fail = 0;
for (const f of texFiles) {
  const dest = path.join(dir, "tex", `${f}.webp`);
  if (fs.existsSync(dest)) continue;
  try { fs.writeFileSync(dest, await fetchWebp(f)); n++; } catch (e) { fail++; console.log(`textura ${f}: ${e.message}`); }
}
console.log(`${texFiles.size} texturas (${n} nuevas, ${fail} con error); ${modelRes.size} recursos de modelo`);
if (process.argv.includes("--no-models")) process.exit(0);

const { buildItemModel } = await import("./build-item-model.mjs");
fs.mkdirSync(path.join(dir, "item"), { recursive: true });
let nm = 0;
for (const r of modelRes) {
  for (const f of ap.model[r] ?? []) {
    const dest = path.join(dir, "item", `${f.f}.glb`);
    if (fs.existsSync(dest)) continue;
    try { fs.writeFileSync(dest, await buildItemModel(f.f)); nm++; } catch (e) { console.log(`modelo ${f.f}: ${e.message}`); }
  }
}
console.log(`${nm} modelos nuevos`);

// Texturas fijas de dentro de cada modelo (llamas de una antorcha, brillos, piezas sin textura de apariencia):
// no salen de las apariencias, hay que leerlas de las capas de los .glb ya convertidos.
const itemDir = path.join(dir, "item");
const baked = new Set();
for (const file of fs.readdirSync(itemDir)) {
  if (!file.endsWith(".glb")) continue;
  const b = fs.readFileSync(path.join(itemDir, file));
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  for (const node of json.nodes) for (const t of node.extras?.batches ?? []) if (t.texFile) baked.add(t.texFile);
}
let nb = 0, failb = 0;
for (const f of baked) {
  const dest = path.join(dir, "tex", `${f}.webp`);
  if (fs.existsSync(dest)) continue;
  try { fs.writeFileSync(dest, await fetchWebp(f)); nb++; } catch (e) { failb++; console.log(`textura fija ${f}: ${e.message}`); }
}
console.log(`${baked.size} texturas fijas de modelos (${nb} nuevas, ${failb} con error)`);
