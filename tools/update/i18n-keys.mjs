// Claves de traducción de la web: argumentos literales de tr()/trn() más las tablas de textos que se traducen al usarlas.
// Uso: node tools/update/i18n-keys.mjs            -> lista las claves que faltan en apps/web/src/i18n-en.ts
//      node tools/update/i18n-keys.mjs --all      -> lista todas
//      node tools/update/i18n-keys.mjs --unused   -> claves del diccionario que ya no se usan
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = resolve(import.meta.dirname, "../../apps/web/src");

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(root).filter((f) => /\.tsx?$/.test(f) && !/i18n-en/.test(f));

// Tablas de textos (valor en español, se traduce con tr al usarlas): fichero -> nombres de constantes
const TABLES = {
  "components/gear-format.ts": ["QUALITY_NAMES", "STAT_LABELS", "INVENTORY_LABEL", "ARMOR_TYPE", "WEAPON_TYPE", "BONDING", "EFFECT_PREFIX", "CLASS_NAMES"],
  "components/Abilities.tsx": ["POWER_LABEL", "KIND_LABEL", "BASIS"],
  "components/ClassShell.tsx": ["VIEWS"],
  "components/StatEffects.tsx": ["FROM"],
  "components/Gear.tsx": ["ORIGIN_LABEL"],
  "components/LinkNotice.tsx": ["REASON"],
  "messages.ts": ["BLOCKER_TEXT"],
  "pages/ClassPage.tsx": ["FACTION_LABEL"],
  "pages/Home.tsx": ["STEPS"],
};
const keys = new Map(); // clave -> "fichero:línea"
const add = (k, f, line) => {
  if (k && !keys.has(k)) keys.set(k, `${f.replace(root, "").replace(/\\/g, "/").slice(1)}:${line}`);
};

for (const file of files) {
  const rel = file.replace(root, "").replace(/\\/g, "/").slice(1);
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const wanted = new Set(TABLES[rel] ?? []);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (n) => {
    if (ts.isCallExpression(n) && ["tr", "trn"].includes(n.expression.getText()) && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
      add(n.arguments[0].text, file, line(n));
    }
    // plural(n, "nodo", "nodos"): los dos textos se traducen con tr dentro de plural
    if (ts.isCallExpression(n) && n.expression.getText() === "plural") {
      for (const a of n.arguments.slice(1, 3)) if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) add(a.text, file, line(n));
    }
    if (ts.isVariableDeclaration(n) && wanted.has(n.name.getText()) && n.initializer) {
      const grab = (x) => {
        if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
          if (/[A-Za-zÁÉÍÓÚÑáéíóúñü]/.test(x.text)) add(x.text, file, line(x));
        } else if (ts.isPropertyAssignment(x)) {
          // En {id: "view", label: "Raza"} solo es texto el valor de `label`/`title`/`text`; en un Record de claves técnicas, todos los valores
          const k = x.name.getText().replace(/["']/g, "");
          if (!["id", "key", "kind"].includes(k)) grab(x.initializer);
        } else ts.forEachChild(x, grab);
      };
      grab(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// Claves que se aplican por interpolación en el código (no son literales de tr): clases, calidades, etc.
for (const k of ["Guerrero", "Paladín", "Cazador", "Pícaro", "Sacerdote", "Chamán", "Mago", "Brujo", "Druida"]) add(k, "(clases)", 0);

const dict = readdirSync(root).filter((f) => /^i18n-en-.*\.ts$/.test(f)).map((f) => readFileSync(join(root, f), "utf8")).join("\n");
const have = new Set([...dict.matchAll(/^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)\s*:/gm)].map((m) => JSON.parse(`"${(m[1] ?? m[2] ?? m[3]).replace(/"/g, '\\"').replace(/\\'/g, "'")}"`)));

const mode = process.argv[2];
if (mode === "--unused") {
  for (const k of have) if (!keys.has(k)) console.log(k);
} else {
  const list = [...keys].filter(([k]) => mode === "--all" || !have.has(k));
  for (const [k, where] of list) console.log(`${where}\t${JSON.stringify(k)}`);
  const missing = [...keys].filter(([k]) => !have.has(k)).length;
  console.error(`${keys.size} claves, ${have.size} traducidas, ${missing} sin traducir`);
  if (missing > 0 && process.argv.includes("--check")) process.exit(1);
}
