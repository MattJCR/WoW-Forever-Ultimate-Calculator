import { equipItem, slotsForItem, type GearContext, type GearData, type GearSelection, type GearSlot } from "@wfuc/engine";
import type { Item } from "@wfuc/schema";
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { raceLabel, tr } from "../i18n";
import { MODELS_BASE } from "../viewer/config";
import { DEFAULT_AVATAR, webglAvailable, type Avatar, type ModelIndexEntry } from "../viewer/avatar";
import { BACKDROPS, BackdropArt, backdropOfRace } from "../viewer/backdrops";
import type { Equipped } from "../viewer/equipment";
import { defaultSelection, type Recipe } from "../viewer/recipe";
import { iName, qualityColor } from "./gear-format";

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

function SetsDialog({ data, onPick, onClose }: { data: GearData; onPick: (itemIds: number[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(40);
  const sets = useMemo(() => {
    const q = norm(query.trim());
    return data.sets.filter((s) => s.itemIds.length > 1 && (!q || norm(s.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [data, query]);
  useEffect(() => setLimit(40), [query]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal sets-dialog" role="dialog" aria-modal="true" aria-label={tr("Conjuntos")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Conjuntos")}</h3>
          <button type="button" onClick={onClose} aria-label={tr("Cerrar")}>×</button>
        </div>
        <input type="search" placeholder={tr("Buscar conjunto…")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="sets-list">
          {sets.slice(0, limit).map((s) => {
            const pieces = s.itemIds.map((id) => data.items.get(id)).filter((it): it is Item => !!it);
            return (
              <li key={s.id}>
                <button type="button" onClick={() => { onPick(s.itemIds); onClose(); }}>
                  <b>{s.name}</b>
                  <small className="muted">
                    {pieces.map((it, i) => (
                      <Fragment key={it.id}>
                        {i > 0 && ", "}
                        <span style={{ color: qualityColor(it.quality) }}>{iName(it)}</span>
                      </Fragment>
                    ))}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
        {sets.length > limit && <button type="button" className="more" onClick={() => setLimit((l) => l + 60)}>{tr("Mostrar más")}</button>}
        {sets.length === 0 && <p className="muted">{tr("Ningún conjunto coincide.")}</p>}
      </div>
    </div>
  );
}

export interface AvatarRace {
  id: number;
  name: string;
  faction: string;
}

export function AvatarPanel({ raceId, races, avatar, setAvatar, gear, setGear, data, history }: {
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

  if (!gl) return <div className="avatar avatar-off"><p className="muted small">{tr("Tu navegador no admite WebGL 2: el probador 3D no está disponible.")}</p></div>;
  if (index === undefined) return <div className="avatar avatar-off"><p className="muted small">{tr("Cargando…")}</p></div>;
  if (!index || !entry) return <div className="avatar avatar-off"><p className="muted small">{tr("El probador 3D no tiene modelos en esta versión de la web.")}</p></div>;

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

  return (
    <div className="avatar">
      <div className="avatar-bar" role="group" aria-label={tr("Cuerpo del personaje")}>
        {([0, 1] as const).map((s) => (
          <button key={s} type="button" className={avatar.sex === s ? "on" : ""} aria-pressed={avatar.sex === s} onClick={() => setAvatar({ sex: s, choices: {}, sheathed: avatar.sheathed, race: avatar.race, bg: avatar.bg })}>
            {tr("Cuerpo {n}", { n: s + 1 })}
          </button>
        ))}
        {withModel.length > 1 && (
          <select className="avatar-race" value={shownRace} aria-label={tr("Raza del personaje")} title={tr("Solo cambia el aspecto del personaje; las estadísticas siguen con la raza del paso Raza")} onChange={(e) => pickRace(Number(e.target.value))}>
            {([["alliance", "Alianza"], ["horde", "Horda"]] as const).map(([f, label]) => (
              <optgroup key={f} label={tr(label)}>
                {withModel.filter((r) => r.faction === f).map((r) => <option key={r.id} value={r.id}>{raceLabel(r.id, r.name)}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        <select className="avatar-race" value={avatar.bg === undefined ? "auto" : String(avatar.bg)} aria-label={tr("Fondo")} title={tr("Fondo del probador")} onChange={(e) => pickScene(e.target.value)}>
          <option value="auto">{tr("Fondo: según la raza")}</option>
          {BACKDROPS.map((b) => <option key={b.id} value={b.id}>{tr(b.name)}</option>)}
          <option value="0">{tr("Liso")}</option>
        </select>
        <button type="button" className={open ? "on" : ""} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{tr("Personalizar")}</button>
        <button type="button" onClick={() => setSets(true)}>{tr("Conjuntos")}</button>
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
      <div className="avatar-tools" role="toolbar" aria-label={tr("Herramientas del probador")}>
        <button type="button" onClick={history.undo} disabled={!history.canUndo}>{tr("Deshacer")}</button>
        <button type="button" onClick={history.redo} disabled={!history.canRedo}>{tr("Rehacer")}</button>
        <button type="button" aria-pressed={!!avatar.sheathed} onClick={() => setAvatar({ ...avatar, sheathed: !avatar.sheathed })}>{avatar.sheathed ? tr("Desenvainar") : tr("Envainar")}</button>
        <button type="button" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? tr("Reanudar") : tr("Pausar")}</button>
        <button type="button" onClick={capture}>{tr("Captura")}</button>
        <button type="button" onClick={fullscreen}>{tr("Pantalla completa")}</button>
      </div>
      {open && recipe && (
        <div className="avatar-options">
          <div className="avatar-options-bar">
            <button type="button" onClick={randomize}>{tr("Aleatorio")}</button>
            <button type="button" onClick={() => setAvatar({ ...DEFAULT_AVATAR, sex: avatar.sex, choices: {}, sheathed: avatar.sheathed, race: avatar.race, bg: avatar.bg })}>{tr("Restablecer")}</button>
          </div>
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
          {recipe.options.map((o) => {
            const shown = o.choices.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => npc || !c.npc || c.id === selection?.[o.id]);
            if (shown.length < 2) return null;
            return (
              <label key={o.id}>
                <span>{o.name}</span>
                <select value={selection?.[o.id] ?? 0} onChange={(e) => setAvatar({ ...avatar, choices: { ...avatar.choices, [o.id]: Number(e.target.value) } })}>
                  {shown.map(({ c, n }) => <option key={c.id} value={c.id}>{c.name || `#${n}`}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
      {sets && <SetsDialog data={data} onPick={(ids) => setGear((g) => equipSet(g, ids, data.items))} onClose={() => setSets(false)} />}
    </div>
  );
}
