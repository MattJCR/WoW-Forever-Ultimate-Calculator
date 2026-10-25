// Lector de modelos M2 modernos (version 272: MD21 + chunks, .skin y .anim aparte).
// Solo lee bytes que ya se bajaron de wow.tools.local; no toca el cliente.
// Estructuras de https://wowdev.wiki (documentacion publica del formato).

/** Separa los chunks de un fichero MD21 (o devuelve el fichero tal cual si es MD20 clasico). */
export function readChunks(buf) {
  const chunks = {};
  let o = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    (chunks[id] ??= []).push(buf.subarray(o + 8, o + 8 + size));
    o += 8 + size;
  }
  return chunks;
}

const arr = (b, o) => ({ count: b.readUInt32LE(o), offset: b.readUInt32LE(o + 4) });

/** Cabecera + tablas planas del M2. `m` es el contenido del chunk MD21. */
export function parseM2(file) {
  const chunks = readChunks(file);
  const m = chunks.MD21[0];
  if (m.toString("ascii", 0, 4) !== "MD20") throw new Error("no es MD20");
  const version = m.readUInt32LE(4);
  let o = 8;
  const next = () => { const a = arr(m, o); o += 8; return a; };
  next(); // name
  const flags = m.readUInt32LE(o); o += 4;
  const H = {};
  for (const n of ["globalLoops", "sequences", "sequenceLookups", "bones", "keyBoneLookup", "vertices"]) H[n] = next();
  const numSkinProfiles = m.readUInt32LE(o); o += 4;
  for (const n of ["colors", "textures", "textureWeights", "textureTransforms", "replaceableTextureLookup", "materials",
    "boneLookup", "textureLookup", "textureUnitLookup", "transparencyLookup", "textureTransformsLookup"]) H[n] = next();
  o += 24 + 4 + 24 + 4; // boxes
  for (const n of ["collisionTriangles", "collisionVertices", "collisionNormals", "attachments", "attachmentLookup",
    "events", "lights", "cameras", "cameraLookup", "ribbons", "particles"]) H[n] = next();

  const u16 = (a) => Array.from({ length: a.count }, (_, i) => m.readUInt16LE(a.offset + i * 2));
  const out = { version, flags, numSkinProfiles, chunks, m };

  out.vertices = H.vertices;
  out.particleArray = H.particles;
  out.ribbonArray = H.ribbons;
  out.boneLookup = u16(H.boneLookup);
  out.textureLookup = u16(H.textureLookup);
  out.replaceableTextureLookup = u16(H.replaceableTextureLookup);
  out.transparencyLookup = u16(H.transparencyLookup);
  out.textureUnitLookup = u16(H.textureUnitLookup);
  out.keyBoneLookup = Array.from({ length: H.keyBoneLookup.count }, (_, i) => m.readUInt16LE(H.keyBoneLookup.offset + i * 2));
  out.textures = Array.from({ length: H.textures.count }, (_, i) => {
    const p = H.textures.offset + i * 16;
    return { type: m.readUInt32LE(p), flags: m.readUInt32LE(p + 4) };
  });
  out.materials = Array.from({ length: H.materials.count }, (_, i) => {
    const p = H.materials.offset + i * 4;
    return { flags: m.readUInt16LE(p), blend: m.readUInt16LE(p + 2) };
  });
  out.sequences = Array.from({ length: H.sequences.count }, (_, i) => {
    const p = H.sequences.offset + i * 64;
    return {
      id: m.readUInt16LE(p), variation: m.readUInt16LE(p + 2), duration: m.readUInt32LE(p + 4),
      moveSpeed: m.readFloatLE(p + 8), flags: m.readUInt32LE(p + 12), next: m.readInt16LE(p + 60), alias: m.readUInt16LE(p + 62),
    };
  });
  out.globalLoops = Array.from({ length: H.globalLoops.count }, (_, i) => m.readUInt32LE(H.globalLoops.offset + i * 4));
  out.attachments = Array.from({ length: H.attachments.count }, (_, i) => {
    const p = H.attachments.offset + i * 40;
    return { id: m.readUInt32LE(p), bone: m.readUInt16LE(p + 4), pos: [m.readFloatLE(p + 8), m.readFloatLE(p + 12), m.readFloatLE(p + 16)] };
  });
  out.attachmentLookup = u16(H.attachmentLookup);
  // Camaras (116 bytes en las versiones modernas): tipo, planos lejano y cercano, posicion y objetivo
  // (base + primer valor de su pista) y, al final, giro y campo de vision como pistas.
  const firstKey = (at, comps, stride) => {
    const seqs = arr(m, at + 12);
    if (!seqs.count || seqs.offset + 8 > m.length) return null;
    const keys = arr(m, seqs.offset);
    if (!keys.count || keys.offset + comps * 4 > m.length) return null;
    return Array.from({ length: comps }, (_, k) => m.readFloatLE(keys.offset + k * 4));
  };
  // Color y opacidad de cada capa en el primer fotograma (las pistas se animan; aqui solo el valor inicial).
  const firstFixed = (at) => {
    const seqs = arr(m, at + 12);
    if (!seqs.count || seqs.offset + 8 > m.length) return null;
    const keys = arr(m, seqs.offset);
    if (!keys.count || keys.offset + 2 > m.length) return null;
    return m.readInt16LE(keys.offset) / 32767;
  };
  out.colors = Array.from({ length: H.colors.count }, (_, i) => {
    const p = H.colors.offset + i * 40;
    return [...(firstKey(p, 3) ?? [1, 1, 1]), firstFixed(p + 20) ?? 1];
  });
  out.weights = Array.from({ length: H.textureWeights.count }, (_, i) => firstFixed(H.textureWeights.offset + i * 20) ?? 1);
  out.cameras = Array.from({ length: H.cameras.count }, (_, i) => {
    const p = H.cameras.offset + i * 116;
    const vec = (o) => [m.readFloatLE(p + o), m.readFloatLE(p + o + 4), m.readFloatLE(p + o + 8)];
    const pb = vec(32), tb = vec(64);
    const pv = firstKey(p + 12, 3) ?? [0, 0, 0], tv = firstKey(p + 44, 3) ?? [0, 0, 0];
    const fov = firstKey(p + 96, 1)?.[0];
    return {
      type: m.readInt32LE(p), far: m.readFloatLE(p + 4), near: m.readFloatLE(p + 8),
      position: pb.map((v, k) => v + pv[k]), target: tb.map((v, k) => v + tv[k]), fov: fov ?? null,
    };
  });
  out.fileIds = {
    skin: chunks.SFID?.[0] ? Array.from({ length: chunks.SFID[0].length / 4 }, (_, i) => chunks.SFID[0].readUInt32LE(i * 4)) : [],
    txid: chunks.TXID?.[0] ? Array.from({ length: chunks.TXID[0].length / 4 }, (_, i) => chunks.TXID[0].readUInt32LE(i * 4)) : [],
    skel: chunks.SKID?.[0]?.readUInt32LE(0) ?? 0,
    anims: chunks.AFID?.[0] ? Array.from({ length: chunks.AFID[0].length / 8 }, (_, i) => ({
      animId: chunks.AFID[0].readUInt16LE(i * 8), sub: chunks.AFID[0].readUInt16LE(i * 8 + 2), fileId: chunks.AFID[0].readUInt32LE(i * 8 + 4),
    })) : [],
  };

  /** Vertices del M2: posicion, pesos, huesos, normal y UV (48 bytes cada uno). */
  out.readVertices = () => {
    const n = H.vertices.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const bi = new Uint8Array(n * 4), bw = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = H.vertices.offset + i * 48;
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] = m.readFloatLE(p + k * 4); nor[i * 3 + k] = m.readFloatLE(p + 20 + k * 4); }
      for (let k = 0; k < 4; k++) { bw[i * 4 + k] = m[p + 12 + k]; bi[i * 4 + k] = m[p + 16 + k]; }
      uv[i * 2] = m.readFloatLE(p + 32); uv[i * 2 + 1] = m.readFloatLE(p + 36);
    }
    return { count: n, pos, nor, uv, bi, bw };
  };

  /** Huesos con pivote, padre y pistas (las pistas se decodifican con `readBoneTracks`). */
  out.bones = Array.from({ length: H.bones.count }, (_, i) => {
    const p = H.bones.offset + i * 88;
    return {
      keyBone: m.readInt32LE(p), flags: m.readUInt32LE(p + 4), parent: m.readInt16LE(p + 8), submesh: m.readUInt16LE(p + 10),
      trackAt: { t: p + 16, r: p + 36, s: p + 56 },
      pivot: [m.readFloatLE(p + 76), m.readFloatLE(p + 80), m.readFloatLE(p + 84)],
    };
  });
  return out;
}

/** Perfil de malla (.skin): subgeometrias, triangulos y lotes de dibujo. */
export function parseSkin(buf) {
  if (buf.toString("ascii", 0, 4) !== "SKIN") throw new Error("no es SKIN");
  const V = arr(buf, 4), I = arr(buf, 12), B = arr(buf, 20), S = arr(buf, 28), T = arr(buf, 36);
  const vertices = Array.from({ length: V.count }, (_, i) => buf.readUInt16LE(V.offset + i * 2));
  const indices = Array.from({ length: I.count }, (_, i) => buf.readUInt16LE(I.offset + i * 2));
  const sections = Array.from({ length: S.count }, (_, i) => {
    const p = S.offset + i * 48;
    const level = buf.readUInt16LE(p + 2);
    return {
      id: buf.readUInt16LE(p), vertexStart: buf.readUInt16LE(p + 4), vertexCount: buf.readUInt16LE(p + 6),
      indexStart: buf.readUInt16LE(p + 8) | (level << 16), indexCount: buf.readUInt16LE(p + 10),
      boneCount: buf.readUInt16LE(p + 12), boneStart: buf.readUInt16LE(p + 14),
    };
  });
  const batches = Array.from({ length: T.count }, (_, i) => {
    const p = T.offset + i * 24;
    return {
      flags: buf[p], priority: buf.readInt8(p + 1), shader: buf.readUInt16LE(p + 2), section: buf.readUInt16LE(p + 4),
      colorIndex: buf.readUInt16LE(p + 8), material: buf.readUInt16LE(p + 10), layer: buf.readUInt16LE(p + 12),
      textureCount: buf.readUInt16LE(p + 14), textureCombo: buf.readUInt16LE(p + 16), weightCombo: buf.readUInt16LE(p + 20), transformCombo: buf.readUInt16LE(p + 22),
    };
  });
  return { vertices, indices, sections, batches, boneProps: B };
}

const COMP_QUAT = (v) => (v < 0 ? v + 32768 : v - 32767) / 32767;

/**
 * Lee la pista de un hueso para una secuencia. `data` es el buffer donde estan los valores
 * (el M2 si la secuencia va incrustada, o su fichero .anim). Devuelve {times, values} o null.
 */
export function readTrack(m, at, seqIndex, kind, dataFor) {
  const interpolation = m.readUInt16LE(at);
  const globalSeq = m.readInt16LE(at + 2);
  const tsArr = arr(m, at + 4), valArr = arr(m, at + 12);
  const idx = globalSeq >= 0 ? 0 : seqIndex;
  if (idx >= tsArr.count) return null;
  const d = dataFor(idx);
  if (!d) return null;
  const ts = arr(m, tsArr.offset + idx * 8), vs = arr(m, valArr.offset + idx * 8);
  if (!ts.count) return null;
  const times = Array.from({ length: ts.count }, (_, i) => d.readUInt32LE(ts.offset + i * 4));
  const comps = kind === "r" ? 4 : 3;
  const values = [];
  for (let i = 0; i < vs.count; i++) {
    if (kind === "r") {
      const p = vs.offset + i * 8;
      values.push([COMP_QUAT(d.readInt16LE(p)), COMP_QUAT(d.readInt16LE(p + 2)), COMP_QUAT(d.readInt16LE(p + 4)), COMP_QUAT(d.readInt16LE(p + 6))]);
    } else {
      const p = vs.offset + i * 12;
      values.push([d.readFloatLE(p), d.readFloatLE(p + 4), d.readFloatLE(p + 8)]);
    }
  }
  // Una pista con secuencia global corre en su propia linea de tiempo (cientos de segundos), no en la de la animacion:
  // se deja fija en su primer valor para que el clip dure lo que dura la animacion.
  if (globalSeq >= 0 && times.length > 1) return { interpolation: 0, globalSeq, times: [0], values: [values[0]], comps };
  return { interpolation, globalSeq, times, values, comps };
}

/** Tamano de un emisor de particulas (M2Particle) en la version 272 del cliente (476 de la estructura clasica + 16 de las nuevas). */
const PARTICLE_SIZE = 492;

/**
 * Emisores de particulas del M2. Solo los valores iniciales de las pistas animadas (primera secuencia) y las pistas por
 * vida (color, opacidad, tamano, celda de textura) completas. Posicion en ejes del M2 (x adelante, y izquierda, z arriba)
 * y en el espacio del modelo (coincide con el pivote de su hueso; no se suman).
 */
export function parseParticles(m2) {
  const m = m2.m;
  const a = m2.particleArray;
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const p = a.offset + i * PARTICLE_SIZE;
    if (p + PARTICLE_SIZE > m.length) break;
    const f = (o) => m.readFloatLE(p + o);
    const flags = m.readUInt32LE(p + 4);
    const bone = m.readUInt16LE(p + 20);
    const texField = m.readUInt16LE(p + 22);
    const track = (o) => {
      const ts = arr(m, p + o + 4), vs = arr(m, p + o + 12);
      if (!ts.count || !vs.count || vs.offset + 8 > m.length) return [];
      const v = arr(m, vs.offset);
      if (!v.count || v.offset + 4 > m.length) return [];
      return Array.from({ length: Math.min(v.count, 16) }, (_, k) => m.readFloatLE(v.offset + k * 4));
    };
    const fblock = (o, comps, kind) => {
      const ts = arr(m, p + o), vs = arr(m, p + o + 8);
      const n = Math.min(ts.count, vs.count, 16);
      const keys = [];
      for (let k = 0; k < n; k++) {
        const t = m.readUInt16LE(ts.offset + k * 2) / 32767;
        const base = vs.offset + k * (kind === "i16" || kind === "u16" ? 2 : comps * 4);
        if (kind === "i16") keys.push([t, m.readInt16LE(base) / 32767]);
        else if (kind === "u16") keys.push([t, m.readUInt16LE(base)]);
        else keys.push([t, ...Array.from({ length: comps }, (_, c) => m.readFloatLE(base + c * 4))]);
      }
      return keys;
    };
    const first = (arr0, d) => (arr0.length ? arr0[0] : d);
    out.push({
      flags, bone, pos: [f(8), f(12), f(16)],
      texture: flags & 0x10000000 ? texField & 31 : texField,
      blend: m.readUInt8(p + 40), emitter: m.readUInt8(p + 41),
      rows: m.readUInt16LE(p + 48) || 1, cols: m.readUInt16LE(p + 50) || 1,
      speed: track(52), speedVar: track(72), vertical: track(92), horizontal: track(112), gravity: track(132), lifespan: track(152),
      lifespanVary: f(172), rate: track(176), rateVary: f(196), length: track(200), width: track(220),
      color: fblock(260, 3), alpha: fblock(276, 1, "i16"), scale: fblock(292, 2), scaleVary: [f(308), f(312)],
      head: fblock(316, 1, "u16"), tail: fblock(332, 1, "u16"), tailLength: f(348),
      drag: f(372), spin: f(384), spinVary: f(388), baseSpin: f(376), baseSpinVary: f(380),
      wind: [f(416), f(420), f(424)], first,
    });
  }
  return out;
}
