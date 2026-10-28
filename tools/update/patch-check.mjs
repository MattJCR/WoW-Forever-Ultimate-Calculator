#!/usr/bin/env node
// Revisión de parche automática: un solo comando que recorre TODA la lista de comprobación de la skill `forever-patch-review`
// y deja un informe único en docs/changes/<build>.md (✔ sin cambios · Δ cambios listados · ⚠ requiere decisión).
// Solo lee el repo y los volcados en bruto; NUNCA toca el cliente (la extracción con wow.tools.local la hace el usuario antes, ver docs/EXTRACTION.md).
//
// Uso (con tsx, porque algunas comprobaciones importan módulos .ts del pipeline):
//   npm run patch-check -- <buildViejo> <buildNuevo>      parche nuevo (regenera el dataset con el pipeline)
//   npm run patch-check -- --hotfix <build>               mismo build: línea base = el dataset en git (HEAD) y el volcado guardado con `prepare`
//   npm run patch-check -- prepare <build>                ANTES de re-exportar un hotfix: guarda el volcado actual como línea base (fuera del repo)
// Opciones:
//   --skip a,b / --only a,b   pasos: client raw pipeline reference diff items balance texts coverage gear bump checks visual models
//   --no-regen                no ejecutar el pipeline (usa data/forever/<nuevo> tal cual)
//   --fast                    modo rápido (equivale a --hotfix sin bump, checks pesados, visual ni modelos)
//   --old-dataset <dir>       línea base explícita del dataset;  --old-raw <dir>  línea base explícita del volcado en bruto
//   --max N                   filas por lista en el informe (por defecto 30)
//   --fetch-reference         descarga antes los exports de la referencia externa (--reference-url o REFERENCE_EXPORT_URL; guarda copia de los viejos)
//   --full                    incluye los pasos pesados opcionales: visual (≈ 8 min con las 9 clases) y models (solo avisa)
//   --pipeline-out <dir>      regenera el dataset en <dir> en vez de data/forever/<build> (pruebas sin ensuciar git)
//   --out <fichero>           ruta del informe (por defecto docs/changes/<build>.md, o <build>.auto.md si ya existe uno escrito a mano)
//   --plan                    solo enseña los pasos que ejecutaría
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { balanceChanges, renderBalance } from "./lib/balance.mjs";
import { coveredBy, datasetFiles, pipelineTablesMissingInRaw, uncoveredFiles } from "./lib/coverage.mjs";
import { diffDatasets } from "./lib/diff-builds.mjs";
import { gearChecks } from "./lib/gear.mjs";
import { classifyAgainstReference, loadReference, referenceInfo } from "./lib/reference.mjs";
import { REFERENCE_DIR, ROOT, run, tail } from "./lib/run.mjs";
import { auditTexts, classifyFindings, loadKnownFindings, newFindings, staleFixes, staleOverrides, statFormulas, textTransitions } from "./lib/texts.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && /^--(skip|only|old-dataset|old-raw|max|out|pipeline-out|reference-url)$/.test(argv[i - 1])));
const BUILD_RE = /^\d+\.\d+\.\d+\.\d+$/;
const TMP = process.env.PATCH_CHECK_TMP ?? join(tmpdir(), "wfuc-patch-check");
const MAX = Number(opt("max", 30));

const forever = join(ROOT, "data", "forever");
const builds = () => readdirSync(forever).filter((d) => BUILD_RE.test(d)).sort();

// ---------------------------------------------------------------- prepare
if (positional[0] === "prepare") {
  const build = positional[1] ?? builds().at(-1);
  const src = join(ROOT, "data", "raw", `${build}-hotfix`);
  if (!existsSync(src)) { console.error(`No existe ${src}`); process.exit(2); }
  const dest = join(TMP, `raw-${build}-hotfix`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Línea base del volcado guardada en ${dest} (fuera del repo). Ahora puedes re-exportar y ejecutar: npm run patch-check -- --hotfix ${build}`);
  process.exit(0);
}

// ---------------------------------------------------------------- parámetros
const hotfix = flag("hotfix") || flag("fast");
const fast = flag("fast");
let [oldBuild, newBuild] = positional.filter((p) => BUILD_RE.test(p));
if (hotfix) newBuild = oldBuild = newBuild ?? oldBuild ?? builds().at(-1);
else if (!newBuild) { newBuild = oldBuild ?? builds().at(-1); oldBuild = builds().filter((b) => b < newBuild).at(-1); }
if (!oldBuild || !newBuild) { console.error("Uso: npm run patch-check -- <buildViejo> <buildNuevo>  |  --hotfix <build>  |  prepare <build>"); process.exit(2); }

const ALL_STEPS = ["client", "raw", "pipeline", "reference", "diff", "items", "balance", "texts", "coverage", "gear", "bump", "checks", "visual", "models"];
const FAST_OFF = new Set(["bump", "checks", "visual", "models", "gear"]);
const OPTIONAL = new Set(["visual", "models"]); // pesados: solo con --only o --full
const only = opt("only", "")?.split(",").filter(Boolean);
const skip = new Set(opt("skip", "")?.split(",").filter(Boolean));
if (flag("no-regen")) skip.add("pipeline");
if (hotfix) skip.add("bump");
if (fast) for (const s of FAST_OFF) skip.add(s);
const enabled = (id) => (only?.length ? only.includes(id) : !skip.has(id) && (!OPTIONAL.has(id) || flag("full")));

if (flag("plan")) {
  console.log(`${hotfix ? "Hotfix" : "Parche"} ${oldBuild} → ${newBuild}`);
  for (const s of ALL_STEPS) console.log(`${enabled(s) ? "  ✔" : "  ·"} ${s}`);
  process.exit(0);
}

// ---------------------------------------------------------------- líneas base
const newDir = opt("pipeline-out") ? resolve(opt("pipeline-out")) : join(forever, newBuild);
const rawNew = join(ROOT, "data", "raw", `${newBuild}-hotfix`);
const rawNewStatic = join(ROOT, "data", "raw", newBuild);
const notes = [];

/** Extrae del último commit (HEAD) los JSON del dataset de `build` a una carpeta temporal fuera del repo: es la línea base de un hotfix. */
function gitBaseline(build) {
  const dest = join(TMP, `dataset-${build}`);
  rmSync(dest, { recursive: true, force: true });
  const ls = run("git", ["ls-tree", "-r", "--name-only", "HEAD", `data/forever/${build}`]);
  if (ls.code !== 0) return null;
  const prefix = `data/forever/${build}/`;
  const files = ls.stdout.split(/\r?\n/).filter((p) => p.endsWith(".json"));
  for (const p of files) {
    const show = spawnSync("git", ["show", `HEAD:${p}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
    if (show.status !== 0) return null;
    const out = join(dest, p.slice(prefix.length));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, show.stdout);
  }
  return files.length ? dest : null;
}

let oldDir = opt("old-dataset") ? resolve(opt("old-dataset")) : hotfix ? gitBaseline(newBuild) : join(forever, oldBuild);
if (!oldDir || !existsSync(join(oldDir, "manifest.json"))) { console.error(`No hay línea base del dataset (${oldDir ?? "no está en el último commit"}). Usa --old-dataset <dir>.`); process.exit(2); }
const rawOld = opt("old-raw") ? resolve(opt("old-raw")) : hotfix ? join(TMP, `raw-${newBuild}-hotfix`) : join(ROOT, "data", "raw", `${oldBuild}-hotfix`);
const rawOldStatic = hotfix ? null : join(ROOT, "data", "raw", oldBuild);

// ---------------------------------------------------------------- informe
const steps = [];
const decisions = [];
const ICON = { ok: "✔", delta: "Δ", warn: "⚠", skip: "·", error: "✖" };
function step(id, title, fn) {
  if (!enabled(id)) { steps.push({ id, title, status: "skip", summary: "omitido", body: [] }); return; }
  const t0 = Date.now();
  process.stderr.write(`· ${id}…`);
  let r;
  try { r = fn(); } catch (e) { r = { status: "error", summary: `fallo del propio paso: ${e.message}`, body: [String(e.stack ?? e).split("\n").slice(0, 6).join("\n")], decisions: [`${id}: el paso falló (${e.message})`] }; }
  r.id = id; r.title = title; r.seconds = Math.round((Date.now() - t0) / 100) / 10;
  steps.push(r);
  for (const d of r.decisions ?? []) decisions.push(d);
  process.stderr.write(` ${ICON[r.status]} ${r.summary}\n`);
}
const list = (items, n = MAX) => items.length > n ? [...items.slice(0, n).map((x) => `- ${x}`), `- … y ${items.length - n} más (\`--max\`)`] : items.map((x) => `- ${x}`);
/** Los informes de las herramientas traen sus propios encabezados: se pasan a negrita para no mezclarlos con los pasos. */
const demote = (text) => text.replace(/^#+ (.*)$/gm, "**$1**");
const sha = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null);
const readJson = (dir, rel) => { const f = join(dir, rel); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const manifestOld = readJson(oldDir, "manifest.json");

// ---- 0 · cliente
step("client", "Cliente instalado", () => {
  if (process.platform !== "win32" || !existsSync("C:\\World of Warcraft\\.build.info")) return { status: "skip", summary: "no hay cliente instalado en esta máquina", body: [] };
  const r = run("powershell", ["-NoProfile", "-File", join(ROOT, "tools", "update", "check-client-build.ps1")]);
  const body = ["```", ...r.stdout.split(/\r?\n/).filter(Boolean), "```"];
  if (r.code === 10) return { status: "warn", summary: "el cliente tiene un build distinto al de los datos", body, decisions: ["cliente: build distinto al dataset; ¿se ha re-extraído? (docs/EXTRACTION.md)"] };
  const u = run("powershell", ["-NoProfile", "-File", join(ROOT, "tools", "extract", "check-client-untouched.ps1")]);
  body.push("", "Últimos ficheros modificados del cliente (deben coincidir con una sesión de juego del usuario, nunca con nuestras herramientas):", "```", ...u.stdout.split(/\r?\n/).filter(Boolean).slice(0, 10), "```");
  return { status: "ok", summary: "mismo build que los datos (revisa la hora de DBCache.bin: los hotfixes pueden ser más nuevos)", body };
});

// ---- 1 · volcado en bruto
step("raw", "Tablas en bruto (diff-raw)", () => {
  const body = [], dec = [];
  const same = (a, b) => ["Spell", "SpellName", "ItemSparse", "SpellEffect"].every((t) => sha(join(a, `${t}.csv`)) === sha(join(b, `${t}.csv`)));
  if (!existsSync(rawNew)) return { status: "warn", summary: `no existe ${rawNew}`, body: ["Exporta con `HOTFIXES=1 tools/extract/export-tables.sh " + newBuild + "` (docs/EXTRACTION.md)."], decisions: ["raw: falta el volcado con hotfixes del build nuevo"] };
  if (existsSync(rawNewStatic) && same(rawNewStatic, rawNew)) dec.push("raw: el volcado con hotfixes es IDÉNTICO al estático: ¿DBCache.bin es del build anterior? (hay que entrar al juego y re-extraer)");
  if (existsSync(join(rawNew, "carried-from.json"))) body.push(`- ℹ El volcado nuevo arrastra filas de objetos de otra carpeta (\`carried-from.json\` → ${JSON.parse(readFileSync(join(rawNew, "carried-from.json"), "utf8")).from}). Borra el fichero cuando la caché sea completa.`);
  let total = 0;
  const compare = (label, a, b) => {
    if (!a || !existsSync(a)) {
      body.push(`- ${label}: **sin línea base** (${a ?? "—"})${hotfix ? "; ejecuta `npm run patch-check -- prepare <build>` ANTES de re-exportar" : ""}`);
      dec.push(`raw: no hay volcado anterior para comparar (${label}); lo que cambió en las tablas no se ha podido ver`);
      return null;
    }
    const out = join(TMP, `diff-raw-${label}.md`);
    mkdirSync(TMP, { recursive: true });
    const r = run(process.execPath, [join(ROOT, "tools", "update", "diff-raw.mjs"), a, b, "--out", out]);
    const m = r.stderr.match(/Total de filas distintas: (\d+)/);
    const n = m ? Number(m[1]) : NaN;
    const text = existsSync(out) ? readFileSync(out, "utf8") : "";
    const tables = [...text.matchAll(/^## (\w+)(?: \((\d+)\))?$/gm)].map((x) => `${x[1]} ${x[2] ?? "(solo en un lado)"}`);
    body.push(`- **${label}**: ${n} filas distintas${tables.length ? ` — ${tables.join(", ")}` : ""}`);
    const lines = text.split("\n").filter((l) => /^- [＋Δ－]/.test(l));
    body.push(...list(lines.map((l) => l.slice(2)), 25).map((l) => `  ${l}`));
    if (/tabla solo en/.test(text)) dec.push(`raw: hay tablas que solo existen en uno de los dos volcados (${label})`);
    total += Number.isNaN(n) ? 0 : n;
    return n;
  };
  if (rawOldStatic) compare("estático", rawOldStatic, rawNewStatic);
  compare("con hotfixes", rawOld, rawNew);
  return { status: dec.length ? "warn" : total ? "delta" : "ok", summary: dec.length ? dec[0] : total ? `${total} filas distintas entre volcados` : "sin filas distintas", body, decisions: dec };
});

// ---- 2 · pipeline y contraste
step("pipeline", "Pipeline (regenera el dataset)", () => {
  const dec = [];
  const r = run(process.execPath, ["--import", "tsx", "src/cli.ts", "build", "--build", newBuild, ...(opt("pipeline-out") ? ["--out", newDir] : [])], { cwd: join(ROOT, "packages", "data-pipeline") });
  const avisos = r.stdout.split(/\r?\n/).filter((l) => /\baviso\b/i.test(l));
  const body = [`Salida (últimas líneas, ${r.seconds} s):`, "```", ...tail(r.stdout, 8), "```"];
  if (r.code !== 0) return { status: "error", summary: `el pipeline falló (código ${r.code})`, body: [...body, "```", ...tail(r.stderr, 15), "```"], decisions: ["pipeline: falló al regenerar el dataset"] };
  if (avisos.length) body.push("", `**Avisos del pipeline (${avisos.length}):**`, ...list(avisos.map((a) => a.trim())));
  const warningsOf = (dir) => {
    const w = [];
    for (const sub of ["classes", "abilities"]) for (const f of existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((x) => x.endsWith(".json")) : []) for (const x of readJson(dir, `${sub}/${f}`).warnings ?? []) w.push(`${sub}/${f}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
    for (const f of ["items.json", "races.json", "stats.json", "buffs.json"]) for (const x of readJson(dir, f)?.warnings ?? []) w.push(`${f}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
    return w;
  };
  const before = new Set(warningsOf(oldDir)), after = warningsOf(newDir);
  const fresh = after.filter((w) => !before.has(w));
  if (fresh.length) { body.push("", `**Avisos nuevos dentro del dataset (${fresh.length}):**`, ...list(fresh)); dec.push(`pipeline: ${fresh.length} avisos nuevos en el dataset`); }
  return { status: fresh.length ? "warn" : avisos.length ? "delta" : "ok", summary: `${r.seconds} s; ${avisos.length} avisos, ${fresh.length} nuevos`, body, decisions: dec };
});

step("reference", "Contraste con la referencia externa (cifras, no presencia)", () => {
  const fetched = flag("fetch-reference") ? run(process.execPath, [join(ROOT, "tools", "update", "fetch-reference.mjs"), ...(opt("reference-url") ? ["--url", opt("reference-url")] : [])]) : null;
  const ref = loadReference(REFERENCE_DIR);
  if (!ref.size) return { status: "skip", summary: "no hay exports de la referencia en data/external", body: [] };
  const info = referenceInfo(ref);
  const body = [...(fetched ? ["Descarga de los exports (`--fetch-reference`):", "```", ...tail(fetched.stdout || fetched.stderr, 12), "```", ""] : []), `Referencia: ${info.classes} clases, generada el ${info.generated ?? "?"}, declara el build ${info.declaredBuild ?? "?"}${info.declaredBuild && info.declaredBuild < newBuild ? ` (**va por detrás** de ${newBuild}: sus diferencias no son errores nuestros)` : ""}.`, ""];
  const dec = [];
  const rows = classifyAgainstReference(oldDir, newDir, ref);
  const by = (v) => rows.filter((r) => r.verdict === v);
  body.push("| Veredicto | Cambios |", "|---|---|", ...["cliente + referencia", "referencia por detrás", "contradice al cliente", "texto del cliente sin cifras", "solo cliente"].map((v) => `| ${v} | ${by(v).length} |`), "");
  for (const v of ["contradice al cliente", "texto del cliente sin cifras", "referencia por detrás", "solo cliente", "cliente + referencia"]) if (by(v).length) body.push(`**${v}**`, ...list(by(v).map((r) => `${r.area}: ${r.label} — ${r.detail}`), 15), "");
  if (by("contradice al cliente").length) dec.push(`referencia: ${by("contradice al cliente").length} cambios del cliente que la referencia contradice (manda el cliente; confirmar con una segunda fuente)`);

  // Contraste completo de `npm run contrast` sobre el dataset viejo y el nuevo: líneas nuevas = diferencias nuevas con la referencia
  const contrastOf = (dir, build) => {
    const r = run(process.execPath, ["--import", "tsx", "src/cli.ts", "contrast", "--build", build, "--data", dir], { cwd: join(ROOT, "packages", "data-pipeline") });
    return r.code === 0 || r.stdout ? r.stdout.split(/\r?\n/).filter((l) => l.trim()) : null;
  };
  const a = contrastOf(oldDir, oldBuild === newBuild ? newBuild : oldBuild), b = contrastOf(newDir, newBuild);
  if (b) {
    const sa = new Set(a ?? []);
    const appeared = b.filter((l) => !sa.has(l) && /^(DIF|   )/.test(l));
    const sb = new Set(b);
    const resolved = (a ?? []).filter((l) => !sb.has(l) && /^(DIF|   )/.test(l));
    body.push(`**\`npm run contrast\`**: ${b.filter((l) => /^DIF/.test(l)).length} bloques con diferencias frente a la referencia; ${appeared.length} líneas nuevas, ${resolved.length} resueltas${a ? "" : " (no se pudo contrastar el dataset viejo)"}.`);
    if (appeared.length) body.push(...list(appeared.map((l) => `\`${l.trim()}\``), 20));
    if (resolved.length) body.push("Resueltas:", ...list(resolved.map((l) => `\`${l.trim()}\``), 10));
  }
  // Raciales: la propia marca ≠ de races.json
  const races = readJson(newDir, "races.json"), racesOld = readJson(oldDir, "races.json");
  const differs = (rs) => new Map((rs?.races ?? []).flatMap((r) => r.racials.filter((c) => c.reference?.status === "differs").map((c) => [`${r.name}: ${c.name}`, c.reference.reviewed])));
  const dn = differs(races), dold = differs(racesOld);
  const hadReference = (racesOld?.races ?? []).some((r) => r.racials.some((c) => c.reference));
  const fresh = hadReference ? [...dn.keys()].filter((k) => !dold.has(k) && !dn.get(k)) : [];
  if (!hadReference) body.push("", "_El dataset anterior no traía el contraste de raciales: no se sabe cuáles son nuevas (el resto de este contraste sí vale)._");
  body.push("", `**Raciales con otras cifras que la referencia** (cambios futuros): ${dn.size}, ${[...dn.values()].filter(Boolean).length} revisadas a mano (\`reference-notes.json\`).`);
  if (fresh.length) { body.push("Nuevas y sin revisar:", ...list(fresh)); dec.push(`raciales: ${fresh.length} con cifras distintas a la referencia y sin revisar (${fresh.slice(0, 3).join("; ")})`); }
  const status = dec.length ? "warn" : rows.length || (b ?? []).some((l) => /^DIF/.test(l)) ? "delta" : "ok";
  return { status, summary: `${rows.length} cambios clasificados (${by("contradice al cliente").length} contradichos); ${fresh.length} raciales nuevas por revisar`, body, decisions: dec };
});

// ---- 3 · diferencias del dataset
const runCapture = (script, args, extraEnv = {}) => run(process.execPath, [join(ROOT, "tools", "update", script), ...args], { env: extraEnv });

step("diff", "Talentos, habilidades, raciales y Legacy (diff-builds)", () => {
  const { text, total } = diffDatasets(oldDir, newDir, { max: MAX });
  const classes = [...text.matchAll(/^## (.+)\n((?:(?!^## ).*\n?)*)/gm)].filter((m) => !/^(Cobertura|Razas|Legacy)/.test(m[1]));
  const body = ["Resumen por clase (las 9, aunque sea «sin cambios»):", "", "| Clase | Resultado |", "|---|---|"];
  for (const m of classes) body.push(`| ${m[1]} | ${/Sin cambios/.test(m[2]) ? "sin cambios" : (m[2].match(/^### (.+)$/gm) ?? []).map((s) => s.replace("### ", "")).join("; ")} |`);
  body.push("", "<details><summary>Detalle completo de diff-builds</summary>", "", demote(text.split("\n").slice(5).join("\n")), "</details>");
  return { status: total ? "delta" : "ok", summary: `${total} diferencias`, body };
});

step("items", "Equipo, conjuntos y beneficios (diff-items)", () => {
  const out = join(TMP, "diff-items.md");
  const r = runCapture("diff-items.mjs", [oldDir, newDir, "--out", out, "--max", String(MAX)]);
  const text = existsSync(out) ? readFileSync(out, "utf8") : "";
  const m = r.stdout.match(/Resumen: (\d+) objetos nuevos, (\d+) quitados, (\d+) cambiados/);
  const n = m ? m.slice(1).map(Number) : null;
  const removed = n?.[1] ?? 0;
  return { status: !n ? "error" : removed ? "warn" : n[0] + n[2] ? "delta" : /Nuevos \([1-9]/.test(text) || /Cambiados \([1-9]/.test(text) ? "delta" : "ok",
    summary: n ? `${n[0]} objetos nuevos, ${n[1]} quitados, ${n[2]} cambiados` : "diff-items falló", body: ["<details><summary>Detalle de diff-items</summary>", "", demote(text.split("\n").slice(4).join("\n")), "</details>"],
    decisions: removed ? [`equipo: ${removed} objetos quitados (¿caché incompleta? ver carried-from.json)`] : [] };
});

step("balance", "Balances: cifras que cambian en lo que ya existía", () => {
  const rows = balanceChanges(oldDir, newDir);
  const areas = [...new Set(rows.map((r) => r.area))].map((a) => `${a} ${rows.filter((r) => r.area === a).length}`);
  return { status: rows.length ? "delta" : "ok", summary: rows.length ? `${rows.length} cifras (${areas.join(", ")})` : "ninguna", body: [renderBalance(rows, MAX)] };
});

step("texts", "Textos: marcadores, erratas, traducciones y paridad ES/EN", () => {
  const before = auditTexts(oldDir), now = auditTexts(newDir);
  const diff = newFindings(before, now);
  const tr = textTransitions(oldDir, newDir);
  const fixes = staleFixes(rawNew);
  const own = staleOverrides(newDir, ROOT);
  const dec = [];
  const cls = classifyFindings(now.findings, loadKnownFindings(ROOT));
  const body = [`Textos revisados: ${now.counted}; hallazgos ${now.findings.length}: ${cls.known.length} conocidos con motivo (\`data/rules/text-audit-known.json\`), ${cls.unknown.length} sin clasificar.`, ""];
  if (cls.unknown.length) {
    body.push(`**Hallazgos SIN CLASIFICAR (${cls.unknown.length}):**`, ...list(cls.unknown.map((f) => `[${f.problem}] ${f.where} — ${f.text}`)), "", "Cada uno se revisa contra el texto en bruto: si es un hueco del cliente, se añade a `text-audit-known.json` con su motivo; si es un fallo nuestro, se arregla.", "");
    dec.push(`textos: ${cls.unknown.length} hallazgos sin clasificar (marcadores, erratas o cifras ES≠EN)`);
  }
  if (cls.gone.length) body.push(`Conocidos que ya no ocurren (quitarlos de \`text-audit-known.json\`): ${cls.gone.length}`, ...list(cls.gone.map((k) => `${k.problem} · ${k.where ?? k.wherePrefix}`)), "");
  if (diff.resolved.length) body.push(`Resueltos por el parche (${diff.resolved.length}):`, ...list(diff.resolved.map((f) => `[${f.problem}] ${f.where}`), 10), "");
  if (tr.nowSpanish.length) { body.push(`**El cliente ya trae en español (la traducción propia sobra): ${tr.nowSpanish.length}**`, ...list(tr.nowSpanish, 15), ""); dec.push(`textos: ${tr.nowSpanish.length} traducciones propias que sobran (quitarlas de data/i18n)`); }
  if (tr.backToEnglish.length) { body.push(`**Textos que VUELVEN al inglés: ${tr.backToEnglish.length}**`, ...list(tr.backToEnglish, 15), ""); dec.push(`textos: ${tr.backToEnglish.length} textos vuelven al inglés (¿traducción propia nueva? necesita tu aprobación)`); }
  if (tr.newlyUntranslated.length) dec.push(`textos: ${tr.newlyUntranslated.length} textos nuevos sin traducir`);
  body.push(`Textos en inglés del cliente sin traducción propia ahora: ${tr.untranslatedNow.length}${tr.untranslatedNow.length ? "" : " (ninguno)"}.`);
  if (tr.untranslatedNow.length) body.push(...list(tr.untranslatedNow, 10));
  const formulasNow = statFormulas(rawNew, newDir), formulasBefore = existsSync(rawOld) ? statFormulas(rawOld, oldDir) : null;
  if (formulasNow) {
    const fresh = [...formulasNow].filter(([id]) => formulasBefore && !formulasBefore.has(id));
    body.push("", `Hechizos cuya fórmula suma atributos o poder de ataque del personaje (el texto enseña solo la base): ${formulasNow.size}${formulasBefore ? `; **nuevos** respecto al volcado anterior: ${fresh.length}` : " (sin volcado anterior para comparar)"}.`);
    body.push(...list([...formulasNow].map(([id, f]) => `${fresh.some(([i]) => i === id) ? "**NUEVO** " : ""}${f.name} (${id}): ${f.tokens.join(" ")}${f.flagged ? " — marcado en el dataset (`scalesWith`)" : ""}`), 40));
    if (fresh.length) {
      dec.push(`textos: ${fresh.length} hechizos nuevos con fórmula que suma atributos del personaje (${fresh.slice(0, 3).map(([, f]) => f.name).join("; ")}): comprobar que se marca («más tu espíritu»…)`);
    }
  }
  body.push("", `Erratas conocidas del cliente (\`CLIENT_TEXT_FIXES\`): ${fixes.checked ? `${fixes.active.length} siguen en el cliente, ${fixes.stale.length} ya corregidas` : "no se pudo comprobar (sin volcado)"}.`);
  if (fixes.stale.length) { body.push(...list(fixes.stale.map((s) => `SOBRA (el cliente ya la corrigió): ${s}`)), ""); dec.push(`textos: ${fixes.stale.length} erratas de CLIENT_TEXT_FIXES que el cliente ya corrigió (quitarlas)`); }
  body.push(`Traducciones propias que ya sobran (\`esES-overrides.json\`): ${own.spells.length}${own.spells.length ? ` → ${own.spells.join(", ")}` : ""}.`);
  if (own.spells.length) dec.push(`textos: ${own.spells.length} traducciones propias de hechizos que el cliente ya trae en español`);
  const status = dec.length ? "warn" : diff.resolved.length || cls.gone.length || tr.untranslatedNow.length ? "delta" : "ok";
  return { status, summary: `${now.findings.length} hallazgos (${cls.known.length} conocidos, ${cls.unknown.length} sin clasificar, ${diff.resolved.length} resueltos); ${tr.nowSpanish.length} traducciones sobran, ${tr.backToEnglish.length} vuelven al inglés`, body, decisions: dec };
});

step("coverage", "Cobertura: nada cambia sin salir en el informe", () => {
  const dec = [];
  const body = [];
  const files = datasetFiles(newDir);
  const uncovered = uncoveredFiles(newDir);
  body.push(`Ficheros del dataset: ${files.length}; con comparación asociada: ${files.length - uncovered.length}.`);
  if (uncovered.length) { body.push("**Sin comparación asociada** (añádelos a `tools/update/lib/coverage.mjs` y compáralos):", ...list(uncovered)); dec.push(`cobertura: ${uncovered.length} ficheros del dataset sin comparación (${uncovered.join(", ")})`); }
  const missing = existsSync(rawNew) ? pipelineTablesMissingInRaw(newDir, rawNew) : [];
  if (missing.length) { body.push("", "**Tablas que lee el pipeline y no están en el volcado en bruto:**", ...list(missing)); dec.push(`cobertura: faltan ${missing.length} tablas DB2 en el volcado (${missing.slice(0, 4).join(", ")})`); }
  // Tablas que el pipeline lee y que han cambiado (hash del manifest): cada una debe aparecer en el diff-raw
  const mNew = readJson(newDir, "manifest.json");
  const hashOld = new Map((manifestOld?.inputs ?? []).map((i) => [i.table, i.sha256]));
  const changedTables = (mNew?.inputs ?? []).filter((i) => hashOld.has(i.table) && hashOld.get(i.table) !== i.sha256).map((i) => i.table);
  const newTables = (mNew?.inputs ?? []).filter((i) => !hashOld.has(i.table)).map((i) => i.table);
  body.push("", `Tablas DB2 que lee el pipeline: ${(mNew?.inputs ?? []).length}; **cambiadas** respecto al dataset anterior: ${changedTables.length}${changedTables.length ? ` (${changedTables.join(", ")})` : ""}; nuevas: ${newTables.length}${newTables.length ? ` (${newTables.join(", ")})` : ""}.`);
  if (newTables.length) dec.push(`cobertura: el pipeline lee tablas nuevas (${newTables.join(", ")}): comprobar que su contenido tiene comparación`);
  const cls = (mNew?.classes ?? []).map((c) => `${c.className} ${c.talentCount}+${c.inactiveCount}`).join(", ");
  body.push(`Clases del manifest (talentos+no activos): ${cls}.`);
  const sc = (m) => JSON.stringify((m?.classes ?? []).map((c) => [c.classId, c.talentCount, c.inactiveCount]));
  if (sc(mNew) !== sc(manifestOld)) body.push("- Δ cambia el recuento de talentos por clase (ver «diff»).");
  body.push("", "Qué mira cada fichero:", ...files.map((f) => `- \`${f}\` → ${coveredBy(f) ?? "**NADA**"}`).slice(0, 60));
  return { status: dec.length ? "warn" : "ok", summary: dec.length ? `${dec.length} huecos de cobertura` : `${files.length} ficheros cubiertos, ${(mNew?.inputs ?? []).length} tablas leídas`, body, decisions: dec };
});

step("gear", "Equipo y modelos: iconos, apariencia 3D, conjuntos, encantamientos", () => {
  const g = gearChecks(oldDir, newDir, ROOT);
  const body = [`Objetos: ${g.checked.items} (nuevos o cambiados: ${g.checked.itemsFresh}); conjuntos ${g.checked.sets}; iconos en disco ${g.checked.icons}; modelos 3D en el build ${g.modelBuild ?? "(no hay)"}.`, ""];
  for (const p of g.problems) body.push(`**${p.kind}** (${p.list.length})`, ...list(p.list, 12), "");
  if (!g.problems.length) body.push("Sin problemas.");
  const dec = g.problems.filter((p) => !/Bonos de conjunto sin texto/.test(p.kind)).map((p) => `equipo: ${p.kind} (${p.list.length})`);
  const bonus = g.problems.find((p) => /Bonos de conjunto sin texto/.test(p.kind));
  return { status: dec.length ? "warn" : bonus ? "delta" : "ok", summary: g.problems.length ? g.problems.map((p) => `${p.list.length} × ${p.kind.slice(0, 40)}`).join("; ") : "sin problemas", body, decisions: dec };
});

step("bump", "Build escrito a mano (pruebas y herramientas)", () => {
  if (oldBuild === newBuild) return { status: "skip", summary: "mismo build", body: [] };
  const r = run(process.execPath, [join(ROOT, "tools", "update", "bump-build.mjs"), oldBuild, newBuild]);
  return { status: r.code === 0 ? "delta" : "error", summary: tail(r.stdout, 2).join(" ") || tail(r.stderr, 1).join(" "), body: ["```", ...tail(r.stdout, 25), "```"], decisions: r.code === 0 ? [] : ["bump: bump-build.mjs falló"] };
});

step("checks", "Compilación, pruebas, auditoría y traducciones", () => {
  const dec = [], body = ["| Comprobación | Resultado | Tiempo |", "|---|---|---|"];
  const checks = [
    ["typecheck", "npm", ["run", "typecheck"]],
    ["pruebas (pipeline, motor, web, herramientas)", "npm", ["test"]],
    ["compilación de la web", "npm", ["run", "build", "-w", "@wfuc/web"]],
    ["npm audit", "npm", ["audit"]],
    ["check-i18n", "npm", ["run", "check-i18n", "-w", "@wfuc/web"]],
  ];
  const details = [];
  for (const [name, cmd, args] of checks) {
    const r = run(cmd, args);
    const out = `${r.stdout}\n${r.stderr}`;
    let state = r.code === 0 ? "✔" : "✖";
    if (name === "npm audit" && r.code !== 0 && /ENOTFOUND|EAI_AGAIN|network|audit endpoint/i.test(out)) state = "· sin red";
    else if (r.code !== 0) dec.push(`${name}: falla (${tail(out, 1)[0]?.slice(0, 120) ?? ""})`);
    const tests = [...(out.match(/Tests\s+(\d+ failed \| )?(\d+) passed/g) ?? []).map((t) => t.replace(/\s+/g, " ")), ...(out.match(/# (pass|fail) [1-9]\d*/g) ?? []).map((t) => `herramientas ${t.slice(2)}`)];
    body.push(`| ${name} | ${state}${tests.length ? ` ${tests.join(" · ")}` : ""} | ${r.seconds} s |`);
    if (r.code !== 0) details.push(`**${name}**`, "```", ...tail(out.replace(/\u001b\[[0-9;]*m/g, ""), 25), "```");
  }
  return { status: dec.length ? "warn" : "ok", summary: dec.length ? `${dec.length} comprobaciones fallan` : "todo en verde", body: [...body, "", ...details], decisions: dec };
});

step("visual", "Comprobación visual con Playwright", () => {
  const r = run(process.execPath, [join(ROOT, "tools", "update", "visual-check.mjs"), "--build", newBuild], { timeoutMs: 30 * 60_000 });
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  return { status: r.code === 0 ? "ok" : "warn", summary: lines.at(-1) ?? "sin salida", body: ["```", ...tail(r.stdout, 40), ...(r.code ? tail(r.stderr, 10) : []), "```"], decisions: r.code === 0 ? [] : ["visual: la web muestra errores o textos con marcadores"] };
});

step("models", "Modelos 3D (opcional, ≈ 1 h)", () => ({
  status: "warn",
  summary: "no se automatiza: necesita wow.tools.local y el probador en marcha",
  body: ["Sigue la skill `forever-patch-review` paso 10 y `docs/EXTRACTION.md` › «Modelos 3D» (`git mv data/models/<viejo> data/models/<nuevo>`, `bump-build.mjs … --models`, `build-appearance.mjs`, `fetch-assets.mjs --all`, `build-effects.mjs`, `render-busts.mjs --all`)."],
  decisions: ["modelos 3D: regenerar (≈ 1 h) si el paso «gear» lista objetos sin apariencia"],
}));

// ---------------------------------------------------------------- informe
const counts = (s) => steps.filter((x) => x.status === s).length;
const lines = [];
lines.push(`# ${hotfix ? "Hotfix" : "Parche"} ${newBuild} — informe automático de \`patch-check\``, "");
lines.push(`- Anterior: **${oldBuild}** (${oldDir})`, `- Ahora: **${newBuild}** (${newDir})`);
lines.push(`- Generado: ${new Date().toISOString()} · modo ${hotfix ? "hotfix (mismo build)" : "parche"}${fast ? " rápido" : ""} · volcado nuevo: ${existsSync(rawNew) ? rawNew : "(no existe)"}`);
lines.push("", `**${decisions.length ? `⚠ Requiere decisión humana: ${decisions.length}` : "✔ Nada requiere decisión humana"}**`);
for (const d of decisions) lines.push(`- ${d}`);
lines.push("", "## Resumen", "", "| Paso | Comprobación | Estado | Resultado |", "|---|---|---|---|");
for (const s of steps) lines.push(`| \`${s.id}\` | ${s.title} | ${ICON[s.status]} | ${s.summary.replace(/\|/g, "\\|")} |`);
lines.push("", "Estado: ✔ sin cambios · Δ cambios listados · ⚠ requiere decisión · ✖ el paso falló · · omitido.", "");
for (const s of steps.filter((x) => x.status !== "skip")) {
  lines.push(`## ${s.title}`, "", `${ICON[s.status]} ${s.summary}${s.seconds > 5 ? ` _(${s.seconds} s)_` : ""}`, "", ...s.body, "");
}
lines.push("## Fuentes", "", "| Dato | Fuente | Fecha | Build declarado | Veredicto |", "|---|---|---|---|---|");
lines.push(`| Todo lo anterior | cliente (DB2 estático + hotfixes) | ${new Date().toISOString().slice(0, 10)} | ${newBuild} | \`client-db2\` |`);
const ri = referenceInfo(loadReference(REFERENCE_DIR));
if (ri.classes) lines.push(`| Talentos y textos de clase | referencia externa (${ri.classes} exports) | ${ri.generated ?? "?"} | ${ri.declaredBuild ?? "?"} | contraste${ri.declaredBuild && ri.declaredBuild < newBuild ? "; por detrás del build nuevo" : ""} |`);
lines.push("", "_Lo que no está en el cliente se muestra como estimación (`community` | `assumption`). Rellena a mano: notas de parche oficiales, hotfixes y cualquier consulta externa que hagas para resolver los ⚠._", "");

const changesDir = join(ROOT, "docs", "changes");
let outFile = opt("out") ? resolve(opt("out")) : join(changesDir, `${newBuild}.md`);
if (!opt("out") && existsSync(outFile)) outFile = join(changesDir, `${newBuild}.auto.md`); // no pisar el informe escrito a mano
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, lines.join("\n"));
console.log(`\nInforme: ${outFile}`);
console.log(decisions.length ? `⚠ Requiere decisión humana: ${decisions.length} — ${decisions.slice(0, 4).join(" · ")}${decisions.length > 4 ? " · …" : ""}` : "✔ Nada requiere decisión humana.");
console.log(`Pasos: ${counts("ok")} ✔ · ${counts("delta")} Δ · ${counts("warn")} ⚠ · ${counts("error")} ✖ · ${counts("skip")} omitidos`);
process.exit(counts("error") ? 1 : 0);
