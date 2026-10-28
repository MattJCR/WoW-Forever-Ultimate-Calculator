import { useEffect } from "react";
import { useLang } from "../i18n";

/** Quita el HTML prerenderizado (`#prerender`) que cubre la página mientras carga: la página real ya tiene su contenido. */
export const releasePrerender = (): void => document.getElementById("prerender")?.remove();

/**
 * Cada página llama a esto cuando ya pinta su contenido real (no el «Cargando…»). El HTML prerenderizado sigue visible hasta
 * entonces, así que no hay un hueco en blanco entre el HTML del servidor y la página interactiva. Con English elegido espera
 * también a sus textos para no enseñar un instante en español.
 */
export function usePrerenderHandoff(ready = true): void {
  const { dataStatus } = useLang();
  useEffect(() => {
    if (ready && dataStatus !== "loading") releasePrerender();
  }, [ready, dataStatus]);
}
