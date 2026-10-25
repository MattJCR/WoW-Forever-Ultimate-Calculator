import { canEquip, equipItem, slotsForItem, type GearContext, type GearData, type GearSelection, type GearSlot } from "@wfuc/engine";
import type { Item } from "@wfuc/schema";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { raceLabel, tr } from "../i18n";
import { MODELS_BASE } from "../viewer/config";
import { DEFAULT_AVATAR, webglAvailable, type Avatar, type ModelIndexEntry } from "../viewer/avatar";
import { BACKDROPS, BackdropArt, backdropOfRace } from "../viewer/backdrops";
import type { Equipped } from "../viewer/equipment";
import { defaultSelection, type Recipe } from "../viewer/recipe";
import { AvatarOptions } from "./AvatarOptions";
import { effectLabel, iName, inventoryLabel, qualityColor, setLabel } from "./gear-format";
import { ToolGlyph } from "./glyphs";
import { Icon } from "./Icon";

const Viewer3D = lazy(() => import("../viewer/Viewer3D").then((m) => ({ default: m.Viewer3D })));

let indexPromise: Promise<ModelIndexEntry[] | null> | null = null;
const loadIndex = () => (indexPromise ??= fetch(`${MODELS_BASE}/index.json`).then((r) => (r.ok ? (r.json() as Promise<ModelIndexEntry[]>) : null), () => null));

/** Lo que lleva puesto el personaje, en la forma que entiende el visor. */
function equippedOf(gear: GearSelection, items: Map<number, Item>): Equipped[] {
  const out: Equipped[] = [];
  for (const [slot, worn] of Object.entries(gear)) {
    const item = worn ? items.get(worn.itemId) : undefined;
    if (item) out.push({ slot, inventoryType: item.inventoryType, classId: item.classId, subclassId: item.subclassId, itemId: item.id });
  }
  return out;
}

/** Nombre de cada animación del modelo. */
const POSE_LABEL: Record<string, string> = {
  Stand: "Reposo", Walk: "Caminar", Run: "Correr", ReadyUnarmed: "Listo, sin armas", Ready1H: "Listo, una mano",
  Ready2H: "Listo, dos manos", Ready2HL: "Listo, bastón", ReadyBow: "Listo, arco", ReadyRifle: "Listo, arma de fuego",
};

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pone cada pieza del conjunto en su ranura (los anillos y abalorios, en la primera libre). */
function equipSet(gear: GearSelection, itemIds: number[], items: Map<number, Item>): GearSelection {
  let next = gear;
  const taken = new Set<GearSlot>();
  for (const id of itemIds) {
    const item = items.get(id);
    if (!item) continue;
    const slots = slotsForItem(item);
    const slot = slots.find((s) => !taken.has(s)) ?? slots[0];
    if (!slot) continue;
    taken.add(slot);
    next = equipItem(next, slot, item, items);
  }
  return next;
}

function SetsDialog({ data, ctx, gear, onPick, onClose }: { data: GearData; ctx: GearContext; gear: GearSelection; onPick: (itemIds: number[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(true);
  const [limit, setLimit] = useState(60);
  const [sel, setSel] = useState<number | null>(null);
  const wornIds = useMemo(() => new Set(Object.values(gear).map((w) => w?.itemId)), [gear]);
  // Conjuntos con alguna pieza que tu clase puede llevar (a nivel 60: aquí interesa la clase y la competencia, no el nivel)
  const mineIds = useMemo(() => {
    const at60 = { ...ctx, level: 60 };
    const ok = new Set<number>();
    for (const s of data.sets) {
      if (s.itemIds.some((id) => { const it = data.items.get(id); const slot = it ? slotsForItem(it)[0] : undefined; return !!it && !!slot && canEquip(it, slot, at60, data).ok; })) ok.add(s.id);
    }
    return ok;
  }, [data, ctx]);
  const sets = useMemo(() => {
    const q = norm(query.trim());
    return data.sets.filter((s) => s.itemIds.length > 1 && (!mine || mineIds.has(s.id)) && (!q || norm(setLabel(s)).includes(q))).sort((a, b) => setLabel(a).localeCompare(setLabel(b), "es"));
  }, [data, query, mine, mineIds]);
  useEffect(() => setLimit(60), [query, mine]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  const current = sets.find((s) => s.id === sel) ?? sets[0];
  const pieces = current ? current.itemIds.map((id) => data.items.get(id)).filter((it): it is Item => !!it) : [];
  const wornCount = pieces.filter((it) => wornIds.has(it.id)).length;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal sets-dialog" role="dialog" aria-modal="true" aria-label={tr("Conjuntos")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Conjuntos")}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label={tr("Cerrar")}>×</button>
        </div>
        <div className="sets-tools">
          <input type="search" placeholder={tr("Buscar conjunto…")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={tr("Buscar conjunto…")} autoFocus />
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {tr("Solo los que puede llevar mi clase")}
          </label>
          <span className="muted small">{sets.length} {tr("conjuntos")}</span>
        </div>
        <div className="sets-body">
          <ul className="sets-list" aria-label={tr("Conjuntos")}>
            {sets.slice(0, limit).map((s) => {
              const its = s.itemIds.map((id) => data.items.get(id)).filter((it): it is Item => !!it);
              const on = current?.id === s.id;
              return (
                <li key={s.id}>
                  <button type="button" className={`set-row${on ? " on" : ""}`} aria-pressed={on} onClick={() => setSel(s.id)}>
                    <span className="set-row-name">{setLabel(s)}</span>
                    <span className="set-row-meta">
                      {its.length} {tr("piezas")}
                      {its.length > 0 ? ` · ${tr("nivel")} ${Math.max(...its.map((it) => it.requiredLevel))}` : ""}
                    </span>
                    <span className="set-row-pips" aria-hidden="true">
                      {its.map((it) => (
                        <i key={it.id} style={{ background: qualityColor(it.quality) }} />
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
            {sets.length > limit && (
              <li>
                <button type="button" className="more" onClick={() => setLimit((l) => l + 60)}>{tr("Mostrar más")} ({sets.length - limit} {tr("restantes")})</button>
              </li>
            )}
            {sets.length === 0 && <li className="muted set-empty">{tr("Ningún conjunto coincide.")}</li>}
          </ul>
          {current && (
            <section className="set-detail" aria-label={setLabel(current)}>
              <header>
                <h4>{setLabel(current)}</h4>
                <span className="muted small">
                  {wornCount}/{pieces.length} {tr("piezas")} {tr("equipadas")}
                </span>
              </header>
              <ul className="set-pieces">
                {pieces.map((it) => (
                  <li key={it.id} className={wornIds.has(it.id) ? "worn" : ""}>
                    <span className="gear-icon small" style={{ borderColor: qualityColor(it.quality) }}>
                      <Icon id={it.iconFileDataId} name={iName(it)} />
                    </span>
                    <span className="set-piece-text">
                      <b style={{ color: qualityColor(it.quality) }}>{iName(it)}</b>
                      <small className="muted">
                        {inventoryLabel(it.inventoryType)} · {tr("nivel")} {it.requiredLevel}
                      </small>
                    </span>
                    {wornIds.has(it.id) && <span className="set-piece-on">{tr("Equipada")}</span>}
                  </li>
                ))}
              </ul>
              {current.bonuses.length > 0 && (
                <ul className="set-bonus-list">
                  {current.bonuses.map((b) => (
                    <li key={b.spellId} className={wornCount >= b.threshold ? "good active" : "muted"}>
                      <span className="set-th">{b.threshold}</span>
                      <span>{effectLabel(b)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="set-actions">
                <button type="button" className="btn btn-primary" onClick={() => { onPick(current.itemIds); onClose(); }}>
                  {tr("Equipar conjunto")}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export interface AvatarRace {
  id: number;
  name: string;
  faction: string;
}

/**
 * El muñeco entero: ranuras a los lados (`left`, `right`), armas debajo (`bottom`), el avatar en medio y la barra de herramientas al pie.
 * «Personalizar» cambia las ranuras por los ajustes del personaje, en el mismo sitio.
 */
export function AvatarPanel({ raceId, races, avatar, setAvatar, gear, setGear, data, ctx, history, left, right, bottom }: {
  /** Raza del paso Raza (la del avatar si no se elige otra aquí). */
  raceId: number;
  /** Todas las razas con modelo, para el selector del probador. */
  races: AvatarRace[];
  avatar: Avatar;
  setAvatar: (a: Avatar) => void;
  gear: GearSelection;
  setGear: (update: (g: GearSelection) => GearSelection) => void;
  data: GearData;
  ctx: GearContext;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  left: ReactNode;
  right: ReactNode;
  bottom: ReactNode;
}) {
  const [index, setIndex] = useState<ModelIndexEntry[] | null | undefined>(undefined);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState(false);
  const [paused, setPaused] = useState(false);
  const [npc, setNpc] = useState(false);
  const [clips, setClips] = useState<string[]>([]);
  const [missing, setMissing] = useState<number[]>([]);
  const [pose, setPose] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const gl = useMemo(webglAvailable, []);
  useEffect(() => { void loadIndex().then(setIndex); }, []);

  const shownRace = avatar.race && index?.some((e) => e.race === avatar.race) ? avatar.race : raceId;
  const entry = index?.find((e) => e.race === shownRace && e.sex === avatar.sex);
  const withModel = races.filter((r) => index?.some((e) => e.race === r.id));
  const pickRace = (id: number) => setAvatar({ sex: avatar.sex, choices: {}, sheathed: avatar.sheathed, bg: avatar.bg, ...(id === raceId ? {} : { race: id }) });
  // Escena de fondo: la elegida (0 = liso) o, por defecto, la de la raza que se ve
  const sceneId = avatar.bg ?? backdropOfRace(shownRace);
  const pickScene = (value: string) => setAvatar({ ...avatar, bg: value === "auto" ? undefined : Number(value) });
  const equipped = useMemo(() => equippedOf(gear, data.items), [gear, data.items]);
  const selection = useMemo(() => (recipe ? { ...defaultSelection(recipe), ...avatar.choices } : undefined), [recipe, avatar.choices]);

  const off = (message: string) => (
    <div className="doll">
      {left}
      <div className="avatar avatar-off"><p className="muted small">{message}</p></div>
      {right}
      {bottom}
    </div>
  );
  if (!gl) return off(tr("Tu navegador no admite WebGL 2: el probador 3D no está disponible."));
  if (index === undefined) return off(tr("Cargando…"));
  if (!index || !entry) return off(tr("El probador 3D no tiene modelos en esta versión de la web."));

  const randomize = () => {
    if (!recipe) return;
    const choices: Record<number, number> = {};
    for (const o of recipe.options) {
      const pool = npc ? o.choices : o.choices.filter((x) => !x.npc);
      const c = (pool.length ? pool : o.choices)[Math.floor(Math.random() * (pool.length || o.choices.length))];
      if (c) choices[o.id] = c.id;
    }
    setAvatar({ ...avatar, choices });
  };
  const capture = () => {
    const canvas = stage.current?.querySelector("canvas");
    canvas?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "wow-forever-personaje.png";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
  };
  const fullscreen = () => {
    const el = stage.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const resetLook = () => setAvatar({ ...DEFAULT_AVATAR, sex: avatar.sex, choices: {}, sheathed: avatar.sheathed, race: avatar.race, bg: avatar.bg });
  const tip = (label: string) => ({ "aria-label": label, "data-tip": label });

  return (
    <>
      <div className="doll">
        {open ? (
          <section className="doll-col avatar-panel" aria-label={tr("Personaje")}>
            <h4>{tr("Personaje")}</h4>
            {withModel.length > 1 && (
              <label>
                <span>{tr("Raza del personaje")}</span>
                <select className="avatar-race" value={shownRace} onChange={(e) => pickRace(Number(e.target.value))}>
                  {([["alliance", "Alianza"], ["horde", "Horda"]] as const).map(([f, label]) => (
                    <optgroup key={f} label={tr(label)}>
                      {withModel.filter((r) => r.faction === f).map((r) => <option key={r.id} value={r.id}>{raceLabel(r.id, r.name)}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>{tr("Fondo del probador")}</span>
              <select className="avatar-race" value={avatar.bg === undefined ? "auto" : String(avatar.bg)} onChange={(e) => pickScene(e.target.value)}>
                <option value="auto">{tr("Fondo: según la raza")}</option>
                {BACKDROPS.map((b) => <option key={b.id} value={b.id}>{tr(b.name)}</option>)}
                <option value="0">{tr("Liso")}</option>
              </select>
            </label>
            <p className="muted small">{tr("Solo cambia el aspecto del personaje; las estadísticas siguen con la raza del paso Raza")}</p>
          </section>
        ) : left}

        <div className="avatar">
          <div className="avatar-bar" role="group" aria-label={tr("Cuerpo del personaje")}>
            {([0, 1] as const).map((s) => (
              <button key={s} type="button" className={avatar.sex === s ? "on" : ""} aria-pressed={avatar.sex === s} onClick={() => setAvatar({ sex: s, choices: {}, sheathed: avatar.sheathed, race: avatar.race, bg: avatar.bg })}>
                {tr("Cuerpo {n}", { n: s + 1 })}
              </button>
            ))}
          </div>
          <div className="avatar-stage" ref={stage} data-scene={sceneId || undefined}>
            <BackdropArt id={sceneId} />
            <Suspense fallback={<p className="muted small">{tr("Cargando…")}</p>}>
              <Viewer3D chrModelId={entry.chrModel} race={shownRace} selection={selection} equipped={equipped} onRecipe={setRecipe} onClips={setClips} onMissing={setMissing} paused={paused} pose={pose || undefined} sheathed={!!avatar.sheathed} />
            </Suspense>
          </div>
          {missing.length > 0 && (
            <p className="avatar-missing muted small" role="note">
              {tr("El cliente no trae el modelo 3D de:")} {missing.map((id) => iName(data.items.get(id) ?? { id, name: String(id) } as Item)).join(", ")}
            </p>
          )}
        </div>

        {open ? (
          <section className="doll-col avatar-panel" aria-label={tr("Aspecto")}>
            <h4>{tr("Aspecto")}</h4>
            {recipe ? (
              <AvatarOptions recipe={recipe} selection={selection} npc={npc} onPick={(optionId, choiceId) => setAvatar({ ...avatar, choices: { ...avatar.choices, [optionId]: choiceId } })} />
            ) : (
              <p className="muted small">{tr("Cargando…")}</p>
            )}
          </section>
        ) : right}

        {open ? (
          <div className="doll-bottom avatar-extra">
            {clips.length > 1 && (
              <label>
                <span>{tr("Animación")}</span>
                <select value={pose} onChange={(e) => setPose(e.target.value)}>
                  <option value="">{tr("Según las armas")}</option>
                  {clips.map((c) => <option key={c} value={c}>{tr(POSE_LABEL[c] ?? c)}</option>)}
                </select>
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={npc} onChange={(e) => setNpc(e.target.checked)} /> {tr("Opciones de PNJ")}
            </label>
            <button type="button" onClick={randomize} disabled={!recipe}>{tr("Aleatorio")}</button>
            <button type="button" onClick={resetLook}>{tr("Restablecer")}</button>
          </div>
        ) : bottom}

        <div className="doll-tools" role="toolbar" aria-label={tr("Herramientas del probador")}>
          <button type="button" className="tool-text gold" onClick={() => setSets(true)}>
            <ToolGlyph name="sets" /> {tr("Conjuntos")}
          </button>
          <button type="button" className={`tool-text${open ? " active" : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <ToolGlyph name={open ? "done" : "customize"} /> {open ? tr("Listo") : tr("Personalizar")}
          </button>
          <span className="tool-sep" aria-hidden="true" />
          <span className="tool-seg">
            <button type="button" {...tip(tr("Deshacer"))} onClick={history.undo} disabled={!history.canUndo}><ToolGlyph name="undo" /></button>
            <button type="button" {...tip(tr("Rehacer"))} onClick={history.redo} disabled={!history.canRedo}><ToolGlyph name="redo" /></button>
          </span>
          <span className="tool-sep" aria-hidden="true" />
          <button type="button" {...tip(avatar.sheathed ? tr("Desenvainar") : tr("Envainar"))} className={avatar.sheathed ? "active" : ""} aria-pressed={!!avatar.sheathed} onClick={() => setAvatar({ ...avatar, sheathed: !avatar.sheathed })}>
            <ToolGlyph name="sheathe" />
          </button>
          <button type="button" {...tip(paused ? tr("Reanudar") : tr("Pausar"))} className={paused ? "active" : ""} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            <ToolGlyph name={paused ? "play" : "pause"} />
          </button>
          <span className="tool-sep" aria-hidden="true" />
          <button type="button" {...tip(tr("Captura"))} onClick={capture}><ToolGlyph name="capture" /></button>
          <button type="button" {...tip(tr("Pantalla completa"))} onClick={fullscreen}><ToolGlyph name="fullscreen" /></button>
        </div>
      </div>
      {sets && <SetsDialog data={data} ctx={ctx} gear={gear} onPick={(ids) => setGear((g) => equipSet(g, ids, data.items))} onClose={() => setSets(false)} />}
    </>
  );
}
