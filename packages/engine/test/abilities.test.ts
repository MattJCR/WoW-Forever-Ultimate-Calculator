import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { applyModifiers, effectAt, findAbility, indexClass, rankAtLevel, spellModifiersOf } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const mage = Abilities.parse(JSON.parse(readFileSync(join(root, "data", "forever", "1.60.1.70685", "abilities", "mage.json"), "utf8")));
const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "mage.json"), "utf8")).spell_desc as Record<string, { id?: number; d?: string }>;

describe("habilidades del Mago (libro de hechizos del cliente)", () => {
  const fireball = findAbility(mage, "Bola de Fuego")!;

  it("Bola de fuego tiene 12 rangos que se aprenden a los niveles de Classic", () => {
    expect(fireball.ranks.map((r) => r.level)).toEqual([1, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 60]);
    expect(fireball.ranks[0]).toMatchObject({ cost: 30, castMs: 1500, rangeYd: 35 });
    expect(fireball.ranks[11]).toMatchObject({ cost: 410, castMs: 3500 });
  });

  it("rankAtLevel devuelve el mayor rango disponible", () => {
    expect(rankAtLevel(fireball, 1)!.rank).toBe(1);
    expect(rankAtLevel(fireball, 11)!.rank).toBe(2);
    expect(rankAtLevel(fireball, 60)!.rank).toBe(12);
    expect(rankAtLevel(findAbility(mage, "Explosión Arcana")!, 19)).toBeNull();
  });

  it("dano directo de Bola de fuego: rango 1 = 14-22, rango 12 = 425-541 (coincide con la referencia) con 100 % de poder con hechizos", () => {
    const r1 = fireball.ranks[0]!;
    expect(effectAt(r1.effects[0]!, r1, 1)).toMatchObject({ min: 14, max: 22 });
    const r12 = fireball.ranks[11]!;
    expect(effectAt(r12.effects[0]!, r12, 60)).toMatchObject({ min: 425, max: 541 });
    expect(r12.effects[0]!.coefficient).toBe(1);
  });

  it("Misiles Arcanos: el dano por segundo vive en el hechizo disparado y escala un 28,6 % del poder con hechizos", () => {
    const r8 = findAbility(mage, "Misiles Arcanos")!.ranks.at(-1)!;
    const tick = r8.effects.find((e) => e.kind === "direct-damage")!;
    expect(tick.viaSpellId).not.toBeNull();
    expect(tick.coefficient).toBeCloseTo(0.286, 3);
    expect(r8.channeled).toBe(true);
    expect(r8.durationMs).toBe(5000);
  });

  it("el enfriamiento sale de la categoria del hechizo (Traslacion 15 s, Bola de fuego sin enfriamiento)", () => {
    expect(findAbility(mage, "Traslación")!.ranks[0]!.cooldownMs).toBe(15000);
    expect(fireball.ranks[0]!.cooldownMs).toBeNull();
  });

  it("el dano directo calculado coincide (+-1) con la referencia en todos los rangos con 'X a Y' (a nivel min(60, nivel maximo))", () => {
    const byId = new Map<number, { rank: (typeof mage.abilities)[number]["ranks"][number] }>();
    for (const a of mage.abilities) for (const r of a.ranks) byId.set(r.spellId, { rank: r });
    let checked = 0;
    let ok = 0;
    const bad: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      if (!v.id || !v.d) continue;
      const hit = byId.get(v.id);
      const m = /(\d[\d,]*) to (\d[\d,]*) (?:\w+ )?damage/.exec(v.d);
      const effect = hit?.rank.effects.find((e) => e.kind === "direct-damage" && e.viaSpellId === null);
      if (!hit || !m || !effect) continue;
      checked++;
      const want = [Number(m[1]!.replace(/,/g, "")), Number(m[2]!.replace(/,/g, ""))];
      const got = effectAt(effect, hit.rank, Math.min(60, hit.rank.maxLevel ?? 60));
      if (Math.abs(got.min - want[0]!) <= 1 && Math.abs(got.max - want[1]!) <= 1) ok++;
      else bad.push(`${key}: La referencia ${want.join("-")} vs ${got.min}-${got.max}`);
    }
    expect(checked).toBeGreaterThanOrEqual(88); // 90 hasta el 70658: Explosión de Escarcha ya no se entrena (70685) y sus rangos salen del libro
    expect(bad, bad.slice(0, 8).join("; ")).toEqual([]);
    expect(ok).toBe(checked);
  });
});

describe("talentos como modificadores de habilidades (Mago)", () => {
  // Se carga la clase y se simulan builds
  const cls = JSON.parse(readFileSync(join(root, "data", "forever", "1.60.1.70685", "classes", "mage.json"), "utf8"));
  const idx = indexClass(ClassTalents.parse(cls));
  const nodeOf = (name: string) => idx.ordered.find((i) => i.talent.name === name)!.talent.nodeId;
  /** Build con esos talentos al rango maximo, saltandose los requisitos (solo para probar el calculo). */
  const full = (...names: string[]): Record<number, number> => Object.fromEntries(names.map((n) => [nodeOf(n), idx.ordered.find((i) => i.talent.name === n)!.talent.maxRank]));
  const fireball = findAbility(mage, "Bola de Fuego")!;
  const r12 = fireball.ranks[11]!;

  it("Acelerante (antes Bola de Fuego mejorada) 5/5 quita 0,5 s al lanzamiento de Bola de Fuego (3,5 s -> 3,0 s) y de Cólera Arcana, y no a otras", () => {
    const m = applyModifiers(r12, 60, spellModifiersOf(idx, full("Acelerante")));
    expect(m.castMs).toBe(3000);
    const flamestrike = findAbility(mage, "Fogonazo")!.ranks.at(-1)!;
    expect(applyModifiers(flamestrike, 60, spellModifiersOf(idx, full("Acelerante"))).castMs).toBe(flamestrike.castMs);
    // El 70685 suma Cólera Arcana a la máscara (36864 = 4096 + 32768)
    const wrath = findAbility(mage, "Cólera Arcana")!.ranks.at(-1)!;
    expect(applyModifiers(wrath, 60, spellModifiersOf(idx, full("Acelerante"))).castMs).toBe(wrath.castMs - 500);
  });

  it("Presencia mental hace instantaneos los hechizos que no son suyos pero no cuenta como pasivo (es una habilidad)", () => {
    expect(spellModifiersOf(idx, full("Presencia mental"))).toEqual([]);
  });

  it("Masa crítica 3/3 suma +6 % de critico (5 rangos y 10 % hasta el 70658) a Bola de Fuego, Explosion de Fuego y Fogonazo", () => {
    for (const n of ["Bola de Fuego", "Explosión de Fuego", "Fogonazo"]) {
      const rk = findAbility(mage, n)!.ranks.at(-1)!;
      expect(applyModifiers(rk, 60, spellModifiersOf(idx, full("Masa crítica"))).critChanceBonus, n).toBe(6);
    }
    const frostbolt = findAbility(mage, "Descarga de Escarcha")!.ranks.at(-1)!;
    expect(applyModifiers(frostbolt, 60, spellModifiersOf(idx, full("Masa crítica"))).critChanceBonus).toBe(0);
  });

  it("Canalización de Escarcha 3/3 baja el coste de Descarga de Escarcha un 15 %", () => {
    const rk = findAbility(mage, "Descarga de Escarcha")!.ranks.at(-1)!;
    const m = applyModifiers(rk, 60, spellModifiersOf(idx, full("Canalización de Escarcha")));
    expect(m.cost).toBe(Math.round(rk.cost! * 0.85));
  });

  it("Inestabilidad Arcana 3/3 sube un 3 % el daño de Descarga de Escarcha (media y coeficiente; Hielo penetrante, que daba el 6 %, se retiró el 20/10)", () => {
    const rk = findAbility(mage, "Descarga de Escarcha")!.ranks.at(-1)!;
    const m = applyModifiers(rk, 60, spellModifiersOf(idx, full("Inestabilidad Arcana")));
    const dmg = m.effects.find((e) => e.effect.kind === "direct-damage")!;
    expect(dmg.final.average).toBeCloseTo(dmg.base.average * 1.03, 6);
    expect(dmg.coefficient!).toBeCloseTo(dmg.effect.coefficient! * 1.03, 6);
  });

  it("Explosión de Fuego mejorada 2/2 baja 2 s el enfriamiento de Explosión de Fuego", () => {
    const rk = findAbility(mage, "Explosión de Fuego")!.ranks.at(-1)!;
    expect(applyModifiers(rk, 60, spellModifiersOf(idx, full("Explosión de Fuego mejorada"))).cooldownMs).toBe(rk.cooldownMs! - 2000);
  });

  it("sin talentos no cambia nada", () => {
    const m = applyModifiers(r12, 60, spellModifiersOf(idx, {}));
    expect(m.castMs).toBe(r12.castMs);
    expect(m.cost).toBe(r12.cost);
    expect(m.applied).toEqual([]);
  });
});
