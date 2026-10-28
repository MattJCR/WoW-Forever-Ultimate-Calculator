import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EquipRules, Items } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { CREATURE_TYPES, deriveCombatStats, deriveStats, indexGearData, powerContext, summarizeGear } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
const has = existsSync(join(D, "items.json")) && existsSync(join(D, "equip-rules.json"));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

const flat = deriveStats({ attributes: [100, 100, 100, 100, 100], hpBase: 0, manaBase: 0, totals: [], attackPower: { perStrength: 2, perAgility: 0, rangedPerAgility: 0 } });
const rows = (stats: Record<string, number>) => deriveCombatStats({ derived: flat, totals: [], gear: { stats, armor: 0, ratings: null }, classStats: null }).rows;

describe("estadísticas de objeto de Forever 90-140 (sesión 12)", () => {
  it("habilidad con armas y de profesión, penetración por escuela y bonos contra criaturas salen en el Resumen, cada uno en su grupo", () => {
    const r = rows({ "skill-swords": 4, "profession-fishing": 20, "fire-penetration": 150, "attack-power-vs-beast": 9, "spell-damage-vs-undead": 85 });
    const find = (key: string) => r.find((x) => x.key === key)!;
    expect(find("skill-swords")).toMatchObject({ group: "Habilidades", label: "Habilidad con espadas", value: 4, unit: "pts" });
    expect(find("profession-fishing")).toMatchObject({ group: "Habilidades", label: "Habilidad en pesca", value: 20 });
    expect(find("fire-penetration")).toMatchObject({ group: "Ataque", label: "Penetración de Fuego", value: 150 });
    expect(find("attack-power-vs-beast")).toMatchObject({ group: "Contra criaturas", label: "Poder de ataque contra bestias", value: 9 });
    expect(find("spell-damage-vs-undead")).toMatchObject({ group: "Contra criaturas", label: "Daño con hechizos contra no-muertos", value: 85 });
    // Los de criatura avisan de que no entran en el total
    expect(find("attack-power-vs-beast").note).toContain("Solo vale contra ese tipo de criatura");
  });

  it("sin esas estadísticas no aparece ninguna fila nueva", () => {
    expect(rows({ strength: 5 }).filter((x) => x.group === "Habilidades" || x.group === "Contra criaturas")).toEqual([]);
  });

  it("el tipo de criatura elegido suma su bono al poder de ataque (cuerpo a cuerpo y a distancia) o al daño con hechizos; los otros tipos no", () => {
    const gear = { "attack-power-vs-beast": 9, "attack-power-vs-demon": 45, "spell-damage-vs-undead": 85 };
    const base = powerContext(flat, gear, []);
    expect(powerContext(flat, gear, [], { creatureType: null })).toEqual(base);
    expect(powerContext(flat, gear, [], { creatureType: "beast" }).attackPower).toBe(base.attackPower + 9);
    expect(powerContext(flat, gear, [], { creatureType: "beast" }).rangedAttackPower).toBe(base.rangedAttackPower + 9);
    expect(powerContext(flat, gear, [], { creatureType: "demon" }).attackPower).toBe(base.attackPower + 45);
    expect(powerContext(flat, gear, [], { creatureType: "undead" }).spellDamage).toBe(base.spellDamage + 85);
    expect(powerContext(flat, gear, [], { creatureType: "undead" }).attackPower).toBe(base.attackPower);
    expect(powerContext(flat, gear, [], { creatureType: "humanoid" })).toEqual(base);
  });

  it("los ocho tipos de criatura tienen nombre del cliente", () => {
    expect(CREATURE_TYPES.map((c) => c.key)).toEqual(["humanoid", "elemental", "demon", "undead", "dragonkin", "giant", "beast", "mechanical"]);
  });

  it.skipIf(!has)("con objetos reales: Aterratigres suma 9 de poder de ataque contra bestias aparte de su poder de ataque; el anillo grabado no suma nada", () => {
    const items = Items.parse(json("items.json"));
    const data = indexGearData({ items, rules: EquipRules.parse(json("equip-rules.json")) });
    const ctx = { classId: 1, raceId: 0, level: 60 };
    const s = summarizeGear({ mainHand: { itemId: 1465 } }, ctx, data);
    expect(s.stats["attack-power-vs-beast"]).toBe(9);
    expect(s.stats["attack-power"]).toBe(10);
    const ring = summarizeGear({ finger1: { itemId: 210250 } }, ctx, data);
    expect(ring.stats.untyped).toBe(10); // se conserva (2 + 8), pero ninguna fila del Resumen lo usa
    expect(rows(ring.stats).filter((x) => x.key === "untyped")).toEqual([]);
  });
});
