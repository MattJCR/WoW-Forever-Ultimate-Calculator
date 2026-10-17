import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

export type Row = Record<string, string>;

export interface RawTables {
  dir: string;
  /** Lee una tabla CSV; falla con un mensaje claro si no existe. */
  table(name: string): Row[];
  /** Hash de las tablas que se han leido, para el manifest. */
  inputs(): { table: string; sha256: string }[];
}

export function openRawTables(dir: string): RawTables {
  const cache = new Map<string, Row[]>();
  const hashes = new Map<string, string>();
  return {
    dir,
    table(name) {
      const hit = cache.get(name);
      if (hit) return hit;
      let buf: Buffer;
      try {
        buf = readFileSync(join(dir, `${name}.csv`));
      } catch {
        throw new Error(`Falta ${name}.csv en ${dir}. Exportalo con tools/extract/export-tables.sh`);
      }
      hashes.set(name, createHash("sha256").update(buf).digest("hex"));
      const rows = parse(buf, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Row[];
      cache.set(name, rows);
      return rows;
    },
    inputs() {
      return [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([table, sha256]) => ({ table, sha256 }));
    },
  };
}

export const int = (v: string | undefined): number => (v === undefined || v === "" ? 0 : Number.parseInt(v, 10));
