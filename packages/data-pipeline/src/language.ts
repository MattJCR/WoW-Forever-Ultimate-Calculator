import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Palabras funcionales de cada idioma: bastan para distinguir un texto de hechizo en ingles del espanol. */
const EN = new Set(
  "the your you of to and chance increases increased gives when while spell spells damage by for with each after next than that from its on in is are up sec target targets enemy enemies per all any".split(" "),
);
const ES = new Set(
  "el la los las de del que tu tus un una y con para por al se su sus en es más probabilidad hechizos hechizo daño durante cada aumenta reduce objetivo objetivos enemigo enemigos lanzas cuando".split(" "),
);

/**
 * true si el texto del cliente esta en ingles (el esES de la beta trae sin traducir los textos nuevos de Forever).
 * Se ignoran los marcadores del cliente (`$m1`, `${$m1/2}`, `$400589s1`) y los numeros.
 */
export function looksEnglish(text: string): boolean {
  const words = text
    .replace(/\$\{[^}]*\}|\$[A-Za-z0-9<>]+/g, " ")
    .toLowerCase()
    .match(/[a-záéíóúñü']+/g);
  if (!words) return false;
  let en = 0;
  let es = 0;
  for (const w of words) {
    if (EN.has(w)) en++;
    if (ES.has(w)) es++;
  }
  return en >= 3 && en > es * 1.5;
}

/** Traducciones propias (data/i18n/esES-overrides.json): solo valen mientras el cliente siga en ingles. */
export interface Overrides {
  spells: Record<string, string>;
  /** Nombre en ingles del cliente -> nombre en espanol (p. ej. el 3.er rango de Explosion de Escarcha trae el nombre en ingles). */
  names: Record<string, string>;
  racials: Record<string, { name?: string; description?: string }>;
}

export function loadOverrides(locale: string): Overrides {
  const empty: Overrides = { spells: {}, names: {}, racials: {} };
  if (locale !== "esES") return empty;
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/i18n/esES-overrides.json");
  if (!existsSync(file)) return empty;
  const j = JSON.parse(readFileSync(file, "utf8")) as Partial<Overrides>;
  return { spells: j.spells ?? {}, names: j.names ?? {}, racials: j.racials ?? {} };
}

/** De donde sale el texto que se muestra. */
export type TextOrigin = "client" | "translated-by-us" | "untranslated";
