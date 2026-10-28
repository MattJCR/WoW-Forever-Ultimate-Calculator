import type { Manifest } from "@wfuc/schema";
import { classLabel, tr, useLang } from "../i18n";
import { href, navigate, scrollToSection } from "../router";
import { LANGS, type Lang, type Page } from "../seo/routes";

/** «1.60.1.70658» -> versión «1.60.1» y número de compilación «70450». */
function splitBuild(build: string): { version: string; number: string } {
  const parts = build.split(".");
  return parts.length > 3 ? { version: parts.slice(0, 3).join("."), number: parts.slice(3).join(".") } : { version: build, number: "" };
}

/** Fecha y hora del despliegue con el idioma y el formato del navegador. */
function formatDeployedAt(): string {
  if (typeof window === "undefined") return ""; // el HTML prerenderizado no sabe el formato del navegador
  const d = new Date(__DEPLOYED_AT__);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

const classToken = (file: string): string => file.replace(/^classes\//, "").replace(/\.json$/, "");

/**
 * Selector de idioma de la interfaz y de los textos del juego. Cada idioma es una URL propia: son enlaces (los buscadores y quien
 * no tenga JavaScript los siguen) y, al pulsar, se conserva el estado de la página (`?b=…`) leyéndolo de la dirección actual.
 */
export function LanguageSwitch({ page, query }: { page: Page; query: Record<string, string> }) {
  const { lang, setLang, dataStatus } = useLang();
  const names: Record<Lang, string> = { es: "Español", en: dataStatus === "loading" ? "English (loading…)" : "English" };
  return (
    <div className="lang-switch" role="group" aria-label={tr("Idioma")}>
      {LANGS.map((l) => (
        <a
          key={l}
          href={href(page, query, l)}
          hrefLang={l}
          lang={l}
          title={names[l]}
          aria-current={lang === l ? "true" : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            setLang(l);
            navigate(href(page, Object.fromEntries(new URLSearchParams(window.location.search)), l));
          }}
        >
          {l.toUpperCase()}
        </a>
      ))}
    </div>
  );
}

export interface ChromeProps {
  manifest: Manifest;
  page: Page;
  /** Valor de `?s=` (sección de la portada que se está mirando). */
  section: string | null;
  /** Parámetros que se conservan al navegar (los puntos de Legado). */
  q: Record<string, string>;
  /** Parámetros de la página actual, para el selector de idioma. */
  query: Record<string, string>;
}

export function SiteHeader({ manifest, page, section, q, query }: ChromeProps) {
  const { version, number } = splitBuild(manifest.build);
  const deployedAt = formatDeployedAt();
  const onHome = page.kind === "home";
  const inClass = page.kind === "class" || page.kind === "class-talents" || page.kind === "class-abilities" || page.kind === "talent" || page.kind === "ability";
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href={href({ kind: "home" }, q)}>
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}logo-forever-mark.png`} alt="" width={52} height={52} />
          <span className="brand-text">
            <b>WoW Forever</b>
            <small>{tr("Calculadora definitiva")}</small>
          </span>
        </a>
        <nav className="main-nav" aria-label={tr("Principal")}>
          <a href={href({ kind: "home" }, { ...q, s: "clases" })} onClick={() => scrollToSection("clases")} className="nav-link" aria-current={inClass || (onHome && (!section || section === "clases")) ? "page" : undefined}>
            {tr("Clases")}
          </a>
          <a href={href({ kind: "races" }, q)} className="nav-link" aria-current={page.kind === "races" || page.kind === "race" ? "page" : undefined}>
            {tr("Razas")}
          </a>
          <a href={href({ kind: "home" }, { ...q, s: "pasos" })} onClick={() => scrollToSection("pasos")} className="nav-link" aria-current={onHome && section === "pasos" ? "page" : undefined}>
            {tr("Cómo funciona")}
          </a>
          <a href={href({ kind: "home" }, { ...q, s: "datos" })} onClick={() => scrollToSection("datos")} className="nav-link" aria-current={onHome && section === "datos" ? "page" : undefined}>
            {tr("De dónde salen los datos")}
          </a>
          <a href={href({ kind: "unassigned" }, q)} className="nav-link" aria-current={page.kind === "unassigned" ? "page" : undefined}>
            {tr("Datos sin asignar")}
          </a>
        </nav>
        <LanguageSwitch page={page} query={query} />
        <span className="build-tag" title={tr("Datos extraídos el {date}", { date: manifest.generatedAt.slice(0, 10) })}>
          <span>
            Beta {version}
            {number && ` · build ${number}`}
          </span>
          {deployedAt && <span className="build-tag-date">{tr("web actualizada el {date}", { date: deployedAt })}</span>}
        </span>
      </div>
    </header>
  );
}

export function SiteFooter({ manifest, q }: { manifest: Manifest; q: Record<string, string> }) {
  const { lang } = useLang();
  const { number } = splitBuild(manifest.build);
  return (
    <footer>
      <div className="wrap">
        <nav className="footer-links" aria-label={tr("Clases")}>
          {manifest.classes.map((c) => {
            const token = classToken(c.file);
            return (
              <a key={c.classId} href={href({ kind: "class", cls: token }, q)}>
                {classLabel(token, c.className ?? "")}
              </a>
            );
          })}
          <a href={href({ kind: "races" }, q)}>{tr("Razas")}</a>
        </nav>
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
          <a href="https://github.com/MattJCR/wowforeverultimatecalculator/blob/main/CONTRIBUTING.md" target="_blank" rel="noreferrer">
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
  );
}
