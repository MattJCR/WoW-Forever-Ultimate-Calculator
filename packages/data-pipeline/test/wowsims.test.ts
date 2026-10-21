import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { CombatRatings, Enchants, Items, RandomSuffixes } from "../src/model.js";
import { buildItems } from "../src/items.js";
import { SpellTables } from "../src/spell-tables.js";
import { applyWowsims, buildCombatRatings, buildEnchants, buildRandomSuffixes, type WowsimsDb } from "../src/wowsims.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70450";
const WS = join(root, "data", "external", "wowsims");
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);
const ready = existsSync(join(WS, "db.json")) && existsSync(join(WS, "CombatRatings.txt")) && existsSync(join(RAW, "RandPropPoints.csv"));

describe.skipIf(!ready)("datos de wowsims/forever (MIT, `community`)", () => {
  const db = JSON.parse(readFileSync(join(WS, "db.json"), "utf8")) as WowsimsDb;
  const raw = openRawTables(RAW);
  const ratings = CombatRatings.parse(buildCombatRatings(readFileSync(join(WS, "CombatRatings.txt"), "utf8"), BUILD));
  const warnings: string[] = [];
  const enchants = Enchants.parse(buildEnchants(db, raw, BUILD, warnings));
  const suffixes = RandomSuffixes.parse(buildRandomSuffixes(db, BUILD));
  const client = Items.parse(buildItems(raw, BUILD, new SpellTables(raw)));
  const merged = Items.parse(applyWowsims(client, db).items);

  it("puntuaciones por 1 %: constantes en los 123 niveles (impacto 10, critico 14, celeridad 10, esquivar 12, parada 15, bloqueo 5, defensa 1)", () => {
    expect(ratings.constantAcrossLevels).toBe(true);
    expect(ratings.levels).toEqual({ min: 1, max: 123 });
    expect(ratings.ratings["hit-melee"]).toBe(10);
    expect(ratings.ratings["hit-spell"]).toBe(10);
    expect(ratings.ratings["crit-melee"]).toBe(14);
    expect(ratings.ratings["crit-spell"]).toBe(14);
    expect(ratings.ratings["haste-melee"]).toBe(10);
    expect(ratings.ratings["dodge"]).toBe(12);
    expect(ratings.ratings["parry"]).toBe(15);
    expect(ratings.ratings["block"]).toBe(5);
    expect(ratings.ratings["defense-skill"]).toBe(1);
  });

  it("la puntuacion de wowsims coincide con la del Yelmo corazon de leon del cliente (28 de critico = 2 %, 20 de impacto = 2 %)", () => {
    const helm = merged.items.find((i) => i.id === 12640)!;
    const value = (key: string) => helm.stats.find((s) => s.key === key)!.value;
    expect(value("crit-rating") / ratings.ratings["crit-melee"]!).toBe(2);
    expect(value("hit-rating") / ratings.ratings["hit-melee"]!).toBe(2);
  });

  it("encantamientos: los 246 enlazan con SpellItemEnchantment y llevan nombre del cliente en español", () => {
    expect(enchants.enchants).toHaveLength(246);
    expect(warnings.some((w) => w.includes("no estan en SpellItemEnchantment"))).toBe(false);
    const names = new Map(raw.table("SpellItemEnchantment").map((r) => [Number(r.ID), r.Name_lang]));
    expect(enchants.enchants.every((e) => names.has(e.effectId) && e.name.length > 0)).toBe(true);
    const kit = enchants.enchants.find((e) => e.effectId === 15)!;
    expect(kit.name).toBe("+1 de aguante y +8 de armadura"); // $k1 y $k2 salen de EffectPointsMin, no del orden de las estadisticas
    expect(enchants.enchants.filter((e) => /\$/.test(e.name)).map((e) => e.effectId)).toEqual([7664]); // referencia a otro hechizo, sin resolver
  });

  it("sufijos aleatorios: 160 sufijos y toda lista de un objeto apunta a sufijos que existen", () => {
    expect(suffixes.suffixes).toHaveLength(160);
    const ids = new Set(suffixes.suffixes.map((s) => s.id));
    expect(merged.suffixSets.length).toBeGreaterThan(0);
    for (const set of merged.suffixSets) for (const id of set) expect(ids.has(id)).toBe(true);
    const withSet = merged.items.filter((i) => i.randomSuffixSet !== null);
    expect(withSet.length).toBeGreaterThan(1000);
    expect(withSet.every((i) => merged.suffixSets[i.randomSuffixSet!] !== undefined)).toBe(true);
  });

  it("objetos nuevos de wowsims: solo los que el cliente no trae, marcados community y sin traducir", () => {
    const extra = merged.items.filter((i) => i.provenance === "community");
    expect(extra.length).toBeGreaterThan(5);
    const clientIds = new Set([...client.items.map((i) => i.id), ...client.unavailable.map((u) => u.id)]);
    expect(extra.every((i) => !clientIds.has(i.id) && i.textOrigin === "untranslated")).toBe(true);
    // lo del cliente no se toca
    expect(merged.items.filter((i) => i.provenance === "client-db2")).toHaveLength(client.items.length);
  });

  it("wowsims no trae ninguno de los equipables que faltan en el cliente (usan las mismas tablas)", () => {
    const wsIds = new Set(db.items.map((i) => i.id));
    expect(client.unavailable.filter((u) => wsIds.has(u.id))).toHaveLength(0);
  });

  it("contraste con sus estadisticas de objeto: >= 97 % de los objetos comunes coinciden (+-1)", () => {
    const byId = new Map(client.items.map((i) => [i.id, i]));
    let n = 0;
    let ok = 0;
    for (const w of db.items) {
      const mine = byId.get(w.id);
      const so = Object.values(w.scalingOptions ?? {})[0];
      if (!mine || !so?.stats) continue;
      const theirs = Object.values(so.stats);
      const ours = mine.stats.filter((s) => s.key && s.key !== "extra-armor").map((s) => s.value);
      n++;
      if (ours.every((v) => theirs.some((t) => Math.abs(t - v) <= 1))) ok++;
    }
    expect(n).toBeGreaterThan(7000);
    expect(ok / n).toBeGreaterThanOrEqual(0.97);
  });
});
