import { table, indexBy } from "./tables.mjs";
const modelId = process.argv[2] ?? "1";
const opts = table("ChrCustomizationOption").filter((o) => o.ChrModelID === modelId).sort((a, b) => a.OrderIndex - b.OrderIndex);
const choicesBy = indexBy("ChrCustomizationChoice", "ChrCustomizationOptionID", { many: true });
const elemBy = indexBy("ChrCustomizationElement", "ChrCustomizationChoiceID", { many: true });
const geo = indexBy("ChrCustomizationGeoset", "ID");
const mat = indexBy("ChrCustomizationMaterial", "ID");
const skinned = indexBy("ChrCustomizationSkinnedModel", "ID");
for (const o of opts) {
  const ch = (choicesBy.get(o.ID) ?? []).sort((a, b) => a.OrderIndex - b.OrderIndex);
  console.log(`\n# opt ${o.ID} "${o.Name_lang}" type=${o.OptionType} cat=${o.ChrCustomizationCategoryID} choices=${ch.length} flags=${o.Flags}`);
  for (const c of ch.slice(0, Number(process.argv[3] ?? 3))) {
    const els = elemBy.get(c.ID) ?? [];
    console.log(`  choice ${c.ID} "${c.Name_lang}" ord=${c.OrderIndex} req=${c.ChrCustomizationReqID}`, els.map((e) => {
      const g = geo.get(e.ChrCustomizationGeosetID); const m = mat.get(e.ChrCustomizationMaterialID); const s = skinned.get(e.ChrCustomizationSkinnedModelID);
      return `[${g ? `geo ${g.GeosetType}/${g.GeosetID}` : ""}${m ? ` mat tgt${m.ChrModelTextureTargetID}=res${m.MaterialResourcesID}` : ""}${s ? ` skinned ${s.CollectionsFileDataID} g${s.GeosetType}/${s.GeosetID}` : ""}${e.ChrCustomizationBoneSetID !== "0" ? ` bone${e.ChrCustomizationBoneSetID}` : ""}]`;
    }).join(" "));
  }
}
