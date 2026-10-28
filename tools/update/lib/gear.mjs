// Comprobaciones de equipo y modelos de un parche: objetos nuevos o cambiados sin icono / apariencia 3D, conjuntos incompletos,
// encantamientos sin efecto e iconos que faltan en disco. Solo lee `data/forever/` y `data/models/`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Carpeta de modelos con el build más alto (los modelos 3D van aparte del dataset y pueden ir por detrás). */
export function latestModels(root) {
  const base = join(root, "data", "models");
  if (!existsSync(base)) return null;
  const builds = readdirSync(base).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d)).sort();
  return builds.length ? { build: builds.at(-1), dir: join(base, builds.at(-1)) } : null;
}

/**
 * @returns {{ problems: {kind: string, list: string[]}[], modelBuild: string|null, checked: object }}
 */
export function gearChecks(oldDir, newDir, root) {
  const problems = [];
  const add = (kind, list) => list.length && problems.push({ kind, list });
  const items = readJson(join(newDir, "items.json"));
  const before = readJson(join(oldDir, "items.json"));
  if (!items) return { problems, modelBuild: null, checked: {} };
  const oldById = new Map((before?.items ?? []).map((i) => [i.id, i]));
  const fresh = items.items.filter((i) => !oldById.has(i.id) || !same(oldById.get(i.id), i));
  const ids = new Set([...items.items.map((i) => i.id), ...(items.unavailable ?? []).map((u) => u.id)]);
  const oldSets = new Map((before?.sets ?? []).map((s) => [s.id, s]));
  const freshSets = items.sets.filter((s) => !oldSets.has(s.id) || !same(oldSets.get(s.id), s));

  // Iconos: los que lista icons.json y no están en icons/, y los objetos nuevos o cambiados con icono sin listar
  const icons = readJson(join(newDir, "icons.json"));
  const have = new Set(existsSync(join(newDir, "icons")) ? readdirSync(join(newDir, "icons")).map((f) => Number(f.replace(/\.png$/, ""))) : []);
  const listed = new Set(icons?.ids ?? []);
  add("Iconos listados en icons.json que faltan en disco (ejecuta fetch-icons.mjs)", (icons?.ids ?? []).filter((id) => !have.has(id)).map(String).slice(0, 40));
  add("Objetos nuevos o cambiados con icono que no está en icons.json", fresh.filter((i) => i.iconFileDataId && !listed.has(i.iconFileDataId)).map((i) => `${i.id} ${i.name} (icono ${i.iconFileDataId})`));

  // Apariencia 3D
  const models = latestModels(root);
  const appearance = models ? readJson(join(models.dir, "appearance.json")) : null;
  if (appearance) {
    const wearable = (i) => !i.placeholder && i.inventoryType > 0 && ![2, 11, 12, 18, 24, 27, 28].includes(i.inventoryType); // sin cuello, anillos, abalorios, bolsas, munición
    add(`Objetos nuevos o cambiados sin apariencia 3D (modelos ${models.build}; regenerar con tools/model)`, fresh.filter((i) => wearable(i) && !(String(i.id) in appearance.items)).map((i) => `${i.id} ${i.name}`));
  }

  // Conjuntos: piezas que no existen y bonos sin texto
  add("Conjuntos nuevos o cambiados con piezas desconocidas (ni en items.json ni en «sin datos»)", freshSets.filter((s) => s.itemIds.some((id) => !ids.has(id))).map((s) => `${s.id} ${s.name}: ${s.itemIds.filter((id) => !ids.has(id)).join(", ")}`));
  add("Conjuntos nuevos o cambiados con menos de 2 piezas", freshSets.filter((s) => s.itemIds.length < 2).map((s) => `${s.id} ${s.name}`));
  add("Bonos de conjunto nuevos o cambiados sin texto ni efecto interpretado", freshSets.flatMap((s) => s.bonuses.filter((b) => !b.text && !(b.auras ?? []).length && !b.proc).map((b) => `${s.id} ${s.name}: bono de ${b.threshold}`)));

  // Encantamientos sin ningún efecto
  const enchants = readJson(join(newDir, "enchants.json"));
  add("Encantamientos sin estadísticas ni efecto", (enchants?.enchants ?? []).filter((e) => !(e.stats ?? []).length && !(e.effects ?? []).length && !(e.communityStats ?? []).length).map((e) => `${e.effectId}/${e.spellId} ${e.name}`));

  // Objetos de calidad ≥ 2 sin estadísticas, armadura, arma ni efecto: casi seguro datos que faltan
  add("Objetos nuevos o cambiados (calidad ≥ 2) sin ninguna estadística, arma, armadura ni efecto", fresh.filter((i) => !i.placeholder && i.quality >= 2 && !(i.stats ?? []).length && !i.weapon && !i.armor && !(i.effects ?? []).length && !i.bonusArmor).map((i) => `${i.id} ${i.name} (nivel de objeto ${i.itemLevel}, ${i.provenance})`));

  return { problems, modelBuild: models?.build ?? null, checked: { itemsFresh: fresh.length, items: items.items.length, sets: items.sets.length, icons: have.size } };
}
