import type { Manifest } from "@wfuc/schema";
import type { ReactNode } from "react";
import { isEmptyCode } from "../character";
import { CLASS_COLORS } from "../data";
import { classLabel, tr } from "../i18n";
import { href } from "../router";
import { isCalcView, type CalcView } from "../seo/routes";
import { Icon } from "./Icon";

export type View = CalcView;

// La raza va primero (paso propio, con su caja como los talentos). Legacy va ANTES que los talentos de clase:
// Talentoso (Legacy) adelanta el primer punto de talento y cambia el nivel que exigen.
export const VIEWS: { id: View; label: string }[] = [
  { id: "race", label: "Raza" },
  { id: "legacy", label: "Puntos de Legado" },
  { id: "talents", label: "Talentos" },
  { id: "gear", label: "Equipo" },
  { id: "buffs", label: "Beneficios" },
  { id: "summary", label: "Resumen" },
];
/** Nombre del paso en el idioma elegido (`VIEWS` guarda el texto en español, que es la clave del diccionario). */
export const viewLabel = (v: { label: string }): string => tr(v.label);
export const isView = isCalcView;

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** Selector de clase: conserva Legacy y la raza al cambiar (si la nueva clase no admite la raza, el paso Raza la ignora). */
export function ClassSwitcher({ current, view, legacyCode, raceQuery, manifest }: { current: string; view: View; legacyCode: string; raceQuery: Record<string, string>; manifest: Manifest }) {
  return (
    <nav className="class-switcher" aria-label={tr("Clases")}>
      {manifest.classes.map((c) => {
        const t = c.file.replace(/^classes\//, "").replace(/\.json$/, "");
        const q: Record<string, string> = { ...(isEmptyCode(legacyCode) ? {} : { l: legacyCode }), ...raceQuery };
        return (
          <a key={c.classId} href={href({ kind: "calc", cls: t, view }, q)} className="class-chip" style={{ ["--c" as string]: CLASS_COLORS[t] }} aria-current={t === current ? "page" : undefined}>
            <Icon id={c.iconFileDataId} name={classLabel(t, c.className ?? "")} />
            <span>{classLabel(t, c.className ?? "")}</span>
          </a>
        );
      })}
    </nav>
  );
}

export interface StepStatus {
  /** Texto corto bajo el nombre del paso: «Humano», «12/16»… */
  sub: string;
  /** El paso ya tiene algo elegido: se marca con un check cuando no es el actual. */
  done: boolean;
}

/** Barra de pasos: cada paso dice en que estado esta (nada elegido, hecho, el actual). */
export function Stepper({ view, onGo, status }: { view: View; onGo: (v: View) => void; status: Record<View, StepStatus> }) {
  return (
    <nav aria-label={tr("Pasos del personaje")}>
      <ol className="steps">
        {VIEWS.map((v, i) => {
          const s = status[v.id];
          const on = view === v.id;
          return (
            <li key={v.id}>
              <button type="button" className={`step${on ? " on" : ""}${s.done && !on ? " done" : ""}`} aria-current={on ? "step" : undefined} onClick={() => onGo(v.id)}>
                <span className="step-n" aria-hidden="true">
                  {s.done && !on ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="step-text">
                  <b>{viewLabel(v)}</b>
                  <i>{s.sub}</i>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Anterior / Siguiente al final de cada paso. En el primero, `leading` ocupa el lado izquierdo (p. ej. «Quitar raza»). */
export function StepNav({ view, onGo, leading, className }: { view: View; onGo: (v: View) => void; leading?: ReactNode; className?: string }) {
  const i = VIEWS.findIndex((v) => v.id === view);
  const prev = VIEWS[i - 1];
  const next = VIEWS[i + 1];
  return (
    <div className={`step-nav${className ? ` ${className}` : ""}`}>
      {prev ? (
        <button type="button" className="btn step-prev" onClick={() => onGo(prev.id)}>
          <svg {...svg}>
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          <span>
            {tr("Anterior")}<span className="step-to">: {viewLabel(prev)}</span>
          </span>
        </button>
      ) : (
        (leading ?? <span />)
      )}
      {next && (
        <button type="button" className="btn btn-primary step-next" onClick={() => onGo(next.id)}>
          <span>
            {tr("Siguiente")}<span className="step-to">: {viewLabel(next)}</span>
          </span>
          <svg {...svg}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Tu personaje: clase, raza, Legado y equipo de un vistazo, y las acciones que valen para todos los pasos. */
export function CharacterBar({
  className,
  iconId,
  raceLabel,
  legacyLabel,
  gearLabel,
  onGo,
  onReset,
  canReset,
  onCopyAI,
  onCopyLink,
}: {
  className: string;
  iconId: number | null;
  raceLabel: string | null;
  legacyLabel: string | null;
  gearLabel: string;
  onGo: (v: View) => void;
  onReset: () => void;
  canReset: boolean;
  onCopyAI: () => void;
  onCopyLink: () => void;
}) {
  return (
    <section className="card char-bar" aria-label={tr("Tu personaje")}>
      <div className="char-id">
        <span className="char-crest">
          <Icon id={iconId} name={className} />
        </span>
        <div>
          <h1>{className}</h1>
          <div className="char-chips">
            <button type="button" className="chip chip-link" onClick={() => onGo("race")} title={tr("Cambiar de raza")}>
              {raceLabel ?? tr("Sin raza")}
            </button>
            {legacyLabel && (
              <button type="button" className="chip chip-link" onClick={() => onGo("legacy")} title={tr("Ir a los Puntos de Legado")}>
                {tr("Legado")} {legacyLabel}
              </button>
            )}
            <button type="button" className="chip chip-link" onClick={() => onGo("gear")} title={tr("Ir al equipo")}>
              {tr("Equipo")} {gearLabel}
            </button>
          </div>
        </div>
      </div>
      <div className="char-actions">
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={!canReset} title={tr("Borra raza, talentos, Puntos de Legado y equipo de este personaje")}>
          <svg {...svg}>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
          </svg>
          {tr("Reiniciar")}
        </button>
        <button type="button" className="btn" id="copyAI" onClick={onCopyAI} title={tr("Copia este build con el texto completo de cada talento (clase y Puntos de Legado), para pegarlo en una IA y preguntarle algo")}>
          {tr("Copiar para IA")}
        </button>
        <button type="button" className="btn btn-primary" onClick={onCopyLink}>
          <svg {...svg}>
            <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
          </svg>
          {tr("Copiar enlace")}
        </button>
      </div>
    </section>
  );
}
