// Lectura de los CSV en bruto (data/raw) que usa el conversor de modelos.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BUILD = process.env.BUILD ?? "1.60.1.70532";
const DIR = path.join(ROOT, "data", "raw", `${BUILD}-hotfix`);
const cache = new Map();

/** Filas de una tabla como objetos (todo texto; usar Number() donde haga falta). */
export function table(name) {
  if (!cache.has(name)) {
    cache.set(name, parse(fs.readFileSync(path.join(DIR, `${name}.csv`), "utf8"), { columns: true, skip_empty_lines: true }));
  }
  return cache.get(name);
}

/** Indice por una columna (o por varias, uniendo con ":"). Valores multiples -> listas. */
export function indexBy(name, col, { many = false } = {}) {
  const key = `${name}#${col}#${many}`;
  if (cache.has(key)) return cache.get(key);
  const m = new Map();
  for (const r of table(name)) {
    const k = r[col];
    if (many) { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); } else if (!m.has(k)) m.set(k, r);
  }
  cache.set(key, m);
  return m;
}
