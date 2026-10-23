// Cambios de equipo y consumibles entre dos datasets: objetos nuevos / quitados / cambiados (campo a campo),
// conjuntos, objetos que pasan de «sin datos» a tener datos, y beneficios (`buffs.json`). Complementa a diff-builds.mjs,
// que solo mira talentos, habilidades, razas y Legacy. Solo lee `data/forever/`.
// Uso: node tools/update/diff-items.mjs <viejo> <nuevo> [--out f.md] [--max N]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const [oldDir, newDir] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const opt = (k, d) => args.find((a, i) => args[i - 1] === `--${k}`) ?? d;
const max = Number(opt("max", 40));
if (!oldDir || !newDir) {
  console.error("Uso: node tools/update/diff-items.mjs <datasetViejo> <datasetNuevo> [--out f.md] [--max N]");
  process.exit(2);
}
const load = (d, f) => JSON.parse(readFileSync(join(d, f), "utf8"));
const lines = [];
const out = (s = "") => lines.push(s);
const list = (title, rows) => {
  out(`### ${title} (${rows.length})`);
  for (const r of rows.slice(0, max)) out(`- ${r}`);
  if (rows.length > max) out(`- … y ${rows.length - max} más (usa --max)`);
  out();
};
const IGNORE = new Set(["provenance"]);
const fields = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORE.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const short = (v) => (JSON.stringify(v) ?? "—").slice(0, 70);

const A = load(oldDir, "items.json");
const B = load(newDir, "items.json");
out(`# Equipo y consumibles entre datasets`);
out();
out(`- Antes: ${oldDir} (build ${A.build})`);
out(`- Ahora: ${newDir} (build ${B.build})`);
out();

const ma = new Map(A.items.map((i) => [i.id, i]));
const mb = new Map(B.items.map((i) => [i.id, i]));
const added = B.items.filter((i) => !ma.has(i.id));
const removed = A.items.filter((i) => !mb.has(i.id));
const changed = B.items.filter((i) => ma.has(i.id) && fields(ma.get(i.id), i).length);
const fmt = (i) => `${i.id} ${i.name} (calidad ${i.quality}, nivel de objeto ${i.itemLevel}, nivel ${i.requiredLevel}, ${i.provenance})`;

out(`## Objetos`);
out();
const byKind = {};
for (const i of added) {
  const k = `calidad ${i.quality} · nivel de objeto ${i.itemLevel} · nivel requerido ${i.requiredLevel}`;
  byKind[k] = (byKind[k] ?? 0) + 1;
}
out(`Nuevos por calidad / nivel: ${Object.entries(byKind).map(([k, n]) => `${n} × ${k}`).join("; ") || "ninguno"}`);
out();
list("Nuevos", added.map(fmt));
list("Quitados", removed.map(fmt));
list("Cambiados (¿equilibrado?)", changed.map((i) => `${i.id} ${i.name}: ${fields(ma.get(i.id), i).map((k) => `${k} ${short(ma.get(i.id)[k])} → ${short(i[k])}`).join(" | ")}`));
const ua = new Set(A.unavailable.map((u) => u.id));
const ub = new Set(B.unavailable.map((u) => u.id));
list("Dejan de estar «sin datos» (el cliente ya los trae)", [...ua].filter((id) => !ub.has(id)).map((id) => `${id} ${mb.get(id)?.name ?? "?"}`));
list("Pasan a «sin datos»", [...ub].filter((id) => !ua.has(id)).map(String));

out(`## Conjuntos`);
out();
const sa = new Map(A.sets.map((s) => [s.id, s]));
list("Nuevos", B.sets.filter((s) => !sa.has(s.id)).map((s) => `${s.id} ${s.name}: ${s.itemIds.length} piezas, bonos a ${s.bonuses.map((b) => b.threshold).join("/")}`));
list("Cambiados", B.sets.filter((s) => sa.has(s.id) && JSON.stringify(sa.get(s.id)) !== JSON.stringify(s)).map((s) => `${s.id} ${s.name}: ${fields(sa.get(s.id), s).join(", ")}`));
list("Quitados", A.sets.filter((s) => !B.sets.some((x) => x.id === s.id)).map((s) => `${s.id} ${s.name}`));

out(`## Beneficios (buffs.json)`);
out();
const ba = new Map(load(oldDir, "buffs.json").buffs.map((b) => [b.id, b]));
const bbList = load(newDir, "buffs.json").buffs;
list("Nuevos", bbList.filter((b) => !ba.has(b.id)).map((b) => `${b.id} ${b.name} (${b.category}, ${b.durationMs ? b.durationMs / 60000 + " min" : "sin duración"})`));
list("Cambiados", bbList.filter((b) => ba.has(b.id) && fields(ba.get(b.id), b).length).map((b) => `${b.id} ${b.name}: ${fields(ba.get(b.id), b).join(", ")}`));
list("Quitados", [...ba.values()].filter((b) => !bbList.some((x) => x.id === b.id)).map((b) => `${b.id} ${b.name}`));

const text = lines.join("\n");
const file = opt("out", null);
if (file) {
  writeFileSync(file, text);
  console.log(`Escrito ${file}`);
} else console.log(text);
console.log(`Resumen: ${added.length} objetos nuevos, ${removed.length} quitados, ${changed.length} cambiados.`);
