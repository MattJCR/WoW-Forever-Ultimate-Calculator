// Lista los textos en español que quedan sin traducir en los ficheros TSX/TS de la web: literales de cadena y plantillas que
// parecen frases (letras con espacios o acentos) y no son argumento de tr()/trn()/nm(). Es una ayuda para repasar a mano.
// Uso: node tools/update/i18n-scan.mjs <ficheros...>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const IGNORE_ATTR = new Set(["className", "key", "type", "id", "htmlFor", "href", "src", "role", "style", "value", "name", "data-state", "data-node", "target", "rel", "d", "points", "viewBox", "fill", "stroke", "strokeLinecap", "strokeLinejoin", "lang", "loading", "decoding", "inputMode", "autoComplete"]);
const looksSpanish = (s) => /[áéíóúñü¿¡]/i.test(s) || /\b(de|del|la|el|los|las|con|por|para|sin|que|una|un|más|solo|tu|tus|su|sus|al|se|no|es|en|y)\b/i.test(s);
const phrase = (s) => /[A-Za-zÁÉÍÓÚÑáéíóúñü]{3,}/.test(s) && /\s|[áéíóúñü]/i.test(s) && looksSpanish(s);

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = [];
  const insideCall = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ["tr", "trn", "nm", "hasEnglish"].includes(p.expression.getText())) return true;
      if (ts.isImportDeclaration(p) || ts.isTypeNode(p)) return true;
    }
    return false;
  };
  const visit = (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !insideCall(n)) {
      const attr = n.parent && ts.isJsxAttribute(n.parent) ? n.parent.name.getText() : null;
      if (!(attr && IGNORE_ATTR.has(attr)) && !(n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n) && phrase(n.text)) hits.push([n, n.text]);
    } else if (ts.isTemplateExpression(n) && !insideCall(n)) {
      const text = n.head.text + n.templateSpans.map((s) => `{}${s.literal.text}`).join("");
      if (phrase(text)) hits.push([n, text]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const [n, t] of hits) console.log(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}  ${t.replace(/\s+/g, " ").slice(0, 110)}`);
}
