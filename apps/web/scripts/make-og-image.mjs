// Imagen para compartir enlaces (Open Graph / Twitter), 1200x630: logo y nombre sobre el fondo oscuro de la web.
// Se ejecuta a mano cuando cambia el logo: node scripts/make-og-image.mjs  (escribe public/og-image.png)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;
const logo = await sharp(join(root, "public/logo-forever-transparent.png")).resize(360, 360).toBuffer();
const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="26%" cy="50%" r="55%"><stop offset="0" stop-color="#e0b04a" stop-opacity="0.22"/><stop offset="1" stop-color="#e0b04a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#0e0c0a"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="#463c2a" stroke-width="2" rx="18"/>
  <text x="520" y="270" font-family="Georgia, 'Times New Roman', serif" font-size="80" font-weight="700" fill="#f4cf7a">WoW Forever</text>
  <text x="520" y="350" font-family="Georgia, 'Times New Roman', serif" font-size="52" fill="#f1ead9">Ultimate Calculator</text>
  <text x="520" y="430" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#b0a590">Talents · Races · Gear · Abilities</text>
  <text x="520" y="476" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#b0a590">Talentos · Razas · Equipo · Habilidades</text>
</svg>`);
await sharp({ create: { width: W, height: H, channels: 4, background: "#0e0c0a" } })
  .composite([{ input: text }, { input: logo, left: 110, top: 135 }])
  .png({ compressionLevel: 9 })
  .toFile(join(root, "public/og-image.png"));
console.log("public/og-image.png");
