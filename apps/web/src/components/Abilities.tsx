import {
  abilityChances,
  baseAttackPower,
  classBaseOf,
  abilityEffectSummary,
  applyModifiers,
  canCrit,
  collectStatEffects,
  damageDonePct,
  dealsDamage,
  deriveCombatStats,
  deriveStats,
  gearChanceBonus,
  hasteFor,
  gearSpellModifiers,
  healsTarget,
  powerContext,
  powerEstimate,
  rankAtLevel,
  renderAbilityText,
  ruleAbilityDetail,
  ruleAppliesTo,
  ruleLines,
  spellModifiersOf,
  type AbilityEffectLine,
  type Build,
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

const fmt = (n: number, digits = 0): string => n.toLocaleString("es-ES", { maximumFractionDigits: digits });
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
  m.cost !== null ? `${fmt(costAmount(m), 1)} ${POWER_LABEL[m.costType ?? "other"]}`.trim() : m.costPctOfBase !== null ? `${fmt(m.costPctOfBase, 1)} % del maná base` : "—";
const castText = (m: ModifiedAbility): string => {
  if (!m.rank.channeled) return m.castMs === 0 ? "Instantáneo" : seconds(m.castMs);
  // Control mental: 3 s de lanzamiento y luego se canaliza
  const channel = `Canalizado${m.durationMs ? ` ${seconds(m.durationMs)}` : ""}`;
  return m.castMs > 0 ? `${seconds(m.castMs)} + ${channel.toLowerCase()}` : channel;
};
const radiusText = (m: ModifiedAbility): string => (m.radiusYd === null ? "—" : `${fmt(m.radiusYd, 1)} m`);
const cooldownText = (m: ModifiedAbility): string => (m.cooldownMs !== null ? seconds(m.cooldownMs) : "—");
const rangeText = (m: ModifiedAbility): string => (m.rangeYd === null ? "—" : m.rangeYd >= 1000 ? "Sin límite" : `${fmt(m.rangeYd)} m`);

/** Valor de una linea sumada con su unidad: +8 %, -0,5 s, +6 m... */
const lineValue = (l: AbilityEffectLine): string => {
  if (l.unit === "s") return `${sign(l.value)} s`;
  if (l.unit === "m") return `${sign(l.value)} m`;
  if (l.unit === "%" || l.unit === "puntos porcentuales") return `${sign(l.value)} %`;
  return sign(l.value);
};
const sourceName = (s: StatSource): string => (s.maxRank > 1 ? `${s.name} ${s.rank}/${s.maxRank}` : s.name);

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
      <span className="ab-kind">{KIND_LABEL[e.kind] ?? e.kind}</span> <b>{range(m.final.min, m.final.max)}</b>
      {periodic && e.periodMs ? (
        <span className="muted">
          {" "}
          cada {seconds(e.periodMs)}
          {ticks ? ` × ${ticks} = ${fmt(m.final.average * ticks)}` : ""}
        </span>
      ) : null}
      {detailed && m.coefficient !== null && <span className="muted"> · {fmt(m.coefficient * 100, 1)} % del poder con hechizos</span>}
      {detailed && changed && <small className="was"> (sin talentos {range(m.base.min, m.base.max)})</small>}
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
    for (const s of l.sources) if (s.from !== "race" && !names.includes(s.name)) names.push(s.name);
  };
  d.summaryLines.forEach(add);
  Object.values(d.inline).forEach((v) => v?.forEach(add));
  return names;
}

const MODS_SHOWN = 4;

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
        aria-label={`${ability.name}, rango ${m.rank.rank}. Intro para ver la tarjeta completa`}
        onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => onToggle({ x: e.clientX, y: e.clientY })}
        onKeyDown={onKey}
      >
        <div className="ab-top">
          <div className="ab-name">
            <Icon id={ability.iconFileDataId} name={ability.name} />
            <div>
              <h4>{ability.name}</h4>
              <p className="ab-sub">
                <span className="rank-chip">rango {m.rank.rank}</span>
                {ability.talentsForever && ability.talentsForever.status !== "listed" && (
                  <span className={`tf-chip tf-${ability.talentsForever.status}`} title={ability.talentsForever.note ?? undefined}>
                    {ability.talentsForever.status === "retired" ? "retirada según la referencia" : "sin referencia"}
                  </span>
                )}
              </p>
            </div>
          </div>
          <dl className="ab-tiles">
            <Tile label="Coste" value={costText(m)} changed={costText(m) !== costText(base)} />
            <Tile label="Lanzamiento" value={castText(m)} changed={castText(m) !== castText(base)} />
            <Tile label="Reutilización" value={cooldownText(m)} changed={cooldownText(m) !== cooldownText(base)} />
            <Tile label="Alcance" value={rangeText(m)} changed={rangeText(m) !== rangeText(base)} />
            <Tile label="Crítico" value={d.crit !== null ? `${fmt(d.crit, 1)} %` : "—"} tone={d.crit !== null ? "pos" : "muted"} />
          </dl>
        </div>
        {m.effects.length > 0 && (
          <div className="ab-effects">
            {m.effects.map((e) => (
              <EffectLine key={`${e.effect.viaSpellId ?? 0}-${e.effect.index}`} m={e} durationMs={m.durationMs} detailed={false} />
            ))}
          </div>
        )}
        {d.count > 0 && (
          <div className="ab-mods" title="Efectos de tus talentos que afectan a esta habilidad: pasa el cursor para verlos">
            <span>Mejorada por</span>
            {mods.slice(0, MODS_SHOWN).map((n) => (
              <span key={n} className="chip">
                {n}
              </span>
            ))}
            {mods.length > MODS_SHOWN && <span className="chip">+{mods.length - MODS_SHOWN} más</span>}
            {mods.length === 0 && <span className="chip">{d.count} efectos de talentos</span>}
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
function AbilityCard({ tip, base: showBase, onClose, chancesInput, power }: { tip: Tip; base: boolean; onClose: () => void; chancesInput: ChancesInput | null; power: { ctx: PowerContext; attributesKnown: boolean; hasGear: boolean; haste: CombatStats["haste"] } | null }) {
  const { row } = tip;
  const { ability, rank } = row;
  // Con Ctrl: la misma habilidad sin ningun talento
  const m = showBase ? row.base : row.m;
  const parts = renderAbilityText(rank, m);
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
        <button type="button" className="ab-card-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      )}
      <div className="ab-tip-head">
        <Icon id={ability.iconFileDataId} name={ability.name} />
        <div>
          <h4>{ability.name}</h4>
          <p className="rank-line">
            Rango {rank.rank} · {rank.learnedByTalent ? "lo enseña un talento" : "se aprende"} al nivel {rank.level}
          </p>
          {ability.talentsForever && ability.talentsForever.status !== "listed" && (
            <p className={`tf-note tf-${ability.talentsForever.status}`}>{ability.talentsForever.note}</p>
          )}
        </div>
      </div>
      {showBase && <p className="ab-base-banner">Base sin talentos. Suelta Ctrl para ver tus mejoras.</p>}

      <div className={`ab-cols${chances || lines.length > 0 || rules.length > 0 || hasPower ? "" : " single"}`}>
      <div className="ab-col">
      <dl className="ab-grid">
        <Stat label="Coste" now={costText(m)} was={costText(row.base)} />
        <Stat label="Alcance" now={rangeText(m)} was={rangeText(row.base)} />
        {m.radiusYd !== null && <Stat label="Radio" now={radiusText(m)} was={radiusText(row.base)} />}
        <Stat label="Lanzamiento" now={castText(m)} was={castText(row.base)} />
        {hasteCast !== null && <Stat label={`Con ${fmt(haste, 2)} % de celeridad`} now={seconds(hasteCast)} was={castText(m)} />}
        <Stat label="Reutilización" now={cooldownText(m)} was={cooldownText(row.base)} />
      </dl>
      {noted.length > 0 && (
        <ul className="ab-notes">
          {noted.flatMap(([, v]) =>
            v.map((l) => (
              <li key={`${l.category}-${l.label}`}>
                <b>{lineValue(l)}</b> {l.label} <span className="muted">({l.sources.map(sourceName).join(", ")})</span>
              </li>
            )),
          )}
        </ul>
      )}

      <p className="ab-text">
        {parts.map((p, i) => (p.changed ? (
          <b key={i} className="changed">
            {p.text}
          </b>
        ) : (
          <span key={i}>{p.text}</span>
        )))}
      </p>

      {m.effects.length > 0 && (
        <section>
          <h5>Efectos</h5>
          {m.effects.map((e) => (
            <EffectLine key={`${e.effect.viaSpellId ?? 0}-${e.effect.index}`} m={e} durationMs={m.durationMs} detailed />
          ))}
        </section>
      )}

      </div>
      <div className="ab-col">
      {chances && (
        <section>
          <h5>
            Probabilidades <span className="tag tag-inactive" title="La tabla de fallo, el crítico base de la clase y la supresión de crítico son de la comunidad (el cliente de Forever no trae las tablas de impacto); el crítico por atributo sí es del cliente (PlayerExpectedStat)">impacto y crítico base: comunidad · crítico por atributo: cliente</span>
          </h5>
          <ul className="ab-chances">
            {!(healsTarget(rank) && !dealsDamage(rank)) && (
            <li>
              <span className="ab-sum-l">Impacto contra {chancesInput!.target === "boss" ? "un jefe (+3 niveles)" : "un objetivo de tu nivel"}</span>
              <b className="pos">{fmt(chances.hit.total, 1)} %</b>
              <span className="ab-sum-s">
                {fmt(100 - chances.hit.missPct, 1)} % de la tabla ({fmt(chances.hit.missPct, 1)} % de fallo)
                {chances.hit.bonusPct !== 0 ? ` ${sign(chances.hit.bonusPct)} % de talentos y raza` : ""}
                {chances.hit.gearPct !== 0 ? ` +${fmt(chances.hit.gearPct, 2)} % de tu equipo` : ""}
                {chances.hit.capped ? ` · tope ${chances.hit.cap} %` : ""}
              </span>
            </li>
            )}
            <li>
              <span className="ab-sum-l">Crítico{chances.crit.total !== null ? " (lo que enseña tu hoja)" : ": lo que suman tus estadísticas, talentos y raza"}</span>
              {chances.crit.total !== null ? <b className="pos">{sign(chances.crit.total)} %</b> : chances.crit.bonusPct !== 0 ? <b className="pos">{sign(chances.crit.bonusPct)} %</b> : <b className="muted">—</b>}
              <span className="ab-sum-s">
                {chances.crit.baseClassPct !== 0 ? `${fmt(chances.crit.baseClassPct, 1)} % base de tu clase · ` : ""}
                {chances.crit.fromStat !== null && chances.crit.stat
                  ? `${sign(chances.crit.fromStat)} % por tu ${chances.crit.stat === "int" ? "intelecto" : "agilidad"} (${fmt(chances.crit.statValue ?? 0)} ÷ ${fmt(chances.crit.statPerPercent ?? 0, 1)})`
                  : chances.crit.unavailable}
                {chances.crit.bonusPct !== 0 ? ` · ${sign(chances.crit.bonusPct)} % de talentos y raza` : ""}
                {chances.crit.gearPct !== 0 ? ` · +${fmt(chances.crit.gearPct, 2)} % de la puntuación de tu equipo` : ""}
              </span>
            </li>
            {chances.crit.suppressionPct > 0 && chances.crit.vsTargetPct !== null && (
              <li>
                <span className="ab-sum-l">Crítico contra un jefe (+3 niveles)</span>
                <b className="pos">{sign(chances.crit.vsTargetPct)} %</b>
                <span className="ab-sum-s">−{fmt(chances.crit.suppressionPct, 1)} % de supresión (3 % por la diferencia de habilidad de arma y el crítico de auras hasta 1,8 %; los hechizos no la tienen)</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {est && hasPower && power && (
        <section>
          <h5>
            Con tu poder <span className="tag tag-inactive" title="El coeficiente de poder con hechizos de cada efecto sale del cliente, pero no se sabe si Forever lo aplica como Classic. El golpe de arma usa la fórmula de Classic (arma + poder de ataque ÷ 14 × velocidad). No hay coeficientes de poder de ataque en el cliente.">estimación Classic</span>
          </h5>
          <ul className="ab-sum">
            {est.spell.map((b) => {
              const me = m.effects.find((x) => x.effect.index === b.effectIndex && x.effect.viaSpellId === null) ?? m.effects.find((x) => x.effect.index === b.effectIndex)!;
              return (
                <li key={`${b.effectIndex}-${b.periodic}`}>
                  <span className="ab-sum-l">{KIND_LABEL[me.effect.kind] ?? me.effect.kind}</span>
                  <b className="pos">{range(b.final.min, b.final.max)}</b>
                  <span className="ab-sum-s">
                    {b.periodic ? "por tick " : ""}= {range(me.final.min, me.final.max)} + {fmt(b.power)} de poder con hechizos × {fmt(b.coefficient * 100, 1)} % = +{fmt(b.perHit, 1)}
                    {b.periodic ? ` · × ${b.ticks} ticks = ${fmt(b.final.average * b.ticks)} en total` : ""}
                  </span>
                </li>
              );
            })}
            {est.weapon && (
              <li>
                <span className="ab-sum-l">Golpe de arma{est.weapon.ranged ? " (a distancia)" : ""}</span>
                <b className="pos">{range(est.weapon.min, est.weapon.max)}</b>
                <span className="ab-sum-s">{est.weapon.formula}</span>
              </li>
            )}
          </ul>
          {!power.attributesKnown && <p className="muted small">Elige una raza para sumar el poder que dan tus atributos.</p>}
          {!power.hasGear && <p className="muted small">Sin equipo: solo cuenta el poder de tus atributos y talentos.</p>}
        </section>
      )}

      {lines.length > 0 && (
        <section>
          <h5>Con tus talentos, Puntos de Legado y raza</h5>
          <ul className="ab-sum">
            {lines.map((l) => (
              <li key={`${l.category}-${l.label}`}>
                <span className="ab-sum-l">{l.label.charAt(0).toUpperCase() + l.label.slice(1)}</span>
                <b className={l.value < 0 && l.category !== "Retroceso al lanzar" ? "neg" : "pos"}>{lineValue(l)}</b>
                <span className="ab-sum-s">{l.sources.map(sourceName).join(" + ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rules.length > 0 && (
        <section>
          <h5>Al golpear y otros efectos</h5>
          <ul className="ab-rules">
            {rules.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}

      </div>
      </div>

      <p className="muted small ab-foot">
        {rank.descriptionTemplate.includes("$") ? "Alguna cifra depende de tu personaje y no se calcula. " : ""}
        Las cifras de arriba no incluyen el poder con hechizos ni el de ataque (ver «Con tu poder», estimación). {!showBase && row.count > 0 ? "Mantén Ctrl para ver la base. " : ""}
        {tip.pinned ? "Clic en la habilidad para cerrar." : "Clic en la habilidad para fijar la tarjeta."}
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
  level,
  gear,
}: {
  manifest: Manifest;
  idx: ClassIndex;
  build: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  race: Race | null;
  /** Nivel del personaje (lo elige el Resumen). */
  level: number;
  /** Equipo del paso «Equipo» (estadisticas sumadas y puntuaciones); null si no llevas. */
  gear?: { stats: Record<string, number>; ratings: CombatRatings | null; minLevel: number; effects: GearEffectSource[]; weapons: { slot: string; min: number; max: number; speed: number; normalizedSpeed: number }[] } | null;
}) {
  const entry = manifest.abilities.find((a) => a.classId === idx.data.classId);
  const state = useAsync(entry?.file ?? "none", () => (entry ? getJson(entry.file, (v) => AbilitiesSchema.parse(v)) : Promise.reject(new Error("sin habilidades"))));
  const ruleEntry = manifest.rules.find((a) => a.classId === idx.data.classId);
  const rulesState = useAsync(ruleEntry?.file ?? "none", () => (ruleEntry ? getJson(ruleEntry.file, (v) => TalentRulesSchema.parse(v)) : Promise.resolve(null)));
  const formulasEntry = manifest.combatFormulas;
  const formulasState = useAsync(formulasEntry?.file ?? "none", () => (formulasEntry ? getJson(formulasEntry.file, (v) => CombatFormulasSchema.parse(v)) : Promise.resolve(null)));
  const clientStatsEntry = manifest.clientStats;
  const clientStatsState = useAsync(clientStatsEntry?.file ?? "none", () => (clientStatsEntry ? getJson(clientStatsEntry.file, (v) => ClientStatsSchema.parse(v)) : Promise.resolve(null)));
  const statsState = useAsync(manifest.stats.file, () => getJson(manifest.stats.file, (v) => BaseStatsSchema.parse(v)));
  const [target, setTarget] = useState<TargetOption>("same");
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
  // El equipo solo cuenta desde el nivel del objeto mas alto que llevas (como en la tabla de estadisticas del Resumen)
  const gearHere = gear && level >= gear.minLevel ? gear : null;
  const gearEffects = gearHere?.effects;
  const mods = useMemo(() => [...spellModifiersOf(idx, build), ...(legacy ? spellModifiersOf(legacy, legacyBuild) : []), ...(gearEffects ? gearSpellModifiers(gearEffects) : [])], [idx, build, legacy, legacyBuild, gearEffects]);
  const ruled = useMemo(() => ruleLines(rules, idx, build), [rules, idx, build]);
  const fx = useMemo(() => collectStatEffects({ cls: idx, classBuild: build, legacy, legacyBuild, race, abilities, rules, gearEffects }), [idx, build, legacy, legacyBuild, race, abilities, rules, gearEffects]);
  // Atributos de tu raza y clase a este nivel (Classic, estimacion) con el equipo y los % de talentos, Legacy y raza ya aplicados; sin raza no hay.
  const baseStats = useMemo(() => {
    if (!race || statsState.status !== "ready") return null;
    const row = statsState.value.combos.find((c) => c.raceId === race.id && c.classId === idx.data.classId)?.stats[level - 1];
    if (!row) return null;
    const final = deriveStats({ attributes: row as [number, number, number, number, number], hpBase: 0, manaBase: 0, totals: fx.totals, gear: gearHere?.stats ?? null }).rows;
    const at = (k: string): number => final.find((r) => r.key === k)?.final ?? 0;
    return { agi: at("agi"), int: at("int") };
  }, [race, statsState, idx.data.classId, level, fx, gearHere]);
  // Poder con hechizos y de ataque finales (atributos de la raza si hay, equipo, talentos), para la estimacion de daño de la tarjeta
  const power = useMemo(() => {
    if (clientStatsState.status !== "ready") return null;
    const clientClass = clientStatsState.value?.classes.find((c) => c.classId === idx.data.classId) ?? null;
    const row = race && statsState.status === "ready" ? statsState.value.combos.find((c) => c.raceId === race.id && c.classId === idx.data.classId)?.stats[level - 1] : undefined;
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
    return { ctx: powerContext(derived, gearHere?.stats ?? null, gearHere?.weapons ?? []), attributesKnown: !!row, hasGear: !!gearHere, haste: combat.haste };
  }, [clientStatsState, statsState, race, idx.data.classId, level, fx, gearHere, classStats, formulas]);
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
      const crit = formulas ? abilityChances({ rank, classId: idx.data.classId, level, target, formulas, stats: baseStats, classStats, lines: sum.lines, gear: gearBonus }).crit.vsTargetPct : null;
      out.push({ ability: a, rank, m, base, summaryLines: sum.lines, inline: sum.inline, ruleTexts, count, crit });
    }
    return out;
  }, [abilities, level, mods, fx, ruled, formulas, baseStats, classStats, gearBonus, target, idx.data.classId]);

  if (!entry) return <p className="muted">Las habilidades de {idx.data.className} aún no están revisadas (se van añadiendo clase a clase; ya están el Mago, el Pícaro y el Guerrero).</p>;
  if (state.status === "loading" || rulesState.status === "loading") return <p className="muted">Cargando habilidades…</p>;
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
        <label title="Contra quien se calcula la probabilidad de impacto">
          Objetivo{" "}
          <select value={target} onChange={(e) => setTarget(e.target.value as TargetOption)} aria-label="Objetivo">
            <option value="same">de tu nivel</option>
            <option value="boss">jefe (+3 niveles)</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyAffected} onChange={(e) => setOnlyAffected(e.target.checked)} /> Solo las afectadas por mis talentos
        </label>
        <label title="Las habilidades que la referencia lista. Desmárcalo para ver también las que Forever no lista (runas, auxiliares) o da por retiradas: salen marcadas «sin referencia» o «retirada según la referencia»">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Solo activas en Forever
          {onlyActive && hiddenInactive > 0 ? <small className="muted"> ({hiddenInactive} ocultas)</small> : null}
        </label>
        <span className="muted small">
          {rows.length} habilidades · pasa el cursor por una para ver todo (Ctrl = base sin mejoras; clic para fijar la tarjeta)
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
          <p className="muted small">Ninguna habilidad está afectada por tus talentos todavía. Elige talentos en el paso anterior o desmarca «Solo las afectadas por mis talentos» para ver todas.</p>
        )}
      </div>
      <p className="muted small">
        <span className="tag tag-unassigned">Cliente</span> Cifras de los hechizos de la beta con el valor del rango al nivel elegido. En azul lo que cambian tus talentos; «Mejorada por» nombra los talentos, Puntos de Legado y piezas de equipo que le afectan (los efectos de la raza
        se aplican a todas y no se listan). Los talentos que dan una habilidad activa (Poder Arcano, Presencia mental…) no cuentan porque solo valen mientras está activa. El daño infligido por escuela de talentos, raza y equipo ya multiplica el daño; los que dependen de un arma o un estado (varitas, armas de una o dos manos, escudo) quedan como texto. El poder con hechizos y de ataque se estima aparte («Con tu poder»: reglas de Classic, sin confirmar en Forever).
      </p>
      {shown && tipRow && <AbilityCard tip={{ row: tipRow, x: shown.x, y: shown.y, pinned: !!pin }} base={ctrl} onClose={() => setPin(null)} chancesInput={formulas ? { formulas, stats: baseStats, classStats, target, level, classId: idx.data.classId, gear: gearBonus } : null} power={power} />}
    </>
  );
}
