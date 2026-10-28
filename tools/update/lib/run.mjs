// Ejecución de subprocesos para patch-check: captura la salida, mide el tiempo y nunca lanza (devuelve el código).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Carpeta de los exports de la referencia externa (solo contraste; la misma que lee el pipeline). */
export const REFERENCE_DIR = join(ROOT, "data", "external", "talentsforever");

/** Ejecuta `cmd args` y devuelve { code, stdout, stderr, seconds }. `npm`/`npx` pasan por el shell en Windows. */
export function run(cmd, args = [], { cwd = ROOT, env = {}, timeoutMs = 20 * 60_000 } = {}) {
  const t0 = Date.now();
  const shell = process.platform === "win32" && /^(npm|npx)$/.test(cmd);
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}`, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

/** Ejecuta un script de este repo con el mismo Node y `tsx` (para los .mjs que importan .ts del pipeline). */
export const runNode = (script, args = [], opts) => run(process.execPath, ["--import", "tsx", join(ROOT, script), ...args], opts);

/** Últimas `n` líneas no vacías de un texto. */
export const tail = (text, n = 12) => text.split(/\r?\n/).filter((l) => l.trim()).slice(-n);
