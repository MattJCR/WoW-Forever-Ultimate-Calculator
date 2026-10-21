import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRawTables } from "../src/csv.js";
import { buildItems } from "../src/items.js";
import { SpellTables } from "../src/spell-tables.js";
import { Items } from "../src/model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70450";
const LOOTIFIED = join(root, "data", "external", "lootified", "ItemStats.lua");
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);
const haveRaw = existsSync(join(RAW, "RandPropPoints.csv"));

/** Claves de Lootified (lecturas del juego, build 70291) -> las nuestras. */
const LOOTIFIED_KEYS: Record<string, string> = {
  Agility: "agility", Strength: "strength", Intellect: "intellect", Spirit: "spirit", Stamina: "stamina",
  Defense: "defense", DodgeRating: "dodge-rating", ParryRating: "parry-rating", BlockRating: "block-rating",
  HitRating: "hit-rating", CritRating: "crit-rating", HasteRating: "haste-rating", ExpertiseRating: "expertise-rating",
  AttackPower: "attack-power", RangedAttackPower: "ranged-attack-power", Healing: "healing-power", SpellDamage: "spell-damage",
  MP5: "mana-per-5", SpellPowerAll: "spell-power", BlockValue: "block-value",
  HolyPower: "holy-power", FirePower: "fire-power", NaturePower: "nature-power", FrostPower: "frost-power", ShadowPower: "shadow-power", ArcanePower: "arcane-power",
};

function readLootified() {
  const txt = readFileSync(LOOTIFIED, "utf8");
  const section = (name: string, next?: string) => txt.slice(txt.indexOf(`    ${name} = {`), next ? txt.indexOf(`    ${next} = {`) : txt.length);
  const read = (s: string) => new Map([...s.matchAll(/^\s*\[(\d+)\] = "(.*)",?\s*$/gm)].map((m) => [Number(m[1]), m[2]!]));
  return { items: read(section("items", "weapons")), weapons: read(section("weapons", "skills")) };
}

const ready = haveRaw && existsSync(LOOTIFIED);
describe.skipIf(!ready)("objetos frente a las lecturas del juego de Lootified (solo contraste local)", () => {
  const data = Items.parse(buildItems(openRawTables(RAW), BUILD, new SpellTables(openRawTables(RAW))));
  const lootified = readLootified();
  const byId = new Map(data.items.map((i) => [i.id, i]));

  it("cubre los equipables con ItemSparse y deja aparte los que el cliente no trae", () => {
    expect(data.items.length).toBeGreaterThan(12000);
    expect(data.unavailable.length).toBeGreaterThan(6000);
    expect(data.unavailable.every((u) => !byId.has(u.id))).toBe(true);
  });

  it("estadisticas = reparto x presupuesto de RandPropPoints: >= 97 % de los objetos coinciden (+-1)", () => {
    let n = 0;
    let ok = 0;
    for (const [id, line] of lootified.items) {
      const mine = byId.get(id);
      if (!mine) continue;
      const read: Record<string, number> = Object.fromEntries(
        (line.split("|")[6] ?? "").split(",").filter(Boolean).map((p) => p.split("=")).map(([k, v]) => [k!, Number(v)]),
      );
      const expected = new Map<string, number>();
      for (const st of mine.stats) if (st.key) expected.set(st.key, (expected.get(st.key) ?? 0) + st.value);
      let same = true;
      for (const [k, v] of expected) {
        const theirs = Object.entries(LOOTIFIED_KEYS).find(([, ours]) => ours === k)?.[0];
        if (theirs && Math.abs((read[theirs] ?? 0) - v) > 1) same = false;
      }
      n++;
      if (same) ok++;
    }
    expect(n).toBeGreaterThan(10000);
    expect(ok / n).toBeGreaterThanOrEqual(0.97);
  });

  it("armadura = tablas + armadura extra: >= 98 % coinciden (+-1) (medido 99,5 %)", () => {
    let n = 0;
    let ok = 0;
    for (const [id, line] of lootified.items) {
      const mine = byId.get(id);
      if (!mine || mine.classId !== 4) continue;
      const theirs = Number(/Armor=(\d+)/.exec(line)?.[1] ?? 0);
      const extra = mine.stats.filter((s) => s.key === "extra-armor").reduce((a, s) => a + s.value, 0);
      n++;
      if (Math.abs((mine.armor ?? 0) + extra - theirs) <= 1) ok++;
    }
    expect(ok / n).toBeGreaterThanOrEqual(0.98);
  });

  /** Porcentaje de armas de un grupo cuyo daño min/max coincide con la lectura del juego (+-1 %). */
  function weaponAgreement(pick: (i: (typeof data.items)[number]) => boolean): { n: number; rate: number } {
    let n = 0;
    let ok = 0;
    for (const [id, line] of lootified.weapons) {
      const mine = byId.get(id);
      if (!mine?.weapon || !pick(mine)) continue;
      const [min, max] = line.split("|").map(Number) as [number, number];
      n++;
      const tol = (v: number) => Math.max(1, v * 0.01);
      if (Math.abs(mine.weapon.min - min) <= tol(min) && Math.abs(mine.weapon.max - max) <= tol(max)) ok++;
    }
    return { n, rate: ok / n };
  }

  it("daño de arma verificado (una mano, dos manos, varitas, arrojadizas): >= 95 % coinciden con el juego", () => {
    const r = weaponAgreement((i) => i.weapon!.confidence === "verified");
    expect(r.n).toBeGreaterThan(1500);
    expect(r.rate).toBeGreaterThanOrEqual(0.95); // medido 97 %
  });

  it("daño de arma estimado (a distancia x 0,6; de lanzador x 0,664 / x 0,741): >= 90 % coinciden y van marcadas estimated", () => {
    const ranged = weaponAgreement((i) => i.weapon!.table === "ranged");
    const caster = weaponAgreement((i) => i.casterWeapon);
    expect(ranged.n).toBeGreaterThan(200);
    expect(ranged.rate).toBeGreaterThanOrEqual(0.9); // medido 92,5 %
    expect(caster.n).toBeGreaterThan(150);
    expect(caster.rate).toBeGreaterThanOrEqual(0.9); // medido 93,6 %
    expect(data.items.filter((i) => i.weapon && (i.weapon.table === "ranged" || i.casterWeapon)).every((i) => i.weapon!.confidence === "estimated")).toBe(true);
  });

  it("no hay gemas: ninguna clase 3 ni ranura de engarce (el equipo no lleva gemas en Forever)", () => {
    expect(data.items.some((i) => i.classId === 3)).toBe(false);
  });

  it("referencias del juego: Yelmo corazon de leon y Sulfuras", () => {
    const helm = byId.get(12640)!;
    expect(helm.stats.map((s) => [s.key, s.value])).toEqual([["strength", 18], ["crit-rating", 28], ["hit-rating", 20]]);
    expect(Math.round(helm.armor!)).toBe(565);
    const sulfuras = byId.get(17182)!;
    expect([Math.round(sulfuras.weapon!.min), Math.round(sulfuras.weapon!.max)]).toEqual([223, 372]);
  });
});
