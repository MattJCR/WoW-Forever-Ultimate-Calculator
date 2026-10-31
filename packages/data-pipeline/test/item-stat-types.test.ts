import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { buildItems, ITEM_STAT_KEYS, STAT_TYPE_TAGS } from "../src/items.js";
import { Items } from "../src/model.js";
import { SpellTables } from "../src/spell-tables.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70707";
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);

/**
 * Tipos de estadística de objeto 83-140 (sesión 12): su significado sale de los textos ITEM_MOD_* de GlobalStrings del cliente, que van
 * numerados seguidos; los objetos conocidos (hacha a dos manos, caña de pescar, Marca del Campeón…) confirman el orden.
 */
describe.skipIf(!existsSync(join(RAW, "GlobalStrings.csv")) || !existsSync(join(RAW, "ItemSparse.csv")))("tipos de estadística de objeto (cliente 1.60.1.70707)", () => {
  const raw = openRawTables(RAW);
  const strings = new Map(raw.table("GlobalStrings").map((r) => [r.BaseTag!, { id: Number(r.ID), text: r.TagText_lang ?? "" }]));
  const data = Items.parse(buildItems(raw, BUILD, new SpellTables(raw)));
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const stat = (id: number, type: number) => byId.get(id)!.stats.find((s) => s.type === type);

  it("cada tipo 90-140 tiene su texto ITEM_MOD_*_SHORT en el cliente y el orden de los ids de GlobalStrings es el del tipo", () => {
    const entries = Object.entries(STAT_TYPE_TAGS).map(([t, v]) => ({ type: Number(t), ...v }));
    expect(entries).toHaveLength(50); // 16 armas + 13 profesiones + 5 perforaciones + 8 + 8
    for (const e of entries) expect(strings.has(`${e.tag}_SHORT`), `${e.tag}_SHORT`).toBe(true);
    // Por grupo: los ids de GlobalStrings crecen con el tipo (armas, profesiones, perforación, poder de ataque contra, daño contra)
    const groups: [number, number][] = [[90, 105], [106, 118], [119, 123], [125, 132], [133, 140]];
    for (const [from, to] of groups) {
      const ids = entries.filter((e) => e.type >= from && e.type <= to).map((e) => strings.get(`${e.tag}_SHORT`)!.id);
      expect(ids.length).toBe(to - from + 1);
      expect(ids, `grupo ${from}-${to}`).toEqual([...ids].sort((a, b) => a - b));
    }
  });

  it("los objetos conocidos confirman el significado de cada familia", () => {
    expect(ITEM_STAT_KEYS[90]).toBe("skill-2h-axes"); // Hacha de batalla de torio enorme
    expect(stat(12775, 90)?.key).toBe("skill-2h-axes");
    expect(stat(4548, 91)?.key).toBe("skill-2h-maces"); // Almádena servomecánica
    expect(stat(276102, 92)?.key).toBe("skill-2h-swords"); // Corriente de hojas
    expect(stat(21126, 96)?.key).toBe("skill-daggers"); // Aguijón de la Muerte
    expect(stat(275669, 98)?.key).toBe("skill-fist-weapons"); // Golpeadores de peleón
    expect(stat(13712, 103)?.key).toBe("skill-swords"); // espada de prueba: «Habilidad con espadas»
    expect(stat(7349, 112)?.key).toBe("profession-herbalism"); // Guantes de herborista
    expect(stat(5444, 113)?.key).toBe("profession-mining"); // Manteo de minero
    expect(stat(269716, 114)?.key).toBe("profession-skinning"); // Cuchillo para desollar
    expect(stat(6367, 117)?.key).toBe("profession-fishing"); // Caña de pescar
    expect(stat(21101, 119)?.key).toBe("fire-penetration"); // Bastón de penetración de hechizos: Fuego
    expect(stat(21102, 121)?.key).toBe("frost-penetration"); // …: Escarcha
    expect(stat(10696, 127)?.key).toBe("attack-power-vs-demon"); // Espada Felbane
    expect(stat(23078, 128)?.key).toBe("attack-power-vs-undead"); // Guanteletes de Asesino de no-muertos
    expect(stat(282778, 129)?.key).toBe("attack-power-vs-dragonkin"); // Marca del Vuelo Rojo
    expect(stat(1465, 131)?.key).toBe("attack-power-vs-beast"); // Aterratigres
    expect(stat(7506, 132)?.key).toBe("attack-power-vs-mechanical"); // Mando universal gnómico
    expect(stat(23207, 135)?.key).toBe("spell-damage-vs-demon"); // Marca del Campeón (hechizos)
    expect(stat(23207, 136)?.key).toBe("spell-damage-vs-undead");
    expect(stat(23084, 136)?.value).toBe(18); // Guantes de Purificación de no-muertos
  });

  it("ningún tipo con valor queda sin interpretar salvo los que el cliente deja sin nombre (se conservan con key null)", () => {
    const unknown = new Map<number, number>();
    for (const i of data.items) for (const s of i.stats) if (s.key === null) unknown.set(s.type, (unknown.get(s.type) ?? 0) + 1);
    expect([...unknown.keys()], "tipos sin interpretar").toEqual([]);
  });

  it("el tipo -1 es un hueco sin tipo (anillos grabados): se conserva como `untyped`", () => {
    expect(stat(210250, -1)?.key).toBe("untyped");
  });
});
