// Versiones ligeras del logo para el rendimiento de la web. Se ejecuta a mano cuando cambia el logo: node scripts/make-emblem.mjs
//   public/logo-forever-emblem.webp  emblema de fondo de todas las páginas (se ve al 7 % de opacidad y en gris: no necesita el PNG de 267 kB)
//   public/favicon.png               icono de la pestaña (64 px; el navegador lo pide en cada página)
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const source = join(pub, "logo-forever-transparent.png");

await sharp(source).resize(512, 512).webp({ quality: 55, alphaQuality: 60, effort: 6 }).toFile(join(pub, "logo-forever-emblem.webp"));
await sharp(source).resize(64, 64).png({ compressionLevel: 9 }).toFile(join(pub, "favicon.png"));

for (const f of ["logo-forever-emblem.webp", "favicon.png"]) console.log(`${f}: ${(statSync(join(pub, f)).size / 1024).toFixed(1)} kB`);
