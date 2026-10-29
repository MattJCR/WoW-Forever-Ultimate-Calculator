import type { ClassTalents, EnglishText, Race } from "@wfuc/schema";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Lang } from "./seo/routes";

/**
 * Idioma de la web. El cliente instalado solo trae español, así que:
 *  - los textos de la interfaz salen de un diccionario propio (`i18n-en.ts`, clave = el texto en español), que solo se descarga al elegir English
 *    (el prerender lo fija con `setDictionary`);
 *  - los nombres y descripciones del juego en inglés salen de `i18n/en.json` (tablas del juego en inglés, contrastadas con las cifras del cliente),
 *    que solo se descarga al elegir English. Lo que no tenga inglés se muestra en español.
 */
export type { Lang };

const STORAGE_KEY = "wfuc.lang";

/** Diccionario español -> inglés de la interfaz. Vacío hasta que `setDictionary` lo rellena (en el navegador, al pasar a English). */
let EN: Record<string, string> = {};
let dictionaryLoaded = false;

/** Fija el diccionario de la interfaz en inglés. */
export function setDictionary(dict: Record<string, string>): void {
  EN = dict;
  patterns = null;
  dictionaryLoaded = true;
}

/** Idioma y textos en inglés vigentes. Los fija `useLangRoot` al renderizar la raíz, antes que sus hijos. */
let current: { lang: Lang; en: EnglishText | null } = { lang: "es", en: null };

/** Idioma preferido del navegador: español si es el primero de su lista, inglés para cualquier otro. */
function browserLang(): Lang {
  const first = (navigator.languages?.[0] ?? navigator.language ?? "es").toLowerCase();
  return first.startsWith("es") ? "es" : "en";
}

/** Idioma de las páginas sin idioma en la URL (la raíz, el probador insertable): `?lang=`, luego el guardado en el navegador y, si no hay ninguno, el del navegador. */
export function initialLang(): Lang {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (fromUrl === "en" || fromUrl === "es") return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    /* sin almacenamiento: se usa el idioma del navegador */
  }
  try {
    return browserLang();
  } catch {
    return "es";
  }
}

export const currentLang = (): Lang => current.lang;

/** Fija el idioma y los textos en inglés para generar una página fuera del navegador (prerender). */
export function setRenderLang(lang: Lang, en: EnglishText | null): void {
  current = { lang, en };
}
export const isEnglish = (): boolean => current.lang === "en";

/** Sustituye {nombre} por su valor. */
const fill = (s: string, vars?: Record<string, string | number>): string => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/**
 * Texto de la interfaz. La clave es el texto en español: en español se devuelve tal cual y en inglés se busca en el
 * diccionario (si falta, se devuelve el español, nunca una clave rara). `{x}` se sustituye por `vars.x`.
 */
export function tr(es: string, vars?: Record<string, string | number>): string {
  return fill(current.lang === "en" ? (EN[es] ?? es) : es, vars);
}

/** El texto de interfaz tiene traducción en el diccionario (lo usa la prueba de cobertura). */
export const hasEnglish = (es: string): boolean => es in EN;

/** Configuración regional de los números: coma decimal en español, punto en inglés. */
export const numberLocale = (): string => (current.lang === "en" ? "en-US" : "es-ES");
export const fmtNum = (n: number, digits = 0): string => n.toLocaleString(numberLocale(), { maximumFractionDigits: digits });

// ---------- Texto que sale hecho del motor ----------

/** Nombres del juego (talentos, ventajas, habilidades) en español -> cómo se llaman en inglés, para los textos que el motor compone. */
const nameSources = new Map<string, () => string>();
const registered = new WeakSet<object>();

/** Registra los talentos y ventajas de una calculadora (el primero que llega gana si dos se llaman igual). */
export function registerTalents(data: ClassTalents): void {
  if (registered.has(data)) return;
  registered.add(data);
  for (const t of [...data.specs.flatMap((s) => s.talents), ...data.inactiveTalents]) {
    if (t.name && !nameSources.has(t.name)) nameSources.set(t.name, () => talentName(t.nodeId, t.name!));
  }
}

/** Registra las razas y sus raciales: el motor nombra una fuente racial «Raza: Racial». */
export function registerRaces(races: Race[]): void {
  if (registered.has(races)) return;
  registered.add(races);
  for (const r of races) {
    for (const a of r.racials) {
      const key = `${r.name}: ${a.name}`;
      if (!nameSources.has(key)) nameSources.set(key, () => `${raceLabel(r.id, r.name)}: ${racialEn(r.id, a.order)?.name ?? a.name}`);
    }
  }
}

/** Registra las habilidades de una clase. */
export function registerAbilities(data: { abilities: { name: string; ranks: { spellId: number }[] }[] }): void {
  if (registered.has(data)) return;
  registered.add(data);
  for (const a of data.abilities) if (!nameSources.has(a.name)) nameSources.set(a.name, () => abilityName(a.ranks.map((r) => r.spellId), a.name));
}

/** Nombre del juego en el idioma elegido (si no se conoce su inglés, el español). */
export const nm = (es: string): string => (current.lang === "en" ? (nameSources.get(es)?.() ?? es) : es);

const NUM = /(?<![\w.,])[+\-−]?\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*|«[^»]*»/g;

/** Número escrito en español -> inglés: «1,5» -> «1.5», «10.000» -> «10,000». */
const numToEnglish = (s: string): string => {
  if (s.includes(",")) return s.replace(/\./g, "").replace(",", ".");
  return /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, ",") : s;
};

/** Patrones del diccionario con `{*}` (un trozo de texto que también se traduce): «Tu clase no puede usar {*}». */
let patterns: { re: RegExp; template: string }[] | null = null;
const NUM_SRC = String.raw`([+\-−]?\d+(?:[.,]\d+)*)`;
function getPatterns(): { re: RegExp; template: string }[] {
  if (patterns) return patterns;
  patterns = Object.keys(EN)
    .filter((k) => k.includes("{*}"))
    .map((k) => {
      const src = k
        .split(/(\{\*\}|\{#\})/)
        .map((part) => (part === "{*}" ? "(.+?)" : part === "{#}" ? NUM_SRC : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("");
      return { re: new RegExp(`^${src}$`), template: EN[k]! };
    });
  return patterns;
}

/** Un trozo dentro de un patrón: se traduce tal cual y, si no está, como lista («Fuego, Naturaleza», «gigantes y humanoides»). */
function trPart(s: string): string {
  const t = trn(s);
  if (t !== s) return t;
  const parts = s.split(/, | y /);
  if (parts.length < 2) return s;
  const sep = s.includes(", ") ? ", " : " and ";
  return parts.map(trn).join(sep);
}

/**
 * Traduce un texto que el motor compone con cifras («+2 % probabilidad de crítico», «dura 15 s»): se busca tal cual y, si no
 * está, con las cifras sustituidas por `{#}` (clave «{#} % probabilidad de crítico», el signo va con la cifra) y, por último,
 * con los patrones que llevan `{*}` (un trozo que se traduce aparte). Los nombres del juego se pasan por `nm`. Lo que no esté
 * en el diccionario se devuelve en español.
 */
export function trn(es: string): string {
  if (current.lang !== "en" || !es) return es;
  const exact = EN[es];
  if (exact) return exact;
  const nums: string[] = [];
  const key = es.replace(NUM, (m) => {
    nums.push(m);
    return m.startsWith("«") ? "«{#}»" : "{#}";
  });
  const hit = nums.length ? EN[key] : undefined;
  if (hit) {
    let i = 0;
    return hit.replace(/\{#\}/g, () => {
      const v = nums[i++] ?? "";
      return v.startsWith("«") ? trn(v.slice(1, -1)) : numToEnglish(v);
    });
  }
  for (const { re, template } of getPatterns()) {
    const m = re.exec(es);
    if (!m) continue;
    let i = 1;
    return template.replace(/\{\*\}|\{#\}/g, (tok) => (tok === "{*}" ? trPart(m[i++] ?? "") : numToEnglish(m[i++] ?? "")));
  }
  return nameSources.get(es)?.() ?? formulaEn(es) ?? es;
}

/**
 * Fórmula del golpe de arma que compone el motor («mano derecha arma 50–70 + 4 de daño del equipo + 280 de poder de ataque ÷ 14 × 2,8 s + daño plano
 * × 50 % (mano izquierda) × 75 %»): la frase es siempre la misma con cifras distintas, así que se traduce por trozos.
 */
function formulaEn(es: string): string | null {
  if (!/(?:^|; )(?:(?:mano (?:derecha|izquierda) )?arma \d|Forma (?:felina|de oso) \(sin arma\))/.test(es)) return null;
  return es
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/Forma felina \(sin arma\)/g, "Cat Form (no weapon)")
    .replace(/Forma de oso \(sin arma\)/g, "Bear Form (no weapon)")
    .replace(/mano derecha arma/g, "main-hand weapon")
    .replace(/mano izquierda arma/g, "off-hand weapon")
    .replace(/(^|; )arma /g, "$1weapon ")
    .replace(/de daño del equipo/g, "gear damage")
    .replace(/de poder de ataque ÷ 14 × /g, "attack power ÷ 14 × ")
    .replace(/daño plano/g, "flat damage")
    .replace(/\(mano izquierda\)/g, "(off hand)")
    .replace(/ ; /g, " ; ");
}

/** Textos del juego en inglés (null en español o mientras se descargan). */
export const englishData = (): EnglishText | null => (current.lang === "en" ? current.en : null);

interface LangValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** English elegido pero los textos del juego todavía se están descargando, o no hay. */
  dataStatus: "ready" | "loading" | "missing" | "off";
}

export const LangContext = createContext<LangValue>({ lang: "es", setLang: () => {}, dataStatus: "off" });
export const useLang = (): LangValue => useContext(LangContext);

/**
 * Estado del idioma. Lo usa `App` (la raíz): al cambiar, App se vuelve a pintar y con ella todo el árbol, así que los
 * componentes no necesitan un hook para traducirse. `current` se fija en el render, antes que los hijos.
 * `setLang` solo recuerda la elección: cambiar de idioma también cambia de URL, y eso lo hace `App`.
 */
export function useLangRoot(englishFile: string | null, routeLang: Lang | null = null): LangValue {
  const [chosen, setLangState] = useState<Lang>(initialLang);
  // Con idioma en la URL (/es/…, /en/…) manda la URL; sin él, lo elegido
  const lang = routeLang ?? chosen;
  const [en, setEn] = useState<EnglishText | null>(null);
  const [failed, setFailed] = useState(false);
  const [dictReady, setDictReady] = useState(dictionaryLoaded);

  // Al pasar a English se descarga el diccionario de la interfaz (un trozo aparte del código)...
  useEffect(() => {
    if (lang !== "en" || dictReady) return;
    import("./i18n-en")
      .then((m) => setDictionary(m.EN))
      .catch(() => {})
      .finally(() => setDictReady(true));
  }, [lang, dictReady]);

  // ... y los textos del juego
  useEffect(() => {
    if (lang !== "en" || en || failed || !englishFile) return;
    let live = true;
    fetch(`${import.meta.env.BASE_URL}data/${englishFile}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: EnglishText) => live && setEn(j))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [lang, en, failed, englishFile]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  current = { lang, en };
  return useMemo<LangValue>(
    () => ({
      lang,
      setLang: (l) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, l);
        } catch {
          /* sin almacenamiento */
        }
        setLangState(l);
      },
      dataStatus: lang === "es" ? "off" : !dictReady ? "loading" : en ? "ready" : failed || !englishFile ? "missing" : "loading",
    }),
    [lang, en, failed, englishFile, dictReady],
  );
}

// ---------- Datos del juego (nombres y textos) ----------

export interface Localized {
  text: string;
  /** true = el texto es el inglés del juego. Con English elegido y `false`, no hay inglés y se muestra el español. */
  fromEnglish: boolean;
  /** true = traducción propia al inglés (el inglés oficial trae otras cifras que el cliente). */
  own?: boolean;
}

const en = (): EnglishText | null => englishData();

/** Nombre de una clase (por token: `mage`, `MAGE`). */
export function classLabel(token: string | null | undefined, fallback: string): string {
  const e = en();
  if (!e || !token) return fallback;
  const key = Object.keys(e.classes).find((k) => k.toLowerCase() === token.toLowerCase());
  return (key && e.classes[key]?.name) || fallback;
}

/** Nombre de un árbol de talentos de clase. */
export function specLabel(token: string | null | undefined, index: number, fallback: string): string {
  const e = en();
  if (!e || !token) return fallback;
  const key = Object.keys(e.classes).find((k) => k.toLowerCase() === token.toLowerCase());
  return (key && e.classes[key]?.specs[index]) || fallback;
}

/** Nombre de un árbol de una calculadora: de clase (`specLabel`) o de Legado. */
export function treeLabel(data: ClassTalents, index: number, fallback: string): string {
  return data.kind === "legacy" ? legacyTreeName(index, fallback) : specLabel(data.classToken, index, fallback);
}

/**
 * Copia de una calculadora con los nombres y textos de talentos y árboles en el idioma elegido (para «Copiar para IA»).
 * En español, o sin inglés cargado, devuelve los mismos datos.
 */
export function localizeClass(data: ClassTalents): ClassTalents {
  const e = englishData();
  if (!e) return data;
  const talent = <T extends { nodeId: number; name: string | null; descriptions: string[] }>(t: T): T => {
    const x = e.talents[t.nodeId];
    if (!x) return t;
    return { ...t, name: x.name, descriptions: t.descriptions.map((d, i) => x.descriptions[Math.min(i, x.descriptions.length - 1)] ?? d) };
  };
  return {
    ...data,
    specs: data.specs.map((s) => ({ ...s, name: treeLabel(data, s.index, s.name ?? ""), talents: s.talents.map(talent) })),
    inactiveTalents: data.inactiveTalents.map(talent),
  };
}

export function legacyTreeName(index: number, fallback: string): string {
  return en()?.legacyTrees[index] || fallback;
}

/** Nombre de un talento o ventaja de Legado (`nodeId`). */
export function talentName(nodeId: number, fallback: string): string {
  return en()?.talents[nodeId]?.name || fallback;
}

/** Descripción de un talento al rango dado (0 = rango 1); el español si no hay inglés. */
export function talentText(nodeId: number, rankIndex: number, fallback: string): Localized {
  const e = en();
  if (!e) return { text: fallback, fromEnglish: false };
  const d = e.talents[nodeId]?.descriptions ?? [];
  const t = d[Math.min(rankIndex, d.length - 1)];
  return t ? { text: t, fromEnglish: true, own: isOwnTranslation("talent", nodeId) } : { text: fallback, fromEnglish: false };
}

/** El texto inglés es una traducción propia (`spell:<id>`, `talent:<nodeId>`, `entry:<entryId>`, `item:<id>`, `set:<id>`). */
export function isOwnTranslation(kind: "spell" | "talent" | "entry" | "item" | "set", id: number): boolean {
  return en()?.ownTranslation.includes(`${kind}:${id}`) ?? false;
}

/** Nombre de un talento sin nodo (`entryId`). */
export function entryName(entryId: number, fallback: string): string {
  return en()?.entries[entryId]?.name || fallback;
}

/** Descripción de un talento sin nodo al rango dado (0 = rango 1); el español si no hay inglés. */
export function entryText(entryId: number, rankIndex: number, fallback: string): Localized {
  const e = en();
  if (!e) return { text: fallback, fromEnglish: false };
  const d = e.entries[entryId]?.descriptions ?? [];
  const t = d[Math.min(rankIndex, d.length - 1)];
  return t ? { text: t, fromEnglish: true, own: isOwnTranslation("entry", entryId) } : { text: fallback, fromEnglish: false };
}

/** Nombre de un conjunto de objetos. */
export function itemSetName(setId: number, fallback: string): string {
  return en()?.itemSets[setId] || fallback;
}

/** Hechizo en inglés por id (nombre, texto fijo de nivel 60, líneas del tooltip). */
export function spellEn(spellId: number): EnglishText["spells"][string] | null {
  return en()?.spells[spellId] ?? null;
}

/** Nombre de una habilidad (el de su primer rango con inglés). */
export function abilityName(spellIds: number[], fallback: string): string {
  const e = en();
  if (!e) return fallback;
  for (const id of spellIds) {
    const n = e.spells[id]?.name;
    if (n) return n;
  }
  return fallback;
}

export function itemName(itemId: number, fallback: string): string {
  return en()?.items[itemId] || fallback;
}

export function raceLabel(raceId: number, fallback: string): string {
  return en()?.races[raceId]?.name || fallback;
}

/** Racial `order` (0..3) de una raza. */
export function racialEn(raceId: number, order: number): EnglishText["races"][string]["racials"][number] | null {
  return en()?.races[raceId]?.racials[order] ?? null;
}
