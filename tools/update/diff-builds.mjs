#!/usr/bin/env node
// Compara dos datasets normalizados (salida de `npm run pipeline`) y lista TODO lo que cambia:
// talentos, Legacy, habilidades (por rango), raciales. Solo lee ficheros del repo; no toca el cliente.
//
// Uso: node tools/update/diff-builds.mjs <dirViejo> <dirNuevo> [--out informe.md] [--class mage] [--max 40]
//   dirViejo/dirNuevo: carpetas tipo data/forever/<build>[-static]  (o una copia guardada del build anterior)
// Sale con codigo 0 siempre; mira el informe. Con --out escribe un Markdown (usa el scratchpad o docs/changes/).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (positional.length < 2) {
  console.error("Uso: node tools/update/diff-builds.mjs <dirViejo> <dirNuevo> [--out informe.md] [--class mage] [--max 40]");
  process.exit(2);
}
const [oldDir, newDir] = positional.map((p) => resolve(p));
const only = flag("class");
const MAX = Number(flag("max", "40"));
const out = flag("out");

const readJson = (dir, rel) => { const f = join(dir, rel); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = (v) => { const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "∅"); return s.length > 140 ? `${s.slice(0, 137)}…` : s; };

const lines = [];
const log = (s = "") => lines.push(s);
let total = 0;

function section(title, added, removed, changed) {
  const n = added.length + removed.length + changed.length;
  if (!n) return;
  total += n;
  log(`### ${title} (${added.length} nuevos, ${removed.length} quitados, ${changed.length} cambiados)`);
  const list = (label, arr) => { for (const l of arr.slice(0, MAX)) log(`- ${label} ${l}`); if (arr.length > MAX) log(`- … y ${arr.length - MAX} más (${label})`); };
  list("＋", added); list("－", removed); list("Δ", changed);
  log();
}

function diffKeyed(oldList, newList, key, fields, label) {
  const o = new Map(oldList.map((x) => [key(x), x]));
  const n = new Map(newList.map((x) => [key(x), x]));
  const added = [...n.keys()].filter((k) => !o.has(k)).map((k) => label(n.get(k)));
  const removed = [...o.keys()].filter((k) => !n.has(k)).map((k) => label(o.get(k)));
  const changed = [];
  for (const [k, nv] of n) {
    const ov = o.get(k);
    if (!ov) continue;
    // Un campo ausente en un lado es un cambio de esquema del pipeline, no del cliente: no se compara.
    const diffs = fields.filter((f) => ov[f] !== undefined && nv[f] !== undefined && !same(ov[f], nv[f])).map((f) => `${f}: ${short(ov[f])} → ${short(nv[f])}`);
    if (diffs.length) changed.push(`${label(nv)} — ${diffs.join("; ")}`);
  }
  return { added, removed, changed };
}

const TALENT_FIELDS = ["spellId", "maxRank", "row", "col", "requiredPoints", "gate", "prerequisites", "passive", "effectInfo", "rankValues", "descriptions"];
const RANK_FIELDS = ["level", "learnedByTalent", "maxLevel", "costType", "cost", "costPctOfBase", "castMs", "channeled", "durationMs", "cooldownMs", "rangeYd", "schoolMask", "classMask", "radiusYd", "charges", "acquireMethod", "effects", "procs", "description"];

function talentsOf(cls) {
  return [
    ...cls.specs.flatMap((s) => s.talents.map((t) => ({ ...t, _tree: s.name ?? s.specName ?? "" }))),
    ...(cls.inactiveTalents ?? []).map((t) => ({ ...t, _tree: "(nodo no activo)" })),
  ];
}

function diffTalents(title, a, b) {
  const r = diffKeyed(talentsOf(a), talentsOf(b), (t) => t.nodeId ?? t.name, TALENT_FIELDS, (t) => `${t.name} [${t._tree}]`);
  section(title, r.added, r.removed, r.changed);
}

function diffAbilities(title, a, b) {
  const aAb = a.abilities, bAb = b.abilities;
  const r = diffKeyed(aAb, bAb, (x) => x.name, [], (x) => x.name);
  const changed = [];
  for (const nv of bAb) {
    const ov = aAb.find((x) => x.name === nv.name);
    if (!ov) continue;
    const rr = diffKeyed(ov.ranks, nv.ranks, (x) => x.spellId, RANK_FIELDS, (x) => `rango ${x.rank} (${x.spellId})`);
    const parts = [...rr.added.map((s) => `＋${s}`), ...rr.removed.map((s) => `－${s}`), ...rr.changed.map((s) => `Δ${s}`)];
    const tf = ov.talentsForever?.status !== nv.talentsForever?.status ? [`estado TF: ${ov.talentsForever?.status} → ${nv.talentsForever?.status}`] : [];
    if (parts.length || tf.length) changed.push(`${nv.name} — ${[...tf, ...parts].join(" | ")}`);
  }
  section(title, r.added, r.removed, changed);
}

function diffRaces(a, b) {
  const flat = (r) => r.races.flatMap((x) => x.racials.map((c) => ({ race: x.name, ...c })));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x.race}/${x.name}`, ["kind", "description", "spells"], (x) => `${x.race}: ${x.name}`);
  section("Razas y raciales", r.added, r.removed, r.changed);
  const raceRes = diffKeyed(a.races, b.races, (x) => x.id, ["classIds", "faction", "racialSkillLineId"], (x) => x.name);
  section("Razas (matriz raza/clase)", raceRes.added, raceRes.removed, raceRes.changed);
}

function classFiles(dir) {
  const d = join(dir, "classes");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort() : [];
}

log(`# Cambios entre datasets`);
log();
const mOld = readJson(oldDir, "manifest.json"), mNew = readJson(newDir, "manifest.json");
log(`- Antes: ${oldDir} (build ${mOld?.build ?? "?"}, generado ${mOld?.generatedAt ?? "?"}, hotfixes ${mOld?.hotfixesApplied})`);
log(`- Ahora: ${newDir} (build ${mNew?.build ?? "?"}, generado ${mNew?.generatedAt ?? "?"}, hotfixes ${mNew?.hotfixesApplied})`);
log();

const tokens = [...new Set([...classFiles(oldDir), ...classFiles(newDir)])].filter((t) => !only || t === only);
for (const t of tokens) {
  const aC = readJson(oldDir, `classes/${t}.json`), bC = readJson(newDir, `classes/${t}.json`);
  const name = bC?.className ?? aC?.className ?? t;
  if (!aC || !bC) { log(`## ${name}\n- Clase ${aC ? "quitada" : "nueva"} entre builds\n`); total++; continue; }
  const before = total;
  log(`## ${name}`);
  diffTalents("Talentos", aC, bC);
  const aA = readJson(oldDir, `abilities/${t}.json`), bA = readJson(newDir, `abilities/${t}.json`);
  if (aA && bA) diffAbilities("Habilidades", aA, bA);
  else if (aA || bA) { log(`- Libro de habilidades ${aA ? "quitado" : "nuevo"}\n`); total++; }
  if (total === before) { lines.pop(); log(`## ${name}\n- Sin cambios\n`); }
}

if (!only) {
  const aL = readJson(oldDir, "legacy.json"), bL = readJson(newDir, "legacy.json");
  if (aL && bL) { log("## Legacy"); const b4 = total; diffTalents("Ventajas de Legacy", aL, bL); if (total === b4) log("- Sin cambios\n"); }
  const aR = readJson(oldDir, "races.json"), bR = readJson(newDir, "races.json");
  if (aR && bR) { log("## Razas"); const b4 = total; diffRaces(aR, bR); if (total === b4) log("- Sin cambios\n"); }
  const aS = readJson(oldDir, "stats.json"), bS = readJson(newDir, "stats.json");
  if (aS && bS && !same(aS.combos, bS.combos)) { log("## Estadísticas base\n- `stats.json › combos` ha cambiado\n"); total++; }
}

log(`---\nTotal de diferencias: ${total}`);
const text = `${lines.join("\n")}\n`;
if (out) writeFileSync(resolve(out), text);
console.log(text);
