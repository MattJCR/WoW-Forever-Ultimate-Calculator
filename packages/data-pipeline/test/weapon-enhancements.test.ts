import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { WeaponEnhancements } from "../src/model.js";
import { SpellTables } from "../src/spell-tables.js";
import { buildWeaponEnhancements } from "../src/weapon-enhancements.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70707";
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);

describe.skipIf(!["ItemSparse", "SpellItemEnchantment", "SpellEquippedItems"].every((t) => existsSync(join(RAW, `${t}.csv`))))("mejoras temporales de arma del cliente", () => {
  const raw = openRawTables(RAW);
  const warnings: string[] = [];
  const data = WeaponEnhancements.parse(buildWeaponEnhancements(raw, BUILD, new SpellTables(raw), warnings));
  const byItem = (id: number) => data.enhancements.find((e) => e.itemId === id)!;

  it("cumple el esquema, sin avisos y con los tres tipos", () => {
    expect(warnings).toEqual([]);
    expect(data.enhancements.length).toBe(85);
    const kinds = data.enhancements.reduce<Record<string, number>>((n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ damage: 11, proc: 29, stats: 45 });
    expect(new Set(data.enhancements.map((e) => e.itemId)).size).toBe(data.enhancements.length);
  });

  it("lo que no se ofrece queda con su motivo: cebos de pesca, objetos de prueba y efectos sin implementar", () => {
    expect(data.skipped.map((s) => s.itemId).sort((a, b) => a - b)).toEqual([2896, 2927, 6529, 6530, 6532, 6533, 6811, 7307, 202316, 259846, 268880]);
    const reasons = new Set(data.skipped.map((s) => s.reason));
    expect([...reasons].sort()).toEqual(["cebo de pesca: no es de combate", "objeto de prueba o retirado", "sin implementar en el cliente (texto «NYI.» y sin efecto)"]);
    // La piedra de afilar consagrada también admite cañas de pescar en su máscara, pero es de combate
    expect(byItem(23122)).toBeDefined();
  });

  it("piedras y contrapesos: «+N de daño», 30 min, cortantes o contundentes", () => {
    const stone = byItem(2862);
    expect(stone).toMatchObject({ kind: "damage", durationMs: 1_800_000, charges: null, requiredLevel: 1, classMask: 0, enchantId: 40 });
    expect(stone.stats).toEqual([{ type: 83, key: "physical-damage", value: 2 }]);
    const weight = byItem(3239);
    expect(weight.weaponSubclassMask & stone.weaponSubclassMask).toBe(0); // los tipos de arma no se solapan
    expect(byItem(12404).stats[0]!.value).toBe(8);
  });

  it("venenos: solo pícaros, con cargas y la probabilidad por golpe del encantamiento", () => {
    const instant = byItem(6947);
    expect(instant).toMatchObject({ kind: "proc", classMask: 8, charges: 60 });
    expect(instant.effects[0]!.proc).toMatchObject({ chancePct: 20, damage: { average: 15 } });
    expect(byItem(2892).effects[0]!.proc!.chancePct).toBe(30); // veneno mortal
  });

  it("los objetos sin fila de nombre (hotfix) usan el nombre del encantamiento y lo dicen", () => {
    const nameless = data.enhancements.filter((e) => e.nameFromEnchant);
    expect(nameless.length).toBeGreaterThan(0);
    for (const e of nameless) expect(e.name).not.toBe("");
    expect(byItem(2862).nameFromEnchant).toBe(false);
  });
});
