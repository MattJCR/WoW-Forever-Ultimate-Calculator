import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { buildItemSources } from "../src/item-sources.js";
import { buildItems } from "../src/items.js";
import { ItemSources } from "../src/model.js";
import { SpellTables } from "../src/spell-tables.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70532";
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);

/** «Fabricado» sale del cliente: hechizo de profesión (SkillLineAbility) que crea el objeto (SpellEffect 24). */
describe.skipIf(!existsSync(join(RAW, "SkillLine.csv")) || !existsSync(join(RAW, "ItemSparse.csv")))("fuente «Fabricado» de los objetos (cliente 1.60.1.70532)", () => {
  const raw = openRawTables(RAW);
  const items = buildItems(raw, BUILD, new SpellTables(raw));
  const sources = ItemSources.parse(buildItemSources(raw, BUILD, new Set(items.items.map((i) => i.id))));
  const crafted = (id: number) => (sources.items[String(id)] ?? []).filter((s): s is Extract<typeof s, { kind: "crafted" }> => s.kind === "crafted");

  it("cumple el esquema, es del cliente y cubre más de mil objetos de seis profesiones", () => {
    expect(Object.keys(sources.items).filter((id) => crafted(Number(id)).length > 0).length).toBeGreaterThan(1200);
    const lines = new Set(Object.values(sources.items).flat().flatMap((s) => (s.kind === "crafted" ? [s.skillLine] : [])));
    expect([...lines].sort((a, b) => a - b)).toEqual([164, 165, 171, 197, 202, 333]);
  });

  it("objetos conocidos: Jubón de cuero repujado (peletería), Arcano de ingeniería, y los de profesión llevan su habilidad mínima", () => {
    expect(crafted(2300).map((s) => [s.skillLine, s.skillEn])).toEqual([[165, "Leatherworking"]]);
    const any = Object.values(sources.items).flat().filter((s): s is Extract<typeof s, { kind: "crafted" }> => s.kind === "crafted");
    expect(any.every((s) => s.skill.length > 0 && s.minSkill >= 0)).toBe(true);
    expect(any.some((s) => s.minSkill > 100)).toBe(true);
  });

  it("ningún objeto de prueba ni sin datos entra: solo equipables con datos", () => {
    const known = new Set(items.items.map((i) => i.id));
    expect(Object.keys(sources.items).every((id) => known.has(Number(id)))).toBe(true);
  });
});
