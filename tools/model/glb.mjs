// Escritor minimo de glTF binario (.glb): nodos, mallas con piel, animaciones.
export class GlbBuilder {
  constructor() {
    this.json = { asset: { version: "2.0", generator: "wfuc-model" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], skins: [], animations: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
    this.chunks = [];
    this.size = 0;
  }
  /** Anade datos al buffer unico y devuelve el indice de bufferView. */
  view(typed, target) {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.size += pad; }
    this.chunks.push(bytes);
    const bv = { buffer: 0, byteOffset: this.size, byteLength: bytes.length };
    if (target) bv.target = target;
    this.size += bytes.length;
    this.json.bufferViews.push(bv);
    return this.json.bufferViews.length - 1;
  }
  accessor(typed, { type, componentType, normalized, target, min, max }) {
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const a = { bufferView: this.view(typed, target), componentType, count: typed.length / comps, type };
    if (normalized) a.normalized = true;
    if (min) a.min = min;
    if (max) a.max = max;
    this.json.accessors.push(a);
    return this.json.accessors.length - 1;
  }
  node(n) { this.json.nodes.push(n); return this.json.nodes.length - 1; }
  toBuffer() {
    const bin = Buffer.concat(this.chunks);
    const padB = (4 - (bin.length % 4)) % 4;
    const binPadded = Buffer.concat([bin, Buffer.alloc(padB)]);
    this.json.buffers[0].byteLength = binPadded.length;
    let js = Buffer.from(JSON.stringify(this.json), "utf8");
    const padJ = (4 - (js.length % 4)) % 4;
    js = Buffer.concat([js, Buffer.alloc(padJ, 0x20)]);
    const head = Buffer.alloc(12);
    head.write("glTF", 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binPadded.length, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write("JSON", 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(binPadded.length, 0); bh.write("BIN\0", 4);
    return Buffer.concat([head, jh, js, bh, binPadded]);
  }
}
export const FLOAT = 5126, UBYTE = 5121, USHORT = 5123, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
