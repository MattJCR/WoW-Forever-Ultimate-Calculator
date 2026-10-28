// Registro de cobertura de la revisión de parche: QUÉ comparación mira cada fichero del dataset y cada tabla DB2.
// Lo usan diff-builds.mjs (lista de ficheros genéricos), patch-check.mjs (informe) y la prueba de cobertura:
// si aparece un fichero nuevo en `data/forever/<build>/` sin una comparación asociada, la prueba falla y el cambio
// no puede volver a pasar sin salir en el informe (criterio «hecho» b del punto 0 de STATUS).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Ficheros del dataset sin sección propia en diff-builds: se comparan campo a campo (deepDiff). [fichero, etiqueta] */
export const GENERIC_FILES = [
  ["stats.json", "Estadísticas base"], ["client-stats.json", "Estadísticas del cliente"], ["combat-formulas.json", "Fórmulas de combate"],
  ["combat-ratings.json", "Puntuaciones de combate"], ["enchants.json", "Encantamientos"], ["equip-rules.json", "Reglas de equipo"],
  ["random-suffixes.json", "Sufijos aleatorios"], ["sources.json", "Fuentes de objetos"], ["unassigned.json", "Datos sin asignar"], ["icons.json", "Iconos"],
];

/** Carpetas de imágenes: no son datos, las cubre la comprobación de iconos y fondos (paso «Equipo y modelos»). */
export const ASSET_DIRS = ["icons", "backgrounds"];

/**
 * Cada fichero (ruta relativa al dataset) → qué comparación lo mira. El orden importa: gana la primera que casa.
 * `by` es el texto que sale en el informe («cobertura»).
 */
export const COVERAGE = [
  { match: /^manifest\.json$/, by: "patch-check › tablas leídas por el pipeline (hash de cada una) y recuento de clases" },
  { match: /^classes\/[a-z]+\.json$/, by: "diff-builds › Talentos · balance › cifras por rango · audit-texts" },
  { match: /^abilities\/[a-z]+\.json$/, by: "diff-builds › Habilidades · balance › cifras por rango · audit-texts" },
  { match: /^rules\/[a-z]+\.json$/, by: "diff-builds › Cobertura (reglas de talentos)" },
  { match: /^legacy\.json$/, by: "diff-builds › Legacy · audit-texts" },
  { match: /^races\.json$/, by: "diff-builds › Razas, raciales y raciales de clase · audit-texts" },
  { match: /^i18n\/en\.json$/, by: "diff-builds › Raciales en inglés y Cobertura · audit-texts (paridad ES/EN)" },
  { match: /^items\.json$/, by: "diff-items › Objetos y conjuntos · balance › equipo · audit-texts" },
  { match: /^buffs\.json$/, by: "diff-items › Beneficios · balance › beneficios · audit-texts" },
  ...GENERIC_FILES.map(([file, label]) => ({ match: new RegExp(`^${file.replace(/[.]/g, "\\.")}$`), by: `diff-builds › Cobertura (${label})` })),
];

/** Ficheros .json del dataset (rutas relativas con `/`), sin las carpetas de imágenes. */
export function datasetFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const rel = relative(dir, full).split("\\").join("/");
      if (statSync(full).isDirectory()) {
        if (!ASSET_DIRS.includes(rel)) walk(full);
      } else out.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Comparación que mira ese fichero, o null si ninguna. */
export const coveredBy = (rel) => COVERAGE.find((c) => c.match.test(rel))?.by ?? null;

/** Ficheros del dataset que ninguna comparación mira. Debe ser siempre []. */
export const uncoveredFiles = (dir) => datasetFiles(dir).filter((rel) => !coveredBy(rel));

/** Tablas DB2 que lee el pipeline (las apunta el manifest) y que faltan en el volcado en bruto: sin ellas no se compara nada. */
export function pipelineTablesMissingInRaw(datasetDir, rawDir) {
  const manifest = JSON.parse(readFileSync(join(datasetDir, "manifest.json"), "utf8"));
  return (manifest.inputs ?? []).map((i) => i.table).filter((t) => !existsSync(join(rawDir, `${t}.csv`)));
}
