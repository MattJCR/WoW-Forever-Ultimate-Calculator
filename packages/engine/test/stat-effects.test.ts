import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, Races } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { collectStatEffects, decodeBuild, indexClass, rankOf } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70450");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const mage = indexClass(ClassTalents.parse(json("classes/mage.json")));
const legacy = indexClass(ClassTalents.parse(json("legacy.json")));
const abilities = Abilities.parse(json("abilities/mage.json"));
const human = Races.parse(json("races.json")).races.find((r) => r.id === 1)!;

// Build de un usuario (Mago Humano, Escarcha/Fuego + Legacy completo)
const classBuild = decodeBuild(mage, "V229luA1E1B2A1A1C2B4C3E1C1E6C8B1E1E1C6B")!;
const legacyBuild = decodeBuild(legacy, "V22d3uE3E2B2B8B")!;

describe("suma de los efectos de talentos, Legacy y raza", () => {
  const fx = collectStatEffects({ cls: mage, classBuild, legacy, legacyBuild, race: human, abilities });
  const find = (category: string, label: string) => fx.totals.filter((t) => t.category === category && t.label === label);

  it("el build del usuario es valido y lleva los 51 + 16 puntos", () => {
    expect(Object.values(classBuild).reduce((a, b) => a + b, 0)).toBe(51);
    expect(Object.values(legacyBuild).reduce((a, b) => a + b, 0)).toBe(16);
  });

  it("suma el critico: +2 puntos de la raza a todo y +6 de Incineracion solo a Explosion de Fuego, Lanza de hielo, Explosion Arcana y Chamuscar", () => {
    const crit = find("Probabilidad de crítico", "probabilidad de crítico");
    expect(crit.find((t) => t.scope === null)?.value).toBe(2);
    const incin = crit.find((t) => t.scope !== null)!;
    expect(incin.value).toBe(6);
    expect(incin.scope!.sort()).toEqual(["Chamuscar", "Explosión Arcana", "Explosión de Fuego", "Explosión de Fuego (runa)", "Lanza de hielo"]);
    expect(incin.sources.map((s) => s.name)).toEqual(["Incineración"]);
  });

  it("suma el impacto (+6 de Enfoque elemental), y el bonus de daño critico (+100 % de Fragmentos de hielo); sin daño de Escarcha (Hielo penetrante se retiró el 20/10)", () => {
    expect(find("Probabilidad de impacto", "probabilidad de impacto")[0]!.value).toBe(6);
    expect(find("Bonus de daño crítico", "bonus de daño crítico").find((t) => t.scope !== null)!.value).toBe(100);
    expect(find("Daño y curación", "daño y curación")).toHaveLength(0);
  });

  it("tiempo de lanzamiento -0,5 s (Bola de Fuego mejorada) y alcance +6 m (Lanzallamas) con sus habilidades", () => {
    const cast = find("Tiempo de lanzamiento", "tiempo de lanzamiento")[0]!;
    expect(cast).toMatchObject({ value: -0.5, unit: "s" });
    expect(cast.scope).toEqual(expect.arrayContaining(["Bola de Fuego", "Descarga de Pirofrío"]));
    expect(find("Alcance y radio", "alcance").find((t) => t.unit === "m")!.value).toBe(6);
  });

  it("dos talentos con el mismo alcance se suman en una sola linea", () => {
    // Misma categoria, etiqueta, unidad y habilidades: una linea con dos fuentes
    const base = collectStatEffects({ cls: mage, classBuild, legacy, legacyBuild, race: human, abilities });
    const keys = base.totals.map((t) => [t.category, t.label, t.unit, t.scope?.join("|") ?? "*"].join("#"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lo que no se puede cuantificar se conserva con su texto (procs, efectos con condicion y habilidades activas)", () => {
    const names = fx.conditional.map((c) => c.source.name);
    expect(names).toEqual(expect.arrayContaining(["Tromba de misiles", "Ignición", "Maestro de los elementos", "Trizar", "Dedos de Escarcha", "Escalofrío del invierno", "Barrera de hielo", "Lanza de hielo"]));
    expect(fx.conditional.find((c) => c.source.name === "Barrera de hielo")!.active).toBe(true);
    for (const c of fx.conditional) expect(c.text.length).toBeGreaterThan(0);
  });

  it("cada talento escogido aparece en las cifras o en lo condicional (nada se descarta en silencio)", () => {
    const covered = new Set([...fx.totals.flatMap((t) => t.sources.map((s) => s.name)), ...fx.conditional.map((c) => c.source.name)]);
    for (const [idx, build] of [[mage, classBuild], [legacy, legacyBuild]] as const) {
      for (const { talent } of idx.ordered) if (rankOf(build, talent.nodeId) > 0) expect(covered.has(talent.name ?? ""), talent.name ?? "").toBe(true);
    }
  });

  it("los talentos activos (Poder Arcano, Presencia mental...) no suman", () => {
    const withActive = collectStatEffects({ cls: mage, classBuild: { ...classBuild, [mage.ordered.find((i) => i.talent.name === "Poder Arcano")!.talent.nodeId]: 1 }, legacy: null, legacyBuild: {}, race: null, abilities });
    expect(withActive.totals.flatMap((t) => t.sources).some((s) => s.name === "Poder Arcano")).toBe(false);
  });
});

describe("las auras que se clasifican coinciden con el texto del cliente (todas las clases)", () => {
  it("el valor de cada efecto clasificado aparece en la descripcion de su rango", () => {
    const classified = new Set([290, 137, 133, 134, 49, 47, 51, 79, 87, 10, 35, 54, 55, 240, 185, 186, 280, 168, 52, 30]);
    let n = 0;
    const bad: string[] = [];
    for (const file of ["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"]) {
      const c = ClassTalents.parse(json(`classes/${file}.json`));
      for (const sp of c.specs) for (const t of sp.talents) for (let r = 1; r <= t.maxRank; r++) for (const e of t.effectInfo) {
        if (!classified.has(e.aura)) continue;
        if (e.aura === 55 && t.effectInfo.some((x) => x.aura === 54)) continue; // gemelo del impacto cuerpo a cuerpo
        const v = t.rankValues[r - 1]?.[e.index];
        if (v === null || v === undefined) continue;
        n++;
        const a = Math.abs(v);
        const text = (t.descriptions[r - 1] ?? "").replace(/,/g, ".");
        const forms = [String(a), String(a / 1000)];
        if (!forms.some((f) => new RegExp(`(^|[^\d.])${f.replace(".", "\.")}([^\d]|$)`).test(text))) bad.push(`${t.name} r${r} A${e.aura}=${v}`);
      }
    }
    expect(n).toBeGreaterThan(150);
    expect(bad).toEqual([]);
  });
});
