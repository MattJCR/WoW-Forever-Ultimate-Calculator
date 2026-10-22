// Genera los modelos de todas las razas jugables (de data/forever/<build>/races.json) y models/index.json.
// Uso: node tools/model/build-all.mjs [--textures=none|default|all]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD, indexBy } from "./tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.argv.find((a) => a.startsWith("--textures="))?.split("=")[1] ?? "default";
const races = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "forever", BUILD, "races.json"), "utf8")).races;
const byRace = indexBy("ChrRaceXChrModel", "ChrRacesID", { many: true });

const index = [];
const models = new Set();
for (const r of races) {
  for (const row of byRace.get(String(r.id)) ?? []) {
    index.push({ race: r.id, sex: Number(row.Sex), chrModel: Number(row.ChrModelID) });
    models.add(Number(row.ChrModelID));
  }
}
const out = path.join(ROOT, "data", "models", BUILD);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index));
console.log(`${index.length} combinaciones raza/sexo, ${models.size} modelos distintos`);

const { spawnSync } = await import("node:child_process");
for (const id of [...models].sort((a, b) => a - b)) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools/model/build-character.mjs"), String(id), `--textures=${mode}`], { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) console.log(`FALLO m${id}`);
}
