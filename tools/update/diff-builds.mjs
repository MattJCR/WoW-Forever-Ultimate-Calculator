#!/usr/bin/env node
// Compara dos datasets normalizados (salida de `npm run pipeline`) y lista TODO lo que cambia:
// talentos, Legacy, habilidades (por rango), raciales (por hechizo, de clase y en ingles) y, como red de seguridad, TODOS los demas
// ficheros del dataset (estadisticas, formulas, encantamientos, iconos, ingles…). Solo lee ficheros del repo; no toca el cliente.
// La lógica está en lib/diff-builds.mjs.
//
// Uso: node tools/update/diff-builds.mjs <dirViejo> <dirNuevo> [--out informe.md] [--class mage] [--max 40]
//   dirViejo/dirNuevo: carpetas tipo data/forever/<build>[-static]  (o una copia guardada del build anterior)
// Sale con codigo 0 siempre; mira el informe. Con --out escribe un Markdown (usa el scratchpad o docs/changes/).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffDatasets } from "./lib/diff-builds.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (positional.length < 2) {
  console.error("Uso: node tools/update/diff-builds.mjs <dirViejo> <dirNuevo> [--out informe.md] [--class mage] [--max 40]");
  process.exit(2);
}
const [oldDir, newDir] = positional.map((p) => resolve(p));
const { text } = diffDatasets(oldDir, newDir, { only: flag("class"), max: Number(flag("max", "40")) });
if (flag("out")) writeFileSync(resolve(flag("out")), text);
console.log(text);
