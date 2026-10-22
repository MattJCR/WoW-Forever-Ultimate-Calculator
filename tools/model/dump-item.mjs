import fs from "node:fs";
import { table, indexBy, BUILD } from "./tables.mjs";
const items = JSON.parse(fs.readFileSync(`data/forever/${BUILD}/items.json`, "utf8")).items;
const ima = indexBy("ItemModifiedAppearance", "ItemID"), ia = indexBy("ItemAppearance", "ID"), idi = indexBy("ItemDisplayInfo", "ID");
const mats = indexBy("ItemDisplayInfoMaterialRes", "ItemDisplayInfoID", { many: true });
const tfd = indexBy("TextureFileData", "MaterialResourcesID", { many: true });
const ctfd = indexBy("ComponentTextureFileData", "ID");
const want = process.argv.slice(2);
for (const w of want) {
  const it = isNaN(Number(w)) ? items.find((i) => i.name.toLowerCase().includes(w.toLowerCase()) && ima.has(String(i.id))) : items.find((i) => i.id === Number(w));
  if (!it) { console.log(w, "no encontrado"); continue; }
  const m = ima.get(String(it.id)); const a = m && ia.get(m.ItemAppearanceID); const d = a && idi.get(a.ItemDisplayInfoID);
  console.log(`\n== ${it.id} ${it.name} inv=${it.inventoryType} class=${it.classId}/${it.subclassId} display=${a?.ItemDisplayInfoID} dtype=${a?.DisplayType}`);
  if (!d) continue;
  const nz = Object.entries(d).filter(([k, v]) => v !== "0" && v !== "-1" && k !== "ID");
  console.log(nz.map(([k, v]) => `${k}=${v}`).join(" "));
  for (const r of mats.get(a.ItemDisplayInfoID) ?? []) {
    const files = (tfd.get(r.MaterialResourcesID) ?? []).map((t) => { const c = ctfd.get(t.FileDataID); return `${t.FileDataID}(u${t.UsageType}${c ? ` g${c.GenderIndex} c${c.ClassID} r${c.RaceID}` : ""})`; });
    console.log(`  section ${r.ComponentSection}: res ${r.MaterialResourcesID} -> ${files.join(" ")}`);
  }
}
