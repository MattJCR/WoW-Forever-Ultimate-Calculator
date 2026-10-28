// Retratos de cada raza y sexo (cara de frente, ligeramente girada) para el paso Raza y el probador.
// Necesita la web en marcha (npm run dev -w @wfuc/web) y Chrome instalado. Solo escribe en data/models/<build>/race/.
// Uso: node tools/model/render-races.mjs [--sheet=hoja.png] [--url=http://localhost:5173] [--size=128]
//   --sheet: en vez de guardar, deja una hoja de contacto de todos los modelos para ajustar el encuadre (FRAMING).
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
const SIZE = Number(arg("size", 128));
const sheet = arg("sheet");

/** Encuadre por modelo de personaje (ChrModel.ID): giro, aumento y cuánto se baja la mirada desde el anclaje del casco (en alturas). */
const DEFAULT = { yaw: 0.35, zoom: 1.3, lift: 0 };
const FRAMING = { 1: { zoom: 1.05 }, 7: { zoom: 1.1 }, 3: { zoom: 1 }, 9: { zoom: 1.5, lift: 0.03 }, 10: { zoom: 1.7 }, 11: { zoom: 1 }, 12: { zoom: 0.6 }, 15: { zoom: 1.9, lift: 0.02 }, 16: { zoom: 2.2 }, 218: { zoom: 1.8 }, 219: { zoom: 1.5, lift: 0.03 } };

const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
const models = [...new Set(index.map((e) => e.chrModel))].map((m) => ({ m, race: index.find((e) => e.chrModel === m).race }));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
fs.mkdirSync(path.join(dir, "race"), { recursive: true });
const cells = [];
for (const { m, race } of models) {
  const f = { ...DEFAULT, ...FRAMING[m] };
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  await page.goto(`${URL_BASE}/bust-lab?m=${m}&r=${race}`);
  await page.waitForFunction(() => window.__bust, null, { timeout: 120000 });
  const url = await page.evaluate(([y, z, l]) => window.__bust.face(384, y, z, l), [f.yaw, f.zoom, f.lift]);
  await page.close();
  const png = Buffer.from(url.split(",")[1], "base64");
  if (sheet) {
    cells.push(await sharp(png).resize(200, 200).flatten({ background: "#2a2218" }).png().toBuffer());
    continue;
  }
  // Un fichero por modelo (los dos Cielonatos comparten modelo): la web lo busca por ChrModel.ID
  fs.writeFileSync(path.join(dir, "race", `${m}.webp`), await sharp(png).resize(SIZE, SIZE).webp({ quality: 85, alphaQuality: 90, effort: 4 }).toBuffer());
  console.log(`modelo ${m} (raza ${race})`);
}
if (sheet) {
  const cols = 6, rows = Math.ceil(cells.length / cols);
  await sharp({ create: { width: cols * 200, height: rows * 200, channels: 3, background: "#2a2218" } })
    .composite(cells.map((input, i) => ({ input, left: (i % cols) * 200, top: Math.floor(i / cols) * 200 }))).png().toFile(sheet);
  console.log(`hoja: ${models.map((x) => x.m).join(", ")} -> ${sheet}`);
}
await browser.close();
