// Índice de slugs de las URLs (clases, razas, habilidades y talentos) en español e inglés.
// Lo lee la web para interpretar la ruta y para enlazar la misma página en el otro idioma; el prerender lo usa para generar cada página.
// Se ejecuta con tsx (importa src/seo/routes.ts): lo llama sync-data.mjs tras copiar los datos.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "../src/seo/routes.ts";

const readJson = (dir, file) => JSON.parse(readFileSync(join(dir, file), "utf8"));

/** Slugs únicos dentro de una lista: si dos nombres dan el mismo slug, ambos llevan el id detrás. */
function assignSlugs(items) {
  const out = items.map((it) => ({ id: it.id, es: slugify(it.es) || String(it.id), en: slugify(it.en ?? it.es) || String(it.id) }));
  for (const lang of ["es", "en"]) {
    const count = new Map();
    for (const e of out) count.set(e[lang], (count.get(e[lang]) ?? 0) + 1);
    for (const e of out) if (count.get(e[lang]) > 1) e[lang] = `${e[lang]}-${e.id}`;
  }
  return out;
}

export function buildSeoIndex(dataDir) {
  const manifest = readJson(dataDir, "manifest.json");
  const en = manifest.english?.file && existsSync(join(dataDir, manifest.english.file)) ? readJson(dataDir, manifest.english.file) : null;

  const classes = manifest.classes.map((c) => {
    const token = c.file.replace(/^classes\//, "").replace(/\.json$/, "");
    const enName = en && Object.entries(en.classes).find(([k]) => k.toLowerCase() === token)?.[1]?.name;
    return { token, id: c.classId, es: c.className, en: enName ?? token };
  });
  const classSlugs = assignSlugs(classes);
  const races = readJson(dataDir, manifest.races.file).races;

  const abilities = {};
  const talents = {};
  for (const c of classes) {
    const list = readJson(dataDir, `abilities/${c.token}.json`).abilities;
    const items = list.map((a) => {
      const id = a.ranks[0].spellId;
      const enName = en ? a.ranks.map((r) => en.spells[r.spellId]?.name).find(Boolean) : undefined;
      return { id, es: a.name, en: enName };
    });
    if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error(`Habilidades de ${c.token} con el mismo hechizo en el primer rango`);
    abilities[c.token] = assignSlugs(items);

    const cls = readJson(dataDir, `classes/${c.token}.json`);
    const ts = cls.specs.flatMap((s) => s.talents).filter((t) => t.name);
    talents[c.token] = assignSlugs(ts.map((t) => ({ id: t.nodeId, es: t.name, en: en?.talents[t.nodeId]?.name })));
  }

  return {
    build: manifest.build,
    classes: classes.map((c, i) => ({ token: c.token, id: c.id, es: classSlugs[i].es, en: classSlugs[i].en })),
    races: assignSlugs(races.map((r) => ({ id: r.id, es: r.name, en: en?.races[r.id]?.name }))),
    abilities,
    talents,
  };
}

export function writeSeoIndex(dataDir) {
  const index = buildSeoIndex(dataDir);
  writeFileSync(join(dataDir, "seo-index.json"), JSON.stringify(index));
  const n = (o) => Object.values(o).reduce((a, l) => a + l.length, 0);
  console.log(`Índice de URLs: ${index.classes.length} clases, ${index.races.length} razas, ${n(index.abilities)} habilidades, ${n(index.talents)} talentos`);
  return index;
}
