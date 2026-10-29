import type { Manifest } from "@wfuc/schema";
import { lazy, Suspense, useEffect } from "react";
import { CharacterProvider, legacyQuery, useCharacter } from "./character";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import { loadManifest, loadSeoIndex, useAsync } from "./data";
import { LangContext, tr, useLangRoot } from "./i18n";
import { classToken, Home } from "./pages/Home";
import { EmbedPage } from "./pages/EmbedPage";
import { getSeoIndex, href, navigate, setSeoIndex, useRoute, withBase, type Route } from "./router";
import { releasePrerender, usePrerenderHandoff } from "./seo/handoff";
import { calcMeta, embedMeta, homeMeta, notFoundMeta, unassignedMeta } from "./seo/siteMeta";
import { isRefPage, loadRefData, refMeta, RefContent } from "./seo/RefPages";
import { hasCharacterState, legacyHashToUrl, legacyView } from "./seo/routes";
import { useSeo } from "./seo/useSeo";

// La calculadora y los datos sin asignar se descargan al abrirlos: las páginas de consulta (habilidades, talentos, razas) y la portada no los necesitan.
// Mientras tanto sigue visible el HTML prerenderizado (`#prerender`), que cubre la espera.
const ClassPage = lazy(() => import("./pages/ClassPage").then((m) => ({ default: m.ClassPage })));
const UnassignedPage = lazy(() => import("./pages/UnassignedPage").then((m) => ({ default: m.UnassignedPage })));

// Pantallas de pruebas del probador 3D: solo existen en desarrollo
const ViewerLab = import.meta.env.DEV ? lazy(() => import("./pages/ViewerLab").then((m) => ({ default: m.ViewerLab }))) : null;
const BustLab = import.meta.env.DEV ? lazy(() => import("./pages/BustLab").then((m) => ({ default: m.BustLab }))) : null;
const SceneLab = import.meta.env.DEV ? lazy(() => import("./pages/SceneLab").then((m) => ({ default: m.SceneLab }))) : null;

export function App() {
  const manifest = useAsync("manifest", loadManifest);
  const seo = useAsync("seo-index", loadSeoIndex);
  // El índice de slugs se fija antes de pintar ninguna ruta (la interpretan sus URLs)
  if (seo.status === "ready") setSeoIndex(seo.value);
  // Si hay HTML prerenderizado, él cubre la espera
  const prerendered = document.getElementById("prerender") !== null;

  if (manifest.status === "ready" && seo.status === "ready") return <Loaded manifest={manifest.value} />;
  const failed = manifest.status === "error" ? manifest.message : seo.status === "error" ? seo.message : null;
  return (
    <div className="shell">
      <main>
        {!failed && !prerendered && <p className="status">{tr("Cargando datos…")}</p>}
        {failed && (
          <p className="status error">
            {failed}. {tr("Si estás en local, ejecuta")} <code>npm run pipeline</code> {tr("y reinicia.")}
          </p>
        )}
      </main>
    </div>
  );
}

/** La web con los datos ya cargados: idioma, personaje y página. */
function Loaded({ manifest }: { manifest: Manifest }) {
  const route = useRoute();
  const lang = useLangRoot(manifest.english?.file ?? null, route.lang);

  // Entradas sin idioma: los enlaces antiguos con '#' pasan a la URL nueva y la raíz va a la portada en el idioma del navegador
  useEffect(() => {
    const index = getSeoIndex();
    if (!index) return;
    const legacy = legacyHashToUrl(window.location.hash, lang.lang, index);
    if (legacy) return navigate(withBase(legacy), { replace: true });
    if (route.lang === null && route.page.kind === "home") {
      const q = Object.fromEntries(route.query);
      delete q.lang;
      navigate(href({ kind: "home" }, q, lang.lang), { replace: true });
    }
    // Solo al abrir la web: después cada enlace ya lleva su idioma
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Por si una página no llega a pintarse, el HTML prerenderizado no se queda tapando la web
  useEffect(() => {
    const t = window.setTimeout(releasePrerender, 6000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <LangContext.Provider value={lang}>
      <div className="shell">
        <CharacterProvider manifest={manifest}>
          <Layout manifest={manifest} route={route} />
        </CharacterProvider>
      </div>
    </LangContext.Provider>
  );
}

function Layout({ manifest, route }: { manifest: Manifest; route: Route }) {
  const { legacyCode } = useCharacter();
  const q = legacyQuery(legacyCode);
  const embedded = route.page.kind === "embed";
  // El emblema de fondo va en index.html (un solo elemento para el HTML prerenderizado y la web interactiva); el probador insertado no lo lleva
  useEffect(() => {
    if (embedded) document.querySelector(".page-emblem")?.remove();
  }, [embedded]);
  // Probador insertado en otra web: solo el visor, sin cabecera ni pie
  if (embedded) return <Routes route={route} manifest={manifest} />;

  return (
    <>
      <SiteHeader manifest={manifest} page={route.page} section={route.query.get("s")} q={q} query={Object.fromEntries(route.query)} />
      <main>
        <Routes route={route} manifest={manifest} />
      </main>
      <SiteFooter manifest={manifest} q={q} />
    </>
  );
}

function Routes({ route, manifest }: { route: Route; manifest: Manifest }) {
  const { page } = route;
  useSeo(
    page.kind === "home"
      ? homeMeta(manifest)
      : page.kind === "calc"
        ? calcMeta(manifest, page.cls, page.view)
        : page.kind === "unassigned"
          ? unassignedMeta()
          : page.kind === "embed"
            ? embedMeta()
            : page.kind === "not-found" || page.kind === "lab"
              ? notFoundMeta()
              : null,
    page,
    route.lang,
  );
  if (page.kind === "unassigned") return <Suspense fallback={null}><UnassignedPage /></Suspense>;
  if (page.kind === "embed") return <EmbedPage manifest={manifest} query={route.query} />;
  if (import.meta.env.DEV && page.kind === "lab") {
    if (page.name === "viewer-lab" && ViewerLab) return <Suspense fallback={null}><ViewerLab query={route.query} /></Suspense>;
    if (page.name === "bust-lab" && BustLab) return <Suspense fallback={null}><BustLab query={route.query} /></Suspense>;
    if (page.name === "scene-lab" && SceneLab) return <Suspense fallback={null}><SceneLab query={route.query} /></Suspense>;
  }
  if (page.kind === "calc") {
    const entry = manifest.classes.find((c) => classToken(c.file) === page.cls);
    if (entry) return <Suspense fallback={null}><ClassPage key={page.cls} token={page.cls} entry={entry} query={route.query} view={page.view} /></Suspense>;
  }
  // Un enlace antiguo (`/clases/mago/?b=…&v=talents`) trae el personaje en la página de la clase: pasa al paso de la calculadora
  if (page.kind === "class" && hasCharacterState(route.query)) return <ToCalculator cls={page.cls} query={route.query} />;
  if (isRefPage(page)) return <RefRoute key={JSON.stringify(page)} page={page} manifest={manifest} lang={route.lang} />;
  if (page.kind === "home") return <Home manifest={manifest} query={route.query} />;
  return <NotFound />;
}

/** Lleva un enlace antiguo de la clase a su paso de la calculadora, conservando el personaje. */
function ToCalculator({ cls, query }: { cls: string; query: URLSearchParams }) {
  useEffect(() => {
    const q = Object.fromEntries(query);
    delete q.v;
    navigate(href({ kind: "calc", cls, view: legacyView(query) }, q), { replace: true });
  }, [cls, query]);
  return <p className="status">{tr("Cargando datos…")}</p>;
}

/** Página de consulta (talentos, habilidades, razas): descarga sus datos y los pinta. */
function RefRoute({ page, manifest, lang }: { page: Route["page"]; manifest: Manifest; lang: Route["lang"] }) {
  const state = useAsync(JSON.stringify(page), () => loadRefData(page, manifest));
  const meta = state.status === "ready" ? refMeta(page, state.value) : null;
  useSeo(meta, page, lang);
  usePrerenderHandoff(state.status !== "loading");
  if (state.status === "loading") return <p className="status">{tr("Cargando datos…")}</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;
  return <RefContent page={page} data={state.value} />;
}

function NotFound() {
  usePrerenderHandoff();
  return (
    <div className="wrap ref">
      <header className="ref-head">
        <div>
          <p className="eyebrow">404</p>
          <h1>{tr("Página no encontrada")}</h1>
          <p className="ref-lead">{tr("Esta dirección no existe o ha cambiado. Puedes volver a la portada y elegir tu clase.")}</p>
        </div>
      </header>
      <p className="ref-actions">
        <a className="btn btn-primary" href={href({ kind: "home" })}>
          {tr("Volver")}
        </a>
      </p>
    </div>
  );
}
