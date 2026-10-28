// Contraste de los cambios del parche con la referencia externa (exports en `data/external/`, solo contraste; el cliente manda).
// Clasifica cada habilidad o talento que cambia: cliente + referencia · referencia por detrás · contradice al cliente · solo cliente.
// Compara cifras, no presencia (lección del 70658: el Espíritu humano 5 → 10 % pasó desapercibido con una comparación de presencia).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
/** Marcadores del cliente sin resolver (`$m1`, `${…}`): el texto no trae las cifras y no se puede comparar. */
const hasFormula = (s) => /\$\{|\$[A-Za-z0-9<]/.test(String(s ?? ""));
const nums = (s) => (String(s ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", ".")))).filter((n) => n !== "1").sort().join(",");

/** Exports de la referencia por clase (token en minúsculas). */
export function loadReference(refDir) {
  const out = new Map();
  if (!existsSync(refDir)) return out;
  for (const f of readdirSync(refDir).filter((x) => x.endsWith(".json"))) out.set(f.replace(".json", ""), readJson(join(refDir, f)));
  return out;
}

/** Build que declara la referencia (el más alto de `src`) y fecha de generación. */
export function referenceInfo(ref) {
  const builds = new Set(), dates = new Set();
  for (const j of ref.values()) {
    if (j.generated) dates.add(j.generated);
    for (const v of Object.values(j.spell_desc ?? {})) {
      const m = String(v.src ?? "").match(/\d+\.\d+\.\d+\.\d+/);
      if (m) builds.add(m[0]);
    }
  }
  const sorted = [...builds].sort();
  return { declaredBuild: sorted.at(-1) ?? null, builds: sorted, generated: [...dates].sort().at(-1) ?? null, classes: ref.size };
}

const jsonFiles = (dir, sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).filter((x) => x.endsWith(".json")) : []);

/**
 * Cambios del parche (habilidades por rango y talentos por rango) clasificados frente a la referencia.
 * Devuelve filas { area, label, verdict, detail }.
 */
export function classifyAgainstReference(oldDir, newDir, ref) {
  const rows = [];
  for (const f of jsonFiles(newDir, "abilities")) {
    const token = f.replace(".json", "");
    const j = ref.get(token);
    const A = readJson(join(oldDir, "abilities", f)), B = readJson(join(newDir, "abilities", f));
    const cls = readJson(join(newDir, "classes", f))?.className ?? token;
    if (!A || !B) continue;
    const byId = new Map(Object.values(j?.spell_desc ?? {}).filter((v) => v.id).map((v) => [v.id, v]));
    for (const nb of B.abilities) {
      const ob = A.abilities.find((x) => x.name === nb.name);
      for (const nr of nb.ranks) {
        const or = ob?.ranks.find((x) => x.spellId === nr.spellId);
        if (!or || nums(or.description) === nums(nr.description)) continue;
        const r = byId.get(nr.spellId);
        const label = `${cls} · ${nb.name} r${nr.rank}`;
        if (!r) rows.push({ area: "Habilidades", label, verdict: "solo cliente", detail: "la referencia no lista este hechizo" });
        else if (hasFormula(nr.description)) rows.push({ area: "Habilidades", label, verdict: "texto del cliente sin cifras", detail: "fórmula sin resolver (poder de ataque…): no se puede comparar con la referencia" });
        else if (nums(r.d) === nums(nr.description)) rows.push({ area: "Habilidades", label, verdict: "cliente + referencia", detail: `ya trae el cambio (${r.src ?? "sin build"})` });
        else if (nums(r.d) === nums(or.description)) rows.push({ area: "Habilidades", label, verdict: "referencia por detrás", detail: `aún trae lo anterior (${r.src ?? "sin build"})` });
        else rows.push({ area: "Habilidades", label, verdict: "contradice al cliente", detail: `cliente ${nums(nr.description) || "—"} · referencia ${nums(r.d) || "—"}` });
      }
    }
    const CA = readJson(join(oldDir, "classes", f)), CB = readJson(join(newDir, "classes", f));
    if (!CA || !CB) continue;
    const oldT = new Map(CA.specs.flatMap((s) => s.talents).map((t) => [t.nodeId, t]));
    for (const spec of CB.specs) {
      for (const t of spec.talents) {
        const o = oldT.get(t.nodeId);
        if (!o) continue;
        const changed = (t.descriptions ?? []).some((d, i) => nums(d) !== nums(o.descriptions?.[i]));
        if (!changed) continue;
        const theirs = j?.talents?.trees?.[spec.index]?.talents?.find((x) => x.row - 1 === t.row && x.col - 1 === t.col);
        const label = `${cls} · talento ${t.name}`;
        if (!theirs?.desc) rows.push({ area: "Talentos", label, verdict: "solo cliente", detail: "la referencia no lo lista en esa posición" });
        else {
          const mine = (t.descriptions ?? []).map(nums).join("|"), prev = (o.descriptions ?? []).map(nums).join("|"), their = theirs.desc.map(nums).join("|");
          if (their === mine) rows.push({ area: "Talentos", label, verdict: "cliente + referencia", detail: "ya trae el cambio" });
          else if (their === prev) rows.push({ area: "Talentos", label, verdict: "referencia por detrás", detail: "aún trae lo anterior" });
          else rows.push({ area: "Talentos", label, verdict: "contradice al cliente", detail: `cliente ${mine} · referencia ${their}` });
        }
      }
    }
  }
  return rows;
}
