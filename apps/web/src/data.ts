import { ClassTalents, Manifest, Races, Unassigned } from "@wfuc/schema";
import { useEffect, useState } from "react";

const base = import.meta.env.BASE_URL;

export async function getJson<T>(path: string, parse: (v: unknown) => T): Promise<T> {
  const res = await fetch(`${base}data/${path}`);
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`);
  return parse(await res.json());
}

export const loadManifest = () => getJson("manifest.json", (v) => Manifest.parse(v));
export const loadClass = (file: string) => getJson(file, (v) => ClassTalents.parse(v));
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
