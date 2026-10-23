import { isLastingBuff, toggleBuff, type BuffIndex } from "@wfuc/engine";
import type { Buff, Manifest } from "@wfuc/schema";
import { useMemo, useState } from "react";
import { classLabel, fmtNum, isEnglish, tr, trn } from "../i18n";
import { effectLabel } from "./gear-format";
import { StepNav, type View } from "./ClassShell";
import { FloatingCard } from "./Detail";
import { Icon } from "./Icon";
import { anchorOf, type Anchor } from "./TreePanel";

/** Nombre de un beneficio en el idioma elegido (el inglés es el de las tablas oficiales; si falta, el del cliente). */
const buffName = (b: Buff): string => (isEnglish() && b.nameEn ? b.nameEn : b.name).replace(/(?<=\w\w)\.$/, "");

/** Duración corta: «30 min», «1 h», «15 s»; null = hasta cancelarla. */
function durationText(ms: number | null): string {
  if (ms === null) return tr("sin límite");
  const s = ms / 1000;
  if (s < 60) return `${fmtNum(s, 0)} s`;
  if (s < 3600) return `${fmtNum(s / 60, 0)} min`;
  return `${fmtNum(s / 3600, 1)} h`;
}

const CONSUMABLE_LABEL: Record<string, string> = {
  elixir: "Elixires",
  flask: "Frascos",
  food: "Comida y bebida",
  potion: "Pociones",
  scroll: "Pergaminos",
  other: "Otros consumibles",
};
const CONSUMABLE_ORDER = ["elixir", "flask", "food", "potion", "scroll", "other"];

/** Tarjeta flotante de un beneficio: icono, nombre, duración y el texto del cliente (el mismo estilo que la de las raciales). */
function BuffCard({ b }: { b: Buff }) {
  return (
    <div className="racial-tip">
      <div className="detail-head">
        <Icon id={b.iconFileDataId} name={buffName(b)} />
        <div>
          <h4>{buffName(b)}</h4>
          <p className="rank-line">{tr("Beneficio")} · {durationText(b.durationMs)}</p>
        </div>
      </div>
      <p className="desc-text">{trn(effectLabel({ spellId: b.id, text: b.text, name: b.name }))}</p>
    </div>
  );
}

/** Casilla de un beneficio: solo icono y nombre; al pasar el cursor o enfocarla con el teclado enseña su tarjeta. */
function BuffTile({ b, on, onToggle }: { b: Buff; on: boolean; onToggle: () => void }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return (
    <li onMouseEnter={(e) => setAnchor(anchorOf(e.currentTarget))} onMouseLeave={() => setAnchor(null)} onFocus={(e) => setAnchor(anchorOf(e.currentTarget))} onBlur={() => setAnchor(null)}>
      <button type="button" className={`buff-card${on ? " on" : ""}`} aria-pressed={on} onClick={onToggle}>
        <Icon id={b.iconFileDataId} name={buffName(b)} />
        <b>{buffName(b)}</b>
      </button>
      {anchor && (
        <FloatingCard anchor={anchor} placement="below">
          <BuffCard b={b} />
        </FloatingCard>
      )}
    </li>
  );
}

interface Section {
  id: string;
  title: string;
  buffs: Buff[];
}

/**
 * Paso «Beneficios» («buffs»): los que el personaje puede tener, propios o de otras clases, y consumibles, en una rejilla de
 * tarjetas que se marcan al pulsarlas. Cifras y texto del cliente; los de un mismo grupo no se acumulan (al marcar uno se quita
 * el otro). No viajan en el enlace de los talentos: van en `u`.
 */
export function BuffsStep({ manifest, index, loading, selected, onChange, onGo }: { manifest: Manifest; index: BuffIndex | null; loading: boolean; selected: ReadonlySet<number>; onChange: (next: Set<number>) => void; onGo: (v: View) => void }) {
  const [query, setQuery] = useState("");
  const [temporary, setTemporary] = useState(false);
  const classToken = useMemo(() => new Map(manifest.classes.map((c) => [c.classId, { token: /classes\/(.+)\.json/.exec(c.file)?.[1] ?? "", name: c.className ?? "" }])), [manifest]);
  const q = query.trim().toLowerCase();
  const sections = useMemo<Section[]>(() => {
    if (!index) return [];
    const shown = index.list.filter((b) => (temporary || isLastingBuff(b) || selected.has(b.id)) && (q === "" || buffName(b).toLowerCase().includes(q) || b.name.toLowerCase().includes(q)));
    const out: Section[] = [];
    for (const [classId, info] of classToken) {
      const list = shown.filter((b) => b.classId === classId && (b.category === "class" || b.category === "totem" || b.category === "pet"));
      if (list.length > 0) out.push({ id: `class-${classId}`, title: classLabel(info.token, info.name), buffs: list });
    }
    for (const c of CONSUMABLE_ORDER) {
      const list = shown.filter((b) => b.category === c);
      if (list.length > 0) out.push({ id: c, title: tr(CONSUMABLE_LABEL[c]!), buffs: list });
    }
    return out;
  }, [index, classToken, selected, temporary, q]);

  const toggle = (b: Buff, on: boolean) => index && onChange(toggleBuff(selected, b, on, index));
  const active = index ? [...selected].map((id) => index.byId.get(id)).filter((b): b is Buff => !!b) : [];

  return (
    <section className="buffs-step">
      <header className="step-head">
        <h2>{tr("Beneficios y consumibles")}</h2>
        <p>
          {tr("Marca los beneficios que tendrías: bendiciones, marcas, gritos, auras, aspectos, tótems de otras clases y las tuyas, elixires, frascos, comida… Cifras del cliente; los que no se acumulan (una sola bendición de cada tipo, un solo aspecto o armadura) se desmarcan solos. No incluye los perjuicios sobre el enemigo.")}
        </p>
      </header>
      {loading && !index && <p className="muted small">{tr("Cargando los beneficios…")}</p>}
      {index && (
        <>
          <div className="buffs-tools">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Buscar un beneficio…")} aria-label={tr("Buscar un beneficio…")} />
            <label className="check">
              <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} /> {tr("Mostrar efectos temporales (menos de 1 min: reutilización y pociones)")}
            </label>
            {active.length > 0 && (
              <button type="button" onClick={() => onChange(new Set())}>
                {tr("Quitar todos")} ({active.length})
              </button>
            )}
          </div>
          {active.length > 0 && (
            <ul className="buffs-active" aria-label={tr("Beneficios activos")}>
              {active.map((b) => (
                <li key={b.id}>
                  <button type="button" className="chip chip-link" onClick={() => toggle(b, false)} title={tr("Quitar")}>
                    {buffName(b)} ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sections.length === 0 && <p className="muted small">{tr("Ningún beneficio coincide.")}</p>}
          {sections.map((s) => {
            const n = s.buffs.filter((b) => selected.has(b.id)).length;
            return (
              <details key={s.id} className="card buffs-section" open>
                <summary>
                  <b>{s.title}</b> <span className="muted small">({n}/{s.buffs.length})</span>
                </summary>
                <ul className="buff-grid">
                  {s.buffs.map((b) => (
                    <BuffTile key={b.id} b={b} on={selected.has(b.id)} onToggle={() => toggle(b, !selected.has(b.id))} />
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}
      <StepNav view="buffs" onGo={onGo} />
    </section>
  );
}
