// Contrasta los iconos de los talentos del cliente con los de la referencia (solo contraste; el cliente manda).
// La referencia da el nombre del icono (spell_frost_wisp) y nosotros el FileDataID: se resuelve con el listfile de wow.tools.local
// (<carpeta de la herramienta>/listfile.csv, lineas «id;ruta»). Solo lee ficheros; no toca el cliente.
//
// Uso: node tools/extract/contrast-icons.mjs <ruta al listfile.csv> [build]
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const listfile = process.argv[2];
const build = process.argv[3] ?? "1.60.1.70450";
if (!listfile || !fs.existsSync(listfile)) {
  console.error("Uso: node tools/extract/contrast-icons.mjs <listfile.csv> [build]");
  process.exit(1);
}
const classes = ["warrior", "paladin", "rogue", "priest", "mage", "hunter", "shaman", "warlock", "druid"];
const need = new Set();
const ours = {};
for (const c of classes) {
  ours[c] = JSON.parse(fs.readFileSync(join(root, "data", "forever", build, "classes", `${c}.json`), "utf8"));
  for (const t of ours[c].specs.flatMap((s) => s.talents)) if (t.iconFileDataId) need.add(t.iconFileDataId);
}
const abilities = {};
for (const c of classes) {
  abilities[c] = JSON.parse(fs.readFileSync(join(root, "data", "forever", build, "abilities", `${c}.json`), "utf8"));
  for (const a of abilities[c].abilities) if (a.iconFileDataId) need.add(a.iconFileDataId);
}
const path = new Map();
for (const line of fs.readFileSync(listfile, "utf8").split(/\r?\n/)) {
  const i = line.indexOf(";");
  if (i < 0) continue;
  const id = Number(line.slice(0, i));
  if (need.has(id)) path.set(id, line.slice(i + 1));
}
const baseName = (p) => (p ?? "").split("/").pop().replace(/\.blp\.?$/i, "").replace(/\.$/, "").toLowerCase();
let n = 0;
let same = 0;
const diff = [];
for (const c of classes) {
  const tf = JSON.parse(fs.readFileSync(join(root, "data", "external", "talentsforever", `${c}.json`), "utf8")).talents.trees;
  tf.forEach((tree, si) => {
    for (const t of tree.talents) {
      const o = ours[c].specs[si].talents.find((x) => x.row === t.row - 1 && x.col === t.col - 1);
      if (!o) continue;
      n++;
      if (baseName(path.get(o.iconFileDataId)) === String(t.icon).toLowerCase()) same++;
      else diff.push(`${c} ${tree.name}|${t.name}: La referencia ${t.icon} vs cliente ${baseName(path.get(o.iconFileDataId)) || o.iconFileDataId} (talento del cliente: ${o.name})`);
    }
  });
}
console.log(`Iconos de talentos: ${same} de ${n} coinciden con la referencia`);
for (const d of diff) console.log(`   ${d}`);

// Habilidades: La referencia da el icono por nombre de habilidad (spellbook.icons) y el hechizo por id (spell_desc)
let na = 0;
let sameA = 0;
const diffA = [];
for (const c of classes) {
  const tf = JSON.parse(fs.readFileSync(join(root, "data", "external", "talentsforever", `${c}.json`), "utf8"));
  const icons = tf.spellbook.icons ?? {};
  const byId = new Map();
  for (const a of abilities[c].abilities) for (const r of a.ranks) byId.set(r.spellId, a);
  const seen = new Set();
  for (const [key, v] of Object.entries(tf.spell_desc)) {
    const name = key.split("|")[1];
    if (seen.has(name) || !v.id) continue;
    seen.add(name);
    const a = byId.get(v.id);
    if (!a || !icons[name]) continue;
    na++;
    if (baseName(path.get(a.iconFileDataId)) === String(icons[name]).toLowerCase()) sameA++;
    else diffA.push(`${c} ${name}: La referencia ${icons[name]} vs cliente ${baseName(path.get(a.iconFileDataId)) || a.iconFileDataId} (${a.name})`);
  }
}
console.log(`Iconos de habilidades: ${sameA} de ${na} coinciden con la referencia`);
for (const d of diffA) console.log(`   ${d}`);
