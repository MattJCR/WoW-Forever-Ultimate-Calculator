// Control de calidad: miniaturas del personaje base (sin equipo) de cada raza/sexo, encuadradas en una zona.
// Uso: node tools/model/render-base.mjs <zona: head|chest|legs|...> <salida.png> [modelo,modelo...]
// Necesita la web en marcha y Chrome instalado. Solo escribe el PNG indicado.
import fs from "node:fs";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { BUILD } from "./tables.mjs";

const [kind = "head", out = "base.png", list] = process.argv.slice(2);
const idx = JSON.parse(fs.readFileSync(`data/models/${BUILD}/index.json`, "utf8"));
const models = (list ? list.split(",").map(Number) : [...new Set(idx.map((e) => e.chrModel))]).map((m) => ({ m, race: idx.find((e) => e.chrModel === m)?.race ?? 1 }));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const cells = [];
for (const { m, race } of models) {
  const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
  await page.goto(`http://localhost:5173/#/bust-lab?m=${m}&r=${race}`);
  await page.waitForFunction(() => window.__bust, null, { timeout: 120000 });
  const url = await page.evaluate((k) => window.__bust.base(k), kind);
  cells.push(await sharp(Buffer.from(url.split(",")[1], "base64")).resize(200, 200).flatten({ background: "#2a2218" }).png().toBuffer());
  await page.close();
}
const cols = Math.min(6, cells.length), rows = Math.ceil(cells.length / cols);
await sharp({ create: { width: cols * 200, height: rows * 200, channels: 3, background: "#2a2218" } })
  .composite(cells.map((input, i) => ({ input, left: (i % cols) * 200, top: Math.floor(i / cols) * 200 }))).png().toFile(out);
await browser.close();
console.log(`${cells.length} modelos -> ${out}`);
