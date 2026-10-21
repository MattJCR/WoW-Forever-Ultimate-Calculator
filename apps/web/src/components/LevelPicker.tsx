import type { CSSProperties, ReactNode } from "react";
import { tr } from "../i18n";

/** Nivel del personaje del Resumen: lo comparten las estadísticas y las habilidades. `children` es la nota que explica el rango. */
export function LevelPicker({ level, setLevel, minLevel, children }: { level: number; setLevel: (l: number) => void; minLevel: number; children?: ReactNode }) {
  const mine = Math.max(1, minLevel);
  return (
    <section className="card level-card" aria-label={tr("Nivel del personaje")}>
      <div className="level-main">
        <label htmlFor="level-range">{tr("Nivel")}</label>
        <output htmlFor="level-range" className="level-out">
          {level}
        </output>
      </div>
      <div className="level-slider">
        <input
          id="level-range"
          type="range"
          min={1}
          max={60}
          step={1}
          value={level}
          style={{ ["--pct" as string]: `${((level - 1) / 59) * 100}%` } as CSSProperties}
          onChange={(e) => setLevel(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
        />
        <div className="level-presets">
          <button type="button" className={`chip chip-link${level === mine ? " on" : ""}`} onClick={() => setLevel(mine)} title={tr("El nivel que exigen tus puntos de talento")}>
            {tr("Mi nivel")} ({mine})
          </button>
          <button type="button" className={`chip chip-link${level === 30 ? " on" : ""}`} onClick={() => setLevel(30)} title={tr("El nivel máximo de la beta")}>
            {tr("30 (tope de la beta)")}
          </button>
          <button type="button" className={`chip chip-link${level === 60 ? " on" : ""}`} onClick={() => setLevel(60)}>
            60
          </button>
        </div>
      </div>
      {children && <p className="level-note">{children}</p>}
    </section>
  );
}
