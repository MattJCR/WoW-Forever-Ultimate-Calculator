// Pruebas del conversor de modelos (`node --test tools/model/test`): formato glTF, lectores M2 y coherencia de los datos generados.
// Las de datos se saltan si `data/models/<build>/` no existe (no se versiona en todos los entornos). No tocan el cliente.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FLOAT, GlbBuilder, USHORT } from "../glb.mjs";
import { parseM2, parseParticles, parseSkin, readChunks, readTrack } from "../m2.mjs";
import { SCENES } from "../scenes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = process.env.BUILD ?? "1.60.1.70685";
const MODELS = path.join(ROOT, "data", "models", BUILD);

/** Lee un .glb: cabecera, chunk JSON y chunk binario. Lanza si no es un glTF binario bien formado. */
function readGlb(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  assert.equal(buf.readUInt32LE(4), 2);
  assert.equal(buf.readUInt32LE(8), buf.length, "la longitud de la cabecera no es la del fichero");
  const jsonLen = buf.readUInt32LE(12);
  assert.equal(buf.toString("ascii", 16, 20), "JSON");
  assert.equal(jsonLen % 4, 0, "el chunk JSON debe estar alineado a 4 bytes");
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const binAt = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binAt);
  assert.equal(buf.toString("ascii", binAt + 4, binAt + 7), "BIN");
  assert.equal(binAt + 8 + binLen, buf.length);
  return { json, bin: buf.subarray(binAt + 8, binAt + 8 + binLen) };
}

/** Todas las vistas y accesores de un glTF caen dentro del buffer y respetan la alineación. */
function assertConsistent({ json, bin }) {
  assert.equal(json.buffers[0].byteLength, bin.length);
  for (const v of json.bufferViews) {
    assert.ok(v.byteOffset + v.byteLength <= bin.length, "una vista se sale del buffer");
    assert.equal(v.byteOffset % 4, 0, "vista sin alinear a 4 bytes");
  }
  const sizes = { 5126: 4, 5121: 1, 5123: 2, 5125: 4 };
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  for (const a of json.accessors) {
    const v = json.bufferViews[a.bufferView];
    assert.ok(a.count * comps[a.type] * sizes[a.componentType] <= v.byteLength, "un accesor se sale de su vista");
  }
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      if (p.indices !== undefined) assert.ok(json.accessors[p.indices], "índices sin accesor");
      for (const a of Object.values(p.attributes)) assert.ok(json.accessors[a], "atributo sin accesor");
    }
  }
}

describe("glb.mjs: escritor de glTF binario", () => {
  it("escribe un glb válido y lo que se lee de vuelta es lo que se escribió", () => {
    const g = new GlbBuilder();
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const idx = new Uint16Array([0, 1, 2]);
    const a = g.accessor(pos, { type: "VEC3", componentType: FLOAT, target: ARRAY_BUFFER, min: [0, 0, 0], max: [1, 1, 0] });
    const i = g.accessor(idx, { type: "SCALAR", componentType: USHORT, target: ELEMENT_ARRAY_BUFFER });
    g.json.meshes.push({ primitives: [{ attributes: { POSITION: a }, indices: i }] });
    g.json.scenes[0].nodes.push(g.node({ mesh: 0 }));
    const glb = readGlb(g.toBuffer());
    assertConsistent(glb);
    assert.equal(glb.json.accessors[a].count, 3);
    const v = glb.json.bufferViews[glb.json.accessors[a].bufferView];
    const bytes = glb.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    assert.deepEqual([...new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))], [...pos]);
  });

  it("alinea a 4 bytes cada vista aunque los datos anteriores no lo estén", () => {
    const g = new GlbBuilder();
    g.view(new Uint8Array([1, 2, 3]));
    g.view(new Float32Array([1, 2]));
    const glb = readGlb(g.toBuffer());
    assert.deepEqual(glb.json.bufferViews.map((v) => v.byteOffset), [0, 4]);
    assertConsistent({ json: glb.json, bin: glb.bin });
  });
});

describe("m2.mjs: lectores de formato", () => {
  it("readChunks separa los chunks por su etiqueta y respeta los repetidos", () => {
    const chunk = (id, bytes) => Buffer.concat([Buffer.from(id, "ascii"), Buffer.from(new Uint32Array([bytes.length]).buffer), Buffer.from(bytes)]);
    const out = readChunks(Buffer.concat([chunk("MD21", [1, 2, 3]), chunk("SFID", [9]), chunk("SFID", [8, 7])]));
    assert.deepEqual(Object.keys(out), ["MD21", "SFID"]);
    assert.deepEqual([...out.MD21[0]], [1, 2, 3]);
    assert.deepEqual(out.SFID.map((b) => [...b]), [[9], [8, 7]]);
  });

  it("parseSkin lee vértices, índices y subgeometrías, y rechaza lo que no es un .skin", () => {
    // Cabecera: SKIN + 5 tablas (cuenta, desplazamiento): vértices, índices, huesos, secciones, lotes
    const buf = Buffer.alloc(200);
    buf.write("SKIN", 0, "ascii");
    const put = (o, count, offset) => {
      buf.writeUInt32LE(count, o);
      buf.writeUInt32LE(offset, o + 4);
    };
    put(4, 2, 100);
    put(12, 3, 104);
    put(20, 0, 0);
    put(28, 1, 112);
    put(36, 0, 0);
    buf.writeUInt16LE(5, 100);
    buf.writeUInt16LE(7, 102);
    [0, 1, 0].forEach((v, k) => buf.writeUInt16LE(v, 104 + k * 2));
    buf.writeUInt16LE(1501, 112); // id de la subgeometría
    buf.writeUInt16LE(2, 118); // vértices
    buf.writeUInt16LE(3, 122); // índices
    const skin = parseSkin(buf);
    assert.deepEqual(skin.vertices, [5, 7]);
    assert.deepEqual(skin.indices, [0, 1, 0]);
    assert.equal(skin.sections[0].id, 1501);
    assert.equal(skin.sections[0].vertexCount, 2);
    assert.equal(skin.sections[0].indexCount, 3);
    assert.throws(() => parseSkin(Buffer.alloc(64)), /SKIN/);
  });

  it("readTrack lee los tiempos y valores de una secuencia y deja fija la pista de secuencia global", () => {
    // Pista: interpolación(2) + secuencia global(2) + tiempos(cuenta, desplazamiento) + valores(cuenta, desplazamiento);
    // por secuencia, (cuenta, desplazamiento) de cada tabla
    const m = Buffer.alloc(256);
    const track = (globalSeq) => {
      m.writeUInt16LE(1, 0);
      m.writeInt16LE(globalSeq, 2);
      m.writeUInt32LE(1, 4);
      m.writeUInt32LE(40, 8);
      m.writeUInt32LE(1, 12);
      m.writeUInt32LE(56, 16);
      m.writeUInt32LE(2, 40);
      m.writeUInt32LE(100, 44);
      m.writeUInt32LE(2, 56);
      m.writeUInt32LE(120, 60);
      m.writeUInt32LE(0, 100);
      m.writeUInt32LE(1000, 104);
    };
    track(-1);
    // Traslación: dos vectores de tres números
    [1, 2, 3, 4, 5, 6].forEach((v, k) => m.writeFloatLE(v, 120 + k * 4));
    const pos = readTrack(m, 0, 0, "t", () => m);
    assert.deepEqual(pos.times, [0, 1000]);
    assert.equal(pos.comps, 3);
    assert.deepEqual(pos.values, [[1, 2, 3], [4, 5, 6]]);
    // Una secuencia que la pista no tiene no da pista
    assert.equal(readTrack(m, 0, 5, "t", () => m), null);
    track(3);
    const fixed = readTrack(m, 0, 0, "t", () => m);
    assert.deepEqual(fixed.times, [0], "la pista de secuencia global debe quedar fija en un solo instante");
    assert.deepEqual(fixed.values, [[1, 2, 3]]);
  });

  it("readTrack decodifica las rotaciones comprimidas a cuaterniones", () => {
    const m = Buffer.alloc(256);
    m.writeUInt16LE(1, 0);
    m.writeInt16LE(-1, 2);
    m.writeUInt32LE(1, 4);
    m.writeUInt32LE(40, 8);
    m.writeUInt32LE(1, 12);
    m.writeUInt32LE(56, 16);
    m.writeUInt32LE(1, 40);
    m.writeUInt32LE(100, 44);
    m.writeUInt32LE(1, 56);
    m.writeUInt32LE(120, 60);
    m.writeUInt32LE(0, 100);
    // 32767 = +1 y -32767 = -1 en la compresión de 16 bits de M2; 0 queda fuera de rango (no es un valor guardado)
    [32767, -32767, 32767, -32767].forEach((v, k) => m.writeInt16LE(v, 120 + k * 2));
    const rot = readTrack(m, 0, 0, "r", () => m);
    assert.equal(rot.comps, 4);
    assert.equal(rot.values[0].length, 4);
    assert.ok(rot.values[0].every((v) => Math.abs(v) <= 1.0001), "las componentes de un cuaternión están entre -1 y 1");
  });
});

describe("scenes.mjs: fondos de la selección de personaje", () => {
  it("cubren las 10 razas de Forever sin repetir ninguna ni ningún escenario", () => {
    const races = Object.values(SCENES)
      .flatMap((s) => s.races)
      .sort((a, b) => a - b);
    assert.deepEqual(races, [1, 2, 3, 4, 5, 6, 7, 8, 95, 96]);
    const ids = Object.values(SCENES).map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("datos generados (data/models)", { skip: !fs.existsSync(MODELS) }, () => {
  const listing = (dir) => fs.readdirSync(path.join(MODELS, dir));
  const isWebp = (file) => {
    const head = fs.readFileSync(file).subarray(0, 12);
    return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
  };

  it("hay 20 modelos de personaje (10 razas × 2 cuerpos), cada uno con su glb válido y su recorte de personalización", () => {
    const index = JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8"));
    assert.equal(index.length, 20);
    assert.deepEqual([...new Set(index.map((e) => e.race))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 95, 96]);
    for (const e of index) {
      const dir = path.join(MODELS, `m${e.chrModel}`);
      const glb = readGlb(fs.readFileSync(path.join(dir, "model.glb")));
      assertConsistent(glb);
      assert.ok(glb.json.skins?.length > 0, `m${e.chrModel}: sin esqueleto`);
      assert.ok(glb.json.animations?.length > 0, `m${e.chrModel}: sin animaciones`);
      const character = JSON.parse(fs.readFileSync(path.join(dir, "character.json"), "utf8"));
      assert.equal(character.chrModelId, e.chrModel);
    }
  });

  it("todos los modelos de objeto son glb válidos", () => {
    const files = listing("item").filter((f) => f.endsWith(".glb"));
    assert.ok(files.length > 3000);
    for (const f of files) assertConsistent(readGlb(fs.readFileSync(path.join(MODELS, "item", f))));
  });

  it("texturas, miniaturas y fondos son WebP", () => {
    for (const dir of ["tex", "bust", "scene"]) {
      const files = listing(dir).filter((f) => f.endsWith(".webp"));
      assert.ok(files.length > 0, dir);
      for (const f of files) assert.ok(isWebp(path.join(MODELS, dir, f)), `${dir}/${f} no es WebP`);
    }
  });

  it("cada escenario tiene su imagen y su glb", () => {
    const files = new Set(listing("scene"));
    for (const key of Object.keys(SCENES)) {
      assert.ok(files.has(`${key}.webp`), `falta scene/${key}.webp`);
      assert.ok(files.has(`${key}.glb`), `falta scene/${key}.glb`);
    }
  });

  it("cada objeto con apariencia apunta a una apariencia que existe y solo faltan las dos miniaturas conocidas", () => {
    const appearance = JSON.parse(fs.readFileSync(path.join(MODELS, "appearance.json"), "utf8"));
    for (const [item, display] of Object.entries(appearance.items)) assert.ok(appearance.display[display], `objeto ${item}: apariencia ${display} inexistente`);
    const busts = new Set(listing("bust"));
    const missing = Object.keys(appearance.display).filter((id) => !busts.has(`${id}.webp`));
    assert.deepEqual(missing.sort(), ["33431", "698986"], "objetos 240132 y 21127 sin miniatura (documentado en STATUS)");
  });
});

describe("efectos visuales de objetos (fx/)", () => {
  const FX = path.join(MODELS, "fx");
  const has = fs.existsSync(path.join(FX, "index.json"));

  it("el índice enlaza encantamientos y apariencias con efectos que existen", { skip: !has }, () => {
    const index = JSON.parse(fs.readFileSync(path.join(FX, "index.json"), "utf8"));
    assert.ok(Object.keys(index.enchant).length > 30 && Object.keys(index.display).length > 500);
    for (const v of [...Object.values(index.enchant), ...Object.values(index.display)]) assert.ok(index.visuals[v], `visual ${v} sin modelos`);
    for (const files of Object.values(index.visuals)) {
      assert.equal(files.length, 5);
      for (const f of files.filter(Boolean)) if (index.effects[f]) assert.match(index.effects[f], /^(p|m|pm)$/);
    }
    for (const [file, kind] of Object.entries(index.effects)) {
      if (kind.includes("p")) assert.ok(fs.existsSync(path.join(FX, `${file}.json`)), `falta fx/${file}.json`);
      if (kind.includes("m")) assert.ok(fs.existsSync(path.join(MODELS, "item", `${file}.glb`)), `falta item/${file}.glb`);
    }
  });

  it("los emisores son coherentes y sus texturas están en tex/", { skip: !has }, () => {
    const index = JSON.parse(fs.readFileSync(path.join(FX, "index.json"), "utf8"));
    const files = [...Object.keys(index.effects).filter((f) => index.effects[f].includes("p")), ...index.own];
    assert.ok(files.length > 300);
    for (const f of files) {
      const emitters = JSON.parse(fs.readFileSync(path.join(FX, `${f}.json`), "utf8"));
      assert.ok(emitters.length > 0);
      for (const e of emitters) {
        assert.ok(e.rate > 0 && e.life > 0, `${f}: tasa o vida no válidas`);
        assert.ok(e.color.length && e.alpha.length && e.scale.length, `${f}: faltan pistas de vida`);
        for (const [t] of [...e.color, ...e.alpha, ...e.scale]) assert.ok(t >= 0 && t <= 1);
        assert.ok(e.rows >= 1 && e.cols >= 1);
        assert.ok(e.tex === 0 || fs.existsSync(path.join(MODELS, "tex", `${e.tex}.webp`)), `${f}: falta la textura ${e.tex}`);
      }
    }
  });

  it("lee los emisores de un M2 real (fuego de «Arma candente»: un emisor plano, mezcla aditiva y color que va del rojo al ámbar)", { skip: !fs.existsSync(path.join(ROOT, ".tools", "model-cache", "166011.bin")) }, () => {
    const m2 = parseM2(fs.readFileSync(path.join(ROOT, ".tools", "model-cache", "166011.bin")));
    const [e] = parseParticles(m2);
    assert.ok(e);
    assert.equal(e.emitter, 1);
    assert.equal(e.blend, 4);
    assert.deepEqual(e.color[0].map(Math.round), [0, 195, 14, 0]);
    assert.equal(e.lifespan[0], 1);
  });
});
