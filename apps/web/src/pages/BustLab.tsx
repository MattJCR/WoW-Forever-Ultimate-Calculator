// Generador de miniaturas 3D (solo desarrollo): #/bust-lab?m=1&r=1
// Lo maneja tools/model/render-busts.mjs a través de window.__bust.
import { useEffect, useRef, useState } from "react";
import { MODELS_BASE } from "../viewer/config";
import { loadAppearance } from "../viewer/appearance";
import { resolveEquipment } from "../viewer/equipment";
import { defaultSelection } from "../viewer/recipe";
import type { BustKind, CharacterView } from "../viewer/scene";

const BASE = MODELS_BASE;

export interface BustApi {
  /** Miniatura de una pieza de armadura sobre el personaje base. */
  armor(itemId: number, inventoryType: number, kind: BustKind): Promise<string>;
  /** Miniatura de un arma o escudo suelto. */
  object(itemId: number, inventoryType: number): Promise<string | null>;
  /** Personaje desnudo, para comprobar el modelo base. */
  base(kind: BustKind, size?: number): Promise<string>;
  /** Primer plano de la cara de frente (yaw 0) o girada. */
  face(size?: number, yaw?: number, zoom?: number, lift?: number): Promise<string>;
  /** Primer plano de la cara con un casco puesto. */
  faceWithHelm(itemId: number, size?: number, yaw?: number, zoom?: number): Promise<string>;
}

export function BustLab({ query }: { query: URLSearchParams }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("cargando");
  const chrModel = Number(query.get("m") ?? 1);
  const race = Number(query.get("r") ?? 1);

  useEffect(() => {
    let dead = false;
    let view: CharacterView | null = null;
    (async () => {
      const { CharacterView } = await import("../viewer/scene");
      if (dead || !canvas.current) return;
      view = new CharacterView(canvas.current, BASE);
      const recipe = await view.load(chrModel);
      const ap = await loadAppearance(BASE);
      if (!ap) { setStatus("sin appearance.json"); return; }
      // a=opcion-eleccion~opcion-eleccion: cambia elecciones respecto a las de por defecto
      const picked = Object.fromEntries((query.get("a") ?? "").split("~").filter(Boolean).map((p) => p.split("-").map(Number) as [number, number]));
      const selection = { ...defaultSelection(recipe), ...picked };
      const v = view;
      const api: BustApi = {
        async armor(itemId, inventoryType, kind) {
          const e = resolveEquipment(ap, race, recipe.sex, [{ slot: "armor", inventoryType, classId: 4, subclassId: 0, itemId }], v.textureUrl);
          await v.apply({ selection, extraGeosets: e.geosets, hiddenGroups: e.hiddenGroups, overlays: e.overlays, helmetHides: e.helmetHides, models: e.models, objectTextures: e.objectTextures, pose: "Stand" });
          return v.bust(kind);
        },
        async object(itemId, inventoryType) {
          const e = resolveEquipment(ap, race, recipe.sex, [{ slot: "mainHand", inventoryType, classId: 2, subclassId: 0, itemId }], v.textureUrl);
          const m = e.models[0];
          return m ? v.objectBust(m.file, m.textures) : null;
        },
        async base(kind, size) {
          await v.apply({ selection, pose: "Stand" });
          return v.bust(kind, size);
        },
        async faceWithHelm(itemId, size, yaw, zoom) {
          const e = resolveEquipment(ap, race, recipe.sex, [{ slot: "armor", inventoryType: 1, classId: 4, subclassId: 0, itemId }], v.textureUrl);
          await v.apply({ selection, extraGeosets: e.geosets, hiddenGroups: e.hiddenGroups, overlays: e.overlays, helmetHides: e.helmetHides, models: e.models, objectTextures: e.objectTextures, pose: "Stand" });
          return v.face(size, yaw, zoom);
        },
        async face(size, yaw, zoom, lift) {
          await v.apply({ selection, pose: "Stand" });
          return v.face(size, yaw, zoom, lift);
        },
      };
      (window as unknown as { __bust: BustApi }).__bust = api;
      setStatus("listo");
    })();
    return () => { dead = true; view?.dispose(); };
  }, [chrModel, race]);

  return (
    <div>
      <p id="bust-status">{status}</p>
      <canvas ref={canvas} width={320} height={320} style={{ width: 320, height: 320, background: "#222" }} />
    </div>
  );
}
