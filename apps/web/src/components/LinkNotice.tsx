import type { DecodeReport, LostPoints } from "@wfuc/engine";
import { useState } from "react";
import { tr } from "../i18n";

const REASON: Partial<Record<LostPoints["reason"], string>> = {
  "row-locked": "ya no se cumple el requisito de puntos en las filas superiores",
  prerequisite: "ya no se cumple su prerrequisito",
  "no-points": "se supera el máximo de puntos",
  inactive: "ahora es un nodo no activo",
};

const pts = (n: number) => `${n} ${n === 1 ? tr("punto") : tr("puntos")}`;

/** Lo que un enlace de otra versión de los datos no ha podido conservar, en frases para mostrar. */
export function describeLoss(report: DecodeReport): string[] {
  const lines: string[] = [];
  const gone = report.lost.filter((l) => l.reason === "removed");
  if (gone.length) {
    const total = gone.reduce((n, l) => n + l.wanted, 0);
    lines.push(gone.length === 1 ? tr("1 talento que ya no existe en esta versión de los datos ({pts} liberados).", { pts: pts(total) }) : tr("{n} talentos que ya no existen en esta versión de los datos ({pts} liberados).", { n: gone.length, pts: pts(total) }));
  }
  for (const l of report.lost) {
    if (l.reason === "removed") continue;
    const name = l.name ?? tr("Nodo {id}", { id: l.nodeId });
    if (l.reason === "max-rank-lowered") lines.push(tr("{name}: ahora tiene como máximo {kept} rangos (el enlace pedía {wanted}).", { name, kept: l.kept, wanted: l.wanted }));
    else lines.push(`${name}: ${tr("{pts} sin colocar", { pts: pts(l.wanted - l.kept) })}${REASON[l.reason] ? ` (${tr(REASON[l.reason]!)})` : ""}.`);
  }
  return lines;
}

/**
 * Aviso cuando un enlace viene de otra versión de los datos (un hotfix quitó o movió talentos): se conserva lo que sigue siendo
 * válido y aquí se cuenta lo que no. El enlace se reescribe solo con el código nuevo.
 */
export function LinkNotice({ title, report }: { title: string; report: DecodeReport | null }) {
  const [closed, setClosed] = useState(false);
  if (!report || closed) return null;
  const lines = describeLoss(report);
  if (report.malformed) lines.push(report.legacyFormat ? tr("El código del enlace es del formato antiguo (por posición) y ya no encaja con esta versión de los datos: no se puede recuperar.") : tr("El código del enlace no es válido y se ha ignorado."));
  if (lines.length === 0) return null;
  return (
    <div className="link-notice" role="status">
      <div>
        <strong>{title}: {tr("este enlace es de otra versión de los datos.")}</strong> {tr("Se ha conservado lo que sigue siendo válido; los puntos liberados puedes volver a gastarlos.")}
        <ul>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={() => setClosed(true)} aria-label={tr("Cerrar el aviso")}>
        ×
      </button>
    </div>
  );
}
