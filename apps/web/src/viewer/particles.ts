// Partículas de los modelos M2 (brillos de arma, encantamientos, llamas de objetos): un emisor dibuja sprites con
// tamaño, color, opacidad y celda de textura que cambian con la vida de cada partícula. Aproximación de los emisores
// del juego: pistas de una sola secuencia, sin cintas ni viento. Las partículas se simulan en el espacio del anclaje (se mueven con el arma, sin estelas al cambiar de postura).
import { BufferAttribute, BufferGeometry, CustomBlending, NormalBlending, Object3D, OneFactor, Points, ShaderMaterial, SrcAlphaFactor, Vector2, Vector3, ZeroFactor, type IUniform, type Texture } from "three";
import type { EmitterData } from "./fx-index";

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute float aRot;
attribute float aCell;
uniform float uPx;
varying vec4 vColor;
varying float vRot;
varying float vCell;
void main() {
  vColor = aColor;
  vRot = aRot;
  vCell = aCell;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // el cuadrado crece un 41 % para que el giro no recorte las esquinas
  gl_PointSize = clamp(aSize * 1.4142 * uPx / max(-mv.z, 0.01), 1.0, 512.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec2 uTiles;
varying vec4 vColor;
varying float vRot;
varying float vCell;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * 1.4142;
  float s = sin(vRot);
  float k = cos(vRot);
  c = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) discard;
  float col = mod(vCell, uTiles.x);
  float row = floor(vCell / uTiles.x);
  vec4 t = texture2D(uMap, (c + vec2(col, row)) / uTiles);
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
}`;

/** Lado de un sprite respecto a la cifra de la pista de tamaño (el juego dibuja ±tamaño desde el centro). */
const SIZE_FACTOR = 1.5;
const MAX_LIVE = 500;

/** Valor de una pista [tiempo, v…] en el instante t (0-1), con interpolación lineal. */
function sample(keys: number[][], t: number, out: number[]): void {
  const n = keys.length;
  const first = keys[0]!;
  const last = keys[n - 1]!;
  if (n === 1 || t <= first[0]!) { for (let i = 1; i < first.length; i++) out[i - 1] = first[i]!; return; }
  if (t >= last[0]!) { for (let i = 1; i < last.length; i++) out[i - 1] = last[i]!; return; }
  let k = 1;
  while (k < n - 1 && keys[k]![0]! < t) k++;
  const a = keys[k - 1]!;
  const b = keys[k]!;
  const f = (t - a[0]!) / Math.max(b[0]! - a[0]!, 1e-6);
  for (let i = 1; i < a.length; i++) out[i - 1] = a[i]! + (b[i]! - a[i]!) * f;
}

/** Celda de la textura en el instante t (la pista es de escalones). */
function cellAt(keys: [number, number][], t: number): number {
  let cell = keys[0]?.[1] ?? 0;
  for (const [kt, c] of keys) if (kt <= t) cell = c;
  return cell;
}

export class ParticleEmitter {
  readonly points: Points;
  private readonly cap: number;
  private n = 0;
  private acc = Math.random();
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly sizeMul: Float32Array;
  private readonly rot0: Float32Array;
  private readonly spin: Float32Array;
  private readonly outPos: Float32Array;
  private readonly outColor: Float32Array;
  private readonly outSize: Float32Array;
  private readonly outRot: Float32Array;
  private readonly outCell: Float32Array;
  private readonly aPos: BufferAttribute;
  private readonly aColor: BufferAttribute;
  private readonly aSize: BufferAttribute;
  private readonly aRot: BufferAttribute;
  private readonly aCell: BufferAttribute;
  private readonly tmp = [0, 0, 0, 0];
  private readonly v = new Vector3();

  /** `anchor`: punto del que cuelga el emisor (el modelo del objeto o uno de sus anclajes); `px`: píxeles por unidad a distancia 1. */
  constructor(readonly data: EmitterData, private readonly anchor: Object3D, map: Texture, px: IUniform<number>) {
    const d = data;
    this.cap = Math.min(MAX_LIVE, Math.max(8, Math.ceil(d.rate * d.life * (1 + d.lifeVar)) + 4));
    const c = this.cap;
    this.pos = new Float32Array(c * 3);
    this.vel = new Float32Array(c * 3);
    this.age = new Float32Array(c);
    this.life = new Float32Array(c);
    this.sizeMul = new Float32Array(c);
    this.rot0 = new Float32Array(c);
    this.spin = new Float32Array(c);
    const geom = new BufferGeometry();
    const attr = (arr: Float32Array, size: number) => new BufferAttribute(arr, size).setUsage(35048);
    this.outPos = new Float32Array(c * 3);
    this.outColor = new Float32Array(c * 4);
    this.outSize = new Float32Array(c);
    this.outRot = new Float32Array(c);
    this.outCell = new Float32Array(c);
    this.aPos = attr(this.outPos, 3);
    this.aColor = attr(this.outColor, 4);
    this.aSize = attr(this.outSize, 1);
    this.aRot = attr(this.outRot, 1);
    this.aCell = attr(this.outCell, 1);
    geom.setAttribute("position", this.aPos);
    geom.setAttribute("aColor", this.aColor);
    geom.setAttribute("aSize", this.aSize);
    geom.setAttribute("aRot", this.aRot);
    geom.setAttribute("aCell", this.aCell);
    geom.setDrawRange(0, 0);
    const additive = d.blend === 4 || d.blend === 7;
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uTiles: { value: new Vector2(Math.max(d.cols, 1), Math.max(d.rows, 1)) }, uPx: px },
      transparent: true,
      depthWrite: false,
      // Aditiva sin tocar el canal alfa del lienzo: con la mezcla aditiva de three.js las zonas negras de la textura oscurecen el fondo
      ...(additive ? { blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor } : { blending: NormalBlending }),
    });
    this.points = new Points(geom, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
  }

  private spawn(): void {
    const d = this.data;
    const i = this.n++;
    const r = Math.random;
    // Posición y dirección en los ejes del M2 (x adelante, y izquierda, z arriba); `P` las pasa a los de glTF
    let ox = 0, oy = 0, oz = 0, dx: number, dy: number, dz: number;
    if (d.shape === 2) {
      const u = Math.acos(2 * r() - 1);
      const ph = 2 * Math.PI * r();
      dx = Math.sin(u) * Math.cos(ph); dy = Math.sin(u) * Math.sin(ph); dz = Math.cos(u);
      const rad = Math.max(d.length, d.width) * Math.cbrt(r());
      ox = dx * rad; oy = dy * rad; oz = dz * rad;
    } else {
      ox = (r() - 0.5) * d.length;
      oy = (r() - 0.5) * d.width;
      const th = r() * d.vertical;
      const ph = r() * d.horizontal;
      dx = Math.sin(th) * Math.cos(ph); dy = Math.sin(th) * Math.sin(ph); dz = Math.cos(th);
    }
    const speed = d.speed * (1 + d.speedVar * (r() * 2 - 1));
    this.pos.set([d.pos[0] + oy, d.pos[1] + oz, d.pos[2] + ox], i * 3);
    this.vel.set([dy * speed, dz * speed, dx * speed], i * 3);
    this.age[i] = 0;
    this.life[i] = Math.max(0.05, d.life * (1 + d.lifeVar * (r() * 2 - 1)));
    this.sizeMul[i] = 1 + d.scaleVar[0] * (r() * 2 - 1);
    this.rot0[i] = d.baseSpin + r() * d.baseSpinVar;
    this.spin[i] = d.spin + d.spinVar * (r() * 2 - 1);
  }

  update(dt: number): void {
    const d = this.data;
    dt = Math.min(dt, 0.1);
    this.anchor.updateWorldMatrix(true, false);
    const mw = this.anchor.matrixWorld;
    this.acc += d.rate * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (this.n < this.cap) this.spawn();
    }
    const damp = Math.max(0, 1 - d.drag * dt);
    const tmp = this.tmp;
    let i = 0;
    while (i < this.n) {
      const age = this.age[i]! + dt;
      if (age >= this.life[i]!) {
        // se sustituye por la última viva
        const last = --this.n;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          for (const a of [this.age, this.life, this.sizeMul, this.rot0, this.spin]) a[i] = a[last]!;
        }
        continue;
      }
      this.age[i] = age;
      const p = i * 3;
      let vx = this.vel[p]!, vy = this.vel[p + 1]! - d.gravity * dt, vz = this.vel[p + 2]!;
      if (d.drag > 0) { vx *= damp; vy *= damp; vz *= damp; }
      this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
      const x = this.pos[p]! + vx * dt, y = this.pos[p + 1]! + vy * dt, z = this.pos[p + 2]! + vz * dt;
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
      this.v.set(x, y, z).applyMatrix4(mw);
      this.outPos[p] = this.v.x; this.outPos[p + 1] = this.v.y; this.outPos[p + 2] = this.v.z;
      const t = age / this.life[i]!;
      const o = i * 4;
      sample(d.color, t, tmp);
      this.outColor[o] = tmp[0]! / 255; this.outColor[o + 1] = tmp[1]! / 255; this.outColor[o + 2] = tmp[2]! / 255;
      sample(d.alpha, t, tmp);
      this.outColor[o + 3] = Math.min(1, Math.max(0, tmp[0]!));
      sample(d.scale, t, tmp);
      this.outSize[i] = Math.max(tmp[0]!, tmp[1]!) * this.sizeMul[i]! * SIZE_FACTOR;
      this.outRot[i] = this.rot0[i]! + this.spin[i]! * age;
      this.outCell[i] = d.head.length ? cellAt(d.head, t) : 0;
      i++;
    }
    const geom = this.points.geometry;
    geom.setDrawRange(0, this.n);
    for (const a of [this.aPos, this.aColor, this.aSize, this.aRot, this.aCell]) a.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
