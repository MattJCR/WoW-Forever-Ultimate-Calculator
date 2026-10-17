import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { addPoint, canAdd, canRemove, decodeBuild, encodeBuild, indexClass, removePoint, requiredLevel, totalPoints, validateBuild, type Build, type ClassIndex } from "../src/index.js";

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/forever/1.60.1.70425/classes");
const load = (file: string): ClassIndex => indexClass(ClassTalents.parse(JSON.parse(readFileSync(join(dataDir, `${file}.json`), "utf8"))));
const mage = load("mage");
const hunter = load("hunter");

const find = (idx: ClassIndex, spellId: number) => idx.ordered.find((i) => i.talent.spellId === spellId)!.talent;

/** Rellena con el primer talento anadible en orden hasta llegar a `n` puntos (o no poder mas). */
function fill(idx: ClassIndex, n: number): Build {
  let b: Build = {};
  while (totalPoints(b) < n) {
    const next = idx.ordered.find((i) => canAdd(idx, b, i.talent.nodeId).ok);
    if (!next) break;
    b = addPoint(idx, b, next.talent.nodeId);
  }
  return b;
}

describe("reglas de talentos (Mago, datos reales del cliente)", () => {
  it("un build vacio es valido y de nivel 1", () => {
    expect(validateBuild(mage, {}).ok).toBe(true);
    expect(requiredLevel(mage, 0)).toBe(1);
    expect(requiredLevel(mage, 1)).toBe(10);
    expect(requiredLevel(mage, 51)).toBe(60);
  });

  it("la fila 0 se puede gastar; la fila 1 exige 5 puntos arriba", () => {
    const wand = mage.ordered.find((i) => i.talent.row === 1 && i.specIndex === 0)!.talent;
    expect(canAdd(mage, {}, wand.nodeId)).toMatchObject({ ok: false, reason: "row-locked", detail: { missingPoints: 5 } });
    const row0 = mage.ordered.filter((i) => i.specIndex === 0 && i.talent.row === 0);
    const focus = row0.find((i) => i.talent.maxRank === 5)!.talent;
    let b: Build = {};
    for (let i = 0; i < 5; i++) b = addPoint(mage, b, focus.nodeId);
    expect(b[focus.nodeId]).toBe(5);
    expect(canAdd(mage, b, wand.nodeId).ok).toBe(true);
  });

  it("no se puede superar el rango maximo", () => {
    const t = mage.ordered.find((i) => i.talent.row === 0 && i.talent.maxRank === 2)!.talent;
    let b: Build = {};
    b = addPoint(mage, b, t.nodeId);
    b = addPoint(mage, b, t.nodeId);
    expect(canAdd(mage, b, t.nodeId)).toMatchObject({ ok: false, reason: "max-rank" });
  });

  it("el prerrequisito exige su rango maximo (Colera Arcana necesita Explosion Arcana)", () => {
    const blast = find(mage, 400574);
    const wrath = find(mage, 1326079);
    const b = fill(mage, 20);
    expect(totalPoints(b)).toBe(20);
    // sin Explosion Arcana al maximo no se puede Colera Arcana, aunque haya puntos suficientes
    expect(canAdd(mage, b, wrath.nodeId).ok).toBe(false);
    expect(blast.maxRank).toBe(1);
  });

  it("llega a 51 puntos y no deja gastar mas", () => {
    const b = fill(mage, 51);
    expect(totalPoints(b)).toBe(51);
    expect(validateBuild(mage, b).ok).toBe(true);
    const any = mage.ordered.find((i) => (b[i.talent.nodeId] ?? 0) < i.talent.maxRank)!;
    expect(canAdd(mage, b, any.talent.nodeId)).toMatchObject({ ok: false, reason: "no-points" });
  });

  it("no se puede quitar un punto del que dependen otros talentos", () => {
    const focus = mage.ordered.find((i) => i.specIndex === 0 && i.talent.row === 0 && i.talent.maxRank === 5)!.talent;
    let b: Build = {};
    for (let i = 0; i < 5; i++) b = addPoint(mage, b, focus.nodeId);
    const wand = mage.ordered.find((i) => i.specIndex === 0 && i.talent.row === 1)!.talent;
    b = addPoint(mage, b, wand.nodeId);
    expect(canRemove(mage, b, focus.nodeId)).toMatchObject({ ok: false, reason: "required-by-others" });
    expect(removePoint(mage, b, focus.nodeId)).toBe(b);
    // quitando primero el de abajo ya se puede
    const b2 = removePoint(mage, b, wand.nodeId);
    expect(canRemove(mage, b2, focus.nodeId).ok).toBe(true);
  });

  it("codifica y decodifica un build sin perder nada", () => {
    const b = fill(mage, 51);
    const code = encodeBuild(mage, b);
    expect(code).toMatch(/^[0-9]*-[0-9]*-[0-9]*$/);
    expect(decodeBuild(mage, code)).toEqual(b);
    expect(encodeBuild(mage, {})).toBe("--");
    expect(decodeBuild(mage, "--")).toEqual({});
  });

  it("rechaza codigos invalidos", () => {
    expect(decodeBuild(mage, "")).toBeNull();
    expect(decodeBuild(mage, "x--")).toBeNull();
    expect(decodeBuild(mage, "9--")).toBeNull(); // rango fuera de rango
    // un talento de fila 1 sin puntos arriba incumple la regla de 5 puntos por fila
    const arcane = mage.ordered.filter((i) => i.specIndex === 0);
    const i = arcane.findIndex((x) => x.talent.row === 1);
    expect(decodeBuild(mage, `${"0".repeat(i)}1--`)).toBeNull();
  });
});

describe("nodos no activos", () => {
  it("no son seleccionables ni se pueden quitar", () => {
    expect(hunter.data.inactiveTalents.length).toBe(2);
    for (const t of hunter.data.inactiveTalents) {
      expect(canAdd(hunter, {}, t.nodeId)).toMatchObject({ ok: false, reason: "inactive" });
      expect(canRemove(hunter, {}, t.nodeId)).toMatchObject({ ok: false, reason: "inactive" });
    }
  });

  it("un build que los incluya es invalido", () => {
    const id = hunter.data.inactiveTalents[0]!.nodeId;
    expect(validateBuild(hunter, { [id]: 1 }).ok).toBe(false);
  });
});
