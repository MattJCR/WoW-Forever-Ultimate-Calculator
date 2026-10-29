// Comprobación del SEO sobre el resultado del build (dist/): enlaces internos y datos estructurados de cada página prerenderizada.
// Uso: node scripts/check-seo.mjs [--report]   (después de `npm run build`; con SITE_URL definida, como en el despliegue)
//   Enlaces internos: ninguna página indexable huérfana, todo se alcanza en pocos clics desde la portada de su idioma,
//   ningún enlace roto y cada página enlaza a su otro idioma.
//   JSON-LD: es JSON válido, usa direcciones absolutas del sitio, sus @id se resuelven y la página del grafo coincide con el canonical.
// Sale con código 1 si algo falla. `--report` imprime además el resumen de enlaces.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const report = process.argv.includes("--report");
const siteUrl = (() => {
  const raw = (process.env.SITE_URL ?? "").trim();
  if (!raw) return "";
  const u = new URL(raw);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
})();
const basePath = siteUrl ? new URL(siteUrl).pathname.replace(/\/+$/, "") : "";

/** Clics máximos desde la portada de un idioma hasta cualquier página indexable. */
const MAX_DEPTH = 3;
/** Enlaces entrantes mínimos de cada página indexable (sin contar el de su otro idioma ni los del cabecero y pie, que están en todas). */
const MIN_INBOUND = 2;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (dir === dist && ["assets", "data", "models", "licenses", "slots", "race", "og"].includes(name)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (name === "index.html") files.push(full);
  }
};
walk(dist);

const errors = [];
const fail = (page, msg) => errors.push(`${page}: ${msg}`);

/** Ruta de una página (`/es/clases/mago/`) a partir de su fichero. */
const pathOf = (file) => `/${relative(dist, dirname(file)).replace(/\\/g, "/")}/`.replace(/^\/\.\/$/, "/").replace(/\/+/g, "/");

const pages = new Map();
for (const file of files) {
  const html = readFileSync(file, "utf8");
  const path = pathOf(file);
  const head = html.slice(0, html.indexOf("</head>"));
  const body = html.slice(html.indexOf('<div id="prerender">'));
  const canonical = /<link data-seo rel="canonical" href="([^"]+)"/.exec(head)?.[1] ?? null;
  const noindex = /name="robots" content="noindex/.test(head);
  pages.set(path, { path, html, head, body, canonical, noindex, indexable: !!canonical && !noindex });
}

/** Dirección interna normalizada (ruta con barra final) o null si es externa o un recurso. */
const internal = (href, from) => {
  if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/.test(href)) return null;
  let url;
  try {
    url = new URL(href, `https://x.test${basePath}${from}`);
  } catch {
    return null;
  }
  if (siteUrl) {
    if (url.origin !== new URL(siteUrl).origin && url.origin !== "https://x.test") return null;
  } else if (url.origin !== "https://x.test") return null;
  let p = url.pathname;
  if (basePath && p.startsWith(`${basePath}/`)) p = p.slice(basePath.length);
  else if (basePath && p !== basePath) return null;
  if (/\.[a-z0-9]{2,5}$/i.test(p)) return null; // ficheros (png, txt, xml…)
  return p.endsWith("/") ? p : `${p}/`;
};

const hrefs = (html) => [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

// ---------- Enlaces internos ----------
const outgoing = new Map();
const inbound = new Map();
const nav = (p) => {
  // El cabecero y el pie están en todas las páginas: no cuentan como recomendación de una página concreta
  const page = pages.get(p);
  const main = page.body.replace(/<header class="topbar">[\s\S]*?<\/header>/, "").replace(/<footer>[\s\S]*<\/footer>/, "");
  return main;
};
for (const [p, page] of pages) {
  const all = new Set(hrefs(page.body).map((h) => internal(h, p)).filter(Boolean));
  const content = new Set(hrefs(nav(p)).map((h) => internal(h, p)).filter(Boolean));
  outgoing.set(p, { all, content });
  for (const t of all) {
    if (t === p) continue;
    if (!pages.has(t)) fail(p, `enlace roto ${t}`);
  }
  for (const t of content) {
    if (t === p || !pages.has(t)) continue;
    (inbound.get(t) ?? inbound.set(t, new Set()).get(t)).add(p);
  }
}

const indexable = [...pages.values()].filter((p) => p.indexable);
const langOf = (p) => p.split("/")[1];
const home = { es: "/es/", en: "/en/" };

// Profundidad: clics desde la portada del idioma (con el cabecero y el pie, que están en todas las páginas)
const depth = new Map();
for (const lang of ["es", "en"]) {
  const queue = [[home[lang], 0]];
  const seen = new Set([home[lang]]);
  while (queue.length) {
    const [p, d] = queue.shift();
    depth.set(p, Math.min(d, depth.get(p) ?? Infinity));
    for (const t of outgoing.get(p)?.all ?? []) {
      if (seen.has(t) || !pages.has(t) || langOf(t) !== lang) continue;
      seen.add(t);
      queue.push([t, d + 1]);
    }
  }
}

let maxDepth = 0;
const weak = [];
for (const p of indexable) {
  if (p.path === "/") continue;
  const lang = langOf(p.path);
  const d = depth.get(p.path);
  if (d === undefined) fail(p.path, "huérfana: no se llega desde la portada de su idioma");
  else {
    maxDepth = Math.max(maxDepth, d);
    if (d > MAX_DEPTH) fail(p.path, `a ${d} clics de la portada (máximo ${MAX_DEPTH})`);
  }
  const ins = [...(inbound.get(p.path) ?? [])].filter((x) => langOf(x) === lang);
  if (ins.length < MIN_INBOUND) weak.push({ path: p.path, ins: ins.length });
  // Cada página enlaza a su versión en el otro idioma (selector de idioma)
  const other = /<link data-seo rel="alternate" hreflang="(?:es|en)" href="([^"]+)"/g;
  const alts = [...p.head.matchAll(other)].map((m) => internal(m[1], p.path)).filter((x) => x && x !== p.path);
  for (const a of alts) if (!outgoing.get(p.path).all.has(a)) fail(p.path, `no enlaza a su otro idioma ${a}`);
}
for (const w of weak) fail(w.path, `solo ${w.ins} enlace(s) entrante(s) desde el contenido (mínimo ${MIN_INBOUND})`);

if (report) {
  const byKind = {};
  for (const p of indexable) {
    const kind = p.path.replace(/^\/(es|en)\//, "").split("/").slice(0, 2).join("/").replace(/\/[^/]*$/, (m) => (m.length > 1 ? "/…" : ""));
    const ins = (inbound.get(p.path) ?? new Set()).size;
    (byKind[kind] ??= []).push(ins);
  }
  console.log(`Páginas indexables: ${indexable.length}; profundidad máxima: ${maxDepth} clics`);
  for (const [k, v] of Object.entries(byKind).sort()) {
    const sorted = [...v].sort((a, b) => a - b);
    console.log(`  ${k.padEnd(28)} ${String(v.length).padStart(4)} páginas · enlaces entrantes (contenido): mín ${sorted[0]}, mediana ${sorted[Math.floor(sorted.length / 2)]}, máx ${sorted[sorted.length - 1]}`);
  }
}

// ---------- Datos estructurados ----------
const absolute = (u) => typeof u === "string" && (siteUrl ? u.startsWith(`${siteUrl}/`) : u.startsWith("/"));
for (const page of indexable) {
  const blocks = [...page.head.matchAll(/<script data-seo type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length === 0) {
    fail(page.path, "sin datos estructurados");
    continue;
  }
  for (const raw of blocks) {
    let ld;
    try {
      ld = JSON.parse(raw.replace(/\\u003c/g, "<"));
    } catch (e) {
      fail(page.path, `JSON-LD no es JSON válido: ${e.message}`);
      continue;
    }
    const nodes = ld["@graph"];
    if (ld["@context"] !== "https://schema.org" || !Array.isArray(nodes)) {
      fail(page.path, "JSON-LD sin @context schema.org o sin @graph");
      continue;
    }
    const ids = nodes.map((n) => n["@id"]).filter(Boolean);
    if (new Set(ids).size !== ids.length) fail(page.path, "JSON-LD con @id repetidos");
    const refs = [];
    const urls = [];
    const visit = (v, key) => {
      if (Array.isArray(v)) return v.forEach((x) => visit(x, key));
      if (v && typeof v === "object") {
        const keys = Object.keys(v);
        if (keys.length === 1 && keys[0] === "@id") refs.push(v["@id"]);
        for (const k of keys) visit(v[k], k);
      } else if (["url", "item", "@id"].includes(key) && typeof v === "string") urls.push(v);
    };
    nodes.forEach((n) => visit(n, ""));
    for (const r of refs) if (!ids.includes(r)) fail(page.path, `JSON-LD: referencia ${r} sin definir`);
    for (const u of urls) if (!absolute(u)) fail(page.path, `JSON-LD: dirección no absoluta del sitio ${u}`);
    const webpage = nodes.find((n) => ["WebPage", "CollectionPage", "ItemPage"].includes(n["@type"]));
    if (!webpage) fail(page.path, "JSON-LD sin página");
    else if (page.canonical && webpage.url !== page.canonical) fail(page.path, `JSON-LD: url de la página ${webpage.url} ≠ canonical ${page.canonical}`);
    const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList");
    if (crumbs) {
      const items = crumbs.itemListElement;
      if (items.some((it, i) => it.position !== i + 1 || !it.name || !it.item)) fail(page.path, "JSON-LD: migas mal numeradas o sin nombre");
      if (items.at(-1)?.item !== page.canonical) fail(page.path, "JSON-LD: la última miga no es la propia página");
    }
    const text = JSON.stringify(ld);
    for (const bad of ["aggregateRating", "FAQPage", "\"review\""]) if (text.includes(bad)) fail(page.path, `JSON-LD con ${bad}`);
  }
}

if (!existsSync(join(dist, "sitemap.xml"))) fail("sitemap.xml", "falta (¿SITE_URL sin definir?)");

if (errors.length) {
  const shown = process.env.ALL ? errors : errors.slice(0, 40);
  console.error(`✗ ${errors.length} problema(s) de SEO:\n  ${shown.join("\n  ")}${errors.length > shown.length ? `\n  … y ${errors.length - shown.length} más` : ""}`);
  process.exit(1);
}
console.log(`✔ SEO: ${indexable.length} páginas indexables, enlaces internos y datos estructurados correctos (profundidad máxima ${maxDepth}).`);
