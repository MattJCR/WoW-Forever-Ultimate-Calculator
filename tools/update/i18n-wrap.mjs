// Envuelve con tr("…") los textos en español de un fichero JSX/TSX de la web (texto suelto y atributos title/aria-label/placeholder/alt).
// Uso: node tools/update/i18n-wrap.mjs <fichero.tsx>...   (con --dry solo informa)
// No toca el texto mezclado con expresiones («Hay <b>{n}</b> razas»): esos se listan para pasarlos a mano con variables.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const fragments = args.includes("--fragments"); // también el texto mezclado con expresiones: cada trozo se traduce por separado (vale si el orden de las palabras no cambia)
const files = args.filter((a) => !a.startsWith("--"));
const ATTRS = new Set(["title", "aria-label", "placeholder", "alt", "aria-description"]);
const hasLetter = (s) => /[A-Za-zÁÉÍÓÚÑáéíóúñü]/.test(s);
const collapse = (raw) =>
  raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = []; // {start, end, text}
  const manual = [];
  const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const q = (s) => JSON.stringify(s);

  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children;
      const exprs = kids.filter((k) => ts.isJsxExpression(k) || ts.isJsxElement(k) || ts.isJsxSelfClosingElement(k));
      const texts = kids.filter((k) => ts.isJsxText(k) && hasLetter(k.text));
      // Mezcla de texto con expresiones o elementos en línea: no se toca
      const mixed = texts.length > 0 && exprs.some((e) => !(ts.isJsxExpression(e) && e.expression && ts.isStringLiteral(e.expression) && e.expression.text.trim() === ""));
      for (const t of texts) {
        const body = t.text;
        if (/[&]/.test(body)) {
          manual.push(`${file}:${line(t.getStart())} (entidad) ${collapse(body).slice(0, 70)}`);
          continue;
        }
        if (mixed) {
          if (!fragments) {
            manual.push(`${file}:${line(t.getStart())} (mezclado) ${collapse(body).slice(0, 70)}`);
            continue;
          }
          // Solo el núcleo (de la primera letra a la última letra o signo de fin de frase) va en tr(); espacios y signos de alrededor se quedan fuera
          const m = body.match(/^([^A-Za-zÁÉÍÓÚÑáéíóúñü]*)([\s\S]*?[A-Za-zÁÉÍÓÚÑáéíóúñü][.!?]?)([^A-Za-zÁÉÍÓÚÑáéíóúñü]*)$/);
          if (!m) continue;
          const [, pre, core, post] = m;
          const lit = (x) => (/^\s*$/.test(x) || !x ? x : x.includes("{") || x.includes("}") ? `{${q(x)}}` : x);
          edits.push({ start: t.getStart(), end: t.getEnd(), text: `${lit(pre)}{tr(${q(collapse(core))})}${lit(post)}` });
          continue;
        }
        const lead = body.match(/^\s*/)[0];
        const trail = body.match(/\s*$/)[0];
        edits.push({ start: t.getStart(), end: t.getEnd(), text: `${lead}{tr(${q(collapse(body))})}${trail}` });
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && ATTRS.has(node.name.getText())) {
      const v = node.initializer.text;
      if (hasLetter(v)) edits.push({ start: node.initializer.getStart(), end: node.initializer.getEnd(), text: `{tr(${q(v)})}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Los textos de un mismo nodo mezclado ya se han descartado; aplica de atrás adelante
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  if (edits.length && !/from "(\.\.?\/)+i18n"/.test(out)) {
    const rel = relative(dirname(resolve(file)), resolve("apps/web/src/i18n")).replace(/\\/g, "/");
    const spec = rel.startsWith(".") ? rel : `./${rel}`;
    const imports = [...out.matchAll(/^import .*;\s*$/gm)];
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
    out = `${out.slice(0, at)}\nimport { tr } from "${spec}";${out.slice(at)}`;
  } else if (edits.length && !/\btr\b[^"\n]*from "(\.\.?\/)+i18n"/.test(out) && !/import \{[^}]*\btr\b[^}]*\} from "(\.\.?\/)+i18n"/.test(out)) {
    out = out.replace(/import \{([^}]*)\} from "((?:\.\.?\/)+i18n)";/, (m, names, p) => `import {${names.trimEnd()}, tr } from "${p}";`);
  }
  console.log(`${file}: ${edits.length} textos envueltos, ${manual.length} a mano`);
  for (const m of manual) console.log(`   ${m}`);
  if (!dry && edits.length) writeFileSync(file, out);
}
