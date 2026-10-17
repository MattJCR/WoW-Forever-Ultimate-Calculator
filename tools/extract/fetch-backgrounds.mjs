// Descarga las texturas de fondo de los arboles de talentos (Interface/TALENTFRAME/<Fondo>-TopLeft|TopRight|BottomLeft|BottomRight)
// a data/forever/<build>/backgrounds/<Fondo>-<Parte>.png, a traves de wow.tools.local (SOLO LECTURA del cliente).
//
// Necesita la lista de nombres de ficheros de la propia herramienta (listfile.csv, "id;ruta") para pasar de nombre a FileDataID:
//   node tools/extract/fetch-backgrounds.mjs [build] --listfile <ruta>/listfile.csv
// Los nombres de fondo salen de los JSON de clase (spec.backgroundFile).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const build = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--listfile") ?? "1.60.1.70425";
const listfile = flag("listfile") ?? process.env.WTL_LISTFILE;
const base = process.env.WTL_URL ?? "http://localhost:5000";
if (!listfile || !existsSync(listfile)) {
  console.error("Indica la lista de ficheros de wow.tools.local: --listfile <ruta>/listfile.csv (o WTL_LISTFILE)");
  process.exit(1);
}

const dir = join(root, "data", "forever", build);
const names = new Set();
for (const f of readdirSync(join(dir, "classes"))) {
  const cls = JSON.parse(readFileSync(join(dir, "classes", f), "utf8"));
  for (const s of cls.specs) if (s.backgroundFile) names.add(s.backgroundFile);
}

const PARTS = ["TopLeft", "TopRight", "BottomLeft", "BottomRight"];
const wanted = new Map(); // ruta en minusculas -> { name, part }
for (const name of names) for (const part of PARTS) wanted.set(`interface/talentframe/${name}-${part}.blp`.toLowerCase(), { name, part });

const ids = new Map(); // `${name}-${part}` -> FileDataID
for (const line of readFileSync(listfile, "utf8").split("\n")) {
  const i = line.indexOf(";");
  if (i < 0) continue;
  const hit = wanted.get(line.slice(i + 1).trim().toLowerCase());
  if (hit) ids.set(`${hit.name}-${hit.part}`, Number(line.slice(0, i)));
}

const out = join(dir, "backgrounds");
mkdirSync(out, { recursive: true });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
let ok = 0;
const failed = [];
for (const [key, id] of ids) {
  const file = join(out, `${key}.png`);
  if (existsSync(file)) continue;
  try {
    const res = await fetch(`${base}/casc/blp2png?filedataid=${id}`, { signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !buf.subarray(0, 4).equals(PNG)) throw new Error(`respuesta no valida (${res.status})`);
    writeFileSync(file, buf);
    ok++;
  } catch (e) {
    failed.push([key, e instanceof Error ? e.message : String(e)]);
  }
}
const missing = [...wanted.values()].map((w) => `${w.name}-${w.part}`).filter((k) => !ids.has(k));
console.log(`${names.size} fondos; ${ids.size}/${wanted.size} partes encontradas; descargadas ${ok}; fallidas ${failed.length}; sin FileDataID ${missing.length}`);
for (const [k, why] of failed.slice(0, 10)) console.log(`  ${k}: ${why}`);
for (const k of missing.slice(0, 10)) console.log(`  sin id: ${k}`);
process.exit(failed.length ? 2 : 0);
