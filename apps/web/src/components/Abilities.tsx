import {
  abilityChances,
  abilityEffectSummary,
  applyModifiers,
  canCrit,
  collectStatEffects,
  dealsDamage,
  healsTarget,
  rankAtLevel,
  renderAbilityText,
  ruleAbilityDetail,
  ruleAppliesTo,
  ruleLines,
  spellModifiersOf,
  type AbilityEffectLine,
  type Build,
  type ClassIndex,
  type TargetOption,
  type ModifiedAbility,
  type ModifiedEffect,
  type StatSource,
} from "@wfuc/engine";
import type { Ability, AbilityRank, ClassStatLevel, CombatFormulas, Manifest, Race } from "@wfuc/schema";
import { Abilities as AbilitiesSchema, BaseStats as BaseStatsSchema, ClientStats as ClientStatsSchema, CombatFormulas as CombatFormulasSchema, TalentRules as TalentRulesSchema } from "@wfuc/schema";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
}

interface Tip {
  row: RowData;
  x: number;
  y: number;
  pinned: boolean;
}

function Row({ d, selected, onHover, onToggle }: { d: RowData; selected: boolean; onHover: (e: { x: number; y: number } | null) => void; onToggle: (e: { x: number; y: number }) => void }) {
  const { m, ability, base } = d;
  return (
    <tr
      className={selected ? "sel" : undefined}
      onMouseEnter={(e) => onHover({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => onToggle({ x: e.clientX, y: e.clientY })}
    >
      <th scope="row" className="ab-name">
        <Icon id={ability.iconFileDataId} name={ability.name} />
        <span>
          {ability.name} <span className="rank-chip">rango {m.rank.rank}</span>
          {ability.talentsForever && ability.talentsForever.status !== "listed" && (
            <span className={`tf-chip tf-${ability.talentsForever.status}`} title={ability.talentsForever.note ?? undefined}>
              {ability.talentsForever.status === "retired" ? "retirada según TF" : "sin TF"}
            </span>
          )}
          {d.count > 0 && (
            <span className="ab-count" title="Efectos de tus talentos que afectan a esta habilidad: pasa el cursor para verlos">
              {d.count}
            </span>
          )}
        </span>
      </th>
      <td className={costText(m) !== costText(base) ? "changed" : undefined}>{costText(m)}</td>
      <td className={castText(m) !== castText(base) ? "changed" : undefined}>{castText(m)}</td>
      <td className={cooldownText(m) !== cooldownText(base) ? "changed" : undefined}>{cooldownText(m)}</td>
      <td className={rangeText(m) !== rangeText(base) ? "changed" : undefined}>{rangeText(m)}</td>
      <td className="ab-effects">
        {m.effects.length === 0 ? <span className="muted">—</span> : m.effects.map((e) => <EffectLine key={`${e.effect.viaSpellId ?? 0}-${e.effect.index}`} m={e} durationMs={m.durationMs} detailed={false} />)}
      </td>
    </tr>
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
function AbilityCard({ tip, base: showBase, onClose, chancesInput }: { tip: Tip; base: boolean; onClose: () => void; chancesInput: ChancesInput | null }) {
  const { row } = tip;
  const { ability, rank } = row;
  // Con Ctrl: la misma habilidad sin ningun talento
  const m = showBase ? row.base : row.m;
  const parts = renderAbilityText(rank, m);
  const lines = showBase ? [] : row.summaryLines;
  const rules = showBase ? [] : row.ruleTexts;
  const chances = chancesInput ? abilityChances({ rank, classId: chancesInput.classId, level: chancesInput.level, target: chancesInput.target, formulas: chancesInput.formulas, stats: chancesInput.stats, classStats: chancesInput.classStats, lines }) : null;
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

      <div className={`ab-cols${chances || lines.length > 0 || rules.length > 0 ? "" : " single"}`}>
      <div className="ab-col">
      <dl className="ab-grid">
        <Stat label="Coste" now={costText(m)} was={costText(row.base)} />
        <Stat label="Alcance" now={rangeText(m)} was={rangeText(row.base)} />
        {m.radiusYd !== null && <Stat label="Radio" now={radiusText(m)} was={radiusText(row.base)} />}
        <Stat label="Lanzamiento" now={castText(m)} was={castText(row.base)} />
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
            Probabilidades <span className="tag tag-inactive" title="La tabla de fallo es de Classic Era (el cliente de Forever no trae las tablas de impacto); el crítico por atributo sí es del cliente (PlayerExpectedStat)">impacto: estimación Classic · crítico: cliente</span>
          </h5>
          <ul className="ab-chances">
            {!(healsTarget(rank) && !dealsDamage(rank)) && (
            <li>
              <span className="ab-sum-l">Impacto contra {chancesInput!.target === "boss" ? "un jefe (+3 niveles)" : "un objetivo de tu nivel"}</span>
              <b className="pos">{fmt(chances.hit.total, 1)} %</b>
              <span className="ab-sum-s">
                {fmt(100 - chances.hit.missPct, 1)} % de la tabla ({fmt(chances.hit.missPct, 1)} % de fallo)
                {chances.hit.bonusPct !== 0 ? ` ${sign(chances.hit.bonusPct)} % de talentos y raza` : ""}
                {chances.hit.capped ? ` · tope ${chances.hit.cap} %` : ""}
              </span>
            </li>
            )}
            <li>
              <span className="ab-sum-l">Crítico: lo que suman tus estadísticas, talentos y raza</span>
              {chances.crit.total !== null ? <b className="pos">{sign(chances.crit.total)} %</b> : chances.crit.bonusPct !== 0 ? <b className="pos">{sign(chances.crit.bonusPct)} %</b> : <b className="muted">—</b>}
              <span className="ab-sum-s">
                {chances.crit.fromStat !== null && chances.crit.stat
                  ? `${sign(chances.crit.fromStat)} % por tu ${chances.crit.stat === "int" ? "intelecto" : "agilidad"} (${fmt(chances.crit.statValue ?? 0)} ÷ ${fmt(chances.crit.statPerPercent ?? 0, 1)})`
                  : chances.crit.unavailable}
                {chances.crit.bonusPct !== 0 ? ` · ${sign(chances.crit.bonusPct)} % de talentos y raza` : ""}
                {canCrit(rank) ? " · se suma al crítico base de tu clase, que no está en el cliente" : ""}
              </span>
            </li>
          </ul>
        </section>
      )}

      {lines.length > 0 && (
        <section>
          <h5>Con tus talentos, Legacy y raza</h5>
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
        No incluye poder con hechizos. {!showBase && row.count > 0 ? "Mantén Ctrl para ver la base. " : ""}
        {tip.pinned ? "Clic en la fila para cerrar." : "Clic en la fila para fijar la tarjeta."}
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
  minLevel,
}: {
  manifest: Manifest;
  idx: ClassIndex;
  build: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  race: Race | null;
  minLevel: number;
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
  const [level, setLevel] = useState(60);
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
  // Estadisticas base de tu raza y clase a este nivel (Classic, estimacion); sin raza no hay
  const baseStats = useMemo(() => {
    if (!race || statsState.status !== "ready") return null;
    const row = statsState.value.combos.find((c) => c.raceId === race.id && c.classId === idx.data.classId)?.stats[level - 1];
    return row ? { agi: row[1]!, int: row[3]! } : null;
  }, [race, statsState, idx.data.classId, level]);
  const abilities = state.status === "ready" ? state.value : null;
  const mods = useMemo(() => [...spellModifiersOf(idx, build), ...(legacy ? spellModifiersOf(legacy, legacyBuild) : [])], [idx, build, legacy, legacyBuild]);
  const ruled = useMemo(() => ruleLines(rules, idx, build), [rules, idx, build]);
  const fx = useMemo(() => collectStatEffects({ cls: idx, classBuild: build, legacy, legacyBuild, race, abilities, rules }), [idx, build, legacy, legacyBuild, race, abilities, rules]);

  const data = useMemo<RowData[]>(() => {
    if (!abilities) return [];
    const out: RowData[] = [];
    for (const a of abilities.abilities) {
      const rank = rankAtLevel(a, level);
      if (!rank) continue;
      const m = applyModifiers(rank, level, mods);
      const base = applyModifiers(rank, level, []);
      const sum = abilityEffectSummary(a.name, fx, { canCrit: canCrit(rank) });
      const ruleTexts = ruled.filter((l) => ruleAppliesTo(l, a, rank)).map((l) => ruleAbilityDetail(l, rank).text);
      // «Afectada por mis talentos»: solo cuentan las cifras que vienen de talentos de clase o de Legacy; la raza se aplica a todas
      const fromTalents = (l: AbilityEffectLine): boolean => l.sources.some((s) => s.from !== "race");
      const count = sum.lines.filter(fromTalents).length + Object.values(sum.inline).reduce((n, v) => n + (v?.filter(fromTalents).length ?? 0), 0) + ruleTexts.length;
      out.push({ ability: a, rank, m, base, summaryLines: sum.lines, inline: sum.inline, ruleTexts, count });
    }
    return out;
  }, [abilities, level, mods, fx, ruled]);

  if (!entry) return <p className="muted">Las habilidades de {idx.data.className} aún no están revisadas (se van añadiendo clase a clase; ya están el Mago, el Pícaro y el Guerrero).</p>;
  if (state.status === "loading" || rulesState.status === "loading") return <p className="muted">Cargando habilidades…</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;

  // «Activa en Forever» = la lista Talents Forever (o no hay export de TF para la clase). Las runas de Forever que TF no lista y las que da por retiradas se ven al desmarcar
  const isActive = (d: (typeof data)[number]): boolean => !d.ability.talentsForever || d.ability.talentsForever.status === "listed" || d.ability.talentsForever.status === "partial";
  const hiddenInactive = data.filter((d) => (!onlyAffected || d.count > 0) && !isActive(d)).length;
  const rows = data.filter((d) => (!onlyAffected || d.count > 0) && (!onlyActive || isActive(d)));
  const shown = pin ?? hover;
  const tipRow = shown ? data.find((d) => d.ability.name === shown.name) : undefined;

  return (
    <>
      <div className="ab-controls">
        <label>
          Nivel{" "}
          <input type="number" min={1} max={60} value={level} onChange={(e) => setLevel(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} aria-label="Nivel del personaje" />
        </label>
        <button type="button" onClick={() => setLevel(Math.max(1, minLevel))} title="El nivel que exigen tus puntos de talento">
          Mi nivel ({Math.max(1, minLevel)})
        </button>
        <button type="button" onClick={() => setLevel(30)} title="El nivel máximo de la beta">
          30 (tope beta)
        </button>
        <button type="button" onClick={() => setLevel(60)}>
          60
        </button>
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
        <label title="Las habilidades que Talents Forever lista. Desmárcalo para ver también las que Forever no lista (runas, auxiliares) o da por retiradas: salen marcadas «sin TF» o «retirada según TF»">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Solo activas en Forever
          {onlyActive && hiddenInactive > 0 ? <small className="muted"> ({hiddenInactive} ocultas)</small> : null}
        </label>
        <span className="muted small">
          {rows.length} habilidades · pasa el cursor por una para ver todo (Ctrl = base sin mejoras; clic para fijar la tarjeta)
        </span>
      </div>
      <div className="ab-scroll">
        <table className="stats-table ab-table">
          <thead>
            <tr>
              <th scope="col">Habilidad</th>
              <th scope="col">Coste</th>
              <th scope="col">Lanzamiento</th>
              <th scope="col">Reutilización</th>
              <th scope="col">Alcance</th>
              <th scope="col">Efecto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <Row
                key={d.ability.name}
                d={d}
                selected={pin?.name === d.ability.name}
                onHover={(pos) => setHover(pos ? { name: d.ability.name, ...pos } : null)}
                onToggle={(pos) => setPin((p) => (p?.name === d.ability.name ? null : { name: d.ability.name, ...pos }))}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="muted small">Ninguna habilidad está afectada por tus talentos todavía. Elige talentos en el paso anterior o desmarca «Solo las afectadas por mis talentos» para ver todas.</p>
        )}
      </div>
      <p className="muted small">
        <span className="tag tag-unassigned">Cliente</span> Cifras de los hechizos de la beta con el valor del rango al nivel elegido. En azul lo que cambian tus talentos; el número junto al nombre cuenta los efectos de
        talentos, Legacy y raza que le afectan. Los talentos que dan una habilidad activa (Poder Arcano, Presencia mental…) no cuentan porque solo valen mientras está activa. El poder con hechizos aún no se suma: depende de
        las estadísticas de Forever, que no están en el cliente.
      </p>
      {shown && tipRow && <AbilityCard tip={{ row: tipRow, x: shown.x, y: shown.y, pinned: !!pin }} base={ctrl} onClose={() => setPin(null)} chancesInput={formulas ? { formulas, stats: baseStats, classStats, target, level, classId: idx.data.classId } : null} />}
    </>
  );
}
