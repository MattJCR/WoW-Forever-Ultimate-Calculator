import {
  addPoint,
  decodeBuildReport,
  decodeGear,
  encodeBuild,
  activeGearEffects,
  encodeGear,
  equippedStateOf,
  formatBuildForAI,
  indexClass,
  rankOf,
  removePoint,
  requiredLevel,
  specPoints,
  splitByLevel,
  summarizeCharacter,
  summarizeGear,
  totalPoints,
  type Build,
  type ClassIndex,
  type DecodeReport,
  type GearContext,
  type GearData,
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
import { ConditionalEffects, useStatEffects } from "../components/StatEffects";
import { Icon } from "../components/Icon";
import { LinkNotice } from "../components/LinkNotice";
import { RacialList, RacialTip, racialLine } from "../components/RaceBonuses";
import { StatsTable } from "../components/StatsTable";
import { TreePanel, type Focus } from "../components/TreePanel";
import { CLASS_COLORS, loadClass, loadRaces, useAsync } from "../data";
import { classLabel, localizeClass, raceLabel, registerRaces, registerTalents, talentName, tr, treeLabel } from "../i18n";
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
const factionLabel = (f: keyof typeof FACTION_LABEL): string => tr(FACTION_LABEL[f]);

export function ClassPage({ token, entry, query }: { token: string; entry: Entry; query: URLSearchParams }) {
  const state = useAsync(entry.file, () => loadClass(entry.file));
  if (state.status === "loading") return <p className="status">{tr("Cargando {name}…", { name: classLabel(token, entry.className ?? token) })}</p>;
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
  registerTalents(data);
  if (legacy) registerTalents(legacy.data);
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
  registerRaces(races);
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
      say(tr("Enlace copiado"));
    } catch {
      window.prompt(tr("Copia el enlace:"), window.location.href);
    }
  };

  const copyForAI = async () => {
    if (hasGear && gearBundle?.status !== "ready") return say(tr("Cargando los datos del equipo; inténtalo de nuevo en un momento"));
    const text = formatBuildForAI({
      cls: indexClass(localizeClass(data)),
      classBuild,
      legacy: legacy ? indexClass(localizeClass(legacy.data)) : legacy,
      legacyBuild,
      link: window.location.href,
      dataLink: new URL(`${import.meta.env.BASE_URL}data/classes/${token}.json`, window.location.href).href,
      hotfixesApplied: manifest.hotfixesApplied,
      raceName: race ? raceLabel(race.id, race.name) : null,
      racials: race?.racials.map((a) => ({ name: a.name, kind: a.kind, description: racialLine(a, data.classId) })),
      gearLines:
        hasGear && gearSummary && gearBundle?.status === "ready"
          ? gearLinesForAI({ gear, summary: gearSummary, data: gearBundle.value.data, ratings: gearBundle.value.ratings, level: gearLevel, code: gearCode })
          : undefined,
    });
    if (!text) return say(tr("Gasta algunos puntos o elige equipo primero"));
    try {
      await navigator.clipboard.writeText(text);
      say(tr("Build copiado con el texto completo de cada talento y tu equipo. Pégalo en tu IA con una pregunta."));
    } catch {
      window.prompt(tr("Copia el texto:"), text);
    }
  };

  const reset = () => {
    if (!window.confirm(tr("¿Reiniciar este personaje? Se borrarán los talentos, los Puntos de Legado y el equipo (la raza se conserva)."))) return;
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
    race: { sub: race ? raceLabel(race.id, race.name) : tr("Sin elegir"), done: !!race },
    legacy: { sub: legacy ? `${legacyTotal}/${legacy.data.rules.maxPoints}` : "…", done: legacyTotal > 0 },
    talents: { sub: `${classTotal}/${idx.data.rules.maxPoints}`, done: classTotal > 0 },
    gear: { sub: tr("{n}/{max} piezas", { n: gearCount, max: GEAR_SLOTS }), done: gearCount > 0 },
    summary: { sub: tr("Estadísticas y daño"), done: false },
  };

  const share = <ShareCard url={url} onCopy={copyLink} rawHref={`${import.meta.env.BASE_URL}data/classes/${token}.json`} />;
  const sheetNav = <StepNav view={view} onGo={goTop} className="in-sheet" />;

  return (
    <div className={`class-page${view === "talents" || view === "legacy" ? " has-sheet" : ""}`} style={{ ["--accent" as string]: color }}>
      <ClassSwitcher current={token} legacyCode={legacyCode} raceQuery={raceQuery} manifest={manifest} />
      <CharacterBar
        className={classLabel(token, data.className ?? token)}
        iconId={data.iconFileDataId ?? null}
        raceLabel={race ? `${raceLabel(race.id, race.name)} · ${factionLabel(race.faction)}` : null}
        legacyLabel={legacy ? `${legacyTotal}/${legacy.data.rules.maxPoints}` : null}
        gearLabel={`${gearCount}/${GEAR_SLOTS}`}
        onGo={go}
        onReset={reset}
        canReset={classTotal + legacyTotal > 0 || hasGear}
        onCopyAI={copyForAI}
        onCopyLink={copyLink}
      />
      <Stepper view={view} onGo={go} status={status} />
      <LinkNotice title={classLabel(token, data.className ?? token)} report={initial && (initial.lost.length > 0 || initial.malformed) ? initial : null} />
      <LinkNotice title={tr("Puntos de Legado")} report={legacyReport} />

      {view === "race" && (
        <RaceStep
          races={races}
          race={race}
          onRace={setRaceId}
          className={classLabel(token, data.className ?? token)}
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
            title={tr("Puntos de Legado")}
            lead={tr("Ventajas de cuenta que se eligen antes que los talentos: Talentoso adelanta el primer punto de talento.")}
            share={share}
            footer={<StepNav view={view} onGo={goTop} />}
            sheetFooter={sheetNav}
          />
        ) : (
          <p className="status">{tr("Cargando Puntos de Legado…")}</p>
        ))}
      {view === "talents" && (
        <Workspace
          key="class"
          idx={idx}
          build={classBuild}
          setBuild={setClassBuild}
          title={tr("Talentos")}
          lead={classTotal === 0 ? tr("Sin puntos gastados. Elige un talento para empezar tu build.") : undefined}
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
          <GearStep bundle={gearBundle} gear={gear} setGear={setGear} ctx={gearCtx} setLevel={setGearLevel} summary={gearSummary} raceName={race ? raceLabel(race.id, race.name) : null} />
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
          referenceRace={races[0] ?? null}
          gear={hasGear && gearBundle?.status === "ready" ? { selection: gear, data: gearBundle.value.data, ctx: gearCtx, ratings: gearBundle.value.ratings } : null}
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
      <label htmlFor="share-url">{tr("Enlace de tu build")}</label>
      <div className="share-row">
        <input id="share-url" className="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={onCopy}>
          {tr("Copiar")}
        </button>
      </div>
      <a href={rawHref} target="_blank" rel="noreferrer" title={tr("Esta clase como JSON: cada talento a cada rango")}>
        {tr("Descargar datos en bruto de la clase")}
      </a>
    </div>
  );
}

/** Paso 1: la raza, entre las que el cliente permite para la clase (CharBaseInfo). Lista a la izquierda y raciales de la elegida a la derecha. */
function RaceStep({ races, race, onRace, className, classId, loading, onGo }: { races: Race[]; race: Race | null; onRace: (id: number | null) => void; className: string; classId: number; loading: boolean; onGo: (v: View) => void }) {
  return (
    <div className="step-layout race-step">
      <section className="step-main" aria-label={tr("Razas disponibles")}>
        <header className="step-head">
          <h2>{tr("Elige tu raza")}</h2>
          <p>{tr("Estas son las {n} razas que el cliente permite para {className}. La raza decide tus estadísticas base y tus habilidades raciales.", { n: races.length, className })}</p>
        </header>
        {loading ? (
          <p className="status">{tr("Cargando razas…")}</p>
        ) : (
          (["alliance", "horde"] as const).map((f) => (
            <div key={f} className={`race-faction ${f}`}>
              <h3>
                <span className="faction-mark" aria-hidden="true" />
                {factionLabel(f)}
              </h3>
              <ul className="race-cards">
                {races
                  .filter((r) => r.faction === f)
                  .map((r) => (
                    <li key={r.id}>
                      <button type="button" className={`race-card${race?.id === r.id ? " on" : ""}`} aria-pressed={race?.id === r.id} onClick={() => onRace(r.id)}>
                        <span className="race-card-top">
                          <span className="race-name">{raceLabel(r.id, r.name)}</span>
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
                            <RacialTip key={a.order} a={a} classId={classId} raceId={r.id}>
                              <Icon id={a.iconFileDataId} name={a.name} />
                            </RacialTip>
                          ))}
                        </span>
                        <span className="race-count">{tr("{n} habilidades raciales", { n: r.racials.length })}</span>
                      </button>
                    </li>
                  ))}
                {races.every((r) => r.faction !== f) && <li className="muted small">{tr("Ninguna raza de esta facción puede ser {className}.", { className })}</li>}
              </ul>
            </div>
          ))
        )}
        <StepNav
          view="race"
          onGo={onGo}
          leading={
            <button type="button" className="btn btn-ghost" onClick={() => onRace(null)} disabled={!race}>
              {tr("Quitar raza")}
            </button>
          }
        />
      </section>

      <aside className="card race-detail" aria-label={tr("Habilidades raciales")} aria-live="polite">
        {race ? (
          <>
            <div className="race-detail-head">
              <h3>{raceLabel(race.id, race.name)}</h3>
              <span className="chip">{factionLabel(race.faction)}</span>
            </div>
            <h5>{tr("Habilidades raciales")}</h5>
            <RacialList race={race} classId={classId} />
            <div className="race-detail-foot">
              <span className="chip">
                <span className="dot dot-client" />
                {tr("Texto del cliente")}
              </span>
              <p className="muted small">
                {tr("Texto y cifras de las raciales tal como los da el cliente de la beta. Las estadísticas base de esta raza aparecen en el paso")}{" "}
                <button type="button" className="link-btn" onClick={() => onGo("summary")}>
                  {tr("Resumen")}
                </button>
                .
              </p>
            </div>
          </>
        ) : (
          !loading && (
            <>
              <h3 className="race-detail-empty">{tr("Habilidades raciales")}</h3>
              <p className="muted">{tr("Elige una raza para ver sus habilidades raciales y las estadísticas base del Resumen.")}</p>
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
      <h3>{tr("Puntos por árbol")}</h3>
      <ul className="bars">
        {idx.data.specs.map((s) => {
          const n = specPoints(idx, build, s.index);
          return (
            <li key={s.index} title={treeLabel(idx.data, s.index, s.name ?? "")}>
              <Icon id={s.iconFileDataId} name={treeLabel(idx.data, s.index, s.name ?? "")} />
              <span className="bars-name">{treeLabel(idx.data, s.index, s.name ?? "")}</span>
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
              {tr("Puntos restantes")} <b className="good">{max - total}</b>
            </span>
            {isClass && (
              <>
                <span className="pill">
                  {tr("Nivel necesario")} <b>{level ?? requiredLevel(idx, total)}</b>
                </span>
                {firstPoint && (
                  <span className={`pill${firstPoint.fromLegacy ? " pill-legacy" : ""}`} title={tr("Nivel al que consigues el primer punto de talento")}>
                    {tr("Primer punto")} <b>{tr("nivel {n}", { n: firstPoint.level })}</b>
                    {firstPoint.fromLegacy && <small>({tr("Talentoso")})</small>}
                  </span>
                )}
              </>
            )}
          </div>
          {lead && <p>{lead}</p>}
          <p className="how-to">
            {isClass ? tr("Toca un talento para gastar un punto y ver su detalle. Para quitar un punto usa el botón − del panel.") : tr("Toca una ventaja para gastar un punto y ver su detalle. Para quitar un punto usa el botón − del panel.")}
            <span className="mouse-only"> {tr("Con ratón: clic derecho o Supr quitan, Mayús + clic sube al máximo.")}</span>
          </p>
        </header>

        <ul className="legend" aria-label={tr("Leyenda de los talentos")}>
          <li>
            <span className="swatch swatch-maxed" />
            {tr("Rango máximo")}
          </li>
          <li>
            <span className="swatch swatch-partial" />
            {tr("Con puntos")}
          </li>
          <li>
            <span className="swatch swatch-available" />
            {tr("Disponible")}
          </li>
          <li>
            <span className="swatch swatch-locked" />
            {tr("Bloqueado")}
          </li>
        </ul>

        <div className="tree-tabs" role="group" aria-label={tr("Árbol que se muestra")}>
          {idx.data.specs.map((s) => (
            <button key={s.index} type="button" className="tree-tab" aria-pressed={tab === s.index} onClick={() => setTab(s.index)}>
              <b>{treeLabel(idx.data, s.index, s.name ?? "")}</b>
              <small>{tr("{n} puntos", { n: specPoints(idx, build, s.index) })}</small>
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
              <h3 id="inactive-title">{tr("Nodos no activos")} ({idx.data.inactiveTalents.length})</h3>
              <span className="chip">{tr("No seleccionables")}</span>
            </summary>
            <div className="inactive-body">
              <p className="muted small">{tr("El cliente los incluye pero no forman parte de la rejilla: se muestran para observarlos; no se pueden seleccionar ni cuentan.")}</p>
              <div className="inactive-list">
                {idx.data.inactiveTalents.map((t) => (
                  <div key={t.nodeId} className="inactive-item">
                    <button
                      type="button"
                      className="talent inactive"
                      aria-disabled="true"
                      aria-label={tr("{name}: nodo no activo, no seleccionable", { name: talentName(t.nodeId, t.name ?? tr("Talento")) })}
                      data-node={t.nodeId}
                      onMouseEnter={() => setHover({ kind: "inactive", nodeId: t.nodeId })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ kind: "inactive", nodeId: t.nodeId })}
                      onBlur={() => setHover(null)}
                      onClick={() => setPicked({ kind: "inactive", nodeId: t.nodeId })}
                    >
                      <Icon id={t.iconFileDataId} name={talentName(t.nodeId, t.name ?? "")} />
                      <span className="rank">0/{t.maxRank}</span>
                    </button>
                    <span className="inactive-name">{talentName(t.nodeId, t.name ?? tr("Hechizo {id}", { id: t.spellId }))}</span>
                    <span className="tag tag-inactive">{tr("nodo no activo")}</span>
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}

        <div className="step-nav-main">{footer}</div>
      </section>

      <aside className="workspace-rail" aria-label={tr("Detalle del talento")}>
        <TalentInspector idx={idx} build={build} shown={shown} onAdd={add} onRemove={remove} footer={<div className="sheet-nav">{sheetFooter}</div>} />
        <BuildCard idx={idx} build={build} share={share} />
      </aside>
    </div>
  );
}

/** Equipo que llega al Resumen: la selección y los datos, para contar cada objeto desde su propio nivel al nivel elegido. */
interface GearInSummary {
  selection: GearSelection;
  data: GearData;
  ctx: GearContext;
  ratings: CombatRatings | null;
}

function Summary({ idx, summary, legacyLoaded, race, referenceRace, manifest, classBuild, legacy, legacyBuild, gear, gearLoading, onGo }: { idx: ClassIndex; summary: ReturnType<typeof summarizeCharacter>; legacyLoaded: boolean; race: Race | null; /** Raza con la que se calculan los atributos si no se ha elegido ninguna (la primera que admite la clase). */ referenceRace: Race | null; manifest: Manifest; classBuild: Build; legacy: ClassIndex | null; legacyBuild: Build; gear: GearInSummary | null; gearLoading: boolean; onGo: (v: View) => void }) {
  const minLevel = summary.classPoints === 0 ? 1 : summary.requiredLevel;
  // Un solo nivel para las estadisticas y las habilidades
  const [level, setLevel] = useState(60);
  // Cada objeto cuenta desde su propio nivel necesario: al nivel elegido solo suman los que ya se pueden llevar
  const gearAt = useMemo(() => {
    if (!gear) return null;
    const summaryAtLevel = summarizeGear(gear.selection, gear.ctx, gear.data, { countLevel: level });
    const { counted } = splitByLevel(gear.selection, gear.data.items, level);
    return { summary: summaryAtLevel, ratings: gear.ratings, effects: activeGearEffects(counted, gear.data), equipped: equippedStateOf(counted, gear.data) };
  }, [gear, level]);
  const { fx, loading: fxLoading } = useStatEffects({ manifest, cls: idx, classBuild, legacy, legacyBuild, race, gearEffects: gearAt?.effects, equipped: gearAt?.equipped ?? null });
  // Sin raza elegida, los atributos base se toman de una raza de referencia (sin sus raciales): estimación marcada
  const statsRace = race ?? referenceRace;
  return (
    <section className="summary-view">
      <header className="step-head">
        <h2>{tr("Así queda tu personaje")}</h2>
        <p>{tr("Estadísticas y daño con tus talentos, Puntos de Legado, raza y equipo. Cambia el nivel para ver cómo escala.")}</p>
      </header>
      <LevelPicker level={level} setLevel={setLevel} minLevel={minLevel}>
        {summary.firstPointFromLegacy && `${tr("Con Talentoso (Puntos de Legado) el primer punto de talento llega al nivel {n}.", { n: summary.firstPointLevel })} `}
        {summary.classPoints === 0
          ? `${tr("Aún no has gastado puntos de talento: puedes ver cualquier nivel del 1 al 60.")} `
          : `${tr("Los efectos valen desde el nivel {min} (el que exigen los {n} puntos de clase gastados) hasta el 60.", { min: minLevel, n: summary.classPoints })} `}
        {tr("Las ventajas de Puntos de Legado no dependen del nivel: se ganan con desafíos de cuenta.")}
      </LevelPicker>

      <div className="notice notice-info" role="note">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
        <p>
          <b>{tr("Cómo leer las cifras.")}</b> {tr("Las cifras de cada habilidad y lo que suman los talentos salen del cliente. El poder con hechizos y de ataque, el crítico, el fallo y los golpes de las armas siguen las reglas de Classic, que Forever no ha confirmado: son estimaciones y cada tarjeta lo marca.")}
        </p>
      </div>

      <div className="summary-cols">
        <section className="card stats-card" aria-label={tr("Estadísticas")}>
          <header>
            <h3>{tr("Estadísticas")}</h3>
            <p className="muted small">{tr("A nivel {level}. En verde, lo que suman talentos, raza y equipo.", { level })}</p>
          </header>
          <StatsTable manifest={manifest} raceId={statsRace?.id ?? null} raceName={statsRace ? raceLabel(statsRace.id, statsRace.name) : null} raceIsReference={!race && !!referenceRace} classId={idx.data.classId} level={level} fx={fx} fxReady={!fxLoading} gear={gearAt ? { stats: gearAt.summary.stats, armor: gearAt.summary.armor, bonusArmor: gearAt.summary.bonusArmor, ratings: gearAt.ratings, weapons: gearAt.summary.weapons, uncounted: gearAt.summary.uncounted } : null} />
          {fx && !fxLoading && <ConditionalEffects fx={fx} />}
        </section>
        <section className="abilities-card" aria-label={tr("Habilidades")}>
          <header>
            <h3>{tr("Habilidades con tus talentos")}</h3>
            <p className="muted small">{tr("Cada tarjeta indica qué talentos, Puntos de Legado o piezas la mejoran.")}</p>
          </header>
          <AbilitiesTable manifest={manifest} idx={idx} build={classBuild} legacy={legacy} legacyBuild={legacyBuild} race={race} statsRaceId={statsRace?.id ?? null} level={level} gear={gearAt ? { stats: gearAt.summary.stats, ratings: gearAt.ratings, effects: gearAt.effects, weapons: gearAt.summary.weapons, equipped: gearAt.equipped } : null} />
        </section>
      </div>
      <StepNav view="summary" onGo={onGo} />
    </section>
  );
}
