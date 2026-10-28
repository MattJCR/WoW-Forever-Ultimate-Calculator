import { useEffect, useState } from "react";
import { currentLang } from "./i18n";
import { pagePath, parsePath, queryString, type Lang, type Page, type SeoIndex } from "./seo/routes";

export interface Route {
  /** Idioma de la URL (/es/…, /en/…); null en la raíz, el probador insertable y las pantallas de pruebas. */
  lang: Lang | null;
  page: Page;
  query: URLSearchParams;
}

const NAVIGATE = "wfuc:navigate";

/** Índice de slugs vigente: lo fija `App` al cargarlo, antes de interpretar ninguna ruta. */
let seoIndex: SeoIndex | null = null;
export const setSeoIndex = (index: SeoIndex | null): void => {
  seoIndex = index;
};
export const getSeoIndex = (): SeoIndex | null => seoIndex;

/** Ruta base donde se sirve la web, sin barra final: «» en un dominio propio, «/repositorio» en GitHub Pages. */
const basePrefix = import.meta.env.BASE_URL.replace(/\/+$/, "");
export const withBase = (path: string): string => `${basePrefix}${path}`;

/** Ruta de la dirección actual del navegador. */
export function readRoute(): Route {
  const query = new URLSearchParams(window.location.search);
  if (!seoIndex) return { lang: null, page: { kind: "not-found" }, query };
  const { pathname } = window.location;
  const { lang, page } = parsePath(pathname.startsWith(basePrefix) ? pathname.slice(basePrefix.length) : pathname, seoIndex);
  return { lang, page, query };
}

/**
 * Ruta actual, actualizada al navegar (enlaces de la web y botones atrás/adelante). Los cambios internos con `replaceUrl` no la cambian.
 * Solo se usa una vez cargado el índice de slugs (`setSeoIndex`).
 */
export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => onNavigate(() => setRoute(readRoute())), []);
  return route;
}

/** Avisa a quien escuche los cambios de dirección (enlaces nuevos, atrás/adelante) sin pasar por React Router. */
export function onNavigate(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAVIGATE, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAVIGATE, cb);
  };
}

/** Enlace a una página, en el idioma dado (por defecto el vigente), con su consulta: `/es/clases/mago?b=…`. */
export function href(page: Page, query?: Record<string, string>, lang: Lang = currentLang()): string {
  const path = seoIndex ? pagePath(page, lang, seoIndex) : null;
  return `${withBase(path ?? `/${lang}/`)}${queryString(query)}`;
}

/** Va a otra dirección de la web sin recargar. */
export function navigate(url: string, opts: { replace?: boolean } = {}): void {
  const target = new URL(url, window.location.href);
  const next = target.pathname + target.search + target.hash;
  if (next === window.location.pathname + window.location.search + window.location.hash && !opts.replace) return;
  if (opts.replace) window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
  window.dispatchEvent(new Event(NAVIGATE));
  if (!target.hash && !opts.replace) window.scrollTo(0, 0);
}

/** Cambia la URL sin añadir entradas al historial ni avisar a nadie (para guardar el build mientras se edita). */
export function replaceUrl(page: Page, query: Record<string, string>): void {
  window.history.replaceState(null, "", href(page, query));
}

/** Baja a una sección de la portada. Si la URL no cambia (ya estás en esa sección) no hay navegación, así que se hace al pulsar. */
export const scrollToSection = (id: string): void => {
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
};

/**
 * Los enlaces internos (`<a href="/es/clases/mago">`) navegan sin recargar la página. Se deja pasar al navegador lo que no es una
 * página de la web: otra pestaña, descargas, ficheros (licencias, datos), anclas de la misma página y clics con teclas modificadoras.
 */
export function installLinkInterception(): void {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || /\.[a-z0-9]+$/i.test(url.pathname)) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
}
