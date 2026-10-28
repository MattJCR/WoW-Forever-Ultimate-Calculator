import type { ClassRacial, Race, ReferenceOnlyRacial } from "@wfuc/schema";
import { useEffect, useState } from "react";
import { isEnglish, raceLabel, spellEn, tr } from "../i18n";
import { loadModelIndex } from "../viewer/avatar";
import { MODELS_BASE } from "../viewer/config";
import { originNote } from "./Detail";
import { Icon } from "./Icon";
import { HoverTip, RacialTip, formatMs, racialCooldown, racialName, raceTotalRows, referenceStatus } from "./RaceBonuses";

const FACTIONS = [
  { id: "alliance", label: "Alianza" },
  { id: "horde", label: "Horda" },
] as const;

/** Clases en plural para «Solo sacerdotes» (la etiqueta de las raciales de clase). */
const CLASS_PLURAL: Record<number, string> = { 1: "guerreros", 2: "paladines", 3: "cazadores", 4: "pícaros", 5: "sacerdotes", 7: "chamanes", 8: "magos", 9: "brujos", 11: "druidas" };

/** Atributo que suma a una cifra del texto (Sacrificio oscuro: espíritu). */
const STAT_PLUS = { spirit: "más tu espíritu", strength: "más tu fuerza", agility: "más tu agilidad", stamina: "más tu aguante", intellect: "más tu intelecto" } as const;

/** Tarjeta flotante de una racial de clase: icono, nombre, texto del cliente y cifras (nivel, duración y enfriamiento). */
function ClassRacialCard({ c, race }: { c: ClassRacial; race: Race }) {
  const en = isEnglish() ? spellEn(c.spellId) : null;
  const name = en?.name || c.name;
  const description = en?.description || c.description;
  const facts = [tr("desde el nivel {n}", { n: c.level })];
  // La cifra del texto es la base: el cliente suma además un atributo del personaje
  for (const stat of c.scalesWith) facts.push(tr(STAT_PLUS[stat]));
  if (c.durationMs) facts.push(tr("dura {t}", { t: formatMs(c.durationMs) }));
  if (c.cooldownMs) facts.push(tr("enfriamiento {t}", { t: formatMs(c.cooldownMs) }));
  const translated = originNote(c.textOrigin);
  return (
    <div className="racial-tip">
      <div className="detail-head">
        <Icon id={c.iconFileDataId} name={name} />
        <div>
          <h4>{name}</h4>
          <p className="rank-line">
            {tr("Habilidad racial de clase")} · {raceLabel(race.id, race.name)}
          </p>
        </div>
      </div>
      <p className="desc-text">{description}</p>
      <ul className="tip-facts">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {translated && <p className="tip-warn tip-warn-soft">{translated}</p>}
    </div>
  );
}

/** Raciales de clase de una clase concreta en una raza: barra plegable y, desplegada, sus filas. */
function ClassRacialGroup({ race, classId, items, open, onToggle }: { race: Race; classId: number; items: ClassRacial[]; open: boolean; onToggle: () => void }) {
  const id = `rg-class-${race.id}-${classId}`;
  return (
    <>
      <button type="button" className="rg-bar" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
          <path d="M12 8v6M9 11h6" />
        </svg>
        <span className="rg-bar-label">{tr("Solo {races}", { races: tr(CLASS_PLURAL[classId] ?? "clases") })}</span>
        <span className="rg-count">{items.length}</span>
        <svg className="rg-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="rg-rows rg-class-rows" id={id}>
          {items.map((c) => {
            const name = (isEnglish() ? spellEn(c.spellId)?.name : null) || c.name;
            return (
              <li key={c.spellId}>
                <HoverTip as="button" className="rg-row" card={<ClassRacialCard c={c} race={race} />}>
                  <Icon id={c.iconFileDataId} name={name} />
                  <span className="rg-rn">{name}</span>
                  {c.cooldownMs ? <span className="rank-chip">{formatMs(c.cooldownMs)}</span> : null}
                </HoverTip>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Tarjeta de una racial que solo lista la referencia externa (reemplazo o novedad futura): no cuenta en los cálculos. */
function ReferenceOnlyCard({ r, race }: { r: ReferenceOnlyRacial; race: Race }) {
  return (
    <div className="racial-tip">
      <div className="detail-head">
        <Icon id={null} name={r.name} />
        <div>
          <h4>{r.name}</h4>
          <p className="rank-line">
            {tr("Solo en la referencia externa")} · {raceLabel(race.id, race.name)}
          </p>
        </div>
      </div>
      <p className="desc-text">{r.text}</p>
      <p className="tip-warn tip-ref">
        <b>{tr("El cliente aún no la trae")}</b> {tr("Puede ser un cambio futuro o un reemplazo. No cuenta en los cálculos. Texto de la referencia, en inglés.")}
      </p>
    </div>
  );
}

/** Barra plegable con las raciales que la referencia lista y el cliente no trae. */
function ReferenceOnlyGroup({ race, open, onToggle }: { race: Race; open: boolean; onToggle: () => void }) {
  const id = `rg-ref-${race.id}`;
  return (
    <>
      <button type="button" className="rg-bar rg-bar-ref" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
        <span className="rg-bar-label">{tr("Solo referencia")}</span>
        <span className="rg-count">{race.referenceOnly.length}</span>
        <svg className="rg-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="rg-rows rg-class-rows" id={id}>
          {race.referenceOnly.map((r) => (
            <li key={r.name}>
              <HoverTip as="button" className="rg-row" card={<ReferenceOnlyCard r={r} race={race} />}>
                <Icon id={null} name={r.name} />
                <span className="rg-rn">{r.name}</span>
              </HoverTip>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Retrato de la raza: el icono del juego (`Achievement_Character_<raza>_<sexo>`, varón). Los Cielonatos no tienen icono en el cliente: llevan
 * la cara del personaje (tools/model/render-races.mjs) y, sin modelos, la inicial.
 */
function RacePortrait({ race, name }: { race: Race; name: string }) {
  const [model, setModel] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const own = race.iconFileDataId !== null;
  useEffect(() => {
    if (own) return;
    let dead = false;
    void loadModelIndex().then((index) => {
      if (!dead) setModel(index?.find((e) => e.race === race.id && e.sex === 0)?.chrModel ?? null);
    });
    return () => { dead = true; };
  }, [race.id, own]);
  const src = own ? `${import.meta.env.BASE_URL}data/icons/${race.iconFileDataId}.png` : model !== null ? `${MODELS_BASE}/race/${model}.webp` : null;
  return (
    <span className={`rg-mono ${race.faction}`} aria-hidden="true">
      {src && !broken ? <img src={src} alt="" width={50} height={50} onError={() => setBroken(true)} /> : name.charAt(0)}
    </span>
  );
}

function RaceCard({ race, classId, allowed, selected, onPick, open, onToggle, refOpen, onToggleRef }: { race: Race; classId: number; allowed: boolean; selected: boolean; onPick: () => void; open: (classOfRacial: number) => boolean; onToggle: (classOfRacial: number) => void; refOpen: boolean; onToggleRef: () => void }) {
  const name = raceLabel(race.id, race.name);
  const groups = [...new Set(race.classRacials.map((c) => c.classId))];
  return (
    <article className={`rg-card${selected ? " on" : ""}${allowed ? "" : " locked"}`}>
      <button type="button" className="rg-head" aria-pressed={selected} disabled={!allowed} onClick={onPick}>
        <RacePortrait race={race} name={name} />
        <span className={`rg-name${name.split(" ").some((w) => w.length > 10) ? " long" : ""}`}>{name}</span>
        {selected && (
          <span className="race-check" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
        )}
      </button>
      <ul className="rg-rows">
        {race.racials.map((a) => {
          const cooldown = racialCooldown(a, classId);
          return (
            <li key={a.order}>
              <RacialTip as="button" className="rg-row" a={a} classId={classId} raceId={race.id}>
                <Icon id={a.iconFileDataId} name={racialName(a, race.id)} />
                <span className="rg-rn">{racialName(a, race.id)}</span>
                {referenceStatus(a) && (
                  <span className="rg-diff" role="img" aria-label={tr("La referencia externa trae otros valores")}>
                    ≠
                  </span>
                )}
                {cooldown && <span className="rank-chip">{cooldown}</span>}
              </RacialTip>
            </li>
          );
        })}
      </ul>
      {race.referenceOnly.length > 0 && <ReferenceOnlyGroup race={race} open={refOpen} onToggle={onToggleRef} />}
      {allowed &&
        groups.map((g) => (
          <ClassRacialGroup key={g} race={race} classId={g} items={race.classRacials.filter((c) => c.classId === g)} open={open(g)} onToggle={() => onToggle(g)} />
        ))}
    </article>
  );
}

/** Raza elegida y sus bonificaciones pasivas con cifras para la clase. */
function RaceSummary({ race, classId }: { race: Race | null; classId: number }) {
  const rows = race ? raceTotalRows(race, classId) : [];
  const differing = race ? race.racials.filter((a) => referenceStatus(a)).length + race.referenceOnly.length : 0;
  return (
    <section className="rg-summary" aria-live="polite" aria-label={tr("Raza elegida")}>
      <h5>{tr("Raza elegida")}</h5>
      {race ? (
        <>
          <b className="rg-summary-name">{raceLabel(race.id, race.name)}</b>
          <span className="chip">{tr(race.faction === "alliance" ? "Alianza" : "Horda")}</span>
          {rows.length > 0 ? (
            rows.map((r) => (
              <span key={r.label} className="chip chip-rule">
                {r.label} {r.value}
              </span>
            ))
          ) : (
            <span className="muted small">{tr("Esta raza no da bonificaciones pasivas con cifras para esta clase.")}</span>
          )}
          {differing > 0 && (
            <span className="chip chip-unconfirmed" title={tr("La referencia externa trae otros valores que el cliente aún no tiene: míralas marcadas con ≠")}>
              {tr("{n} con otros valores en la referencia", { n: differing })}
            </span>
          )}
          <span className="rg-summary-origin">
            <span className="dot dot-client" />
            {tr("Texto del cliente")}
          </span>
        </>
      ) : (
        <span className="muted">{tr("Ninguna. Elige una de las razas de abajo.")}</span>
      )}
    </section>
  );
}

/**
 * Las diez razas, en una rejilla por facción: cada una con sus cuatro raciales (icono, nombre y enfriamiento; el texto completo sale al
 * pasar el cursor) y, plegadas, las raciales de clase que solo tiene esa raza. Las de la clase actual salen desplegadas.
 * Las razas que la clase no puede ser se ven apagadas y no se eligen.
 */
export function RaceGrid({ races, classId, race, onRace }: { races: Race[]; classId: number; race: Race | null; onRace: (id: number | null) => void }) {
  // Barras que el usuario ha abierto o cerrado a mano («raza:clase»); sin tocar, solo está abierta la de la clase actual
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => setManual({}), [classId]);
  return (
    <>
      <RaceSummary race={race} classId={classId} />
      {FACTIONS.map((f) => (
        <div key={f.id} className={`race-faction ${f.id}`}>
          <h3>
            <span className="faction-mark" aria-hidden="true" />
            {tr(f.label)}
          </h3>
          <div className="rg-grid">
            {races
              .filter((r) => r.faction === f.id)
              .map((r) => (
                <RaceCard
                  key={r.id}
                  race={r}
                  classId={classId}
                  allowed={r.classIds.includes(classId)}
                  selected={race?.id === r.id}
                  onPick={() => onRace(race?.id === r.id ? null : r.id)}
                  open={(g) => manual[`${r.id}:${g}`] ?? g === classId}
                  onToggle={(g) => setManual((m) => ({ ...m, [`${r.id}:${g}`]: !(m[`${r.id}:${g}`] ?? g === classId) }))}
                  refOpen={manual[`${r.id}:ref`] ?? false}
                  onToggleRef={() => setManual((m) => ({ ...m, [`${r.id}:ref`]: !(m[`${r.id}:ref`] ?? false) }))}
                />
              ))}
          </div>
        </div>
      ))}
    </>
  );
}
