import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dirección pública de la web (sin barra final) para canonical, hreflang, Open Graph y sitemap: SITE_URL
// (p. ej. https://usuario.github.io/repositorio, o https://midominio.com con dominio propio). Vacía en local.
const siteUrl = (() => {
  const raw = (process.env.SITE_URL ?? "").trim();
  if (!raw) return "";
  const u = new URL(raw); // el host se normaliza a minúsculas
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
})();

// Las URLs son reales (/es/clases/mago/): los recursos se piden con ruta absoluta. La ruta base sale de SITE_URL
// (en GitHub Pages sin dominio propio es «/repositorio/»; con dominio propio, «/»). VITE_BASE la fuerza.
const base = process.env.VITE_BASE ?? (siteUrl ? `${new URL(siteUrl).pathname.replace(/\/+$/, "")}/` : "/");

export default defineConfig({
  base,
  plugins: [react()],
  // Momento del build: la web lo muestra en la cabecera
  define: { __DEPLOYED_AT__: JSON.stringify(new Date().toISOString()), __SITE_URL__: JSON.stringify(siteUrl) },
  // El prerender (vite build --ssr) empaqueta todo en un solo fichero que Node ejecuta sin resolver paquetes del monorepo
  ssr: { noExternal: true },
  server: { port: 5173, host: true },
});
