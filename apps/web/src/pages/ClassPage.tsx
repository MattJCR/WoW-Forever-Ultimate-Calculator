import {
  addPoint,
  decodeBuildReport,
  decodeGear,
  encodeBuild,
  encodeGear,
  formatBuildForAI,
  indexClass,
  rankOf,
  removePoint,
  requiredLevel,
  specPoints,
  summarizeCharacter,
  summarizeGear,
  totalPoints,
  type Build,
  type ClassIndex,
  type DecodeReport,
  type GearContext,
  type GearSelection,
} from "@wfuc/engine";
import type { ClassTalents, CombatRatings, Manifest, Race } from "@wfuc/schema";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isEmptyCode, useCharacter } from "../character";
import { Detail } from "../components/Detail";
import { AbilitiesTable } from "../components/Abilities";
import { GearStep, useGearBundle } from "../components/Gear";
import { LevelPicker } from "../components/LevelPicker";
import { useStatEffects } from "../components/StatEffects";
import { Icon } from "../components/Icon";
import { LinkNotice } from "../components/LinkNotice";
import { RacialList, RacialTip, racialLine } from "../components/RaceBonuses";
import { StatsTable } from "../components/StatsTable";
import { anchorOf, TreePanel, type Focus } from "../components/TreePanel";
import { CLASS_COLORS, loadClass, loadRaces, useAsync } from "../data";
import { href, parseHash, replaceHash } from "../router";

type Entry = Manifest["classes"][number];
type View = "race" | "legacy" | "talents" | "gear" | "summary";
// La raza va primero (paso propio, con su caja como los talentos). Legacy va ANTES que los talentos de clase:
// Talentoso (Legacy) adelanta el primer punto de talento y cambia el nivel que exigen.
const VIEWS: { id: View; n: number; label: string }[] = [
  { id: "race", n: 1, label: "Raza" },
  { id: "legacy", n: 2, label: "Puntos de Legado" },
  { id: "talents", n: 3, label: "Talentos" },
  { id: "gear", n: 4, label: "Equipo" },
  { id: "summary", n: 5, label: "Resumen" },
];
const isView = (v: string | null): v is View => v === "race" || v === "legacy" || v === "talents" || v === "gear" || v === "summary";
const DEFAULT_GEAR_LEVEL = 60;

export function ClassPage({ token, entry, query }: { token: string; entry: Entry; query: URLSearchParams }) {
  const state = useAsync(entry.file, () => loadClass(entry.file));
  if (state.status === "loading") return <p className="status">Cargando {entry.className}…</p>;
  if (state.status === "error") return <p className="status error">{state.message}</p>;
  return <ClassView key={token} token={token} data={state.value} query={query} />;
}

/** Puntos y acciones de un build; sirve igual para el arbol de clase y para Legacy. */
function useBuildActions(idx: ClassIndex | null, setBuild: (u: (b: Build) => Build) => void) {
  const add = useCallback(
    (nodeId: number, toMax = false) => {
      if (!idx) return;
      setBuild((b) => {
        let next = addPoint(idx, b, nodeId);
        if (toMax) {
          const cap = idx.byNode.get(nodeId)?.talent.maxRank ?? 0;
          while (rankOf(next, nodeId) < cap) {
            const after = addPoint(idx, next, nodeId);
            if (after === next) break;
            next = after;
          }
        }
        return next;
      });
    },
    [idx, setBuild],
  );
  const remove = useCallback((nodeId: number) => idx && setBuild((b) => removePoint(idx, b, nodeId)), [idx, setBuild]);
  const resetTree = useCallback(
    (specIndex: number) => {
      if (!idx) return;
      setBuild((b) => {
        const ids = new Set(idx.ordered.filter((i) => i.specIndex === specIndex).map((i) => i.talent.nodeId));
        return Object.fromEntries(Object.entries(b).filter(([id]) => !ids.has(Number(id))));
      });
    },
    [idx, setBuild],
  );
  return { add, remove, resetTree };
}

function ClassView({ token, data, query }: { token: string; data: ClassTalents; query: URLSearchParams }) {
  const { legacy, legacyBuild, legacyCode, legacyReady, legacyReport, setLegacyBuild, manifest } = useCharacter();
  const idx = useMemo(() => indexClass(data), [data]);
  // El enlace puede ser de otra version de los datos (un hotfix quita o mueve talentos): se lee con tolerancia y lo perdido se avisa
  const [initial] = useState<DecodeReport | null>(() => {
    const code = query.get("b");
    return code ? decodeBuildReport(idx, code) : null;
  });
  const [classBuild, setClassBuild] = useState<Build>(() => initial?.build ?? {});
  const [view, setView] = useState<View>(() => {
    const v = query.get("v");
    if (isView(v)) return v;
    // Sin paso en el enlace: un build de clase ya empezado abre los talentos; si no, el flujo empieza por la raza
    return query.get("b") ? "talents" : "race";
  });
  // Un enlace nuevo (p. ej. el boton "Legacy" de la cabecera estando ya en esta clase) manda sobre el paso actual.
  // `query` cambia solo con hashchange: los cambios internos usan replaceState y no pasan por aqui.
  useEffect(() => {
    const v = query.get("v");
    if (isView(v)) setView(v);
  }, [query]);
  const [toast, setToast] = useState<string | null>(null);
  const [url, setUrl] = useState(() => window.location.href);
  const color = CLASS_COLORS[token] ?? "#e8b64a";

  // La raza se elige entre las que el cliente permite para esta clase (CharBaseInfo); `r` en el enlace es su ChrRaces.ID.
  const racesState = useAsync(manifest.races.file, () => loadRaces(manifest.races.file));
  const races = useMemo(
    () => (racesState.status === "ready" ? racesState.value.races.filter((r) => r.classIds.includes(data.classId)) : []),
    [racesState, data.classId],
  );
  const [raceId, setRaceId] = useState<number | null>(() => Number(query.get("r")) || null);
  // Igual que el paso: un enlace nuevo manda sobre la raza actual (los cambios internos usan replaceState, sin hashchange).
  useEffect(() => {
    const r = Number(query.get("r"));
    if (r) setRaceId(r);
  }, [query]);
  const race = races.find((r) => r.id === raceId) ?? null;
  const raceQuery: Record<string, string> = race ? { r: String(race.id) } : {};

  // Equipo: `g` = codigo del equipo (ids de objeto, encantamiento y sufijo), `gl` = nivel del personaje para las comprobaciones
  const [initialGear] = useState(() => decodeGear(query.get("g")));
  const [gear, setGearState] = useState<GearSelection>(initialGear.gear);
  const [gearLevel, setGearLevel] = useState(() => Math.max(1, Math.min(60, Number(query.get("gl")) || DEFAULT_GEAR_LEVEL)));
  const setGear = useCallback((update: (g: GearSelection) => GearSelection) => setGearState((g) => update(g)), []);
  const gearCode = useMemo(() => encodeGear(gear), [gear]);
  const hasGear = gearCode !== "";
  // Los objetos pesan unos 7 MB: solo se descargan al entrar al paso Equipo o si el enlace ya trae equipo
  const gearBundle = useGearBundle(manifest, view === "gear" || hasGear);
  const gearCtx: GearContext = useMemo(() => ({ classId: data.classId, raceId: race?.id ?? 0, level: gearLevel }), [data.classId, race, gearLevel]);
  const gearSummary = useMemo(() => (gearBundle?.status === "ready" ? summarizeGear(gear, gearCtx, gearBundle.value.data) : null), [gearBundle, gear, gearCtx]);
  const gearMinLevel = useMemo(() => (gearBundle?.status === "ready" ? Math.max(0, ...Object.values(gear).map((w) => gearBundle.value.data.items.get(w.itemId)?.requiredLevel ?? 0)) : 0), [gearBundle, gear]);

  const classCode = useMemo(() => encodeBuild(idx, classBuild), [idx, classBuild]);
  useEffect(() => {
    const q: Record<string, string> = {};
    if (!isEmptyCode(classCode)) q.b = classCode;
    // Hasta que Legacy no este cargado y aplicado, se conserva el `l` que ya trae el enlace (no se pisa con un build vacio)
    if (legacyReady) {
      if (!isEmptyCode(legacyCode)) q.l = legacyCode;
    } else {
      const keep = parseHash(window.location.hash).query.get("l");
      if (keep) q.l = keep;
    }
    if (race) q.r = String(race.id);
    if (hasGear) q.g = gearCode;
    if (gearLevel !== DEFAULT_GEAR_LEVEL) q.gl = String(gearLevel);
    q.v = view;
    replaceHash(`class/${token}`, q);
    setUrl(window.location.href);
  }, [token, classCode, legacyCode, legacyReady, view, race, hasGear, gearCode, gearLevel]);

  const say = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3600);
  };

  const summary = useMemo(() => summarizeCharacter(idx, classBuild, legacy, legacyBuild), [idx, classBuild, legacy, legacyBuild]);
  const classTotal = totalPoints(classBuild);
  const legacyTotal = totalPoints(legacyBuild);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      say("Enlace copiado");
    } catch {
      window.prompt("Copia el enlace:", window.location.href);
    }
  };

  const copyForAI = async () => {
    const text = formatBuildForAI({
      cls: idx,
      classBuild,
      legacy,
      legacyBuild,
      link: window.location.href,
      dataLink: new URL(`${import.meta.env.BASE_URL}data/classes/${token}.json`, window.location.href).href,
      hotfixesApplied: manifest.hotfixesApplied,
      raceName: race?.name ?? null,
      racials: race?.racials.map((a) => ({ name: a.name, kind: a.kind, description: racialLine(a, data.classId) })),
    });
    if (!text) return say("Gasta algunos puntos primero");
    try {
      await navigator.clipboard.writeText(text);
      say("Build copiado con el texto completo de cada talento. Pégalo en tu IA con una pregunta.");
    } catch {
      window.prompt("Copia el texto:", text);
    }
  };

  return (
    <div className="class-page" style={{ ["--accent" as string]: color }}>
      <ClassTabs current={token} legacyCode={legacyCode} raceQuery={raceQuery} manifest={manifest} />
      <LinkNotice title={data.className ?? token} report={initial && (initial.lost.length > 0 || initial.malformed) ? initial : null} />
      <LinkNotice title="Puntos de Legado" report={legacyReport} />

      <div className="toolbar">
        <nav className="steps" aria-label="Pasos del personaje">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={`step${view === v.id ? " on" : ""}`} aria-current={view === v.id ? "step" : undefined} onClick={() => setView(v.id)}>
              <span className="step-n">{v.n}</span>
              {v.label}
              {v.id === "race" && <small>{race?.name ?? "sin elegir"}</small>}
              {v.id === "legacy" && legacy && <small>{legacyTotal}/{legacy.data.rules.maxPoints}</small>}
              {v.id === "talents" && <small>{classTotal}/{idx.data.rules.maxPoints}</small>}
              {v.id === "gear" && <small>{Object.keys(gear).length}/19</small>}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button type="button" onClick={() => { setClassBuild({}); setLegacyBuild(() => ({})); setGearState({}); }} disabled={classTotal + legacyTotal === 0 && !hasGear}>
            Reiniciar
          </button>
          <button type="button" className="gold" onClick={copyLink}>
            Copiar enlace
          </button>
        </div>
      </div>

      {view === "race" && <RaceStep races={races} race={race} onRace={setRaceId} className={data.className ?? token} classId={data.classId} loading={racesState.status === "loading"} />}
      {view === "legacy" &&
        (legacy ? (
          <>
            <Banner idx={legacy} build={legacyBuild} title="Puntos de Legado" hint={`Ventajas de cuenta · se eligen antes que los talentos: Talentoso adelanta el primer punto de talento`} legacy />
            <Workspace key="legacy" idx={legacy} build={legacyBuild} setBuild={setLegacyBuild} />
          </>
        ) : (
          <p className="status">Cargando Puntos de Legado…</p>
        ))}
      {view === "talents" && (
        <>
          <Banner idx={idx} build={classBuild} title={data.className ?? token} hint={classTotal === 0 ? "Sin puntos gastados. Haz clic en un talento para empezar tu build." : `Nivel necesario ${summary.requiredLevel}`} />
          <Workspace
            key="class"
            idx={idx}
            build={classBuild}
            setBuild={setClassBuild}
            showInactive
            level={summary.requiredLevel}
            firstPoint={{ level: summary.firstPointLevel, fromLegacy: summary.firstPointFromLegacy }}
          />
        </>
      )}
      {view === "gear" && (
        <GearStep bundle={gearBundle} gear={gear} setGear={setGear} ctx={gearCtx} setLevel={setGearLevel} summary={gearSummary} raceName={race?.name ?? null} />
      )}
      {view === "summary" && (
        <Summary
          idx={idx}
          summary={summary}
          legacyLoaded={!!legacy}
          race={race}
          manifest={manifest}
          classBuild={classBuild}
          legacy={legacy}
          legacyBuild={legacyBuild}
          gear={gearSummary && hasGear ? { summary: gearSummary, ratings: gearBundle?.status === "ready" ? gearBundle.value.ratings : null, minLevel: gearMinLevel } : null}
          gearLoading={hasGear && gearBundle?.status !== "ready"}
        />
      )}

      <div className="share-row">
        <span className="share-label">Compartir</span>
        <input className="share-url" readOnly value={url} aria-label="Enlace de tu build" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copyLink}>
          Copiar
        </button>
        <span className="share-sep" aria-hidden="true" />
        <span className="share-label">Theorycraft</span>
        <button type="button" className="gold" id="copyAI" onClick={copyForAI} title="Copia este build con el texto completo de cada talento (clase y Puntos de Legado), para pegarlo en una IA y preguntarle algo">
          Copiar build para IA
        </button>
        <a className="btn" href={`${import.meta.env.BASE_URL}data/classes/${token}.json`} target="_blank" rel="noreferrer" title="Esta clase como JSON: cada talento a cada rango">
          Datos en bruto
        </a>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Paso 1: la raza, entre las que el cliente permite para la clase (CharBaseInfo). Una caja como las de los talentos. */
function RaceStep({ races, race, onRace, className, classId, loading }: { races: Race[]; race: Race | null; onRace: (id: number | null) => void; className: string; classId: number; loading: boolean }) {
  return (
    <section className="race-box" aria-label="Raza">
      <div className="panel-head">
        <h3>Raza</h3>
        <span className="left">
          Razas que el cliente permite para {className}: <b>{races.length}</b>
        </span>
        <span className="lvl">
          <button type="button" onClick={() => onRace(null)} disabled={!race}>
            Quitar raza
          </button>
        </span>
      </div>
      {loading ? (
        <p className="status">Cargando razas…</p>
      ) : (
        <div className="race-factions">
          {(["alliance", "horde"] as const).map((f) => (
            <div key={f} className={`race-faction ${f}`}>
              <h4>{f === "alliance" ? "Alianza" : "Horda"}</h4>
              <div className="race-cards">
                {races
                  .filter((r) => r.faction === f)
                  .map((r) => (
                    <button key={r.id} type="button" className={`race-card${race?.id === r.id ? " on" : ""}`} aria-pressed={race?.id === r.id} onClick={() => onRace(r.id)}>
                      <span className="race-name">{r.name}</span>
                      <span className="race-icons" aria-hidden="true">
                        {r.racials.map((a) => (
                          <RacialTip key={a.order} a={a} classId={classId}>
                            <Icon id={a.iconFileDataId} name={a.name} />
                          </RacialTip>
                        ))}
                      </span>
                    </button>
                  ))}
                {races.every((r) => r.faction !== f) && <p className="muted small">Ninguna raza de esta facción puede ser {className}.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {race ? (
        <div className="race-detail">
          <h4>
            {race.name} <span className="muted small">· habilidades raciales</span>
          </h4>
          <RacialList race={race} classId={classId} />
          <small className="muted">Texto y cifras de las raciales tal como los da el cliente de la beta.</small>
        </div>
      ) : (
        !loading && <p className="muted race-hint">Elige una raza para ver sus habilidades raciales y las estadísticas base del Resumen.</p>
      )}
    </section>
  );
}

function ClassTabs({ current, legacyCode, raceQuery, manifest }: { current: string; legacyCode: string; raceQuery: Record<string, string>; manifest: Manifest }) {
  return (
    <nav className="class-tabs" aria-label="Clases">
      {manifest.classes.map((c) => {
        const t = c.file.replace(/^classes\//, "").replace(/\.json$/, "");
        // La raza viaja con el enlace; si la nueva clase no la admite, el selector la ignora.
        const q: Record<string, string> = { ...(isEmptyCode(legacyCode) ? {} : { l: legacyCode }), ...raceQuery };
        return (
          <a key={c.classId} href={href(`class/${t}`, q)} className={`class-tab${t === current ? " on" : ""}`} style={{ ["--accent" as string]: CLASS_COLORS[t] }} aria-current={t === current ? "page" : undefined}>
            <Icon id={c.iconFileDataId} name={c.className} />
            <span>{c.className}</span>
          </a>
        );
      })}
    </nav>
  );
}

/** Banner fino de clase / Legacy: icono, titulo, una linea de ayuda y una barra de progreso por arbol. */
function Banner({ idx, build, title, hint, legacy = false }: { idx: ClassIndex; build: Build; title: string; hint: string; legacy?: boolean }) {
  const max = idx.data.rules.maxPoints;
  return (
    <section className={`banner${legacy ? " legacy" : ""}`}>
      <Icon id={idx.data.iconFileDataId} name={title} />
      <div className="banner-text">
        <h2>{title}</h2>
        <p>{hint}</p>
      </div>
      <ul className="bars" aria-label="Puntos por árbol">
        {idx.data.specs.map((s) => {
          const n = specPoints(idx, build, s.index);
          return (
            <li key={s.index} title={s.name ?? undefined}>
              <Icon id={s.iconFileDataId} name={s.name} />
              <span className="bar">
                <span style={{ width: `${Math.min(100, (n / max) * 100)}%` }} />
              </span>
              <b>{n}</b>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Arboles + tarjeta flotante + nodos no activos de una calculadora (clase o Legacy). */
function Workspace({
  idx,
  build,
  setBuild,
  showInactive = false,
  level,
  firstPoint,
}: {
  idx: ClassIndex;
  build: Build;
  setBuild: (u: (b: Build) => Build) => void;
  showInactive?: boolean;
  /** Nivel necesario (ya con los efectos de Legacy). Solo en clases. */
  level?: number;
  firstPoint?: { level: number; fromLegacy: boolean };
}) {
  const [focus, setFocus] = useState<Focus | null>(null);
  const { add, remove, resetTree } = useBuildActions(idx, setBuild);
  const total = totalPoints(build);
  const max = idx.data.rules.maxPoints;
  const isClass = idx.data.kind === "class";
  return (
    <>
      <div className="panel-head">
        <h3>{isClass ? "Talentos" : "Ventajas de Puntos de Legado"}</h3>
        <span className="split" title="Puntos por árbol">
          {idx.data.specs.map((s) => specPoints(idx, build, s.index)).join(" / ")}
        </span>
        <span className="left">
          Puntos restantes <b>{max - total}</b>
        </span>
        {isClass && (
          <span className="lvl">
            {firstPoint && (
              <span className={firstPoint.fromLegacy ? "first-point from-legacy" : "first-point"} title="Nivel al que consigues el primer punto de talento">
                Primer punto: nivel {firstPoint.level}
                {firstPoint.fromLegacy ? " (Talentoso)" : ""}
              </span>
            )}
            <span>
              Nivel necesario <b>{level ?? requiredLevel(idx, total)}</b>
            </span>
          </span>
        )}
      </div>

      <div className="trees">
        {idx.data.specs.map((s) => (
          <TreePanel key={s.index} idx={idx} build={build} specIndex={s.index} focus={focus} onFocus={setFocus} onAdd={add} onRemove={remove} onResetTree={resetTree} />
        ))}
      </div>
      <Detail idx={idx} build={build} focus={focus} onAdd={add} onRemove={remove} />

      {showInactive && idx.data.inactiveTalents.length > 0 && (
        <section className="inactive-section" aria-labelledby="inactive-title">
          <h3 id="inactive-title">Nodos no activos ({idx.data.inactiveTalents.length})</h3>
          <p className="muted small">El cliente los incluye pero no forman parte de la rejilla: se muestran para observarlos; no se pueden seleccionar ni cuentan.</p>
          <div className="inactive-list">
            {idx.data.inactiveTalents.map((t) => (
              <div key={t.nodeId} className="inactive-item">
                <button
                  type="button"
                  className="talent inactive"
                  aria-disabled="true"
                  aria-label={`${t.name ?? "Talento"}: nodo no activo, no seleccionable`}
                  data-node={t.nodeId}
                  onMouseEnter={(e) => setFocus({ kind: "inactive", nodeId: t.nodeId, anchor: anchorOf(e.currentTarget) })}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={(e) => setFocus({ kind: "inactive", nodeId: t.nodeId, anchor: anchorOf(e.currentTarget) })}
                  onBlur={() => setFocus(null)}
                  onClick={(e) => setFocus({ kind: "inactive", nodeId: t.nodeId, anchor: anchorOf(e.currentTarget) })}
                >
                  <Icon id={t.iconFileDataId} name={t.name} />
                  <span className="rank">0/{t.maxRank}</span>
                </button>
                <span className="inactive-name">{t.name ?? `Hechizo ${t.spellId}`}</span>
                <span className="tag tag-inactive">nodo no activo</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Resumen (en construccion): lo escogido en clase y Legacy, en el rango de nivel que corresponde a los puntos gastados. */
interface GearInSummary {
  summary: ReturnType<typeof summarizeGear>;
  ratings: CombatRatings | null;
  /** Nivel minimo al que se puede llevar todo (el mayor requiredLevel): las columnas de nivel menor no llevan equipo. */
  minLevel: number;
}

function Summary({ idx, summary, legacyLoaded, race, manifest, classBuild, legacy, legacyBuild, gear, gearLoading }: { idx: ClassIndex; summary: ReturnType<typeof summarizeCharacter>; legacyLoaded: boolean; race: Race | null; manifest: Manifest; classBuild: Build; legacy: ClassIndex | null; legacyBuild: Build; gear: GearInSummary | null; gearLoading: boolean }) {
  const minLevel = summary.classPoints === 0 ? 1 : summary.requiredLevel;
  // Un solo nivel para las estadisticas y las habilidades
  const [level, setLevel] = useState(60);
  // Todas las secciones empiezan contraidas; el usuario abre las que quiere (o todas a la vez)
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const section = (id: string, title: string, children: ReactNode, note?: string) => (
    <Collapsible key={id} title={title} note={note} open={!!open[id]} onToggle={(v) => setOpen((o) => ({ ...o, [id]: v }))}>
      {children}
    </Collapsible>
  );
  const { fx } = useStatEffects({ manifest, cls: idx, classBuild, legacy, legacyBuild, race });
  const ids = ["stats", "abilities"];
  const setAll = (v: boolean) => setOpen(Object.fromEntries(ids.map((i) => [i, v])));
  return (
    <section className="summary-view">
      <div className="panel-head">
        <h3>Resumen</h3>
        <span className="left">
          Clase <b>{summary.classPoints}/{summary.classMax}</b> · Puntos de Legado <b>{summary.legacyPoints}/{summary.legacyMax}</b>
        </span>
        <span className="lvl">
          Rango de nivel <b>{minLevel}–60</b>
        </span>
      </div>
      <p className="muted small">
        {summary.firstPointFromLegacy && `Con Talentoso (Puntos de Legado) el primer punto de talento llega al nivel ${summary.firstPointLevel}. `}
        Los efectos valen desde el nivel {minLevel} (el que exigen los {summary.classPoints} puntos de clase gastados) hasta el 60. Las ventajas de Puntos de Legado no dependen del nivel: se ganan con desafíos de cuenta.
      </p>
      <LevelPicker level={level} setLevel={setLevel} minLevel={minLevel} />
      <div className="summary-toolbar">
        <button type="button" onClick={() => setAll(true)}>Expandir todo</button>
        <button type="button" onClick={() => setAll(false)}>Contraer todo</button>
      </div>

      {section("stats", "Estadísticas base", <StatsTable manifest={manifest} raceId={race?.id ?? null} raceName={race?.name ?? null} classId={idx.data.classId} level={level} fx={fx} gear={gear ? { stats: gear.summary.stats, minLevel: gear.minLevel } : null} />)}
      {section("abilities", "Habilidades con tus talentos", <AbilitiesTable manifest={manifest} idx={idx} build={classBuild} legacy={legacy} legacyBuild={legacyBuild} race={race} level={level} gear={gear ? { stats: gear.summary.stats, ratings: gear.ratings, minLevel: gear.minLevel } : null} />)}
      <p className="pending-note">
        En construcción: falta calcular el daño final con el poder con hechizos (depende de las reglas de atributos de Forever, que no están en el cliente).
      </p>
    </section>
  );
}

/** Seccion del Resumen que se puede contraer (nativa: <details>); el contenido sigue montado aunque este cerrada. */
function Collapsible({ title, note, open, onToggle, children }: { title: string; note?: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <details className="summary-block collapsible" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <h4>{title}</h4>
        {note !== undefined && <span className="rank-chip">{note}</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}

