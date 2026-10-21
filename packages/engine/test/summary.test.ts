import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { addPoint, canAdd, characterRequiredLevel, decodeBuild, firstPointLevel, encodeBuild, formatBuildForAI, indexClass, summarizeCharacter, totalPoints, validateBuild, type Build, type ClassIndex } from "../src/index.js";

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/forever/1.60.1.70450");
const load = (file: string): ClassIndex => indexClass(ClassTalents.parse(JSON.parse(readFileSync(join(dataDir, file), "utf8"))));
const mage = load("classes/mage.json");
const legacy = load("legacy.json");

function fill(idx: ClassIndex, n: number, from: Build = {}): Build {
  let b = from;
  while (totalPoints(b) < n) {
    const next = idx.ordered.find((i) => canAdd(idx, b, i.talent.nodeId).ok);
    if (!next) break;
    b = addPoint(idx, b, next.talent.nodeId);
  }
  return b;
}
const byName = (idx: ClassIndex, name: string) => idx.ordered.find((i) => i.talent.name === name)!.talent;

describe("Legacy como calculadora (16 puntos, ventajas de cuenta)", () => {
  it("son 3 arboles de 9 ventajas con 16 puntos y sin dependencia del nivel", () => {
    expect(legacy.data.kind).toBe("legacy");
    expect(legacy.data.specs.map((s) => [s.name, s.talents.length])).toEqual([
      ["Aventura", 9],
      ["Recursos", 9],
      ["Profesiones", 9],
    ]);
    expect(legacy.data.rules.maxPoints).toBe(16);
    expect(legacy.data.rules.firstPointLevel).toBeNull();
  });

  it("el requisito de 5 puntos cuenta todo el arbol, no las filas de arriba (Talentoso)", () => {
    const talentoso = byName(legacy, "Talentoso");
    expect(talentoso.gate?.points).toBe(5);
    expect(talentoso.gate!.fromNodeIds.length).toBeGreaterThan(5);
    expect(canAdd(legacy, {}, talentoso.nodeId)).toMatchObject({ ok: false });
    // 5 puntos en Bien descansado (rango maximo = prerrequisito de Talentoso) desbloquean Talentoso
    const rested = byName(legacy, "Bien descansado");
    let b: Build = {};
    for (let i = 0; i < 5; i++) b = addPoint(legacy, b, rested.nodeId);
    expect(canAdd(legacy, b, talentoso.nodeId).ok).toBe(true);
  });

  it("no deja pasar de 16 puntos y el build es valido y codificable", () => {
    const b = fill(legacy, 99);
    expect(totalPoints(b)).toBe(16);
    expect(validateBuild(legacy, b).ok).toBe(true);
    expect(decodeBuild(legacy, encodeBuild(legacy, b))).toEqual(b);
  });
});

describe("personaje = clase + Legacy", () => {
  it("suma los puntos de cada parte y el nivel solo depende de los de clase", () => {
    const c = fill(mage, 24);
    const l = fill(legacy, 7);
    const s = summarizeCharacter(mage, c, legacy, l);
    expect(s.classPoints).toBe(24);
    expect(s.legacyPoints).toBe(7);
    expect(s.requiredLevel).toBe(33); // primer punto al nivel 10 -> 9 + 24
    expect(s.treePoints.reduce((a, b) => a + b, 0)).toBe(24);
    expect(s.selected.filter((x) => x.source === "class").reduce((n, x) => n + x.rank, 0)).toBe(24);
    expect(s.selected.filter((x) => x.source === "legacy").reduce((n, x) => n + x.rank, 0)).toBe(7);
  });

  it("los talentos escogidos llevan el texto del rango elegido", () => {
    const focus = byName(mage, "Enfoque Arcano");
    let b: Build = {};
    for (let i = 0; i < 3; i++) b = addPoint(mage, b, focus.nodeId);
    const s = summarizeCharacter(mage, b, null, {});
    expect(s.selected).toHaveLength(1);
    expect(s.selected[0]).toMatchObject({ source: "class", name: "Enfoque Arcano", rank: 3, maxRank: 5 });
    expect(s.selected[0]!.text).toContain("3%");
  });
});

describe("Talentoso (Legacy) adelanta el primer punto de talento", () => {
  /** Talentoso al rango r (necesita Bien descansado al maximo). */
  function withTalented(rank: number): Build {
    let b: Build = {};
    const rested = byName(legacy, "Bien descansado");
    for (let i = 0; i < 5; i++) b = addPoint(legacy, b, rested.nodeId);
    const talented = byName(legacy, "Talentoso");
    for (let i = 0; i < rank; i++) b = addPoint(legacy, b, talented.nodeId);
    return b;
  }

  it("el texto de cada rango sale de su propia entrada: nivel 9, 8, 7, 6, 5", () => {
    const t = byName(legacy, "Talentoso");
    expect(t.maxRank).toBe(5);
    expect(t.descriptions.map((d) => /nivel (\d+),/.exec(d)![1])).toEqual(["9", "8", "7", "6", "5"]);
    expect(t.rankValues.map((v) => v[0])).toEqual([9, 8, 7, 6, 5]);
  });

  it("sin Talentoso el primer punto es al nivel 10; con cada rango baja un nivel", () => {
    expect(firstPointLevel(mage, legacy, {})).toEqual({ level: 10, fromLegacy: false });
    for (let r = 1; r <= 5; r++) expect(firstPointLevel(mage, legacy, withTalented(r))).toEqual({ level: 10 - r, fromLegacy: true });
  });

  it("el nivel necesario de los talentos de clase baja en consecuencia (24 puntos: 33 -> 28)", () => {
    expect(characterRequiredLevel(mage, 24, legacy, {})).toBe(33);
    expect(characterRequiredLevel(mage, 24, legacy, withTalented(5))).toBe(28);
    expect(characterRequiredLevel(mage, 51, legacy, withTalented(5))).toBe(55); // sigue sin pasar de 51 puntos
    expect(characterRequiredLevel(mage, 0, legacy, withTalented(5))).toBe(1);
  });

  it("el resumen del personaje lo refleja y el texto para IA lo explica", () => {
    const c = fill(mage, 24);
    const l = withTalented(5);
    const s = summarizeCharacter(mage, c, legacy, l);
    expect(s).toMatchObject({ requiredLevel: 28, firstPointLevel: 5, firstPointFromLegacy: true });
    const text = formatBuildForAI({ cls: mage, classBuild: c, legacy, legacyBuild: l, link: "x", hotfixesApplied: true })!;
    expect(text).toContain("level 28 needed");
    expect(text).toContain("thanks to the Legacy perk Talented");
  });
});

describe("Copiar build para IA", () => {
  const base = { cls: mage, legacy, link: "https://example.test/#/class/mage?b=x", hotfixesApplied: true };

  it("no genera nada si no hay puntos", () => {
    expect(formatBuildForAI({ ...base, classBuild: {}, legacyBuild: {} })).toBeNull();
  });

  it("incluye cabecera, un bloque por arbol con el texto de cada talento, Legacy y notas", () => {
    const c = fill(mage, 12);
    const l = fill(legacy, 5);
    const text = formatBuildForAI({ ...base, classBuild: c, legacyBuild: l, raceName: "Humano", dataLink: "https://example.test/data/classes/mage.json" })!;
    expect(text).toMatch(/^WoW Forever Humano Mago talent build: \d+\/\d+\/\d+ \(Arcano \/ Fuego \/ Escarcha\), level 21 needed/);
    expect(text).toContain("12/51 class points spent, 5/16 Legacy points spent");
    expect(text).toContain("Arcano (");
    expect(text).toMatch(/- Enfoque Arcano \d\/5: Aumenta un \d%/);
    expect(text).toContain("Legacy perks (5/16 points");
    expect(text).toContain("https://example.test/#/class/mage?b=x");
    expect(text).toContain("Notes: each line is the in-game tooltip at the rank chosen");
    expect(text).toContain("Full data for this class");
    expect(text).not.toContain("\n\n\n");
  });

  it("anade las habilidades raciales de la raza escogida", () => {
    const c = fill(mage, 12);
    const text = formatBuildForAI({
      ...base,
      classBuild: c,
      legacyBuild: {},
      raceName: "Humano",
      racials: [{ name: "Crueldad", kind: "passive", description: "Aumenta la probabilidad de golpe crítico un 2%." }],
    })!;
    expect(text).toContain("Racial abilities (Humano;");
    expect(text).toContain("- Crueldad (passive): Aumenta la probabilidad de golpe crítico un 2%.");
    expect(formatBuildForAI({ ...base, classBuild: c, legacyBuild: {} })!).not.toContain("Racial abilities");
  });

  it("avisa de los valores base que dependen del nivel", () => {
    // Explosion Arcana depende del nivel: hace falta llegar hasta ella
    const c = fill(mage, 40);
    const blast = byName(mage, "Explosión Arcana");
    const text = formatBuildForAI({ ...base, classBuild: c, legacyBuild: {} })!;
    if ((c[blast.nodeId] ?? 0) > 0) expect(text).toContain("(base values)");
    expect(text).toContain("class points spent");
  });
});

describe("Copiar build para IA con equipo", () => {
  const base = { cls: mage, classBuild: {}, legacy: null, legacyBuild: {}, link: "https://example.test/#/class/mage", hotfixesApplied: true };
  it("sin puntos ni equipo no hay texto; con solo equipo sí, y las líneas van antes de las notas", () => {
    expect(formatBuildForAI(base)).toBeNull();
    const text = formatBuildForAI({ ...base, gearLines: ["Equipment (test)", "- Cabeza: Gorro", ""] })!;
    expect(text).toContain("- Cabeza: Gorro");
    expect(text.indexOf("Equipment (test)")).toBeLessThan(text.indexOf("Notes:"));
  });
});
