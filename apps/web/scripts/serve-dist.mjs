// Servidor local de dist/ que se comporta como GitHub Pages: cada ruta es un dist/<ruta>/index.html, un directorio sin barra final
// redirige a la de barra y lo desconocido responde 404 con 404.html.
// Uso: node scripts/serve-dist.mjs [puerto] [ruta base]   (la ruta base, p. ej. /repositorio, debe ser la de SITE_URL al compilar)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.argv[2] ?? 4173);
const base = (process.argv[3] ?? "").replace(/\/+$/, "");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".glb": "model/gltf-binary", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };

const isFile = (f) => existsSync(f) && statSync(f).isFile();

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = decodeURIComponent(url.pathname);
  if (base && !(path === base || path.startsWith(`${base}/`))) path = `/__fuera__${path}`;
  else path = path.slice(base.length) || "/";
  const target = join(dist, normalize(path));
  const send = (f, status) => {
    res.writeHead(status, { "Content-Type": TYPES[extname(f)] ?? "application/octet-stream" });
    res.end(readFileSync(f));
  };
  if (target.startsWith(dist) && isFile(target)) return send(target, 200);
  const dir = join(target, "index.html");
  if (target.startsWith(dist) && isFile(dir)) {
    if (!path.endsWith("/")) {
      res.writeHead(301, { Location: `${base}${path}/${url.search}` });
      return res.end();
    }
    return send(dir, 200);
  }
  send(join(dist, "404.html"), 404);
}).listen(port, () => console.log(`http://localhost:${port}${base}/`));
