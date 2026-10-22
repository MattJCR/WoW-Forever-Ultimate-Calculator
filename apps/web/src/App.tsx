import type { Manifest } from "@wfuc/schema";
import { lazy, Suspense } from "react";
import { CharacterProvider, legacyQuery, useCharacter } from "./character";
import { loadManifest, useAsync } from "./data";
import { LangContext, tr, useLang, useLangRoot } from "./i18n";
import { ClassPage } from "./pages/ClassPage";
import { classToken, Home } from "./pages/Home";
import { UnassignedPage } from "./pages/UnassignedPage";
import { href, scrollToSection, useRoute, type Route } from "./router";

// Pantallas de pruebas del probador 3D: solo existen en desarrollo
const ViewerLab = import.meta.env.DEV ? lazy(() => import("./pages/ViewerLab").then((m) => ({ default: m.ViewerLab }))) : null;
const BustLab = import.meta.env.DEV ? lazy(() => import("./pages/BustLab").then((m) => ({ default: m.BustLab }))) : null;

export function App() {
  const manifest = useAsync("manifest", loadManifest);
  const lang = useLangRoot(manifest.status === "ready" ? (manifest.value.english?.file ?? null) : null);
  return (
    <LangContext.Provider value={lang}>
      <div className="shell">
        {manifest.status === "ready" ? (
          <CharacterProvider manifest={manifest.value}>
            <Layout manifest={manifest.value} />
          </CharacterProvider>
        ) : (
          <main>
            {manifest.status === "loading" && <p className="status">{tr("Cargando datos…")}</p>}
            {manifest.status === "error" && (
              <p className="status error">
                {manifest.message}. {tr("Si estás en local, ejecuta")} <code>npm run pipeline</code> {tr("y reinicia.")}
              </p>
            )}
          </main>
        )}
      </div>
    </LangContext.Provider>
  );
}

/** Selector de idioma de la interfaz y de los textos del juego (ver i18n.tsx). */
function LanguageSwitch() {
  const { lang, setLang, dataStatus } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label={tr("Idioma")}>
      <button type="button" aria-pressed={lang === "es"} onClick={() => setLang("es")} title="Español" lang="es">
        ES
      </button>
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} title={dataStatus === "loading" ? "English (loading…)" : "English"} lang="en">
        EN
      </button>
    </div>
  );
}

/** «1.60.1.70450» -> versión «1.60.1» y número de compilación «70450». */
function splitBuild(build: string): { version: string; number: string } {
  const parts = build.split(".");
  return parts.length > 3 ? { version: parts.slice(0, 3).join("."), number: parts.slice(3).join(".") } : { version: build, number: "" };
}

function Layout({ manifest }: { manifest: Manifest }) {
  const route = useRoute();
  const { lang } = useLang();
  const { legacyCode } = useCharacter();
  const q = legacyQuery(legacyCode);
  const { version, number } = splitBuild(manifest.build);
  const page = route.path[0];
  const section = route.query.get("s");
  const onHome = page === undefined;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <a className="brand" href={href("", q)}>
            <img className="brand-mark" src={`${import.meta.env.BASE_URL}logo-forever-transparent.png`} alt="" width={52} height={52} />
            <span className="brand-text">
              <b>WoW Forever</b>
              <small>{tr("Calculadora definitiva")}</small>
            </span>
          </a>
          <nav className="main-nav" aria-label={tr("Principal")}>
            <a href={href("", { ...q, s: "clases" })} onClick={() => scrollToSection("clases")} className="nav-link" aria-current={page === "class" || (onHome && (!section || section === "clases")) ? "page" : undefined}>
              {tr("Clases")}
            </a>
            <a href={href("", { ...q, s: "pasos" })} onClick={() => scrollToSection("pasos")} className="nav-link" aria-current={onHome && section === "pasos" ? "page" : undefined}>
              {tr("Cómo funciona")}
            </a>
            <a href={href("", { ...q, s: "datos" })} onClick={() => scrollToSection("datos")} className="nav-link" aria-current={onHome && section === "datos" ? "page" : undefined}>
              {tr("De dónde salen los datos")}
            </a>
            <a href={href("unassigned", q)} className="nav-link" aria-current={page === "unassigned" ? "page" : undefined}>
              {tr("Datos sin asignar")}
            </a>
          </nav>
          <LanguageSwitch />
          <span className="build-tag" title={tr("Datos extraídos el {date}", { date: manifest.generatedAt.slice(0, 10) })}>
            Beta {version}
            {number && ` · build ${number}`}
          </span>
        </div>
      </header>

      <div className="page-emblem" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}logo-forever-transparent.png`} alt="" draggable={false} />
      </div>
      <main>
        <Routes route={route} manifest={manifest} />
      </main>

      <footer>
        <div className="wrap">
          <p>
            {tr("Datos del cliente de la beta de WoW Forever, build {build}", { build: number || manifest.build })}
            {manifest.hotfixesApplied ? ` ${tr("(con hotfixes del servidor)")}` : ""} · {tr("extraídos el {date}. Pueden cambiar durante la beta.", { date: manifest.generatedAt.slice(0, 10) })}
          </p>
          {lang === "en" && <p>{tr("Los textos en inglés (nombres y descripciones del juego) son los del propio juego, tomados de sus tablas en inglés, y sus cifras se comprueban contra las del cliente, que solo está en español. Las pocas traducciones propias se marcan como tales. Lo que no tenga versión en inglés se muestra en español.")}</p>}
          <p>
            {tr("Proyecto de fans, no oficial. No está afiliado ni respaldado por Blizzard Entertainment. World of Warcraft es marca registrada de Blizzard Entertainment, Inc. Nombres, textos, iconos y fondos © Blizzard.")}
          </p>
          <p>
            {tr("Proyecto alojado en GitHub: puedes contribuir con correcciones, datos o ideas.")}{" "}
            <a href="https://github.com/MattJCR/WoW-Forever-Ultimate-Calculator/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">
              {tr("Cómo contribuir")}
            </a>
            .
          </p>
          <p>
            {tr("Tipografías Inter y Cinzel, con licencia SIL Open Font License 1.1:")}{" "}
            <a href={`${import.meta.env.BASE_URL}licenses/Inter-OFL.txt`} target="_blank" rel="noreferrer">
              Inter
            </a>{" "}
            ·{" "}
            <a href={`${import.meta.env.BASE_URL}licenses/Cinzel-OFL.txt`} target="_blank" rel="noreferrer">
              Cinzel
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  );
}

function Routes({ route, manifest }: { route: Route; manifest: Manifest }) {
  const [page, arg] = route.path;
  if (page === "unassigned") return <UnassignedPage />;
  if (import.meta.env.DEV && page === "viewer-lab" && ViewerLab) return <Suspense fallback={null}><ViewerLab query={route.query} /></Suspense>;
  if (import.meta.env.DEV && page === "bust-lab" && BustLab) return <Suspense fallback={null}><BustLab query={route.query} /></Suspense>;
  if (page === "class" && arg) {
    const entry = manifest.classes.find((c) => classToken(c.file) === arg);
    if (entry) return <ClassPage key={arg} token={arg} entry={entry} query={route.query} />;
    return (
      <p className="status error">
        {tr("Clase desconocida:")} {arg}. <a href={href("")}>{tr("Volver")}</a>
      </p>
    );
  }
  return <Home manifest={manifest} query={route.query} />;
}
