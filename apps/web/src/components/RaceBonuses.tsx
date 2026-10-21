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

/** Nombre y texto de una racial en el idioma elegido (el inglés es de la comunidad; si falta, el español del cliente). */
function racialText(a: RacialAbility, raceId: number): { name: string; description: string; english: boolean } {
  const en = isEnglish() ? racialEn(raceId, a.order) : null;
  return en ? { name: en.name, description: en.description, english: true } : { name: a.name, description: a.description, english: false };
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

/** Aviso de enfriamiento compartido con la insignia de PvP (solo raciales que quitan el mismo control; sin confirmar). */
function trinketNote(a: RacialAbility): string | null {
  const t = a.pvpTrinket;
  if (!t) return null;
  return tr("Quita {what}, igual que la insignia de PvP ({t}). Si comparte enfriamiento con ella, y cuántos segundos si es parcial, está sin confirmar: el cliente no lo indica; hay que medirlo en el juego.", { what: t.overlaps.map((o) => trn(o)).join(` ${tr("y")} `), t: formatMs(t.trinketCooldownMs) });
}

/** Descripcion del cliente mas sus cifras, en una linea (para «Copiar build para IA»). */
export function racialLine(a: RacialAbility, classId: number): string {
  const chips = chipsOf(a, classId);
  const base = chips.length > 0 ? `${a.description} [client figures: ${chips.join("; ")}]` : a.description;
  return a.pvpTrinket ? `${base} [PvP trinket shared cooldown: unconfirmed; the client does not link this racial to the trinket's cooldown category]` : base;
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
  const txt = racialText(a, raceId);
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
      {translated && <p className="tip-warn tip-warn-soft">{tr("Traducción propia: el cliente aún trae este texto en inglés.")}</p>}
      {txt.english && <p className="tip-warn tip-warn-soft">{tr("Texto en inglés de la comunidad.")}</p>}
    </div>
  );
}

/** Envuelve cualquier icono o nombre de una racial para que enseñe su tarjeta al pasar el cursor o al enfocarlo con el teclado. */
export function RacialTip({ a, classId, raceId, as: Tag = "span", className, children }: { a: RacialAbility; classId: number; raceId: number; as?: ElementType; className?: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return (
    <Tag className={className} onMouseEnter={(e: { currentTarget: Element }) => setAnchor(anchorOf(e.currentTarget))} onMouseLeave={() => setAnchor(null)} onFocus={(e: { currentTarget: Element }) => setAnchor(anchorOf(e.currentTarget))} onBlur={() => setAnchor(null)}>
      {children}
      {anchor && (
        <FloatingCard anchor={anchor} placement="below">
          <RacialCard a={a} classId={classId} raceId={raceId} />
        </FloatingCard>
      )}
    </Tag>
  );
}

/** Habilidades raciales: texto del cliente y, debajo, las cifras que salen de sus hechizos. */
export function RacialList({ race, classId }: { race: Race; classId: number }) {
  return (
    <ul className="effects racials">
      {race.racials.map((a) => {
        const chips = chipsOf(a, classId).map(trn);
        const txt = racialText(a, race.id);
        return (
          <li key={a.order}>
            <RacialTip a={a} classId={classId} raceId={race.id}>
              <Icon id={a.iconFileDataId} name={txt.name} />
            </RacialTip>
            <div>
              <RacialTip a={a} classId={classId} raceId={race.id}>
                <b>{txt.name}</b>
              </RacialTip>{" "}
              <span className="rank-chip">{a.kind === "active" ? tr("activa") : tr("pasiva")}</span>
              <p>{txt.description}</p>
              {originNote(a.textOrigin) && <p className="origin-note">{originNote(a.textOrigin)}</p>}
              {a.pvpTrinket && (
                <p className="origin-note trinket-note">
                  <span className="chip chip-info chip-unconfirmed">{tr("Insignia de PvP: enfriamiento compartido sin confirmar")}</span> {trinketNote(a)}
                </p>
              )}
              {chips.length > 0 && (
                <p className="racial-chips" aria-label={tr("Cifras del cliente")}>
                  {chips.map((c) => (
                    <span key={c} className="chip chip-info">
                      {c}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Suma de las bonificaciones pasivas de la raza para la clase (las activas no cuentan: solo duran un rato). */
export function RaceTotals({ race, classId }: { race: Race; classId: number }) {
  const b = raceBonuses(race, classId);
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v} %`;
  const rows: { label: string; value: string; note?: string }[] = [];
  if (b.critChancePct) rows.push({ label: tr("Probabilidad de crítico"), value: pct(b.critChancePct) });
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
