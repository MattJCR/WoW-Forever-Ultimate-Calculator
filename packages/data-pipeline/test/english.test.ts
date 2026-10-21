import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Abilities, ClassTalents, EnglishText, Items, Races } from "../src/model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA = join(root, "data", "forever", "1.60.1.70450");
const ready = existsSync(join(DATA, "i18n", "en.json")) && existsSync(join(DATA, "classes", "mage.json"));

describe.skipIf(!ready)("textos en inglés (comunidad, no del cliente)", () => {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(DATA, f), "utf8")) as T;
  const en = EnglishText.parse(read("i18n/en.json"));
  const mage = ClassTalents.parse(read("classes/mage.json"));
  const races = Races.parse(read("races.json"));

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

  it("las habilidades se nombran por id de hechizo; las que la comunidad no trae quedan sin inglés (se muestran en español)", () => {
    const ab = Abilities.parse(read("abilities/mage.json"));
    const fireball = ab.abilities.find((a) => a.ranks.some((r) => en.spells[r.spellId]?.name === "Fireball"));
    expect(fireball).toBeDefined();
    const named = ab.abilities.filter((a) => a.ranks.some((r) => en.spells[r.spellId]));
    expect(named.length).toBeGreaterThan(ab.abilities.length / 2);
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

  it("nombres de objeto en inglés para la mayoría de los equipables", () => {
    if (!existsSync(join(DATA, "items.json"))) return;
    const items = Items.parse(read("items.json"));
    const withName = items.items.filter((i) => en.items[i.id]);
    expect(withName.length).toBeGreaterThan(items.items.length / 2);
  });
});
