import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, ClientStats, Races, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { collectStatEffects, deriveStats, healthFromStamina, indexClass, manaFromIntellect, type StatTotal } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70685");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

const src = { from: "class" as const, name: "Talento", rank: 1, maxRank: 1 };
const total = (target: StatTotal["target"], value: number, unit: StatTotal["unit"] = "%"): StatTotal => ({ category: "Atributos, salud y recursos", label: String(target), value, unit, scope: null, target, sources: [src] });

describe("aura 137: atributo en % (EffectMiscValue[1] = mascara)", () => {
  // Texto del cliente de cada talento -> atributo que debe salir (el [0] vale 0 en todos, asi que no sirve)
  const WORDS: [RegExp, string][] = [
    [/fuerza/i, "Fuerza"],
    [/agilidad/i, "Agilidad"],
    [/aguante/i, "Aguante"],
    [/intelecto/i, "Intelecto"],
    [/espíritu/i, "Espíritu"],
  ];

  it("cada talento con aura 137 suma el atributo que nombra su texto, no «Fuerza» por defecto", () => {
    let checked = 0;
    for (const f of readdirSync(join(D, "classes"))) {
      const cls = indexClass(ClassTalents.parse(json(`classes/${f}`)));
      for (const { talent } of cls.ordered) {
        if (!talent.effectInfo.some((e) => e.aura === 137)) continue;
        const build = { [talent.nodeId]: talent.maxRank };
        const fx = collectStatEffects({ cls, classBuild: build, legacy: null, legacyBuild: {}, race: null, abilities: null });
        const lines = fx.totals.filter((t) => t.target && t.sources.some((s) => s.name === talent.name));
        const first = (talent.descriptions[talent.maxRank - 1] ?? "").split(".")[0]!;
        const expected = WORDS.find(([re]) => re.test(first))![1];
        expect(lines.map((l) => l.label), talent.name ?? "").toEqual([expected]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });
});

describe("estadísticas con talentos", () => {
  it("vida por aguante e intelecto a maná de Classic: 1 por punto hasta 20 y 10 / 15 por punto después", () => {
    expect(healthFromStamina(15)).toBe(15);
    expect(healthFromStamina(20)).toBe(20);
    expect(healthFromStamina(100)).toBe(20 + 80 * 10);
    expect(manaFromIntellect(20)).toBe(20);
    expect(manaFromIntellect(100)).toBe(20 + 80 * 15);
  });

  it("sin efectos devuelve la base: atributos tal cual, vida y maná con su aporte", () => {
    const { rows } = deriveStats({ attributes: [30, 40, 50, 120, 90], hpBase: 1000, manaBase: 500, totals: [] });
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(row("int").final).toBe(120);
    expect(row("health")).toMatchObject({ base: 1000 + healthFromStamina(50), final: 1000 + healthFromStamina(50), bonusPct: 0 });
    expect(row("mana").final).toBe(500 + manaFromIntellect(120));
  });

  it("el % de un atributo sube el atributo y arrastra la vida o el maná que da", () => {
    const { rows } = deriveStats({ attributes: [30, 40, 100, 200, 90], hpBase: 1000, manaBase: 500, totals: [total("int", 10), total("sta", 15)] });
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(row("int")).toMatchObject({ base: 200, final: 220, bonusPct: 10 });
    expect(row("sta").final).toBe(115);
    expect(row("health").final).toBe(1000 + healthFromStamina(115));
    expect(row("mana").final).toBe(500 + manaFromIntellect(220));
  });

  it("«todos los atributos» se multiplica con el del atributo concreto; vida y maná llevan su % y los puntos planos de maná se suman antes", () => {
    const { rows } = deriveStats({ attributes: [100, 100, 100, 100, 100], hpBase: 0, manaBase: 100, totals: [total("all-stats", 10), total("str", 10), total("health", 5), total("mana", 5), total("mana", 50, "puntos")] });
    const row = (k: string) => rows.find((r) => r.key === k)!;
    expect(row("str").final).toBe(121); // 100 × 1,1 × 1,1
    expect(row("agi").final).toBe(110);
    expect(row("health").final).toBe(Math.floor(healthFromStamina(110) * 1.05));
    expect(row("mana").final).toBe(Math.floor((100 + manaFromIntellect(110) + 50) * 1.05));
  });

  it("las clases sin maná (maná base 0) no tienen fila de maná", () => {
    const { rows } = deriveStats({ attributes: [100, 100, 100, 20, 30], hpBase: 500, manaBase: 0, totals: [] });
    expect(rows.some((r) => r.key === "mana")).toBe(false);
  });
});

describe("poder de ataque y poder con hechizos de talentos (cliente + notas de Blizzard)", () => {
  const D2 = join(root, "data", "forever", "1.60.1.70685");
  const j = (f: string) => JSON.parse(readFileSync(join(D2, f), "utf8"));
  const client = ClientStats.parse(j("client-stats.json"));
  const cls = (token: string) => ({
    idx: indexClass(ClassTalents.parse(j(`classes/${token}.json`))),
    ab: Abilities.parse(j(`abilities/${token}.json`)),
    rules: TalentRules.parse(j(`rules/${token}.json`)),
  });
  const totalsOf = (token: string, talent: string) => {
    const c = cls(token);
    const t = c.idx.ordered.find((i) => i.talent.name === talent)!.talent;
    return collectStatEffects({ cls: c.idx, classBuild: { [t.nodeId]: t.maxRank }, legacy: null, legacyBuild: {}, race: null, abilities: c.ab, rules: c.rules }).totals;
  };
  const ap = (classId: number) => {
    const c = client.classes.find((x) => x.classId === classId)!;
    return { perStrength: c.attackPowerPerStrength, perAgility: c.attackPowerPerAgility, rangedPerAgility: c.rangedAttackPowerPerAgility };
  };

  it("Campeón de la Luz 3/3 = 60 % del intelecto como poder con hechizos (hotfix del 16/10: vuelve a 20/40/60 %; la nota de desarrollo del 15/10 decía 10/20/30 %)", () => {
    const { rows } = deriveStats({ attributes: [100, 80, 120, 200, 150], hpBase: 0, manaBase: 0, totals: totalsOf("paladin", "Campeón de la Luz"), attackPower: ap(2) });
    expect(rows.find((r) => r.key === "spell-damage")!.final).toBe(120); // 60 % de 200
    expect(rows.find((r) => r.key === "spell-healing")).toBeUndefined();
  });

  it("Guía espiritual 5/5: 25 % del espíritu en sanación y 8 % en daño (el daño es un tercio de la sanación, como dice Blizzard)", () => {
    const { rows } = deriveStats({ attributes: [50, 50, 100, 150, 400], hpBase: 0, manaBase: 0, totals: totalsOf("priest", "Guía espiritual"), attackPower: ap(5) });
    expect(rows.find((r) => r.key === "spell-healing")!.final).toBe(100);
    expect(rows.find((r) => r.key === "spell-damage")!.final).toBe(32);
  });

  it("poder de ataque por atributo del cliente: Guerrero 2 por fuerza; Maña mental del Chamán suma el 100 % del intelecto", () => {
    const warrior = deriveStats({ attributes: [150, 90, 120, 20, 30], hpBase: 0, manaBase: 0, totals: [], attackPower: ap(1) });
    expect(warrior.rows.find((r) => r.key === "ap")!.final).toBe(300);
    const shaman = deriveStats({ attributes: [100, 60, 100, 180, 90], hpBase: 0, manaBase: 0, totals: totalsOf("shaman", "Maña mental"), attackPower: ap(7) });
    expect(shaman.rows.find((r) => r.key === "ap")!.final).toBe(100 * 2 + 180); // 2 por fuerza + 100 % del intelecto
  });
});

describe("El espíritu humano (+5 %) es una racial, no parte de la base", () => {
  const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
  const human = Races.parse(json("races.json")).races.find((r) => r.id === 1)!;
  const abilities = Abilities.parse(json("abilities/mage.json"));
  const spirit = (race: typeof human | null, base: number) => {
    const fx = collectStatEffects({ cls: mage, classBuild: {}, legacy: null, legacyBuild: {}, race, abilities });
    return deriveStats({ attributes: [30, 35, 45, 125, base], hpBase: 1000, manaBase: 500, totals: fx.totals }).rows.find((r) => r.key === "spi")!;
  };

  it("el Humano suma +5 % al espíritu base (120 -> 126, 20 -> 21) y lo muestra con su origen", () => {
    expect(spirit(human, 120)).toMatchObject({ base: 120, final: 126, bonusPct: 5 });
    expect(spirit(human, 20).final).toBe(21);
    expect(spirit(human, 120).sources.map((s) => s.name)).toContain("Humano: El espíritu humano");
  });

  it("otras razas no reciben ese bono", () => {
    expect(spirit(null, 120)).toMatchObject({ base: 120, final: 120, bonusPct: 0 });
  });
});
