import { canAdd, canRemove, gateProgress, rankOf, type Build, type ClassIndex } from "@wfuc/engine";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isEnglish, talentName, talentText, tr, treeLabel } from "../i18n";
import { blockerText } from "../messages";
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
          <span key={i} className="unresolved" title={tr("Valor que depende de tu personaje (poder de ataque, nivel…): aún no se calcula")}>
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
  if (isEnglish()) return null; // en inglés el texto del cliente (ya en inglés) o el oficial en inglés se ven tal cual
  if (origin === "translated-by-us") return tr("Traducción propia: el cliente de la beta aún trae este texto en inglés. Los números sí son del cliente.");
  if (origin === "untranslated") return tr("Este texto está en inglés en el cliente de la beta y aún no tiene traducción.");
  return null;
}

export function Notes({ approximate, complete, origin, english = false, ownEnglish = false, missingEnglish = false }: { approximate: boolean; complete: boolean; origin?: TextOrigin; /** El texto mostrado es el inglés del juego (nivel 60). */ english?: boolean; /** El texto inglés es traducción propia (el oficial trae otras cifras). */ ownEnglish?: boolean; /** English elegido pero este texto no tiene inglés: se ve el español. */ missingEnglish?: boolean }) {
  const note = originNote(origin);
  if (english) {
    return (
      <ul className="notes">
        <li>{tr("Texto en inglés del juego, a nivel 60.")}</li>
        {ownEnglish && <li className="origin-note">{tr("Traducción propia al inglés: el texto oficial trae otras cifras que el cliente. Las cifras son las del cliente.")}</li>}
      </ul>
    );
  }
  if (complete && !approximate && !note && !missingEnglish) return null;
  return (
    <ul className="notes">
      {missingEnglish && <li className="origin-note">{tr("Aún sin texto en inglés: se muestra el español del cliente.")}</li>}
      {note && <li className="origin-note">{note}</li>}
      {approximate && <li>{tr("Valores base del cliente: en el juego varían con tu nivel.")}</li>}
      {!complete && <li>{tr("Los valores subrayados dependen de tu personaje y aún no se calculan.")}</li>}
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
        <h3>{tr("Detalle del talento")}</h3>
        <p className="muted">{tr("Pasa el cursor por un talento o tócalo para ver aquí su descripción, sus requisitos y los botones para sumar o quitar puntos.")}</p>
        {footer}
      </section>
    );
  }

  if (shown.kind === "inactive") {
    const t = idx.inactiveByNode.get(shown.nodeId);
    if (!t) return null;
    const name = talentName(t.nodeId, t.name ?? tr("Hechizo {id}", { id: t.spellId }));
    const loc = talentText(t.nodeId, 0, t.descriptions[0] ?? "");
    return (
      <section className="card inspector inactive" aria-live="polite">
        <div className="tag tag-inactive">{tr("Datamining")}</div>
        <div className="inspector-head">
          <Icon id={t.iconFileDataId} name={name} />
          <div>
            <h3>{name}</h3>
            <p className="rank-line">{tr("{n} rangos · no seleccionable", { n: t.maxRank })}</p>
          </div>
        </div>
        <p className="small">{tr("El cliente trae este nodo, pero está fuera de la rejilla del árbol (posición {x}, {y}). No se puede seleccionar ni cuenta en los puntos.", { x: t.raw.posX, y: t.raw.posY })}</p>
        <h5>{tr("Rango 1")}</h5>
        <DescText text={loc.text} />
        <Notes approximate={t.descriptionsApproximate} complete={t.descriptionsComplete} origin={t.textOrigin} english={loc.fromEnglish} ownEnglish={!!loc.own} missingEnglish={isEnglish() && !loc.fromEnglish} />
        <dl>
          <dt>{tr("Hechizo")}</dt>
          <dd>#{t.spellId}</dd>
          {t.nearestSpecIndex !== null && (
            <>
              <dt>{tr("Cercano a")}</dt>
              <dd>{treeLabel(idx.data, t.nearestSpecIndex, idx.data.specs[t.nearestSpecIndex]?.name ?? "—")}</dd>
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
  const spec = idx.data.specs[specIndex];
  const specName = spec ? treeLabel(idx.data, specIndex, spec.name ?? "") : undefined;
  const talentLabel = talentName(talent.nodeId, talent.name ?? tr("Hechizo {id}", { id: talent.spellId }));
  const descNow = rank > 0 ? talentText(talent.nodeId, rank - 1, talent.descriptions[rank - 1] ?? "") : null;
  const descNext = rank < talent.maxRank ? talentText(talent.nodeId, rank, talent.descriptions[rank] ?? "") : null;
  const showing = descNow ?? descNext;

  return (
    <section className="card inspector" aria-live="polite">
      <div className="inspector-head">
        <Icon id={talent.iconFileDataId} name={talentLabel} />
        <div>
          <h3>{talentLabel}</h3>
          <p className="rank-line">{specName ? tr("Árbol {name}", { name: specName }) : isLegacy ? tr("Puntos de Legado") : tr("Talento")}</p>
        </div>
      </div>

      <div className="rank-control">
        <button type="button" className="btn btn-square" onClick={() => onRemove(talent.nodeId)} disabled={!remove.ok} aria-label={tr("Quitar un punto")}>
          −
        </button>
        <div className="rank-value">
          <b>
            {rank} / {talent.maxRank}
          </b>
          <span>{tr("Rango")}</span>
        </div>
        <button type="button" className="btn btn-square btn-primary" onClick={() => onAdd(talent.nodeId)} disabled={!add.ok} aria-label={tr("Sumar un punto")}>
          +
        </button>
      </div>
      {!add.ok && rank < talent.maxRank && <p className="why">{blockerText(add.reason!)}</p>}

      {rank > 0 && (
        <>
          <h5>{talent.maxRank > 1 ? tr("Rango actual ({n})", { n: rank }) : tr("Descripción")}</h5>
          <DescText text={descNow!.text} />
        </>
      )}
      {rank < talent.maxRank && (
        <>
          <h5>{rank === 0 ? (talent.maxRank > 1 ? tr("Rango 1") : tr("Descripción")) : tr("Siguiente rango ({n})", { n: rank + 1 })}</h5>
          <DescText text={descNext!.text} />
        </>
      )}
      <Notes approximate={talent.descriptionsApproximate} complete={talent.descriptionsComplete} origin={talent.textOrigin} english={!!showing?.fromEnglish} ownEnglish={!!showing?.own} missingEnglish={isEnglish() && !showing?.fromEnglish} />

      <ul className="reqs">
        {talent.requiredPoints > 0 && (
          <li className={have >= talent.requiredPoints ? "ok" : "bad"}>
            {isLegacy
              ? tr("Requiere {n} puntos gastados en {name} ({have}/{n})", { n: talent.requiredPoints, name: specName ?? "", have })
              : tr("Requiere {n} puntos en las filas superiores de {name} ({have}/{n})", { n: talent.requiredPoints, name: specName ?? "", have })}
          </li>
        )}
        {prereqs.map((p, i) =>
          p ? (
            <li key={i} className={rankOf(build, p.nodeId) >= p.maxRank ? "ok" : "bad"}>
              {tr("Requiere {name} al máximo ({have}/{max})", { name: talentName(p.nodeId, p.name ?? ""), have: rankOf(build, p.nodeId), max: p.maxRank })}
            </li>
          ) : null,
        )}
      </ul>
      {showing?.fromEnglish ? (
        <span className="chip">
          <span className="dot dot-community" />
          {tr("Texto de la comunidad")}
        </span>
      ) : (
        (!talent.textOrigin || talent.textOrigin === "client") && (
          <span className="chip">
            <span className="dot dot-client" />
            {tr("Texto del cliente")}
          </span>
        )
      )}
      {/* Solo con raton: en pantallas tactiles se usan los botones + y − */}
      <p className="hint">{tr("Clic: sumar · Clic derecho o Supr: quitar · Mayús + clic: al máximo")}</p>
      {footer}
    </section>
  );
}
