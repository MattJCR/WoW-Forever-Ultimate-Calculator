// Prerender: escribe el HTML estático de cada página indexable (dist/<ruta>/index.html), el sitemap y robots.txt.
// Va después de `vite build` y de `vite build --ssr src/entry-server.tsx --outDir dist-ssr`.
// Cada página lleva su título, descripción, canonical, hreflang, Open Graph, datos estructurados y el contenido en HTML;
// la web interactiva lo cubre al cargar y lo sustituye (ver src/seo/handoff.ts).
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
const { renderPage, allPages, LANGS, alternates } = await import(pathToFileURL(entryFile).href);

const template = readFileSync(join(dist, "index.html"), "utf8");
if (!template.includes("<!--seo-head-->") || !template.includes("<!--seo-body-->")) throw new Error("dist/index.html no conserva los marcadores <!--seo-head--> y <!--seo-body-->");

const dataDir = join(dist, "data");
const readJson = async (path) => JSON.parse(readFileSync(join(dataDir, path), "utf8"));
const manifest = await readJson("manifest.json");
const index = await readJson("seo-index.json");
const en = manifest.english?.file && existsSync(join(dataDir, manifest.english.file)) ? await readJson(manifest.english.file) : null;
const env = { manifest, index, en, readJson };

const html = (page, lang) =>
  template
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

const indexable = [];
for (const page of allPages(index)) {
  for (const lang of LANGS) {
    const out = await renderPage(env, page, lang);
    write(out.path, html(out, lang));
    indexable.push({ page, lang, path: out.path });
  }
}
// Páginas que existen pero no se indexan (la web interactiva las pinta sin contenido propio)
for (const lang of LANGS) {
  const out = await renderPage(env, { kind: "unassigned" }, lang);
  write(out.path, html(out, lang));
}
write("/embed", html(await renderPage(env, { kind: "embed" }, "en"), "en"));

// La raíz (`/`): entrada sin idioma. Los buscadores la ven como la portada inglesa (canonical a /en); la web redirige a /es o /en según el navegador.
const root = await renderPage(env, { kind: "home" }, "en", { canonicalPath: "/en" });
rmSync(join(dist, "index.html"), { force: true });
write("/", html(root, "en"));

// 404: cualquier dirección que no sea una página real. La web interactiva se carga igual y enseña «no encontrada».
const notFound = await renderPage(env, { kind: "not-found" }, "en");
writeFileSync(join(dist, "404.html"), html(notFound, "en"));

// Sitemap con las dos versiones de cada página y sus alternativas de idioma
if (siteUrl) {
  const lastmod = (manifest.generatedAt ?? "").slice(0, 10);
  const urls = indexable
    .map(({ page, lang, path }) => {
      const alts = alternates(page, index);
      const links = LANGS.filter((l) => alts[l]).map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${siteUrl}${alts[l]}"/>`);
      if (alts.en) links.push(`<xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}${alts.en}"/>`);
      return `  <url><loc>${siteUrl}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${links.join("")}</url>`;
    })
    .join("\n");
  writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`);
} else {
  console.warn("⚠ SITE_URL no está definida: no se genera sitemap.xml ni las URLs absolutas de canonical/hreflang. Defínela (p. ej. SITE_URL=https://tudominio.com) en el despliegue.");
}

// robots.txt solo lo leen los buscadores en la raíz del dominio: en GitHub Pages sin dominio propio (web en /repositorio/) no
// cuenta, y entonces valen las etiquetas noindex y el sitemap enviado desde Search Console. Con dominio propio, la ruta base es «».
const prefix = siteUrl ? new URL(siteUrl).pathname.replace(/\/+$/, "") : "";
const robots = ["User-agent: *", "Allow: /", `Disallow: ${prefix}/embed/`, `Disallow: ${prefix}/models/`, `Disallow: ${prefix}/es/sin-asignar/`, `Disallow: ${prefix}/en/unassigned/`];
if (siteUrl) robots.push("", `Sitemap: ${siteUrl}/sitemap.xml`);
writeFileSync(join(dist, "robots.txt"), `${robots.join("\n")}\n`);

console.log(`Prerender: ${count} páginas HTML (${indexable.length} indexables en ${LANGS.length} idiomas), 404.html, robots.txt${siteUrl ? ", sitemap.xml" : ""}`);
