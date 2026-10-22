// Miniaturas 3D de los objetos (busto de cada pieza sobre un personaje base) para la galeria del paso Equipo.
// Necesita la web en marcha (npm run dev -w @wfuc/web) y Chrome instalado. Solo escribe en data/models/<build>/bust/.
// Uso: node tools/model/render-busts.mjs [--items=1624,3840 | --all] [--types=3,13] [--limit=N] [--workers=2] [--url=http://localhost:5173] [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { BUILD } from "./tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(ROOT, "data", "models", BUILD);
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const URL_BASE = arg("url", "http://localhost:5173");
const workers = Number(arg("workers", 2));
const limit = Number(arg("limit", 0));
const force = process.argv.includes("--force");

const ap = JSON.parse(fs.readFileSync(path.join(dir, "appearance.json"), "utf8"));
const items = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "forever", BUILD, "items.json"), "utf8")).items.map((i) => [i.id, i]));

const KIND = { 1: "head", 3: "shoulder", 4: "chest", 5: "chest", 20: "chest", 19: "chest", 6: "waist", 7: "legs", 8: "feet", 9: "wrist", 10: "hands", 16: "back" };
const OBJECT = new Set([13, 14, 15, 17, 21, 22, 23, 25, 26]);

// Un trabajo por apariencia (varios objetos comparten la misma)
const jobs = new Map();
const types = arg("types") ? arg("types").split(",").map(Number) : null;
const wanted = (process.argv.includes("--all") || !arg("items") ? Object.keys(ap.items) : arg("items").split(",")).filter((id) => !types || types.includes(items.get(Number(id))?.inventoryType));
for (const id of wanted) {
  const it = items.get(Number(id));
  const display = ap.items[id];
  if (!it || !display || jobs.has(display)) continue;
  if (!KIND[it.inventoryType] && !OBJECT.has(it.inventoryType)) continue;
  jobs.set(display, { display, itemId: it.id, inv: it.inventoryType });
}
fs.mkdirSync(path.join(dir, "bust"), { recursive: true });
let todo = [...jobs.values()].filter((j) => force || !fs.existsSync(path.join(dir, "bust", `${j.display}.webp`)));
if (limit) todo = todo.slice(0, limit);
console.log(`${jobs.size} apariencias, ${todo.length} por generar`);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let done = 0, fail = 0;
const t0 = Date.now();

async function worker(n) {
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  const open = async () => {
    await page.goto(`${URL_BASE}/#/bust-lab?m=1&r=1`);
    await page.reload();
    await page.waitForFunction(() => window.__bust, null, { timeout: 120000 });
  };
  await open();
  // Si la pagina se recarga (cambios en el codigo) o una pieza se cuelga, se reabre y se sigue
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo agotado")), ms))]);
  for (;;) {
    const j = todo.shift();
    if (!j) break;
    try {
      const url = await withTimeout(page.evaluate(([id, inv, kind]) => (kind ? window.__bust.armor(id, inv, kind) : window.__bust.object(id, inv)), [j.itemId, j.inv, KIND[j.inv] ?? null]), 30000);
      if (!url) { fail++; console.log(`sin imagen: objeto ${j.itemId} (apariencia ${j.display})`); continue; }
      const png = Buffer.from(url.split(",")[1], "base64");
      const webp = await sharp(png).resize(128, 128).webp({ quality: 82, alphaQuality: 90, effort: 4 }).toBuffer();
      fs.writeFileSync(path.join(dir, "bust", `${j.display}.webp`), webp);
      done++;
      if (done % 100 === 0) console.log(`${done} hechas (${fail} fallos), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    } catch (e) {
      fail++;
      console.log(`fallo objeto ${j.itemId}: ${String(e).slice(0, 120)}`);
      try { await open(); } catch { /* se reintenta con la siguiente */ }
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
await browser.close();
console.log(`listo: ${done} miniaturas, ${fail} fallos`);
