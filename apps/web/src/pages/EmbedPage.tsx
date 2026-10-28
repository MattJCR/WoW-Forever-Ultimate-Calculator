// Probador 3D a pantalla completa, sin cabecera ni pie, para insertarlo en otra web (iframe): /embed?r=<raza>&g=<equipo>&a=<aspecto>
import { decodeGear } from "@wfuc/engine";
import type { Manifest } from "@wfuc/schema";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useGearBundle } from "../data";
import { tr } from "../i18n";
import { decodeAvatar, loadModelIndex, type ModelIndexEntry } from "../viewer/avatar";
import { BackdropArt, backdropOfRace } from "../viewer/backdrops";
import type { Equipped } from "../viewer/equipment";
import { defaultSelection, type Recipe } from "../viewer/recipe";

const Viewer3D = lazy(() => import("../viewer/Viewer3D").then((m) => ({ default: m.Viewer3D })));

export function EmbedPage({ manifest, query }: { manifest: Manifest; query: URLSearchParams }) {
  const avatar = useMemo(() => decodeAvatar(query.get("a")), [query]);
  const raceId = avatar.race ?? (Number(query.get("r")) || 1);
  const gear = useMemo(() => decodeGear(query.get("g")).gear, [query]);
  const bundle = useGearBundle(manifest, Object.keys(gear).length > 0);
  const [index, setIndex] = useState<ModelIndexEntry[] | null | undefined>(undefined);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  useEffect(() => { void loadModelIndex().then(setIndex); }, []);

  const entry = index?.find((e) => e.race === raceId && e.sex === avatar.sex);
  const equipped = useMemo<Equipped[]>(() => {
    if (bundle?.status !== "ready") return [];
    return Object.entries(gear).flatMap(([slot, worn]) => {
      const item = worn ? bundle.value.data.items.get(worn.itemId) : undefined;
      return item ? [{ slot, inventoryType: item.inventoryType, classId: item.classId, subclassId: item.subclassId, itemId: item.id, enchantId: worn?.enchantId ?? null }] : [];
    });
  }, [bundle, gear]);
  const selection = useMemo(() => (recipe ? { ...defaultSelection(recipe), ...avatar.choices } : undefined), [recipe, avatar.choices]);
  const sceneId = avatar.bg ?? backdropOfRace(raceId);

  if (index === undefined || (Object.keys(gear).length > 0 && (!bundle || bundle.status === "loading"))) return <p className="muted small embed-page">{tr("Cargando…")}</p>;
  if (!entry) return <p className="muted small embed-page">{tr("El probador 3D no tiene modelos en esta versión de la web.")}</p>;
  return (
    <div className="embed-page">
      <div className="avatar-stage" data-scene={sceneId || undefined}>
        <BackdropArt id={sceneId} />
        <Suspense fallback={null}>
          <Viewer3D chrModelId={entry.chrModel} race={raceId} selection={selection} equipped={equipped} onRecipe={setRecipe} sheathed={!!avatar.sheathed} sheathedRanged={!!avatar.sheathedRanged} />
        </Suspense>
      </div>
    </div>
  );
}
