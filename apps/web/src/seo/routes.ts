// Rutas de la web: URLs reales por idioma (/es/clases/mago, /en/classes/mage/abilities/fireball).
// Módulo puro (sin React ni window): lo usan la web, el índice de slugs y el prerender.

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Slug de una entidad en cada idioma. `id` es el de los datos (hechizo del primer rango, nodo del talento, raza o clase). */
export interface SeoEntry {
  id: number;
  es: string;
  en: string;
}

export interface SeoClass extends SeoEntry {
  token: string;
}

/** Índice de slugs que genera `scripts/build-seo-index.mjs` a partir de los datos. */
export interface SeoIndex {
  build: string;
  classes: SeoClass[];
  races: SeoEntry[];
  abilities: Record<string, SeoEntry[]>;
  talents: Record<string, SeoEntry[]>;
}

export type Page =
  | { kind: "home" }
  | { kind: "class"; cls: string }
  | { kind: "class-talents"; cls: string }
  | { kind: "talent"; cls: string; id: number }
  | { kind: "class-abilities"; cls: string }
  | { kind: "ability"; cls: string; id: number }
  | { kind: "races" }
  | { kind: "race"; id: number }
  | { kind: "unassigned" }
  | { kind: "embed" }
  | { kind: "lab"; name: string }
  | { kind: "not-found" };

export interface ParsedPath {
  /** null = ruta sin idioma (la raíz, el probador insertable, las pantallas de pruebas). */
  lang: Lang | null;
  page: Page;
}

/** Palabras fijas de cada ruta. */
const WORDS = {
  es: { classes: "clases", talents: "talentos", abilities: "habilidades", races: "razas", unassigned: "sin-asignar" },
  en: { classes: "classes", talents: "talents", abilities: "abilities", races: "races", unassigned: "unassigned" },
} as const;

/** Pantallas de pruebas del probador 3D: solo existen en desarrollo. */
export const LAB_PAGES = ["viewer-lab", "bust-lab", "scene-lab"] as const;

/** «Bola de Fuego» -> «bola-de-fuego»; «Pícaro» -> «picaro». */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const find = <T extends SeoEntry>(list: readonly T[] | undefined, lang: Lang, slug: string): T | undefined => list?.find((e) => e[lang] === slug);
const byId = <T extends SeoEntry>(list: readonly T[] | undefined, id: number): T | undefined => list?.find((e) => e.id === id);

/** Interpreta una ruta (`/es/clases/mago/habilidades/bola-de-fuego`). Lo que no existe en el índice es `not-found`. */
export function parsePath(pathname: string, index: SeoIndex): ParsedPath {
  const segs = pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  const notFound: ParsedPath = { lang: null, page: { kind: "not-found" } };
  if (segs.length === 0) return { lang: null, page: { kind: "home" } };
  if (segs.length === 1 && segs[0] === "embed") return { lang: null, page: { kind: "embed" } };
  if (segs.length === 1 && (LAB_PAGES as readonly string[]).includes(segs[0]!)) return { lang: null, page: { kind: "lab", name: segs[0]! } };

  const lang = segs[0] as Lang;
  if (!LANGS.includes(lang)) return notFound;
  const w = WORDS[lang];
  const [, area, a, section, b] = segs as (string | undefined)[];
  const at = (page: Page): ParsedPath => ({ lang, page });

  if (!area) return at({ kind: "home" });
  if (area === w.unassigned && !a) return at({ kind: "unassigned" });
  if (area === w.races) {
    if (!a) return at({ kind: "races" });
    const race = find(index.races, lang, a);
    return race && !section ? at({ kind: "race", id: race.id }) : notFound;
  }
  if (area === w.classes) {
    if (!a) return notFound;
    const cls = find(index.classes, lang, a);
    if (!cls) return notFound;
    if (!section) return at({ kind: "class", cls: cls.token });
    if (section === w.talents) {
      if (!b) return at({ kind: "class-talents", cls: cls.token });
      const t = find(index.talents[cls.token], lang, b);
      return t && segs.length === 5 ? at({ kind: "talent", cls: cls.token, id: t.id }) : notFound;
    }
    if (section === w.abilities) {
      if (!b) return at({ kind: "class-abilities", cls: cls.token });
      const ab = find(index.abilities[cls.token], lang, b);
      return ab && segs.length === 5 ? at({ kind: "ability", cls: cls.token, id: ab.id }) : notFound;
    }
  }
  return notFound;
}

/**
 * Ruta (sin consulta ni ruta base) de una página en el idioma dado, con barra final (`/es/clases/mago/`): es como la sirve
 * GitHub Pages (`/es/clases/mago` redirige a la de barra), así el canonical no apunta a una dirección que redirige.
 * Null si el índice no la conoce.
 */
export function pagePath(page: Page, lang: Lang, index: SeoIndex): string | null {
  const path = pagePathBare(page, lang, index);
  return path && page.kind !== "lab" && !path.endsWith("/") ? `${path}/` : path;
}

function pagePathBare(page: Page, lang: Lang, index: SeoIndex): string | null {
  const w = WORDS[lang];
  const root = `/${lang}`;
  const cls = (token: string): SeoClass | undefined => index.classes.find((c) => c.token === token);
  switch (page.kind) {
    case "home":
      return root;
    case "unassigned":
      return `${root}/${w.unassigned}`;
    case "races":
      return `${root}/${w.races}`;
    case "race": {
      const r = byId(index.races, page.id);
      return r ? `${root}/${w.races}/${r[lang]}` : null;
    }
    case "class": {
      const c = cls(page.cls);
      return c ? `${root}/${w.classes}/${c[lang]}` : null;
    }
    case "class-talents":
    case "class-abilities": {
      const c = cls(page.cls);
      return c ? `${root}/${w.classes}/${c[lang]}/${page.kind === "class-talents" ? w.talents : w.abilities}` : null;
    }
    case "talent":
    case "ability": {
      const c = cls(page.cls);
      const e = byId(page.kind === "talent" ? index.talents[page.cls] : index.abilities[page.cls], page.id);
      return c && e ? `${root}/${w.classes}/${c[lang]}/${page.kind === "talent" ? w.talents : w.abilities}/${e[lang]}` : null;
    }
    case "embed":
      return "/embed";
    case "lab":
      return `/${page.name}`;
    case "not-found":
      return null;
  }
}

/** La misma página en cada idioma (para hreflang y para el selector de idioma). */
export function alternates(page: Page, index: SeoIndex): Partial<Record<Lang, string>> {
  const out: Partial<Record<Lang, string>> = {};
  for (const l of LANGS) {
    const p = pagePath(page, l, index);
    if (p) out[l] = p;
  }
  return out;
}

/** Todas las páginas indexables, para el prerender y el sitemap. */
export function allPages(index: SeoIndex): Page[] {
  const pages: Page[] = [{ kind: "home" }, { kind: "races" }];
  for (const r of index.races) pages.push({ kind: "race", id: r.id });
  for (const c of index.classes) {
    pages.push({ kind: "class", cls: c.token }, { kind: "class-talents", cls: c.token }, { kind: "class-abilities", cls: c.token });
    for (const t of index.talents[c.token] ?? []) pages.push({ kind: "talent", cls: c.token, id: t.id });
    for (const a of index.abilities[c.token] ?? []) pages.push({ kind: "ability", cls: c.token, id: a.id });
  }
  return pages;
}

/** Cadena de consulta con los parámetros no vacíos («?b=…&v=talents»). */
export function queryString(query?: Record<string, string>): string {
  return query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
}

/**
 * Enlace antiguo con '#' (`#/class/mage?b=…`, `#/unassigned`, `#/embed?…`) -> ruta nueva con su consulta.
 * `lang` es el idioma con el que abrirlo cuando el enlace no lo fija (`?lang=` del enlace antiguo manda).
 * Devuelve null si no es un enlace antiguo.
 */
export function legacyHashToUrl(hash: string, lang: Lang, index: SeoIndex): string | null {
  if (!hash.startsWith("#/") && hash !== "#") return null;
  const raw = hash.replace(/^#\/?/, "");
  const [p = "", q = ""] = raw.split("?");
  const query = new URLSearchParams(q);
  const forced = query.get("lang");
  const use: Lang = forced === "en" || forced === "es" ? forced : lang;
  query.delete("lang");
  const [area, arg] = p.split("/").filter(Boolean);
  let page: Page | null = null;
  if (!area) page = { kind: "home" };
  else if (area === "class" && arg) {
    const c = index.classes.find((x) => x.token === arg);
    page = c ? { kind: "class", cls: c.token } : null;
  } else if (area === "unassigned") page = { kind: "unassigned" };
  else if (area === "embed") page = { kind: "embed" };
  else if ((LAB_PAGES as readonly string[]).includes(area)) page = { kind: "lab", name: area };
  const path = page ? pagePath(page, use, index) : null;
  const rest = query.toString();
  return path ? `${path}${rest ? `?${rest}` : ""}` : `/${use}/`;
}
