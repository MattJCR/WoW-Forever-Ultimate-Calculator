import { describeEffect, raceBonuses } from "@wfuc/engine";
import type { Race, RacialAbility } from "@wfuc/schema";
import { originNote } from "./Detail";
import { Icon } from "./Icon";

const classBit = (classId: number): number => 1 << (classId - 1);

/** "15 s", "3 min": duraciones y enfriamientos de las raciales activas. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
  const m = s / 60;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
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
    if (s?.durationMs) chips.push(`dura ${formatMs(s.durationMs)}`);
    if (s?.cooldownMs) chips.push(`enfriamiento ${formatMs(s.cooldownMs)}`);
  }
  return chips;
}

/** Descripcion del cliente mas sus cifras, en una linea (para «Copiar build para IA»). */
export function racialLine(a: RacialAbility, classId: number): string {
  const chips = chipsOf(a, classId);
  return chips.length > 0 ? `${a.description} [client figures: ${chips.join("; ")}]` : a.description;
}

/** Habilidades raciales: texto del cliente y, debajo, las cifras que salen de sus hechizos. */
export function RacialList({ race, classId }: { race: Race; classId: number }) {
  return (
    <ul className="effects racials">
      {race.racials.map((a) => {
        const chips = chipsOf(a, classId);
        return (
          <li key={a.order}>
            <Icon id={a.iconFileDataId} name={a.name} />
            <div>
              <b>{a.name}</b> <span className="rank-chip">{a.kind === "active" ? "activa" : "pasiva"}</span>
              <p>{a.description}</p>
              {originNote(a.textOrigin) && <p className="origin-note">{originNote(a.textOrigin)}</p>}
              {chips.length > 0 && (
                <p className="racial-chips" aria-label="Cifras del cliente">
                  {chips.map((c) => (
                    <span key={c} className="chip">
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
  if (b.critChancePct) rows.push({ label: "Probabilidad de crítico", value: pct(b.critChancePct) });
  if (b.spiritPct) rows.push({ label: "Espíritu", value: pct(b.spiritPct), note: "ya incluido en las estadísticas base de arriba" });
  for (const [power, label] of [["mana", "Maná máximo"], ["rage", "Ira máxima"], ["energy", "Energía máxima"]] as const) {
    if (b.maxPowerPct[power]) rows.push({ label, value: pct(b.maxPowerPct[power]) });
  }
  if (b.healthPct) rows.push({ label: "Salud máxima", value: pct(b.healthPct) });
  if (b.critDamageBonusPct) rows.push({ label: "Bonus de daño crítico", value: pct(b.critDamageBonusPct) });
  if (b.critHealingBonusPct) rows.push({ label: "Bonus de sanación crítica", value: pct(b.critHealingBonusPct) });
  if (b.dodgePct) rows.push({ label: "Esquivar", value: pct(b.dodgePct) });
  const { spell, melee, ranged } = b.hastePct;
  if (spell || melee || ranged) {
    rows.push({ label: "Celeridad", value: `${pct(spell)} hechizos · ${pct(melee)} cuerpo a cuerpo · ${pct(ranged)} distancia` });
  }
  if (b.healthRegenPct) rows.push({ label: "Regeneración de salud", value: pct(b.healthRegenPct), note: b.healthRegenInCombatPct ? `y ${b.healthRegenInCombatPct} % de ella continúa en combate` : undefined });
  if (b.stunDurationPct) rows.push({ label: "Duración de aturdimientos", value: pct(b.stunDurationPct) });
  for (const d of b.damageVsCreature) rows.push({ label: `Daño contra ${d.label}`, value: pct(d.pct) });

  if (rows.length === 0) return <p className="muted">Esta raza no da bonificaciones pasivas con cifras para esta clase.</p>;
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
        <span className="tag tag-unassigned">Cliente</span> Cifras de los hechizos de las raciales de la beta. Solo pasivas: las activas (Furia sangrienta, Rabiar…) duran un rato y se
        ven en cada racial.
      </p>
    </>
  );
}
