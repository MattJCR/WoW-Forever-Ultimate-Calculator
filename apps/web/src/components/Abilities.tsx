import {
  abilityChances,
  abilityOutcome,
  attackPowerVsKey,
  CREATURE_TYPES,
  spellDamageVsKey,
  baseAttackPower,
  classBaseOf,
  abilityEffectSummary,
  applyModifiers,
  canCrit,
  collectStatEffects,
  damageDonePct,
  dealsDamage,
  deriveCombatStats,
  describeEquipped,
  deriveStats,
  gearChanceBonus,
  hasteFor,
  gearSpellModifiers,
  healsTarget,
  knownSpellIds,
  meetsEquipped,
  offHandFactorOf,
  powerContext,
  powerEstimate,
  rankAtLevel,
  renderAbilityText,
  ruleAbilityDetail,
  ruleAppliesTo,
  ruleLines,
  spellModifiersOf,
  talentEffectValue,
  type AbilityEffectLine,
  type AbilityOutcome,
  type Build,
  type Chances,
  type EquippedState,
  type GearWeapon,
  type ClassIndex,
  type CombatStats,
  type GearChanceBonus,
  type GearEffectSource,
  type PowerContext,
  type TargetOption,
  type ModifiedAbility,
  type ModifiedEffect,
  type StatSource,
} from "@wfuc/engine";
import type { Ability, AbilityRank, ClassStatLevel, CombatFormulas, CombatRatings, Manifest, Race } from "@wfuc/schema";
import { Abilities as AbilitiesSchema, BaseStats as BaseStatsSchema, ClientStats as ClientStatsSchema, CombatFormulas as CombatFormulasSchema, TalentRules as TalentRulesSchema } from "@wfuc/schema";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getJson, useAsync } from "../data";
import { fitCardToViewport } from "./fit";
import { Icon } from "./Icon";

import { abilityName, classLabel, fmtNum, isEnglish, isOwnTranslation, nm, registerAbilities, spellEn, tr, trn } from "../i18n";
const fmt = (n: number, digits = 0): string => fmtNum(n, digits);
/** Nombre de la habilidad en el idioma elegido (el inglés es de la comunidad; sin él, el español del cliente). */
const abilityLabel = (a: Ability): string => abilityName(a.ranks.map((r) => r.spellId), a.name);
const seconds = (ms: number): string => `${fmt(ms / 1000, 1)} s`;
const sign = (v: number): string => `${v > 0 ? "+" : ""}${fmt(v, 1)}`;

/** Tipo de recurso del coste, en español. */
const POWER_LABEL: Record<string, string> = { mana: "maná", rage: "ira", energy: "energía", focus: "enfoque", other: "" };

const KIND_LABEL: Record<string, string> = {
  "direct-damage": "Daño",
  "direct-heal": "Curación",
  "periodic-damage": "Daño periódico",
  "periodic-heal": "Curación periódica",
};

/** "425–541" o "483" (si no hay variacion). */
const range = (min: number, max: number): string => (Math.round(min) === Math.round(max) ? fmt(min) : `${fmt(min)}–${fmt(max)}`);

/** El cliente guarda la ira x10 (150 = 15 de ira); el resto de recursos va tal cual. */
const costAmount = (m: ModifiedAbility): number => (m.costType === "rage" ? m.cost! / 10 : m.cost!);

const costText = (m: ModifiedAbility): string =>
  m.cost !== null ? `${fmt(costAmount(m), 1)} ${tr(POWER_LABEL[m.costType ?? "other"] ?? "")}`.trim() : m.costPctOfBase !== null ? tr("{n} % del maná base", { n: fmt(m.costPctOfBase, 1) }) : "—";
const castText = (m: ModifiedAbility): string => {
  if (!m.rank.channeled) return m.castMs === 0 ? tr("Instantáneo") : seconds(m.castMs);
  // Control mental: 3 s de lanzamiento y luego se canaliza
  const channel = `${tr("Canalizado")}${m.durationMs ? ` ${seconds(m.durationMs)}` : ""}`;
  return m.castMs > 0 ? `${seconds(m.castMs)} + ${channel.toLowerCase()}` : channel;
};
const radiusText = (m: ModifiedAbility): string => (m.radiusYd === null ? "—" : `${fmt(m.radiusYd, 1)} m`);
const cooldownText = (m: ModifiedAbility): string => (m.cooldownMs !== null ? seconds(m.cooldownMs) : "—");
const rangeText = (m: ModifiedAbility): string => (m.rangeYd === null ? "—" : m.rangeYd >= 1000 ? tr("Sin límite") : `${fmt(m.rangeYd)} m`);

/** Valor de una linea sumada con su unidad: +8 %, -0,5 s, +6 m... */
const lineValue = (l: AbilityEffectLine): string => {
  if (l.unit === "s") return `${sign(l.value)} s`;
  if (l.unit === "m") return `${sign(l.value)} m`;
  if (l.unit === "%" || l.unit === "puntos porcentuales") return `${sign(l.value)} %`;
  return sign(l.value);
};
const sourceName = (s: StatSource): string => (s.maxRank > 1 ? `${nm(s.name)} ${s.rank}/${s.maxRank}` : nm(s.name));

/** Efecto principal de la habilidad (daño, curación, periodico) con su cifra ya con talentos. */
function EffectLine({ m, durationMs, detailed }: { m: ModifiedEffect; durationMs: number | null; detailed: boolean }) {
  const e = m.effect;
  const periodic = e.periodMs !== null && e.kind !== "direct-heal" && (e.kind.startsWith("periodic") || e.viaSpellId !== null);
  const changed = Math.round(m.final.average) !== Math.round(m.base.average) || (m.coefficient ?? 0) !== (e.coefficient ?? 0);
  // Un efecto de otro hechizo (Lanzarse: aturde 3 s pero sangra 18 s) usa la duracion de ese hechizo
  const effectDuration = e.durationMs ?? durationMs;
  const ticks = periodic && effectDuration && e.periodMs ? Math.round(effectDuration / e.periodMs) : null;
  return (
    <div className={`ab-effect${changed ? " changed" : ""}`}>
      <span className="ab-kind">{tr(KIND_LABEL[e.kind] ?? e.kind)}</span> <b>{range(m.final.min, m.final.max)}</b>
      {periodic && e.periodMs ? (
        <span className="muted">
          {" "}
        {tr("cada")} {seconds(e.periodMs)}
          {ticks ? ` × ${ticks} = ${fmt(m.final.average * ticks)}` : ""}
        </span>
      ) : null}
      {detailed && m.coefficient !== null && <span className="muted"> · {fmt(m.coefficient * 100, 1)} % {tr("del poder con hechizos")}</span>}
      {detailed && changed && <small className="was">  ({tr("sin talentos")} {range(m.base.min, m.base.max)})</small>}
    </div>
  );
}

/** Datos de una fila: la habilidad al nivel elegido, con y sin talentos. */
interface RowData {
  ability: Ability;
  rank: AbilityRank;
  m: ModifiedAbility;
  base: ModifiedAbility;
  summaryLines: AbilityEffectLine[];
  inline: ReturnType<typeof abilityEffectSummary>["inline"];
  ruleTexts: string[];
  count: number;
  /** Crítico (%) contra el objetivo elegido: base de la clase (comunidad) + atributo (cliente) + talentos, raza y equipo − supresión contra jefes; null si no puede ser crítica o faltan datos. */
  crit: number | null;
  /** Resultado por lanzamiento (sin talentos, con talentos, con tu poder, esperado y por segundo); null si no hace daño ni sana. */
  outcome: AbilityOutcome | null;
  /** El rango exige un objeto equipado: null = sin requisito; met = lo llevas (o no has elegido equipo). */
  requirement: { text: string; met: boolean } | null;
}

/** Lo necesario para calcular impacto y critico en la tarjeta (formulas de Classic, estadisticas base y objetivo). */
interface ChancesInput {
  formulas: CombatFormulas;
  /** Critico por atributo del cliente para tu clase y nivel. */
  classStats: ClassStatLevel | null;
  stats: { agi: number; int: number } | null;
  target: TargetOption;
  level: number;
  classId: number;
  /** Impacto y critico de las puntuaciones del equipo (null = sin equipo). */
  gear: GearChanceBonus | null;
}

interface Tip {
  row: RowData;
  x: number;
  y: number;
  pinned: boolean;
}

/** Nombres de los talentos, ventajas de Legado y piezas de equipo que mejoran la habilidad (la raza se aplica a todas y no se lista). */
function improvedBy(d: RowData): string[] {
  const names: string[] = [];
  const add = (l: AbilityEffectLine) => {
    for (const s of l.sources) if (s.from !== "race" && !names.includes(nm(s.name))) names.push(nm(s.name));
  };
  d.summaryLines.forEach(add);
  Object.values(d.inline).forEach((v) => v?.forEach(add));
  return names;
}

const MODS_SHOWN = 4;

/** Qué da la habilidad: daño, curación o las dos cosas. */
const outcomeKind = (o: AbilityOutcome): string => (o.lines.every((l) => l.heal) ? tr("Curación") : o.lines.some((l) => l.heal) ? tr("Daño y curación") : tr("Daño"));
const pctText = (v: number): string => `${v > 0 ? "+" : ""}${fmt(v, 1)} %`;
const BASIS: Record<NonNullable<AbilityOutcome["perSecond"]>["basis"], string> = { cast: "por segundo de lanzamiento", channel: "por segundo de canalización", cooldown: "por segundo de reutilización" };

/** Resumen del resultado de la habilidad en su fila: total, incremento de talentos y poder, esperado y por segundo. */
function OutcomeStrip({ o }: { o: AbilityOutcome }) {
  return (
    <dl className="ab-outcome" title={tr("Por lanzamiento, con todo sumado. Pasa el cursor sobre la habilidad para ver el desglose.")}>
      <div>
        <dt>{outcomeKind(o)} {tr("por lanzamiento")}</dt>
        <dd>
          <b>{fmt(o.total)}</b>
        </dd>
      </div>
      {o.talentGain !== 0 && (
        <div className={o.talentGain > 0 ? "pos" : "neg"}>
          <dt>{tr("Incremento de talentos, Legado, raza y equipo")}</dt>
          <dd>
            <b>{o.talentGain > 0 ? "+" : ""}{fmt(o.talentGain)}</b> <span>({pctText(o.talentGainPct)})</span>
          </dd>
        </div>
      )}
      {o.powerGain > 0 && (
        <div className="est">
          <dt>{tr("Tu poder (estimación)")}</dt>
          <dd>
            <b>+{fmt(o.powerGain)}</b>
          </dd>
        </div>
      )}
      {o.expected !== null && (
        <div>
          <dt>{tr("Esperado con crítico y fallo")}</dt>
          <dd>
            <b>{fmt(o.expected)}</b>
          </dd>
        </div>
      )}
      {o.perSecond && (
        <div>
          <dt>{tr(BASIS[o.perSecond.basis])}</dt>
          <dd>
            <b>{fmt(o.perSecond.value, 1)}</b>
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Una cifra de la tarjeta de la habilidad; resaltada si los talentos la cambian. */
function Tile({ label, value, changed, tone }: { label: string; value: string; changed?: boolean; tone?: "pos" | "muted" }) {
  return (
    <div className={`ab-tile${changed ? " changed" : ""}${tone ? ` ${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Row({ d, selected, onHover, onToggle }: { d: RowData; selected: boolean; onHover: (e: { x: number; y: number } | null) => void; onToggle: (e: { x: number; y: number }) => void }) {
  const { m, ability, base } = d;
  const mods = improvedBy(d);
  const name = abilityLabel(ability);
  // Con teclado: Intro o Espacio fijan la tarjeta junto a la habilidad
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    onToggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  return (
    <li>
      <article
        className={`ab-item${selected ? " sel" : ""}`}
        tabIndex={0}
        aria-label={tr("{name}, rango {rank}. Intro para ver la tarjeta completa", { name, rank: m.rank.rank })}
        onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => onToggle({ x: e.clientX, y: e.clientY })}
        onKeyDown={onKey}
      >
        <div className="ab-top">
          <div className="ab-name">
            <Icon id={ability.iconFileDataId} name={name} />
            <div>
              <h4>{name}</h4>
              <p className="ab-sub">
                <span className="rank-chip">{tr("rango")} {m.rank.rank}</span>
                {ability.talentsForever && ability.talentsForever.status !== "listed" && (
                  <span className={`tf-chip tf-${ability.talentsForever.status}`} title={ability.talentsForever.note ? trn(ability.talentsForever.note) : undefined}>
                    {ability.talentsForever.status === "retired" ? tr("retirada según la referencia") : tr("sin referencia")}
                  </span>
                )}
                {d.requirement && (
                  <span className={`req-chip${d.requirement.met ? "" : " unmet"}`} title={d.requirement.met ? undefined : tr("Con tu equipo no puedes lanzarla")}>
                    {tr("Requiere")} {trn(d.requirement.text)}
                  </span>
                )}
              </p>
            </div>
          </div>
          <dl className="ab-tiles">
            <Tile label={tr("Coste")} value={costText(m)} changed={costText(m) !== costText(base)} />
            <Tile label={tr("Lanzamiento")} value={castText(m)} changed={castText(m) !== castText(base)} />
            <Tile label={tr("Reutilización")} value={cooldownText(m)} changed={cooldownText(m) !== cooldownText(base)} />
            <Tile label={tr("Alcance")} value={rangeText(m)} changed={rangeText(m) !== rangeText(base)} />
            <Tile label={tr("Crítico")} value={d.crit !== null ? `${fmt(d.crit, 1)} %` : "—"} tone={d.crit !== null ? "pos" : "muted"} />
          </dl>
        </div>
        {m.effects.length > 0 && (
          <div className="ab-effects">
            {m.effects.map((e) => (
              <EffectLine key={`${e.effect.viaSpellId ?? 0}-${e.effect.index}`} m={e} durationMs={m.durationMs} detailed={false} />
            ))}
          </div>
        )}
        {d.outcome && <OutcomeStrip o={d.outcome} />}
        {d.count > 0 && (
          <div className="ab-mods" title={tr("Efectos de tus talentos que afectan a esta habilidad: pasa el cursor para verlos")}>
            <span>{tr("Mejorada por")}</span>
            {mods.slice(0, MODS_SHOWN).map((n) => (
              <span key={n} className="chip">
                {n}
              </span>
            ))}
            {mods.length > MODS_SHOWN && <span className="chip">+{mods.length - MODS_SHOWN} {tr("más")}</span>}
            {mods.length === 0 && <span className="chip">{d.count} {tr("efectos de talentos")}</span>}
          </div>
        )}
      </article>
    </li>
  );
}

/** Una cifra de la rejilla de la tarjeta: la de tus talentos, y la base tachada si cambia. */
function Stat({ label, now, was }: { label: string; now: string; was: string }) {
  const changed = now !== was;
  return (
    <div>
      <dt>{label}</dt>
      <dd className={changed ? "changed" : undefined}>
        {now}
        {changed && <s>{was}</s>}
      </dd>
    </div>
  );
}

/**
 * Tarjeta completa de una habilidad: cifras, texto del cliente con los numeros recalculados, efectos, y todo lo que tus
 * talentos, Legacy y raza le suman (ya sumado). Con Ctrl pulsado muestra la base sin mejoras.
 */
function AbilityCard({ tip, base: showBase, onClose, chancesInput, power, textKnown }: { tip: Tip; base: boolean; onClose: () => void; chancesInput: ChancesInput | null; /** Talentos escogidos para las condicionales del texto («si tienes el talento X»). */ textKnown: { known: ReadonlySet<number>; talentValue: (spellId: number, effectIndex: number) => number | null } | null; power: { ctx: PowerContext; attributesKnown: boolean; hasGear: boolean; haste: CombatStats["haste"] } | null }) {
  const { row } = tip;
  const { ability, rank } = row;
  const abName = abilityLabel(ability);
  // English elegido: el texto fijo de nivel 60 de la comunidad (sin talentos, no se recalcula); si falta, el español del cliente con sus cifras
  const enText = isEnglish() ? spellEn(rank.spellId) : null;
  // Con Ctrl: la misma habilidad sin ningun talento
  const m = showBase ? row.base : row.m;
  // Con la plantilla inglesa las cifras se recalculan igual que en español; sin ella, el texto fijo de nivel 60
  const parts = renderAbilityText(rank, m, { ...(enText?.template ? { template: enText.template, locale: "en" as const } : {}), known: showBase ? undefined : textKnown?.known, talentValue: textKnown?.talentValue });
  const outcome = showBase ? null : row.outcome;
  const ownEnglish = !!enText && isOwnTranslation("spell", rank.spellId);
  const lines = showBase ? [] : row.summaryLines;
  const rules = showBase ? [] : row.ruleTexts;
  const chances = chancesInput ? abilityChances({ rank, classId: chancesInput.classId, level: chancesInput.level, target: chancesInput.target, formulas: chancesInput.formulas, stats: chancesInput.stats, classStats: chancesInput.classStats, lines, gear: chancesInput.gear }) : null;
  const est = power ? powerEstimate(m, power.ctx) : null;
  // Celeridad (puntuación del equipo, talentos, Legacy y raza): reduce el tiempo de lanzamiento. Estimación: tiempo ÷ (1 + celeridad)
  const haste = power && !showBase ? hasteFor(power.haste, rank) : 0;
  const hasteCast = haste > 0 && m.castMs > 0 && !m.rank.channeled ? m.castMs / (1 + haste / 100) : null;
  const hasPower = !!est && (est.spell.length > 0 || est.weapon !== null);
  const noted = showBase ? [] : (Object.entries(row.inline) as [string, AbilityEffectLine[]][]).filter(([, v]) => v.length > 0);
  // La tarjeta se coloca junto al cursor y se ajusta a su altura real para no salirse de la pantalla
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });
  const place = () => {
    const el = ref.current;
    if (!el) return;
    fitCardToViewport(el); // sin scroll: la letra se reduce lo justo para que quepa entera
    const { width: w, height: h } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // A la derecha del cursor si cabe; si no, a su izquierda; y siempre dentro de la pantalla
    const right = tip.x + 18;
    const left = Math.max(8, Math.min(right + w > vw - 8 ? tip.x - w - 18 : right, vw - w - 8));
    const top = Math.max(8, Math.min(tip.y + 18, vh - h - 8));
    setPos((p) => (Math.abs(p.left - left) < 1 && Math.abs(p.top - top) < 1 ? p : { left: Math.round(left), top: Math.round(top) }));
  };
  // Se recoloca cuando cambia el cursor, la habilidad o Ctrl, y al cambiar el tamaño de la ventana o de la propia tarjeta
  useLayoutEffect(place, [tip.x, tip.y, tip.row.ability.name, showBase, tip.pinned]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    window.addEventListener("resize", place);
    const ro = typeof ResizeObserver === "undefined" || !el ? null : new ResizeObserver(place);
    if (el) ro?.observe(el);
    return () => {
      window.removeEventListener("resize", place);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip.x, tip.y]);
  const style: CSSProperties = { left: pos.left, top: pos.top };
  return (
    <div ref={ref} className={`ab-card${showBase ? " is-base" : ""}${tip.pinned ? " pinned" : ""}`} style={style} role="tooltip">
      {tip.pinned && (
        <button type="button" className="ab-card-close" onClick={onClose} aria-label={tr("Cerrar")}>
          ×
        </button>
      )}
      <div className="ab-tip-head">
        <Icon id={ability.iconFileDataId} name={abName} />
        <div>
          <h4>{abName}</h4>
          <p className="rank-line">
          {tr("Rango")} {rank.rank} · {rank.learnedByTalent ? tr("lo enseña un talento") : tr("se aprende")} {tr("al nivel")} {rank.level}
          </p>
          {ability.talentsForever && ability.talentsForever.status !== "listed" && (
            <p className={`tf-note tf-${ability.talentsForever.status}`}>{trn(ability.talentsForever.note ?? "")}</p>
          )}
        </div>
      </div>
      {showBase && <p className="ab-base-banner">{tr("Base sin talentos. Suelta Ctrl para ver tus mejoras.")}</p>}

      <div className={`ab-cols${chances || lines.length > 0 || rules.length > 0 || hasPower || outcome ? "" : " single"}`}>
      <div className="ab-col">
      <dl className="ab-grid">
        <Stat label={tr("Coste")} now={costText(m)} was={costText(row.base)} />
        <Stat label={tr("Alcance")} now={rangeText(m)} was={rangeText(row.base)} />
        {m.radiusYd !== null && <Stat label={tr("Radio")} now={radiusText(m)} was={radiusText(row.base)} />}
        <Stat label={tr("Lanzamiento")} now={castText(m)} was={castText(row.base)} />
        {hasteCast !== null && <Stat label={tr("Con {n} % de celeridad", { n: fmt(haste, 2) })} now={seconds(hasteCast)} was={castText(m)} />}
        <Stat label={tr("Reutilización")} now={cooldownText(m)} was={cooldownText(row.base)} />
      </dl>
      {noted.length > 0 && (
        <ul className="ab-notes">
          {noted.flatMap(([, v]) =>
            v.map((l) => (
              <li key={`${l.category}-${l.label}`}>
                <b>{lineValue(l)}</b> {trn(l.label)} <span className="muted">({l.sources.map(sourceName).join(", ")})</span>
              </li>
            )),
          )}
        </ul>
      )}

      {enText?.description && !enText.template ? (
        <>
          <p className="ab-text">{enText.description}</p>
          <p className="muted small">{tr("Texto en inglés a nivel 60, sin talentos ni equipo: no se recalcula. Las cifras de la tarjeta sí.")}</p>
          {ownEnglish && <p className="muted small">{tr("Traducción propia al inglés: el texto oficial trae otras cifras que el cliente. Las cifras son las del cliente.")}</p>}
        </>
      ) : (
        <>
          <p className="ab-text">
            {parts.map((p, i) => (p.changed ? (
              <b key={i} className="changed">
                {p.text}
              </b>
            ) : (
              <span key={i}>{p.text}</span>
            )))}
          </p>
          {isEnglish() && !enText?.template && <p className="muted small">{tr("Aún sin texto en inglés: se muestra el español del cliente.")}</p>}
        </>
      )}

      {m.effects.length > 0 && (
        <section>
          <h5>{tr("Efectos")}</h5>
          {m.effects.map((e) => (
            <EffectLine key={`${e.effect.viaSpellId ?? 0}-${e.effect.index}`} m={e} durationMs={m.durationMs} detailed />
          ))}
        </section>
      )}

      </div>
      <div className="ab-col">
      {outcome && (
        <section>
          <h5>
            {tr("Total calculado")} <span className="tag tag-inactive" title={tr("Las cifras de cada efecto y los talentos son del cliente; el poder con hechizos y de ataque, el crítico y el fallo siguen reglas de Classic sin confirmar en Forever. El crítico solo cuenta en el daño y la sanación directos.")}>{tr("estimación")}</span>
          </h5>
          <table className="ab-outcome-table">
            <thead>
              <tr>
                <th scope="col">{outcomeKind(outcome)} {tr("por lanzamiento")}</th>
                <th scope="col">{tr("Base")}</th>
                <th scope="col">{tr("Con tus mejoras")}</th>
                <th scope="col">{tr("Con tu poder")}</th>
              </tr>
            </thead>
            <tbody>
              {outcome.lines.map((l) => (
                <tr key={l.label}>
                  <th scope="row">{trn(l.label)}</th>
                  <td>{fmt(l.base)}</td>
                  <td className={Math.round(l.talents) !== Math.round(l.base) ? "pos" : undefined}>{fmt(l.talents)}</td>
                  <td>
                    <b>{fmt(l.total)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
            {outcome.lines.length > 1 && (
              <tfoot>
                <tr>
                  <th scope="row">{tr("Total")}</th>
                  <td>{fmt(outcome.base)}</td>
                  <td>{fmt(outcome.talents)}</td>
                  <td>
                    <b>{fmt(outcome.total)}</b>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          <ul className="ab-sum">
            {outcome.talentGain !== 0 && (
              <li>
                <span className="ab-sum-l">{tr("Incremento de talentos, Legado, raza y equipo")}</span>
                <b className={outcome.talentGain > 0 ? "pos" : "neg"}>{outcome.talentGain > 0 ? "+" : ""}{fmt(outcome.talentGain)} ({pctText(outcome.talentGainPct)})</b>
              </li>
            )}
            {outcome.powerGain > 0 && (
              <li>
                <span className="ab-sum-l">{tr("Lo que suma tu poder")}</span>
                <b className="pos">+{fmt(outcome.powerGain)}</b>
              </li>
            )}
            {outcome.sources.slice(0, 6).map((src) => (
              <li key={src.name} className="ab-source">
                <span className="ab-sum-l">{nm(src.name)}</span>
                <b className={src.gain > 0 ? "pos" : "neg"}>{src.gain > 0 ? "+" : ""}{fmt(src.gain)} ({pctText(src.gainPct)})</b>
              </li>
            ))}
            {outcome.expected !== null && (
              <li>
                <span className="ab-sum-l">{tr("Esperado con crítico y fallo")}</span>
                <b>{fmt(outcome.expected)}</b>
                <span className="ab-sum-s">
                  {outcome.hitPct !== null && !outcome.lines.every((l) => l.heal) ? tr("{n} % de impacto", { n: fmt(outcome.hitPct, 1) }) : ""}
                  {outcome.critChancePct !== null && outcome.critMultiplier !== null ? `${outcome.hitPct !== null && !outcome.lines.every((l) => l.heal) ? " · " : ""}${tr("{n} % de crítico × {m}", { n: fmt(outcome.critChancePct, 1), m: fmt(outcome.critMultiplier, 2) })}` : ""}
                </span>
              </li>
            )}
            {outcome.perSecond && (
              <li>
                <span className="ab-sum-l">{tr(BASIS[outcome.perSecond.basis])}</span>
                <b>{fmt(outcome.perSecond.value, 1)}</b>
                <span className="ab-sum-s">{tr("en {n} s", { n: fmt(outcome.perSecond.seconds, 2) })}</span>
              </li>
            )}
          </ul>
          <p className="muted small">{tr("La aportación de cada fuente es lo que cambia el total al quitarla; no suman exactamente porque los porcentajes se multiplican.")}</p>
        </section>
      )}
      {chances && (
        <section>
          <h5>
          {tr("Probabilidades")} <span className="tag tag-inactive" title={tr("La tabla de fallo, el crítico base de la clase y la supresión de crítico son de la comunidad (el cliente de Forever no trae las tablas de impacto); el crítico por atributo sí es del cliente (PlayerExpectedStat)")}>{tr("impacto y crítico base: comunidad · crítico por atributo: cliente")}</span>
          </h5>
          <ul className="ab-chances">
            {!(healsTarget(rank) && !dealsDamage(rank)) && (
            <li>
              <span className="ab-sum-l">{tr("Impacto contra")} {chancesInput!.target === "boss" ? tr("un jefe (+3 niveles)") : tr("un objetivo de tu nivel")}</span>
              <b className="pos">{fmt(chances.hit.total, 1)} %</b>
              <span className="ab-sum-s">
                {fmt(100 - chances.hit.missPct, 1)} % {tr("de la tabla")} ({fmt(chances.hit.missPct, 1)} % {tr("de fallo")})
                {chances.hit.bonusPct !== 0 ? ` ${tr("{n} % de talentos y raza", { n: sign(chances.hit.bonusPct) })}` : ""}
                {chances.hit.gearPct !== 0 ? ` ${tr("+{n} % de tu equipo", { n: fmt(chances.hit.gearPct, 2) })}` : ""}
                {chances.hit.capped ? ` · ${tr("tope {n} %", { n: chances.hit.cap })}` : ""}
              </span>
            </li>
            )}
            <li>
              <span className="ab-sum-l">{tr("Crítico")}{chances.crit.total !== null ? ` ${tr("(lo que enseña tu hoja)")}` : tr(": lo que suman tus estadísticas, talentos y raza")}</span>
              {chances.crit.total !== null ? <b className="pos">{sign(chances.crit.total)} %</b> : chances.crit.bonusPct !== 0 ? <b className="pos">{sign(chances.crit.bonusPct)} %</b> : <b className="muted">—</b>}
              <span className="ab-sum-s">
                {chances.crit.baseClassPct !== 0 ? `${tr("{n} % base de tu clase", { n: fmt(chances.crit.baseClassPct, 1) })} · ` : ""}
                {chances.crit.fromStat !== null && chances.crit.stat
                  ? tr("{pct} % por tu {stat} ({v} ÷ {per})", { pct: sign(chances.crit.fromStat), stat: chances.crit.stat === "int" ? tr("intelecto") : tr("agilidad"), v: fmt(chances.crit.statValue ?? 0), per: fmt(chances.crit.statPerPercent ?? 0, 1) })
                  : trn(chances.crit.unavailable ?? "")}
                {chances.crit.bonusPct !== 0 ? ` · ${tr("{n} % de talentos y raza", { n: sign(chances.crit.bonusPct) })}` : ""}
                {chances.crit.gearPct !== 0 ? ` · ${tr("+{n} % de la puntuación de tu equipo", { n: fmt(chances.crit.gearPct, 2) })}` : ""}
              </span>
            </li>
            {chances.crit.suppressionPct > 0 && chances.crit.vsTargetPct !== null && (
              <li>
                <span className="ab-sum-l">{tr("Crítico contra un jefe (+3 niveles)")}</span>
                <b className="pos">{sign(chances.crit.vsTargetPct)} %</b>
                <span className="ab-sum-s">−{fmt(chances.crit.suppressionPct, 1)} % {tr("de supresión (3 % por la diferencia de habilidad de arma y el crítico de auras hasta 1,8 %; los hechizos no la tienen")})</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {est && hasPower && power && (
        <section>
          <h5>
          {tr("Con tu poder")} <span className="tag tag-inactive" title={tr("El coeficiente de poder con hechizos de cada efecto sale del cliente, pero no se sabe si Forever lo aplica como Classic. El golpe de arma usa la fórmula de Classic (arma + poder de ataque ÷ 14 × velocidad). No hay coeficientes de poder de ataque en el cliente.")}>{tr("estimación Classic")}</span>
          </h5>
          <ul className="ab-sum">
            {est.spell.map((b) => {
              const me = m.effects.find((x) => x.effect.index === b.effectIndex && x.effect.viaSpellId === null) ?? m.effects.find((x) => x.effect.index === b.effectIndex)!;
              return (
                <li key={`${b.effectIndex}-${b.periodic}`}>
                  <span className="ab-sum-l">{tr(KIND_LABEL[me.effect.kind] ?? me.effect.kind)}</span>
                  <b className="pos">{range(b.final.min, b.final.max)}</b>
                  <span className="ab-sum-s">
                    {b.periodic ? `${tr("por tick")} ` : ""}= {range(me.final.min, me.final.max)} + {fmt(b.power)} {tr("de poder con hechizos")} × {fmt(b.coefficient * 100, 1)} % = +{fmt(b.perHit, 1)}
                    {b.periodic ? ` · ${tr("× {n} ticks = {total} en total", { n: b.ticks, total: fmt(b.final.average * b.ticks) })}` : ""}
                  </span>
                </li>
              );
            })}
            {est.weapon && (
              <li>
                <span className="ab-sum-l">{tr("Golpe de arma")}{est.weapon.ranged ? ` ${tr("(a distancia)")}` : ""}</span>
                <b className="pos">{range(est.weapon.min, est.weapon.max)}</b>
                <span className="ab-sum-s">{trn(est.weapon.formula)}</span>
              </li>
            )}
          </ul>
          {!power.attributesKnown && <p className="muted small">{tr("Elige una raza para sumar el poder que dan tus atributos.")}</p>}
          {!power.hasGear && <p className="muted small">{tr("Sin equipo: solo cuenta el poder de tus atributos y talentos.")}</p>}
        </section>
      )}

      {lines.length > 0 && (
        <section>
          <h5>{tr("Con tus talentos, Puntos de Legado y raza")}</h5>
          <ul className="ab-sum">
            {lines.map((l) => (
              <li key={`${l.category}-${l.label}`}>
                <span className="ab-sum-l">{(() => { const t = trn(l.label); return t.charAt(0).toUpperCase() + t.slice(1); })()}</span>
                <b className={l.value < 0 && l.category !== "Retroceso al lanzar" ? "neg" : "pos"}>{lineValue(l)}</b>
                <span className="ab-sum-s">{l.sources.map(sourceName).join(" + ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rules.length > 0 && (
        <section>
          <h5>{tr("Al golpear y otros efectos")}</h5>
          <ul className="ab-rules">
            {rules.map((t, i) => (
              <li key={i}>{trn(t)}</li>
            ))}
          </ul>
        </section>
      )}

      </div>
      </div>

      <p className="muted small ab-foot">
        {(enText?.template ?? rank.descriptionTemplate).includes("$") && !(enText?.description && !enText.template) ? `${tr("Alguna cifra depende de tu personaje y no se calcula.")} ` : ""}
      {tr("Las cifras de arriba no incluyen el poder con hechizos ni el de ataque (ver «Con tu poder», estimación")}). {!showBase && row.count > 0 ? `${tr("Mantén Ctrl para ver la base.")} ` : ""}
        {tip.pinned ? tr("Clic en la habilidad para cerrar.") : tr("Clic en la habilidad para fijar la tarjeta.")}
      </p>
    </div>
  );
}

/**
 * Habilidades de la clase al nivel elegido. La tabla enseña lo esencial; la tarjeta de cada habilidad (cursor encima, o
 * clic para fijarla) trae todo: texto del cliente con cifras recalculadas, efectos y la suma de lo que le aportan tus
 * talentos, Legacy y raza (crítico, impacto, daño crítico, procs...). Todo sale del cliente.
 */
export function AbilitiesTable({
  manifest,
  idx,
  build,
  legacy,
  legacyBuild,
  race,
  statsRaceId,
  level,
  gear,
  active,
}: {
  manifest: Manifest;
  idx: ClassIndex;
  build: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  race: Race | null;
  /** Raza de la que salen los atributos base: la elegida o, si no hay, una de referencia (sin sus raciales, que van en `race`). */
  statsRaceId: number | null;
  /** Nivel del personaje (lo elige el Resumen). */
  level: number;
  /** Equipo del paso «Equipo» ya filtrado por nivel (cada objeto cuenta desde su propio nivel); null si no llevas. */
  gear?: { stats: Record<string, number>; ratings: CombatRatings | null; effects: GearEffectSource[]; weapons: GearWeapon[]; equipped: EquippedState } | null;
  /** Talentos de habilidad activa que se dan por activos (nodeId). */
  active?: ReadonlySet<number> | null;
}) {
  const entry = manifest.abilities.find((a) => a.classId === idx.data.classId);
  const state = useAsync(entry?.file ?? "none", () => (entry ? getJson(entry.file, (v) => AbilitiesSchema.parse(v)) : Promise.reject(new Error(tr("sin habilidades")))));
  const ruleEntry = manifest.rules.find((a) => a.classId === idx.data.classId);
  const rulesState = useAsync(ruleEntry?.file ?? "none", () => (ruleEntry ? getJson(ruleEntry.file, (v) => TalentRulesSchema.parse(v)) : Promise.resolve(null)));
  const formulasEntry = manifest.combatFormulas;
  const formulasState = useAsync(formulasEntry?.file ?? "none", () => (formulasEntry ? getJson(formulasEntry.file, (v) => CombatFormulasSchema.parse(v)) : Promise.resolve(null)));
  const clientStatsEntry = manifest.clientStats;
  const clientStatsState = useAsync(clientStatsEntry?.file ?? "none", () => (clientStatsEntry ? getJson(clientStatsEntry.file, (v) => ClientStatsSchema.parse(v)) : Promise.resolve(null)));
  const statsState = useAsync(manifest.stats.file, () => getJson(manifest.stats.file, (v) => BaseStatsSchema.parse(v)));
  const [target, setTarget] = useState<TargetOption>("same");
  // Tipo de criatura del objetivo: activa los bonos «+N de poder de ataque / daño con hechizos contra …» del equipo
  const [creatureType, setCreatureType] = useState<string | null>(null);
  const [onlyAffected, setOnlyAffected] = useState(true);
  const [onlyActive, setOnlyActive] = useState(true);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [pin, setPin] = useState<{ name: string; x: number; y: number } | null>(null);
  const [ctrl, setCtrl] = useState(false);

  // Ctrl pulsado = ver la base sin mejoras (mientras la tarjeta esta abierta)
  useEffect(() => {
    const key = (e: KeyboardEvent) => setCtrl(e.ctrlKey);
    const off = () => setCtrl(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", off);
    };
  }, []);
  // La tarjeta fijada se cierra con Escape o al desplazarse
  useEffect(() => {
    if (!pin) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPin(null);
    const close = () => setPin(null);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close);
    };
  }, [pin]);

  const rules = rulesState.status === "ready" ? rulesState.value : null;
  const formulas = formulasState.status === "ready" ? formulasState.value : null;
  const classStats = useMemo(
    () => (clientStatsState.status === "ready" && clientStatsState.value ? clientStatsState.value.classes.find((c) => c.classId === idx.data.classId)?.levels.find((l) => l.level === level) ?? null : null),
    [clientStatsState, idx.data.classId, level],
  );
  const abilities = state.status === "ready" ? state.value : null;
  if (abilities) registerAbilities(abilities);
  // El equipo llega ya filtrado por nivel: cada objeto cuenta desde su propio nivel necesario
  const gearHere = gear ?? null;
  const gearEffects = gearHere?.effects;
  const equipped = gearHere?.equipped ?? null;
  const mods = useMemo(() => [...spellModifiersOf(idx, build, equipped, active ?? null), ...(legacy ? spellModifiersOf(legacy, legacyBuild, equipped) : []), ...(gearEffects ? gearSpellModifiers(gearEffects) : [])], [idx, build, legacy, legacyBuild, gearEffects, equipped, active]);
  const ruled = useMemo(() => ruleLines(rules, idx, build), [rules, idx, build]);
  const fx = useMemo(() => collectStatEffects({ cls: idx, classBuild: build, legacy, legacyBuild, race, abilities, rules, gearEffects, equipped, active }), [idx, build, legacy, legacyBuild, race, abilities, rules, gearEffects, equipped, active]);
  // Condicionales del texto («si tienes el talento X»): con los talentos y ventajas escogidos y las habilidades ya aprendidas a este nivel
  const textKnown = useMemo(() => {
    const input = { cls: idx, classBuild: build, legacy, legacyBuild };
    return { known: knownSpellIds({ ...input, abilities, level }), talentValue: (spellId: number, effectIndex: number) => talentEffectValue(input, spellId, effectIndex) };
  }, [idx, build, legacy, legacyBuild, abilities, level]);
  // Atributos de tu raza y clase a este nivel (Classic, estimacion) con el equipo y los % de talentos, Legacy y raza ya aplicados; sin raza no hay.
  const baseStats = useMemo(() => {
    if (statsRaceId === null || statsState.status !== "ready") return null;
    const row = statsState.value.combos.find((c) => c.raceId === statsRaceId && c.classId === idx.data.classId)?.stats[level - 1];
    if (!row) return null;
    const final = deriveStats({ attributes: row as [number, number, number, number, number], hpBase: 0, manaBase: 0, totals: fx.totals, gear: gearHere?.stats ?? null }).rows;
    const at = (k: string): number => final.find((r) => r.key === k)?.final ?? 0;
    return { agi: at("agi"), int: at("int") };
  }, [statsRaceId, statsState, idx.data.classId, level, fx, gearHere]);
  // Poder con hechizos y de ataque finales (atributos de la raza si hay, equipo, talentos), para la estimacion de daño de la tarjeta
  const power = useMemo(() => {
    if (clientStatsState.status !== "ready") return null;
    const clientClass = clientStatsState.value?.classes.find((c) => c.classId === idx.data.classId) ?? null;
    const row = statsRaceId !== null && statsState.status === "ready" ? statsState.value.combos.find((c) => c.raceId === statsRaceId && c.classId === idx.data.classId)?.stats[level - 1] : undefined;
    const apBase = baseAttackPower(formulas ? classBaseOf(formulas, idx.data.classId) : null, level);
    const derived = deriveStats({
      attributes: (row ?? [0, 0, 0, 0, 0]) as [number, number, number, number, number],
      hpBase: 0,
      manaBase: 0,
      totals: fx.totals,
      gear: gearHere?.stats ?? null,
      attackPower: clientClass ? { perStrength: clientClass.attackPowerPerStrength, perAgility: clientClass.attackPowerPerAgility, rangedPerAgility: clientClass.rangedAttackPowerPerAgility, baseMelee: apBase.melee, baseRanged: apBase.ranged } : null,
    });
    // La celeridad se suma como el resto de estadisticas de combate (puntuacion del equipo + talentos, Legacy y raza)
    const combat = deriveCombatStats({ derived, totals: fx.totals, gear: gearHere ? { stats: gearHere.stats, armor: 0, ratings: gearHere.ratings } : null, classStats });
    return { ctx: powerContext(derived, gearHere?.stats ?? null, gearHere?.weapons ?? [], { offHandFactor: offHandFactorOf(formulas?.offHandDamageFactor ?? 0.5, fx.totals), creatureType }), attributesKnown: !!row, hasGear: !!gearHere, haste: combat.haste };
  }, [clientStatsState, statsState, statsRaceId, idx.data.classId, level, fx, gearHere, classStats, formulas, creatureType]);
  // Tipos de criatura para los que el equipo da algún bono
  const vsTypes = useMemo(() => CREATURE_TYPES.filter((c) => (gearHere?.stats[attackPowerVsKey(c.key)] ?? 0) !== 0 || (gearHere?.stats[spellDamageVsKey(c.key)] ?? 0) !== 0), [gearHere]);
  const gearBonus = useMemo(() => (gearHere?.ratings ? gearChanceBonus(gearHere.stats, gearHere.ratings) : null), [gearHere]);

  const data = useMemo<RowData[]>(() => {
    if (!abilities) return [];
    const out: RowData[] = [];
    for (const a of abilities.abilities) {
      const rank = rankAtLevel(a, level);
      if (!rank) continue;
      // Daño infligido por escuela (aura 79) de talentos, raza y equipo: multiplica el daño de las habilidades de esa escuela
      const dmg = dealsDamage(rank);
      const m = applyModifiers(rank, level, mods, { damageDonePct: dmg ? damageDonePct(fx, rank.schoolMask) : 0 });
      const base = applyModifiers(rank, level, []);
      const sum = abilityEffectSummary(a.name, fx, { canCrit: canCrit(rank), schoolMask: rank.schoolMask, dealsDamage: dmg });
      const ruleTexts = ruled.filter((l) => ruleAppliesTo(l, a, rank)).map((l) => ruleAbilityDetail(l, rank).text);
      // «Afectada por mis talentos»: cuentan las cifras de talentos de clase, de Legacy y del equipo (bonos de conjunto, efectos de objeto); la raza se aplica a todas
      const fromTalents = (l: AbilityEffectLine): boolean => l.sources.some((s) => s.from !== "race");
      const count = sum.lines.filter(fromTalents).length + Object.values(sum.inline).reduce((n, v) => n + (v?.filter(fromTalents).length ?? 0), 0) + ruleTexts.length;
      const chances: Chances | null = formulas ? abilityChances({ rank, classId: idx.data.classId, level, target, formulas, stats: baseStats, classStats, lines: sum.lines, gear: gearBonus }) : null;
      const crit = chances ? chances.crit.vsTargetPct : null;
      // Resultado por lanzamiento: sin talentos, con talentos, con tu poder y esperado con crítico y fallo
      const outcome = abilityOutcome({ rank, level, modifiers: mods, damageDonePct: dmg ? damageDonePct(fx, rank.schoolMask) : 0, power: power?.ctx ?? null, chances, critMultiplier: formulas?.critMultiplier ?? null, hastePct: power ? hasteFor(power.haste, rank) : 0 });
      const requirement = rank.equipped.length > 0 ? { text: describeEquipped(rank.equipped), met: meetsEquipped(rank.equipped, equipped) } : null;
      out.push({ ability: a, rank, m, base, summaryLines: sum.lines, inline: sum.inline, ruleTexts, count, crit, outcome, requirement });
    }
    return out;
  }, [abilities, level, mods, fx, ruled, formulas, baseStats, classStats, gearBonus, target, idx.data.classId, power, equipped]);

  if (!entry) return <p className="muted">{tr("Las habilidades de")} {classLabel(idx.data.classToken, idx.data.className ?? "")} {tr("aún no están revisadas (se van añadiendo clase a clase; ya están el Mago, el Pícaro y el Guerrero")}).</p>;
  if (state.status === "loading" || rulesState.status === "loading") return <p className="muted">{tr("Cargando habilidades…")}</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;

  // «Activa en Forever» = la lista de la referencia (o no hay referencia para la clase). Las runas de Forever que la referencia no lista y las que da por retiradas se ven al desmarcar
  const isActive = (d: (typeof data)[number]): boolean => !d.ability.talentsForever || d.ability.talentsForever.status === "listed" || d.ability.talentsForever.status === "partial";
  const hiddenInactive = data.filter((d) => (!onlyAffected || d.count > 0) && !isActive(d)).length;
  const rows = data.filter((d) => (!onlyAffected || d.count > 0) && (!onlyActive || isActive(d)));
  const shown = pin ?? hover;
  const tipRow = shown ? data.find((d) => d.ability.name === shown.name) : undefined;

  return (
    <>
      <div className="ab-controls">
        <label title={tr("Contra quien se calcula la probabilidad de impacto")}>
        {tr("Objetivo")}{" "}
          <select value={target} onChange={(e) => setTarget(e.target.value as TargetOption)} aria-label={tr("Objetivo")}>
            <option value="same">{tr("de tu nivel")}</option>
            <option value="boss">{tr("jefe (+3 niveles)")}</option>
          </select>
        </label>
        {vsTypes.length > 0 && (
          <label title={tr("Contra qué tipo de criatura se calcula: suma los bonos «contra …» de tu equipo al poder de ataque y al daño con hechizos")}>
            {tr("Tipo de criatura")}{" "}
            <select value={creatureType ?? ""} onChange={(e) => setCreatureType(e.target.value || null)} aria-label={tr("Tipo de criatura")}>
              <option value="">{tr("cualquiera")}</option>
              {vsTypes.map((c) => (
                <option key={c.key} value={c.key}>
                  {trn(c.label)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input type="checkbox" checked={onlyAffected} onChange={(e) => setOnlyAffected(e.target.checked)} /> {tr("Solo las afectadas por mis talentos")}
        </label>
        <label title={tr("Las habilidades que la referencia lista. Desmárcalo para ver también las que Forever no lista (runas, auxiliares) o da por retiradas: salen marcadas «sin referencia» o «retirada según la referencia»")}>
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> {tr("Solo activas en Forever")}
          {onlyActive && hiddenInactive > 0 ? <small className="muted"> ({hiddenInactive} {tr("ocultas")})</small> : null}
        </label>
        <span className="muted small">
          {rows.length} {tr("habilidades · pasa el cursor por una para ver todo (Ctrl = base sin mejoras; clic para fijar la tarjeta")})
        </span>
      </div>
      <div className="ab-scroll">
        <ul className="ab-list">
          {rows.map((d) => (
            <Row
              key={d.ability.name}
              d={d}
              selected={pin?.name === d.ability.name}
              onHover={(pos) => setHover(pos ? { name: d.ability.name, ...pos } : null)}
              onToggle={(pos) => setPin((p) => (p?.name === d.ability.name ? null : { name: d.ability.name, ...pos }))}
            />
          ))}
        </ul>
        {rows.length === 0 && (
          <p className="muted small">{tr("Ninguna habilidad está afectada por tus talentos todavía. Elige talentos en el paso anterior o desmarca «Solo las afectadas por mis talentos» para ver todas.")}</p>
        )}
      </div>
      <p className="muted small">
        <span className="tag tag-unassigned">{tr("Cliente")}</span> {tr("Cifras de los hechizos de la beta con el valor del rango al nivel elegido. En azul lo que cambian tus talentos; «Mejorada por» nombra los talentos, Puntos de Legado y piezas de equipo que le afectan (los efectos de la raza se aplican a todas y no se listan). Los talentos que dan una habilidad activa (Poder Arcano, Presencia mental…) no cuentan porque solo valen mientras está activa, salvo que los marques en «Habilidades activas». El daño infligido por escuela de talentos, raza y equipo ya multiplica el daño; los que dependen de un arma o un estado (varitas, armas de una o dos manos, escudo) quedan como texto. El poder con hechizos y de ataque se estima aparte («Con tu poder»: reglas de Classic, sin confirmar en Forever")}).
      </p>
      {shown && tipRow && <AbilityCard tip={{ row: tipRow, x: shown.x, y: shown.y, pinned: !!pin }} base={ctrl} onClose={() => setPin(null)} textKnown={textKnown} chancesInput={formulas ? { formulas, stats: baseStats, classStats, target, level, classId: idx.data.classId, gear: gearBonus } : null} power={power} />}
    </>
  );
}
