import { useEffect } from "react";
import { getSeoIndex } from "../router";
import { headTags, type PageMeta } from "./meta";
import { pagePath, type Lang, type Page } from "./routes";

/**
 * Pone título, descripción, canonical, hreflang, Open Graph y datos estructurados de la página en el <head>.
 * Sustituye las etiquetas `data-seo` (las del HTML prerenderizado y las de la página anterior).
 */
export function useSeo(meta: PageMeta | null, page: Page, lang: Lang | null): void {
  const key = meta ? `${meta.title}|${meta.description}|${meta.noindex ? 1 : 0}` : "";
  useEffect(() => {
    const index = getSeoIndex();
    if (!meta || !index) return;
    const tags = headTags(meta, page, lang, index, lang ? pagePath(page, lang, index) : null);
    document.head.querySelectorAll("[data-seo]").forEach((el) => el.remove());
    document.title = meta.title;
    for (const t of tags) {
      const el = document.createElement(t.tag);
      el.setAttribute("data-seo", "");
      for (const [k, v] of Object.entries(t.attrs)) el.setAttribute(k, v);
      if (t.text) el.textContent = t.text;
      document.head.appendChild(el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(page), lang]);
}
