// Renderiza cada escenario de la pantalla de seleccion de personaje (ver build-scene.mjs) a una imagen de fondo vertical.
// Necesita la web en marcha (npm run dev -w @wfuc/web) y Chrome instalado. Solo escribe en data/models/<build>/scene/<nombre>.webp.
// Uso: node tools/model/render-scenes.mjs [--only=human,orc] [--url=http://localhost:5173] [--size=800x1200]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { BUILD } from "./tables.mjs";
import { SCENES } from "./scenes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(ROOT, "data", "models", BUILD, "scene");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const URL_BASE = arg("url", "http://localhost:5173");
const [W, H] = arg("size", "800x1200").split("x").map(Number);
const only = arg("only")?.split(",");

/** Encuadre de cada escenario: campo de vision vertical y desplazamientos de la camara original (en metros). */
const FRAMING = {
  human: { fov: 36 },
  dwarf: { fov: 34 },
  nightelf: { fov: 36 },
  gnome: { fov: 32 },
  orc: { fov: 38, ty: -0.3 },
  scourge: { fov: 32 },
  tauren: { fov: 36 },
  troll: { fov: 30 },
  skyborne: { fov: 28 },
};

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
for (const name of Object.keys(SCENES)) {
  if (only && !only.includes(name)) continue;
  await page.goto(`${URL_BASE}/#/scene-lab?s=${name}`);
  await page.reload();
  await page.waitForFunction(() => window.__scene || document.getElementById("scene-status")?.textContent?.startsWith("error"), null, { timeout: 120000 });
  const status = await page.evaluate(() => document.getElementById("scene-status").textContent);
  if (status !== "listo") { console.log(`${name}: ${status}`); continue; }
  const url = await page.evaluate(([w, h, o]) => window.__scene.render(w, h, o), [W, H, FRAMING[name] ?? {}]);
  const png = Buffer.from(url.split(",")[1], "base64");
  const webp = await sharp(png).webp({ quality: 80, effort: 5 }).toBuffer();
  fs.writeFileSync(path.join(dir, `${name}.webp`), webp);
  console.log(`${name}: ${(webp.length / 1024).toFixed(0)} KB`);
}
await browser.close();
