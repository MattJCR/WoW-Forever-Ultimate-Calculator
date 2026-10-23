import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { buildItems } from "../src/items.js";
import { Items } from "../src/model.js";
import { SpellTables } from "../src/spell-tables.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70532";
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);

describe.skipIf(!existsSync(join(RAW, "ItemSetSpell.csv")))("conjuntos y efectos de objeto (cliente 1.60.1.70532, con hotfixes)", () => {
  const raw = openRawTables(RAW);
  const data = Items.parse(buildItems(raw, BUILD, new SpellTables(raw)));
  const byId = new Map(data.items.map((i) => [i.id, i]));

  it("545 conjuntos (536 + los 9 de nivel 30 del hotfix del 22/10) y todos menos uno con bonos; los bonos van ordenados por piezas", () => {
    expect(data.sets).toHaveLength(545);
    expect(data.sets.filter((s) => s.bonuses.length === 0)).toHaveLength(1);
    for (const s of data.sets) expect(s.bonuses.map((b) => b.threshold)).toEqual([...s.bonuses.map((b) => b.threshold)].sort((a, b) => a - b));
  });

  it("Vestiduras Necrópilas: 5 piezas y bonos de 2, 3, 4 y 5 con el texto del cliente en español", () => {
    const set = data.sets.find((s) => s.id === 122)!;
    expect(set.name).toBe("Vestiduras Necrópilas");
    expect(set.itemIds).toHaveLength(5);
    expect(set.bonuses.map((b) => b.threshold)).toEqual([2, 3, 4, 5]);
    expect(set.bonuses[0]!.text).toBe("Mejora un 0,5% tu probabilidad de golpear.");
    expect(set.bonuses[3]!.text).toContain("hasta en 23 p.");
  });

  it("las piezas con datos apuntan a su conjunto (ItemSparse.ItemSet) y casi la mitad de las piezas de conjunto no tiene datos", () => {
    let withData = 0;
    let total = 0;
    for (const set of data.sets) {
      for (const id of set.itemIds) {
        total++;
        const piece = byId.get(id);
        if (!piece) continue;
        withData++;
        expect(piece.itemSetId).toBe(set.id);
      }
    }
    expect(withData).toBeGreaterThan(1500);
    expect(total - withData).toBeGreaterThan(1400); // piezas sin ItemSparse (p. ej. todas las Vestiduras Necrópilas): el conjunto sale, la pieza no
  });

  it("efectos de objeto: Trueno furioso lleva su efecto al golpear con texto; casi todos los textos se calculan completos", () => {
    const fx = byId.get(19019)!.effects;
    expect(fx.some((e) => e.name === "Furiatrueno" && e.trigger === 2 && e.text.includes("300 p. de daño de Naturaleza"))).toBe(true);
    const all = [...byId.values()].flatMap((i) => i.effects);
    expect(all.length).toBeGreaterThan(1000);
    expect(all.filter((e) => !e.textComplete).length).toBeLessThan(40);
    expect(data.sets.flatMap((s) => s.bonuses).filter((b) => !b.textComplete).length).toBeLessThanOrEqual(3);
  });
});
