import type { AppearanceData } from "./equipment";

let cached: Promise<AppearanceData | null> | null = null;

/** appearance.json (objeto -> apariencia): se descarga una vez, solo en el paso Equipo. */
export function loadAppearance(base: string): Promise<AppearanceData | null> {
  cached ??= fetch(`${base}/appearance.json`).then((r) => (r.ok ? (r.json() as Promise<AppearanceData>) : null), () => null);
  return cached;
}
