// Detector de balances: cifras que CAMBIAN en lo que ya existía (no solo lo nuevo), con el % de cambio y ordenadas por impacto,
// para ver de un vistazo «Aspecto del halcón r5: efecto 1 base 90 → 47 (−48 %)». Solo lee `data/forever/`.
// Cubre habilidades por rango, talentos por rango, raciales, objetos, conjuntos, beneficios y encantamientos.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (dir, rel) => {
  const f = join(dir, rel);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};

/** Campos numéricos que son identificadores, posiciones o enumeraciones: un cambio ahí no es de balance. */
const NOT_BALANCE = new Set([
  "id", "spellId", "iconFileDataId", "nodeId", "index", "effectIndex", "row", "col", "rank", "schemaVersion", "itemId", "effectId", "classId", "raceId",
  "group", "order", "aura", "miscValue", "miscValueB", "classMask", "schoolMask", "inventoryType", "subclassId", "bonding", "allowableClass",
  "allowableRace", "itemSetId", "limitCategory", "trigger", "effect", "type", "slotType", "viaSpellId", "acquireMethod", "curveId", "operationType",
  "traitTreeId", "requiredSkill", "requiredSkillRank", "specId", "statBudget",
]);
/** Campos donde un cambio importa aunque no tenga sentido como porcentaje (se cuenta como cambio total). */
const CATEGORICAL = new Set(["quality"]);

/** Nombre legible de cada campo y su unidad (ms → s). */
const FIELD = {
  cost: ["coste", 1], costPctOfBase: ["coste (% del maná base)", 1], castMs: ["lanzamiento (s)", 1000], durationMs: ["duración (s)", 1000],
  cooldownMs: ["enfriamiento (s)", 1000], periodMs: ["periodo (s)", 1000], rangeYd: ["alcance (m)", 1], radiusYd: ["radio (m)", 1], level: ["nivel", 1],
  maxLevel: ["nivel máximo", 1], itemLevel: ["nivel de objeto", 1], requiredLevel: ["nivel requerido", 1], quality: ["calidad", 1], armor: ["armadura", 1],
  bonusArmor: ["armadura adicional", 1], base: ["base", 1], perLevel: ["por nivel", 1], variance: ["varianza", 1], coefficient: ["coeficiente", 1],
  maxRank: ["rango máximo", 1], requiredPoints: ["puntos requeridos", 1], procChance: ["prob. de proc", 1], procCooldownMs: ["enfriamiento del proc (s)", 1000],
  threshold: ["piezas", 1], value: ["valor", 1], min: ["mín.", 1], max: ["máx.", 1], speed: ["velocidad", 1], dps: ["DPS", 1], chance: ["probabilidad", 1],
};

const STAT_NAMES = {
  strength: "fuerza", agility: "agilidad", stamina: "aguante", intellect: "intelecto", spirit: "espíritu", armor: "armadura", "spell-power": "poder con hechizos",
  "attack-power": "poder de ataque", "physical-damage": "daño físico", weapon: "arma",
};
const isPrim = (x) => x === null || typeof x !== "object";
const KEYS = ["key", "index", "effectIndex", "threshold", "spellId", "id", "nodeId", "rank", "name"];
const keyFn = (arr) => {
  const k = KEYS.find((c) => arr.every((x) => !isPrim(x) && x[c] !== undefined));
  if (!k) return null;
  const set = new Set(arr.map((x) => x[k]));
  return set.size === arr.length ? (x) => x[k] : null;
};

/** Hojas numéricas que cambian entre dos valores. `path` usa `.campo` y `[clave]`. */
function leafChanges(a, b, path, acc) {
  if (typeof a === "number" && typeof b === "number") {
    const leaf = path.split(/[.[]/).pop().replace("]", "");
    if (a !== b && !NOT_BALANCE.has(leaf)) acc.push({ path, old: a, new: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ka = a.length && !isPrim(a[0]) ? keyFn(a) : null;
    const kb = b.length && !isPrim(b[0]) ? keyFn(b) : null;
    if (ka && kb) {
      const mb = new Map(b.map((x) => [kb(x), x]));
      for (const x of a) if (mb.has(ka(x))) leafChanges(x, mb.get(ka(x)), `${path}[${ka(x)}]`, acc);
    } else if (a.length === b.length) a.forEach((x, i) => leafChanges(x, b[i], `${path}[${i}]`, acc));
    return;
  }
  if (!isPrim(a) && !isPrim(b) && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of Object.keys(a)) if (k in b) leafChanges(a[k], b[k], path ? `${path}.${k}` : k, acc);
  }
}

/** Describe una ruta con los nombres de FIELD: `effects[0].base` → «efecto 1 · base»; `rankValues[0][1]` → «rango 1, valor 2». */
function describe(path) {
  const rv = path.match(/^rankValues\[(\d+)\]\[(\d+)\]$/);
  if (rv) return { label: `rango ${Number(rv[1]) + 1}, valor ${Number(rv[2]) + 1}`, unit: 1, leaf: "rankValues" };
  // `a.b[0].c` → ["a", "b", "[0]", "c"]
  const parts = path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? [path];
  const leaf = parts.at(-1);
  const [name, unit] = FIELD[leaf] ?? [leaf, 1];
  const names = { effects: "efecto", auras: "aura", bonuses: "bono", stats: "" };
  const readable = parts.slice(0, -1).map((p, i) => {
    if (!p.startsWith("[")) return names[p] === undefined ? p : null;
    const idx = p.slice(1, -1);
    const owner = parts[i - 1];
    if (owner === "stats") return STAT_NAMES[idx] ?? idx;
    if (owner === "bonuses") return `bono de ${idx} piezas`;
    return `${names[owner] ?? owner} ${/^\d+$/.test(idx) ? Number(idx) + 1 : idx}`;
  }).filter(Boolean);
  return { label: [...readable, name].join(" · "), unit, leaf };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))).replace(".", ",");
const pctOf = (o, n) => (CATEGORICAL.has(o.leaf) ? null : o.old === 0 ? null : ((o.new - o.old) / Math.abs(o.old)) * 100);

/** Convierte las hojas que cambian en filas de balance. */
function rowsFor(area, entity, provenance, a, b, extraIgnore = []) {
  const acc = [];
  leafChanges(a, b, "", acc);
  return acc
    .filter((c) => !extraIgnore.some((r) => r.test(c.path)))
    .map((c) => {
      const d = describe(c.path);
      const u = d.unit;
      const o = { old: c.old / u, new: c.new / u, leaf: d.leaf };
      const pct = pctOf(o, o);
      return { area, entity, field: d.label, old: o.old, new: o.new, pct, impact: pct === null ? 100 : Math.abs(pct), provenance };
    });
}

/** Cambios de balance de todo lo que existe en los dos datasets. */
export function balanceChanges(oldDir, newDir) {
  const rows = [];
  const classFiles = (dir) => (existsSync(join(dir, "abilities")) ? readdirSync(join(dir, "abilities")).filter((f) => f.endsWith(".json")) : []);
  for (const f of classFiles(newDir)) {
    const cname = read(newDir, `classes/${f}`)?.className ?? f.replace(".json", "");
    const A = read(oldDir, `abilities/${f}`), B = read(newDir, `abilities/${f}`);
    if (A && B) {
      for (const nb of B.abilities) {
        const ob = A.abilities.find((x) => x.name === nb.name);
        for (const nr of nb.ranks) {
          const or = ob?.ranks.find((x) => x.spellId === nr.spellId);
          if (or) rows.push(...rowsFor("Habilidades", `${cname} · ${nb.name} r${nr.rank}`, "client-db2", or, nr, [/^(description|rank)/]));
        }
      }
    }
    const CA = read(oldDir, `classes/${f}`), CB = read(newDir, `classes/${f}`);
    if (CA && CB) {
      const talents = (c) => [...c.specs.flatMap((s) => s.talents), ...(c.inactiveTalents ?? [])];
      const oldT = new Map(talents(CA).map((t) => [t.nodeId, t]));
      for (const nt of talents(CB)) {
        const ot = oldT.get(nt.nodeId);
        if (!ot) continue;
        const pick = (t) => ({ rankValues: t.rankValues, maxRank: t.maxRank, requiredPoints: t.requiredPoints });
        rows.push(...rowsFor("Talentos", `${cname} · ${nt.name}`, "client-db2", pick(ot), pick(nt)));
      }
    }
  }
  // Raciales: cada hechizo de cada racial
  const RA = read(oldDir, "races.json"), RB = read(newDir, "races.json");
  if (RA && RB) {
    const spells = (r) => new Map(r.races.flatMap((x) => x.racials.flatMap((c) => c.spells.map((s) => [`${x.name}/${c.name}/${s.spellId}`, { x, c, s }]))));
    const oldS = spells(RA);
    for (const [k, { x, c, s }] of spells(RB)) {
      const o = oldS.get(k);
      if (o) rows.push(...rowsFor("Raciales", `${x.name} · ${c.name}`, "client-db2", { ...o.s, description: undefined }, { ...s, description: undefined }));
    }
  }
  // Equipo
  const IA = read(oldDir, "items.json"), IB = read(newDir, "items.json");
  if (IA && IB) {
    const oldI = new Map(IA.items.map((i) => [i.id, i]));
    for (const ni of IB.items) {
      const oi = oldI.get(ni.id);
      if (oi) rows.push(...rowsFor("Objetos", `${ni.id} ${ni.name}`, ni.provenance, oi, ni, [/^effects/]));
      if (oi) rows.push(...rowsFor("Objetos (efectos)", `${ni.id} ${ni.name}`, ni.provenance, { effects: oi.effects }, { effects: ni.effects }));
    }
    const oldSet = new Map(IA.sets.map((s) => [s.id, s]));
    for (const ns of IB.sets) {
      const os = oldSet.get(ns.id);
      if (os) rows.push(...rowsFor("Conjuntos", `${ns.id} ${ns.name}`, "client-db2", { bonuses: os.bonuses }, { bonuses: ns.bonuses }));
    }
  }
  const BA = read(oldDir, "buffs.json"), BB = read(newDir, "buffs.json");
  if (BA && BB) {
    const oldB = new Map(BA.buffs.map((b) => [b.id, b]));
    for (const nb of BB.buffs) {
      const ob = oldB.get(nb.id);
      if (ob) rows.push(...rowsFor("Beneficios", `${nb.id} ${nb.name}`, nb.provenance, ob, nb));
    }
  }
  const EA = read(oldDir, "enchants.json"), EB = read(newDir, "enchants.json");
  if (EA && EB) {
    const key = (e) => `${e.effectId}/${e.spellId}/${e.itemId}/${e.slotType}`;
    const oldE = new Map(EA.enchants.map((e) => [key(e), e]));
    for (const ne of EB.enchants) {
      const oe = oldE.get(key(ne));
      if (oe) rows.push(...rowsFor("Encantamientos", ne.name, "community", oe, ne));
    }
  }
  return rows.sort((p, q) => q.impact - p.impact);
}

const signed = (p) => (p === null ? "cambia de categoría" : `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(1).replace(".", ",")} %`);

/** Markdown agrupado por área; cada área recorta a `max` filas (las de más impacto). */
export function renderBalance(rows, max = 25) {
  if (!rows.length) return "Sin cifras que cambien en lo que ya existía.\n";
  const out = [];
  const areas = [...new Set(rows.map((r) => r.area))];
  for (const area of areas) {
    const list = rows.filter((r) => r.area === area);
    out.push(`#### ${area} (${list.length} cifras)`, "");
    for (const r of list.slice(0, max)) out.push(`- ${r.entity} — ${r.field}: ${fmt(r.old)} → ${fmt(r.new)} (${signed(r.pct)})${r.provenance && r.provenance !== "client-db2" ? ` · \`${r.provenance}\`` : ""}`);
    if (list.length > max) out.push(`- … y ${list.length - max} más (con \`--max\` salen todas)`);
    out.push("");
  }
  return out.join("\n");
}
