// Prerender: escribe el HTML estático de cada página indexable (dist/<ruta>/index.html), el sitemap y robots.txt.
// Va después de `vite build` y de `vite build --ssr src/entry-server.tsx --outDir dist-ssr`.
// Cada página lleva su título, descripción, canonical, hreflang, Open Graph, datos estructurados y el contenido en HTML;
// la web interactiva lo cubre al cargar y lo sustituye (ver src/seo/handoff.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const ssrDir = join(web, "dist-ssr");
const siteUrl = (() => {
  const raw = (process.env.SITE_URL ?? "").trim();
  if (!raw) return "";
  const u = new URL(raw); // el host se normaliza a minúsculas
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
})();

const entryFile = ["entry-server.js", "entry-server.mjs"].map((f) => join(ssrDir, f)).find(existsSync);
if (!entryFile) throw new Error("Falta dist-ssr/entry-server.js: ejecuta `vite build --ssr src/entry-server.tsx --outDir dist-ssr` antes.");
const { renderPage, allPages, isIndexable, LANGS, alternates, pagePath } = await import(pathToFileURL(entryFile).href);

const template = readFileSync(join(dist, "index.html"), "utf8");
if (!template.includes("<!--seo-head-->") || !template.includes("<!--seo-body-->")) throw new Error("dist/index.html no conserva los marcadores <!--seo-head--> y <!--seo-body-->");

const dataDir = join(dist, "data");
const readJson = async (path) => JSON.parse(readFileSync(join(dataDir, path), "utf8"));
const manifest = await readJson("manifest.json");
const index = await readJson("seo-index.json");
const en = manifest.english?.file && existsSync(join(dataDir, manifest.english.file)) ? await readJson(manifest.english.file) : null;
const env = { manifest, index, en, readJson };

// El probador insertable (/embed) no lleva el emblema de fondo
const html = (page, lang, { emblem = true } = {}) =>
  (emblem ? template : template.replace(/\s*<div class="page-emblem"[\s\S]*?<\/div>/, ""))
    .replace('<html lang="es">', `<html lang="${lang}">`)
    .replace("<!--seo-head-->", page.head)
    .replace("<!--seo-body-->", page.body ? `<div id="prerender">${page.body}</div>` : "");

let count = 0;
const write = (path, content) => {
  const file = path === "/" ? join(dist, "index.html") : join(dist, path.replace(/^\//, ""), "index.html");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  count++;
};

// Huella del contenido de una página (título, etiquetas del <head> y cuerpo, sin la dirección ni la ruta base del sitio): sirve
// para saber cuándo cambió de verdad. No incluye la plantilla (los ficheros de Vite cambian de nombre en cada build).
const basePath = siteUrl ? new URL(siteUrl).pathname.replace(/\/+$/, "") : "";
const neutral = (text) => (siteUrl ? text.split(siteUrl).join("").split(`"${basePath}/`).join('"/') : text);
const contentHash = (out) => createHash("sha256").update([out.title, neutral(out.head), neutral(out.body)].join("\n")).digest("hex").slice(0, 12);

const indexable = [];
for (const page of allPages(index)) {
  for (const lang of LANGS) {
    const out = await renderPage(env, page, lang);
    write(out.path, html(out, lang));
    if (isIndexable(page)) indexable.push({ page, lang, path: out.path, hash: contentHash(out) });
  }
}
// Páginas que existen pero no se indexan (la web interactiva las pinta sin contenido propio)
for (const lang of LANGS) {
  const out = await renderPage(env, { kind: "unassigned" }, lang);
  write(out.path, html(out, lang));
}
write("/embed", html(await renderPage(env, { kind: "embed" }, "en"), "en", { emblem: false }));

// La raíz (`/`): entrada sin idioma. Los buscadores la ven como la portada inglesa (canonical a /en/); la web redirige a /es o /en según el navegador.
const root = await renderPage(env, { kind: "home" }, "en", { canonicalPath: pagePath({ kind: "home" }, "en", index) });
rmSync(join(dist, "index.html"), { force: true });
write("/", html(root, "en"));

// 404: cualquier dirección que no sea una página real. La web interactiva se carga igual y enseña «no encontrada».
const notFound = await renderPage(env, { kind: "not-found" }, "en");
writeFileSync(join(dist, "404.html"), html(notFound, "en"));

// Fecha de última modificación de cada página: la del día en que cambió su contenido. `seo-lastmod.json` (en git) guarda la
// huella y la fecha de cada una; al construir en local se actualiza (hay que subirlo con el resto), en el servidor solo se lee
// y la fecha de una página que difiera de lo guardado es la de hoy. Sin `SITE_URL` no se guarda (las huellas no valdrían).
const lastmodFile = join(web, "seo-lastmod.json");
const today = process.env.SEO_TODAY || new Date().toISOString().slice(0, 10);
const saved = existsSync(lastmodFile) ? JSON.parse(readFileSync(lastmodFile, "utf8")) : {};
const lastmods = {};
for (const { path, hash } of indexable) {
  const [oldHash, oldDate] = (saved[path] ?? "").split(" ");
  lastmods[path] = `${hash} ${oldHash === hash ? oldDate : today}`;
}
if (siteUrl && !process.env.CI) {
  const lines = Object.entries(lastmods).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  writeFileSync(lastmodFile, `{\n${lines.join(",\n")}\n}\n`);
}

// Sitemap con las dos versiones de cada página y sus alternativas de idioma
if (siteUrl) {
  const entry = ({ page, path }) => {
    const alts = alternates(page, index);
    const links = LANGS.filter((l) => alts[l]).map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${siteUrl}${alts[l]}"/>`);
    if (alts.en) links.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}${alts.en}"/>`);
    return `  <url><loc>${siteUrl}${path}</loc><lastmod>${lastmods[path].split(" ")[1]}</lastmod>${links.join("")}</url>`;
  };
  const urlset = (list) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${list.map(entry).join("\n")}\n</urlset>\n`;
  writeFileSync(join(dist, "sitemap.xml"), urlset(indexable));
  // Un archivo por idioma (≈ la mitad de peso): para enviarlos por separado a Search Console si el único no se puede obtener
  for (const lang of LANGS) writeFileSync(join(dist, `sitemap-${lang}.xml`), urlset(indexable.filter(({ path }) => path.startsWith(`/${lang}/`))));
} else {
  console.warn("⚠ SITE_URL no está definida: no se genera sitemap.xml ni las URLs absolutas de canonical/hreflang. Defínela (p. ej. SITE_URL=https://tudominio.com) en el despliegue.");
}

// robots.txt solo lo leen los buscadores en la raíz del dominio: en GitHub Pages sin dominio propio (web en /repositorio/) no
// cuenta, y entonces valen las etiquetas noindex y el sitemap enviado desde Search Console. Con dominio propio, la ruta base es «».
const prefix = siteUrl ? new URL(siteUrl).pathname.replace(/\/+$/, "") : "";
const robots = ["User-agent: *", "Allow: /", `Disallow: ${prefix}/embed/`, `Disallow: ${prefix}/models/`, `Disallow: ${prefix}/es/datamining/`, `Disallow: ${prefix}/en/datamining/`, `Disallow: ${prefix}/es/sin-asignar/`, `Disallow: ${prefix}/en/unassigned/`];
if (siteUrl) robots.push("", `Sitemap: ${siteUrl}/sitemap.xml`);
writeFileSync(join(dist, "robots.txt"), `${robots.join("\n")}\n`);

console.log(`Prerender: ${count} páginas HTML (${indexable.length} indexables en ${LANGS.length} idiomas), 404.html, robots.txt${siteUrl ? ", sitemap.xml" : ""}`);
