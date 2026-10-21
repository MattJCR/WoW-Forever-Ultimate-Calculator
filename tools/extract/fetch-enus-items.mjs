// Nombre en inglés de los objetos que las tablas del juego descargadas con fetch-enus-tables.mjs no traen (objetos añadidos por parche).
// Lee los ids que faltan del informe del pipeline (data/i18n/en-verification.json) y los consulta uno a uno, con pausa, a una consulta
// pública por id. Deja data/external/enus/ItemNamesExtra.csv (ID,Display_lang,Quality). No toca el cliente.
// Uso: ENUS_ITEM_URL="https://…/item/{id}" node tools/extract/fetch-enus-items.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const template = process.env.ENUS_ITEM_URL;
if (!template || !template.includes("{id}")) {
  console.error('Falta ENUS_ITEM_URL con {id}, p. ej. "https://…/item/{id}"');
  process.exit(1);
}
const root = resolve(import.meta.dirname, "../..");
const report = JSON.parse(readFileSync(resolve(root, "data/i18n/en-verification.json"), "utf8"));
const file = resolve(root, "data/external/enus/ItemNamesExtra.csv");
const done = new Map();
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
    const m = /^(\d+),(.*),(\d+)$/.exec(line);
    if (m) done.set(Number(m[1]), { name: m[2].replace(/^"|"$/g, "").replace(/""/g, '"'), quality: Number(m[3]) });
  }
}
const ids = report.items.stillMissing.filter((id) => !done.has(id));
console.log(`${ids.length} objetos por consultar (${done.size} ya hechos)`);
const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const save = () =>
  writeFileSync(file, ["ID,Display_lang,Quality", ...[...done].sort(([a], [b]) => a - b).map(([id, v]) => `${id},${csv(v.name)},${v.quality}`)].join("\n") + "\n", "utf8");

let failed = 0;
for (const [n, id] of ids.entries()) {
  try {
    const res = await fetch(template.replace("{id}", String(id)), { headers: { "user-agent": "Mozilla/5.0" } });
    if (res.ok) {
      const j = await res.json();
      if (j.name) done.set(id, { name: String(j.name), quality: Number(j.quality ?? -1) });
      else failed++;
    } else failed++;
  } catch {
    failed++;
  }
  if (n % 50 === 49) {
    save();
    console.log(`${n + 1}/${ids.length}`);
  }
  await new Promise((r) => setTimeout(r, 250));
}
save();
console.log(`Hecho: ${done.size} nombres, ${failed} sin respuesta`);
