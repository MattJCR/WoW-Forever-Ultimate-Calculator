// Descarga los iconos que necesita la web a data/forever/<build>/icons/<FileDataID>.png.
//
// Los iconos salen del cliente del juego (SOLO LECTURA) a traves de wow.tools.local, que debe estar
// arrancado en modo local (ver docs/EXTRACTION.md): GET /casc/blp2png?filedataid=N devuelve el PNG de 64x64.
// Esta herramienta nunca escribe en el cliente; solo hace peticiones HTTP a localhost y escribe en este repo.
//
// Uso: node tools/extract/fetch-icons.mjs [build] [--force]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const build = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? "1.60.1.70685";
const force = process.argv.includes("--force");
const dir = join(root, "data", "forever", build);
const outDir = join(dir, "icons");
const base = process.env.WTL_URL ?? "http://localhost:5000";

if (!existsSync(join(dir, "icons.json"))) {
  console.error(`No existe ${join(dir, "icons.json")}. Ejecuta antes: npm run pipeline`);
  process.exit(1);
}
const { ids } = JSON.parse(readFileSync(join(dir, "icons.json"), "utf8"));
mkdirSync(outDir, { recursive: true });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const todo = ids.filter((id) => force || !existsSync(join(outDir, `${id}.png`)));
console.log(`${ids.length} iconos necesarios, ${ids.length - todo.length} ya descargados, ${todo.length} por descargar`);

let ok = 0;
const failed = [];
async function one(id) {
  try {
    const res = await fetch(`${base}/casc/blp2png?filedataid=${id}`, { signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 100 || !buf.subarray(0, 4).equals(PNG)) throw new Error(`respuesta no valida (${res.status}, ${buf.length} B)`);
    writeFileSync(join(outDir, `${id}.png`), buf);
    ok++;
  } catch (e) {
    failed.push([id, e instanceof Error ? e.message : String(e)]);
  }
}

// 6 peticiones en paralelo
const queue = [...todo];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await one(id);
  }),
);

console.log(`Descargados: ${ok}. Fallidos: ${failed.length}.`);
for (const [id, why] of failed.slice(0, 20)) console.log(`  ${id}: ${why}`);
process.exit(failed.length ? 2 : 0);
