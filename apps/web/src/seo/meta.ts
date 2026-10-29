// Metadatos de cada página (título, descripción, canonical, hreflang, Open Graph, datos estructurados).
// Módulo puro: la web los aplica al <head> al navegar y el prerender los escribe en el HTML de cada página.
import { alternates, LANGS, type Lang, type Page, type SeoIndex } from "./routes";

export interface PageMeta {
  /** Título de la pestaña y de los resultados de búsqueda (≈ 60 caracteres). */
  title: string;
  /** Descripción para los resultados de búsqueda y al compartir (≈ 155 caracteres). */
  description: string;
  /** Página que no debe indexarse (pantallas auxiliares). */
  noindex?: boolean;
  /** Tipo Open Graph. */
  type?: "website" | "article";
  /** Imagen para compartir (ruta de `public/`); por defecto la de las páginas de una clase o la general. */
  image?: string;
  /** Datos estructurados (JSON-LD). */
  jsonLd?: object[];
}

export interface HeadTag {
  tag: "meta" | "link" | "script";
  attrs: Record<string, string>;
  /** Contenido del <script type="application/ld+json">. */
  text?: string;
}

declare const __SITE_URL__: string;

/** Dirección pública de la web sin barra final; vacía si no se conoce (entonces se usan rutas relativas). */
export const siteUrl = (): string => (typeof __SITE_URL__ === "string" ? __SITE_URL__ : "");

export const SITE_NAME = "WoW Forever Ultimate Calculator";
const OG_IMAGE = "/og-image.png";
const LOCALE: Record<Lang, string> = { es: "es_ES", en: "en_US" };

/**
 * Recorta un texto a `max` caracteres sin partir frases: entran las frases completas que caben. Si ni la primera cabe, se
 * corta en la última coma o punto y coma (o, en su defecto, en una palabra) y se añade «…».
 */
export function clip(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const sentences = flat.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"'«¿¡(])/u);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out.length >= MIN_CLIP) return out;
  const cut = flat.slice(0, max - 1);
  const clause = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "));
  const at = clause >= MIN_CLIP ? clause : Math.max(cut.lastIndexOf(" "), max - 30);
  return `${cut.slice(0, at).replace(/[\s,;:.–-]+$/, "")}…`;
}

/** Una descripción más corta que esto se completa con otra frase o se corta en una coma en vez de quedarse corta. */
const MIN_CLIP = 70;

/** Texto del juego como frases sueltas: cada línea acaba en punto (el cliente separa «Requiere…» del efecto con un salto de línea). */
export function sentences(text: string): string {
  return plain(text.replace(/([^.!?:;,\s])[ \t]*\r?\n+/g, "$1. "));
}

/** Quita las marcas de color y de formato del texto del juego ($, |c…|r, saltos de línea). */
export function plain(text: string): string {
  return text.replace(/\|c[0-9a-f]{8}|\|r/gi, "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

const abs = (path: string): string => `${siteUrl()}${path}`;

/** Imagen al compartir: las páginas de una clase llevan la de su clase (`scripts/make-og-image.mjs`), el resto la general. */
const shareImage = (page: Page, lang: Lang | null): string => ("cls" in page && lang ? `/og/${lang}/${page.cls}.png` : OG_IMAGE);

/** Etiquetas del <head> de una página. `canonicalPath` es la ruta de esta página; `page` sirve para enlazar la misma en el otro idioma. */
export function headTags(meta: PageMeta, page: Page, lang: Lang | null, index: SeoIndex, canonicalPath: string | null): HeadTag[] {
  const tags: HeadTag[] = [];
  const meta_ = (key: "name" | "property", name: string, content: string) => tags.push({ tag: "meta", attrs: { [key]: name, content } });
  meta_("name", "description", meta.description);
  if (meta.noindex) meta_("name", "robots", "noindex, follow");
  if (canonicalPath && !meta.noindex) {
    tags.push({ tag: "link", attrs: { rel: "canonical", href: abs(canonicalPath) } });
    const alts = alternates(page, index);
    for (const l of LANGS) if (alts[l]) tags.push({ tag: "link", attrs: { rel: "alternate", hreflang: l, href: abs(alts[l]!) } });
    if (alts.en) tags.push({ tag: "link", attrs: { rel: "alternate", hreflang: "x-default", href: abs(alts.en) } });
  }
  meta_("property", "og:site_name", SITE_NAME);
  meta_("property", "og:type", meta.type ?? "website");
  meta_("property", "og:title", meta.title);
  meta_("property", "og:description", meta.description);
  if (canonicalPath) meta_("property", "og:url", abs(canonicalPath));
  if (lang) {
    meta_("property", "og:locale", LOCALE[lang]);
    meta_("property", "og:locale:alternate", LOCALE[lang === "es" ? "en" : "es"]);
  }
  const image = abs(meta.image ?? shareImage(page, lang));
  meta_("property", "og:image", image);
  meta_("property", "og:image:width", "1200");
  meta_("property", "og:image:height", "630");
  meta_("name", "twitter:card", "summary_large_image");
  meta_("name", "twitter:title", meta.title);
  meta_("name", "twitter:description", meta.description);
  meta_("name", "twitter:image", image);
  for (const ld of meta.jsonLd ?? []) tags.push({ tag: "script", attrs: { type: "application/ld+json" }, text: JSON.stringify(ld) });
  return tags;
}

export interface LdLink {
  name: string;
  path: string;
}

/** Qué datos estructurados lleva una página. */
export interface LdSpec {
  /** Tipo de página: `CollectionPage` para listas, `ItemPage` para la de una sola cosa (talento, habilidad, raza). */
  kind?: "WebPage" | "CollectionPage" | "ItemPage";
  /** Migas de pan de la portada a esta página (la última es la propia página). Vacío en la portada. */
  crumbs: LdLink[];
  /** De qué trata la página, cuando es una sola cosa (talento, habilidad, raza, clase). */
  about?: { name: string; description?: string };
  /** Lista que presenta la página (los talentos, las habilidades…). */
  items?: LdLink[];
  /** La página es la entrada a una herramienta: se declara como aplicación web gratuita. */
  app?: { name: string; description: string };
}

const absId = (path: string, fragment: string): string => `${abs(path)}#${fragment}`;

/**
 * Datos estructurados de una página (JSON-LD, un solo `@graph`): el sitio, la página con su tipo, las migas de pan y, según la
 * página, la lista que presenta y la aplicación web. Solo datos que la página muestra de verdad: sin valoraciones, preguntas
 * frecuentes ni autores inventados.
 */
export function pageLd(meta: Pick<PageMeta, "title" | "description">, lang: Lang | null, here: string, spec: LdSpec): object {
  const home = spec.crumbs[0]?.path ?? here;
  const site = { "@id": absId(home, "website") };
  const page = { "@id": absId(here, "webpage") };
  const nodes: object[] = [{ "@type": "WebSite", ...site, name: SITE_NAME, url: abs(home), ...(lang ? { inLanguage: lang } : {}) }];
  const main: Record<string, unknown> = {};
  if (spec.app) {
    const id = { "@id": absId(here, "app") };
    nodes.push({
      "@type": "WebApplication",
      ...id,
      name: spec.app.name,
      description: spec.app.description,
      url: abs(here),
      applicationCategory: "GameApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      ...(lang ? { inLanguage: lang } : {}),
    });
    main.mainEntity = id;
  } else if (spec.items?.length) {
    main.mainEntity = {
      "@type": "ItemList",
      numberOfItems: spec.items.length,
      itemListElement: spec.items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, url: abs(it.path) })),
    };
  }
  if (spec.about) main.about = { "@type": "Thing", name: spec.about.name, ...(spec.about.description ? { description: spec.about.description } : {}) };
  const crumbs = spec.crumbs.length > 1;
  nodes.push({
    "@type": spec.kind ?? "WebPage",
    ...page,
    url: abs(here),
    name: meta.title,
    description: meta.description,
    ...(lang ? { inLanguage: lang } : {}),
    isPartOf: site,
    ...(crumbs ? { breadcrumb: { "@id": absId(here, "breadcrumb") } } : {}),
    ...main,
  });
  if (crumbs) {
    nodes.push({
      "@type": "BreadcrumbList",
      "@id": absId(here, "breadcrumb"),
      itemListElement: spec.crumbs.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(it.path) })),
    });
  }
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** `meta` con sus datos estructurados (título y descripción salen del propio `meta`). */
export const withLd = (meta: PageMeta, lang: Lang | null, here: string, spec: LdSpec): PageMeta => ({ ...meta, jsonLd: [pageLd(meta, lang, here, spec)] });

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, "&quot;");

/** Etiquetas como HTML (para el prerender). Todas llevan `data-seo` para que la web pueda sustituirlas al navegar. */
export function headHtml(title: string, tags: HeadTag[]): string {
  const out = [`<title data-seo>${escapeText(title)}</title>`];
  for (const t of tags) {
    if (t.tag === "script") out.push(`<script data-seo type="application/ld+json">${(t.text ?? "").replace(/</g, "\\u003c")}</script>`);
    else out.push(`<${t.tag} data-seo ${Object.entries(t.attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ")}>`);
  }
  return out.join("\n    ");
}
