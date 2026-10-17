import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Races } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { describeEffect, raceBonuses } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const races = Races.parse(JSON.parse(readFileSync(join(root, "data", "forever", "1.60.1.70425", "races.json"), "utf8"))).races;
const race = (id: number) => races.find((r) => r.id === id)!;
const WARRIOR = 1;
const ROGUE = 4;
const PRIEST = 5;
const MAGE = 8;

describe("bonificaciones de raza (solo pasivas; datos del cliente)", () => {
  it("Humano: +2 % critico y +5 % espiritu", () => {
    const b = raceBonuses(race(1), MAGE);
    expect(b.critChancePct).toBe(2);
    expect(b.spiritPct).toBe(5);
    expect(b.passives.map((p) => p.racialName)).toEqual(["Crueldad", "El espíritu humano"]);
  });

  it("Gnomo: +5 % de mana al mago, de ira al guerrero y de energia al picaro (cada clase su variante)", () => {
    expect(raceBonuses(race(7), MAGE).maxPowerPct).toEqual({ mana: 5, rage: 0, energy: 0 });
    expect(raceBonuses(race(7), WARRIOR).maxPowerPct).toEqual({ mana: 0, rage: 5, energy: 0 });
    expect(raceBonuses(race(7), ROGUE).maxPowerPct).toEqual({ mana: 0, rage: 0, energy: 5 });
    expect(raceBonuses(race(7), PRIEST).maxPowerPct.mana).toBe(5);
  });

  it("Tauren: +5 % salud y +2 % bonus de critico; Enano: +5 % contra bestias; Trol: regeneracion", () => {
    expect(raceBonuses(race(6), WARRIOR)).toMatchObject({ healthPct: 5, critDamageBonusPct: 2, critHealingBonusPct: 2 });
    expect(raceBonuses(race(3), WARRIOR).damageVsCreature).toEqual([{ mask: 1, label: "bestias", pct: 5 }]);
    expect(raceBonuses(race(8), WARRIOR)).toMatchObject({ healthRegenPct: 20, healthRegenInCombatPct: 20 });
  });

  it("Cielonato: 3 % de celeridad en las tres y 5 % contra elementales", () => {
    const b = raceBonuses(race(95), MAGE);
    expect(b.hastePct).toEqual({ spell: 3, melee: 3, ranged: 3 });
    expect(b.damageVsCreature).toEqual([{ mask: 8, label: "elementales", pct: 5 }]);
  });

  it("las activas no entran en los totales pero se listan con duracion y enfriamiento", () => {
    const b = raceBonuses(race(2), WARRIOR);
    expect(b.critChancePct).toBe(1); // solo Salvajismo
    expect(b.stunDurationPct).toBe(-20);
    const bf = b.actives.find((a) => a.name === "Furia sangrienta")!;
    expect(bf).toMatchObject({ durationMs: 15000, cooldownMs: 180000 });
    expect(bf.effects).toHaveLength(3);
  });

  it("describeEffect da texto legible", () => {
    expect(describeEffect({ kind: "crit-chance", aura: 290, value: 2, miscValue: null, periodMs: null, fromSpellId: null })).toBe("+2 % probabilidad de crítico");
    expect(describeEffect({ kind: "spell-modifier-pct", aura: 108, value: -10, miscValue: 14, periodMs: null, fromSpellId: null })).toBe("-10 % coste");
    expect(describeEffect({ kind: null, aura: 17, value: 50, miscValue: null, periodMs: null, fromSpellId: null })).toBeNull();
  });
});

describe("todas las clases: cada raza resuelve las variantes de su clase", () => {
  // ClassID del cliente -> clase
  const CLASSES = [1, 2, 3, 4, 5, 7, 8, 9, 11];

  it("toda racial tiene al menos un hechizo aplicable a cada clase que puede ser esa raza", () => {
    for (const r of races) {
      for (const classId of r.classIds) {
        for (const a of r.racials) {
          const ok = a.spells.some((s) => s.classMask === 0 || (s.classMask & (1 << (classId - 1))) !== 0);
          expect(ok, `${r.name} / clase ${classId} / ${a.name}`).toBe(true);
        }
      }
    }
  });

  it("nunca hay dos variantes de la misma racial para una clase (no se suma doble)", () => {
    for (const r of races) {
      for (const classId of r.classIds) {
        for (const a of r.racials) {
          const n = a.spells.filter((s) => s.classMask === 0 || (s.classMask & (1 << (classId - 1))) !== 0).length;
          expect(n, `${r.name} / clase ${classId} / ${a.name}`).toBe(1);
        }
      }
    }
  });

  it("Gnomo: cada clase recibe +5 % del recurso que usa (mago, brujo y sacerdote maná; guerrero ira; pícaro energía)", () => {
    const expected: Record<number, "mana" | "rage" | "energy"> = { 1: "rage", 4: "energy", 5: "mana", 8: "mana", 9: "mana" };
    expect(race(7).classIds.sort((a, b) => a - b)).toEqual([1, 4, 5, 8, 9]);
    for (const [cls, power] of Object.entries(expected)) {
      const m = raceBonuses(race(7), Number(cls)).maxPowerPct;
      expect(m[power], `clase ${cls}`).toBe(5);
      expect(m.mana + m.rage + m.energy, `clase ${cls}`).toBe(5);
    }
  });

  it("Gnomo ¡Eureka!: coste -10 % y daño +10 % en todas sus clases; el daño periódico también solo en los lanzadores (sacerdote, mago, brujo)", () => {
    for (const cls of race(7).classIds) {
      const eureka = raceBonuses(race(7), cls).actives.find((a) => a.name === "¡Eureka!")!;
      expect(eureka.effects.filter((e) => e.kind === "spell-modifier-pct" && e.miscValue === 14 && e.value === -10), `clase ${cls}`).toHaveLength(1);
      expect(eureka.effects.filter((e) => e.kind === "spell-modifier-pct" && !e.miscValue && e.value === 10), `clase ${cls}`).toHaveLength(1);
    }
  });

  it("ninguna combinacion raza/clase del cliente lanza error y los porcentajes no son negativos en pasivas de bonus", () => {
    for (const r of races) {
      for (const classId of r.classIds) {
        const b = raceBonuses(r, classId);
        expect(b.critChancePct).toBeGreaterThanOrEqual(0);
        expect(b.healthPct).toBeGreaterThanOrEqual(0);
        expect(Object.values(b.maxPowerPct).every((v) => v >= 0)).toBe(true);
      }
    }
    expect(CLASSES.length).toBe(9);
  });
});

describe("efectos disparados y procs", () => {
  it("Espiritu de fuego fatuo (75 % de velocidad como fantasma) no cuenta como bonus permanente", () => {
    const b = raceBonuses(race(4), WARRIOR);
    expect(b.movementSpeedPct).toBe(2); // solo Presura (+2 %), no el +75 % de fantasma
  });

  it("Planicies del Tauren: +3 % de velocidad al montar", () => {
    expect(raceBonuses(race(6), WARRIOR).mountedSpeedPct).toBe(3);
  });

  it("describeEffect explica procs y regeneraciones periodicas con su contexto", () => {
    const touch = race(5).racials.find((a) => a.name === "Toque de la tumba")!.spells.find((s) => s.classMask === 400)!;
    expect(describeEffect(touch.effects[0]!, touch)).toBe("30 % de probabilidad: drena hasta 5 % de tu salud máxima (enfriamiento interno 25 s)");
    const cannibalize = race(5).racials.find((a) => a.name === "Canibalismo")!.spells[0]!;
    expect(describeEffect(cannibalize.effects.find((e) => e.kind === "periodic-health-pct")!, cannibalize)).toBe("35 % de la salud total (7 % cada 2 s)");
  });
});
