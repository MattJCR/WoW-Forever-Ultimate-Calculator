// Composición de las texturas del personaje (piel, pelo, ojos) en un lienzo, como hace el cliente:
// capas por orden, unas a todo el atlas y otras solo en las secciones del cuerpo/cara que indica su máscara.
import type { Recipe, RecipeLayer, Resolved } from "./recipe";

const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** Rectángulo que cubren las secciones de la máscara (unión). Máscara -1 = atlas entero. */
export function maskRect(recipe: Recipe, mask: number) {
  if (mask === -1) return { x: 0, y: 0, w: recipe.layout.width, h: recipe.layout.height };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of recipe.layout.sections) {
    if (s.type > 30 || !(mask & (1 << s.type))) continue;
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h);
  }
  return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const COMPOSITE: Record<number, GlobalCompositeOperation> = {};

export interface Overlay {
  /** Sección del atlas (0 brazo superior, 1 antebrazo, 2 mano, 3 torso superior…) donde se pinta. */
  section: number;
  url: string;
}

export interface ComposeOptions {
  textureUrl: (fileDataId: number) => string;
  overlays?: Overlay[];
}

export async function composeTexture(recipe: Recipe, textureType: number, resolved: Resolved, opts: ComposeOptions): Promise<HTMLCanvasElement | null> {
  const mat = recipe.materials.find((m) => m.type === textureType);
  if (!mat) return null;
  const canvas = document.createElement("canvas");
  canvas.width = mat.width;
  canvas.height = mat.height;
  const ctx = canvas.getContext("2d")!;
  const sx = mat.width / recipe.layout.width, sy = mat.height / recipe.layout.height;
  const layers: RecipeLayer[] = recipe.layers.filter((l) => l.textureType === textureType);
  for (const layer of layers) {
    const file = resolved.targets.get(layer.target);
    if (!file) continue;
    const img = await loadImage(opts.textureUrl(file));
    if (!img) continue;
    const r = maskRect(recipe, layer.sectionMask);
    if (!r) continue;
    ctx.globalCompositeOperation = COMPOSITE[layer.blend] ?? "source-over";
    ctx.drawImage(img, r.x * sx, r.y * sy, r.w * sx, r.h * sy);
  }
  ctx.globalCompositeOperation = "source-over";
  if (textureType === 1) {
    for (const o of opts.overlays ?? []) {
      const s = recipe.layout.sections.find((x) => x.type === o.section);
      const img = s ? await loadImage(o.url) : null;
      if (s && img) ctx.drawImage(img, s.x * sx, s.y * sy, s.w * sx, s.h * sy);
    }
  }
  return canvas;
}
