// Receta de personaje de una raza/sexo: lo que el visor necesita ademas del .glb.
//   - disposicion del atlas de piel (secciones) y capas de textura por tipo de textura
//   - opciones de personalizacion (cara, pelo, piel...) con sus elecciones, geosets y materiales
// Uso: node tools/model/build-character.mjs <ChrModel.ID> [--textures=none|default|all] [--out=data/models/<build>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWebp } from "./casc.mjs";
import { buildModel } from "./build-model.mjs";
import { BUILD, indexBy, table } from "./tables.mjs";

/** Requisito tipo 2: la eleccion no la ofrece el juego a los jugadores (solo PNJ). */
const npcOnly = (reqId) => indexBy("ChrCustomizationReq", "ID").get(String(reqId))?.ReqType === "2";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** FileDataID de la textura (uso 0 = difusa) de un recurso de material. */
function textureOf(resId) {
  const rows = indexBy("TextureFileData", "MaterialResourcesID", { many: true }).get(String(resId)) ?? [];
  const d = rows.find((r) => r.UsageType === "0") ?? rows[0];
  return d ? Number(d.FileDataID) : 0;
}

export function buildRecipe(chrModelId) {
  const chr = indexBy("ChrModel", "ID").get(String(chrModelId));
  const layoutId = chr.CharComponentTextureLayoutID;
  const layout = indexBy("CharComponentTextureLayouts", "ID").get(layoutId);
  const sections = (indexBy("CharComponentTextureSections", "CharComponentTextureLayoutID", { many: true }).get(layoutId) ?? []).map((s) => ({
    type: Number(s.SectionType), x: Number(s.X), y: Number(s.Y), w: Number(s.Width), h: Number(s.Height),
  }));
  const materials = (indexBy("ChrModelMaterial", "CharComponentTextureLayoutsID", { many: true }).get(layoutId) ?? []).map((m) => ({
    type: Number(m.TextureType), width: Number(m.Width), height: Number(m.Height),
  }));
  const layers = (indexBy("ChrModelTextureLayer", "CharComponentTextureLayoutsID", { many: true }).get(layoutId) ?? [])
    .map((l) => ({
      textureType: Number(l.TextureType), layer: Number(l.Layer), blend: Number(l.BlendMode),
      sectionMask: Number(l.TextureSectionTypeBitMask), target: Number(l["ChrModelTextureTargetID[0]"]),
    }))
    .sort((a, b) => a.layer - b.layer);

  const choicesBy = indexBy("ChrCustomizationChoice", "ChrCustomizationOptionID", { many: true });
  const elemBy = indexBy("ChrCustomizationElement", "ChrCustomizationChoiceID", { many: true });
  const geoBy = indexBy("ChrCustomizationGeoset", "ID");
  const matBy = indexBy("ChrCustomizationMaterial", "ID");
  const skinnedBy = indexBy("ChrCustomizationSkinnedModel", "ID");
  const categories = indexBy("ChrCustomizationCategory", "ID");

  const options = table("ChrCustomizationOption")
    .filter((o) => o.ChrModelID === String(chrModelId))
    .sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex))
    .map((o) => ({
      id: Number(o.ID), name: o.Name_lang, category: Number(o.ChrCustomizationCategoryID),
      categoryName: categories.get(o.ChrCustomizationCategoryID)?.Name_lang ?? "",
      choices: (choicesBy.get(o.ID) ?? [])
        .sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex))
        .map((c) => ({
          id: Number(c.ID), name: c.Name_lang, req: Number(c.ChrCustomizationReqID), ...(npcOnly(c.ChrCustomizationReqID) ? { npc: true } : {}), swatch: Number(c["SwatchColor[0]"]) >>> 0,
          elements: (elemBy.get(c.ID) ?? []).map((e) => {
            const g = geoBy.get(e.ChrCustomizationGeosetID);
            const m = matBy.get(e.ChrCustomizationMaterialID);
            const s = skinnedBy.get(e.ChrCustomizationSkinnedModelID);
            const el = { related: Number(e.RelatedChrCustomizationChoiceID) };
            if (g) el.geoset = Number(g.GeosetType) * 100 + Number(g.GeosetID);
            if (g && g.GeosetType === "0") el.hair = true;
            if (m) el.material = { target: Number(m.ChrModelTextureTargetID), file: textureOf(m.MaterialResourcesID) };
            if (s) el.skinned = { file: Number(s.CollectionsFileDataID), type: Number(s.GeosetType), id: Number(s.GeosetID) };
            if (e.ChrCustomizationBoneSetID !== "0") el.boneSet = Number(e.ChrCustomizationBoneSetID);
            return el;
          }),
        })),
    }))
    .filter((o) => o.choices.length);

  return { chrModelId: Number(chrModelId), sex: Number(chr.Sex), layout: { width: Number(layout.Width), height: Number(layout.Height), sections }, materials, layers, options };
}

/** Misma regla que el visor (apps/web/src/viewer/recipe.ts › defaultChoice). */
function defaultChoice(o) {
  const players = o.choices.filter((c) => !c.npc);
  const colored = players.filter((c) => c.swatch !== 0);
  return (colored.length ? colored : players.length ? players : o.choices)[0];
}

/** FileDataID de texturas que aparecen en la receta (por defecto, solo la primera eleccion de cada opcion). */
export function recipeTextures(recipe, mode) {
  const ids = new Set();
  for (const o of recipe.options) {
    const list = mode === "all" ? o.choices : [defaultChoice(o)];
    for (const c of list) for (const e of c.elements) if (e.material?.file) ids.add(e.material.file);
  }
  for (const g of recipe.geosets ?? []) for (const b of g.batches) if (b.texFile) ids.add(b.texFile);
  return ids;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/ /g, "%20")}`) {
  const id = Number(process.argv[2]);
  const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
  const outRoot = path.resolve(ROOT, arg("out", path.join("data", "models", BUILD)));
  const mode = arg("textures", "default");
  const dir = path.join(outRoot, `m${id}`);
  fs.mkdirSync(path.join(outRoot, "tex"), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const recipe = buildRecipe(id);
  const collections = [...new Set(recipe.options.flatMap((o) => o.choices.flatMap((ch) => ch.elements.flatMap((e) => (e.skinned ? [e.skinned.file] : [])))))];
  const { glb, info } = await buildModel(id, { collections });
  recipe.geosets = info.geosets;
  recipe.attachments = info.attachments;
  recipe.fixedTextures = info.textures;
  fs.writeFileSync(path.join(dir, "model.glb"), glb);
  fs.writeFileSync(path.join(dir, "character.json"), JSON.stringify(recipe));
  let n = 0;
  if (mode !== "none") {
    for (const f of recipeTextures(recipe, mode)) {
      const dest = path.join(outRoot, "tex", `${f}.webp`);
      if (!fs.existsSync(dest)) { fs.writeFileSync(dest, await fetchWebp(f)); n++; }
    }
  }
  console.log(`m${id}: glb ${(glb.length / 1024).toFixed(0)} KB, ${recipe.options.length} opciones, ${recipe.geosets.length} geosets, ${n} texturas nuevas`);
}
