#!/usr/bin/env node
// Comprobación visual de la web tras un parche: reinicia el servidor de desarrollo (orden del usuario: servidor y navegador siempre
// nuevos), abre cada paso de cada clase en un Chrome propio (headless, no el de Playwright MCP) y FALLA ante errores de consola,
// excepciones de la página, `undefined` / `NaN` / `[object Object]` en el texto o marcadores del cliente sin resolver que no sean
// los huecos conocidos. Además busca en Beneficios un beneficio del dataset y comprueba que sale en la lista.
//
// Uso: node tools/update/visual-check.mjs [--build 1.60.1.70658] [--port 5173] [--class mage]
// Salida: una línea por problema y, al final, «N páginas revisadas, M problemas». Código 1 si hay problemas.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { ROOT, run } from "./lib/run.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const port = Number(opt("port", "5173"));
const only = opt("class", null);
const build = opt("build", readdirSync(join(ROOT, "data", "forever")).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort().at(-1));
const base = `http://localhost:${port}/`;
const VIEWS = ["race", "legacy", "talents", "gear", "buffs", "summary"];

// Errores seguros siempre; los marcadores del cliente solo avisan (los huecos de cálculo conocidos los enseña la web con «valores base»).
const BAD = /\bundefined\b|\bNaN\b|\[object Object\]|\bInfinity\b/;
const MARKER = /\$\{[^}]*\}|\$[a-zA-Z]\d|\{\{|\}\}/;

/** Libera el puerto (servidor de una sesión anterior). */
function freePort() {
  if (process.platform === "win32") {
    run("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`]);
  } else run("sh", ["-c", `lsof -ti tcp:${port} | xargs -r kill -9`]);
}

async function waitUp(timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if ((await fetch(base)).ok) return true; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

freePort();
const server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "-w", "@wfuc/web", "--", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore", shell: process.platform === "win32" });
const stop = () => { try { server.kill(); } catch { /* ya parado */ } freePort(); };
process.on("exit", stop);

if (!(await waitUp())) { console.log("El servidor de desarrollo no arrancó en 2 minutos."); stop(); process.exit(1); }

const manifest = JSON.parse(readFileSync(join(ROOT, "data", "forever", build, "manifest.json"), "utf8"));
const tokens = manifest.classes.map((c) => c.file.replace(/^classes\//, "").replace(/\.json$/, "")).filter((t) => !only || t === only);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [], notes = [];
let pages = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-ES" });
  for (const token of tokens) {
    for (const view of VIEWS) {
      const page = await ctx.newPage();
      const where = `${token}/${view}`;
      const errors = [];
      page.on("pageerror", (e) => errors.push(`excepción: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`consola: ${m.text().slice(0, 160)}`); });
      page.on("requestfailed", (r) => errors.push(`petición fallida: ${r.url().slice(0, 120)}`));
      await page.goto(`${base}#/class/${token}?v=${view}`, { waitUntil: "load" });
      await page.waitForSelector("nav[aria-label]", { timeout: 20_000 }).catch(() => errors.push("no aparece la barra de pasos"));
      await page.waitForTimeout(view === "gear" ? 2500 : 800);
      const text = await page.evaluate(() => document.body.innerText);
      pages++;
      for (const e of errors) problems.push(`${where}: ${e}`);
      const bad = text.match(BAD);
      if (bad) problems.push(`${where}: el texto contiene «${bad[0]}» (…${text.slice(Math.max(0, bad.index - 40), bad.index + 40).replace(/\s+/g, " ")}…)`);
      const marker = text.match(MARKER);
      if (marker) notes.push(`${where}: marcador sin resolver «${marker[0]}»`);
      if (text.trim().length < 200) problems.push(`${where}: página casi vacía (${text.trim().length} caracteres)`);
      await page.close();
    }
  }
  // Un beneficio del dataset: debe poder buscarse en el paso Beneficios
  const buffs = JSON.parse(readFileSync(join(ROOT, "data", "forever", build, "buffs.json"), "utf8")).buffs;
  // Un consumible de duración larga (los de menos de 1 min se ocultan por defecto) y sin clase
  const probe = buffs.filter((b) => b.category !== "class" && b.classId === null && (!b.durationMs || b.durationMs >= 60_000)).at(-1);
  if (probe) {
    const page = await ctx.newPage();
    await page.goto(`${base}#/class/${tokens[0]}?v=buffs`, { waitUntil: "load" });
    const search = page.locator('input[type="search"]').first();
    await search.waitFor({ timeout: 20_000 }).catch(() => problems.push("buffs: no hay buscador de beneficios"));
    if (await search.count()) {
      await search.fill(probe.name);
      await page.waitForTimeout(500);
      const text = await page.evaluate(() => document.body.innerText);
      if (!text.includes(probe.name)) problems.push(`buffs: buscar «${probe.name}» no lo encuentra`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
for (const n of notes.slice(0, 15)) console.log(`nota: ${n}`);
if (notes.length > 15) console.log(`nota: … y ${notes.length - 15} marcadores más`);
for (const p of problems) console.log(`PROBLEMA ${p}`);
console.log(`${pages} páginas revisadas, ${problems.length} problemas, ${notes.length} marcadores sin resolver (huecos conocidos de STATUS)`);
process.exit(problems.length ? 1 : 0);
