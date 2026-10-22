// Descarga ficheros del cliente por FileDataID desde wow.tools.local (solo lectura, en localhost).
// Guarda una copia en .tools/model-cache/ (ignorada por git) para no repetir peticiones.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE = path.join(ROOT, ".tools", "model-cache");
const BASE = process.env.WTL_URL ?? "http://localhost:5000";

export async function fetchFile(fileDataId) {
  const cached = path.join(CACHE, `${fileDataId}.bin`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const res = await fetch(`${BASE}/casc/fdid?filedataid=${fileDataId}`);
  if (!res.ok) throw new Error(`FileDataID ${fileDataId}: http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, buf);
  return buf;
}

/** Textura BLP convertida a PNG por la propia herramienta (tamano completo, sin reducir). */
export async function fetchPng(fileDataId) {
  const cached = path.join(CACHE, `${fileDataId}.png`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const res = await fetch(`${BASE}/casc/blp2png?filedataid=${fileDataId}`);
  if (!res.ok) throw new Error(`BLP ${fileDataId}: http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, buf);
  return buf;
}

/** Textura lista para publicar: BLP -> PNG -> WebP con perdida suave (el alfa se conserva). */
export async function fetchWebp(fileDataId) {
  const cached = path.join(CACHE, `${fileDataId}.webp`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const png = await fetchPng(fileDataId);
  const buf = await sharp(png).webp({ quality: 85, alphaQuality: 90, effort: 5 }).toBuffer();
  fs.writeFileSync(cached, buf);
  return buf;
}
