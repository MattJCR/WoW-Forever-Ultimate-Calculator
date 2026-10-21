import { UI } from "./i18n-en-ui";
import { PAGES } from "./i18n-en-pages";
import { ENGINE } from "./i18n-en-engine";
import { GEAR } from "./i18n-en-gear";
import { RULES } from "./i18n-en-rules";

/** Diccionario español -> inglés de la interfaz (ver i18n.tsx). Se reparte en ficheros por tema; esto los junta. */
export const EN: Record<string, string> = { ...UI, ...PAGES, ...GEAR, ...RULES, ...ENGINE };
