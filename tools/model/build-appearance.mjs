// Apariencia de los objetos equipables: objeto -> ItemDisplayInfo -> geosets, texturas de seccion y modelos.
// Salida: data/models/<build>/appearance.json (lo lee el probador 3D en el paso Equipo).
// Uso: node tools/model/build-appearance.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD, indexBy, table } from "./tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const items = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "forever", BUILD, "items.json"), "utf8")).items;

const ima = indexBy("ItemModifiedAppearance", "ItemID");
const ia = indexBy("ItemAppearance", "ID");
const idi = indexBy("ItemDisplayInfo", "ID");
const sectionsBy = indexBy("ItemDisplayInfoMaterialRes", "ItemDisplayInfoID", { many: true });
const modelMatBy = indexBy("ItemDisplayInfoModelMatRes", "ItemDisplayInfoID", { many: true });
const texBy = indexBy("TextureFileData", "MaterialResourcesID", { many: true });
const texGender = indexBy("ComponentTextureFileData", "ID");
const modelBy = indexBy("ModelFileData", "ModelResourcesID", { many: true });
const modelGender = indexBy("ComponentModelFileData", "ID");
const num = (v) => Number(v);

/** Texturas de un recurso de material por sexo (0 varon, 1 mujer, 3 ambos). */
function texturesOf(resId) {
  const out = {};
  for (const t of texBy.get(String(resId)) ?? []) {
    if (t.UsageType !== "0") continue;
    const g = texGender.get(t.FileDataID);
    out[g ? num(g.GenderIndex) : 3] = num(t.FileDataID);
  }
  return out;
}

const out = { build: BUILD, items: {}, display: {}, tex: {}, model: {}, helm: {}, sheathe: {}, sheatheTransform: {} };
const transformBy = indexBy("TransformMatrix", "ID");
const sheatheBy = indexBy("Item", "ID");
const usedModels = new Set();

for (const it of items) {
  if (!it.inventoryType) continue;
  const m = ima.get(String(it.id));
  const a = m && ia.get(m.ItemAppearanceID);
  if (!a || a.ItemDisplayInfoID === "0") continue;
  const d = idi.get(a.ItemDisplayInfoID);
  if (!d) continue;
  out.items[it.id] = num(a.ItemDisplayInfoID);
  // Donde se envaina (1 dos manos a la espalda, 2 bastón, 3 una mano a la cadera, 4 escudo, 7 mano izquierda a la cadera)
  const sh = num(sheatheBy.get(String(it.id))?.SheatheType ?? 0);
  if (sh) out.sheathe[it.id] = sh;
  if (out.display[a.ItemDisplayInfoID]) continue;

  const rec = {};
  const g = [0, 1, 2, 3, 4, 5].map((i) => num(d[`GeosetGroup[${i}]`]));
  if (g.some((v) => v)) rec.g = g;
  const at = [0, 1, 2, 3, 4, 5].map((i) => num(d[`AttachmentGeosetGroup[${i}]`]));
  if (at.some((v) => v)) rec.a = at;
  const h = [num(d["HelmetGeosetVis[0]"]), num(d["HelmetGeosetVis[1]"])];
  if (h.some((v) => v)) rec.h = h;
  if (d.GeosetGroupOverride !== "0") rec.o = num(d.GeosetGroupOverride);
  // Ajuste del objeto envainado: [x, y, z, giro, cabeceo, alabeo (grados), escala] en ejes del M2 (TransformMatrix)
  const tm = d.SheatheTransformMatrixID !== "0" ? transformBy.get(d.SheatheTransformMatrixID) : undefined;
  if (tm) {
    rec.x = num(tm.ID);
    out.sheatheTransform[tm.ID] = [num(tm["Pos[0]"]), num(tm["Pos[1]"]), num(tm["Pos[2]"]), num(tm.Yaw), num(tm.Pitch), num(tm.Roll), num(tm.Scale)];
  }
  const secs = (sectionsBy.get(a.ItemDisplayInfoID) ?? []).map((r) => [num(r.ComponentSection), num(r.MaterialResourcesID)]);
  if (secs.length) {
    rec.s = secs;
    for (const [, res] of secs) out.tex[res] ??= texturesOf(res);
  }
  const models = [];
  for (let i = 0; i < 2; i++) {
    const mr = num(d[`ModelResourcesID[${i}]`]);
    const mat = num(d[`ModelMaterialResourcesID[${i}]`]);
    if (!mr && !mat) continue;
    models.push([mr, mat, num(d[`ModelType[${i}]`])]);
    if (mat) out.tex[mat] ??= texturesOf(mat);
    if (mr && !out.model[mr]) {
      out.model[mr] = (modelBy.get(String(mr)) ?? []).map((r) => {
        const c = modelGender.get(r.FileDataID);
        return { f: num(r.FileDataID), g: c ? num(c.GenderIndex) : 3, r: c ? num(c.RaceID) : 0, p: c ? num(c.PositionIndex) : -1 };
      });
      for (const x of out.model[mr]) usedModels.add(x.f);
    }
  }
  if (models.length) rec.m = models;
  // Texturas de los modelos que se enlazan por ItemDisplayInfoModelMatRes (varias por modelo).
  const mm = (modelMatBy.get(a.ItemDisplayInfoID) ?? []).map((r) => [num(r.ModelIndex), num(r.TextureType), num(r.MaterialResourcesID)]);
  if (mm.length) {
    rec.t = mm;
    for (const [, , res] of mm) out.tex[res] ??= texturesOf(res);
  }
  out.display[a.ItemDisplayInfoID] = rec;
}

// Que grupos de pelo/vello oculta un casco, por variante de casco y raza.
const helmIds = new Set();
for (const rec of Object.values(out.display)) if (rec.h) for (const v of rec.h) if (v) helmIds.add(String(v));
for (const r of table("HelmetGeosetData")) {
  if (!helmIds.has(r.HelmetGeosetVisDataID)) continue;
  ((out.helm[r.HelmetGeosetVisDataID] ??= {})[r.RaceID] ??= []).push(num(r.HideGeosetGroup));
}

const dir = path.join(ROOT, "data", "models", BUILD);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "appearance.json"), JSON.stringify(out));
console.log(`${Object.keys(out.items).length} objetos, ${Object.keys(out.display).length} apariencias, ${Object.keys(out.tex).length} recursos de textura, ${usedModels.size} modelos de objeto`);
console.log(`appearance.json: ${(fs.statSync(path.join(dir, "appearance.json")).size / 1024).toFixed(0)} KB`);
