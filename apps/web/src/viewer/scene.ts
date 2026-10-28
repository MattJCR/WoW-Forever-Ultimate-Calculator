// Escena three.js del probador: carga el .glb de una raza/sexo, aplica la personalización (geosets y
// texturas compuestas) y deja girar el modelo con el ratón. Se carga solo en el paso Equipo.
import {
  AmbientLight, AnimationClip, AnimationMixer, Box3, CanvasTexture, Color, DirectionalLight, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PerspectiveCamera, SRGBColorSpace, Scene, Texture, TextureLoader, Vector2, Vector3, WebGLRenderer, Clock, Object3D, HemisphereLight, Group, NoColorSpace, Euler, Matrix4, Quaternion, CustomBlending, OneFactor, SrcAlphaFactor, ZeroFactor,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { composeTexture, type Overlay } from "./compose";
import type { AttachedModel } from "./equipment";
import { loadEmitters } from "./fx-index";
import { ParticleEmitter } from "./particles";
import { resolveSelection, type BatchInfo, type Recipe, type Selection } from "./recipe";

export interface ViewState {
  selection: Selection;
  /** Subgeometrías que fuerzan el equipo o el estado (se suman a las de la personalización). */
  extraGeosets?: Set<number>;
  /** Grupos de subgeometría (id/100) que el equipo oculta o sustituye. */
  hiddenGroups?: Set<number>;
  overlays?: Overlay[];
  /** Subgeometrías que oculta el casco (0 = peinado, 1-3 = vello facial). */
  helmetHides?: number[];
  /** Modelos anclados: casco, hombreras, armas… */
  models?: AttachedModel[];
  /** Textura de objetos por tipo de textura de la malla (2 = capa). */
  objectTextures?: Record<number, number>;
  /** Animación del personaje (Stand, Ready1H, Ready2H…). */
  pose?: string;
}

/** Mezcla aditiva (llamas, brillos) que solo suma color: la de three.js también suma el alfa y oscurece el fondo al ser el lienzo transparente. */
const ADDITIVE = { blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor } as const;

/** Pasa los ejes del M2 (x adelante, y izquierda, z arriba) a los de glTF: (x, y, z) -> (y, z, x). */
const TO_GLTF = new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);

/** Ajuste del objeto envainado (TransformMatrix: posición, giro-cabeceo-alabeo en grados y escala, en ejes del M2) como matriz de glTF. */
function sheatheMatrix([x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1]: number[]): Matrix4 {
  const rad = Math.PI / 180;
  const m2 = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(roll * rad, pitch * rad, yaw * rad, "ZYX")), new Vector3(scale, scale, scale));
  return TO_GLTF.clone().multiply(m2).multiply(TO_GLTF.clone().invert());
}

/** Tipos de textura de malla que se pintan con otro compuesto (los de las colecciones usan el del pelo). */
const TEXTURE_ALIAS: Record<number, number> = { 7: 6 };

/** Grupos de subgeometría que el equipo sustituye; sin equipo enseñan su variante 01. El 23 son las manos de los modelos nuevos (elfos, Cielonato). */
const EQUIPMENT_GROUPS = new Set([4, 5, 8, 9, 10, 11, 12, 13, 15, 18, 20, 22, 23]);

/** Encuadre de las miniaturas: altura a la que mira (fracción del alto), distancia (en altos) y giro. */
export const BUST_PRESETS = {
  head: { x: 0, y: 0.91, d: 0.5, yaw: 0.35 },
  shoulder: { x: 0, y: 0.8, d: 0.8, yaw: 0.5 },
  chest: { x: 0, y: 0.67, d: 0.95, yaw: 0.3 },
  hands: { x: 0.19, y: 0.41, d: 0.42, yaw: 0.5 },
  wrist: { x: 0.2, y: 0.5, d: 0.42, yaw: 0.5 },
  waist: { x: 0, y: 0.54, d: 0.7, yaw: 0.3 },
  legs: { x: 0, y: 0.34, d: 1.1, yaw: 0.35 },
  feet: { x: 0, y: 0.06, d: 0.62, yaw: 0.5 },
  back: { x: 0, y: 0.62, d: 1.05, yaw: Math.PI - 0.3 },
} as const;
export type BustKind = keyof typeof BUST_PRESETS;

export class CharacterView {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new Clock();
  private mixer: AnimationMixer | null = null;
  private root: Object3D | null = null;
  private meshes = new Map<number, Mesh[]>();
  private recipe: Recipe | null = null;
  private skinTextures = new Map<number, Texture>();
  private raf = 0;
  private disposed = false;
  private loadSeq = 0;
  /** Partículas de los efectos de objetos (brillos de arma, encantamientos, llamas propias). */
  private fxGroup = new Group();
  private fx: ParticleEmitter[] = [];
  private effectsOn = true;
  private pxScale = { value: 600 };

  constructor(private canvas: HTMLCanvasElement, private base: string) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(0, 1.1, 5.2);
    this.scene.add(new HemisphereLight(0xfff2dd, 0x40382e, 1.6), new AmbientLight(0xffffff, 0.6), this.fxGroup);
    const key = new DirectionalLight(0xfff0d8, 2.2);
    key.position.set(2.5, 3.5, 4);
    this.scene.add(key);
    const rim = new DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enablePan = false;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.enableDamping = true;
    this.controls.update();
    this.controls.addEventListener("start", () => { this.touched = true; });
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      if (!this.paused) this.mixer?.update(dt);
      this.controls.update();
      if (!this.touched && this.attached.length && ++this.reachTick % 15 === 0) this.measureReach(true);
      if (this.fx.length && this.effectsOn) {
        // Píxeles por unidad a distancia 1: el tamaño de cada sprite sigue al del lienzo y al zoom
        this.pxScale.value = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
        if (!this.paused) for (const e of this.fx) e.update(dt);
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
    if (import.meta.env.DEV) (window as unknown as { __wfView?: CharacterView }).__wfView = this;
  }

  /** Solo desarrollo: lienzos de textura compuesta por tipo. */
  debugCanvases(): Record<number, HTMLCanvasElement> {
    const out: Record<number, HTMLCanvasElement> = {};
    for (const [t, tex] of this.skinTextures) out[t] = (tex as CanvasTexture).image as HTMLCanvasElement;
    return out;
  }

  private paused = false;
  setPaused(p: boolean) {
    this.paused = p;
  }

  /** Enseña u oculta las partículas de los efectos de objetos. */
  setEffects(on: boolean) {
    this.effectsOn = on;
    this.fxGroup.visible = on;
  }

  private modelHeight = 2;
  private touched = false;
  /** Lo que sobresale del personaje con sus armas y piezas colgadas: mitad del ancho y cota más alta (en unidades del modelo). */
  private reachX = 0;
  private reachTop = 0;

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.touched) this.frame();
  }

  /** Encuadra el personaje entero (alto y ancho) en el lienzo, con un poco de aire. */
  private frame() {
    const h = this.modelHeight;
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    // Alto y ancho a encuadrar: el personaje y, si sobresalen, sus armas (nunca más que ~1,6 veces)
    const halfH = Math.min(Math.max(h * 0.54, this.reachTop - h * 0.46), h * 0.86);
    const halfW = Math.min(Math.max(h * 0.44, this.reachX + h * 0.06), h * 0.7);
    const byHeight = halfH / half;
    const byWidth = halfW / (half * Math.max(this.camera.aspect, 0.2));
    const d = Math.max(byHeight, byWidth);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, h * 0.5, 0);
    this.camera.position.copy(dir.multiplyScalar(d).add(this.controls.target));
    this.controls.update();
  }

  textureUrl = (file: number) => `${this.base}/tex/${file}.webp`;

  /** Carga el modelo de una raza/sexo (`m<ChrModel>`). Devuelve la receta. */
  async load(chrModelId: number): Promise<Recipe> {
    const seq = ++this.loadSeq;
    const dir = `${this.base}/m${chrModelId}`;
    const [recipe, gltf] = await Promise.all([
      fetch(`${dir}/character.json`).then((r) => r.json() as Promise<Recipe>),
      new GLTFLoader().loadAsync(`${dir}/model.glb`),
    ]);
    if (seq !== this.loadSeq || this.disposed) return recipe;
    if (this.root) this.scene.remove(this.root);
    this.recipe = recipe;
    this.root = gltf.scene;
    this.meshes.clear();
    this.skinTextures.clear();
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const id = (m.userData as { geoset?: number }).geoset;
      if (id === undefined) return;
      m.visible = false;
      const list = this.meshes.get(id) ?? [];
      list.push(m);
      this.meshes.set(id, list);
    });
    this.scene.add(gltf.scene);
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    this.mixer = gltf.animations.length ? new AnimationMixer(gltf.scene) : null;
    this.pose = "";
    this.setPose("Stand");
    const box = new Box3().setFromObject(gltf.scene);
    this.modelHeight = box.getSize(new Vector3()).y;
    this.touched = false;
    this.camera.position.set(0, this.modelHeight * 0.55, this.modelHeight * 2.7);
    this.frame();
    return recipe;
  }

  private clips = new Map<string, AnimationClip>();

  /** Animaciones que trae este modelo (Stand, Ready1H…). */
  clipNames(): string[] {
    return [...this.clips.keys()];
  }
  private pose = "";

  /** Cambia de animación con un fundido corto; si no existe en este modelo se queda en Stand. */
  setPose(name: string) {
    const clip = this.clips.get(name) ?? this.clips.get("Stand");
    if (!this.mixer || !clip || this.pose === clip.name) return;
    const prev = this.pose ? this.clips.get(this.pose) : undefined;
    const next = this.mixer.clipAction(clip).reset().play();
    if (prev) { const old = this.mixer.clipAction(prev); next.crossFadeFrom(old, 0.25, false); }
    this.pose = clip.name;
  }

  /** Aplica geosets y texturas. */
  private applySeq = 0;

  async apply(state: ViewState) {
    const recipe = this.recipe;
    if (!recipe || !this.root) return;
    const seq = ++this.applySeq;
    if (state.pose) this.setPose(state.pose);
    const resolved = resolveSelection(recipe, state.selection);
    const visible = new Set<number>([0]);
    const groups = new Set<number>(state.hiddenGroups ?? []);
    for (const g of resolved.geosets) { visible.add(g); if (g >= 100) groups.add(Math.floor(g / 100)); }
    for (const g of state.extraGeosets ?? []) { visible.add(g); groups.add(Math.floor(g / 100)); }
    // Sin equipo ni personalización que lo cambie, cada grupo enseña su variante 01 (manos, pies, torso…).
    for (const info of recipe.geosets) {
      const g = info.geoset;
      if (g >= 100 && g % 100 === 1 && EQUIPMENT_GROUPS.has(Math.floor(g / 100)) && !groups.has(Math.floor(g / 100))) visible.add(g);
    }
    for (const grp of state.helmetHides ?? []) {
      for (const g of [...visible]) if (grp === 0 ? g >= 1 && g < 100 : Math.floor(g / 100) === grp) visible.delete(g);
    }
    // La cabeza (grupo 32) la elige la personalización solo en algunas razas; en el resto va la primera variante real.
    if (!groups.has(32)) {
      const head = recipe.geosets.map((i) => i.geoset).filter((g) => Math.floor(g / 100) === 32 && g % 100 >= 2).sort((a, b) => a - b)[0];
      if (head !== undefined) visible.add(head);
    }
    // Los ojos (grupo 33) van siempre, salvo que la personalización los quite o los cambie (3300: sin ojos).
    if (!groups.has(33) && this.meshes.has(3301)) visible.add(3301);
    // Las orejas (grupo 7) solo las elige la personalización en algunas razas; en el resto va la variante con orejas
    // (la 02 si el modelo trae varias, porque la 01 suele ser «sin orejas»; la única si solo hay una).
    if (!groups.has(7)) {
      const ears = recipe.geosets.map((i) => i.geoset).filter((g) => Math.floor(g / 100) === 7).sort((a, b) => a - b);
      const pick = ears.find((g) => g % 100 >= 2) ?? ears[0];
      if (pick !== undefined) visible.add(pick);
    }
    for (const [id, list] of this.meshes) for (const m of list) m.visible = visible.has(id);

    const key = (t: number) => t;
    const types = new Set<number>();
    for (const g of recipe.geosets) for (const b of g.batches) if (b.texType > 0) types.add(b.texType);
    const canvases = new Map<number, Texture>();
    for (const t of types) {
      const canvas = await composeTexture(recipe, t, resolved, { textureUrl: this.textureUrl, overlays: state.overlays });
      if (seq !== this.applySeq || recipe !== this.recipe) return; // llegó otra petición más reciente
      if (!canvas) continue;
      const tex = new CanvasTexture(canvas);
      tex.flipY = false;
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      tex.minFilter = LinearFilter;
      canvases.set(key(t), tex);
    }
    const fixed = new Map<number, Texture | null>();
    const pick = (info: (typeof recipe.geosets)[number]) => {
      const b = info.batches.find((x) => x.texType > 0 || x.texFile) ?? info.batches[0];
      const objFile = b?.texType ? state.objectTextures?.[b.texType] : undefined;
      return { b, file: objFile || (b?.texType ? 0 : b?.texFile || 0) };
    };
    await Promise.all([...new Set(recipe.geosets.map((i) => pick(i).file).filter(Boolean))].map(async (f) => fixed.set(f, await this.tex(f))));
    if (seq !== this.applySeq || recipe !== this.recipe) return;
    for (const info of recipe.geosets) {
      const meshes = this.meshes.get(info.geoset);
      if (!meshes) continue;
      const { b, file } = pick(info);
      const map = file ? fixed.get(file) ?? undefined : b?.texType ? (canvases.get(b.texType) ?? canvases.get(TEXTURE_ALIAS[b.texType] ?? -1)) : undefined;
      for (const m of meshes) this.setMaterial(m, b, map);
    }
    for (const t of this.skinTextures.values()) t.dispose();
    this.skinTextures = canvases;
    await this.attachModels(state.models ?? []);
  }

  private modelCache = new Map<string, Promise<Object3D | null>>();
  private attached: Object3D[] = [];

  private loadItemModel(file: number) {
    const url = `${this.base}/item/${file}.glb`;
    let p = this.modelCache.get(url);
    if (!p) {
      p = new GLTFLoader().loadAsync(url).then((g) => {
        // Anclajes propios del modelo (M2 en ejes del juego): de ellos cuelgan los efectos del arma
        g.scene.userData.attachments = (g.asset as { extras?: { attachments?: unknown } }).extras?.attachments ?? [];
        return g.scene;
      }, () => null);
      this.modelCache.set(url, p);
    }
    return p;
  }

  /** Cuelga cascos, hombreras y armas de los puntos de anclaje del modelo. */
  private async attachModels(models: AttachedModel[]) {
    const root = this.root;
    if (!root) return;
    const seq = ++this.attachSeq;
    const loaded = await Promise.all(models.map(async (m) => ({ m, scene: await this.loadItemModel(m.file) })));
    if (seq !== this.attachSeq || root !== this.root) return;
    for (const o of this.attached) o.removeFromParent();
    this.attached = [];
    for (const e of this.fx) e.dispose();
    this.fx = [];
    for (const { m, scene } of loaded) {
      const point = root.getObjectByName(`att_${m.attachment}`);
      if (!scene || !point) continue;
      const inst = await this.itemInstance(scene, m.textures);
      if (seq !== this.attachSeq || root !== this.root) return;
      if (m.mirror) inst.scale.x = -1;
      if (m.transform) sheatheMatrix(m.transform).decompose(inst.position, inst.quaternion, inst.scale);
      point.add(inst);
      this.attached.push(inst);
      await this.attachEffects(m, inst, () => seq !== this.attachSeq || root !== this.root);
    }
    this.measureReach();
  }

  /** Cuánto sobresalen del encuadre las piezas colgadas (en la pose de ese momento), para que el arma no quede cortada. */
  private measureReach(grow = false) {
    const box = new Box3();
    for (const o of this.attached) { o.updateWorldMatrix(true, true); box.expandByObject(o, true); }
    const x = box.isEmpty() ? 0 : Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const top = box.isEmpty() ? 0 : box.max.y;
    // Con la animación el arma se mueve: mientras nadie toque la cámara solo se amplía el encuadre, nunca se encoge
    const nx = grow ? Math.max(this.reachX, x) : x;
    const nt = grow ? Math.max(this.reachTop, top) : top;
    const changed = Math.abs(nx - this.reachX) > 0.03 || Math.abs(nt - this.reachTop) > 0.03;
    this.reachX = nx;
    this.reachTop = nt;
    if (!this.touched && (!grow || changed)) this.frame();
  }
  private reachTick = 0;

  /** Efectos de un objeto ya colgado: partículas propias del modelo y brillos/encantamientos en los anclajes 0-4 del arma. */
  private async attachEffects(m: AttachedModel, inst: Object3D, stale: () => boolean) {
    const jobs: { file: number; anchor: Object3D; particles: boolean; mesh: boolean }[] = [];
    if (m.own) jobs.push({ file: m.file, anchor: inst, particles: true, mesh: false });
    const points = (inst.userData.attachments ?? []) as { id: number; pos: [number, number, number] }[];
    for (const ref of m.fx ?? []) {
      const at = points.find((a) => a.id === ref.attach);
      if (!at) continue;
      // Los anclajes vienen en ejes del M2 (x adelante, y izquierda, z arriba); el modelo está en los de glTF
      const anchor = new Object3D();
      anchor.position.set(at.pos[1], at.pos[2], at.pos[0]);
      inst.add(anchor);
      jobs.push({ file: ref.file, anchor, particles: ref.kind.includes("p"), mesh: ref.kind.includes("m") });
    }
    await Promise.all(jobs.map(async (j) => {
      const emitters = j.particles ? await loadEmitters(this.base, j.file) : null;
      const meshModel = j.mesh ? await this.loadItemModel(j.file) : null;
      if (stale()) return;
      if (meshModel) j.anchor.add(await this.itemInstance(meshModel, {}));
      for (const data of emitters ?? []) {
        const map = await this.particleTexture(data.tex);
        if (stale()) return;
        if (!map) continue;
        const e = new ParticleEmitter(data, j.anchor, map, this.pxScale);
        this.fxGroup.add(e.points);
        this.fx.push(e);
      }
    }));
  }

  private particleTextures = new Map<number, Promise<Texture | null>>();

  /** Textura de partículas: sin conversión de color (el juego multiplica los valores tal cual). */
  private particleTexture(file: number): Promise<Texture | null> {
    let p = this.particleTextures.get(file);
    if (!p) {
      p = new TextureLoader().loadAsync(this.textureUrl(file)).then((t) => {
        t.flipY = false;
        t.colorSpace = NoColorSpace;
        return t;
      }, () => null);
      this.particleTextures.set(file, p);
    }
    return p;
  }
  private attachSeq = 0;

  private texCache = new Map<string, Promise<Texture | null>>();

  /** Textura de un FileDataID (una sola descarga por fichero). null si no existe. */
  private tex(file: number): Promise<Texture | null> {
    const url = this.textureUrl(file);
    let p = this.texCache.get(url);
    if (!p) {
      p = new TextureLoader().loadAsync(url).then((t) => {
        t.flipY = false;
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      }, () => null);
      this.texCache.set(url, p);
    }
    return p;
  }

  /** Copia de un modelo de objeto con su material (textura según el tipo que pida cada malla). */
  private async itemInstance(scene: Object3D, textures: Record<number, number>): Promise<Object3D> {
    const inst = scene.clone(true);
    const jobs: Promise<void>[] = [];
    inst.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const b = ((mesh.userData as { batches?: BatchInfo[] }).batches ?? [])[0];
      const file = b?.texFile || textures[b?.texType ?? -1] || textures[-1];
      const blend = b?.blend ?? 0;
      jobs.push((async () => {
        const map = file ? await this.tex(file) : null;
        // Llamas y brillos (mezcla aditiva): se suman a lo que hay detrás, sin iluminar; sin su textura no se dibujan
        if (blend === 3 || blend === 4 || blend === 7) {
          mesh.visible = !!map;
          mesh.renderOrder = 10;
          mesh.material = new MeshBasicMaterial({ map, transparent: true, ...ADDITIVE, depthWrite: false, side: DoubleSide });
          return;
        }
        mesh.material = new MeshStandardMaterial({
          map, color: map ? 0xffffff : 0x9a8470, roughness: 0.7, metalness: 0.15,
          alphaTest: blend === 1 ? 0.5 : 0, transparent: blend >= 2, side: DoubleSide,
        });
      })());
    });
    await Promise.all(jobs);
    return inst;
  }

  private setMaterial(m: Mesh, b: BatchInfo | undefined, map: Texture | undefined) {
    const old = m.material as MeshStandardMaterial;
    old.dispose?.();
    const blend = b?.blend ?? 0;
    // Brillos (mezcla aditiva: el resplandor de los ojos «Primalista» y de otras opciones): se suman a lo que hay detrás, sin iluminar
    if (blend === 3 || blend === 4 || blend === 7) {
      m.renderOrder = 10;
      m.material = new MeshBasicMaterial({ map: map ?? null, transparent: true, ...ADDITIVE, depthWrite: false, side: DoubleSide });
      return;
    }
    m.renderOrder = 0;
    m.material = new MeshStandardMaterial({
      map: map ?? null, color: map ? 0xffffff : new Color(0x9a8470), roughness: 0.85, metalness: 0,
      alphaTest: blend === 1 ? 0.5 : 0, transparent: blend >= 2, side: b && b.texType === 6 ? DoubleSide : DoubleSide,
    });
  }

  /** Miniatura del personaje encuadrada en una zona del cuerpo (PNG en data URL, fondo transparente). */
  bust(kind: BustKind, size = 160): string {
    const p = BUST_PRESETS[kind];
    const h = this.modelHeight;
    const prevSize = this.renderer.getSize(new Vector2());
    const prevAspect = this.camera.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.fxGroup.visible = false;
    this.camera.position.set(p.x * h + Math.sin(p.yaw) * p.d * h, p.y * h + 0.04 * h, Math.cos(p.yaw) * p.d * h);
    this.camera.lookAt(p.x * h, p.y * h, 0);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    this.fxGroup.visible = this.effectsOn;
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  /** Primer plano de la cara: mira al punto de anclaje del casco (bajado `lift`, en alturas del modelo), de frente o girado `yaw`. */
  face(size = 400, yaw = 0, zoom = 1, lift = 0): string {
    const h = this.modelHeight;
    const head = new Vector3(0, h * 0.9, 0);
    this.root?.updateMatrixWorld(true);
    this.root?.getObjectByName("att_11")?.getWorldPosition(head);
    const headTop = head.y;
    head.y -= lift * h;
    const prevSize = this.renderer.getSize(new Vector2());
    const prevAspect = this.camera.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    this.fxGroup.visible = false;
    const d = Math.max(h * 0.3, (h - headTop) * 3) / zoom;
    this.camera.position.set(head.x + Math.sin(yaw) * d, head.y, head.z + Math.cos(yaw) * d);
    this.camera.lookAt(head);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    this.fxGroup.visible = this.effectsOn;
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  /** Miniatura de un modelo de objeto suelto (arma, escudo…), girado y encuadrado entero. */
  async objectBust(file: number, textures: Record<number, number>, size = 160): Promise<string | null> {
    const scene = await this.loadItemModel(file);
    if (!scene) return null;
    const inst = await this.itemInstance(scene, textures);
    const hidden = this.root;
    if (hidden) hidden.visible = false;
    this.fxGroup.visible = false;
    const box = new Box3().setFromObject(inst);
    const center = box.getCenter(new Vector3());
    const sz = box.getSize(new Vector3());
    const radius = sz.length() / 2;
    const holder = new Object3D();
    holder.add(inst);
    holder.rotation.y = -0.4;
    holder.position.copy(center).multiplyScalar(-1);
    const wrap = new Object3D();
    wrap.add(holder);
    // Las armas largas y finas se colocan en diagonal para llenar el cuadro.
    if (Math.max(sz.x, sz.y, sz.z) > 2.2 * Math.min(...[sz.x, sz.y, sz.z].sort((a, b) => a - b).slice(1))) wrap.rotation.z = Math.PI / 4;
    // Se encuadra lo que ocupa de verdad en pantalla (ya girado), no la esfera que envuelve al objeto: un arma larga y fina en diagonal llena el cuadro
    wrap.updateMatrixWorld(true);
    const placed = new Box3().setFromObject(wrap, true);
    const placedSize = placed.getSize(new Vector3());
    wrap.position.sub(placed.getCenter(new Vector3()));
    const half = Math.max(placedSize.x, placedSize.y) / 2;
    this.scene.add(wrap);
    const prevSize = this.renderer.getSize(new Vector2());
    const prevAspect = this.camera.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    const dist = (Math.max(half, radius * 0.2) * 1.08) / Math.tan((this.camera.fov * Math.PI) / 360) + placedSize.z / 2;
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL("image/png");
    this.scene.remove(wrap);
    if (hidden) hidden.visible = true;
    this.fxGroup.visible = this.effectsOn;
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
