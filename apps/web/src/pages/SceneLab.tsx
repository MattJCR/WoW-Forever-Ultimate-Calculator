// Fondos del probador a partir de los escenarios de la pantalla de selección de personaje (solo desarrollo):
// /scene-lab?s=human[&cam=0&fov=40&dx=0&dy=0&dz=0]. Lo maneja tools/model/render-scenes.mjs a través de window.__scene.
import { useEffect, useRef, useState } from "react";
import {
  AdditiveBlending, Color, DoubleSide, Mesh, MeshBasicMaterial, NormalBlending, Object3D, PerspectiveCamera, SRGBColorSpace, Scene,
  TextureLoader, WebGLRenderer, RepeatWrapping, type Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MODELS_BASE } from "../viewer/config";

interface Batch { texFile: number; blend: number; priority: number; layer: number; shader: number; color?: number[]; weight?: number }
interface SceneCamera { type: number; far: number; near: number; position: number[]; target: number[]; fov: number | null }

export interface SceneApi {
  cameras: SceneCamera[];
  /** Dibuja el escenario con la cámara indicada (con ajustes opcionales) y devuelve un PNG en data URL. */
  render(w: number, h: number, opts?: { cam?: number; fov?: number; dx?: number; dy?: number; dz?: number; tx?: number; ty?: number; tz?: number }): string;
}

/** Ejes de WoW (x adelante, y izquierda, z arriba) a los del glTF (y arriba, z adelante, x izquierda). */
const P = ([x, y, z]: number[]): [number, number, number] => [y!, z!, x!];

export function SceneLab({ query }: { query: URLSearchParams }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("cargando");
  const name = query.get("s") ?? "human";

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!canvas.current) return;
      const renderer = new WebGLRenderer({ canvas: canvas.current, antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      const info = await fetch(`${MODELS_BASE}/scene/${name}.json`).then((r) => r.json() as Promise<{ cameras: SceneCamera[]; skip?: number[] }>);
      const skip = new Set([...(info.skip ?? []), ...(query.get("skip") ?? "").split(",").map(Number)]);
      const gltf = await new GLTFLoader().loadAsync(`${MODELS_BASE}/scene/${name}.glb`);
      const loader = new TextureLoader();
      const cache = new Map<number, Promise<Texture | null>>();
      const tex = (f: number) => {
        let p = cache.get(f);
        if (!p) {
          p = loader.loadAsync(`${MODELS_BASE}/tex/${f}.webp`).then((t) => { t.flipY = false; t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; return t; }, () => null);
          cache.set(f, p);
        }
        return p;
      };
      const scene = new Scene();
      scene.background = new Color(0x000000);
      const jobs: Promise<void>[] = [];
      const metas: { mesh: Mesh; order: number }[] = [];
      gltf.scene.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const batches = ((m.userData as { batches?: Batch[] }).batches ?? []).filter((b) => b.texFile && !skip.has(b.texFile));
        batches.forEach((b) => jobs.push((async () => {
          const map = await tex(b.texFile);
          if (!map) return;
          const additive = b.blend === 3 || b.blend === 4 || b.blend === 7;
          const [r = 1, g = 1, bl = 1, a = 1] = b.color ?? [1, 1, 1, 1];
          const opacity = a * (b.weight ?? 1);
          if (opacity < 0.02) return;
          const mat = new MeshBasicMaterial({
            map, color: new Color(r, g, bl), opacity, side: DoubleSide, transparent: b.blend >= 2 || opacity < 1, alphaTest: b.blend === 1 ? 0.5 : 0,
            blending: additive ? AdditiveBlending : NormalBlending, depthWrite: b.blend < 2,
          });
          const copy = new Mesh(m.geometry, mat);
          copy.frustumCulled = false;
          copy.applyMatrix4(m.matrixWorld);
          copy.renderOrder = b.priority * 10 + b.layer + (b.blend >= 2 ? 1000 : 0);
          scene.add(copy);
          metas.push({ mesh: copy, order: copy.renderOrder });
        })()));
      });
      gltf.scene.updateMatrixWorld(true);
      await Promise.all(jobs);
      if (dead) return;
      const api: SceneApi = {
        cameras: info.cameras,
        render(w, h, o = {}) {
          const c = info.cameras[o.cam ?? 0];
          if (!c) throw new Error("sin cámara");
          const pos = P(c.position), tgt = P(c.target);
          const cam = new PerspectiveCamera(o.fov ?? 40, w / h, Math.max(0.05, c.near), Math.max(c.far, 200));
          cam.position.set(pos[0] + (o.dx ?? 0), pos[1] + (o.dy ?? 0), pos[2] + (o.dz ?? 0));
          cam.lookAt(tgt[0] + (o.tx ?? 0), tgt[1] + (o.ty ?? 0), tgt[2] + (o.tz ?? 0));
          renderer.setSize(w, h, false);
          renderer.render(scene, cam);
          return canvas.current!.toDataURL("image/png");
        },
      };
      (window as unknown as { __scene: SceneApi }).__scene = api;
      setStatus("listo");
    })().catch((e) => setStatus("error: " + e));
    return () => { dead = true; };
  }, [name]);

  return (
    <div>
      <p id="scene-status">{status}</p>
      <canvas ref={canvas} width={400} height={600} style={{ width: 400, height: 600, background: "#222" }} />
    </div>
  );
}
