import { useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

/** Ruta basada en '#': #/class/mage?b=5500-0-23. Funciona en GitHub Pages sin configurar el servidor. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [p = "", q = ""] = raw.split("?");
  return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const href = (path: string, query?: Record<string, string>): string => {
  const q = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  return `#/${path}${q}`;
};

/** Baja a una seccion de la portada. Si la URL no cambia (ya estas en esa seccion) no hay hashchange, asi que se hace al pulsar. */
export const scrollToSection = (id: string): void => {
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
};

/** Cambia la URL sin anadir entradas al historial (para guardar el build mientras se edita). */
export function replaceHash(path: string, query: Record<string, string>): void {
  const url = `${window.location.pathname}${window.location.search}${href(path, query)}`;
  window.history.replaceState(null, "", url);
}
