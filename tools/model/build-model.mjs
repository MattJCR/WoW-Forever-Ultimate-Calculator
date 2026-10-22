// Convierte el modelo de una raza/sexo del cliente (M2 + skin + animacion) a un .glb.
// Uso: node tools/model/build-model.mjs <ChrModel.ID> [salida.glb]
// Requiere wow.tools.local arrancado (docs/EXTRACTION.md). Solo lee; escribe fuera del cliente.
import fs from "node:fs";
import path from "node:path";
import { fetchFile } from "./casc.mjs";
import { GlbBuilder, FLOAT, UBYTE, USHORT, ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER } from "./glb.mjs";
import { parseM2, parseSkin, readTrack } from "./m2.mjs";
import { indexBy } from "./tables.mjs";

/** Ejes de WoW (x adelante, y izquierda, z arriba) a glTF (y arriba, z adelante, x izquierda). */
const P = ([x, y, z]) => [y, z, x];

export async function findModelFile(chrModelId) {
  const chr = indexBy("ChrModel", "ID").get(String(chrModelId));
  if (!chr) throw new Error(`ChrModel ${chrModelId} no existe`);
  const disp = indexBy("CreatureDisplayInfo", "ID").get(chr.DisplayID);
  const cmd = indexBy("CreatureModelData", "ID").get(disp.ModelID);
  return { chr, fileId: Number(cmd.FileDataID) };
}

/** Una malla por subgeometria (geoset). Con `skinIdx` null el modelo es estatico (cascos, hombreras, armas). */
function addMeshes(g, m2, skin, V, skinIdx, opts = {}) {
  const nodes = [];
  const meshInfo = [];
  const used = new Map();
  const batchesBySection = new Map();
  for (const b of skin.batches) (batchesBySection.get(b.section) ?? batchesBySection.set(b.section, []).get(b.section)).push(b);

  skin.sections.forEach((s, si) => {
    const remap = new Map();
    const pos = [], nor = [], uv = [], bi = [], bw = [];
    const vert = (skinIdx2) => {
      let r = remap.get(skinIdx2);
      if (r !== undefined) return r;
      const v = skin.vertices[skinIdx2];
      r = remap.size;
      remap.set(skinIdx2, r);
      pos.push(...P([V.pos[v * 3], V.pos[v * 3 + 1], V.pos[v * 3 + 2]]));
      nor.push(...P([V.nor[v * 3], V.nor[v * 3 + 1], V.nor[v * 3 + 2]]));
      uv.push(V.uv[v * 2], V.uv[v * 2 + 1]);
      for (let k = 0; k < 4; k++) { bi.push(opts.boneMap ? (opts.boneMap[V.bi[v * 4 + k]] ?? 0) : V.bi[v * 4 + k]); bw.push(V.bw[v * 4 + k]); }
      return r;
    };
    const idx = [];
    for (let i = 0; i < s.indexCount; i++) idx.push(vert(skin.indices[s.indexStart + i]));
    if (!idx.length) return;
    // El orden de los triangulos de WoW es horario: se invierte para three.js.
    for (let i = 0; i + 2 < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }

    const attrs = {
      POSITION: g.accessor(new Float32Array(pos), { type: "VEC3", componentType: FLOAT, target: ARRAY_BUFFER, min: [0, 0, 0].map((_, k) => Math.min(...pos.filter((_, j) => j % 3 === k))), max: [0, 0, 0].map((_, k) => Math.max(...pos.filter((_, j) => j % 3 === k))) }),
      NORMAL: g.accessor(new Float32Array(nor), { type: "VEC3", componentType: FLOAT, target: ARRAY_BUFFER }),
      TEXCOORD_0: g.accessor(new Float32Array(uv), { type: "VEC2", componentType: FLOAT, target: ARRAY_BUFFER }),
      ...(skinIdx === null ? {} : {
        JOINTS_0: g.accessor(new Uint16Array(bi), { type: "VEC4", componentType: USHORT, target: ARRAY_BUFFER }),
        WEIGHTS_0: g.accessor(new Uint8Array(bw), { type: "VEC4", componentType: UBYTE, normalized: true, target: ARRAY_BUFFER }),
      }),
    };
    const indices = g.accessor(new Uint16Array(idx), { type: "SCALAR", componentType: USHORT, target: ELEMENT_ARRAY_BUFFER });
    const mesh = g.json.meshes.push({ primitives: [{ attributes: attrs, indices, mode: 4 }] }) - 1;

    const n = (used.get(s.id) ?? 0) + 1;
    used.set(s.id, n);
    const batches = (batchesBySection.get(si) ?? []).map((b) => {
      const tex = m2.textureLookup[b.textureCombo];
      return {
        texType: m2.textures[tex]?.type ?? -1, texFile: m2.fileIds.txid[tex] || 0, blend: m2.materials[b.material]?.blend ?? 0,
        shader: b.shader, layer: b.layer, priority: b.priority, textureCount: b.textureCount,
      };
    });
    // Las mallas de una coleccion (cuernos, plumas...) llevan una clave unica: fichero * 10000 + subgeometria.
    const key = opts.collection ? opts.collection * 10000 + s.id : s.id;
    const node = g.node({ name: n === 1 ? `geo_${key}` : `geo_${key}_${n}`, mesh, ...(skinIdx === null ? {} : { skin: skinIdx }), extras: { geoset: key, ...(opts.collection ? { collection: opts.collection } : {}), batches } });
    nodes.push(node);
    meshInfo.push({ geoset: key, vertices: remap.size, triangles: idx.length / 3, batches, ...(opts.collection ? { collection: opts.collection } : {}) });
  });

  return { nodes, meshInfo };
}

export async function buildModel(chrModelId, { sequenceIds = [0, 4, 5, 25, 26, 27, 28, 29, 30], collections = [] } = {}) {
  const { chr, fileId } = await findModelFile(chrModelId);
  const m2 = parseM2(await fetchFile(fileId));
  const skin = parseSkin(await fetchFile(m2.fileIds.skin[0]));
  const V = m2.readVertices();
  const g = new GlbBuilder();

  // Huesos
  const nBones = m2.bones.length;
  const boneNodes = m2.bones.map((b, i) => {
    const pp = b.parent >= 0 ? m2.bones[b.parent].pivot : [0, 0, 0];
    return g.node({ name: `bone_${i}`, translation: P(b.pivot.map((v, k) => v - pp[k])), extras: { key: b.keyBone } });
  });
  const roots = [];
  m2.bones.forEach((b, i) => {
    if (b.parent >= 0) (g.json.nodes[boneNodes[b.parent]].children ??= []).push(boneNodes[i]); else roots.push(boneNodes[i]);
  });
  // Colecciones (cuernos, plumas, cejas...): su esqueleto se une al del personaje por el hueso clave; los huesos
  // propios de la coleccion se anaden como articulaciones extra colgando del hueso al que siguen.
  const keyToMain = new Map(m2.bones.map((b, i) => [b.keyBone, i]).filter(([k]) => k >= 0));
  const joints = [...boneNodes];
  const extraPivots = [];
  const colData = [];
  for (const file of collections) {
    const cm2 = parseM2(await fetchFile(file));
    const cskin = parseSkin(await fetchFile(cm2.fileIds.skin[0]));
    const map = [];
    cm2.bones.forEach((b, i) => {
      if (b.keyBone >= 0 && keyToMain.has(b.keyBone)) { map[i] = keyToMain.get(b.keyBone); return; }
      const parentCol = b.parent >= 0 ? cm2.bones[b.parent] : null;
      const parentJoint = parentCol ? map[b.parent] : 0;
      const pp = parentCol ? parentCol.pivot : [0, 0, 0];
      const node = g.node({ name: `xbone_${file}_${i}`, translation: P(b.pivot.map((v, k) => v - pp[k])) });
      (g.json.nodes[joints[parentJoint] ?? boneNodes[0]].children ??= []).push(node);
      map[i] = joints.length;
      joints.push(node);
      extraPivots.push(b.pivot);
    });
    colData.push({ file, cm2, cskin, map, V: cm2.readVertices() });
  }
  const ibm = new Float32Array(joints.length * 16);
  const allPivots = [...m2.bones.map((b) => b.pivot), ...extraPivots];
  allPivots.forEach((pv, i) => {
    const [x, y, z] = P(pv);
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
  });
  const skinIdx = g.json.skins.push({ joints, inverseBindMatrices: g.accessor(ibm, { type: "MAT4", componentType: FLOAT }) }) - 1;
  g.json.skins[skinIdx].skeleton = roots[0];

  // Puntos de anclaje (mano, hombros, cabeza...) como nodos hijos de su hueso: att_<id>
  for (const at of m2.attachments) {
    const bone = m2.bones[at.bone];
    if (!bone) continue;
    const n = g.node({ name: `att_${at.id}`, translation: P(at.pos.map((v, k) => v - bone.pivot[k])) });
    (g.json.nodes[boneNodes[at.bone]].children ??= []).push(n);
  }
  const { nodes: meshNodes, meshInfo } = addMeshes(g, m2, skin, V, skinIdx);
  const sceneNodes = [...roots, ...meshNodes];
  for (const c of colData) {
    const r = addMeshes(g, c.cm2, c.cskin, c.V, skinIdx, { boneMap: c.map, collection: c.file });
    sceneNodes.push(...r.nodes);
    meshInfo.push(...r.meshInfo);
  }

  g.json.scenes[0].nodes = sceneNodes;

  // Animaciones incrustadas en el M2 (las demas viven en ficheros .anim aparte y no se usan aqui)
  const animations = [];
  const NAMES = { 0: "Stand", 25: "ReadyUnarmed", 26: "Ready1H", 27: "Ready2H", 28: "Ready2HL", 29: "ReadyBow", 30: "ReadyRifle", 4: "Walk", 5: "Run" };
  for (const id of sequenceIds) {
    const seqIndex = m2.sequences.findIndex((s) => s.id === id && s.variation === 0);
    const seq = m2.sequences[seqIndex];
    if (!seq || !(seq.flags & 0x20)) continue;
    const channels = [], samplers = [];
    const add = (node, path, times, values, comps, interp) => {
      const input = g.accessor(new Float32Array(times), { type: "SCALAR", componentType: FLOAT, min: [Math.min(...times)], max: [Math.max(...times)] });
      const output = g.accessor(new Float32Array(values.flat()), { type: comps === 4 ? "VEC4" : "VEC3", componentType: FLOAT });
      samplers.push({ input, output, interpolation: interp === 0 ? "STEP" : "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path } });
    };
    const data = () => m2.m;
    m2.bones.forEach((b, i) => {
      const pp = b.parent >= 0 ? m2.bones[b.parent].pivot : [0, 0, 0];
      const rel = b.pivot.map((v, k) => v - pp[k]);
      const t = readTrack(m2.m, b.trackAt.t, seqIndex, "t", data);
      const r = readTrack(m2.m, b.trackAt.r, seqIndex, "r", data);
      const s = readTrack(m2.m, b.trackAt.s, seqIndex, "s", data);
      if (t && t.values.length) add(boneNodes[i], "translation", t.times.map((x) => x / 1000), t.values.map((v) => P(v.map((c, k) => c + rel[k]))), 3, t.interpolation);
      if (r && r.values.length) add(boneNodes[i], "rotation", r.times.map((x) => x / 1000), r.values.map(([x, y, z, w]) => [...P([x, y, z]), w]), 4, r.interpolation);
      if (s && s.values.length) add(boneNodes[i], "scale", s.times.map((x) => x / 1000), s.values.map((v) => P(v)), 3, s.interpolation);
    });
    if (channels.length) {
      const name = NAMES[id] ?? `anim_${id}`;
      g.json.animations.push({ name, channels, samplers });
      animations.push({ name, id, duration: seq.duration, channels: channels.length });
    }
  }
  const animation = animations;

  return { glb: g.toBuffer(), info: { chrModelId, fileId, bones: nBones, geosets: meshInfo, animation, attachments: m2.attachments, textures: m2.textures, charLayout: Number(chr.CharComponentTextureLayoutID) } };
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/ /g, "%20")}`) {
  const id = Number(process.argv[2]);
  const out = process.argv[3] ?? `model-${id}.glb`;
  const { glb, info } = await buildModel(id);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, glb);
  console.log(`${out}: ${(glb.length / 1024).toFixed(0)} KB, ${info.bones} huesos, ${info.geosets.length} geosets, animacion:`, info.animation);
}

/** Modelo estatico de un objeto (casco, hombrera, arma, escudo): sin huesos ni animacion. */
export async function buildItemModel(fileId) {
  const m2 = parseM2(await fetchFile(fileId));
  const skin = parseSkin(await fetchFile(m2.fileIds.skin[0]));
  const g = new GlbBuilder();
  const { nodes, meshInfo } = addMeshes(g, m2, skin, m2.readVertices(), null);
  g.json.scenes[0].nodes = nodes;
  g.json.asset.extras = { attachments: m2.attachments, textures: m2.textures, geosets: meshInfo.length };
  return g.toBuffer();
}
