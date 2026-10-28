import { indexBuffs, indexGearData, type BuffIndex, type GearData } from "@wfuc/engine";
import { Abilities, Buffs, ClassTalents, CombatRatings, Enchants, EquipRules, ItemSources, Items, Manifest, RandomSuffixes, Races, Unassigned, WeaponEnhancements } from "@wfuc/schema";
import { useEffect, useState } from "react";
import { tr } from "./i18n";
import type { SeoIndex } from "./seo/routes";

const base = import.meta.env.BASE_URL;

/** Lector alternativo de los JSON de datos (el prerender los lee del disco en lugar de pedirlos por red). */
const parsedCache = new Map<string, unknown>();
let jsonLoader: ((path: string) => Promise<unknown>) | null = null;
export const setJsonLoader = (load: ((path: string) => Promise<unknown>) | null): void => {
  jsonLoader = load;
};

export async function getJson<T>(path: string, parse: (v: unknown) => T): Promise<T> {
  if (jsonLoader) {
    // Prerender: cada fichero se lee y se valida una vez aunque lo pidan cientos de páginas
    if (!parsedCache.has(path)) parsedCache.set(path, parse(await jsonLoader(path)));
    return parsedCache.get(path) as T;
  }
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(tr("No se pudo cargar {path} ({status})", { path, status: res.status }));
  return parse(await res.json());
}

export const loadManifest = () => getJson("manifest.json", (v) => Manifest.parse(v));
export const loadClass = (file: string) => getJson(file, (v) => ClassTalents.parse(v));
export const loadSeoIndex = () => getJson("seo-index.json", (v) => v as SeoIndex);
export const loadAbilities = (token: string) => getJson(`abilities/${token}.json`, (v) => Abilities.parse(v));
export const loadUnassigned = () => getJson("unassigned.json", (v) => Unassigned.parse(v));
export const loadRaces = (file: string) => getJson(file, (v) => Races.parse(v));
export const loadLegacy = (file: string) => getJson(file, (v) => ClassTalents.parse(v));

export type Async<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

/** Carga un recurso al montar o cuando cambia la clave. */
export function useAsync<T>(key: string, load: () => Promise<T>): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    load().then(
      (value) => live && setState({ status: "ready", value }),
      (e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Iconos de raza que el cliente no trae (ClientFileString → ruta en `public/`). */
export const STATIC_RACE_ICONS: Record<string, string> = { Skyborne: "race/skyborne.png" };

/** Color de cada clase (los de la interfaz del juego). Clave: ChrClasses.Filename en minusculas. */
export const CLASS_COLORS: Record<string, string> = {
  warrior: "#c79c6e",
  paladin: "#f58cba",
  hunter: "#abd473",
  rogue: "#fff569",
  priest: "#ffffff",
  shaman: "#0070de",
  mage: "#69ccf0",
  warlock: "#9482c9",
  druid: "#ff7d0a",
};

/** Beneficios («buffs») de clase, tótems y consumibles: se descargan al abrir el Resumen o si el enlace ya trae alguno. */
export function useBuffs(manifest: Manifest, enabled: boolean): Async<BuffIndex> | null {
  const file = manifest.buffs?.file;
  const [state, setState] = useState<Async<BuffIndex> | null>(null);
  useEffect(() => {
    if (!enabled || !file) return;
    let live = true;
    setState((s) => s ?? { status: "loading" });
    getJson(file, (v) => indexBuffs(Buffs.parse(v))).then(
      (value) => live && setState({ status: "ready", value }),
      (e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [file, enabled]);
  return state;
}

/** Datos de equipo: objetos (unos 7 MB), reglas de equipar, encantamientos, sufijos y puntuaciones. Se descargan una sola vez y solo al usarlos. */
export interface GearBundle {
  data: GearData;
  ratings: CombatRatings | null;
  /** true = faltan encantamientos, sufijos o puntuaciones (no se generaron con la comunidad). */
  partial: boolean;
}

const gearCache = new Map<string, Promise<GearBundle>>();

export function loadGear(manifest: Manifest): Promise<GearBundle> {
  const key = manifest.build;
  let hit = gearCache.get(key);
  if (!hit) {
    hit = (async () => {
      if (!manifest.items || !manifest.equipRules) throw new Error("Estos datos no incluyen objetos: ejecuta `ITEMS=1 HOTFIXES=1 tools/extract/export-tables.sh` y `npm run pipeline`");
      const [items, rules, enchants, suffixes, ratings, sources, weaponEnhancements] = await Promise.all([
        getJson(manifest.items.file, (v) => Items.parse(v)),
        getJson(manifest.equipRules.file, (v) => EquipRules.parse(v)),
        manifest.enchants ? getJson(manifest.enchants.file, (v) => Enchants.parse(v)) : Promise.resolve(null),
        manifest.randomSuffixes ? getJson(manifest.randomSuffixes.file, (v) => RandomSuffixes.parse(v)) : Promise.resolve(null),
        manifest.combatRatings ? getJson(manifest.combatRatings.file, (v) => CombatRatings.parse(v)) : Promise.resolve(null),
        manifest.itemSources ? getJson(manifest.itemSources.file, (v) => ItemSources.parse(v)) : Promise.resolve(null),
        manifest.weaponEnhancements ? getJson(manifest.weaponEnhancements.file, (v) => WeaponEnhancements.parse(v)) : Promise.resolve(null),
      ]);
      return { data: indexGearData({ items, rules, enchants, suffixes, sources, weaponEnhancements }), ratings, partial: !enchants || !suffixes || !ratings };
    })();
    gearCache.set(key, hit);
    hit.catch(() => gearCache.delete(key)); // un fallo de red no se queda en la cache
  }
  return hit;
}

/** Carga los datos de equipo cuando `enabled` pasa a true (el paso Equipo, o un enlace que ya lleva equipo). */
export function useGearBundle(manifest: Manifest, enabled: boolean): Async<GearBundle> | null {
  const [state, setState] = useState<Async<GearBundle> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => s ?? { status: "loading" });
    loadGear(manifest).then(
      (value) => live && setState({ status: "ready", value }),
      (e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [manifest, enabled]);
  return state;
}
