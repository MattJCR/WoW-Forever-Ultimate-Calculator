import {
  GEAR_SLOTS,
  SLOT_LABEL,
  canEquip,
  compareGear,
  enchantFits,
  equipItem,
  ratingPercents,
  slotsForItem,
  suffixOptions,
  suffixStats,
  type GearComparison,
  type GearContext,
  type GearData,
  type GearSelection,
  type GearSlot,
  type GearSummary,
} from "@wfuc/engine";
import type { CombatRatings, Item } from "@wfuc/schema";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useGearBundle, type Async, type GearBundle } from "../data";
import { fitCardToViewport } from "./fit";
import {
  BONDING,
  EFFECT_PREFIX,
  INVENTORY_LABEL,
  QUALITY_NAMES,
  SLOT_ORDER_BOTTOM,
  SLOT_ORDER_LEFT,
  SLOT_ORDER_RIGHT,
  allowedClassNames,
  itemTypeLabel,
  qualityColor,
  shortStats,
  statLine,
  statName,
} from "./gear-format";
import { Icon } from "./Icon";

const fmt = (n: number): string => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Tip {
  item: Item;
  slot: GearSlot | null;
  enchantId?: number | null;
  suffixId?: number | null;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tarjeta de objeto

function ItemCard({ tip, data, ctx, gear }: { tip: Tip; data: GearData; ctx: GearContext; gear: GearSelection }) {
  const { item } = tip;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });
  const place = () => {
    const el = ref.current;
    if (!el) return;
    fitCardToViewport(el); // sin scroll: la letra se reduce lo justo para que quepa entera
    const { width: w, height: h } = el.getBoundingClientRect();
    const right = tip.x + 18;
    const left = Math.max(8, Math.min(right + w > window.innerWidth - 8 ? tip.x - w - 18 : right, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(tip.y + 18, window.innerHeight - h - 8));
    setPos((p) => (Math.abs(p.left - left) < 1 && Math.abs(p.top - top) < 1 ? p : { left: Math.round(left), top: Math.round(top) }));
  };
  useLayoutEffect(place, [tip.x, tip.y, tip.item.id, tip.enchantId, tip.suffixId]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const suffix = tip.suffixId ? data.suffixes.get(tip.suffixId) : undefined;
  const enchant = tip.enchantId ? data.enchants.get(tip.enchantId) : undefined;
  const set = item.itemSetId !== null ? data.sets.find((s) => s.id === item.itemSetId) : undefined;
  const wornInSet = set ? new Set(GEAR_SLOTS.map((s) => gear[s]?.itemId).filter((id): id is number => !!id && set.itemIds.includes(id))) : new Set<number>();
  if (set && tip.slot && gear[tip.slot]?.itemId !== item.id) wornInSet.add(item.id); // en la lista: cuenta como si se pusiera
  const classes = allowedClassNames(item.allowableClass);
  const check = tip.slot ? canEquip(item, tip.slot, ctx, data) : null;
  const typeLabel = itemTypeLabel(item);
  const style: CSSProperties = { left: pos.left, top: pos.top };
  const suffixLines = suffix ? suffixStats(item, suffix) : [];
  // Antes / después: solo para un objeto de la lista distinto del que llevas en esa ranura
  const cmp = useMemo(() => (tip.slot ? compareGear(gear, tip.slot, item, ctx, data) : null), [gear, tip.slot, item, ctx, data]);
  const wornName = tip.slot && gear[tip.slot] ? data.items.get(gear[tip.slot]!.itemId)?.name : undefined;

  return (
    <div ref={ref} className="ab-card item-card" style={style} role="tooltip">
      <h4 className="item-name" style={{ color: qualityColor(item.quality) }}>
        {item.name}
        {suffix ? ` ${suffix.name}` : ""}
      </h4>
      <p className="item-line muted">
        Nivel de objeto {item.itemLevel} · {QUALITY_NAMES[item.quality] ?? "Común"}
      </p>
      {(BONDING[item.bonding] || item.maxCount === 1) && (
        <p className="item-line">
          {BONDING[item.bonding]}
          {item.maxCount === 1 ? `${BONDING[item.bonding] ? " · " : ""}Único` : ""}
        </p>
      )}
      <p className="item-line item-type">
        <span>{INVENTORY_LABEL[item.inventoryType] ?? "—"}</span>
        <span>{typeLabel ?? ""}</span>
      </p>
      {item.weapon && (
        <p className="item-line">
          {fmt(Math.floor(item.weapon.min))} – {fmt(Math.ceil(item.weapon.max))} de daño · velocidad {fmt(item.weapon.speed)}
          <br />
          <span className="muted">({fmt(item.weapon.dps)} de daño por segundo)</span>
          {item.weapon.confidence === "estimated" && <span className="tag tag-unassigned item-tag">estimación</span>}
        </p>
      )}
      {item.casterWeapon && <p className="item-line muted">Arma de lanzador: Forever le aplica un modificador de daño que las tablas no reproducen exacto.</p>}
      {item.armor ? <p className="item-line">{fmt(Math.round(item.armor))} de armadura</p> : null}
      {item.stats.length > 0 && (
        <ul className="item-stats">
          {item.stats.map((s, i) => (
            <li key={i}>{statLine(s)}</li>
          ))}
        </ul>
      )}
      {item.randomSuffixSet !== null && !suffix && <p className="item-line muted">Lleva un sufijo aleatorio: elígelo en el panel de la ranura.</p>}
      {suffixLines.length > 0 && (
        <ul className="item-stats good">
          {suffixLines.map((s, i) => (
            <li key={i}>{statLine(s)}</li>
          ))}
          <li className="muted small">Cifras del sufijo: estimación (redondeo hacia abajo, sin confirmar en el juego).</li>
        </ul>
      )}
      {enchant && <p className="item-line good">{enchant.name}</p>}
      {item.effects.map((e, i) => (
        <p key={i} className="item-line good">
          {EFFECT_PREFIX[e.trigger] ?? "Efecto"}: {e.text || e.name || `hechizo ${e.spellId}`}
          {!e.textComplete && <span className="muted small"> (texto incompleto)</span>}
        </p>
      ))}
      {set && (
        <div className="item-set">
          <p className="item-line gold">
            {set.name} ({wornInSet.size}/{set.itemIds.length})
          </p>
          <ul>
            {set.bonuses.map((b) => (
              <li key={b.spellId} className={wornInSet.size >= b.threshold ? "good" : "muted"}>
                ({b.threshold}) {b.text || b.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {cmp && <CompareBlock cmp={cmp} wornName={wornName} />}
      <p className="item-line muted">
        {item.requiredLevel > 0 ? `Requiere nivel ${item.requiredLevel}` : "Sin nivel mínimo"}
        {classes ? ` · Clases: ${classes.join(", ")}` : ""}
      </p>
      {check && !check.ok && (
        <ul className="item-reasons">
          {check.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {item.provenance === "community" && <p className="item-line muted small">Objeto de la comunidad (comunidad): el cliente no lo trae.</p>}
    </div>
  );
}

/** «Si lo pones»: diferencia de estadísticas, armadura, arma y conjuntos frente a lo que llevas (verde sube, rojo baja). */
function CompareBlock({ cmp, wornName }: { cmp: GearComparison; wornName: string | undefined }) {
  const signed = (n: number): string => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
  const rows: { text: string; up: boolean }[] = [];
  if (cmp.armor.before !== cmp.armor.after) rows.push({ text: `${signed(cmp.armor.after - cmp.armor.before)} de armadura`, up: cmp.armor.after > cmp.armor.before });
  if (cmp.weaponDps.before !== cmp.weaponDps.after) rows.push({ text: `${signed(Math.round((cmp.weaponDps.after - cmp.weaponDps.before) * 100) / 100)} de daño por segundo del arma`, up: cmp.weaponDps.after > cmp.weaponDps.before });
  for (const d of cmp.stats) rows.push({ text: `${signed(d.after - d.before)} ${statName(d.key)}`, up: d.after > d.before });
  return (
    <div className="item-compare">
      <p className="item-line gold">{wornName ? `Si lo pones en lugar de ${wornName}` : "Si lo pones en esta ranura vacía"}</p>
      {rows.length === 0 && cmp.sets.length === 0 ? (
        <p className="item-line muted">No cambia ninguna estadística.</p>
      ) : (
        <ul className="item-stats">
          {rows.map((r) => (
            <li key={r.text} className={r.up ? "good" : "bad"}>
              {r.text}
            </li>
          ))}
          {cmp.sets.map((s) => (
            <li key={s.name} className={s.activeAfter >= s.activeBefore ? "good" : "bad"}>
              {s.name}: {s.countBefore} → {s.countAfter} de {s.total} piezas ({s.activeAfter - s.activeBefore >= 0 ? "+" : "−"}
              {Math.abs(s.activeAfter - s.activeBefore)} bonos)
            </li>
          ))}
        </ul>
      )}
      <p className="item-line muted small">Sin sufijo ni encantamiento; se pierden los del objeto actual.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Ranuras y selector

function SlotButton({ slot, gear, data, problem, selected, onSelect, onTip }: { slot: GearSlot; gear: GearSelection; data: GearData; problem: boolean; selected: boolean; onSelect: () => void; onTip: (t: Omit<Tip, "x" | "y"> & { x: number; y: number } | null) => void }) {
  const worn = gear[slot];
  const item = worn ? data.items.get(worn.itemId) : undefined;
  const enchant = worn?.enchantId ? data.enchants.get(worn.enchantId) : undefined;
  const suffix = worn?.suffixId ? data.suffixes.get(worn.suffixId) : undefined;
  return (
    <button
      type="button"
      className={`gear-slot${selected ? " on" : ""}${problem ? " problem" : ""}${worn && !item ? " missing" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={(e) => item && onTip({ item, slot, enchantId: worn?.enchantId, suffixId: worn?.suffixId, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => item && onTip({ item, slot, enchantId: worn?.enchantId, suffixId: worn?.suffixId, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onTip(null)}
    >
      <span className="gear-icon" style={item ? { borderColor: qualityColor(item.quality) } : undefined}>
        {item ? <Icon id={item.iconFileDataId} name={item.name} /> : <span className="gear-empty">{SLOT_LABEL[slot].slice(0, 3)}</span>}
      </span>
      <span className="gear-slot-text">
        <small>{SLOT_LABEL[slot]}</small>
        {item ? (
          <b style={{ color: qualityColor(item.quality) }}>
            {item.name}
            {suffix ? ` ${suffix.name}` : ""}
          </b>
        ) : worn ? (
          <b className="bad">Objeto {worn.itemId}: ya no existe</b>
        ) : (
          <span className="muted">vacía</span>
        )}
        {enchant && <small className="good">{enchant.name}</small>}
      </span>
    </button>
  );
}

function SlotPanel({
  slot,
  gear,
  data,
  ctx,
  onEquip,
  onClear,
  onExtra,
  onTip,
}: {
  slot: GearSlot;
  gear: GearSelection;
  data: GearData;
  ctx: GearContext;
  onEquip: (item: Item) => void;
  onClear: () => void;
  onExtra: (extra: { enchantId?: number | null; suffixId?: number | null }) => void;
  onTip: (t: Tip | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [minQuality, setMinQuality] = useState(0);
  const [onlyWearable, setOnlyWearable] = useState(true);
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [slot, query, minQuality, onlyWearable]);

  const worn = gear[slot];
  const wornItem = worn ? data.items.get(worn.itemId) : undefined;

  // Todos los objetos que caben en la ranura, del mas alto nivel al mas bajo (se calcula una vez por ranura)
  const candidates = useMemo(
    () => [...data.items.values()].filter((i) => !i.placeholder && slotsForItem(i).includes(slot)).sort((a, b) => b.itemLevel - a.itemLevel || b.quality - a.quality || a.name.localeCompare(b.name, "es")),
    [data, slot],
  );
  const unavailable = useMemo(() => data.unavailable.filter((u) => slotsForItem(u).includes(slot)).length, [data, slot]);
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return candidates.filter((i) => i.quality >= minQuality && (q === "" || norm(i.name).includes(q)) && (!onlyWearable || canEquip(i, slot, ctx, data).ok));
  }, [candidates, query, minQuality, onlyWearable, ctx, data, slot]);

  const enchants = useMemo(() => (wornItem ? [...data.enchants.values()].filter((e) => enchantFits(e, slot, wornItem)).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, "es")) : []), [data, slot, wornItem]);
  const suffixes = wornItem ? suffixOptions(wornItem, data) : [];

  return (
    <section className="slot-panel" aria-label={`Ranura ${SLOT_LABEL[slot]}`}>
      <div className="panel-head">
        <h3>{SLOT_LABEL[slot]}</h3>
        <span className="left">
          {filtered.length} de {candidates.length} objetos
        </span>
      </div>
      {worn && (
        <div className="slot-current">
          {wornItem ? (
            <>
              <b style={{ color: qualityColor(wornItem.quality) }}>{wornItem.name}</b>
              <button type="button" onClick={onClear}>
                Quitar
              </button>
              <label>
                Encantamiento
                <select value={worn.enchantId ?? ""} onChange={(e) => onExtra({ enchantId: e.target.value ? Number(e.target.value) : null })} disabled={enchants.length === 0}>
                  <option value="">{enchants.length === 0 ? "ninguno disponible" : "sin encantamiento"}</option>
                  {enchants.map((e) => (
                    <option key={e.effectId} value={e.effectId}>
                      {e.name}
                      {e.level ? ` (nivel ${e.level})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {suffixes.length > 0 && (
                <label>
                  Sufijo aleatorio
                  <select value={worn.suffixId ?? ""} onChange={(e) => onExtra({ suffixId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">sin sufijo</option>
                    {suffixes.map((id) => {
                      const s = data.suffixes.get(id);
                      return s ? (
                        <option key={id} value={id}>
                          {s.name} — {suffixStats(wornItem, s).map(statLine).join(", ")}
                        </option>
                      ) : null;
                    })}
                  </select>
                  <small className="muted">Nombres: traducción propia. Cifras: estimación.</small>
                </label>
              )}
            </>
          ) : (
            <>
              <b className="bad">El objeto {worn.itemId} del enlace ya no existe en los datos.</b>
              <button type="button" onClick={onClear}>
                Quitar
              </button>
            </>
          )}
        </div>
      )}
      <div className="slot-filters">
        <input type="search" placeholder="Buscar por nombre…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar objeto" />
        <label>
          Calidad mínima
          <select value={minQuality} onChange={(e) => setMinQuality(Number(e.target.value))}>
            {QUALITY_NAMES.slice(0, 5).map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyWearable} onChange={(e) => setOnlyWearable(e.target.checked)} /> Solo los que puede llevar mi personaje
        </label>
      </div>
      <ul className="item-list">
        {filtered.slice(0, limit).map((i) => {
          const check = onlyWearable ? null : canEquip(i, slot, ctx, data);
          return (
            <li key={i.id}>
              <button
                type="button"
                className={`item-row${worn?.itemId === i.id ? " on" : ""}`}
                onClick={() => onEquip(i)}
                onMouseEnter={(e) => onTip({ item: i, slot, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => onTip({ item: i, slot, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => onTip(null)}
              >
                <span className="gear-icon small" style={{ borderColor: qualityColor(i.quality) }}>
                  <Icon id={i.iconFileDataId} name={i.name} />
                </span>
                <span className="item-row-text">
                  <b style={{ color: qualityColor(i.quality) }}>{i.name}</b>
                  <small className="muted">
                    nivel {i.requiredLevel} · objeto {i.itemLevel}
                    {itemTypeLabel(i) ? ` · ${itemTypeLabel(i)}` : ""}
                    {i.randomSuffixSet !== null ? " · sufijo aleatorio" : ""}
                  </small>
                  {i.stats.length > 0 && <small className="item-row-stats">{shortStats(i.stats)}</small>}
                  {check && !check.ok && <small className="bad">{check.reasons[0]}</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 && <p className="muted">Ningún objeto cumple los filtros.</p>}
      {filtered.length > limit && (
        <button type="button" className="more" onClick={() => setLimit((l) => l + 120)}>
          Mostrar más ({filtered.length - limit} restantes)
        </button>
      )}
      {unavailable > 0 && (
        <p className="muted small">
          <span className="tag tag-inactive">datos incompletos</span> Para esta ranura existen otros {unavailable.toLocaleString("es-ES")} objetos que el cliente no trae con nombre ni estadísticas (llegan por hotfix al verlos en el juego): no se pueden ofrecer.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Paso Equipo

export function GearStep({
  bundle,
  gear,
  setGear,
  ctx,
  setLevel,
  summary,
  raceName,
}: {
  bundle: Async<GearBundle> | null;
  gear: GearSelection;
  setGear: (update: (g: GearSelection) => GearSelection) => void;
  ctx: GearContext;
  setLevel: (n: number) => void;
  summary: GearSummary | null;
  raceName: string | null;
}) {
  const [slot, setSlot] = useState<GearSlot | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  if (!bundle || bundle.status === "loading") return <p className="status">Cargando objetos y encantamientos (unos 7 MB, solo la primera vez)…</p>;
  if (bundle.status === "error") return <p className="status error">{bundle.message}</p>;
  const { data, ratings, partial } = bundle.value;
  const problems = new Map((summary?.problems ?? []).map((p) => [p.slot, p]));
  const count = Object.keys(gear).length;
  const slotButton = (s: GearSlot) => (
    <SlotButton key={s} slot={s} gear={gear} data={data} problem={problems.has(s)} selected={slot === s} onSelect={() => setSlot((cur) => (cur === s ? null : s))} onTip={setTip} />
  );

  return (
    <section className="gear-step" aria-label="Equipo">
      <div className="panel-head">
        <h3>Equipo</h3>
        <span className="left">
          Ranuras con objeto <b>{count}</b>/{GEAR_SLOTS.length}
        </span>
        <span className="lvl">
          <label className="gear-level">
            Nivel del personaje
            <input type="number" min={1} max={60} value={ctx.level} onChange={(e) => setLevel(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          </label>
          <button type="button" onClick={() => setGear(() => ({}))} disabled={count === 0}>
            Quitar todo el equipo
          </button>
        </span>
      </div>
      <p className="muted small">
        Pasa el cursor por un objeto para ver su tarjeta. {ctx.raceId > 0 ? `Raza: ${raceName ?? ctx.raceId}.` : "Sin raza elegida: no se comprueban las restricciones de raza."} Objetos, armadura y daño de arma salen del cliente de la beta; encantamientos, sufijos aleatorios y puntuaciones, de la comunidad.
        {partial && " Faltan datos de la comunidad (encantamientos, sufijos o puntuaciones)."}
      </p>

      <div className="gear-layout">
        <div className="doll">
          <div className="doll-col">{SLOT_ORDER_LEFT.map(slotButton)}</div>
          <div className="doll-col">{SLOT_ORDER_RIGHT.map(slotButton)}</div>
          <div className="doll-bottom">{SLOT_ORDER_BOTTOM.map(slotButton)}</div>
        </div>
        {slot ? (
          <SlotPanel
            slot={slot}
            gear={gear}
            data={data}
            ctx={ctx}
            onEquip={(item) => {
              setGear((g) => equipItem(g, slot, item, data.items));
              setTip(null);
            }}
            onClear={() => setGear((g) => Object.fromEntries(Object.entries(g).filter(([k]) => k !== slot)))}
            onExtra={(extra) => setGear((g) => (g[slot] ? { ...g, [slot]: { ...g[slot]!, ...extra } } : g))}
            onTip={setTip}
          />
        ) : (
          <p className="muted slot-hint">Elige una ranura para ver los objetos que caben en ella, sus encantamientos y sufijos.</p>
        )}
      </div>

      {summary && <GearTotals summary={summary} ratings={ratings} tips={{ gear, data, onTip: setTip }} />}
      {tip && <ItemCard tip={tip} data={data} ctx={ctx} gear={gear} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Totales (paso Equipo y Resumen)

const STAT_ORDER = ["strength", "agility", "stamina", "intellect", "spirit"];
const statRank = (key: string): number => {
  const i = STAT_ORDER.indexOf(key);
  return i === -1 ? STAT_ORDER.length : i;
};

/** Para que los objetos citados en los totales enseñen su tarjeta al pasar el cursor, igual que en las ranuras. */
const ORIGIN_LABEL: Record<string, string> = { item: "", suffix: " (sufijo)", enchant: " (encantamiento)", set: " (conjunto)", effect: " (efecto del objeto)" };

export interface TotalsTips {
  gear: GearSelection;
  data: GearData;
  onTip: (t: Tip | null) => void;
}

export function GearTotals({ summary, ratings, tips }: { summary: GearSummary; ratings: CombatRatings | null; tips?: TotalsTips }) {
  // Manejadores de cursor de lo que nombra el objeto de una ranura (tarjeta del objeto con su sufijo y encantamiento)
  const hover = (slot: GearSlot | null) => {
    const worn = slot ? tips?.gear[slot] : undefined;
    const item = worn ? tips?.data.items.get(worn.itemId) : undefined;
    if (!tips || !worn || !item) return {};
    const show = (e: { clientX: number; clientY: number }) => tips.onTip({ item, slot, enchantId: worn.enchantId, suffixId: worn.suffixId, x: e.clientX, y: e.clientY });
    return { onMouseEnter: show, onMouseMove: show, onMouseLeave: () => tips.onTip(null) };
  };
  const sortedLines = [...summary.lines].filter((l) => l.key !== "extra-armor").sort((a, b) => statRank(a.key) - statRank(b.key) || statName(a.key).localeCompare(statName(b.key), "es"));
  const percents = ratings ? ratingPercents(summary.stats, ratings) : [];
  const armor = summary.armor + (summary.stats["extra-armor"] ?? 0);
  const empty = summary.lines.length === 0 && summary.weapons.length === 0 && summary.armor === 0;
  if (empty && summary.problems.length === 0 && summary.missing.length === 0) return <p className="muted">Aún no llevas ningún objeto con estadísticas.</p>;
  return (
    <div className="gear-totals">
      <h4>Lo que suma tu equipo</h4>
      {summary.missing.length > 0 && (
        <p className="gear-warn">
          {summary.missing.length} {summary.missing.length === 1 ? "objeto del enlace ya no existe" : "objetos del enlace ya no existen"} en los datos (un hotfix los quitó o el enlace es de otro parche):{" "}
          {summary.missing.map((m) => `${SLOT_LABEL[m.slot]} (${m.itemId})`).join(", ")}.
        </p>
      )}
      {summary.problems.length > 0 && (
        <ul className="gear-warn">
          {summary.problems.map((p) => (
            <li key={p.slot} {...hover(p.slot)}>
              <b>{SLOT_LABEL[p.slot]}</b>: {p.reasons.join("; ")}. Se sigue sumando.
            </li>
          ))}
        </ul>
      )}
      {armor > 0 && (
        <p>
          Armadura: <b>{fmt(Math.round(armor))}</b>
          {summary.stats["extra-armor"] ? <small className="muted"> ({fmt(Math.round(summary.armor))} de las piezas + {fmt(summary.stats["extra-armor"])} extra)</small> : null}
        </p>
      )}
      {sortedLines.length > 0 && (
        <table className="stats-table gear-stats">
          <thead>
            <tr>
              <th scope="col">Estadística</th>
              <th scope="col">Total</th>
              <th scope="col">Procede de</th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.map((l) => (
                <tr key={l.key}>
                  <th scope="row">{statName(l.key)}</th>
                  <td>
                    <b>{fmt(l.value)}</b>
                  </td>
                  <td>
                    {l.sources.map((s, i) => (
                      <span key={i} className="chip chip-info" {...hover(s.slot)}>
                        {s.slot ? SLOT_LABEL[s.slot] : s.itemName} {s.value > 0 ? "+" : ""}
                        {s.value}
                        {ORIGIN_LABEL[s.origin]}
                      </span>
                    ))}
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      )}
      {percents.length > 0 && (
        <>
          <h5 className="fx-sub">Puntuaciones convertidas</h5>
          <table className="stats-table">
            <tbody>
              {percents.map((r) => (
                <tr key={r.stat}>
                  <th scope="row">{r.label}</th>
                  <td>
                    <b>{r.unit === "%" ? `${fmt(r.value)} %` : fmt(r.value)}</b> <small className="muted">({fmt(r.rating)} ÷ {fmt(r.perUnit)})</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            <span className="tag tag-unassigned">la comunidad · estimación</span> Forever tiene una sola puntuación de impacto, de crítico y de celeridad, constantes en todos los niveles (medidas por la comunidad, sin confirmar por nosotros). El impacto y el crítico ya entran en las probabilidades de cada habilidad; el poder de ataque y con hechizos salen aparte en «Con tu poder» de cada habilidad (estimación de Classic).
          </p>
        </>
      )}
      {summary.weapons.length > 0 && (
        <>
          <h5 className="fx-sub">Armas</h5>
          <ul className="effects">
            {summary.weapons.map((w) => (
              <li key={w.slot} {...hover(w.slot)}>
                <b>{SLOT_LABEL[w.slot]}</b>: {w.itemName} · {fmt(Math.floor(w.min))} – {fmt(Math.ceil(w.max))} · velocidad {fmt(w.speed)} · {fmt(w.dps)} de daño por segundo
                {w.confidence === "estimated" && <span className="tag tag-unassigned item-tag">estimación</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.sets.length > 0 && (
        <>
          <h5 className="fx-sub">Conjuntos</h5>
          {summary.sets.map((s) => (
            <div key={s.setId} className="gear-set">
              <b>
                {s.name} ({s.count}/{s.total})
              </b>
              <ul>
                {s.bonuses.map((b) => (
                  <li key={b.threshold + b.name} className={b.active ? "good" : "muted"}>
                    ({b.threshold}) {b.text || b.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="muted small">Los bonos de conjunto y efectos de objeto que son una cifra (atributos, poder, puntuaciones, porcentajes) ya se suman; los demás (procs, efectos con condición) son texto del cliente.</p>
        </>
      )}
      {summary.effects.length > 0 && (
        <>
          <h5 className="fx-sub">Efectos de objetos</h5>
          <ul className="effects">
            {summary.effects.map((e, i) => (
              <li key={i} {...hover(e.slot)}>
                <b>{e.itemName}</b> · {EFFECT_PREFIX[e.effect.trigger] ?? "Efecto"}: {e.effect.text || e.effect.name || `hechizo ${e.effect.spellId}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.incomplete && <p className="muted small">Algún objeto viene de la comunidad sin estadísticas: su aporte falta.</p>}
    </div>
  );
}

/** Carga los datos de equipo en cuanto hacen falta (paso Equipo o un enlace con equipo). */
export { useGearBundle };
