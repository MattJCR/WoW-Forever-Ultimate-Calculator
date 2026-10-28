// Comparación de dos datasets normalizados (salida de `npm run pipeline`): talentos, Legacy, habilidades (por rango), raciales (por hechizo, de
// clase y en inglés) y, como red de seguridad, TODOS los demás ficheros del dataset. La usan diff-builds.mjs (línea de comandos),
// patch-check.mjs y las pruebas. Solo lee ficheros del repo; no toca el cliente.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GENERIC_FILES } from "./coverage.mjs";

/** @returns {{ text: string, total: number }} informe en Markdown y número de diferencias. */
export function diffDatasets(oldDir, newDir, { only = null, max = 40 } = {}) {
const MAX = max;
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

/** Campos que no son datos del cliente (se calculan o son la clave de la fila): no cuentan como cambio. */
const IGNORED_FIELDS = new Set(["schemaVersion", "build", "generatedAt"]);
const allFields = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => !IGNORED_FIELDS.has(f) && !f.startsWith("_"));

/**
 * Compara dos listas por clave. `fields` = null compara TODOS los campos de cada fila (así un campo nuevo del esquema nunca
 * queda sin mirar); una lista explícita solo se usa donde un campo es la propia clave o ruido conocido.
 */
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
    const changedFields = (fields ?? allFields(ov, nv)).filter((f) => ov[f] !== undefined && nv[f] !== undefined && !same(ov[f], nv[f]));
    // La plantilla repite el texto: solo se enseña si ella sola ha cambiado.
    const shown = changedFields.filter((f) => f !== "descriptionTemplate" || !changedFields.includes("description"));
    const diffs = shown.flatMap((f) => {
      if (isPrim(ov[f]) || isPrim(nv[f])) return [`${f}: ${short(ov[f])} → ${short(nv[f])}`];
      const acc = [];
      deepDiff(ov[f], nv[f], f, acc);
      return acc.length > 6 ? [...acc.slice(0, 6), `… y ${acc.length - 6} más en ${f}`] : acc;
    });
    if (diffs.length) changed.push(`${label(nv)} — ${diffs.join("; ")}`);
  }
  return { added, removed, changed };
}


function talentsOf(cls) {
  return [
    ...cls.specs.flatMap((s) => s.talents.map((t) => ({ ...t, _tree: s.name ?? s.specName ?? "" }))),
    ...(cls.inactiveTalents ?? []).map((t) => ({ ...t, _tree: "(nodo no activo)" })),
  ];
}

function diffTalents(title, a, b) {
  const r = diffKeyed(talentsOf(a), talentsOf(b), (t) => t.nodeId ?? t.name, null, (t) => `${t.name} [${t._tree}]`);
  section(title, r.added, r.removed, r.changed);
}

function diffAbilities(title, a, b) {
  const aAb = a.abilities, bAb = b.abilities;
  const r = diffKeyed(aAb, bAb, (x) => x.name, [], (x) => x.name);
  const changed = [];
  for (const nv of bAb) {
    const ov = aAb.find((x) => x.name === nv.name);
    if (!ov) continue;
    const rr = diffKeyed(ov.ranks, nv.ranks, (x) => x.spellId, null, (x) => `rango ${x.rank} (${x.spellId})`);
    const parts = [...rr.added.map((s) => `＋${s}`), ...rr.removed.map((s) => `－${s}`), ...rr.changed.map((s) => `Δ${s}`)];
    const tf = ov.talentsForever?.status !== nv.talentsForever?.status ? [`estado la referencia: ${ov.talentsForever?.status} → ${nv.talentsForever?.status}`] : [];
    if (parts.length || tf.length) changed.push(`${nv.name} — ${[...tf, ...parts].join(" | ")}`);
  }
  section(title, r.added, r.removed, changed);
}

const effectText = (e) => `${e.kind ?? "?"}(${e.aura})=${e.value}${e.fromSpellId ? `←${e.fromSpellId}` : ""}`;

// Cada hechizo de cada racial por separado y con sus campos legibles (antes salia todo el JSON en una sola linea)
function diffRacialSpells(a, b) {
  const flat = (r) => r.races.flatMap((x) => x.racials.flatMap((c) => c.spells.map((sp) => ({ ...sp, effects: sp.effects.map(effectText), _race: x.name, _racial: c.name }))));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x._race}/${x._racial}/${x.spellId}`, null, (x) => `${x._race}: ${x._racial} (hechizo ${x.spellId})`);
  section("Hechizos de las raciales (texto completo, enfriamiento, duración, efectos)", r.added, r.removed, r.changed);
}

// Habilidades de clase ligadas a una raza (Sacerdote…): Race.classRacials
function diffClassRacials(a, b) {
  const flat = (r) => r.races.flatMap((x) => (x.classRacials ?? []).map((c) => ({ ...c, _race: x.name })));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x._race}/${x.classId}/${x.name}`, null, (x) => `${x._race}: ${x.name} (clase ${x.classId})`);
  section("Raciales de clase (habilidades ligadas a una raza)", r.added, r.removed, r.changed);
}

// Nombre y texto de las raciales en inglés (i18n/en.json › races)
function diffRacialsEnglish(a, b) {
  const flat = (e) => Object.entries(e?.races ?? {}).flatMap(([id, r]) => r.racials.map((c, order) => ({ ...c, _key: `${id}/${order}`, _race: r.name })));
  const r = diffKeyed(flat(a), flat(b), (x) => x._key, null, (x) => `${x._race}: ${x.name}`);
  section("Raciales en inglés (nombre y texto)", r.added, r.removed, r.changed);
}

/**
 * Todo lo que NO son las listas que ya comparan las secciones de arriba (talentos, rangos, raciales): campos de nivel superior,
 * nombre, icono, fondo y avisos de cada árbol, de cada habilidad y de cada raza. Sin esto un campo nuevo de esos objetos no sale nunca.
 */
function diffShell(title, a, b) {
  const acc = [];
  deepDiff(a, b, "", acc);
  section(title, [], [], acc);
}
const classShell = (c) => ({ ...c, specs: c.specs.map((s) => ({ ...s, talents: undefined })), inactiveTalents: undefined });
const abilitiesShell = (f) => ({ ...f, abilities: f.abilities.map((x) => ({ ...x, ranks: undefined })) });
const racesShell = (f) => ({ ...f, races: f.races.map((x) => ({ ...x, racials: undefined, classRacials: undefined })) });

function diffRaces(a, b) {
  const flat = (r) => r.races.flatMap((x) => x.racials.map((c) => ({ race: x.name, ...c, spells: undefined })));
  const r = diffKeyed(flat(a), flat(b), (x) => `${x.race}/${x.name}`, null, (x) => `${x.race}: ${x.name}`);
  section("Razas y raciales (resumen de la tabla del cliente)", r.added, r.removed, r.changed);
  diffRacialSpells(a, b);
  diffClassRacials(a, b);
  const raceRes = diffKeyed(a.races, b.races, (x) => x.id, null, (x) => x.name);
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
      if (x[k] === undefined || y[k] === undefined) { if (path === "" && x[k] !== y[k]) acc.push(`${y[k] === undefined ? "－" : "＋"} ${k}`); continue; }
      deepDiff(x[k], y[k], path ? `${path}.${k}` : k, acc);
    }
    return;
  }
  acc.push(`${path}: ${short(x)} → ${short(y)}`);
}

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
  diffShell("Metadatos del árbol (nombre, fondos, reglas, avisos…)", classShell(aC), classShell(bC));
  const aA = readJson(oldDir, `abilities/${t}.json`), bA = readJson(newDir, `abilities/${t}.json`);
  if (aA && bA) { diffAbilities("Habilidades", aA, bA); diffShell("Metadatos del libro de habilidades", abilitiesShell(aA), abilitiesShell(bA)); }
  else if (aA || bA) { log(`- Libro de habilidades ${aA ? "quitado" : "nuevo"}\n`); total++; }
  if (total === before) { lines.pop(); log(`## ${name}\n- Sin cambios\n`); }
}

if (!only) {
  const aL = readJson(oldDir, "legacy.json"), bL = readJson(newDir, "legacy.json");
  if (aL && bL) { log("## Legacy"); const b4 = total; diffTalents("Ventajas de Legacy", aL, bL); diffShell("Metadatos de Legacy", classShell(aL), classShell(bL)); if (total === b4) log("- Sin cambios\n"); }
  const aR = readJson(oldDir, "races.json"), bR = readJson(newDir, "races.json");
  if (aR && bR) {
    log("## Razas");
    const b4 = total;
    diffRaces(aR, bR);
    diffShell("Metadatos de las razas (procedencia, avisos…)", racesShell(aR), racesShell(bR));
    diffRacialsEnglish(readJson(oldDir, "i18n/en.json"), readJson(newDir, "i18n/en.json"));
    if (total === b4) log("- Sin cambios\n");
  }
  const aS = readJson(oldDir, "stats.json"), bS = readJson(newDir, "stats.json");
  diffEverythingElse(mOld, mNew);
}

log(`---\nTotal de diferencias: ${total}`);
const text = `${lines.join("\n")}\n`;
return { text, total };
}
