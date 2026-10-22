// Escenarios de la pantalla de seleccion de personaje (Interface/Glues/Models/UI_<raza>) -> .glb estatico + camaras + texturas.
// De ahi salen los fondos del probador (se renderizan con `render-scenes.mjs`). Solo lee del cliente (via wow.tools.local).
// Uso: node tools/model/build-scene.mjs [--only=human,orc] [--listfile=<listfile.csv de wow.tools.local>]
// Con la lista de nombres se dejan fuera (`skip` en el json) las capas de adorno que estorban en una imagen fija: niebla, aves, murciélagos, luciérnagas.
// Salida: data/models/<build>/scene/<nombre>.glb y <nombre>.json (camaras y texturas); texturas en tex/<FileDataID>.webp.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFile, fetchWebp } from "./casc.mjs";
import { parseM2 } from "./m2.mjs";
import { buildItemModel } from "./build-model.mjs";
import { BUILD } from "./tables.mjs";
import { SCENES } from "./scenes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(ROOT, "data", "models", BUILD);


const listfile = process.argv.find((a) => a.startsWith("--listfile="))?.split("=")[1];
const names = new Map();
if (listfile) for (const l of fs.readFileSync(listfile, "utf8").split(String.fromCharCode(10))) { const i = l.indexOf(";"); if (i > 0) names.set(Number(l.slice(0, i)), l.slice(i + 1).trim()); }
const SKIP = /fog|seagull|sunbird|(^|[\/])bat_|firefly|rabbit|(^|[\/])caustic0/i;

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]?.split(",");
fs.mkdirSync(path.join(out, "scene"), { recursive: true });
fs.mkdirSync(path.join(out, "tex"), { recursive: true });

for (const [name, s] of Object.entries(SCENES)) {
  if (only && !only.includes(name)) continue;
  const m2 = parseM2(await fetchFile(s.id));
  fs.writeFileSync(path.join(out, "scene", `${name}.glb`), await buildItemModel(s.id));
  const files = [...new Set(m2.fileIds.txid.filter(Boolean))];
  let got = 0;
  for (const f of files) {
    const dest = path.join(out, "tex", `${f}.webp`);
    if (fs.existsSync(dest)) { got++; continue; }
    try { fs.writeFileSync(dest, await fetchWebp(f)); got++; } catch (e) { console.log(`  textura ${f}: ${e.message}`); }
  }
  fs.writeFileSync(path.join(out, "scene", `${name}.json`), JSON.stringify({ file: s.id, races: s.races, cameras: m2.cameras, textures: files, skip: files.filter((f) => SKIP.test(names.get(f) ?? "")) }, null, 1));
  console.log(`${name}: ${m2.cameras.length} camaras, ${got}/${files.length} texturas`);
}
