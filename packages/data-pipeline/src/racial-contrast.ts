import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TF_RACE_IDS } from "./contrast.js";
import type { RacialAbility, Races } from "./model.js";

/** Racial tal como la lista la referencia externa (los 9 exports repiten las de las 10 razas: se juntan). */
interface RefRacial {
  name: string;
  text: string;
  icon: string | null;
}

/** Prefijo de lanzamiento de la referencia («5 yd range, Instant, 2 min cooldown. »): no es parte del texto del hechizo. */
const PREFIX = /^(?:(?:\d+(?:\.\d+)?% of base mana|[\d,]+ Mana|\d+ yd range|\d+(?:\.\d+)? sec cast|Instant|Channeled|\d+(?:\.\d+)? (?:sec|min) cooldown)(?:, )?)+\.\s*/;
const COOLDOWN = /(\d+(?:\.\d+)?) (sec|min) cooldown/;

/** Texto de la referencia sin el prefijo, y el enfriamiento que declara (ms). */
export function splitReferenceText(text: string): { body: string; cooldownMs: number | null } {
  const m = PREFIX.exec(text);
  const prefix = m ? m[0] : "";
  const cd = COOLDOWN.exec(prefix);
  return { body: text.slice(prefix.length).trim(), cooldownMs: cd ? Math.round(Number(cd[1]) * (cd[2] === "min" ? 60000 : 1000)) : null };
}

/** Cifras de un texto en orden de aparición (miles con coma o punto fuera: «1,285» = 1285; decimales «0,5» = 0.5). */
export function figuresOf(text: string): string[] {
  const clean = text.replace(/(\d)[,.](\d{3})(?!\d)/g, "$1$2");
  return (clean.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", "."))));
}

/** Lee las raciales de la referencia por raza (ChrRaces.ID). */
export function loadReferenceRacials(tfDir: string): Map<number, RefRacial[]> | null {
  if (!existsSync(tfDir)) return null;
  const byRace = new Map<number, Map<string, RefRacial>>();
  let found = false;
  for (const f of readdirSync(tfDir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(tfDir, f), "utf8")) as { racials?: Record<string, { race: string; abilities: [string, string, string?][] }[]> };
    if (!j.racials) continue;
    for (const list of Object.values(j.racials)) {
      for (const r of list) {
        const id = TF_RACE_IDS[r.race];
        if (id === undefined) continue;
        found = true;
        const m = byRace.get(id) ?? new Map<string, RefRacial>();
        byRace.set(id, m);
        for (const [name, text, icon] of r.abilities) if (!m.has(name)) m.set(name, { name, text, icon: icon ?? null });
      }
    }
  }
  return found ? new Map([...byRace].map(([id, m]) => [id, [...m.values()]])) : null;
}

export interface RacialContrastReport {
  same: number;
  /** «Raza: racial» con cifras distintas (cambio futuro de la referencia). */
  differs: string[];
  /** Raciales del cliente que la referencia no lista. */
  notListed: string[];
  /** Raciales que la referencia lista y el cliente no trae. */
  referenceOnly: string[];
  /** Diferencias que se revisaron a mano y son de redacción. */
  reviewed: string[];
}

/** Texto español completo de la racial para el contraste: el de cada variante de clase (se acepta que coincida cualquiera). */
const variantsOf = (a: RacialAbility): string[] => {
  const t = a.spells.map((s) => s.description).filter((d): d is string => !!d);
  return t.length ? t : [a.description];
};

/**
 * Contrasta cada racial del cliente con la de la referencia (por nombre en inglés). Marca `reference` en la racial y rellena
 * `referenceOnly` con las que solo lista la referencia. El cliente manda: no se cambia ninguna cifra, solo se avisa.
 * `names` = data/i18n/racials-en.json (español del cliente → inglés); `notes` = data/rules/reference-notes.json (diferencias revisadas
 * a mano: «raza/racial» → motivo, p. ej. la referencia explica con más detalle lo mismo).
 */
export function contrastRacials(races: Races, tfDir: string, names: Record<string, string>, notes: Record<string, string>): RacialContrastReport | null {
  const ref = loadReferenceRacials(tfDir);
  if (!ref) return null;
  const report: RacialContrastReport = { same: 0, differs: [], notListed: [], referenceOnly: [], reviewed: [] };
  for (const race of races.races) {
    const theirs = ref.get(race.id) ?? [];
    const used = new Set<string>();
    race.referenceOnly = [];
    for (const a of race.racials) {
      const en = names[a.name] ?? a.name;
      const t = theirs.find((x) => x.name === en);
      const label = `${race.name}: ${a.name}`;
      if (!t) {
        a.reference = { status: "not-listed", text: null, cooldownMs: null, reviewed: notes[`${race.id}/${a.order}`] ?? null };
        report.notListed.push(label);
        continue;
      }
      used.add(t.name);
      const { body, cooldownMs } = splitReferenceText(t.text);
      const theirFigures = figuresOf(body).join(",");
      const sameFigures = variantsOf(a).some((v) => figuresOf(v).join(",") === theirFigures);
      const ourCooldown = a.spells.find((s) => s.cooldownMs)?.cooldownMs ?? null;
      const sameCooldown = cooldownMs === null || ourCooldown === null || cooldownMs === ourCooldown;
      const same = sameFigures && sameCooldown;
      const reviewed = !same ? (notes[`${race.id}/${a.order}`] ?? null) : null;
      a.reference = { status: same ? "same" : "differs", text: body, cooldownMs, reviewed };
      if (same) report.same++;
      else if (reviewed) report.reviewed.push(`${label} — ${reviewed}`);
      else report.differs.push(label);
    }
    for (const t of theirs) {
      if (used.has(t.name)) continue;
      race.referenceOnly.push({ name: t.name, text: splitReferenceText(t.text).body, icon: t.icon });
      report.referenceOnly.push(`${race.name}: ${t.name}`);
    }
  }
  return report;
}
