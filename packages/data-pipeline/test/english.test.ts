import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hideUnresolved, sameNumbers } from "../src/english-official.js";
import { Abilities, ClassTalents, EnglishText, Items, Races, Unassigned } from "../src/model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = join(root, "data", "forever", "1.60.1.70532");
const ready = existsSync(join(DATA, "i18n", "en.json")) && existsSync(join(DATA, "classes", "mage.json"));
const TOKENS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];

describe.skipIf(!ready)("textos en inglés (del juego, contrastados con las cifras del cliente)", () => {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(DATA, f), "utf8")) as T;
  const en = EnglishText.parse(read("i18n/en.json"));
  const mage = ClassTalents.parse(read("classes/mage.json"));
  const races = Races.parse(read("races.json"));
  const classes = TOKENS.map((t) => ClassTalents.parse(read(`classes/${t}.json`)));
  const abilities = TOKENS.map((t) => Abilities.parse(read(`abilities/${t}.json`)));

  it("lleva la procedencia de la comunidad", () => {
    expect(en.provenance).toBe("community");
  });

  it("nombra las 9 clases y sus árboles en inglés", () => {
    expect(Object.keys(en.classes)).toHaveLength(9);
    expect(en.classes.MAGE ?? en.classes.Mage).toBeDefined();
    const m = (en.classes.MAGE ?? en.classes.Mage)!;
    expect(m.name).toBe("Mage");
    expect(m.specs).toEqual(["Arcane", "Fire", "Frost"]);
    expect(en.legacyTrees).toHaveLength(3);
  });

  it("todos los talentos de clase y las ventajas de Legacy tienen nombre y un texto por rango", () => {
    for (const t of mage.specs.flatMap((s) => s.talents)) {
      const e = en.talents[t.nodeId];
      expect(e, `${t.name} (${t.nodeId})`).toBeDefined();
      expect(e!.name).not.toBe("");
      expect(e!.descriptions.length).toBeGreaterThanOrEqual(t.maxRank);
    }
    const legacy = ClassTalents.parse(read("legacy.json"));
    for (const t of legacy.specs.flatMap((s) => s.talents)) expect(en.talents[t.nodeId], t.name ?? String(t.nodeId)).toBeDefined();
  });

  it("los talentos de las 9 clases tienen un texto inglés por rango con las mismas cifras que el del cliente", () => {
    const bad: string[] = [];
    for (const c of classes) {
      for (const t of c.specs.flatMap((s) => s.talents)) {
        const e = en.talents[t.nodeId];
        if (!e || e.descriptions.length < t.descriptions.length) bad.push(`${t.name} (${t.nodeId}): sin inglés`);
        else t.descriptions.forEach((es, i) => !sameNumbers(hideUnresolved(es), e.descriptions[i]!) && bad.push(`${t.name} (${t.nodeId}) rango ${i + 1}`));
      }
    }
    expect(bad).toEqual([]);
  });

  it("los nodos no activos tienen nombre y texto inglés (cuando el cliente trae hechizo)", () => {
    for (const c of classes) {
      for (const t of c.inactiveTalents) {
        const e = en.talents[t.nodeId];
        expect(e?.name, `${t.name} (${t.nodeId})`).toBeTruthy();
        expect(e!.descriptions.length, `${t.name} (${t.nodeId})`).toBe(t.descriptions.length);
      }
    }
  });

  it("todos los rangos de habilidad de las 9 clases tienen nombre inglés y un texto con las cifras del español", () => {
    const missing: string[] = [];
    const differ: string[] = [];
    for (const file of abilities) {
      for (const a of file.abilities) {
        for (const r of a.ranks) {
          const e = en.spells[r.spellId];
          if (!e?.name) {
            missing.push(`${a.name} (${r.spellId})`);
            continue;
          }
          const text = e.description ?? "";
          if (r.description && !text) missing.push(`${a.name} (${r.spellId}): sin texto`);
          else if (r.description && !sameNumbers(hideUnresolved(r.description), text)) differ.push(`${a.name} (${r.spellId})`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(differ).toEqual([]);
  });

  it("cada racial se empareja con la suya por nombre (el orden de las listas de la comunidad no coincide con el del cliente)", () => {
    for (const r of races.races) {
      const e = en.races[r.id];
      expect(e, r.name).toBeDefined();
      expect(e!.racials).toHaveLength(r.racials.length);
      expect(e!.racials.every((x) => x.name !== "")).toBe(true);
    }
    const human = races.races.find((r) => r.id === 1)!;
    expect(human.racials.map((a) => en.races[1]!.racials[a.order]!.name)).toEqual(["Will to Survive", "Perception", "Ruthless", "The Human Spirit"]);
  });

  it("los objetos visibles en la web tienen nombre inglés", () => {
    if (!existsSync(join(DATA, "items.json"))) return;
    const items = Items.parse(read("items.json"));
    const unavailable = new Set(items.unavailable.map((u) => u.id));
    const missing = items.items.filter((i) => !i.placeholder && !unavailable.has(i.id) && !en.items[i.id]).map((i) => `${i.id} ${i.name}`);
    // PENDIENTE (parche 70532): 115 objetos nuevos del hotfix del 22/10 + Machete cortante (18610, ahora de calidad 2) no están en las
    // tablas inglesas descargadas (que son del parche anterior); la web los enseña en español en el modo inglés. Al bajar las tablas del
    // build nuevo (`tools/extract/fetch-enus-tables.mjs`) esta lista debe quedar vacía y este bloque se borra.
    expect(missing).toHaveLength(116);
    expect(missing.every((m) => Number(m.split(" ")[0]) >= 288000 || [9383, 10761, 10765, 17074, 18610].includes(Number(m.split(" ")[0])))).toBe(true);
  });

  it("los efectos de objetos y los bonus de conjunto tienen nombre y texto en inglés, y los conjuntos su nombre", () => {
    if (!existsSync(join(DATA, "items.json"))) return;
    const items = Items.parse(read("items.json"));
    const bad: string[] = [];
    const effects = [...items.items.flatMap((i) => i.effects.map((e) => ({ ...e, what: `objeto ${i.id}` }))), ...items.sets.flatMap((s) => s.bonuses.map((b) => ({ ...b, what: `conjunto ${s.id}` })))];
    for (const e of effects) {
      if (!e.name && !e.text) continue; // el cliente no trae nada que traducir
      const x = en.spells[e.spellId];
      if (!x?.name && !x?.description) bad.push(`${e.what} hechizo ${e.spellId} ${e.name}`);
      else if (e.text && !x.description) bad.push(`${e.what} hechizo ${e.spellId} ${e.name}: sin texto`);
    }
    for (const s of items.sets) if (!en.itemSets[s.id]) bad.push(`conjunto ${s.id} ${s.name}`);
    // PENDIENTE (parche 70532): los 9 conjuntos de nivel 30 (2138-2146) y los hechizos de Anatema/Bendición (1327991, 1327993) llegaron por
    // hotfix y no están en las tablas inglesas descargadas; salen en español en el modo inglés. Vaciar esta lista al bajar las tablas nuevas.
    const pendingEn = /^conjunto 21(3[89]|4[0-6]) |^objeto 2892(96|97) hechizo 13279(91|93) /;
    expect(bad.filter((b) => !pendingEn.test(b))).toEqual([]);
    expect(bad).toHaveLength(11);
  });

  it("los datos sin asignar tienen inglés (salvo los huecos que ni el cliente nombra)", () => {
    const un = Unassigned.parse(read("unassigned.json"));
    const bad: string[] = [];
    for (const e of un.orphanEntries) {
      if (!e.name) continue;
      const x = en.entries[e.entryId];
      if (!x?.name || x.descriptions.length !== e.descriptions.length) bad.push(`entrada ${e.entryId} ${e.name}`);
    }
    for (const t of un.alternativeTrees) {
      for (const n of t.nodes) {
        if (!n.name) continue;
        const x = en.talents[n.nodeId];
        if (!x?.name || x.descriptions.length !== n.descriptions.length) bad.push(`árbol ${t.traitTreeId} nodo ${n.nodeId} ${n.name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("las traducciones propias están marcadas y no quedan textos pendientes de traducir", () => {
    const report = JSON.parse(readFileSync(join(root, "data", "i18n", "en-verification.json"), "utf8")) as { pending: unknown[]; ownMismatches: unknown[] };
    // PENDIENTE (parche 70532): textos que el cliente trae sin traducir (los 3 elixires «Endless») o con errata (Anatema/Bendición) y que aún
    // no tienen traducción propia aprobada ni inglés oficial: hechizos 1327736, 1327737, 1327753, 1327991, 1327993. Vaciar al resolverlos.
    expect((report.pending as { what: string }[]).map((x) => /\((\d+)\)/.exec(x.what)?.[1]).sort()).toEqual(["1327736", "1327737", "1327753", "1327991", "1327993"]);
    expect(report.ownMismatches).toEqual([]);
    expect(en.ownTranslation.length).toBeGreaterThan(0);
  });
});
