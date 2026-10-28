// Pruebas de la revisión de parche automática (`npm run test:tools`). No tocan el cliente; las que necesitan datasets reales
// (`data/forever/1.60.1.70532` y `1.60.1.70658`) se saltan si no están.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { balanceChanges, renderBalance } from "../lib/balance.mjs";
import { COVERAGE, datasetFiles, uncoveredFiles } from "../lib/coverage.mjs";
import { diffDatasets } from "../lib/diff-builds.mjs";
import { gearChecks } from "../lib/gear.mjs";
import { classifyAgainstReference } from "../lib/reference.mjs";
import { ROOT, run } from "../lib/run.mjs";
import { auditTexts, newFindings, staleFixes, textTransitions } from "../lib/texts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UPDATE = join(HERE, "..");
const FOREVER = join(ROOT, "data", "forever");
const OLD = "1.60.1.70532", NEW = "1.60.1.70658";
const hasReal = existsSync(join(FOREVER, OLD, "manifest.json")) && existsSync(join(FOREVER, NEW, "manifest.json"));
const tmp = mkdtempSync(join(tmpdir(), "wfuc-patch-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const write = (dir, rel, json) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(json)); };
const node = (script, args) => run(process.execPath, ["--import", "tsx", join(UPDATE, script), ...args]);

/** Copia los JSON de un dataset (sin las carpetas de imágenes). */
function copyDataset(from, to) {
  for (const rel of datasetFiles(from)) { mkdirSync(dirname(join(to, rel)), { recursive: true }); cpSync(join(from, rel), join(to, rel)); }
}

const SKIP_KEYS = new Set(["build", "schemaVersion", "generatedAt", "locale", "sha256", "file", "source", "provenance"]);

/** Rutas de los valores que un parche podría cambiar (números que no son ids y textos), en el orden del fichero. */
function leafPaths(value, path = [], out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => leafPaths(v, [...path, i], out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { if (!SKIP_KEYS.has(k)) leafPaths(v, [...path, k], out); }
  else if ((typeof value === "number" && !String(path.at(-1)).toLowerCase().endsWith("id")) || (typeof value === "string" && value.length > 2)) out.push(path);
  return out;
}

/** Cambia el valor de esa ruta (número +1, texto + «x») y devuelve la ruta legible. */
function changeAt(json, path) {
  const parent = path.slice(0, -1).reduce((o, k) => o[k], json);
  const last = path.at(-1);
  parent[last] = typeof parent[last] === "number" ? parent[last] + 1 : `${parent[last]}x`;
  return path.join(".");
}

describe("cobertura (criterio «hecho» b y punto 4 del plan)", () => {
  it("ningún fichero del dataset actual queda sin una comparación asociada", { skip: !existsSync(join(FOREVER, NEW)) }, () => {
    assert.deepEqual(uncoveredFiles(join(FOREVER, NEW)), []);
  });

  it("un fichero nuevo sin comparación se detecta", () => {
    const dir = join(tmp, "cov");
    write(dir, "manifest.json", {});
    write(dir, "fichero-nuevo.json", { x: 1 });
    assert.deepEqual(uncoveredFiles(dir), ["fichero-nuevo.json"]);
  });

  it("el registro no tiene dos entradas que cubran lo mismo con motivos distintos (cada `by` nombra una herramienta)", () => {
    for (const c of COVERAGE) assert.match(c.by, /diff-|patch-check|audit-texts|balance/);
  });

  it("un cambio sintético en CUALQUIER fichero del dataset sale en el informe", { skip: !existsSync(join(FOREVER, NEW)), timeout: 600_000 }, () => {
    const base = join(tmp, "base");
    copyDataset(join(FOREVER, NEW), base);
    const missed = [];
    for (const rel of datasetFiles(base)) {
      if (rel === "manifest.json") continue; // lo mira patch-check (hash de tablas), no diff-builds
      const original = JSON.parse(readFileSync(join(base, rel), "utf8"));
      const leaves = leafPaths(original);
      assert.ok(leaves.length, `no hay nada que cambiar en ${rel}`);
      // Tres posiciones por fichero (primera, mitad y última): un campo que solo está en una parte del fichero también tiene que salir
      for (const at of [...new Set([0, Math.floor(leaves.length / 2), leaves.length - 1])]) {
        const changed = join(tmp, "changed");
        rmSync(changed, { recursive: true, force: true });
        copyDataset(base, changed);
        const json = JSON.parse(readFileSync(join(changed, rel), "utf8"));
        const where = changeAt(json, leaves[at]);
        writeFileSync(join(changed, rel), JSON.stringify(json));
        const { total } = diffDatasets(base, changed, { max: 5 });
        let detected = total > 0;
        if (!detected && /^(items|buffs)\.json$/.test(rel)) {
          const i = node("diff-items.mjs", [base, changed]);
          detected = (i.stdout.match(/Resumen: (\d+) objetos nuevos, (\d+) quitados, (\d+) cambiados/) ?? []).slice(1).some((n) => Number(n) > 0) || /### (Nuevos|Cambiados|Quitados|Otros campos de \w+\.json) \([1-9]/.test(i.stdout);
        }
        if (!detected) missed.push(`${rel} (${where})`);
      }
    }
    assert.deepEqual(missed, [], "cambios sintéticos que NINGUNA comparación detecta");
  });
});

describe("balance", () => {
  const ability = (cooldownMs, base) => ({ abilities: [{ name: "Hechizo", ranks: [{ rank: 1, spellId: 7, cooldownMs, description: "x", effects: [{ index: 0, aura: 3, base }] }] }] });
  const dataset = (name, a, item) => {
    const dir = join(tmp, name);
    write(dir, "abilities/mage.json", a);
    write(dir, "classes/mage.json", { className: "Mago", specs: [], inactiveTalents: [] });
    write(dir, "items.json", { items: item ? [item] : [], sets: [], unavailable: [] });
    return dir;
  };

  it("cuantifica el cambio con su % y su unidad (ms → s)", () => {
    const rows = balanceChanges(dataset("b1", ability(180000, 90)), dataset("b2", ability(120000, 47)));
    const cd = rows.find((r) => r.field.includes("enfriamiento"));
    assert.equal(cd.old, 180);
    assert.equal(cd.new, 120);
    assert.ok(Math.abs(cd.pct + 33.33) < 0.1);
    const base = rows.find((r) => r.field.includes("base"));
    assert.ok(Math.abs(base.pct + 47.78) < 0.1);
    assert.ok(rows[0].impact >= rows[1].impact, "ordenadas por impacto");
  });

  it("no cuenta como balance un cambio de identificador ni de posición", () => {
    const a = { abilities: [{ name: "H", ranks: [{ rank: 1, spellId: 7, level: 10, effects: [{ index: 0, aura: 3, miscValue: 4 }] }] }] };
    const b = { abilities: [{ name: "H", ranks: [{ rank: 1, spellId: 7, level: 10, effects: [{ index: 0, aura: 99, miscValue: 5 }] }] }] };
    assert.deepEqual(balanceChanges(dataset("b3", a), dataset("b4", b)), []);
  });

  it("detecta un objeto reequilibrado (nivel de objeto y estadística) y marca su procedencia", () => {
    const item = (itemLevel, value) => ({ id: 5, name: "Capa", quality: 3, itemLevel, provenance: "community", stats: [{ type: 3, key: "agility", value }], effects: [] });
    const rows = balanceChanges(dataset("b5", ability(1, 1), item(20, 10)), dataset("b6", ability(1, 1), item(18, 6)));
    assert.ok(rows.some((r) => r.field.includes("nivel de objeto") && r.old === 20 && r.new === 18));
    assert.ok(rows.some((r) => r.field.includes("agilidad") && r.pct === -40));
    assert.ok(rows.every((r) => r.provenance === "community" || r.area === "Habilidades"));
    assert.match(renderBalance(rows), /agilidad · valor: 10 → 6 \(−40,0 %\)/);
  });
});

describe("textos", () => {
  const dataset = (name, ability, extra = {}) => {
    const dir = join(tmp, name);
    write(dir, "abilities/mage.json", { classId: 8, abilities: [{ name: "Hechizo", ranks: [{ rank: 1, spellId: 7, description: ability, textOrigin: extra.origin ?? "client" }] }] });
    write(dir, "classes/mage.json", { className: "Mago", specs: [], inactiveTalents: [] });
    write(dir, "items.json", { items: extra.items ?? [], sets: extra.sets ?? [], unavailable: [] });
    return dir;
  };

  it("encuentra marcadores sin resolver, erratas «durante <cifra>» y textos vacíos de conjuntos", () => {
    const sets = [{ id: 1, name: "Conjunto", bonuses: [{ threshold: 2, text: "" }] }];
    const r = auditTexts(dataset("t1", "Sana por debajo del 50% de salud durante 1383 y elimina $s2", { sets }));
    const problems = r.findings.map((f) => f.problem);
    assert.ok(problems.some((p) => p.startsWith("marcador")));
    assert.ok(problems.some((p) => p.startsWith("«durante")));
    assert.ok(problems.some((p) => p === "texto vacío"));
  });

  it("separa hallazgos nuevos y resueltos entre dos datasets", () => {
    const d = newFindings(auditTexts(dataset("t2", "Texto bien")), auditTexts(dataset("t3", "Daño de $s1 p.")));
    assert.equal(d.appeared.length, 1);
    assert.equal(newFindings(auditTexts(dataset("t3", "Daño de $s1 p.")), auditTexts(dataset("t2", "Texto bien"))).resolved.length, 1);
  });

  it("avisa de un texto que pasa de traducción propia a español del cliente y de otro que vuelve al inglés", () => {
    const t = textTransitions(dataset("t4", "a", { origin: "translated-by-us" }), dataset("t5", "a", { origin: "client" }));
    assert.equal(t.nowSpanish.length, 1);
    const back = textTransitions(dataset("t5", "a", { origin: "client" }), dataset("t6", "a", { origin: "untranslated" }));
    assert.equal(back.backToEnglish.length, 1);
    assert.equal(back.untranslatedNow.length, 1);
  });

  it("detecta que el cliente ya corrigió una errata conocida (la regla sobra)", () => {
    const raw = join(tmp, "raw-ok");
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(raw, "Spell.csv"), "ID,Description_lang,AuraDescription_lang\n1,Sana instantáneamente 5 p. a un objetivo,\n");
    const r = staleFixes(raw);
    assert.equal(r.checked, true);
    assert.equal(r.stale.length, 1, "la errata ya no está en el texto del cliente");
    writeFileSync(join(raw, "Spell.csv"), `ID,Description_lang,AuraDescription_lang\n1,"Sana instantáneamente a un objetivo amistoso por debajo del $s2% de salud durante $s1 y elimina",\n`);
    assert.equal(staleFixes(raw).active.length, 1);
  });
});

describe("equipo y modelos", () => {
  it("avisa de iconos que faltan y de objetos sin estadísticas", () => {
    const dir = join(tmp, "g1");
    write(dir, "items.json", { items: [{ id: 9, name: "Anillo", quality: 3, itemLevel: 40, inventoryType: 11, iconFileDataId: 555, stats: [], effects: [], placeholder: false, weapon: null, armor: null, bonusArmor: 0 }], sets: [], unavailable: [] });
    write(dir, "icons.json", { ids: [555] });
    write(dir, "enchants.json", { enchants: [{ effectId: 1, spellId: 2, name: "Vacío", stats: [], effects: [], communityStats: [] }] });
    const g = gearChecks(join(tmp, "g0"), dir, join(tmp, "sin-modelos"));
    const kinds = g.problems.map((p) => p.kind);
    assert.ok(kinds.some((k) => k.startsWith("Iconos listados")));
    assert.ok(kinds.some((k) => k.startsWith("Encantamientos sin")));
    assert.ok(kinds.some((k) => k.startsWith("Objetos nuevos o cambiados (calidad")));
  });
});

describe("patch-check sobre el parche 70532 → 70658 (criterio «hecho» a)", { skip: !hasReal }, () => {
  let report = "";
  it("genera el informe sin errores y deja una línea con lo que requiere decisión", { timeout: 300_000 }, () => {
    const out = join(tmp, "informe.md");
    const r = node("patch-check.mjs", [OLD, NEW, "--skip", "pipeline,bump,checks,visual,models,client", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Requiere decisión humana|Nada requiere decisión/);
    report = readFileSync(out, "utf8");
    assert.match(report, /^## Resumen/m);
  });

  const KNOWN = [
    ["Aspecto del halcón 90 → 47 (balance)", /Aspecto del halcón r5 — efecto 1 · base: 90 → 47/],
    ["Aura de disparo certero (balance)", /Aura de disparo certero r1 — efecto 1 · base: 30 → 15/],
    ["Orco: Furia sangrienta 3 → 2 min", /Orco · Furia sangrienta — enfriamiento \(s\): 180 → 120/],
    ["6 objetos reequilibrados", /269716[\s\S]*269717[\s\S]*269742[\s\S]*277286[\s\S]*277288[\s\S]*277289/],
    ["Gracia divina (errata resuelta)", /Gracia divina r1/],
    ["Revancha con fórmula de poder de ataque", /Revancha r1/],
    ["Sacrificio oscuro suma el espíritu", /No-muerto: Sacrificio oscuro \(1277328\): \$SPI — marcado en el dataset/],
    ["raciales de clase nuevas (Sacerdote)", /Raciales de clase \(habilidades ligadas a una raza\) \(12 nuevos/],
    ["Eficacia: máscara de clase ampliada", /Eficacia \[Puntería\] — effectInfo/],
    ["Pies de plomo: tercer valor", /Pies de plomo/],
    ["Tauren: Aguante cambia un efecto", /Aguante/],
    ["cobertura de ficheros", /Ficheros del dataset: \d+; con comparación asociada: \d+/],
  ];
  for (const [name, re] of KNOWN) it(`reproduce sin ayuda: ${name}`, () => assert.match(report, re));

  it("la referencia va por detrás en Cazador y contradice o no compara Revancha", () => {
    assert.match(report, /referencia por detrás \| 10/);
    assert.match(report, /texto del cliente sin cifras \| 6/);
  });

  it("modo rápido de hotfix: línea base = git (HEAD) y solo diffs y auditorías", { timeout: 300_000 }, () => {
    const out = join(tmp, "hotfix.md");
    const r = node("patch-check.mjs", ["--fast", NEW, "--no-regen", "--out", out]);
    assert.equal(r.code, 0, r.stderr);
    const text = readFileSync(out, "utf8");
    assert.match(text, /modo hotfix \(mismo build\) rápido/);
    assert.match(text, /\| `checks` .* \| · \| omitido/);
    assert.match(text, /\| `diff` .* \| ✔ \| 0 diferencias/, "sin cambios contra HEAD");
  });
});

describe("clasificación frente a la referencia", () => {
  it("distingue cliente + referencia, referencia por detrás, contradice y fórmula sin cifras", () => {
    const mk = (name, desc) => {
      const dir = join(tmp, name);
      write(dir, "abilities/mage.json", { abilities: [{ name: "Hechizo", ranks: [{ rank: 1, spellId: 7, description: desc }] }] });
      write(dir, "classes/mage.json", { className: "Mago", specs: [], inactiveTalents: [] });
      return dir;
    };
    const ref = (text) => new Map([["mage", { spell_desc: { "Mage|Hechizo|Rank 1": { id: 7, d: text, src: "beta client 1.60.1.70630" } }, talents: { trees: [] } }]]);
    const verdict = (oldText, newText, refText) => classifyAgainstReference(mk("c-old", oldText), mk("c-new", newText), ref(refText))[0]?.verdict;
    assert.equal(verdict("Daña 20 p.", "Daña 15 p.", "Deals 15 damage"), "cliente + referencia");
    assert.equal(verdict("Daña 20 p.", "Daña 15 p.", "Deals 20 damage"), "referencia por detrás");
    assert.equal(verdict("Daña 20 p.", "Daña 15 p.", "Deals 99 damage"), "contradice al cliente");
    assert.equal(verdict("Daña 20 p.", "Daña ${$m1+$AP} p.", "Deals 20 damage"), "texto del cliente sin cifras");
    assert.equal(verdict("Daña 20 p.", "Daña 20 p.", "Deals 99 damage"), undefined, "sin cambio no hay fila");
  });
});
