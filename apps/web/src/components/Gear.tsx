import {
  GEAR_SLOTS,
  SLOT_LABEL,
  canEquip,
  compareGear,
  enchantFits,
  enchantNotes,
  itemTypeName,
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
import type { CombatRatings, Enchant, Item } from "@wfuc/schema";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useGearBundle, type Async, type GearBundle } from "../data";
import { fmtNum, isEnglish, tr, trn } from "../i18n";
import { fitCardToViewport } from "./fit";
import {
  QUALITY_NAMES,
  SLOT_ORDER_BOTTOM,
  SLOT_ORDER_LEFT,
  SLOT_ORDER_RIGHT,
  allowedClassNames,
  bondingLabel,
  effectLabel,
  effectPrefix,
  iName,
  inventoryLabel,
  itemTypeLabel,
  nameOf,
  qualityColor,
  qualityName,
  setLabel,
  slotLabel,
  sourceLines,
  statLine,
  statName,
} from "./gear-format";
import type { Avatar } from "../viewer/avatar";
import { AvatarPanel, type AvatarRace } from "./AvatarPanel";
import { SlotGlyph } from "./glyphs";
import { ItemGallery, useAppearance } from "./ItemGallery";
import { Icon } from "./Icon";

const fmt = (n: number): string => fmtNum(n, 2);
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
  const wornItemData = tip.slot && gear[tip.slot] ? data.items.get(gear[tip.slot]!.itemId) : undefined;
  const wornName = wornItemData ? iName(wornItemData) : undefined;
  // Con comparación la tarjeta se reparte en dos columnas (objeto | «si lo pones») y el conjunto va debajo a todo el ancho, en lugar de alargarse
  const side = !!cmp;

  return (
    <div ref={ref} className={`ab-card item-card${side ? " two-col" : ""}`} style={style} role="tooltip">
      <div className="item-col">
      <h4 className="item-name" style={{ color: qualityColor(item.quality) }}>
        {iName(item)}
        {suffix ? ` ${nameOf(suffix)}` : ""}
      </h4>
      <p className="item-line muted">
       {tr("Nivel de objeto")} {item.itemLevel} · {qualityName(item.quality)}
      </p>
      {(bondingLabel(item.bonding) || item.maxCount === 1 || item.uniqueEquipped) && (
        <p className="item-line">
          {bondingLabel(item.bonding)}
          {item.maxCount === 1 || item.uniqueEquipped ? `${bondingLabel(item.bonding) ? " · " : ""}${item.maxCount === 1 ? tr("Único") : tr("Único-Equipado")}` : ""}
        </p>
      )}
      <p className="item-line item-type">
        <span>{inventoryLabel(item.inventoryType)}</span>
        <span>{typeLabel ?? ""}</span>
      </p>
      {item.weapon && (
        <p className="item-line">
          {fmt(Math.floor(item.weapon.min))} – {fmt(Math.ceil(item.weapon.max))} {tr("de daño · velocidad")} {fmt(item.weapon.speed)}
          <br />
          <span className="muted">({fmt(item.weapon.dps)} {tr("de daño por segundo")})</span>
          {item.weapon.confidence === "estimated" && <span className="tag tag-unassigned item-tag">{tr("estimación")}</span>}
        </p>
      )}
      {item.casterWeapon && <p className="item-line muted">{tr("Arma de lanzador: el cliente le aplica un daño reducido (2/3 a una mano, 29/39 a dos manos) y puede llevar poder con hechizos propio.")}</p>}
      {item.armor ? <p className="item-line">{fmt(Math.round(item.armor))} {tr("de armadura")}</p> : null}
      {item.stats.length > 0 && (
        <ul className="item-stats">
          {item.stats.map((s, i) => (
            <li key={i}>{statLine(s)}</li>
          ))}
        </ul>
      )}
      {item.randomSuffixSet !== null && !suffix && <p className="item-line muted">{tr("Lleva un sufijo aleatorio: elígelo en el panel de la ranura.")}</p>}
      {suffixLines.length > 0 && (
        <ul className="item-stats good">
          {suffixLines.map((s, i) => (
            <li key={i}>{statLine(s)}</li>
          ))}
          <li className="muted small">{tr("Cifras del sufijo: estimación (redondeo hacia abajo, sin confirmar en el juego).")}</li>
        </ul>
      )}
      {enchant && <p className="item-line good">{nameOf(enchant)}</p>}
      {enchant && <EnchantNotes enchant={enchant} />}
      {item.effects.map((e, i) => (
        <p key={i} className="item-line good">
          {effectPrefix(e.trigger)}: {effectLabel(e)}
          {!e.textComplete && <span className="muted small"> {tr("(texto incompleto)")}</span>}
        </p>
      ))}
      {sourceLines(data.sources.get(item.id) ?? []).map((line) => (
        <p key={line} className="item-line muted">
          {line}
        </p>
      ))}
      <p className="item-line muted">
        {item.requiredLevel > 0 ? tr("Requiere nivel {n}", { n: item.requiredLevel }) : tr("Sin nivel mínimo")}
        {classes ? ` · ${tr("Clases:")} ${classes.join(", ")}` : ""}
      </p>
      {check && !check.ok && (
        <ul className="item-reasons">
          {check.reasons.map((r) => (
            <li key={r}>{trn(r)}</li>
          ))}
        </ul>
      )}
      {item.provenance === "community" && <p className="item-line muted small">{tr("Objeto de la comunidad (comunidad): el cliente no lo trae.")}</p>}
      </div>
      {cmp && (
        <div className="item-col item-side">
          <CompareBlock cmp={cmp} wornName={wornName} />
        </div>
      )}
      {set && (
        <div className="item-set">
          <div className="item-set-head">
            <p className="item-line gold">{setLabel(set)}</p>
            <b>
              {wornInSet.size}
              <small>/{set.itemIds.length}</small>
            </b>
          </div>
          <div className="set-pips" aria-hidden="true">
            {set.itemIds.map((id) => (
              <i key={id} className={wornInSet.has(id) ? "on" : ""} />
            ))}
          </div>
          <div className="item-set-body">
            <ul className="item-set-pieces">
              {set.itemIds.map((id) => {
                const piece = data.items.get(id);
                return (
                  <li key={id} className={wornInSet.has(id) ? "on" : ""}>
                    {piece ? iName(piece) : `#${id}`}
                  </li>
                );
              })}
            </ul>
            <ul className="set-bonus-list">
              {set.bonuses.map((b) => (
                <li key={b.spellId} className={wornInSet.size >= b.threshold ? "good active" : "muted"}>
                  <span className="set-th">{b.threshold}</span>
                  <span>{effectLabel(b)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Avisos de un encantamiento: el nombre del cliente no trae la cifra de su efecto, o la cifra es de la comunidad porque el cliente no la detalla. */
function EnchantNotes({ enchant }: { enchant: Enchant }) {
  const notes = enchantNotes(enchant);
  return (
    <>
      {notes.nameDiffers && <p className="item-line muted small">{tr("El nombre del cliente dice {a}, pero su efecto da {b}: se usa la cifra del efecto (la comunidad coincide).", { a: notes.nameDiffers.nameValue, b: notes.nameDiffers.effectValue })}</p>}
      {notes.fromCommunity && <p className="item-line muted small">{tr("Parte de las cifras del encantamiento es de la comunidad: el cliente no detalla su efecto.")}</p>}
    </>
  );
}

const signed = (n: number): string => `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;

/** «Si lo pones»: diferencia de estadísticas, armadura, arma y conjuntos frente a lo que llevas (verde sube, rojo baja). */
function CompareBlock({ cmp, wornName }: { cmp: GearComparison; wornName: string | undefined }) {
  const rows: { text: string; up: boolean }[] = [];
  if (cmp.armor.before !== cmp.armor.after) rows.push({ text: `${signed(cmp.armor.after - cmp.armor.before)} ${tr("de armadura")}`, up: cmp.armor.after > cmp.armor.before });
  if (cmp.weaponDps.before !== cmp.weaponDps.after) rows.push({ text: `${signed(Math.round((cmp.weaponDps.after - cmp.weaponDps.before) * 100) / 100)} ${tr("de daño por segundo del arma")}`, up: cmp.weaponDps.after > cmp.weaponDps.before });
  for (const d of cmp.stats) rows.push({ text: `${signed(d.after - d.before)} ${statName(d.key)}`, up: d.after > d.before });
  return (
    <div className="item-compare">
      <p className="item-line gold">{wornName ? tr("Si lo pones en lugar de {name}", { name: wornName }) : tr("Si lo pones en esta ranura vacía")}</p>
      {rows.length === 0 && cmp.sets.length === 0 ? (
        <p className="item-line muted">{tr("No cambia ninguna estadística.")}</p>
      ) : (
        <ul className="item-stats">
          {rows.map((r) => (
            <li key={r.text} className={r.up ? "good" : "bad"}>
              {r.text}
            </li>
          ))}
          {cmp.sets.map((s) => (
            <li key={s.name} className={s.activeAfter >= s.activeBefore ? "good" : "bad"}>
              {setLabel(s)}: {s.countBefore} → {s.countAfter} {tr("de")} {s.total} {tr("piezas")} ({s.activeAfter - s.activeBefore >= 0 ? "+" : "−"}
              {Math.abs(s.activeAfter - s.activeBefore)} {tr("bonos")})
            </li>
          ))}
        </ul>
      )}
      <p className="item-line muted small">{tr("Sin sufijo ni encantamiento; se pierden los del objeto actual.")}</p>
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
      <span className={`gear-icon${item ? "" : " empty"}`} style={item ? { borderColor: qualityColor(item.quality) } : undefined}>
        {item ? <Icon id={item.iconFileDataId} name={iName(item)} /> : <SlotGlyph slot={slot} />}
      </span>
      <span className="gear-slot-text">
        <small>
          {slotLabel(slot)}
          {item && item.itemSetId !== null && <i className="gear-set-dot" role="img" aria-label={tr("Pieza de conjunto")} title={tr("Pieza de conjunto")} />}
          {enchant && (
            <i className="gear-ench" role="img" aria-label={nameOf(enchant)} title={nameOf(enchant)}>
              ✦
            </i>
          )}
        </small>
        {item ? (
          <b style={{ color: qualityColor(item.quality) }} title={`${iName(item)}${suffix ? ` ${nameOf(suffix)}` : ""}`}>
            {iName(item)}
            {suffix ? ` ${nameOf(suffix)}` : ""}
          </b>
        ) : worn ? (
          <b className="bad">{tr("Objeto")} {worn.itemId}: {tr("ya no existe")}</b>
        ) : (
          <span className="muted">{tr("vacía")}</span>
        )}
      </span>
    </button>
  );
}

/** Una fila de la lista de objetos de la ranura: icono, nombre y nivel; las cifras y lo que cambia salen en la tarjeta al pasar el cursor. */
const ItemRow = memo(function ItemRow({ item: i, slot, ctx, data, wornId, onlyWearable, onEquip, onTip }: { item: Item; slot: GearSlot; ctx: GearContext; data: GearData; wornId: number | undefined; onlyWearable: boolean; onEquip: (item: Item) => void; onTip: (t: Tip | null) => void }) {
  const isWorn = wornId === i.id;
  const check = onlyWearable ? null : canEquip(i, slot, ctx, data);
  return (
    <li>
      <button
        type="button"
        className={`item-row${isWorn ? " on" : ""}`}
        onClick={() => onEquip(i)}
        onMouseEnter={(e) => onTip({ item: i, slot, x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => onTip({ item: i, slot, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => onTip(null)}
      >
        <span className="gear-icon small" style={{ borderColor: qualityColor(i.quality) }}>
          <Icon id={i.iconFileDataId} name={iName(i)} />
        </span>
        <span className="item-row-text">
          <b style={{ color: qualityColor(i.quality) }}>{iName(i)}</b>
          <small className="muted">
            {tr("nivel")} {i.requiredLevel} · {tr("objeto")} {i.itemLevel}
            {itemTypeLabel(i) ? ` · ${itemTypeLabel(i)}` : ""}
            {i.randomSuffixSet !== null ? ` · ${tr("sufijo aleatorio")}` : ""}
          </small>
          {check && !check.ok && <small className="bad">{trn(check.reasons[0]!)}</small>}
        </span>
        {isWorn && <em className="item-row-worn">{tr("Equipado")}</em>}
      </button>
    </li>
  );
});

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
  // Tipo de objeto (tela, cuero, malla, placas, tipo de arma…); vacío = todos
  const [itemType, setItemType] = useState("");
  // Fuente: vacío = todas; «crafted» = fabricados por una profesión
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [slot, query, minQuality, onlyWearable, itemType, source]);
  useEffect(() => { setItemType(""); setSource(""); }, [slot]);
  const [gallery, setGallery] = useState(() => { try { return window.localStorage.getItem("wfuc.gallery") === "1"; } catch { return false; } });
  const appearance = useAppearance(gallery);
  const setView = (g: boolean) => { setGallery(g); try { window.localStorage.setItem("wfuc.gallery", g ? "1" : "0"); } catch { /* solo se pierde la comodidad */ } };

  const worn = gear[slot];
  const wornItem = worn ? data.items.get(worn.itemId) : undefined;

  // Todos los objetos que caben en la ranura, del mas alto nivel al mas bajo (se calcula una vez por ranura)
  const candidates = useMemo(
    () => [...data.items.values()].filter((i) => !i.placeholder && slotsForItem(i).includes(slot)).sort((a, b) => b.itemLevel - a.itemLevel || b.quality - a.quality || a.name.localeCompare(b.name, "es")),
    [data, slot],
  );
  const unavailable = useMemo(() => data.unavailable.filter((u) => slotsForItem(u).includes(slot)).length, [data, slot]);
  const types = useMemo(() => [...new Set(candidates.map((i) => itemTypeName(i)).filter((t): t is string => t !== null))].sort((a, b) => a.localeCompare(b, "es")), [candidates]);
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return candidates.filter((i) => i.quality >= minQuality && (itemType === "" || itemTypeName(i) === itemType) && (source === "" || (data.sources.get(i.id) ?? []).some((e) => e.kind === source)) && (q === "" || norm(i.name).includes(q) || norm(iName(i)).includes(q)) && (!onlyWearable || canEquip(i, slot, ctx, data).ok));
  }, [candidates, query, minQuality, itemType, source, onlyWearable, ctx, data, slot]);

  const enchants = useMemo(() => (wornItem ? [...data.enchants.values()].filter((e) => enchantFits(e, slot, wornItem)).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name, "es")) : []), [data, slot, wornItem]);
  const suffixes = wornItem ? suffixOptions(wornItem, data) : [];

  const wornSuffix = worn?.suffixId ? data.suffixes.get(worn.suffixId) : undefined;
  const wornSet = wornItem && wornItem.itemSetId !== null ? data.sets.find((x) => x.id === wornItem.itemSetId) : undefined;

  return (
    <section className="slot-panel" aria-label={tr("Ranura {name}", { name: slotLabel(slot) })}>
      <div className="slot-head">
        <span className={`gear-icon big${wornItem ? "" : " empty"}`} style={wornItem ? { borderColor: qualityColor(wornItem.quality) } : undefined}>
          {wornItem ? <Icon id={wornItem.iconFileDataId} name={iName(wornItem)} /> : <SlotGlyph slot={slot} />}
        </span>
        <div className="slot-head-text">
          <small className="slot-kicker">
            {tr("Ranura")} · {slotLabel(slot)}
          </small>
          {wornItem ? (
            <>
              <b style={{ color: qualityColor(wornItem.quality) }}>
                {iName(wornItem)}
                {wornSuffix ? ` ${nameOf(wornSuffix)}` : ""}
              </b>
              <small className="muted">
                {itemTypeLabel(wornItem) ? `${itemTypeLabel(wornItem)} · ` : ""}
                {tr("objeto")} {wornItem.itemLevel} · {tr("nivel")} {wornItem.requiredLevel}
                {wornSet ? ` · ${setLabel(wornSet)}` : ""}
              </small>
            </>
          ) : worn ? (
            <b className="bad">
              {tr("El objeto")} {worn.itemId} {tr("del enlace ya no existe en los datos.")}
            </b>
          ) : (
            <b className="muted">{tr("vacía")}</b>
          )}
        </div>
        {worn && (
          <button type="button" className="slot-clear" onClick={onClear}>
            {tr("Quitar")}
          </button>
        )}
      </div>
      {wornItem && (
        <div className="slot-current">
          <label>
            {tr("Encantamiento")}
            <select value={worn!.enchantId ?? ""} onChange={(e) => onExtra({ enchantId: e.target.value ? Number(e.target.value) : null })} disabled={enchants.length === 0}>
              <option value="">{enchants.length === 0 ? tr("ninguno disponible") : tr("sin encantamiento")}</option>
              {enchants.map((e) => (
                <option key={e.effectId} value={e.effectId}>
                  {nameOf(e)}
                  {e.level ? ` (${tr("nivel {n}", { n: e.level })})` : ""}
                </option>
              ))}
            </select>
          </label>
          {suffixes.length > 0 && (
            <label>
              {tr("Sufijo aleatorio")}
              <select value={worn!.suffixId ?? ""} onChange={(e) => onExtra({ suffixId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{tr("sin sufijo")}</option>
                {suffixes.map((id) => {
                  const sf = data.suffixes.get(id);
                  return sf ? (
                    <option key={id} value={id}>
                      {nameOf(sf)} — {suffixStats(wornItem, sf).map(statLine).join(", ")}
                    </option>
                  ) : null;
                })}
              </select>
              <small className="muted">{tr("Nombres: traducción propia. Cifras: estimación.")}</small>
            </label>
          )}
        </div>
      )}
      <div className="slot-filters">
        <input type="search" placeholder={tr("Buscar por nombre…")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={tr("Buscar objeto")} />
        <div className="slot-view" role="group" aria-label={tr("Vista")}>
          <button type="button" className={gallery ? "" : "on"} aria-pressed={!gallery} onClick={() => setView(false)}>{tr("Lista")}</button>
          <button type="button" className={gallery ? "on" : ""} aria-pressed={gallery} onClick={() => setView(true)}>{tr("Galería")}</button>
        </div>
      </div>
      <div className="slot-filters slot-filter-selects">
        {data.sources.size > 0 && (
          <label>
            {tr("Fuente")}
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{tr("todas")}</option>
              <option value="crafted">{tr("Fabricado")}</option>
            </select>
          </label>
        )}
        <label>
          {tr("Calidad mínima")}
          <select value={minQuality} onChange={(e) => setMinQuality(Number(e.target.value))}>
            {QUALITY_NAMES.slice(0, 5).map((n, i) => (
              <option key={n} value={i}>
                {tr(n)}
              </option>
            ))}
          </select>
        </label>
        {types.length > 1 && (
          <label>
            {tr("Tipo")}
            <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
              <option value="">{tr("todos")}</option>
              {types.map((t) => <option key={t} value={t}>{trn(t)}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="slot-filters slot-filters-2">
        <label className="check">
          <input type="checkbox" checked={onlyWearable} onChange={(e) => setOnlyWearable(e.target.checked)} /> {tr("Solo los que puede llevar mi personaje")}
        </label>
        <span className="slot-count muted small">
          {filtered.length} {tr("de")} {candidates.length} {tr("objetos")}
        </span>
      </div>
      <div className="slot-scroll">
      {gallery ? (
        <ItemGallery items={filtered.slice(0, limit)} wornId={worn?.itemId} appearance={appearance} onEquip={onEquip} onTip={(t) => onTip(t ? { item: t.item, slot, x: t.x, y: t.y } : null)} />
      ) : (
        <ul className="item-list">
          {filtered.slice(0, limit).map((i) => (
            <ItemRow key={i.id} item={i} slot={slot} ctx={ctx} data={data} wornId={worn?.itemId} onlyWearable={onlyWearable} onEquip={onEquip} onTip={onTip} />
          ))}
        </ul>
      )}
      {filtered.length === 0 && <p className="muted">{tr("Ningún objeto cumple los filtros.")}</p>}
      {filtered.length > limit && (
        <button type="button" className="more" onClick={() => setLimit((l) => l + 120)}>
          {tr("Mostrar más")} ({filtered.length - limit} {tr("restantes")})
        </button>
      )}
      {unavailable > 0 && (
        <p className="muted small">
          <span className="tag tag-inactive">{tr("datos incompletos")}</span> {tr("Para esta ranura existen otros")} {fmtNum(unavailable)} {tr("objetos que el cliente no trae con nombre ni estadísticas (llegan por hotfix al verlos en el juego): no se pueden ofrecer.")}
        </p>
      )}
      </div>
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
  avatarRaceId,
  avatarRaces,
  avatar,
  setAvatar,
  history,
}: {
  bundle: Async<GearBundle> | null;
  gear: GearSelection;
  setGear: (update: (g: GearSelection) => GearSelection) => void;
  ctx: GearContext;
  setLevel: (n: number) => void;
  summary: GearSummary | null;
  raceName: string | null;
  /** Raza con la que se dibuja el avatar (la elegida o, si no hay, la primera que admite la clase). */
  avatarRaceId: number;
  /** Todas las razas del juego (el probador deja elegir cualquiera con modelo). */
  avatarRaces: AvatarRace[];
  avatar: Avatar;
  setAvatar: (a: Avatar) => void;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
}) {
  const [slot, setSlot] = useState<GearSlot>("head");
  const [tip, setTip] = useState<Tip | null>(null);
  if (!bundle || bundle.status === "loading") return <p className="status">{tr("Cargando objetos y encantamientos (unos 7 MB, solo la primera vez)…")}</p>;
  if (bundle.status === "error") return <p className="status error">{bundle.message}</p>;
  const { data, ratings, partial } = bundle.value;
  const problems = new Map((summary?.problems ?? []).map((p) => [p.slot, p]));
  const count = Object.keys(gear).length;
  const slotButton = (s: GearSlot) => (
    <SlotButton key={s} slot={s} gear={gear} data={data} problem={problems.has(s)} selected={slot === s} onSelect={() => setSlot(s)} onTip={setTip} />
  );

  return (
    <section className="gear-step" aria-label={tr("Equipo")}>
      <div className="panel-head">
        <h3>{tr("Equipo")}</h3>
        <span className="left">
          {tr("Ranuras con objeto")} <b>{count}</b>/{GEAR_SLOTS.length}
        </span>
        <span className="left gear-hint">
          {tr("Pasa el cursor por un objeto para ver su tarjeta.")} {ctx.raceId > 0 ? `${tr("Raza")}: ${raceName ?? ctx.raceId}.` : tr("Sin raza elegida: no se comprueban las restricciones de raza.")}
        </span>
        <span className="lvl">
          <label className="gear-level">
            {tr("Nivel del personaje")}
            <input type="number" min={1} max={60} value={ctx.level} onChange={(e) => setLevel(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
          </label>
          <button type="button" onClick={() => setGear(() => ({}))} disabled={count === 0}>
            {tr("Quitar todo el equipo")}
          </button>
        </span>
      </div>

      <div className="gear-layout">
        <AvatarPanel
          raceId={avatarRaceId}
          races={avatarRaces}
          avatar={avatar}
          setAvatar={setAvatar}
          gear={gear}
          setGear={setGear}
          data={data}
          ctx={ctx}
          history={history}
          left={<div className="doll-col">{SLOT_ORDER_LEFT.map(slotButton)}</div>}
          right={<div className="doll-col">{SLOT_ORDER_RIGHT.map(slotButton)}</div>}
          bottom={<div className="doll-bottom">{SLOT_ORDER_BOTTOM.map(slotButton)}</div>}
        />
        <div className="gear-col">
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
        </div>
        {summary && (
          <div className="gear-col is-side">
            <aside className="gear-side" aria-label={tr("Lo que suma tu equipo")}>
              <GearTotals compact summary={summary} ratings={ratings} tips={{ gear, data, onTip: setTip }} />
            </aside>
          </div>
        )}
      </div>
      <p className="muted small gear-foot">
        {tr("Objetos, armadura y daño de arma salen del cliente de la beta; encantamientos, sufijos aleatorios y puntuaciones, de la comunidad.")}
        {partial && ` ${tr("Faltan datos de la comunidad (encantamientos, sufijos o puntuaciones).")}`}
      </p>
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
const ORIGIN_LABEL: Record<string, string> = { item: "", suffix: "sufijo", enchant: "encantamiento", set: "conjunto", effect: "efecto del objeto" };
const originText = (o: string): string => (ORIGIN_LABEL[o] ? ` (${tr(ORIGIN_LABEL[o]!)})` : "");

export interface TotalsTips {
  gear: GearSelection;
  data: GearData;
  onTip: (t: Tip | null) => void;
}

/** Un conjunto que llevas: piezas puestas (barra), y cada bono con el número de piezas que pide y si está activo. */
function SetCard({ s }: { s: GearSummary["sets"][number] }) {
  return (
    <article className="gear-set">
      <header>
        <b>{setLabel(s)}</b>
        <span className="set-count">
          {s.count}
          <small>/{s.total}</small>
        </span>
      </header>
      <div className="set-pips" aria-hidden="true">
        {Array.from({ length: s.total }, (_, i) => (
          <i key={i} className={i < s.count ? "on" : ""} />
        ))}
      </div>
      <ul className="set-bonus-list">
        {s.bonuses.map((b) => (
          <li key={b.threshold + b.name} className={b.active ? "good active" : "muted"}>
            <span className="set-th">{b.threshold}</span>
            <span>{effectLabel(b)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function GearTotals({ summary, ratings, tips, compact }: { summary: GearSummary; ratings: CombatRatings | null; tips?: TotalsTips; /** Columna estrecha del paso Equipo: cifras en rejilla (de dónde salen, en el título) y sin tablas anchas. */ compact?: boolean }) {
  // Manejadores de cursor de lo que nombra el objeto de una ranura (tarjeta del objeto con su sufijo y encantamiento)
  const hover = (slot: GearSlot | null) => {
    const worn = slot ? tips?.gear[slot] : undefined;
    const item = worn ? tips?.data.items.get(worn.itemId) : undefined;
    if (!tips || !worn || !item) return {};
    const show = (e: { clientX: number; clientY: number }) => tips.onTip({ item, slot, enchantId: worn.enchantId, suffixId: worn.suffixId, x: e.clientX, y: e.clientY });
    return { onMouseEnter: show, onMouseMove: show, onMouseLeave: () => tips.onTip(null) };
  };
  const sortedLines = [...summary.lines].filter((l) => l.key !== "extra-armor").sort((a, b) => statRank(a.key) - statRank(b.key) || statName(a.key).localeCompare(statName(b.key), isEnglish() ? "en" : "es"));
  const percents = ratings ? ratingPercents(summary.stats, ratings) : [];
  const armor = summary.armor + (summary.stats["extra-armor"] ?? 0);
  const empty = summary.lines.length === 0 && summary.weapons.length === 0 && summary.armor === 0;
  if (empty && summary.problems.length === 0 && summary.missing.length === 0) return <p className="muted">{tr("Aún no llevas ningún objeto con estadísticas.")}</p>;
  return (
    <div className={`gear-totals${compact ? " compact" : ""}`}>
      <h4>{tr("Lo que suma tu equipo")}</h4>
      {summary.missing.length > 0 && (
        <p className="gear-warn">
          {summary.missing.length} {summary.missing.length === 1 ? tr("objeto del enlace ya no existe") : tr("objetos del enlace ya no existen")} {tr("en los datos (un hotfix los quitó o el enlace es de otro parche")}):{" "}
          {summary.missing.map((m) => `${slotLabel(m.slot)} (${m.itemId})`).join(", ")}.
        </p>
      )}
      {summary.problems.length > 0 && (
        <ul className="gear-warn">
          {summary.problems.map((p) => (
            <li key={p.slot} {...hover(p.slot)}>
              <b>{slotLabel(p.slot)}</b>: {p.reasons.map(trn).join("; ")}. {tr("Se sigue sumando.")}
            </li>
          ))}
        </ul>
      )}
      {armor > 0 && !compact && (
        <p>
         {tr("Armadura")}: <b>{fmt(Math.round(armor))}</b>
          {summary.stats["extra-armor"] ? <small className="muted"> ({fmt(Math.round(summary.armor))} {tr("de las piezas")} + {fmt(summary.stats["extra-armor"])} {tr("extra")})</small> : null}
        </p>
      )}
      {sortedLines.length > 0 && compact && (
        <dl className="gear-stat-grid">
          {armor > 0 && (
            <div title={summary.stats["extra-armor"] ? `${fmt(Math.round(summary.armor))} ${tr("de las piezas")} + ${fmt(summary.stats["extra-armor"])} ${tr("extra")}` : undefined}>
              <dt>{tr("Armadura")}</dt>
              <dd>{fmt(Math.round(armor))}</dd>
            </div>
          )}
          {sortedLines.map((l) => (
            <div key={l.key} title={l.sources.map((x) => `${x.slot ? slotLabel(x.slot) : x.itemName} ${x.value > 0 ? "+" : ""}${x.value}${originText(x.origin)}`).join(" · ")}>
              <dt>{statName(l.key)}</dt>
              <dd>{fmt(l.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {sortedLines.length > 0 && !compact && (
        <table className="stats-table gear-stats">
          <thead>
            <tr>
              <th scope="col">{tr("Estadística")}</th>
              <th scope="col">{tr("Total")}</th>
              <th scope="col">{tr("Procede de")}</th>
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
                        {s.slot ? slotLabel(s.slot) : s.itemName} {s.value > 0 ? "+" : ""}
                        {s.value}
                        {originText(s.origin)}
                      </span>
                    ))}
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      )}
      {summary.sets.length > 0 && (
        <>
          <h5 className="fx-sub">{tr("Conjuntos")}</h5>
          <div className="gear-sets">
            {summary.sets.map((s) => (
              <SetCard key={s.setId} s={s} />
            ))}
          </div>
          <p className="muted small">{tr("Los bonos de conjunto y efectos de objeto que son una cifra (atributos, poder, puntuaciones, porcentajes) ya se suman; los demás (procs, efectos con condición) son texto del cliente.")}</p>
        </>
      )}
      {percents.length > 0 && (
        <>
          <h5 className="fx-sub">{tr("Puntuaciones convertidas")}</h5>
          <table className="stats-table">
            <tbody>
              {percents.map((r) => (
                <tr key={r.stat}>
                  <th scope="row">{trn(r.label)}</th>
                  <td>
                    <b>{r.unit === "%" ? `${fmt(r.value)} %` : fmt(r.value)}</b> <small className="muted">({fmt(r.rating)} ÷ {fmt(r.perUnit)})</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            <span className="tag tag-unassigned">{tr("la comunidad · estimación")}</span> {tr("Forever tiene una sola puntuación de impacto, de crítico y de celeridad, constantes en todos los niveles (medidas por la comunidad, sin confirmar por nosotros). El impacto y el crítico ya entran en las probabilidades de cada habilidad; el poder de ataque y con hechizos salen aparte en «Con tu poder» de cada habilidad (estimación de Classic")}).
          </p>
        </>
      )}
      {summary.weapons.length > 0 && (
        <>
          <h5 className="fx-sub">{tr("Armas")}</h5>
          <ul className="effects">
            {summary.weapons.map((w) => (
              <li key={w.slot} {...hover(w.slot)}>
                <b>{slotLabel(w.slot)}</b>: {w.itemName} · {fmt(Math.floor(w.min))} – {fmt(Math.ceil(w.max))} · {tr("velocidad")} {fmt(w.speed)} · {fmt(w.dps)} {tr("de daño por segundo")}
                {w.confidence === "estimated" && <span className="tag tag-unassigned item-tag">{tr("estimación")}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.effects.length > 0 && (
        <>
          <h5 className="fx-sub">{tr("Efectos de objetos")}</h5>
          <ul className="effects">
            {summary.effects.map((e, i) => (
              <li key={i} {...hover(e.slot)}>
                <b>{e.itemName}</b> · {effectPrefix(e.effect.trigger)}: {effectLabel(e.effect)}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.incomplete && <p className="muted small">{tr("Algún objeto viene de la comunidad sin estadísticas: su aporte falta.")}</p>}
    </div>
  );
}

/** Carga los datos de equipo en cuanto hacen falta (paso Equipo o un enlace con equipo). */
export { useGearBundle };
