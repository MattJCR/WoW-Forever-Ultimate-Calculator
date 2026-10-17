// Descarga las estadisticas base de Classic Era (fuente "community", NO del cliente de Forever) y las guarda
// en data/external/classic-stats/classic-era.json. Solo escribe en el repo; no toca el cliente de WoW.
//
// Fuente: tablas `player_levelstats` (fuerza, agilidad, aguante, intelecto, espiritu por raza/clase/nivel 1-60) y
// `player_classlevelstats` (vida y mana base por clase/nivel) del servidor cmangos/mangos-classic (GPL-2.0),
// fijado a un commit para que sea reproducible. Los numeros son hechos del juego; no se copia codigo.
//
// Uso: node tools/extract/fetch-classic-stats.mjs [--file ruta/a/mangos.sql]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "7f98ba0f0b7b74b93c01741c7bd64ec457b427ee";
const URL = `https://raw.githubusercontent.com/cmangos/mangos-classic/${COMMIT}/sql/base/mangos.sql`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "data", "external", "classic-stats");

const argFile = process.argv.indexOf("--file");
const sql = argFile >= 0 ? readFileSync(process.argv[argFile + 1], "utf8") : await (await fetch(URL)).text();

function rowsOf(table, width) {
  const a = sql.indexOf(`INSERT INTO \`${table}\``);
  if (a < 0) throw new Error(`No se encuentra la tabla ${table}`);
  const b = sql.indexOf("UNLOCK TABLES", a);
  const re = new RegExp(`\\(${Array(width).fill("(\\d+)").join(",")}\\)`, "g");
  return [...sql.slice(a, b).matchAll(re)].map((m) => m.slice(1).map(Number));
}

const levelStats = {}; // raza -> clase -> [[fue, agi, aguante, int, esp] por nivel 1..60]
for (const [race, cls, level, str, agi, sta, int, spi] of rowsOf("player_levelstats", 8)) {
  ((levelStats[race] ??= {})[cls] ??= [])[level - 1] = [str, agi, sta, int, spi];
}
const classBase = {}; // clase -> { hp: [nivel 1..60], mana: [...] }
for (const [cls, level, hp, mana] of rowsOf("player_classlevelstats", 4)) {
  const c = (classBase[cls] ??= { hp: [], mana: [] });
  c.hp[level - 1] = hp;
  c.mana[level - 1] = mana;
}

for (const [race, classes] of Object.entries(levelStats))
  for (const [cls, list] of Object.entries(classes))
    if (list.length !== 60 || list.some((x) => !x)) throw new Error(`Raza ${race} clase ${cls}: faltan niveles`);

mkdirSync(outDir, { recursive: true });
const out = {
  source: "cmangos/mangos-classic sql/base/mangos.sql (player_levelstats, player_classlevelstats)",
  url: URL,
  commit: COMMIT,
  license: "GPL-2.0 (servidor); solo se usan cifras",
  note: "Classic Era 1.12, niveles 1-60. No es del cliente de WoW Forever: procedencia 'community'.",
  stats: ["str", "agi", "sta", "int", "spi"],
  levelStats,
  classBase,
};
writeFileSync(join(outDir, "classic-era.json"), `${JSON.stringify(out)}\n`);
writeFileSync(
  join(outDir, "ATTRIBUTION.md"),
  `# Estadisticas base de Classic Era

Fuente: [cmangos/mangos-classic](https://github.com/cmangos/mangos-classic) (GPL-2.0), \`sql/base/mangos.sql\` en el commit \`${COMMIT}\`:
tablas \`player_levelstats\` (fuerza, agilidad, aguante, intelecto y espiritu por raza, clase y nivel) y \`player_classlevelstats\`
(vida y mana base por clase y nivel). Se extraen solo las cifras con \`tools/extract/fetch-classic-stats.mjs\`.

**No son del cliente de WoW Forever** (ahi no existen, ver docs/DATA-FINDINGS.md): son los valores de Classic Era 1.12 y se usan
como estimacion (\`community\`) hasta que haya datos de Forever al 60 (la beta solo llega al nivel 30).
`,
);
console.log(`Razas ${Object.keys(levelStats).length}, combinaciones ${Object.values(levelStats).reduce((n, c) => n + Object.keys(c).length, 0)}, clases con vida/mana ${Object.keys(classBase).length} -> ${outDir}`);
