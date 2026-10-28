// Spike de datos de Equipo (sesion 6): comprueba con objetos de referencia que las tablas de objetos
// del cliente (data/raw/<build>-hotfix, ver ITEMS=1 en export-tables.sh) reproducen sus tooltips.
// Solo lee CSV del repositorio. Uso: node tools/extract/items-spike.mjs [build]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { parse } = createRequire(root + "packages/data-pipeline/package.json")("csv-parse/sync");
const build = process.argv[2] ?? "1.60.1.70658";
const dir = `${root}data/raw/${build}-hotfix/`;
const T = (n) => parse(readFileSync(dir + n + ".csv"), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
const by = (arr, f) => { const m = {}; for (const x of arr) { const k = f(x); m[k] = (m[k] ?? 0) + 1; } return m; };
const S = [...Array(10).keys()];

const sparse = T("ItemSparse"), items = T("Item");
const sp = new Map(sparse.map((r) => [r.ID, r])), it = new Map(items.map((r) => [r.ID, r]));
const rpp = new Map(T("RandPropPoints").map((r) => [+r.ID, r]));
const dmg1h = new Map(T("ItemDamageOneHand").map((r) => [+r.ItemLevel, r]));

console.log(`Item ${items.length} | ItemSparse ${sparse.length} | Item sin ItemSparse ${items.filter((r) => !sp.has(r.ID)).length}`);
console.log("  sin ItemSparse por clase:", by(items.filter((r) => !sp.has(r.ID)), (r) => r.ClassID));
console.log("  gemas (clase 3):", items.filter((r) => r.ClassID === "3").length, "| con Gem_properties:", sparse.filter((r) => +r.Gem_properties).length, "| con SocketType:", sparse.filter((r) => +r["SocketType[0]"]).length);

// Estadistica = StatPercentEditor/10000 x presupuesto RandPropPoints[ilvl][calidad][cubo de ranura]
const bucket = (inv) => ({ 1: 0, 4: 0, 5: 0, 7: 0, 15: 0, 17: 0, 20: 0, 3: 1, 6: 1, 8: 1, 10: 1, 12: 1, 2: 2, 9: 2, 11: 2, 14: 2, 16: 2, 19: 2, 23: 2, 13: 3, 21: 3, 22: 3, 26: 4, 25: 4 })[inv];
const stats = (id) => {
  const s = sp.get(String(id)), r = rpp.get(+s.ItemLevel), q = +s.OverallQualityID;
  const col = q >= 4 ? "Epic" : q === 3 ? "Superior" : "Good";
  const budget = +r[`${col}[${bucket(+s.InventoryType)}]`];
  return { name: s.Display_lang, ilvl: s.ItemLevel, budget, stats: S.filter((i) => +s[`StatPercentEditor[${i}]`]).map((i) => [+s[`StatModifier_bonusStat[${i}]`], +(+s[`StatPercentEditor[${i}]`] * budget / 10000).toFixed(2)]) };
};
// Yelmo corazon de leon: Classic = +18 Fuerza, +2 % critico, +2 % impacto -> critico 28 (14/1 %), impacto 20 (10/1 %)
console.log("Yelmo corazon de leon (12640):", JSON.stringify(stats(12640)));
// Trueno furioso: Classic 57-107, 43,2 DPS (NO coincide si se usa ItemDamageOneHand)
const tf = sp.get("19019"), dps = +dmg1h.get(80)["Quality[5]"], avg = dps * +tf.ItemDelay / 1000, v = +tf.DmgVariance;
console.log(`Trueno furioso (19019): tabla ${dps.toFixed(2)} DPS -> ${(avg * (1 - v / 2)).toFixed(0)}-${(avg * (1 + v / 2)).toFixed(0)} (Classic: 57-107, 43,2 DPS)`);

const eq = sparse.filter((r) => ["2", "4"].includes(it.get(r.ID)?.ClassID) && +r.InventoryType);
console.log("equipables con ItemSparse:", eq.length, "| con estadisticas:", eq.filter((r) => S.some((i) => +r[`StatPercentEditor[${i}]`])).length, "| calidad:", by(eq, (r) => r.OverallQualityID));
console.log("tipos de estadistica sin nombre conocido (>= 57):", Object.keys(by(sparse.flatMap((r) => S.filter((i) => +r[`StatPercentEditor[${i}]`] && +r[`StatModifier_bonusStat[${i}]`] >= 57).map((i) => r[`StatModifier_bonusStat[${i}]`])), (x) => x)).join(" "));
const en = T("SpellItemEnchantment");
console.log("encantamientos:", en.length, "por tipo de Effect[0]:", by(en, (r) => r["Effect[0]"]));
console.log("conjuntos:", T("ItemSet").length, "| ItemSetSpell:", T("ItemSetSpell").length, "| ItemEffect:", T("ItemEffect").length, by(T("ItemEffect"), (r) => r.TriggerType));
