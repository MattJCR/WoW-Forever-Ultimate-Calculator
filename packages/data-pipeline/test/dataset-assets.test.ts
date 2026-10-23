import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Las imágenes del dataset no las genera el pipeline: se bajan aparte (fetch-icons, fetch-backgrounds, fetch-legacy-background) y hay que
// llevarlas a cada build nuevo. En el parche 70532 se olvidaron los fondos de los árboles y el panel de Legado y la web publicada los perdió.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FOREVER = join(root, "data", "forever");
const BUILD = readdirSync(FOREVER).filter((d) => !d.endsWith("-static")).sort().at(-1)!;
const DIR = join(FOREVER, BUILD);
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
const TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];

describe(`imágenes del dataset más reciente (${BUILD})`, () => {
  it("cada especialización tiene sus 4 trozos de fondo y existe el panel de Legado", () => {
    const missing: string[] = [];
    for (const t of TOKENS) {
      for (const spec of read(`classes/${t}.json`).specs as { backgroundFile: string | null }[]) {
        if (!spec.backgroundFile) continue;
        for (const part of ["TopLeft", "TopRight", "BottomLeft", "BottomRight"]) {
          if (!existsSync(join(DIR, "backgrounds", `${spec.backgroundFile}-${part}.png`))) missing.push(`${spec.backgroundFile}-${part}`);
        }
      }
    }
    if (!existsSync(join(DIR, "backgrounds", "LegacyTree-Panel.png"))) missing.push("LegacyTree-Panel");
    expect(missing).toEqual([]);
  });

  it("todos los iconos que lista icons.json están descargados", () => {
    const ids = (read("icons.json").ids as number[]).filter((id) => id > 0);
    expect(ids.filter((id) => !existsSync(join(DIR, "icons", `${id}.png`)))).toEqual([]);
  });
});
