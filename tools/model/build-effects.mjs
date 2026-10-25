// Efectos visuales de objetos: brillos de armas, encantamientos y partículas propias de los modelos.
// Salida en data/models/<build>/fx/: index.json (qué efecto lleva cada encantamiento / apariencia / modelo) y un
// <FileDataID>.json por modelo con sus emisores de partículas. Las mallas de efecto van a item/<id>.glb y las texturas a tex/.
// Uso: node tools/model/build-effects.mjs   (con wow.tools.local arrancado; solo lee del cliente)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFile, fetchWebp } from "./casc.mjs";
import { parseM2, parseParticles } from "./m2.mjs";
import { BUILD, table } from "./tables.mjs";
import { buildItemModel } from "./build-item-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(ROOT, "data", "models", BUILD);
const fxDir = path.join(dir, "fx");
fs.mkdirSync(fxDir, { recursive: true });
fs.mkdirSync(path.join(dir, "tex"), { recursive: true });
const num = Number;

/** Ejes de WoW (x adelante, y izquierda, z arriba) a glTF (y arriba, z adelante, x izquierda), como el conversor de modelos. */
const P = ([x, y, z]) => [y, z, x];
const r4 = (v) => Math.round(v * 10000) / 10000;

// 1. Qué efecto lleva cada cosa
const visuals = {};
for (const r of table("ItemVisuals")) {
  const files = [0, 1, 2, 3, 4].map((i) => num(r[`ModelFileID[${i}]`]));
  if (files.some(Boolean)) visuals[r.ID] = files;
}
const enchant = {};
for (const r of table("SpellItemEnchantment")) if (r.ItemVisual !== "0" && visuals[r.ItemVisual]) enchant[r.ID] = num(r.ItemVisual);
const display = {};
for (const r of table("ItemDisplayInfo")) if (r.ItemVisual !== "0" && visuals[r.ItemVisual]) display[r.ID] = num(r.ItemVisual);

// 2. Modelos con efectos: los de ItemVisuals y los modelos de objeto que traen emisores propios
const effectFiles = new Set(Object.values(visuals).flat().filter(Boolean));
const itemDir = path.join(dir, "item");
const itemFiles = fs.existsSync(itemDir) ? fs.readdirSync(itemDir).filter((f) => f.endsWith(".glb")).map((f) => num(f.replace(".glb", ""))) : [];

/** Emisores de un modelo en el formato compacto que lee el visor (ejes de glTF, una sola secuencia, pistas de vida completas). La posición del emisor ya viene en el espacio del modelo (el pivote de su hueso coincide con ella). */
function emittersOf(m2) {
  const textureFile = (i) => {
    const t = m2.textures[i];
    return t && t.type === 0 ? (m2.fileIds.txid[i] ?? 0) : 0;
  };
  return parseParticles(m2).map((e) => {
    const first = (a, d = 0) => (a.length ? a[0] : d);
    return {
      pos: P(e.pos).map(r4),
      tex: textureFile(e.texture),
      blend: e.blend, shape: e.emitter, rows: e.rows, cols: e.cols,
      speed: r4(first(e.speed)), speedVar: r4(first(e.speedVar)), vertical: r4(first(e.vertical)), horizontal: r4(first(e.horizontal)),
      gravity: r4(first(e.gravity)), life: r4(first(e.lifespan, 1)), lifeVar: r4(e.lifespanVary), rate: r4(first(e.rate)),
      length: r4(first(e.length)), width: r4(first(e.width)),
      color: e.color.map(([t, r, g, b]) => [r4(t), Math.round(r), Math.round(g), Math.round(b)]),
      alpha: e.alpha.map(([t, a]) => [r4(t), r4(a)]),
      scale: e.scale.map(([t, x, y]) => [r4(t), r4(x), r4(y)]),
      scaleVar: e.scaleVary.map(r4),
      head: e.head.map(([t, c]) => [r4(t), c]),
      spin: r4(e.spin), spinVar: r4(e.spinVary), baseSpin: r4(e.baseSpin), baseSpinVar: r4(e.baseSpinVary),
      drag: r4(e.drag), flags: e.flags,
    };
  });
}

const index = { build: BUILD, visuals, enchant, display, effects: {}, own: [] };
const texFiles = new Set();
const meshModels = [];
let failed = 0;
const stats = { emitters: 0, models: 0 };

async function scan(file, own) {
  let m2;
  try { m2 = parseM2(await fetchFile(file)); } catch (e) { failed++; console.log(`modelo ${file}: ${e.message}`); return; }
  const em = emittersOf(m2).filter((e) => e.rate > 0 && e.color.length && e.scale.length);
  const hasMesh = !own && m2.vertices.count > 0;
  if (!em.length && !hasMesh) return;
  if (em.length) {
    fs.writeFileSync(path.join(fxDir, `${file}.json`), JSON.stringify(em));
    for (const e of em) if (e.tex) texFiles.add(e.tex);
    stats.emitters += em.length;
  }
  stats.models++;
  if (own) index.own.push(file);
  else index.effects[file] = (em.length ? "p" : "") + (hasMesh ? "m" : "");
  if (hasMesh) meshModels.push(file);
}

for (const f of [...effectFiles].sort((a, b) => a - b)) await scan(f, false);
for (const f of itemFiles.sort((a, b) => a - b)) if (!effectFiles.has(f)) await scan(f, true);

// 3. Mallas de efecto (llamas y brillos sueltos) como modelos de objeto estáticos: sus capas llevan la textura propia
for (const f of meshModels) {
  const dest = path.join(itemDir, `${f}.glb`);
  if (fs.existsSync(dest)) continue;
  try { fs.mkdirSync(itemDir, { recursive: true }); fs.writeFileSync(dest, await buildItemModel(f)); } catch (e) { failed++; console.log(`malla ${f}: ${e.message}`); }
  try {
    const b = fs.readFileSync(dest);
    const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
    for (const node of json.nodes) for (const t of node.extras?.batches ?? []) if (t.texFile) texFiles.add(t.texFile);
  } catch { /* sin malla legible */ }
}

// 4. Texturas
let nt = 0;
for (const f of texFiles) {
  const dest = path.join(dir, "tex", `${f}.webp`);
  if (fs.existsSync(dest)) continue;
  try { fs.writeFileSync(dest, await fetchWebp(f)); nt++; } catch (e) { failed++; console.log(`textura ${f}: ${e.message}`); }
}

fs.writeFileSync(path.join(fxDir, "index.json"), JSON.stringify(index));
console.log(`${Object.keys(visuals).length} visuales, ${Object.keys(enchant).length} encantamientos, ${Object.keys(display).length} apariencias; ${stats.models} modelos con efectos (${index.own.length} propios), ${stats.emitters} emisores, ${meshModels.length} mallas, ${texFiles.size} texturas (${nt} nuevas), ${failed} fallos`);
