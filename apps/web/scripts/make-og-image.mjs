// Imágenes para compartir enlaces (Open Graph / Twitter), 1200x630: logo y nombre sobre el fondo oscuro de la web.
// Se ejecuta a mano cuando cambia el logo o las clases: node scripts/make-og-image.mjs
// Escribe public/og-image.png (general) y public/og/<es|en>/<clase>.png (una por clase e idioma, con el color de la clase).
// Los nombres en español salen de public/data/manifest.json (se genera con `npm run sync-data`).
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;
const logo = await sharp(join(root, "public/logo-forever-transparent.png")).resize(360, 360).toBuffer();

const CLASS_COLORS = { warrior: "#c79c6e", paladin: "#f58cba", hunter: "#abd473", rogue: "#fff569", priest: "#ffffff", shaman: "#0070de", mage: "#69ccf0", warlock: "#9482c9", druid: "#ff7d0a" };
const CLASS_EN = { warrior: "Warrior", paladin: "Paladin", hunter: "Hunter", rogue: "Rogue", priest: "Priest", shaman: "Shaman", mage: "Mage", warlock: "Warlock", druid: "Druid" };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const frame = (glow, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="26%" cy="50%" r="55%"><stop offset="0" stop-color="${glow}" stop-opacity="0.22"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#0e0c0a"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="#463c2a" stroke-width="2" rx="18"/>
${body}
</svg>`;

async function write(svg, file) {
  mkdirSync(dirname(file), { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 4, background: "#0e0c0a" } })
    .composite([{ input: Buffer.from(svg) }, { input: logo, left: 110, top: 135 }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(file);
  console.log(file.replace(`${root}\\`, "").replace(`${root}/`, ""));
}

await write(
  frame(
    "#e0b04a",
    `  <text x="520" y="270" font-family="${SERIF}" font-size="80" font-weight="700" fill="#f4cf7a">WoW Forever</text>
  <text x="520" y="350" font-family="${SERIF}" font-size="52" fill="#f1ead9">Ultimate Calculator</text>
  <text x="520" y="430" font-family="${SANS}" font-size="30" fill="#b0a590">Talents · Races · Gear · Abilities</text>
  <text x="520" y="476" font-family="${SANS}" font-size="30" fill="#b0a590">Talentos · Razas · Equipo · Habilidades</text>`,
  ),
  join(root, "public/og-image.png"),
);

const manifest = JSON.parse(readFileSync(join(root, "public/data/manifest.json"), "utf8"));
const SUBTITLE = { es: "Calculadora de talentos, equipo y habilidades", en: "Talent, gear and ability calculator" };
for (const c of manifest.classes) {
  const token = c.file.replace(/^classes\//, "").replace(/\.json$/, "");
  const color = CLASS_COLORS[token];
  if (!color) throw new Error(`Falta el color de la clase ${token}`);
  for (const lang of ["es", "en"]) {
    const name = escape(lang === "es" ? c.className : CLASS_EN[token]);
    await write(
      frame(
        color,
        `  <text x="520" y="230" font-family="${SERIF}" font-size="52" font-weight="700" fill="#f4cf7a">WoW Forever</text>
  <text x="520" y="350" font-family="${SERIF}" font-size="${name.length > 9 ? 104 : 120}" font-weight="700" fill="${color}">${name}</text>
  <text x="520" y="425" font-family="${SANS}" font-size="28" fill="#f1ead9">${SUBTITLE[lang]}</text>
  <text x="520" y="476" font-family="${SANS}" font-size="30" fill="#b0a590">${lang === "es" ? "Talentos · Razas · Equipo · Habilidades" : "Talents · Races · Gear · Abilities"}</text>`,
      ),
      join(root, "public/og", lang, `${token}.png`),
    );
  }
}
