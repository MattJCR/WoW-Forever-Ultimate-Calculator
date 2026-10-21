import { canAdd, canRemove, gateProgress, rankOf, type Build, type ClassIndex } from "@wfuc/engine";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BLOCKER_TEXT } from "../messages";
import { fitCardToViewport } from "./fit";
import { Icon } from "./Icon";
import type { Anchor, Focus } from "./TreePanel";

interface Props {
  idx: ClassIndex;
  build: Build;
  /** Talento a mostrar: el que tiene el cursor o el foco, o si no el ultimo que se eligio. */
  shown: Focus | null;
  onAdd: (nodeId: number, max?: boolean) => void;
  onRemove: (nodeId: number) => void;
  /** Contenido extra al final del panel (en el movil lleva «Anterior / Siguiente»). */
  footer?: ReactNode;
}

/** Texto de una descripcion: respeta los saltos de linea y resalta los valores que aun no se pueden calcular. */
export function DescText({ text }: { text: string }) {
  const parts = text.split(/(\$[A-Za-z0-9@<>?]+)/g);
  return (
    <p className="desc-text">
      {parts.map((p, i) =>
        p.startsWith("$") ? (
          <span key={i} className="unresolved" title="Valor que depende de tu personaje (poder de ataque, nivel…): aún no se calcula">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </p>
  );
}

export type TextOrigin = "client" | "translated-by-us" | "untranslated";

/** Aviso cuando el texto no es el espanol del cliente: el cliente de la beta aun trae en ingles algunos textos nuevos de Forever. */
export function originNote(origin: TextOrigin | undefined): string | null {
  if (origin === "translated-by-us") return "Traducción propia: el cliente de la beta aún trae este texto en inglés. Los números sí son del cliente.";
  if (origin === "untranslated") return "Este texto está en inglés en el cliente de la beta y aún no tiene traducción.";
  return null;
}

export function Notes({ approximate, complete, origin }: { approximate: boolean; complete: boolean; origin?: TextOrigin }) {
  const note = originNote(origin);
  if (complete && !approximate && !note) return null;
  return (
    <ul className="notes">
      {note && <li className="origin-note">{note}</li>}
      {approximate && <li>Valores base del cliente: en el juego varían con tu nivel.</li>}
      {!complete && <li>Los valores subrayados dependen de tu personaje y aún no se calculan.</li>}
    </ul>
  );
}

/**
 * Tarjeta junto al talento enfocado (como el tooltip del juego): aparece mientras el cursor o el foco estan sobre el
 * talento y desaparece al salir. En pantallas con raton no recibe clics; en tactiles si (lleva + y −).
 */
export function FloatingCard({ anchor, className, placement = "side", children }: { anchor: Anchor; className?: string; /** «side»: a un lado del elemento; «below»: debajo (o encima si no cabe), para no tapar los elementos vecinos de una fila de iconos. */ placement?: "side" | "below"; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitCardToViewport(el); // sin scroll: la letra se reduce lo justo para que quepa entera
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    if (placement === "below") {
      const cx = (anchor.left + anchor.right) / 2;
      const left = Math.min(Math.max(8, cx - w / 2), Math.max(8, vw - w - 8));
      const below = anchor.bottom + 8;
      const top = below + h <= vh - 8 ? below : Math.max(8, anchor.top - 8 - h); // no cabe debajo: encima
      setPos({ left, top });
      return;
    }
    let left = anchor.right + 12;
    if (left + w > vw - 8) left = Math.max(8, anchor.left - 12 - w); // no cabe a la derecha: a la izquierda
    const top = Math.min(Math.max(8, anchor.top - 8), Math.max(8, vh - h - 8));
    setPos({ left, top });
  }, [anchor, placement]);

  return (
    <aside ref={ref} className={`detail${className ? ` ${className}` : ""}`} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }} aria-live="polite">
      {children}
    </aside>
  );
}

/** Panel con el detalle del talento: nombre, rango, botones + y −, requisitos y texto del cliente. Sin talento elegido invita a elegir uno. */
export function TalentInspector({ idx, build, shown, onAdd, onRemove, footer }: Props) {
  if (!shown) {
    return (
      <section className="card inspector inspector-empty" aria-live="polite">
        <h3>Detalle del talento</h3>
        <p className="muted">Pasa el cursor por un talento o tócalo para ver aquí su descripción, sus requisitos y los botones para sumar o quitar puntos.</p>
        {footer}
      </section>
    );
  }

  if (shown.kind === "inactive") {
    const t = idx.inactiveByNode.get(shown.nodeId);
    if (!t) return null;
    return (
      <section className="card inspector inactive" aria-live="polite">
        <div className="tag tag-inactive">Nodo no activo</div>
        <div className="inspector-head">
          <Icon id={t.iconFileDataId} name={t.name} />
          <div>
            <h3>{t.name ?? `Hechizo ${t.spellId}`}</h3>
            <p className="rank-line">{t.maxRank} rangos · no seleccionable</p>
          </div>
        </div>
        <p className="small">
          El cliente trae este nodo, pero está fuera de la rejilla del árbol (posición {t.raw.posX}, {t.raw.posY}). No se puede seleccionar ni cuenta en los puntos.
        </p>
        <h5>Rango 1</h5>
        <DescText text={t.descriptions[0] ?? ""} />
        <Notes approximate={t.descriptionsApproximate} complete={t.descriptionsComplete} origin={t.textOrigin} />
        <dl>
          <dt>Hechizo</dt>
          <dd>#{t.spellId}</dd>
          {t.nearestSpecIndex !== null && (
            <>
              <dt>Cercano a</dt>
              <dd>{idx.data.specs[t.nearestSpecIndex]?.name ?? "—"}</dd>
            </>
          )}
        </dl>
        {footer}
      </section>
    );
  }

  const item = idx.byNode.get(shown.nodeId);
  if (!item) return null;
  const { talent, specIndex } = item;
  const rank = rankOf(build, talent.nodeId);
  const add = canAdd(idx, build, talent.nodeId);
  const remove = canRemove(idx, build, talent.nodeId);
  const { have } = gateProgress(idx, build, talent, specIndex);
  const isLegacy = idx.data.kind === "legacy";
  const prereqs = talent.prerequisites.map((p) => idx.byNode.get(p.nodeId)?.talent);
  const specName = idx.data.specs[specIndex]?.name;

  return (
    <section className="card inspector" aria-live="polite">
      <div className="inspector-head">
        <Icon id={talent.iconFileDataId} name={talent.name} />
        <div>
          <h3>{talent.name ?? `Hechizo ${talent.spellId}`}</h3>
          <p className="rank-line">{specName ? `Árbol ${specName}` : isLegacy ? "Puntos de Legado" : "Talento"}</p>
        </div>
      </div>

      <div className="rank-control">
        <button type="button" className="btn btn-square" onClick={() => onRemove(talent.nodeId)} disabled={!remove.ok} aria-label="Quitar un punto">
          −
        </button>
        <div className="rank-value">
          <b>
            {rank} / {talent.maxRank}
          </b>
          <span>Rango</span>
        </div>
        <button type="button" className="btn btn-square btn-primary" onClick={() => onAdd(talent.nodeId)} disabled={!add.ok} aria-label="Sumar un punto">
          +
        </button>
      </div>
      {!add.ok && rank < talent.maxRank && <p className="why">{BLOCKER_TEXT[add.reason!]}</p>}

      {rank > 0 && (
        <>
          <h5>{talent.maxRank > 1 ? `Rango actual (${rank})` : "Descripción"}</h5>
          <DescText text={talent.descriptions[rank - 1] ?? ""} />
        </>
      )}
      {rank < talent.maxRank && (
        <>
          <h5>{rank === 0 ? (talent.maxRank > 1 ? "Rango 1" : "Descripción") : `Siguiente rango (${rank + 1})`}</h5>
          <DescText text={talent.descriptions[rank] ?? ""} />
        </>
      )}
      <Notes approximate={talent.descriptionsApproximate} complete={talent.descriptionsComplete} origin={talent.textOrigin} />

      <ul className="reqs">
        {talent.requiredPoints > 0 && (
          <li className={have >= talent.requiredPoints ? "ok" : "bad"}>
            {isLegacy
              ? `Requiere ${talent.requiredPoints} puntos gastados en ${specName} (${have}/${talent.requiredPoints})`
              : `Requiere ${talent.requiredPoints} puntos en las filas superiores de ${specName} (${have}/${talent.requiredPoints})`}
          </li>
        )}
        {prereqs.map((p, i) =>
          p ? (
            <li key={i} className={rankOf(build, p.nodeId) >= p.maxRank ? "ok" : "bad"}>
              Requiere {p.name} al máximo ({rankOf(build, p.nodeId)}/{p.maxRank})
            </li>
          ) : null,
        )}
      </ul>
      {(!talent.textOrigin || talent.textOrigin === "client") && (
        <span className="chip">
          <span className="dot dot-client" />
          Texto del cliente
        </span>
      )}
      {/* Solo con raton: en pantallas tactiles se usan los botones + y − */}
      <p className="hint">Clic: sumar · Clic derecho o Supr: quitar · Mayús + clic: al máximo</p>
      {footer}
    </section>
  );
}
