// Descarga las tablas del juego en inglés (nombres y textos de hechizos, objetos, conjuntos, rasgos) de una exportación pública
// del MISMO juego y las deja, recortadas a las columnas que usamos, en data/external/enus/. No toca el cliente.
// Uso: ENUS_TABLES_URL="https://…/db2/{table}/csv?build={build}" node tools/extract/fetch-enus-tables.mjs [build]
//   {table} y {build} se sustituyen; el build por defecto es el más reciente de Forever que publique la exportación.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const template = process.env.ENUS_TABLES_URL;
if (!template || !template.includes("{table}") || !template.includes("{build}")) {
  console.error('Falta ENUS_TABLES_URL con {table} y {build}, p. ej. "https://…/db2/{table}/csv?build={build}"');
  process.exit(1);
}
const build = process.argv[2] ?? "1.60.1.70532";
const out = resolve(import.meta.dirname, "../../data/external/enus");
mkdirSync(out, { recursive: true });

/** Tabla -> columnas que se conservan (la primera es siempre el id). */
const TABLES = {
  SpellName: ["ID", "Name_lang"],
  Spell: ["ID", "NameSubtext_lang", "Description_lang", "AuraDescription_lang"],
  ItemSparse: ["ID", "Display_lang"],
  TraitDefinition: ["ID", "SpellID", "OverrideName_lang", "OverrideSubtext_lang", "OverrideDescription_lang"],
  ItemSet: ["ID", "Name_lang"],
  SpellItemEnchantment: ["ID", "Name_lang"],
  ChrRaceRacialAbility: ["ID", "ChrRacesID", "Order", "Description_lang"],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const csvField = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

for (const [table, columns] of Object.entries(TABLES)) {
  const url = template.replace("{table}", table).replace("{build}", build);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  const header = rows[0];
  const idx = columns.map((c) => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error(`${table}: falta la columna ${c}`);
    return i;
  });
  const body = rows
    .slice(1)
    .filter((r) => r.length > 1)
    .map((r) => idx.map((i) => csvField(r[i] ?? "")).join(","));
  writeFileSync(resolve(out, `${table}.csv`), [columns.join(","), ...body].join("\n") + "\n", "utf8");
  console.log(`${table}: ${body.length} filas`);
}
writeFileSync(resolve(out, "BUILD.txt"), `${build}\n`, "utf8");
