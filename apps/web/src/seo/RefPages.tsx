// Páginas de consulta (talentos, habilidades y razas): contenido de solo lectura que sale de los datos del cliente.
// Son componentes puros: la web los pinta con los datos que descarga y el prerender los convierte en HTML con los mismos datos.
import { classProficiencies } from "@wfuc/engine";
import { EquipRules, type Abilities, type Ability, type AbilityRank, type BaseStats, type ClassTalents, type Manifest, type Race, type Talent } from "@wfuc/schema";
import { VIEWS } from "../components/ClassShell";
import { Icon } from "../components/Icon";
import { CLASS_COLORS, getJson, loadAbilities, loadClass, loadLegacy, loadRaces, STATIC_RACE_ICONS } from "../data";
import { abilityName, classLabel, currentLang, fmtNum, raceLabel, racialEn, specLabel, spellEn, talentName, talentText, tr } from "../i18n";
import { getSeoIndex, href } from "../router";
import { breadcrumbs, clip, plain, type PageMeta } from "./meta";
import { BaseStats as BaseStatsSchema } from "@wfuc/schema";
import { CALC_VIEWS, pagePath, type CalcView, type Page } from "./routes";
import { calcMeta, classMeta } from "./siteMeta";

/** Datos que necesita cada página de consulta (solo se rellena lo que su tipo pide). */
export interface RefData {
  manifest: Manifest;
  cls?: ClassTalents;
  abilities?: Abilities;
  races?: Race[];
  /** Reglas de equipar (paso Equipo). */
  rules?: EquipRules;
  /** Estadísticas base por clase y nivel (paso Resumen). */
  stats?: BaseStats;
  /** Árboles de Puntos de Legado (paso Legado). */
  legacy?: ClassTalents;
}

export const classTokenOf = (file: string): string => file.replace(/^classes\//, "").replace(/\.json$/, "");

/** Descarga lo que pide una página de consulta. */
export async function loadRefData(page: Page, manifest: Manifest): Promise<RefData> {
  const data: RefData = { manifest };
  const view = page.kind === "calc" ? page.view : null;
  if (page.kind === "races" || page.kind === "race" || view === "race") data.races = (await loadRaces(manifest.races.file)).races;
  const entry = "cls" in page ? manifest.classes.find((c) => classTokenOf(c.file) === page.cls) : undefined;
  if (!entry || !("cls" in page)) return data;
  const [cls, abilities, rules, stats, legacy] = await Promise.all([
    ["class", "class-talents", "talent", "ability"].includes(page.kind) || view === "talents" ? loadClass(entry.file) : undefined,
    ["class-abilities", "talent", "ability"].includes(page.kind) || view === "summary" ? loadAbilities(page.cls) : undefined,
    view === "gear" && manifest.equipRules ? getJson(manifest.equipRules.file, (v) => EquipRules.parse(v)) : undefined,
    view === "summary" ? getJson(manifest.stats.file, (v) => BaseStatsSchema.parse(v)) : undefined,
    view === "legacy" ? loadLegacy(manifest.legacy.file) : undefined,
  ]);
  return { ...data, cls, abilities, rules, stats, legacy };
}

// ---------- Textos y cifras ----------

const fmt = (n: number, digits = 0): string => fmtNum(n, digits);
const seconds = (ms: number): string => `${fmt(ms / 1000, 1)} s`;
const POWER: Record<string, string> = { mana: "maná", rage: "ira", energy: "energía", focus: "enfoque", other: "" };

const abilityLabel = (a: Ability): string => abilityName(a.ranks.map((r) => r.spellId), a.name);
const tokenOf = (data: RefData): string => classTokenOf(data.manifest.classes.find((c) => c.classId === (data.cls?.classId ?? data.abilities?.classId))?.file ?? "");
const classNameOf = (manifest: Manifest, token: string): string => classLabel(token, manifest.classes.find((c) => classTokenOf(c.file) === token)?.className ?? token);

/** Descripción de un rango: el inglés del juego con English elegido (si lo hay) y, si no, el texto del cliente. */
function rankText(r: AbilityRank): string {
  const en = currentLang() === "en" ? spellEn(r.spellId)?.description : undefined;
  return plain(en || r.description || "");
}

const costText = (r: AbilityRank): string => {
  if (r.cost !== null) return `${fmt(r.costType === "rage" ? r.cost / 10 : r.cost, 1)} ${tr(POWER[r.costType ?? "other"] ?? "")}`.trim();
  return r.costPctOfBase !== null ? tr("{n} % del maná base", { n: fmt(r.costPctOfBase, 1) }) : "—";
};
const castText = (r: AbilityRank): string => (r.channeled ? tr("Canalizado") : r.castMs === 0 ? tr("Instantáneo") : seconds(r.castMs));
const rangeText = (r: AbilityRank): string => (r.rangeYd === null ? "—" : r.rangeYd >= 1000 ? tr("Sin límite") : `${fmt(r.rangeYd)} m`);

const talentLabel = (t: Talent): string => talentName(t.nodeId, t.name ?? "");
const talentRankText = (t: Talent, i: number): string => plain(talentText(t.nodeId, i, t.descriptions[i] ?? "").text);

/** Talentos de la clase cuyo texto nombra una habilidad (para enlazar una con otras). */
function talentsMentioning(cls: ClassTalents, name: string, esName: string): Talent[] {
  const needles = [name, esName].filter((n) => n.length >= 5).map((n) => n.toLowerCase());
  return cls.specs
    .flatMap((s) => s.talents)
    .filter((t) => t.name && t.descriptions.some((d, i) => needles.some((n) => talentRankText(t, i).toLowerCase().includes(n) || d.toLowerCase().includes(n))));
}

/** Habilidades de la clase que un talento nombra en su texto. */
function abilitiesMentionedBy(abilities: Abilities, t: Talent): Ability[] {
  const text = t.descriptions.map((_, i) => talentRankText(t, i)).concat(t.descriptions).join(" ").toLowerCase();
  return abilities.abilities.filter((a) => {
    const names = [abilityLabel(a), a.name].filter((n) => n.length >= 5).map((n) => n.toLowerCase());
    return names.some((n) => text.includes(n));
  });
}

const sortedAbilities = (abilities: Abilities): Ability[] =>
  [...abilities.abilities].sort((a, b) => (a.ranks[0]?.level ?? 0) - (b.ranks[0]?.level ?? 0) || a.name.localeCompare(b.name));

// ---------- Metadatos ----------

/** Título, descripción y datos estructurados de una página de consulta. */
export function refMeta(page: Page, data: RefData): PageMeta {
  const index = getSeoIndex();
  const lang = currentLang();
  const path = (p: Page) => (index ? (pagePath(p, lang, index) ?? "") : "");
  const home = { name: "WoW Forever", path: path({ kind: "home" }) };
  const token = "cls" in page ? page.cls : tokenOf(data);
  const cname = token ? classNameOf(data.manifest, token) : "";
  const classCrumb = token ? [{ name: cname, path: path({ kind: "class", cls: token }) }] : [];

  switch (page.kind) {
    case "class":
      return classMeta(data.manifest, page.cls);
    case "calc":
      return calcMeta(data.manifest, page.cls, page.view);
    case "class-talents": {
      const n = data.cls?.specs.reduce((a, s) => a + s.talents.length, 0) ?? 0;
      const specs = data.cls?.specs.map((s) => specLabel(token, s.index, s.name ?? "")).join(", ") ?? "";
      return {
        title: tr("Talentos de {clase} en WoW Forever: lista completa", { clase: cname }),
        description: clip(tr("Los {n} talentos de {clase} ({specs}) con la descripción de cada rango, los requisitos y el nivel necesario. Datos del cliente de la beta de WoW Forever.", { n, clase: cname, specs })),
        jsonLd: [breadcrumbs([home, ...classCrumb, { name: tr("Talentos"), path: path(page) }])],
      };
    }
    case "talent": {
      const t = data.cls?.specs.flatMap((s) => s.talents).find((x) => x.nodeId === page.id);
      const spec = data.cls?.specs.find((s) => s.talents.some((x) => x.nodeId === page.id));
      const name = t ? talentLabel(t) : "";
      const specName = spec ? specLabel(token, spec.index, spec.name ?? "") : "";
      return {
        title: tr("{talento}: talento de {clase} ({arbol}) | WoW Forever", { talento: name, clase: cname, arbol: specName }),
        description: clip(`${tr("{talento}, talento de {clase} ({arbol}, hasta rango {n}):", { talento: name, clase: cname, arbol: specName, n: t?.maxRank ?? 1 })} ${t ? talentRankText(t, t.maxRank - 1) : ""}`),
        type: "article",
        jsonLd: [breadcrumbs([home, ...classCrumb, { name: tr("Talentos"), path: path({ kind: "class-talents", cls: token }) }, { name, path: path(page) }])],
      };
    }
    case "class-abilities": {
      const n = data.abilities?.abilities.length ?? 0;
      return {
        title: tr("Habilidades de {clase} en WoW Forever: rangos, coste y recarga", { clase: cname }),
        description: clip(tr("Las {n} habilidades de {clase} con todos sus rangos: nivel, coste, tiempo de lanzamiento, alcance y descripción. Datos del cliente de la beta de WoW Forever.", { n, clase: cname })),
        jsonLd: [breadcrumbs([home, ...classCrumb, { name: tr("Habilidades"), path: path(page) }])],
      };
    }
    case "ability": {
      const a = data.abilities?.abilities.find((x) => x.ranks[0]?.spellId === page.id);
      const name = a ? abilityLabel(a) : "";
      const last = a?.ranks[a.ranks.length - 1];
      return {
        title: tr("{habilidad}: habilidad de {clase} | WoW Forever", { habilidad: name, clase: cname }),
        description: clip(`${tr("{habilidad}, habilidad de {clase} (nivel {nivel}, {n} rangos):", { habilidad: name, clase: cname, n: a?.ranks.length ?? 0, nivel: a?.ranks[0]?.level ?? 1 })} ${last ? rankText(last) : ""}`),
        type: "article",
        jsonLd: [breadcrumbs([home, ...classCrumb, { name: tr("Habilidades"), path: path({ kind: "class-abilities", cls: token }) }, { name, path: path(page) }])],
      };
    }
    case "races":
      return {
        title: tr("Razas de WoW Forever: raciales y clases disponibles"),
        description: clip(tr("Las {n} razas jugables de WoW Forever con sus habilidades raciales y las clases que puede elegir cada una. Datos del cliente de la beta.", { n: data.races?.length ?? 0 })),
        jsonLd: [breadcrumbs([home, { name: tr("Razas"), path: path(page) }])],
      };
    case "race": {
      const r = data.races?.find((x) => x.id === page.id);
      const name = r ? raceLabel(r.id, r.name) : "";
      const racials = r?.racials.map((a, i) => racialEn(r.id, i)?.name ?? a.name).join(", ") ?? "";
      return {
        title: tr("{raza} en WoW Forever: raciales y clases | WoW Forever", { raza: name }),
        description: clip(tr("{raza} ({faccion}): raciales {racials} y clases disponibles. Datos del cliente de la beta de WoW Forever.", { raza: name, faccion: r?.faction === "horde" ? tr("Horda") : tr("Alianza"), racials })),
        jsonLd: [breadcrumbs([home, { name: tr("Razas"), path: path({ kind: "races" }) }, { name, path: path(page) }])],
      };
    }
    default:
      return { title: "WoW Forever", description: "" };
  }
}

// ---------- Vistas ----------

function Crumbs({ items }: { items: { name: string; to?: Page }[] }) {
  return (
    <nav className="crumbs" aria-label={tr("Ruta")}>
      {items.map((it, i) => (
        <span key={i}>
          {it.to ? <a href={href(it.to)}>{it.name}</a> : <span aria-current="page">{it.name}</span>}
          {i < items.length - 1 && <span className="crumb-sep"> / </span>}
        </span>
      ))}
    </nav>
  );
}

/** Icono de una raza: el del cliente o, si no lo trae (Cielonato), el propio de la web. */
function RaceIcon({ race, name }: { race: Race; name: string }) {
  const fixed = STATIC_RACE_ICONS[race.token];
  if (race.iconFileDataId === null && fixed) return <img className="icon" src={`${import.meta.env.BASE_URL}${fixed}`} alt="" width={64} height={64} loading="lazy" decoding="async" draggable={false} />;
  return <Icon id={race.iconFileDataId} name={name} />;
}

function RefHead({ icon, eyebrow, title, lead, color }: { icon?: number | null | JSX.Element; eyebrow: string; title: string; lead?: string; color?: string }) {
  return (
    <header className="ref-head" style={color ? { ["--c" as string]: color } : undefined}>
      {typeof icon === "object" && icon !== null ? icon : icon ? <Icon id={icon} name={title} /> : null}
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead && <p className="ref-lead">{lead}</p>}
      </div>
    </header>
  );
}

function CalculatorLink({ token, label, view = "race" }: { token: string; label: string; view?: CalcView }) {
  return (
    <a className="btn btn-primary" href={href({ kind: "calc", cls: token, view })}>
      {label}
    </a>
  );
}

/** «Lista completa de talentos». Un bloque por árbol, ordenado de arriba abajo. */
export function ClassTalentsView({ data, token }: { data: RefData; token: string }) {
  const cls = data.cls;
  if (!cls) return null;
  const cname = classNameOf(data.manifest, token);
  const total = cls.specs.reduce((a, s) => a + s.talents.length, 0);
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: cname, to: { kind: "class", cls: token } }, { name: tr("Talentos") }]} />
      <RefHead
        icon={data.manifest.classes.find((c) => classTokenOf(c.file) === token)?.iconFileDataId}
        eyebrow={tr("Talentos de clase")}
        title={tr("Talentos de {clase}", { clase: cname })}
        lead={tr("{clase} tiene {n} talentos repartidos en {m} árboles. Aquí tienes cada uno con su descripción al rango máximo; entra en uno para ver todos los rangos y sus requisitos, o planifica tu build en la calculadora.", { clase: cname, n: total, m: cls.specs.length })}
        color={CLASS_COLORS[token]}
      />
      <p className="ref-actions">
        <CalculatorLink token={token} view="talents" label={tr("Abrir la calculadora de talentos")} />
        <a className="btn" href={href({ kind: "class-abilities", cls: token })}>
          {tr("Habilidades de {clase}", { clase: cname })}
        </a>
      </p>
      {cls.specs.map((spec) => {
        const talents = [...spec.talents].filter((t) => t.name).sort((a, b) => a.row - b.row || a.col - b.col);
        return (
          <section key={spec.index} className="ref-section">
            <h2>{specLabel(token, spec.index, spec.name ?? "")}</h2>
            <ul className="ref-list">
              {talents.map((t) => (
                <li key={t.nodeId} className="ref-item">
                  <Icon id={t.iconFileDataId} name={talentLabel(t)} />
                  <div>
                    <h3>
                      <a href={href({ kind: "talent", cls: token, id: t.nodeId })}>{talentLabel(t)}</a>
                      <span className="rank-chip">{t.maxRank > 1 ? tr("Rangos: {n}", { n: t.maxRank }) : tr("1 rango")}</span>
                    </h3>
                    <p>{talentRankText(t, t.maxRank - 1)}</p>
                    <p className="muted small">{t.requiredPoints > 0 ? tr("Requiere {n} puntos en este árbol.", { n: t.requiredPoints }) : tr("Sin requisito de puntos.")}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Un talento: todos sus rangos, requisitos y las habilidades que nombra. */
export function TalentView({ data, token, id }: { data: RefData; token: string; id: number }) {
  const cls = data.cls;
  const spec = cls?.specs.find((s) => s.talents.some((t) => t.nodeId === id));
  const t = spec?.talents.find((x) => x.nodeId === id);
  if (!cls || !spec || !t) return null;
  const cname = classNameOf(data.manifest, token);
  const specName = specLabel(token, spec.index, spec.name ?? "");
  const all = cls.specs.flatMap((s) => s.talents);
  const pre = t.prerequisites.map((p) => all.find((x) => x.nodeId === p.nodeId)).filter((x): x is Talent => !!x && !!x.name);
  const siblings = spec.talents.filter((x) => x.name && x.nodeId !== id && x.row === t.row);
  const mentioned = data.abilities ? abilitiesMentionedBy(data.abilities, t) : [];
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: cname, to: { kind: "class", cls: token } }, { name: tr("Talentos"), to: { kind: "class-talents", cls: token } }, { name: talentLabel(t) }]} />
      <RefHead icon={t.iconFileDataId} eyebrow={`${cname} · ${specName}`} title={talentLabel(t)} lead={tr("Talento de {clase} del árbol {arbol}. Hasta rango {n}.", { clase: cname, arbol: specName, n: t.maxRank })} color={CLASS_COLORS[token]} />
      <section className="ref-section">
        <h2>{tr("Descripción por rango")}</h2>
        <ol className="ref-ranks">
          {t.descriptions.map((_, i) => (
            <li key={i}>
              <b>{tr("Rango {n}", { n: i + 1 })}</b> <span>{talentRankText(t, i)}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="ref-section">
        <h2>{tr("Cómo conseguirlo")}</h2>
        <ul>
          <li>{t.requiredPoints > 0 ? tr("Hay que haber gastado {n} puntos en el árbol {arbol} antes de poder elegirlo.", { n: t.requiredPoints, arbol: specName }) : tr("No tiene requisito de puntos: puedes elegirlo desde el principio.")}</li>
          <li>{tr("Está en la fila {row} del árbol {arbol}.", { row: t.row + 1, arbol: specName })}</li>
          {pre.map((p) => (
            <li key={p.nodeId}>
              {tr("Necesita antes:")} <a href={href({ kind: "talent", cls: token, id: p.nodeId })}>{talentLabel(p)}</a>
            </li>
          ))}
        </ul>
      </section>
      {mentioned.length > 0 && (
        <section className="ref-section">
          <h2>{tr("Habilidades que nombra")}</h2>
          <ul className="ref-links">
            {mentioned.slice(0, 12).map((a) => (
              <li key={a.ranks[0]!.spellId}>
                <a href={href({ kind: "ability", cls: token, id: a.ranks[0]!.spellId })}>{abilityLabel(a)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {siblings.length > 0 && (
        <section className="ref-section">
          <h2>{tr("Otros talentos de la misma fila")}</h2>
          <ul className="ref-links">
            {siblings.map((s) => (
              <li key={s.nodeId}>
                <a href={href({ kind: "talent", cls: token, id: s.nodeId })}>{talentLabel(s)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="ref-actions">
        <CalculatorLink token={token} view="talents" label={tr("Probarlo en la calculadora")} />
        <a className="btn" href={href({ kind: "class-talents", cls: token })}>
          {tr("Todos los talentos de {clase}", { clase: cname })}
        </a>
      </p>
    </div>
  );
}

/** Lista de las habilidades de una clase. */
export function ClassAbilitiesView({ data, token }: { data: RefData; token: string }) {
  const list = data.abilities ? sortedAbilities(data.abilities) : [];
  const cname = classNameOf(data.manifest, token);
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: cname, to: { kind: "class", cls: token } }, { name: tr("Habilidades") }]} />
      <RefHead
        icon={data.manifest.classes.find((c) => classTokenOf(c.file) === token)?.iconFileDataId}
        eyebrow={tr("Habilidades de clase")}
        title={tr("Habilidades de {clase}", { clase: cname })}
        lead={tr("{n} habilidades de {clase}, ordenadas por el nivel en que se aprenden. Cada una tiene su página con todos los rangos, el coste, el alcance y la descripción.", { n: list.length, clase: cname })}
        color={CLASS_COLORS[token]}
      />
      <p className="ref-actions">
        <CalculatorLink token={token} view="summary" label={tr("Ver el daño y la curación en la calculadora")} />
        <a className="btn" href={href({ kind: "class-talents", cls: token })}>
          {tr("Talentos de {clase}", { clase: cname })}
        </a>
      </p>
      <ul className="ref-list">
        {list.map((a) => {
          const first = a.ranks[0]!;
          const last = a.ranks[a.ranks.length - 1]!;
          return (
            <li key={first.spellId} className="ref-item">
              <Icon id={a.iconFileDataId} name={abilityLabel(a)} />
              <div>
                <h3>
                  <a href={href({ kind: "ability", cls: token, id: first.spellId })}>{abilityLabel(a)}</a>
                  <span className="rank-chip">{tr("Nivel {level}", { level: first.level })}</span>
                  {a.ranks.length > 1 && <span className="rank-chip">{tr("Rangos: {n}", { n: a.ranks.length })}</span>}
                </h3>
                <p>{rankText(last)}</p>
                <p className="muted small">
                  {costText(last)} · {castText(last)} · {rangeText(last)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Una habilidad: tabla con todos sus rangos y los talentos que la nombran. */
export function AbilityView({ data, token, id }: { data: RefData; token: string; id: number }) {
  const a = data.abilities?.abilities.find((x) => x.ranks[0]?.spellId === id);
  if (!a) return null;
  const cname = classNameOf(data.manifest, token);
  const name = abilityLabel(a);
  const related = data.cls ? talentsMentioning(data.cls, name, a.name) : [];
  const list = data.abilities ? sortedAbilities(data.abilities) : [];
  const at = list.findIndex((x) => x.ranks[0]?.spellId === id);
  const near = [list[at - 1], list[at + 1]].filter((x): x is Ability => !!x);
  const last = a.ranks[a.ranks.length - 1]!;
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: cname, to: { kind: "class", cls: token } }, { name: tr("Habilidades"), to: { kind: "class-abilities", cls: token } }, { name }]} />
      <RefHead
        icon={a.iconFileDataId}
        eyebrow={`${cname} · ${tr("Nivel {level}", { level: a.ranks[0]!.level })}`}
        title={name}
        lead={rankText(last)}
        color={CLASS_COLORS[token]}
      />
      <section className="ref-section">
        <h2>{tr("Rangos")}</h2>
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>{tr("Rango")}</th>
                <th>{tr("Nivel")}</th>
                <th>{tr("Coste")}</th>
                <th>{tr("Lanzamiento")}</th>
                <th>{tr("Recarga")}</th>
                <th>{tr("Alcance")}</th>
                <th>{tr("Descripción")}</th>
              </tr>
            </thead>
            <tbody>
              {a.ranks.map((r) => (
                <tr key={r.spellId}>
                  <td>{r.rank}</td>
                  <td>{r.level}</td>
                  <td>{costText(r)}</td>
                  <td>{castText(r)}</td>
                  <td>{r.cooldownMs !== null ? seconds(r.cooldownMs) : "—"}</td>
                  <td>{rangeText(r)}</td>
                  <td>{rankText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.ranks.some((r) => r.learnedByTalent) && <p className="muted small">{tr("Esta habilidad se aprende con un talento.")}</p>}
      </section>
      {related.length > 0 && (
        <section className="ref-section">
          <h2>{tr("Talentos relacionados")}</h2>
          <ul className="ref-links">
            {related.slice(0, 12).map((t) => (
              <li key={t.nodeId}>
                <a href={href({ kind: "talent", cls: token, id: t.nodeId })}>{talentLabel(t)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {near.length > 0 && (
        <section className="ref-section">
          <h2>{tr("Más habilidades de {clase}", { clase: cname })}</h2>
          <ul className="ref-links">
            {near.map((n) => (
              <li key={n.ranks[0]!.spellId}>
                <a href={href({ kind: "ability", cls: token, id: n.ranks[0]!.spellId })}>{abilityLabel(n)}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="ref-actions">
        <CalculatorLink token={token} view="summary" label={tr("Ver cuánto daño hace con tu build")} />
        <a className="btn" href={href({ kind: "class-abilities", cls: token })}>
          {tr("Todas las habilidades de {clase}", { clase: cname })}
        </a>
      </p>
    </div>
  );
}

const FACTION: Record<string, string> = { alliance: "Alianza", horde: "Horda" };

/** Lista de razas jugables. */
export function RacesView({ data }: { data: RefData }) {
  const races = data.races ?? [];
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: tr("Razas") }]} />
      <RefHead eyebrow={tr("Razas jugables")} title={tr("Razas de WoW Forever")} lead={tr("{n} razas jugables. Cada una tiene sus habilidades raciales y solo puede ser de ciertas clases, según el cliente de la beta.", { n: races.length })} />
      <ul className="ref-list">
        {races.map((r) => (
          <li key={r.id} className="ref-item">
            <RaceIcon race={r} name={raceLabel(r.id, r.name)} />
            <div>
              <h3>
                <a href={href({ kind: "race", id: r.id })}>{raceLabel(r.id, r.name)}</a>
                <span className="rank-chip">{tr(FACTION[r.faction] ?? "")}</span>
              </h3>
              <p>{r.racials.map((a, i) => racialEn(r.id, i)?.name ?? a.name).join(" · ")}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Una raza: raciales con su texto y clases disponibles. */
export function RaceView({ data, id }: { data: RefData; id: number }) {
  const r = data.races?.find((x) => x.id === id);
  if (!r) return null;
  const name = raceLabel(r.id, r.name);
  const classes = data.manifest.classes.filter((c) => r.classIds.includes(c.classId));
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: tr("Razas"), to: { kind: "races" } }, { name }]} />
      <RefHead
        icon={<RaceIcon race={r} name={name} />}
        eyebrow={tr(FACTION[r.faction] ?? "")}
        title={name}
        lead={tr("{raza} es una raza de la {faccion} con {n} habilidades raciales. Puede ser {clases}.", { raza: name, faccion: tr(FACTION[r.faction] ?? ""), n: r.racials.length, clases: classes.map((c) => classNameOf(data.manifest, classTokenOf(c.file))).join(", ") })}
      />
      <section className="ref-section">
        <h2>{tr("Habilidades raciales")}</h2>
        <ul className="ref-list">
          {r.racials.map((a, i) => {
            const en = racialEn(r.id, i);
            return (
              <li key={a.order} className="ref-item">
                <Icon id={a.iconFileDataId} name={en?.name ?? a.name} />
                <div>
                  <h3>{en?.name ?? a.name}</h3>
                  <p>{plain((currentLang() === "en" && en?.description) || a.description)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="ref-section">
        <h2>{tr("Clases disponibles")}</h2>
        <ul className="ref-links">
          {classes.map((c) => {
            const token = classTokenOf(c.file);
            return (
              <li key={c.classId}>
                <a href={href({ kind: "calc", cls: token, view: "race" }, { r: String(r.id) })}>{classNameOf(data.manifest, token)}</a>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------- Calculadora de una clase: página de la clase y un paso por dirección ----------

/** Frase que explica cada paso de la calculadora (clave en español, como el resto de textos). */
const VIEW_BLURB: Record<CalcView, string> = {
  race: "Elige la raza entre las que el cliente permite para tu clase y mira sus habilidades raciales.",
  legacy: "Reparte los Puntos de Legado: ventajas de cuenta que se eligen antes que los talentos.",
  talents: "Gasta los puntos de talento en los árboles de la clase con los requisitos del juego.",
  gear: "Viste a tu personaje en el probador 3D, con encantamientos y sufijos aleatorios.",
  buffs: "Marca los beneficios que tendrías: consumibles, bendiciones, objetos de campamento…",
  summary: "Estadísticas, daño y sanación de cada habilidad con tu build.",
};

const stepLabel = (v: CalcView): string => tr(VIEWS.find((x) => x.id === v)!.label);

/** Los seis pasos de la calculadora como enlaces (lista de la página de la clase y pie de cada paso). */
function StepLinks({ token, current }: { token: string; current?: CalcView }) {
  return (
    <ol className="ref-links ref-steps">
      {CALC_VIEWS.map((v) => (
        <li key={v}>
          {v === current ? <b aria-current="page">{stepLabel(v)}</b> : <a href={href({ kind: "calc", cls: token, view: v })}>{stepLabel(v)}</a>}
          <span className="muted small"> · {tr(VIEW_BLURB[v])}</span>
        </li>
      ))}
    </ol>
  );
}

/** Página de la clase: qué se puede hacer con ella y la entrada a cada paso de la calculadora. */
export function ClassIntroView({ data, token }: { data: RefData; token: string }) {
  const cls = data.cls;
  if (!cls) return null;
  const cname = classNameOf(data.manifest, token);
  const total = cls.specs.reduce((a, s) => a + s.talents.length, 0);
  return (
    <div className="ref wrap">
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: cname }]} />
      <RefHead
        icon={data.manifest.classes.find((c) => classTokenOf(c.file) === token)?.iconFileDataId}
        eyebrow={tr("Calculadora de clase")}
        title={tr("{clase} en WoW Forever", { clase: cname })}
        lead={tr("Planifica tu {clase} de WoW Forever: {n} talentos en {m} árboles, raza, Puntos de Legado, equipo y beneficios, con el daño y la curación de cada habilidad. Tu build se guarda en el enlace.", { clase: cname, n: total, m: cls.specs.length })}
        color={CLASS_COLORS[token]}
      />
      <p className="ref-actions">
        <CalculatorLink token={token} view="race" label={tr("Empezar con la raza")} />
        <CalculatorLink token={token} view="talents" label={tr("Ir a los talentos")} />
      </p>
      <section className="ref-section">
        <h2>{tr("Los pasos de la calculadora")}</h2>
        <StepLinks token={token} />
      </section>
      <section className="ref-section">
        <h2>{tr("Árboles de talentos")}</h2>
        <ul className="ref-links">
          {cls.specs.map((s) => (
            <li key={s.index}>
              <b>{specLabel(token, s.index, s.name ?? "")}</b>: {tr("{n} talentos", { n: s.talents.filter((t) => t.name).length })}
            </li>
          ))}
        </ul>
      </section>
      <p className="ref-actions">
        <a className="btn" href={href({ kind: "class-talents", cls: token })}>
          {tr("Talentos de {clase}", { clase: cname })}
        </a>
        <a className="btn" href={href({ kind: "class-abilities", cls: token })}>
          {tr("Habilidades de {clase}", { clase: cname })}
        </a>
      </p>
    </div>
  );
}

const joinNames = (names: string[]): string => names.join(", ");
const rowNames = (talents: Talent[], row: number): string[] => talents.filter((t) => t.row === row).map(talentLabel);

/** Contenido de un paso de la calculadora para el HTML prerenderizado: texto propio de la clase y del paso (el navegador pinta la calculadora). */
export function CalcStepView({ data, token, view }: { data: RefData; token: string; view: CalcView }) {
  const cname = classNameOf(data.manifest, token);
  const entry = data.manifest.classes.find((c) => classTokenOf(c.file) === token);
  const head = (title: string, lead: string) => (
    <>
      <Crumbs items={[{ name: "WoW Forever", to: { kind: "home" } }, { name: cname, to: { kind: "class", cls: token } }, { name: stepLabel(view) }]} />
      <RefHead icon={entry?.iconFileDataId} eyebrow={tr("Calculadora de {clase}", { clase: cname })} title={title} lead={lead} color={CLASS_COLORS[token]} />
    </>
  );
  const foot = (
    <section className="ref-section">
      <h2>{tr("Los pasos de la calculadora")}</h2>
      <StepLinks token={token} current={view} />
    </section>
  );

  if (view === "race") {
    const races = (data.races ?? []).filter((r) => entry && r.classIds.includes(entry.classId));
    return (
      <div className="ref wrap">
        {head(tr("Razas de {clase} en WoW Forever", { clase: cname }), tr("{n} razas pueden ser {clase} según el cliente de la beta. Cada una aporta habilidades raciales distintas, y en la calculadora ves cómo cambian tus estadísticas al elegirla.", { n: races.length, clase: cname }))}
        <ul className="ref-list">
          {races.map((r) => (
            <li key={r.id} className="ref-item">
              <RaceIcon race={r} name={raceLabel(r.id, r.name)} />
              <div>
                <h3>
                  <a href={href({ kind: "race", id: r.id })}>{raceLabel(r.id, r.name)}</a>
                  <span className="rank-chip">{tr(FACTION[r.faction] ?? "")}</span>
                </h3>
                <p>{r.racials.map((a, i) => racialEn(r.id, i)?.name ?? a.name).join(" · ")}</p>
              </div>
            </li>
          ))}
        </ul>
        {foot}
      </div>
    );
  }

  if (view === "talents") {
    const cls = data.cls;
    if (!cls) return null;
    const specs = cls.specs.map((s) => specLabel(token, s.index, s.name ?? ""));
    return (
      <div className="ref wrap">
        {head(
          tr("Calculadora de talentos de {clase}", { clase: cname }),
          tr("Reparte hasta {max} puntos entre los {m} árboles de {clase} ({specs}). Cada talento se desbloquea al gastar un número de puntos en su árbol, y el primer punto de talento llega en el nivel {nivel}.", { max: cls.rules.maxPoints, m: cls.specs.length, clase: cname, specs: joinNames(specs), nivel: cls.rules.firstPointLevel ?? 10 }),
        )}
        {cls.specs.map((s) => {
          const named = s.talents.filter((t) => t.name);
          if (named.length === 0) return null;
          const last = Math.max(...named.map((t) => t.row));
          return (
            <section key={s.index} className="ref-section">
              <h2>{specLabel(token, s.index, s.name ?? "")}</h2>
              <p>{tr("{n} talentos. El árbol empieza por {primeros} y termina en {ultimos}.", { n: named.length, primeros: joinNames(rowNames(named, 0)), ultimos: joinNames(rowNames(named, last)) })}</p>
            </section>
          );
        })}
        <p className="ref-actions">
          <a className="btn" href={href({ kind: "class-talents", cls: token })}>
            {tr("Todos los talentos de {clase}", { clase: cname })}
          </a>
        </p>
        {foot}
      </div>
    );
  }

  if (view === "gear") {
    const prof = data.rules ? classProficiencies(data.rules, entry?.classId ?? 0) : null;
    const line = (p: { name: string; minLevel: number }) => (p.minLevel > 0 ? tr("{tipo} (desde el nivel {n})", { tipo: tr(p.name), n: p.minLevel }) : tr(p.name));
    return (
      <div className="ref wrap">
        {head(tr("Equipo de {clase} en WoW Forever", { clase: cname }), tr("Qué armaduras y armas puede llevar {clase} según el cliente de la beta, y cómo probar el equipo en el probador 3D con encantamientos y sufijos aleatorios.", { clase: cname }))}
        {prof && (
          <>
            <section className="ref-section">
              <h2>{tr("Armaduras")}</h2>
              <p>{joinNames(prof.armor.map(line))}.</p>
            </section>
            <section className="ref-section">
              <h2>{tr("Armas")}</h2>
              <p>
                {joinNames(prof.weapons.map(line))}.{" "}
                {prof.dualWieldLevel === null ? tr("No puede llevar un arma en cada mano.") : tr("Puede llevar un arma en cada mano desde el nivel {n}.", { n: prof.dualWieldLevel })}
              </p>
            </section>
          </>
        )}
        <section className="ref-section">
          <h2>{tr("Probador 3D")}</h2>
          <p>{tr("Las 19 ranuras del personaje se prueban sobre el modelo de tu raza, con las estadísticas del equipo, sus conjuntos y el daño que cambia cada pieza.")}</p>
        </section>
        {foot}
      </div>
    );
  }

  if (view === "summary") {
    const base = data.stats?.classBase.find((c) => c.classId === entry?.classId);
    const abilities = data.abilities ? sortedAbilities(data.abilities) : [];
    return (
      <div className="ref wrap">
        {head(tr("Estadísticas y daño de {clase} en WoW Forever", { clase: cname }), tr("El resumen junta tu raza, talentos, Legado, equipo y beneficios: estadísticas con su desglose y el daño o la sanación de cada habilidad de {clase}.", { clase: cname }))}
        {base && (
          <section className="ref-section">
            <h2>{tr("Vida y maná base")}</h2>
            <p>
              {tr("Al nivel 60, {clase} tiene {hp} de vida base (sin equipo ni talentos).", { clase: cname, hp: fmt(base.hp[59] ?? 0) })}{" "}
              {(base.mana[59] ?? 0) > 0 ? tr("Su maná base es {mana}.", { mana: fmt(base.mana[59] ?? 0) }) : tr("No usa maná.")}
            </p>
          </section>
        )}
        <section className="ref-section">
          <h2>{tr("Habilidades con resultado por lanzamiento")}</h2>
          <p>{tr("{n} habilidades de {clase}, de las que la calculadora saca el daño o la sanación de cada lanzamiento:", { n: abilities.length, clase: cname })}</p>
          <ul className="ref-links">
            {abilities.slice(0, 10).map((a) => (
              <li key={a.ranks[0]!.spellId}>
                <a href={href({ kind: "ability", cls: token, id: a.ranks[0]!.spellId })}>{abilityLabel(a)}</a>
              </li>
            ))}
          </ul>
          <p className="ref-actions">
            <a className="btn" href={href({ kind: "class-abilities", cls: token })}>
              {tr("Todas las habilidades de {clase}", { clase: cname })}
            </a>
          </p>
        </section>
        {foot}
      </div>
    );
  }

  if (view === "legacy") {
    const legacy = data.legacy;
    return (
      <div className="ref wrap">
        {head(tr("Puntos de Legado para {clase}", { clase: cname }), tr("Los Puntos de Legado son ventajas de cuenta: {max} puntos repartidos en {m} árboles que se eligen antes que los talentos de {clase}. Una de ellas adelanta el primer punto de talento.", { max: legacy?.rules.maxPoints ?? 16, m: legacy?.specs.length ?? 3, clase: cname }))}
        {legacy?.specs.map((s) => (
          <section key={s.index} className="ref-section">
            <h2>{s.name}</h2>
            <p>{joinNames(s.talents.filter((t) => t.name).sort((a, b) => a.row - b.row || a.col - b.col).map(talentLabel))}.</p>
          </section>
        ))}
        {foot}
      </div>
    );
  }

  return (
    <div className="ref wrap">
      {head(tr("Beneficios y consumibles para {clase}", { clase: cname }), tr("Marca los beneficios que tendría tu {clase}: objetos de campamento, bendiciones, gritos, auras, elixires, frascos y comida, con las cifras del cliente. Los que no se acumulan se desmarcan solos.", { clase: cname }))}
      {foot}
    </div>
  );
}

/** Contenido de una página de consulta (o null si el tipo no es de consulta). */
export function RefContent({ page, data }: { page: Page; data: RefData }) {
  switch (page.kind) {
    case "class-talents":
      return <ClassTalentsView data={data} token={page.cls} />;
    case "talent":
      return <TalentView data={data} token={page.cls} id={page.id} />;
    case "class-abilities":
      return <ClassAbilitiesView data={data} token={page.cls} />;
    case "ability":
      return <AbilityView data={data} token={page.cls} id={page.id} />;
    case "races":
      return <RacesView data={data} />;
    case "race":
      return <RaceView data={data} id={page.id} />;
    case "class":
      return <ClassIntroView data={data} token={page.cls} />;
    case "calc":
      return <CalcStepView data={data} token={page.cls} view={page.view} />;
    default:
      return null;
  }
}

export const isRefPage = (p: Page): boolean => ["class", "calc", "class-talents", "talent", "class-abilities", "ability", "races", "race"].includes(p.kind);
