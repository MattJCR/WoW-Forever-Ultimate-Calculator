import { describeEffect, raceBonuses } from "@wfuc/engine";
import type { Race, RacialAbility } from "@wfuc/schema";
import { useState, type ElementType, type ReactNode } from "react";
import { fmtNum, isEnglish, racialEn, tr, trn } from "../i18n";
import { FloatingCard, originNote } from "./Detail";
import { Icon } from "./Icon";
import { anchorOf, type Anchor } from "./TreePanel";

const classBit = (classId: number): number => 1 << (classId - 1);

/** "15 s", "3 min": duraciones y enfriamientos de las raciales activas. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${fmtNum(s, 1)} s`;
  return `${fmtNum(s / 60, 1)} min`;
}

/**
 * Nombre y texto completo de una racial en el idioma elegido: el del hechizo de la clase (el resumen de la tabla del cliente solo se usa
 * si el hechizo no trae texto calculable). En inglés, el del juego; si falta, el español.
 */
function racialText(a: RacialAbility, raceId: number, classId: number): { name: string; description: string; english: boolean } {
  const spell = a.spells.find((s) => (s.classMask === 0 || (s.classMask & classBit(classId)) !== 0) && s.description);
  const en = isEnglish() ? racialEn(raceId, a.order) : null;
  if (en) return { name: en.name, description: (spell && en.spellTexts?.[spell.spellId]) || en.description, english: true };
  return { name: a.name, description: (a.textOrigin === "client" && spell?.description) || a.description, english: false };
}

/** Nombre de una racial en el idioma elegido. */
export function racialName(a: RacialAbility, raceId: number): string {
  return (isEnglish() ? racialEn(raceId, a.order)?.name : null) ?? a.name;
}

/** Enfriamiento de una racial activa para la etiqueta de la tarjeta («3 min», «10 s»); null si no tiene. */
export function racialCooldown(a: RacialAbility, classId: number): string | null {
  if (a.kind !== "active") return null;
  const ms = a.spells.find((s) => s.classMask === 0 || (s.classMask & classBit(classId)) !== 0)?.cooldownMs;
  return ms ? formatMs(ms) : null;
}

/** Cifras de una racial para esta clase (variante por clase ya elegida): efectos modelados, duracion y enfriamiento. */
function chipsOf(a: RacialAbility, classId: number): string[] {
  const spells = a.spells.filter((s) => s.classMask === 0 || (s.classMask & classBit(classId)) !== 0);
  const chips: string[] = [];
  for (const s of spells) for (const e of s.effects) {
    const text = describeEffect(e, s);
    if (text && !chips.includes(text)) chips.push(text);
  }
  if (a.kind === "active") {
    const s = spells[0];
    if (s?.durationMs) chips.push(tr("dura {t}", { t: formatMs(s.durationMs) }));
    if (s?.cooldownMs) chips.push(tr("enfriamiento {t}", { t: formatMs(s.cooldownMs) }));
  }
  return chips;
}

/** Descripcion del cliente mas sus cifras, en una linea (para «Copiar build para IA»). */
export function racialLine(a: RacialAbility, classId: number): string {
  const chips = chipsOf(a, classId);
  const base = chips.length > 0 ? `${a.description} [client figures: ${chips.join("; ")}]` : a.description;
  return a.pvpTrinket ? `${base} [PvP trinket shared cooldown: unconfirmed; the client does not link this racial to the trinket's cooldown category]` : base;
}

/** La referencia externa trae otras cifras (cambio futuro) o no lista la racial; null si coincide o la diferencia está revisada a mano. */
export function referenceStatus(a: RacialAbility): "differs" | "not-listed" | null {
  const r = a.reference;
  if (!r || r.status === "same" || r.reviewed) return null;
  return r.status;
}

/** Aviso corto de la insignia de PvP para la tarjeta (la explicación completa va en la lista de raciales). */
function trinketShort(a: RacialAbility): string | null {
  const t = a.pvpTrinket;
  return t ? tr("Quita {what}, como la insignia ({t}).", { what: t.overlaps.map((o) => trn(o)).join(` ${tr("y")} `), t: formatMs(t.trinketCooldownMs) }) : null;
}

/** Contenido de la tarjeta flotante de una racial: breve y ordenado (icono, nombre, texto, cifras y un aviso corto). */
function RacialCard({ a, classId, raceId }: { a: RacialAbility; classId: number; raceId: number }) {
  const chips = chipsOf(a, classId).map(trn);
  const translated = originNote(a.textOrigin);
  const txt = racialText(a, raceId, classId);
  return (
    <div className="racial-tip">
      <div className="detail-head">
        <Icon id={a.iconFileDataId} name={txt.name} />
        <div>
          <h4>{txt.name}</h4>
          <p className="rank-line">{tr("Habilidad racial")} · {a.kind === "active" ? tr("activa") : tr("pasiva")}</p>
        </div>
      </div>
      <p className="desc-text">{txt.description}</p>
      {chips.length > 0 && (
        <ul className="tip-facts">
          {chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {a.pvpTrinket && (
        <p className="tip-warn">
          <b>{tr("Comparte enfriamiento con la insignia de PvP: sin confirmar")}</b> {trinketShort(a)}
        </p>
      )}
      {referenceStatus(a) === "differs" && (
        <p className="tip-warn tip-ref">
          <b>{tr("La referencia externa indica otros valores (cambio futuro: el cliente aún no lo trae)")}</b> {tr("Las cifras de arriba son las del cliente.")}
          <span className="tip-ref-text">{a.reference?.text}</span>
          <small>{tr("Texto de la referencia, en inglés.")}</small>
        </p>
      )}
      {referenceStatus(a) === "not-listed" && (
        <p className="tip-warn tip-ref">
          <b>{tr("La referencia externa no la lista")}</b> {tr("Puede estar retirada o reemplazada; el cliente aún la trae y manda.")}
        </p>
      )}
      {translated && <p className="tip-warn tip-warn-soft">{tr("Traducción propia: el cliente aún trae este texto en inglés.")}</p>}
      {txt.english && <p className="tip-warn tip-warn-soft">{tr("Texto en inglés del juego.")}</p>}
    </div>
  );
}

/**
 * Envuelve cualquier elemento para que enseñe una tarjeta flotante al pasar el cursor o al enfocarlo con el teclado. La tarjeta va junto
 * al elemento, no dentro (un botón no puede contener una tarjeta); con `as="button"` el elemento recibe el foco con Tab.
 */
export function HoverTip({ card, as: Tag = "span", className, children }: { card: ReactNode; as?: ElementType; className?: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return (
    <>
      <Tag
        className={className}
        type={Tag === "button" ? "button" : undefined}
        onMouseEnter={(e: { currentTarget: Element }) => setAnchor(anchorOf(e.currentTarget))}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(e: { currentTarget: Element }) => setAnchor(anchorOf(e.currentTarget))}
        onBlur={() => setAnchor(null)}
      >
        {children}
      </Tag>
      {anchor && (
        <FloatingCard anchor={anchor} placement="below">
          {card}
        </FloatingCard>
      )}
    </>
  );
}

/** Envuelve cualquier icono o nombre de una racial para que enseñe su tarjeta al pasar el cursor o al enfocarlo con el teclado. */
export function RacialTip({ a, classId, raceId, as, className, children }: { a: RacialAbility; classId: number; raceId: number; as?: ElementType; className?: string; children: ReactNode }) {
  return (
    <HoverTip as={as} className={className} card={<RacialCard a={a} classId={classId} raceId={raceId} />}>
      {children}
    </HoverTip>
  );
}

export interface TotalRow {
  label: string;
  value: string;
  note?: string;
}

/** Bonificaciones pasivas de la raza para la clase, una fila por cifra (las activas no cuentan: solo duran un rato). */
export function raceTotalRows(race: Race, classId: number): TotalRow[] {
  const b = raceBonuses(race, classId);
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v} %`;
  const rows: TotalRow[] = [];
  if (b.critChancePct) rows.push({ label: tr("Probabilidad de crítico"), value: pct(b.critChancePct) });
  if (b.hitChancePct) rows.push({ label: tr("Probabilidad de impacto"), value: pct(b.hitChancePct) });
  if (b.spiritPct) rows.push({ label: tr("Espíritu"), value: pct(b.spiritPct), note: tr("se aplica sobre el espíritu base; mira «Con tus talentos, Puntos de Legado y raza»") });
  for (const [power, label] of [["mana", "Maná máximo"], ["rage", "Ira máxima"], ["energy", "Energía máxima"]] as const) {
    if (b.maxPowerPct[power]) rows.push({ label: tr(label), value: pct(b.maxPowerPct[power]) });
  }
  if (b.healthPct) rows.push({ label: tr("Salud máxima"), value: pct(b.healthPct) });
  if (b.critDamageBonusPct) rows.push({ label: tr("Bonus de daño crítico"), value: pct(b.critDamageBonusPct) });
  if (b.critHealingBonusPct) rows.push({ label: tr("Bonus de sanación crítica"), value: pct(b.critHealingBonusPct) });
  if (b.dodgePct) rows.push({ label: tr("Esquivar"), value: pct(b.dodgePct) });
  const { spell, melee, ranged } = b.hastePct;
  if (spell || melee || ranged) {
    rows.push({ label: tr("Celeridad"), value: tr("{a} hechizos · {b} cuerpo a cuerpo · {c} distancia", { a: pct(spell), b: pct(melee), c: pct(ranged) }) });
  }
  if (b.healthRegenPct) rows.push({ label: tr("Regeneración de salud"), value: pct(b.healthRegenPct), note: b.healthRegenInCombatPct ? tr("y {n} % de ella continúa en combate", { n: b.healthRegenInCombatPct }) : undefined });
  if (b.stunDurationPct) rows.push({ label: tr("Duración de aturdimientos"), value: pct(b.stunDurationPct) });
  for (const d of b.damageVsCreature) rows.push({ label: tr("Daño contra {what}", { what: tr(d.label) }), value: pct(d.pct) });
  return rows;
}

/** Suma de las bonificaciones pasivas de la raza para la clase, en tabla. */
export function RaceTotals({ race, classId }: { race: Race; classId: number }) {
  const rows = raceTotalRows(race, classId);
  if (rows.length === 0) return <p className="muted">{tr("Esta raza no da bonificaciones pasivas con cifras para esta clase.")}</p>;
  return (
    <>
      <table className="stats-table race-totals">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                {r.value}
                {r.note && <small> · {r.note}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        <span className="tag tag-unassigned">{tr("Cliente")}</span> {tr("Cifras de los hechizos de las raciales de la beta. Solo pasivas: las activas (Furia sangrienta, Rabiar…) duran un rato y se ven en cada racial.")}
      </p>
    </>
  );
}
