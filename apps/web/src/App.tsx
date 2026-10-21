import type { Manifest } from "@wfuc/schema";
import { CharacterProvider, legacyQuery, useCharacter } from "./character";
import { loadManifest, useAsync } from "./data";
import { ClassPage } from "./pages/ClassPage";
import { classToken, Home } from "./pages/Home";
import { UnassignedPage } from "./pages/UnassignedPage";
import { href, scrollToSection, useRoute, type Route } from "./router";

export function App() {
  const manifest = useAsync("manifest", loadManifest);
  return (
    <div className="shell">
      {manifest.status === "ready" ? (
        <CharacterProvider manifest={manifest.value}>
          <Layout manifest={manifest.value} />
        </CharacterProvider>
      ) : (
        <main>
          {manifest.status === "loading" && <p className="status">Cargando datos…</p>}
          {manifest.status === "error" && (
            <p className="status error">
              {manifest.message}. Si estás en local, ejecuta <code>npm run pipeline</code> y reinicia.
            </p>
          )}
        </main>
      )}
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
              <small>Calculadora definitiva</small>
            </span>
          </a>
          <nav className="main-nav" aria-label="Principal">
            <a href={href("", { ...q, s: "clases" })} onClick={() => scrollToSection("clases")} className="nav-link" aria-current={page === "class" || (onHome && (!section || section === "clases")) ? "page" : undefined}>
              Clases
            </a>
            <a href={href("", { ...q, s: "pasos" })} onClick={() => scrollToSection("pasos")} className="nav-link" aria-current={onHome && section === "pasos" ? "page" : undefined}>
              Cómo funciona
            </a>
            <a href={href("", { ...q, s: "datos" })} onClick={() => scrollToSection("datos")} className="nav-link" aria-current={onHome && section === "datos" ? "page" : undefined}>
              De dónde salen los datos
            </a>
            <a href={href("unassigned", q)} className="nav-link" aria-current={page === "unassigned" ? "page" : undefined}>
              Datos sin asignar
            </a>
          </nav>
          <span className="build-tag" title={`Datos extraídos el ${manifest.generatedAt.slice(0, 10)}`}>
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
            Datos del cliente de la beta de WoW Forever, build {number || manifest.build}
            {manifest.hotfixesApplied ? " (con hotfixes del servidor)" : ""} · extraídos el {manifest.generatedAt.slice(0, 10)}. Pueden cambiar durante la beta.
          </p>
          <p>
            Proyecto de fans, no oficial. No está afiliado ni respaldado por Blizzard Entertainment. World of Warcraft es marca registrada de Blizzard Entertainment, Inc. Nombres, textos, iconos y fondos © Blizzard.
          </p>
          <p>
            Proyecto alojado en GitHub: puedes contribuir con correcciones, datos o ideas.{" "}
            <a href="https://github.com/MattJCR/WoW-Forever-Ultimate-Calculator/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">
              Cómo contribuir
            </a>
            .
          </p>
          <p>
            Tipografías Inter y Cinzel, con licencia SIL Open Font License 1.1:{" "}
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
  if (page === "class" && arg) {
    const entry = manifest.classes.find((c) => classToken(c.file) === arg);
    if (entry) return <ClassPage key={arg} token={arg} entry={entry} query={route.query} />;
    return (
      <p className="status error">
        Clase desconocida: {arg}. <a href={href("")}>Volver</a>
      </p>
    );
  }
  return <Home manifest={manifest} query={route.query} />;
}
