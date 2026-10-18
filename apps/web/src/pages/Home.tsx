import type { Manifest } from "@wfuc/schema";
import { legacyQuery, useCharacter } from "../character";
import { Icon } from "../components/Icon";
import { CLASS_COLORS } from "../data";
import { href } from "../router";

export const classToken = (file: string): string => file.replace(/^classes\//, "").replace(/\.json$/, "");

export function Home({ manifest }: { manifest: Manifest }) {
  const { legacyCode } = useCharacter();
  const q = legacyQuery(legacyCode);
  return (
    <div className="home">
      <section className="hero">
        <h2>Planifica tu personaje en WoW Forever</h2>
        <ol className="flow">
          <li>
            <b>Raza</b> <span className="muted">(las que el cliente permite para tu clase, con sus raciales)</span>
          </li>
          <li>
            <b>Puntos de Legado</b> <span className="muted">(ventajas de cuenta: Talentoso adelanta el primer punto de talento)</span>
          </li>
          <li>
            <b>Clase y talentos</b>
          </li>
          <li>
            <b>Resumen</b> <span className="muted">de efectos según tu nivel</span>
          </li>
        </ol>
        <p>
          Árboles reales extraídos del cliente de la beta, con las reglas de puntos del propio cliente. Elige una clase y empieza a gastar puntos: tu build queda guardado en el enlace.
        </p>
      </section>

      <ul className="class-grid">
        {manifest.classes.map((c) => {
          const token = classToken(c.file);
          return (
            <li key={c.classId}>
              <a className="class-card" href={href(`class/${token}`, q)} style={{ ["--accent" as string]: CLASS_COLORS[token] ?? "#e8b64a" }}>
                <Icon id={c.iconFileDataId} name={c.className} />
                <span className="class-name">{c.className}</span>
                <span className="class-meta">{c.talentCount} talentos</span>
              </a>
            </li>
          );
        })}
      </ul>

      <section className="roadmap">
        <h3>Qué hay y qué viene</h3>
        <ul>
          <li>
            <strong>Ya:</strong> árboles de las 9 clases con iconos y descripción por rango, Puntos de Legado (16 puntos de cuenta que se suman a los de clase), reglas de puntos del cliente, enlace compartible y «Copiar build para IA».
          </li>
          <li>
            <strong>Pronto:</strong> bonificaciones de la raza en cifras, estadísticas, y cambios en daño, curación, coste y enfriamiento según el nivel.
          </li>
          <li>
            <strong>Después:</strong> builds de equipo junto con talentos para ver el escalado real de cada clase.
          </li>
        </ul>
        <p>
          <a href={href("unassigned", q)}>Ver datos del cliente sin asignar</a> ({manifest.unassigned.orphanEntries} talentos sin nodo y {manifest.unassigned.alternativeTrees} árboles descartados, con prueba libre de rangos).
        </p>
      </section>
    </div>
  );
}
