// Generación del HTML estático de cada página (prerender). Lo compila `vite build --ssr` y lo usa scripts/prerender.mjs.
// Los buscadores y quien no ejecute JavaScript ven este HTML; en el navegador lo cubre y luego lo sustituye la web interactiva.
import type { EnglishText, Manifest } from "@wfuc/schema";
import { renderToString } from "react-dom/server";
import { StaticCharacterProvider } from "./character";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import { setJsonLoader } from "./data";
import { LangContext, setRenderLang } from "./i18n";
import { Home } from "./pages/Home";
import { setSeoIndex } from "./router";
import { headHtml, headTags, type PageMeta } from "./seo/meta";
import { isRefPage, loadRefData, refMeta, RefContent } from "./seo/RefPages";
import { pagePath, type Lang, type Page, type SeoIndex } from "./seo/routes";
import { embedMeta, homeMeta, notFoundMeta, unassignedMeta } from "./seo/siteMeta";
import { tr } from "./i18n";

export { allPages, isIndexable, LANGS, pagePath, alternates } from "./seo/routes";

export interface RenderEnv {
  manifest: Manifest;
  index: SeoIndex;
  /** Textos del juego en inglés (null = no hay). */
  en: EnglishText | null;
  /** Lee un JSON de datos (ruta relativa a data/). */
  readJson: (path: string) => Promise<unknown>;
}

export interface RenderedPage {
  lang: Lang;
  /** Ruta de la página (`/es/clases/mago`). */
  path: string;
  title: string;
  /** Etiquetas del <head> como HTML. */
  head: string;
  /** Contenido del <body> (dentro de #prerender). */
  body: string;
}

/** Metadatos y contenido de una página en un idioma. `bare` = solo el título, sin contenido (páginas interactivas sin texto propio). */
async function build(env: RenderEnv, page: Page, lang: Lang): Promise<{ meta: PageMeta; content: JSX.Element | null }> {
  setJsonLoader(env.readJson);
  setSeoIndex(env.index);
  const { manifest } = env;
  const ready = async () => {
    const data = isRefPage(page) ? await loadRefData(page, manifest) : { manifest };
    setRenderLang(lang, lang === "en" ? env.en : null);
    return data;
  };
  const data = await ready();
  if (page.kind === "home") return { meta: homeMeta(manifest), content: <Home manifest={manifest} query={new URLSearchParams()} /> };
  if (isRefPage(page)) return { meta: refMeta(page, data), content: <RefContent page={page} data={data} /> };
  if (page.kind === "unassigned") return { meta: unassignedMeta(), content: <Plain title={unassignedMeta().title} text={unassignedMeta().description} /> };
  if (page.kind === "embed") return { meta: embedMeta(), content: null };
  return { meta: notFoundMeta(), content: <Plain title={tr("Página no encontrada")} text={tr("Esta dirección no existe o ha cambiado. Puedes volver a la portada y elegir tu clase.")} /> };
}

function Plain({ title, text }: { title: string; text: string }) {
  return (
    <div className="wrap ref">
      <header className="ref-head">
        <div>
          <h1>{title}</h1>
          <p className="ref-lead">{text}</p>
        </div>
      </header>
    </div>
  );
}

/** HTML de una página. `canonicalPage` permite que la raíz (`/`) apunte a la portada inglesa. */
export async function renderPage(env: RenderEnv, page: Page, lang: Lang, opts: { canonicalPath?: string } = {}): Promise<RenderedPage> {
  const { manifest, index } = env;
  const { meta, content } = await build(env, page, lang);
  const path = pagePath(page, lang, index) ?? "/";
  const tags = headTags(meta, page, lang, index, opts.canonicalPath ?? path);
  const value = { lang, setLang: () => {}, dataStatus: "ready" as const };
  const body = content
    ? renderToString(
        <LangContext.Provider value={value}>
          <div className="shell">
            <StaticCharacterProvider manifest={manifest}>
              <SiteHeader manifest={manifest} page={page} section={null} q={{}} query={{}} />
              <main>{content}</main>
              <SiteFooter manifest={manifest} q={{}} />
            </StaticCharacterProvider>
          </div>
        </LangContext.Provider>,
      )
    : "";
  return { lang, path, title: meta.title, head: headHtml(meta.title, tags), body };
}
