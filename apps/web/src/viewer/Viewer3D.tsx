import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterView, ViewState } from "./scene";
import { loadAppearance } from "./appearance";
import { resolveEquipment, type Equipped } from "./equipment";
import { defaultSelection, type Recipe, type Selection } from "./recipe";

import { MODELS_BASE } from "./config";

interface Props {
  chrModelId: number;
  /** ChrRaces.ID de la raza (los cascos ocultan cosas distintas según la raza). */
  race: number;
  /** Elección de personalización; si falta se usa la primera de cada opción. */
  selection?: Selection;
  equipped?: Equipped[];
  /** Congela la animación. */
  paused?: boolean;
  /** Animación elegida a mano; si falta, la que corresponde a las armas. */
  pose?: string;
  /** Armas envainadas. */
  sheathed?: boolean;
  onClips?: (names: string[]) => void;
  onRecipe?: (recipe: Recipe) => void;
  className?: string;
}

/** Lienzo 3D del personaje. Carga three.js y el modelo solo cuando se monta. */
export function Viewer3D({ chrModelId, race, selection, equipped, paused, pose, sheathed, onClips, onRecipe, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const view = useRef<CharacterView | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedModel = useRef<number | null>(null);

  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | undefined;
    setLoading(true);
    setError(null);
    (async () => {
      const { CharacterView } = await import("./scene");
      if (dead || !canvas.current || !holder.current) return;
      const v = view.current ?? new CharacterView(canvas.current, MODELS_BASE);
      view.current = v;
      const fit = () => holder.current && v.resize(holder.current.clientWidth, holder.current.clientHeight);
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(holder.current);
      try {
        const r = await v.load(chrModelId);
        if (dead) return;
        loadedModel.current = chrModelId;
        setRecipe(r);
        onRecipe?.(r);
        onClips?.(v.clipNames());
        setLoading(false);
      } catch (e) {
        if (!dead) setError(String(e));
      }
    })();
    return () => { dead = true; ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chrModelId]);

  const equippedKey = useMemo(() => JSON.stringify(equipped ?? []), [equipped]);
  const selKey = JSON.stringify(selection ?? null);

  useEffect(() => {
    const v = view.current;
    if (!v || !recipe || loading || loadedModel.current !== chrModelId) return;
    let dead = false;
    (async () => {
      const state: ViewState = { selection: selection ?? defaultSelection(recipe) };
      const list: Equipped[] = JSON.parse(equippedKey);
      if (list.length) {
        const ap = await loadAppearance(MODELS_BASE);
        if (ap) {
          const e = resolveEquipment(ap, race, recipe.sex, list, v.textureUrl, { sheathed });
          Object.assign(state, {
            extraGeosets: e.geosets, hiddenGroups: e.hiddenGroups, overlays: e.overlays, helmetHides: e.helmetHides,
            models: e.models, objectTextures: e.objectTextures, pose: e.pose,
          });
        }
      }
      if (pose) state.pose = pose;
      if (!dead) await v.apply(state);
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, loading, selKey, equippedKey, race, chrModelId, pose, sheathed]);

  useEffect(() => { view.current?.setPaused(!!paused); }, [paused, loading]);

  useEffect(() => () => { view.current?.dispose(); view.current = null; }, []);

  return (
    <div ref={holder} className={className} style={{ position: "relative", width: "100%", height: "100%", minHeight: 320 }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      {loading && !error && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: 0.7 }}>Cargando…</div>}
      {error && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#e88" }}>{error}</div>}
    </div>
  );
}
