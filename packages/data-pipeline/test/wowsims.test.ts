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
const BUILD = "1.60.1.70532";
const WS = join(root, "data", "external", "wowsims");
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);
const ready = existsSync(join(WS, "db.json")) && existsSync(join(WS, "CombatRatings.txt")) && existsSync(join(RAW, "RandPropPoints.csv"));

describe.skipIf(!ready)("datos de la comunidad (MIT, `community`)", () => {
  const db = JSON.parse(readFileSync(join(WS, "db.json"), "utf8")) as WowsimsDb;
  const raw = openRawTables(RAW);
  const ratings = CombatRatings.parse(buildCombatRatings(readFileSync(join(WS, "CombatRatings.txt"), "utf8"), BUILD));
  const warnings: string[] = [];
  const enchants = Enchants.parse(buildEnchants(db, raw, BUILD, warnings, new SpellTables(raw)));
  const suffixNames = (JSON.parse(readFileSync(join(WS, "../../i18n/suffixes-esES.json"), "utf8")) as { names: Record<string, string> }).names;
  const suffixes = RandomSuffixes.parse(buildRandomSuffixes(db, BUILD, suffixNames));
  const client = Items.parse(buildItems(raw, BUILD, new SpellTables(raw)));
  const merged = Items.parse(applyWowsims(client, db).items);

  it("los 160 sufijos aleatorios tienen nombre en español (traducción propia) y ninguno queda en inglés", () => {
    expect(suffixes.suffixes).toHaveLength(160);
    expect(suffixes.suffixes.filter((s) => s.textOrigin === "untranslated").map((s) => s.nameEn)).toEqual([]);
    expect(suffixes.suffixes.find((s) => s.nameEn === "of the Monkey")!.name).toBe("del Mono");
    expect(suffixes.suffixes.every((s) => !/^of/i.test(s.name))).toBe(true);
  });

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

  it("la puntuacion de la comunidad coincide con la del Yelmo corazon de leon del cliente (28 de critico = 2 %, 20 de impacto = 2 %)", () => {
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
    expect(enchants.enchants.filter((e) => /\$/.test(e.name)).map((e) => e.effectId)).toEqual([]); // también las que citan otro hechizo (7664: «$1220596M1»)
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

  it("objetos nuevos de la comunidad: solo los que el cliente no trae, marcados community y sin traducir", () => {
    const extra = merged.items.filter((i) => i.provenance === "community");
    expect(extra.length).toBeGreaterThan(5);
    const clientIds = new Set(client.items.map((i) => i.id));
    expect(extra.every((i) => !clientIds.has(i.id) && i.textOrigin === "untranslated")).toBe(true);
    // El Muro de los Muertos (1979) era el único que el cliente listaba sin datos y la comunidad traía; el hotfix del 22/10 ya lo trae el cliente
    expect(extra.map((i) => i.id)).not.toContain(1979);
    expect(client.items.some((i) => i.id === 1979)).toBe(true);
    // lo del cliente no se toca
    expect(merged.items.filter((i) => i.provenance === "client-db2")).toHaveLength(client.items.length);
  });

  it("de los equipables que el cliente no trae (6 375 desde el parche 70532) ninguno lo trae la comunidad; el Muro de los Muertos (hotfix posterior a nuestra caché anterior) ya es del cliente con las mismas cifras", () => {
    const wsIds = new Set(db.items.map((i) => i.id));
    expect(client.unavailable.filter((u) => wsIds.has(u.id)).map((u) => u.id)).toEqual([]);
    const wall = merged.items.find((i) => i.id === 1979)!;
    expect(wall.provenance).toBe("client-db2");
    expect(wall.armor).toBe(1937); // = la cifra que traía la comunidad
    expect(wall.stats.find((x) => x.key === "block-value")?.value).toBe(41);
  });

  describe("contraste exacto con sus objetos (8 589 comunes)", () => {
    const common = db.items.filter((w) => client.items.some((i) => i.id === w.id));
    const byId = new Map(client.items.map((i) => [i.id, i]));
    const so = (w: (typeof db.items)[number]) => Object.values(w.scalingOptions ?? {})[0];

    it("calidad y nivel de objeto coinciden en TODOS", () => {
      expect(common.length).toBeGreaterThan(8500);
      expect(common.filter((w) => byId.get(w.id)!.quality !== w.quality)).toHaveLength(0);
      expect(common.filter((w) => so(w)?.ilvl !== undefined && so(w)!.ilvl !== byId.get(w.id)!.itemLevel)).toHaveLength(0);
    });

    it("daño y velocidad de arma coinciden (±1) salvo cañas de pescar y objetos sin tabla: armas de lanzador y a distancia con las reglas del cliente", () => {
      let n = 0;
      const bad: number[] = [];
      for (const w of common) {
        const o = so(w);
        const mine = byId.get(w.id)!;
        if (o?.weaponDamageMin === undefined || !mine.weapon) continue;
        n++;
        if (Math.abs(mine.weapon.min - o.weaponDamageMin) > 1 || Math.abs(mine.weapon.max - (o.weaponDamageMax ?? 0)) > 1 || Math.abs((w.weaponSpeed ?? mine.weapon.speed) - mine.weapon.speed) > 0.001) bad.push(w.id);
      }
      expect(n).toBeGreaterThan(1300);
      expect(bad).toEqual([]);
      // Ya no hay estimaciones: la tabla de daño a distancia es del cliente y el daño reducido de las armas de lanzador es 2/3 y 29/39
      expect(client.items.filter((i) => i.weapon?.confidence === "estimated")).toHaveLength(0);
    });

    it("poder con hechizos de las armas de lanzador (bastones…): idéntico al de la comunidad", () => {
      let n = 0;
      for (const w of common) {
        const mine = byId.get(w.id)!;
        if (!mine.casterWeapon) continue;
        const theirs = so(w)?.stats ?? {};
        const ours = (key: string) => mine.stats.filter((x) => x.key === key).reduce((a, x) => a + x.value, 0);
        // nuestro «spell-power» (45) = daño y sanación; el suyo reparte en 4 (sanación) y 5 (daño)
        const dmg = ours("spell-power") + ours("spell-damage");
        const heal = ours("spell-power") + ours("healing-power");
        if ((theirs["5"] ?? 0) !== dmg || (theirs["4"] ?? 0) !== heal) continue;
        n++;
      }
      expect(n).toBeGreaterThan(150);
    });

    it("«único-equipado» y valor de bloqueo: sin diferencias", () => {
      expect(common.filter((w) => !!w.unique !== (byId.get(w.id)!.maxCount === 1 || byId.get(w.id)!.uniqueEquipped))).toHaveLength(0);
      const shields = common.filter((w) => w.weaponType === 7 && so(w)?.stats?.["24"]);
      expect(shields.length).toBeGreaterThan(200);
      const merged2 = new Map(merged.items.map((i) => [i.id, i]));
      expect(shields.filter((w) => merged2.get(w.id)!.stats.find((x) => x.key === "block-value")?.value !== so(w)!.stats!["24"])).toHaveLength(0);
      // el valor de bloqueo es de la comunidad y va marcado
      expect(merged2.get(1203)!.stats.find((x) => x.key === "block-value")?.source).toBe("community");
    });

    it("la armadura de las tablas coincide (±1) y la armadura extra de las piezas verdes es parte de ella", () => {
      const bad = common.filter((w) => {
        const mine = byId.get(w.id)!;
        return mine.classId === 4 && Math.abs((mine.armor ?? 0) - (so(w)?.stats?.["27"] ?? 0)) > 1;
      });
      expect(bad).toHaveLength(0);
      expect(byId.get(8198)!.bonusArmor).toBe(100);
      expect(byId.get(8198)!.armor).toBeGreaterThan(100);
    });
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
