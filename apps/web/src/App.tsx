import type { Manifest } from "@wfuc/schema";
import { CharacterProvider, legacyQuery, useCharacter } from "./character";
import { loadManifest, useAsync } from "./data";
import { ClassPage } from "./pages/ClassPage";
import { classToken, Home } from "./pages/Home";
import { UnassignedPage } from "./pages/UnassignedPage";
import { href, useRoute, type Route } from "./router";

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

function Layout({ manifest }: { manifest: Manifest }) {
  const route = useRoute();
  const { legacyCode } = useCharacter();
  const q = legacyQuery(legacyCode);

  return (
    <>
      <header className="topbar">
        <a className="brand" href={href("", q)}>
          <img
            className="brand-mark"
            src="https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt527dd61848a757c7/6aa3316cad92093ee45628fd/camelot-logo-gamepage.png"
            alt="WoW Forever"
          />
          <span className="brand-text">
            <b>WOW FOREVER ULTIMATE CALCULATOR</b>
            <small>
              Calculadora de talentos de WoW Forever · datos de la beta {manifest.build} · {manifest.generatedAt.slice(0, 10)}
            </small>
          </span>
        </a>
        <nav aria-label="Principal">
          <a href={href("unassigned", q)} className="nav-btn" aria-current={route.path[0] === "unassigned" ? "page" : undefined}>
            Datos sin asignar
          </a>
        </nav>
      </header>

      <main>
        <Routes route={route} manifest={manifest} />
      </main>

      <footer>
        <p>
          Datos del cliente de la beta de WoW Forever, build {manifest.build}
          {manifest.hotfixesApplied ? " (con hotfixes del servidor)" : ""} · extraídos el {manifest.generatedAt.slice(0, 10)}. Pueden cambiar durante la beta.
        </p>
        <p>
          Proyecto de fans, no oficial. No está afiliado ni respaldado por Blizzard Entertainment. World of Warcraft es marca registrada de Blizzard Entertainment, Inc. Nombres, textos, iconos y fondos © Blizzard.
        </p>
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
  return <Home manifest={manifest} />;
}
