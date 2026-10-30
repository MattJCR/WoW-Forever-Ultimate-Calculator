import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { buildEquipRules } from "../src/equip-rules.js";
import { EquipRules, Items } from "../src/model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70685";
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);
const OUT = join(root, "data", "forever", BUILD);

const bit = (classId: number) => 1 << (classId - 1);
const can = (list: { classMask: number; minLevel: number }[], classId: number, level: number) => list.some((p) => (p.classMask & bit(classId)) !== 0 && p.minLevel <= level);

describe.skipIf(!existsSync(join(RAW, "SkillRaceClassInfo.csv")))("competencias de armadura y armas (SkillRaceClassInfo, cliente 70450 con hotfixes)", () => {
  const rules = EquipRules.parse(buildEquipRules(openRawTables(RAW), BUILD));

  it("armadura: tela para todos, cuero sin magos, sacerdotes ni brujos, malla y placas desde el nivel 40", () => {
    const [warrior, paladin, hunter, rogue, priest, shaman, mage, warlock, druid] = [1, 2, 3, 4, 5, 7, 8, 9, 11];
    for (const c of [warrior, paladin, hunter, rogue, priest, shaman, mage, warlock, druid]) expect(can(rules.armor["1"]!, c, 1), `tela clase ${c}`).toBe(true);
    for (const c of [warrior, paladin, hunter, rogue, shaman, druid]) expect(can(rules.armor["2"]!, c, 1), `cuero clase ${c}`).toBe(true);
    for (const c of [priest, mage, warlock]) expect(can(rules.armor["2"]!, c, 60), `cuero clase ${c}`).toBe(false);
    // Malla: guerrero y paladín desde el principio; cazador y chamán a los 40
    expect(can(rules.armor["3"]!, warrior, 1)).toBe(true);
    expect(can(rules.armor["3"]!, hunter, 39)).toBe(false);
    expect(can(rules.armor["3"]!, hunter, 40)).toBe(true);
    expect(can(rules.armor["3"]!, shaman, 40)).toBe(true);
    expect(can(rules.armor["3"]!, rogue, 60)).toBe(false);
    // Placas: solo guerrero y paladín, desde el nivel 40
    expect(can(rules.armor["4"]!, warrior, 39)).toBe(false);
    expect(can(rules.armor["4"]!, paladin, 40)).toBe(true);
    expect(can(rules.armor["4"]!, hunter, 60)).toBe(false);
    // Escudos: guerrero, paladín y chamán
    expect([warrior, paladin, shaman].every((c) => can(rules.armor["6"]!, c, 1))).toBe(true);
    expect([hunter, rogue, priest, mage, warlock, druid].some((c) => can(rules.armor["6"]!, c, 60))).toBe(false);
  });

  it("armas: varitas solo para sacerdote, mago y brujo; ballestas para guerrero, cazador y pícaro; el pícaro no usa hachas de dos manos", () => {
    for (const c of [5, 8, 9]) expect(can(rules.weapons["19"]!, c, 1)).toBe(true);
    expect(can(rules.weapons["19"]!, 1, 60)).toBe(false);
    expect(can(rules.weapons["18"]!, 3, 1)).toBe(true);
    expect(can(rules.weapons["18"]!, 4, 60)).toBe(true); // el cliente da las ballestas también a guerrero y pícaro (13 = 1 + 4 + 8)
    expect(can(rules.weapons["18"]!, 5, 60)).toBe(false);
    expect(can(rules.weapons["15"]!, 4, 1)).toBe(true); // dagas
    expect(can(rules.weapons["1"]!, 4, 60)).toBe(false);
  });

  it("doble empuñadura: pícaro desde el 10, guerrero y cazador desde el 20", () => {
    expect(can(rules.dualWield, 4, 9)).toBe(false);
    expect(can(rules.dualWield, 4, 10)).toBe(true);
    expect(can(rules.dualWield, 1, 19)).toBe(false);
    expect(can(rules.dualWield, 1, 20)).toBe(true);
    expect(can(rules.dualWield, 3, 20)).toBe(true);
    expect(can(rules.dualWield, 5, 60)).toBe(false);
  });

  it("cada subclase conocida tiene filas (nada queda vacío en silencio) y las reliquias son de una sola clase", () => {
    expect(rules.warnings.filter((w) => w.includes("no tiene filas"))).toEqual([]);
    expect(rules.relics.provenance).toBe("assumption");
    expect(rules.relics.byClassMask).toEqual({ "7": 2, "8": 1024, "9": 64 });
  });
});

describe.skipIf(!existsSync(join(OUT, "items.json")))("presupuesto de estadísticas de los objetos (RandPropPoints)", () => {
  const items = Items.parse(JSON.parse(readFileSync(join(OUT, "items.json"), "utf8")));
  const wsFile = join(root, "data", "external", "wowsims", "db.json");

  it("los arcos usan el cubo de distancia (no el de dos manos): presupuesto de un arco de nivel 41 verde = 5", () => {
    const bow = items.items.find((i) => i.id === 4087)!;
    expect(bow.inventoryType).toBe(15);
    expect(bow.statBudget).toBe(5);
  });

  it.skipIf(!existsSync(wsFile))("coincide con el randPropPoints de la comunidad en los 1 641 objetos con sufijo aleatorio del cliente", () => {
    const db = JSON.parse(readFileSync(wsFile, "utf8")) as { items: { id: number; scalingOptions?: Record<string, { randPropPoints?: number }> }[] };
    const ws = new Map(db.items.map((i) => [i.id, i]));
    let compared = 0;
    for (const item of items.items) {
      if (item.randomSuffixSet === null || item.provenance !== "client-db2") continue;
      const so = Object.values(ws.get(item.id)?.scalingOptions ?? {})[0];
      if (so?.randPropPoints === undefined) continue;
      compared++;
      expect(Math.round(item.statBudget), `objeto ${item.id}`).toBe(so.randPropPoints);
    }
    expect(compared).toBeGreaterThan(1500);
  });
});
