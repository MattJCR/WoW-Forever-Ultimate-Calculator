#!/usr/bin/env node
// Compara dos datasets normalizados (salida de `npm run pipeline`) y lista TODO lo que cambia:
// talentos, Legacy, habilidades (por rango), raciales (por hechizo, de clase y en ingles) y, como red de seguridad, TODOS los demas
// ficheros del dataset (estadisticas, formulas, encantamientos, iconos, ingles…). Solo lee ficheros del repo; no toca el cliente.
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
const RANK_FIELDS = ["level", "learnedByTalent", "maxLevel", "costType", "cost", "costPctOfBase", "castMs", "channeled", "durationMs", "cooldownMs", "rangeYd", "schoolMask", "classMask", "radiusYd", "charges", "acquireMethod", "races", "effects", "procs", "description", "descriptionTemplate", "textOrigin"];

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
    const tf = ov.talentsForever?.status !== nv.talentsForever?.status ? [`estado la referencia: ${ov.talentsForever?.status} → ${nv.talentsForever?.status}`] : [];
    if (parts.length || tf.length) changed.push(`${nv.name} — ${[...tf, ...parts].join(" | ")}`);
  }
  section(title, r.added, r.removed, changed);
}

const effectText = (e) => `${e.kind ?? "?"}(${e.aura})=${e.value}${e.fromSpellId ? `←${e.fromSpellId}` : ""}`;
const SPELL_FIELDS = ["classMask", "durationMs", "cooldownMs", "procChance", "procCooldownMs", "effects", "description"];

// Cada hechizo de cada racial por separado y con sus campos legibles (antes salia todo el JSON en una sola linea)
function diffRacialSpells(a, b) {
  const flat = (r) => r.races.flatMap((x) => x.racials.flatMap((c) => c.spells.map((sp) => ({ ...sp, effects: sp.effects.map(effectText), _race: x.name, _racial: c.name }))));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x._race}/${x._racial}/${x.spellId}`, SPELL_FIELDS, (x) => `${x._race}: ${x._racial} (hechizo ${x.spellId})`);
  section("Hechizos de las raciales (texto completo, enfriamiento, duración, efectos)", r.added, r.removed, r.changed);
}

// Habilidades de clase ligadas a una raza (Sacerdote…): Race.classRacials
function diffClassRacials(a, b) {
  const flat = (r) => r.races.flatMap((x) => (x.classRacials ?? []).map((c) => ({ ...c, _race: x.name })));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x._race}/${x.classId}/${x.name}`, ["iconFileDataId", "spellId", "level", "durationMs", "cooldownMs", "description", "textOrigin", "scalesWith"], (x) => `${x._race}: ${x.name} (clase ${x.classId})`);
  section("Raciales de clase (habilidades ligadas a una raza)", r.added, r.removed, r.changed);
}

// Nombre y texto de las raciales en inglés (i18n/en.json › races)
function diffRacialsEnglish(a, b) {
  const flat = (e) => Object.entries(e?.races ?? {}).flatMap(([id, r]) => r.racials.map((c, order) => ({ ...c, _key: `${id}/${order}`, _race: r.name })));
  const r = diffKeyed(flat(a), flat(b), (x) => x._key, ["name", "description", "spellTexts"], (x) => `${x._race}: ${x.name}`);
  section("Raciales en inglés (nombre y texto)", r.added, r.removed, r.changed);
}

function diffRaces(a, b) {
  const flat = (r) => r.races.flatMap((x) => x.racials.map((c) => ({ race: x.name, ...c, spells: undefined })));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x.race}/${x.name}`, ["kind", "description", "iconFileDataId", "textOrigin", "pvpTrinket"], (x) => `${x.race}: ${x.name}`);
  section("Razas y raciales (resumen de la tabla del cliente)", r.added, r.removed, r.changed);
  diffRacialSpells(a, b);
  diffClassRacials(a, b);
  const raceRes = diffKeyed(a.races, b.races, (x) => x.id, ["classIds", "faction", "racialSkillLineId", "name", "nameFemale", "token"], (x) => x.name);
  section("Razas (matriz raza/clase)", raceRes.added, raceRes.removed, raceRes.changed);
}

// ---- Red de seguridad: cada fichero del dataset se compara, tenga o no sección propia ----
const isPrim = (x) => x === null || typeof x !== "object";
const keyOf = (x, i) => (isPrim(x) ? i : (x.id ?? x.spellId ?? x.nodeId ?? x.entryId ?? x.itemId ?? x.name ?? i));

/** Diferencias estructurales (ruta: antes → ahora). Un campo ausente en un lado es cambio de esquema del pipeline y no se cuenta. */
function deepDiff(x, y, path, acc) {
  if (same(x, y)) return;
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.every(isPrim) && y.every(isPrim)) {
      const add = y.filter((v) => !x.includes(v)), rem = x.filter((v) => !y.includes(v));
      acc.push(`${path}: +${add.length} −${rem.length}${add.length + rem.length <= 6 ? ` (+${short(add)} −${short(rem)})` : ""}`);
      return;
    }
    let mx = new Map(x.map((v, i) => [keyOf(v, i), v])), my = new Map(y.map((v, i) => [keyOf(v, i), v]));
    if (mx.size !== x.length || my.size !== y.length) { mx = new Map(x.map((v, i) => [i, v])); my = new Map(y.map((v, i) => [i, v])); }
    for (const k of my.keys()) if (!mx.has(k)) acc.push(`＋ ${path}[${k}]`);
    for (const k of mx.keys()) if (!my.has(k)) acc.push(`－ ${path}[${k}]`);
    for (const [k, v] of my) if (mx.has(k)) deepDiff(mx.get(k), v, `${path}[${k}]`, acc);
    return;
  }
  if (!isPrim(x) && !isPrim(y) && !Array.isArray(x) && !Array.isArray(y)) {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (path === "" && (k === "build" || k === "generatedAt")) continue; // cambian siempre
      if (x[k] === undefined || y[k] === undefined) { if (path === "") acc.push(`${y[k] === undefined ? "－" : "＋"} ${k}`); continue; }
      deepDiff(x[k], y[k], path ? `${path}.${k}` : k, acc);
    }
    return;
  }
  acc.push(`${path}: ${short(x)} → ${short(y)}`);
}

/** Ficheros del dataset sin seccion propia mas arriba: comparacion estructural. items.json y buffs.json los cubre diff-items.mjs. */
const GENERIC_FILES = [
  ["stats.json", "Estadísticas base"], ["client-stats.json", "Estadísticas del cliente"], ["combat-formulas.json", "Fórmulas de combate"],
  ["combat-ratings.json", "Puntuaciones de combate"], ["enchants.json", "Encantamientos"], ["equip-rules.json", "Reglas de equipo"],
  ["random-suffixes.json", "Sufijos aleatorios"], ["sources.json", "Fuentes de objetos"], ["unassigned.json", "Datos sin asignar"], ["icons.json", "Iconos"],
];

function listDiffs(label, rel, acc) {
  total += acc.length;
  log(`### ${label} (${rel}): ${acc.length} diferencias`);
  for (const l of acc.slice(0, MAX)) log(`- Δ ${l}`);
  if (acc.length > MAX) log(`- … y ${acc.length - MAX} más`);
  log();
}

function diffEverythingElse(mOld, mNew) {
  log("## Cobertura: el resto de ficheros del dataset");
  const files = [...GENERIC_FILES];
  for (const e of new Set([...(mOld?.rules ?? []), ...(mNew?.rules ?? [])].map((x) => x.file))) files.push([e, "Reglas de talentos"]);
  const same0 = [];
  for (const [rel, label] of files) {
    const x = readJson(oldDir, rel), y = readJson(newDir, rel);
    if (!x && !y) continue;
    if (!x || !y) { log(`- ${label} (${rel}): fichero ${x ? "quitado" : "nuevo"}`); total++; continue; }
    const acc = [];
    deepDiff(x, y, "", acc);
    if (acc.length) listDiffs(label, rel, acc);
    else same0.push(rel);
  }
  // El inglés (sin las raciales, que ya tienen seccion)
  const strip = (e) => (e ? { ...e, races: undefined, build: undefined } : e);
  const eo = readJson(oldDir, "i18n/en.json"), en = readJson(newDir, "i18n/en.json");
  if (eo && en) {
    const acc = [];
    deepDiff(strip(eo), strip(en), "", acc);
    if (acc.length) listDiffs("Inglés, sin raciales", "i18n/en.json", acc);
    else same0.push("i18n/en.json (sin raciales)");
  }
  log(`- Sin diferencias: ${same0.join(", ") || "—"}`);
  const itemFiles = ["items", "buffs"].filter((k) => mOld?.[k]?.sha256 !== mNew?.[k]?.sha256);
  if (itemFiles.length) log(`- **Han cambiado ${itemFiles.map((k) => `${k}.json`).join(" y ")}: ejecuta \`node tools/update/diff-items.mjs\` (objetos, conjuntos y beneficios).**`);
  log();
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
  if (aR && bR) {
    log("## Razas");
    const b4 = total;
    diffRaces(aR, bR);
    diffRacialsEnglish(readJson(oldDir, "i18n/en.json"), readJson(newDir, "i18n/en.json"));
    if (total === b4) log("- Sin cambios\n");
  }
  const aS = readJson(oldDir, "stats.json"), bS = readJson(newDir, "stats.json");
  diffEverythingElse(mOld, mNew);
}

log(`---\nTotal de diferencias: ${total}`);
const text = `${lines.join("\n")}\n`;
if (out) writeFileSync(resolve(out), text);
console.log(text);
