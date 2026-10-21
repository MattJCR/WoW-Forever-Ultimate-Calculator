import {
  addPoint,
  decodeBuildReport,
  decodeGear,
  encodeBuild,
  activeGearEffects,
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
  type GearEffectSource,
  type ClassIndex,
  type DecodeReport,
  type GearContext,
  type GearSelection,
} from "@wfuc/engine";
import type { ClassTalents, CombatRatings, Manifest, Race } from "@wfuc/schema";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isEmptyCode, useCharacter } from "../character";
import { TalentInspector } from "../components/Detail";
import { AbilitiesTable } from "../components/Abilities";
import { CharacterBar, ClassSwitcher, isView, StepNav, Stepper, type StepStatus, type View } from "../components/ClassShell";
import { GearStep, useGearBundle } from "../components/Gear";
import { gearLinesForAI } from "../components/gear-format";
import { LevelPicker } from "../components/LevelPicker";
import { useStatEffects } from "../components/StatEffects";
import { Icon } from "../components/Icon";
import { LinkNotice } from "../components/LinkNotice";
import { RacialList, RacialTip, racialLine } from "../components/RaceBonuses";
import { StatsTable } from "../components/StatsTable";
import { TreePanel, type Focus } from "../components/TreePanel";
import { CLASS_COLORS, loadClass, loadRaces, useAsync } from "../data";
import { parseHash, replaceHash } from "../router";

type Entry = Manifest["classes"][number];
const GEAR_STORAGE_PREFIX = "wfuc.gear.";
const GEAR_SLOTS = 19;
const LEGACY_ACCENT = "#c9a7ff";

/** Último equipo de esta clase guardado en el navegador (`{ g, gl }`); vacío si no hay o el almacenamiento está bloqueado. */
function readStoredGear(token: string): { g: string | null; gl: string | null } {
  try {
    const raw = window.localStorage.getItem(`${GEAR_STORAGE_PREFIX}${token}`);
    const v = raw ? (JSON.parse(raw) as { g?: unknown; gl?: unknown }) : null;
    return { g: typeof v?.g === "string" ? v.g : null, gl: typeof v?.gl === "number" ? String(v.gl) : null };
  } catch {
    return { g: null, gl: null };
  }
}

const DEFAULT_GEAR_LEVEL = 60;
const FACTION_LABEL = { alliance: "Alianza", horde: "Horda" } as const;

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
  // Si el enlace no trae equipo, se recupera el último de esta clase guardado en el navegador (el enlace manda siempre)
  const [initialGearSource] = useState(() => (query.get("g") !== null ? { g: query.get("g"), gl: query.get("gl") } : readStoredGear(token)));
  const [initialGear] = useState(() => decodeGear(initialGearSource.g));
  const [gear, setGearState] = useState<GearSelection>(initialGear.gear);
  const [gearLevel, setGearLevel] = useState(() => Math.max(1, Math.min(60, Number(initialGearSource.gl) || DEFAULT_GEAR_LEVEL)));
  const setGear = useCallback((update: (g: GearSelection) => GearSelection) => setGearState((g) => update(g)), []);
  const gearCode = useMemo(() => encodeGear(gear), [gear]);
  const hasGear = gearCode !== "";
  useEffect(() => {
    try {
      window.localStorage.setItem(`${GEAR_STORAGE_PREFIX}${token}`, JSON.stringify({ g: gearCode, gl: gearLevel }));
    } catch {
      /* sin almacenamiento: solo se pierde la comodidad */
    }
  }, [token, gearCode, gearLevel]);
  // Los objetos pesan unos 7 MB: solo se descargan al entrar al paso Equipo o si el enlace ya trae equipo
  const gearBundle = useGearBundle(manifest, view === "gear" || hasGear);
  const gearCtx: GearContext = useMemo(() => ({ classId: data.classId, raceId: race?.id ?? 0, level: gearLevel }), [data.classId, race, gearLevel]);
  const gearSummary = useMemo(() => (gearBundle?.status === "ready" ? summarizeGear(gear, gearCtx, gearBundle.value.data) : null), [gearBundle, gear, gearCtx]);
  const gearEffects = useMemo(() => (gearBundle?.status === "ready" ? activeGearEffects(gear, gearBundle.value.data) : []), [gearBundle, gear]);
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
  const gearCount = Object.keys(gear).length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      say("Enlace copiado");
    } catch {
      window.prompt("Copia el enlace:", window.location.href);
    }
  };

  const copyForAI = async () => {
    if (hasGear && gearBundle?.status !== "ready") return say("Cargando los datos del equipo; inténtalo de nuevo en un momento");
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
      gearLines:
        hasGear && gearSummary && gearBundle?.status === "ready"
          ? gearLinesForAI({ gear, summary: gearSummary, data: gearBundle.value.data, ratings: gearBundle.value.ratings, level: gearLevel, code: gearCode })
          : undefined,
    });
    if (!text) return say("Gasta algunos puntos o elige equipo primero");
    try {
      await navigator.clipboard.writeText(text);
      say("Build copiado con el texto completo de cada talento y tu equipo. Pégalo en tu IA con una pregunta.");
    } catch {
      window.prompt("Copia el texto:", text);
    }
  };

  const reset = () => {
    if (!window.confirm("¿Reiniciar este personaje? Se borrarán los talentos, los Puntos de Legado y el equipo (la raza se conserva).")) return;
    setClassBuild({});
    setLegacyBuild(() => ({}));
    setGearState({});
  };

  const go = (v: View) => setView(v);
  // Anterior / Siguiente del final de cada paso: al cambiar se vuelve arriba para empezar el paso nuevo desde su cabecera
  const goTop = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  const status: Record<View, StepStatus> = {
    race: { sub: race?.name ?? "Sin elegir", done: !!race },
    legacy: { sub: legacy ? `${legacyTotal}/${legacy.data.rules.maxPoints}` : "…", done: legacyTotal > 0 },
    talents: { sub: `${classTotal}/${idx.data.rules.maxPoints}`, done: classTotal > 0 },
    gear: { sub: `${gearCount}/${GEAR_SLOTS} piezas`, done: gearCount > 0 },
    summary: { sub: "Estadísticas y daño", done: false },
  };

  const share = <ShareCard url={url} onCopy={copyLink} rawHref={`${import.meta.env.BASE_URL}data/classes/${token}.json`} />;
  const sheetNav = <StepNav view={view} onGo={goTop} className="in-sheet" />;

  return (
    <div className={`class-page${view === "talents" || view === "legacy" ? " has-sheet" : ""}`} style={{ ["--accent" as string]: color }}>
      <ClassSwitcher current={token} legacyCode={legacyCode} raceQuery={raceQuery} manifest={manifest} />
      <CharacterBar
        className={data.className ?? token}
        iconId={data.iconFileDataId ?? null}
        raceLabel={race ? `${race.name} · ${FACTION_LABEL[race.faction]}` : null}
        legacyLabel={legacy ? `${legacyTotal}/${legacy.data.rules.maxPoints}` : null}
        gearLabel={`${gearCount}/${GEAR_SLOTS}`}
        onGo={go}
        onReset={reset}
        canReset={classTotal + legacyTotal > 0 || hasGear}
        onCopyAI={copyForAI}
        onCopyLink={copyLink}
      />
      <Stepper view={view} onGo={go} status={status} />
      <LinkNotice title={data.className ?? token} report={initial && (initial.lost.length > 0 || initial.malformed) ? initial : null} />
      <LinkNotice title="Puntos de Legado" report={legacyReport} />

      {view === "race" && (
        <RaceStep
          races={races}
          race={race}
          onRace={setRaceId}
          className={data.className ?? token}
          classId={data.classId}
          loading={racesState.status === "loading"}
          onGo={goTop}
        />
      )}
      {view === "legacy" &&
        (legacy ? (
          <Workspace
            key="legacy"
            idx={legacy}
            build={legacyBuild}
            setBuild={setLegacyBuild}
            title="Puntos de Legado"
            lead="Ventajas de cuenta que se eligen antes que los talentos: Talentoso adelanta el primer punto de talento."
            share={share}
            footer={<StepNav view={view} onGo={goTop} />}
            sheetFooter={sheetNav}
          />
        ) : (
          <p className="status">Cargando Puntos de Legado…</p>
        ))}
      {view === "talents" && (
        <Workspace
          key="class"
          idx={idx}
          build={classBuild}
          setBuild={setClassBuild}
          title="Talentos"
          lead={classTotal === 0 ? "Sin puntos gastados. Elige un talento para empezar tu build." : undefined}
          showInactive
          level={summary.requiredLevel}
          firstPoint={{ level: summary.firstPointLevel, fromLegacy: summary.firstPointFromLegacy }}
          share={share}
          footer={<StepNav view={view} onGo={goTop} />}
          sheetFooter={sheetNav}
        />
      )}
      {view === "gear" && (
        <div className="gear-wrap">
          <GearStep bundle={gearBundle} gear={gear} setGear={setGear} ctx={gearCtx} setLevel={setGearLevel} summary={gearSummary} raceName={race?.name ?? null} />
          <StepNav view={view} onGo={goTop} />
        </div>
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
          gear={gearSummary && hasGear && gearBundle?.status === "ready" ? { summary: gearSummary, ratings: gearBundle.value.ratings, minLevel: gearMinLevel, effects: gearEffects } : null}
          gearLoading={hasGear && gearBundle?.status !== "ready"}
          onGo={goTop}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Enlace del build y datos en bruto de la clase. */
function ShareCard({ url, onCopy, rawHref }: { url: string; onCopy: () => void; rawHref: string }) {
  return (
    <div className="share">
      <label htmlFor="share-url">Enlace de tu build</label>
      <div className="share-row">
        <input id="share-url" className="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={onCopy}>
          Copiar
        </button>
      </div>
      <a href={rawHref} target="_blank" rel="noreferrer" title="Esta clase como JSON: cada talento a cada rango">
        Descargar datos en bruto de la clase
      </a>
    </div>
  );
}

/** Paso 1: la raza, entre las que el cliente permite para la clase (CharBaseInfo). Lista a la izquierda y raciales de la elegida a la derecha. */
function RaceStep({ races, race, onRace, className, classId, loading, onGo }: { races: Race[]; race: Race | null; onRace: (id: number | null) => void; className: string; classId: number; loading: boolean; onGo: (v: View) => void }) {
  return (
    <div className="step-layout race-step">
      <section className="step-main" aria-label="Razas disponibles">
        <header className="step-head">
          <h2>Elige tu raza</h2>
          <p>
            Estas son las <b>{races.length}</b> razas que el cliente permite para {className}. La raza decide tus estadísticas base y tus habilidades raciales.
          </p>
        </header>
        {loading ? (
          <p className="status">Cargando razas…</p>
        ) : (
          (["alliance", "horde"] as const).map((f) => (
            <div key={f} className={`race-faction ${f}`}>
              <h3>
                <span className="faction-mark" aria-hidden="true" />
                {FACTION_LABEL[f]}
              </h3>
              <ul className="race-cards">
                {races
                  .filter((r) => r.faction === f)
                  .map((r) => (
                    <li key={r.id}>
                      <button type="button" className={`race-card${race?.id === r.id ? " on" : ""}`} aria-pressed={race?.id === r.id} onClick={() => onRace(r.id)}>
                        <span className="race-card-top">
                          <span className="race-name">{r.name}</span>
                          {race?.id === r.id && (
                            <span className="race-check" aria-hidden="true">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12l5 5 9-10" />
                              </svg>
                            </span>
                          )}
                        </span>
                        <span className="race-icons">
                          {r.racials.map((a) => (
                            <RacialTip key={a.order} a={a} classId={classId}>
                              <Icon id={a.iconFileDataId} name={a.name} />
                            </RacialTip>
                          ))}
                        </span>
                        <span className="race-count">{r.racials.length} habilidades raciales</span>
                      </button>
                    </li>
                  ))}
                {races.every((r) => r.faction !== f) && <li className="muted small">Ninguna raza de esta facción puede ser {className}.</li>}
              </ul>
            </div>
          ))
        )}
        <StepNav
          view="race"
          onGo={onGo}
          leading={
            <button type="button" className="btn btn-ghost" onClick={() => onRace(null)} disabled={!race}>
              Quitar raza
            </button>
          }
        />
      </section>

      <aside className="card race-detail" aria-label="Habilidades raciales" aria-live="polite">
        {race ? (
          <>
            <div className="race-detail-head">
              <h3>{race.name}</h3>
              <span className="chip">{FACTION_LABEL[race.faction]}</span>
            </div>
            <h5>Habilidades raciales</h5>
            <RacialList race={race} classId={classId} />
            <div className="race-detail-foot">
              <span className="chip">
                <span className="dot dot-client" />
                Texto del cliente
              </span>
              <p className="muted small">
                Texto y cifras de las raciales tal como los da el cliente de la beta. Las estadísticas base de esta raza aparecen en el paso{" "}
                <button type="button" className="link-btn" onClick={() => onGo("summary")}>
                  Resumen
                </button>
                .
              </p>
            </div>
          </>
        ) : (
          !loading && (
            <>
              <h3 className="race-detail-empty">Habilidades raciales</h3>
              <p className="muted">Elige una raza para ver sus habilidades raciales y las estadísticas base del Resumen.</p>
            </>
          )
        )}
      </aside>
    </div>
  );
}

/** Puntos por arbol (con su icono) y enlace para compartir, en la columna de la derecha. */
function BuildCard({ idx, build, share }: { idx: ClassIndex; build: Build; share: ReactNode }) {
  const max = idx.data.rules.maxPoints;
  return (
    <section className="card build-card">
      <h3>Puntos por árbol</h3>
      <ul className="bars">
        {idx.data.specs.map((s) => {
          const n = specPoints(idx, build, s.index);
          return (
            <li key={s.index} title={s.name ?? undefined}>
              <Icon id={s.iconFileDataId} name={s.name} />
              <span className="bars-name">{s.name}</span>
              <span className="meter">
                <span style={{ width: `${Math.min(100, (n / max) * 100)}%` }} />
              </span>
              <b>{n}</b>
            </li>
          );
        })}
      </ul>
      {share}
    </section>
  );
}

/** Arboles + panel de detalle + nodos no activos de una calculadora (clase o Legacy). */
function Workspace({
  idx,
  build,
  setBuild,
  title,
  lead,
  showInactive = false,
  level,
  firstPoint,
  share,
  footer,
  sheetFooter,
}: {
  idx: ClassIndex;
  build: Build;
  setBuild: (u: (b: Build) => Build) => void;
  title: string;
  /** Frase bajo el titulo (que es este paso o que hacer). */
  lead?: string;
  showInactive?: boolean;
  /** Nivel necesario (ya con los efectos de Legacy). Solo en clases. */
  level?: number;
  firstPoint?: { level: number; fromLegacy: boolean };
  share: ReactNode;
  /** Anterior / Siguiente al final de la columna principal. */
  footer: ReactNode;
  /** Lo mismo, dentro del panel de detalle (en el movil el panel va fijo abajo y lleva los botones). */
  sheetFooter: ReactNode;
}) {
  // `hover`: talento bajo el cursor o el foco (vista previa); `picked`: el ultimo con el que se interactuo (queda fijo)
  const [hover, setHover] = useState<Focus | null>(null);
  const [picked, setPicked] = useState<Focus | null>(null);
  const { add, remove, resetTree } = useBuildActions(idx, setBuild);
  const total = totalPoints(build);
  const max = idx.data.rules.maxPoints;
  const isClass = idx.data.kind === "class";
  const shown = hover ?? picked;
  // En pantallas estrechas solo se ve un arbol: arranca el que ya tiene mas puntos
  const [tab, setTab] = useState(() => {
    let best = idx.data.specs[0]?.index ?? 0;
    let bestPoints = -1;
    for (const s of idx.data.specs) {
      const n = specPoints(idx, build, s.index);
      if (n > bestPoints) {
        best = s.index;
        bestPoints = n;
      }
    }
    return best;
  });

  return (
    <div className="workspace" style={isClass ? undefined : { ["--accent" as string]: LEGACY_ACCENT }}>
      <section className="workspace-main" aria-label={title}>
        <header className="step-head">
          <div className="step-head-row">
            <h2>{title}</h2>
            <span className="pill">
              Puntos restantes <b className="good">{max - total}</b>
            </span>
            {isClass && (
              <>
                <span className="pill">
                  Nivel necesario <b>{level ?? requiredLevel(idx, total)}</b>
                </span>
                {firstPoint && (
                  <span className={`pill${firstPoint.fromLegacy ? " pill-legacy" : ""}`} title="Nivel al que consigues el primer punto de talento">
                    Primer punto <b>nivel {firstPoint.level}</b>
                    {firstPoint.fromLegacy && <small>(Talentoso)</small>}
                  </span>
                )}
              </>
            )}
          </div>
          {lead && <p>{lead}</p>}
          <p className="how-to">
            Toca {isClass ? "un talento" : "una ventaja"} para gastar un punto y ver su detalle. Para quitar un punto usa el botón − del panel.
            <span className="mouse-only"> Con ratón: clic derecho o Supr quitan, Mayús + clic sube al máximo.</span>
          </p>
        </header>

        <ul className="legend" aria-label="Leyenda de los talentos">
          <li>
            <span className="swatch swatch-maxed" />
            Rango máximo
          </li>
          <li>
            <span className="swatch swatch-partial" />
            Con puntos
          </li>
          <li>
            <span className="swatch swatch-available" />
            Disponible
          </li>
          <li>
            <span className="swatch swatch-locked" />
            Bloqueado
          </li>
        </ul>

        <div className="tree-tabs" role="group" aria-label="Árbol que se muestra">
          {idx.data.specs.map((s) => (
            <button key={s.index} type="button" className="tree-tab" aria-pressed={tab === s.index} onClick={() => setTab(s.index)}>
              <b>{s.name}</b>
              <small>{specPoints(idx, build, s.index)} puntos</small>
            </button>
          ))}
        </div>

        <div className="trees">
          {idx.data.specs.map((s) => (
            <TreePanel
              key={s.index}
              idx={idx}
              build={build}
              specIndex={s.index}
              selected={picked}
              active={tab === s.index}
              onHover={setHover}
              onSelect={setPicked}
              onAdd={add}
              onRemove={remove}
              onResetTree={resetTree}
            />
          ))}
        </div>

        {showInactive && idx.data.inactiveTalents.length > 0 && (
          <details className="card inactive-section" open>
            <summary>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
              <h3 id="inactive-title">Nodos no activos ({idx.data.inactiveTalents.length})</h3>
              <span className="chip">No seleccionables</span>
            </summary>
            <div className="inactive-body">
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
                      onMouseEnter={() => setHover({ kind: "inactive", nodeId: t.nodeId })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ kind: "inactive", nodeId: t.nodeId })}
                      onBlur={() => setHover(null)}
                      onClick={() => setPicked({ kind: "inactive", nodeId: t.nodeId })}
                    >
                      <Icon id={t.iconFileDataId} name={t.name} />
                      <span className="rank">0/{t.maxRank}</span>
                    </button>
                    <span className="inactive-name">{t.name ?? `Hechizo ${t.spellId}`}</span>
                    <span className="tag tag-inactive">nodo no activo</span>
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}

        <div className="step-nav-main">{footer}</div>
      </section>

      <aside className="workspace-rail" aria-label="Detalle del talento">
        <TalentInspector idx={idx} build={build} shown={shown} onAdd={add} onRemove={remove} footer={<div className="sheet-nav">{sheetFooter}</div>} />
        <BuildCard idx={idx} build={build} share={share} />
      </aside>
    </div>
  );
}

/** Resumen (en construccion): lo escogido en clase y Legacy, en el rango de nivel que corresponde a los puntos gastados. */
interface GearInSummary {
  summary: ReturnType<typeof summarizeGear>;
  ratings: CombatRatings | null;
  /** Nivel minimo al que se puede llevar todo (el mayor requiredLevel): las columnas de nivel menor no llevan equipo. */
  minLevel: number;
  /** Bonos de conjunto y efectos al equipar activos. */
  effects: GearEffectSource[];
}

function Summary({ idx, summary, legacyLoaded, race, manifest, classBuild, legacy, legacyBuild, gear, gearLoading, onGo }: { idx: ClassIndex; summary: ReturnType<typeof summarizeCharacter>; legacyLoaded: boolean; race: Race | null; manifest: Manifest; classBuild: Build; legacy: ClassIndex | null; legacyBuild: Build; gear: GearInSummary | null; gearLoading: boolean; onGo: (v: View) => void }) {
  const minLevel = summary.classPoints === 0 ? 1 : summary.requiredLevel;
  // Un solo nivel para las estadisticas y las habilidades
  const [level, setLevel] = useState(60);
  // El equipo solo cuenta desde el nivel del objeto mas alto que llevas
  const gearEffects = gear && level >= gear.minLevel ? gear.effects : undefined;
  const { fx, loading: fxLoading } = useStatEffects({ manifest, cls: idx, classBuild, legacy, legacyBuild, race, gearEffects });
  return (
    <section className="summary-view">
      <header className="step-head">
        <h2>Así queda tu personaje</h2>
        <p>Estadísticas y daño con tus talentos, Puntos de Legado, raza y equipo. Cambia el nivel para ver cómo escala.</p>
      </header>
      <LevelPicker level={level} setLevel={setLevel} minLevel={minLevel}>
        {summary.firstPointFromLegacy && `Con Talentoso (Puntos de Legado) el primer punto de talento llega al nivel ${summary.firstPointLevel}. `}
        {summary.classPoints === 0
          ? "Aún no has gastado puntos de talento: puedes ver cualquier nivel del 1 al 60. "
          : `Los efectos valen desde el nivel ${minLevel} (el que exigen los ${summary.classPoints} puntos de clase gastados) hasta el 60. `}
        Las ventajas de Puntos de Legado no dependen del nivel: se ganan con desafíos de cuenta.
      </LevelPicker>

      <div className="notice notice-warn" role="note">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />
        </svg>
        <p>
          <b>En construcción.</b> El daño con poder con hechizos y de ataque es una estimación con las reglas de Classic (se ve en la tarjeta de cada habilidad). Falta confirmar en Forever las reglas de atributos, que no están en el cliente.
        </p>
      </div>

      <div className="summary-cols">
        <section className="card stats-card" aria-label="Estadísticas">
          <header>
            <h3>Estadísticas</h3>
            <p className="muted small">A nivel {level}. En verde, lo que suman talentos, raza y equipo.</p>
          </header>
          <StatsTable manifest={manifest} raceId={race?.id ?? null} raceName={race?.name ?? null} classId={idx.data.classId} level={level} fx={fx} fxReady={!fxLoading} gear={gear ? { stats: gear.summary.stats, minLevel: gear.minLevel, armor: gear.summary.armor, bonusArmor: gear.summary.bonusArmor, ratings: gear.ratings } : null} />
        </section>
        <section className="abilities-card" aria-label="Habilidades">
          <header>
            <h3>Habilidades con tus talentos</h3>
            <p className="muted small">Cada tarjeta indica qué talentos, Puntos de Legado o piezas la mejoran.</p>
          </header>
          <AbilitiesTable manifest={manifest} idx={idx} build={classBuild} legacy={legacy} legacyBuild={legacyBuild} race={race} level={level} gear={gear ? { stats: gear.summary.stats, ratings: gear.ratings, minLevel: gear.minLevel, effects: gear.effects, weapons: gear.summary.weapons } : null} />
        </section>
      </div>
      <StepNav view="summary" onGo={onGo} />
    </section>
  );
}
