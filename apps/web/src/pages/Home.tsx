import type { Manifest } from "@wfuc/schema";
import { useEffect } from "react";
import { legacyQuery, useCharacter } from "../character";
import { Icon } from "../components/Icon";
import { CLASS_COLORS } from "../data";
import { classLabel, specLabel, tr } from "../i18n";
import { href, scrollToSection, type Route } from "../router";

export const classToken = (file: string): string => file.replace(/^classes\//, "").replace(/\.json$/, "");

const STEPS = [
  { title: "Raza", text: "Elige entre las razas que el cliente permite para tu clase y consulta sus raciales." },
  { title: "Puntos de Legado", text: "Ventajas de cuenta. Talentoso adelanta tu primer punto de talento, por eso van antes." },
  { title: "Talentos", text: "Gasta tus puntos en los tres árboles con las reglas reales del cliente." },
  { title: "Equipo", text: "Prueba piezas, encantamientos y bonos de conjunto en los 19 huecos." },
  { title: "Beneficios", text: "Marca bendiciones, auras, tótems, elixires, frascos y comida: se suman a tus estadísticas." },
  { title: "Resumen", text: "Consulta estadísticas y daño de cada habilidad según tu nivel, del 1 al 60." },
];

const ARROW = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/** Ejemplo ilustrativo de lo que se ve al planificar un personaje (no es un build real). */
function ExampleCard() {
  const trees = [
    { name: tr("Arcano"), points: 5 },
    { name: tr("Fuego"), points: 0 },
    { name: tr("Escarcha"), points: 14 },
  ];
  return (
    <div className="card hero-example" aria-hidden="true">
      <div className="hero-example-head">
        <span className="crest" style={{ ["--c" as string]: CLASS_COLORS.mage }}>
          M
        </span>
        <div>
          <h2>{tr("Mago · Humano")}</h2>
          <p>{tr("Escarcha profunda")}</p>
        </div>
        <span className="chip">{tr("Ejemplo de build")}</span>
      </div>
      <ul className="hero-example-bars">
        {trees.map((t) => (
          <li key={t.name}>
            <span>{t.name}</span>
            <span className="meter">
              <span style={{ width: `${(t.points / 27) * 100}%` }} />
            </span>
            <b>{t.points}</b>
          </li>
        ))}
      </ul>
      <div className="hero-example-stats">
        <div>
          <p>{tr("Nivel necesario")}</p>
          <b>26</b>
        </div>
        <div>
          <p>{tr("Puntos restantes")}</p>
          <b>32</b>
        </div>
        <div>
          <p>{tr("Primer punto")}</p>
          <b>{tr("Nivel {n}", { n: 8 })}</b>
        </div>
      </div>
      <div className="hero-example-link">
        <span>…/#/class/mage?r=1&amp;b=Aq3x…&amp;v=talents</span>
        <span className="chip chip-solid">{tr("Copiar")}</span>
      </div>
    </div>
  );
}

export function Home({ manifest, query }: { manifest: Manifest; query: Route["query"] }) {
  const { legacyCode } = useCharacter();
  const q = legacyQuery(legacyCode);
  const section = query.get("s");
  // Los enlaces de la cabecera («Cómo funciona», «De dónde salen los datos») llegan con ?s=<id>: se baja a esa sección
  useEffect(() => {
    if (!section) return;
    document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <div className="home">
      <section className="hero wrap">
        <div className="hero-text">
          <p className="eyebrow">{tr("Calculadora para jugadores de WoW Forever")}</p>
          <h1>{tr("Planifica tu personaje de WoW Forever")}</h1>
          <p className="hero-lead">{tr("Talentos, raza, Puntos de Legado y equipo con los datos reales del cliente de la beta. Tu build se guarda en el enlace: cópialo y compártelo con tu hermandad.")}</p>
          <div className="hero-actions">
            <a className="btn btn-primary" href={href("", { ...q, s: "clases" })} onClick={() => scrollToSection("clases")}>
              {tr("Elige tu clase")}
              {ARROW}
            </a>
            <a className="btn" href={href("", { ...q, s: "pasos" })} onClick={() => scrollToSection("pasos")}>
              {tr("Cómo funciona")}
            </a>
          </div>
          <ul className="hero-facts">
            <li>{tr("{n} clases", { n: manifest.classes.length })}</li>
            <li>{tr("Datos extraídos del cliente")}</li>
            <li>{tr("Sin cuenta ni registro")}</li>
          </ul>
        </div>
        <ExampleCard />
      </section>

      <section id="clases" className="home-section wrap">
        <header className="section-head">
          <p className="eyebrow">{tr("Empieza aquí")}</p>
          <h2>{tr("¿Qué clase juegas?")}</h2>
          <p>{tr("Elige una para empezar por la raza. Tus Puntos de Legado se conservan al cambiar de clase.")}</p>
        </header>
        <ul className="class-grid">
          {manifest.classes.map((c) => {
            const token = classToken(c.file);
            const name = classLabel(token, c.className ?? "");
            return (
              <li key={c.classId}>
                <a className="class-card" href={href(`class/${token}`, q)} style={{ ["--c" as string]: CLASS_COLORS[token] ?? "#e0b04a" }}>
                  <span className="class-card-head">
                    <Icon id={c.iconFileDataId} name={name} />
                    <span className="class-name">{name}</span>
                    <span className="go">{ARROW}</span>
                  </span>
                  {c.specNames.length > 0 ? (
                    <span className="class-specs">
                      {c.specNames.map((s, i) => (
                        <span key={s} className="chip">
                          {specLabel(token, i, s)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="class-meta">{tr("{n} talentos", { n: c.talentCount })}</span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="pasos" className="band">
        <div className="wrap home-section">
          <header className="section-head">
            <p className="eyebrow">{tr("Cómo funciona")}</p>
            <h2>{tr("Seis pasos, de la raza al daño final")}</h2>
            <p>{tr("Puedes saltar de un paso a otro cuando quieras: todo se recalcula y se guarda en el enlace.")}</p>
          </header>
          <ol className="home-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card">
                <span className="step-n">{i + 1}</span>
                <h3>{tr(s.title)}</h3>
                <p>{tr(s.text)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="datos" className="home-section wrap">
        <header className="section-head">
          <p className="eyebrow">{tr("Transparencia")}</p>
          <h2>{tr("Cada cifra te dice de dónde sale")}</h2>
          <p>{tr("El cliente de la beta es la fuente de verdad. Lo que no se puede confirmar se muestra siempre como estimación, con su aviso.")}</p>
        </header>
        <div className="provenance-grid">
          <div className="card">
            <span className="chip">
              <span className="dot dot-client" />
              {tr("Cliente")}
            </span>
            <h3>{tr("Sale del juego")}</h3>
            <p>{tr("Talentos, razas, rangos y textos leídos directamente de los ficheros del cliente. Es el dato más fiable.")}</p>
          </div>
          <div className="card">
            <span className="chip">
              <span className="dot dot-community" />
              {tr("Comunidad")}
            </span>
            <h3>{tr("Aportado por jugadores")}</h3>
            <p>{tr("Datos que el cliente no trae, como las puntuaciones de algunos objetos. Se contrastan y se marcan como no oficiales.")}</p>
          </div>
          <div className="card">
            <span className="chip">
              <span className="dot dot-estimate" />
              {tr("Estimación")}
            </span>
            <h3>{tr("Pendiente de confirmar")}</h3>
            <p>{tr("Calculado con reglas de Classic mientras Forever no publique las suyas. Verás el aviso junto a la cifra.")}</p>
          </div>
        </div>
      </section>

      <section className="band band-last">
        <div className="wrap home-section">
          <h2 className="roadmap-title">{tr("Qué hay y qué viene")}</h2>
          <div className="roadmap-grid">
            <div>
              <h3 className="roadmap-now">{tr("Disponible ahora")}</h3>
              <ul>
                <li>{tr("Árboles de talentos de las {n} clases", { n: manifest.classes.length })}</li>
                <li>{tr("Puntos de Legado y razas con sus raciales")}</li>
                <li>{tr("Equipo, encantamientos y bonos de conjunto")}</li>
                <li>{tr("Enlace para compartir y «Copiar para IA»")}</li>
              </ul>
            </div>
            <div>
              <h3 className="roadmap-wip">{tr("En construcción")}</h3>
              <ul>
                <li>{tr("Daño y curación por habilidad (estimación con reglas de Classic)")}</li>
                <li>{tr("Reglas de atributos de Forever, pendientes de confirmar")}</li>
              </ul>
            </div>
            <div>
              <h3 className="roadmap-next">{tr("Próximamente")}</h3>
              <ul>
                <li>{tr("Simulación por rotación")}</li>
                <li>{tr("Escalado real de cada clase con equipo y talentos")}</li>
              </ul>
            </div>
          </div>
          <p className="roadmap-foot">
            <a href={href("unassigned", q)}>{tr("Ver datos del cliente sin asignar")}</a> ({tr("{a} talentos sin nodo y {b} árboles descartados, con prueba libre de rangos", { a: manifest.unassigned.orphanEntries, b: manifest.unassigned.alternativeTrees })}).
          </p>
        </div>
      </section>
    </div>
  );
}
