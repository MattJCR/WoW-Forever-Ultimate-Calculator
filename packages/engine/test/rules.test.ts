import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClassTalents } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { addPoint, canAdd, canRemove, decodeBuild, decodeBuildReport, encodeBuild, indexClass, removePoint, requiredLevel, totalPoints, validateBuild, type Build, type ClassIndex } from "../src/index.js";

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/forever/1.60.1.70450/classes");
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

  it("codifica y decodifica un build sin perder nada (formato 2: por nodo)", () => {
    const b = fill(mage, 51);
    const code = encodeBuild(mage, b);
    expect(code).toMatch(/^V2([0-9a-z]+[A-E])+$/);
    expect(decodeBuild(mage, code)).toEqual(b);
    expect(decodeBuildReport(mage, code)).toMatchObject({ lost: [], malformed: false, legacyFormat: false });
    expect(encodeBuild(mage, {})).toBe("");
    expect(decodeBuild(mage, "")).toEqual({});
  });

  it("el codigo identifica cada talento por su nodo: no depende del orden ni de la rejilla", () => {
    const first = mage.ordered[0]!.talent;
    const code = encodeBuild(mage, { [first.nodeId]: 1 });
    expect(code).toBe(`V2${first.nodeId.toString(36)}A`);
    // dos talentos: el segundo va como diferencia con el primero
    const second = mage.ordered[1]!.talent;
    const [lo, hi] = [first.nodeId, second.nodeId].sort((a, b) => a - b);
    expect(encodeBuild(mage, { [first.nodeId]: 1, [second.nodeId]: 2 })).toBe(`V2${lo!.toString(36)}${lo === first.nodeId ? "A" : "B"}${(hi! - lo!).toString(36)}${hi === first.nodeId ? "A" : "B"}`);
  });

  it("un hotfix que quita un talento no descoloca los demas: se conservan y se cuenta lo perdido", () => {
    const b = fill(mage, 30);
    const code = encodeBuild(mage, b);
    const victim = mage.ordered.find((i) => b[i.talent.nodeId] && i.talent.row === 0 && i.specIndex === 0)!.talent;
    // mismos datos sin ese talento (como Hielo penetrante el 20/10)
    const data = JSON.parse(JSON.stringify(mage.data)) as typeof mage.data;
    for (const s of data.specs) s.talents = s.talents.filter((t) => t.nodeId !== victim.nodeId);
    const patched = indexClass(data);
    const r = decodeBuildReport(patched, code);
    expect(r.malformed).toBe(false);
    expect(r.lost.find((l) => l.nodeId === victim.nodeId)).toMatchObject({ name: null, wanted: b[victim.nodeId], kept: 0, reason: "removed" });
    // los talentos de las filas de arriba que dependian del quitado pueden perderse; el resto se conserva con su rango exacto
    expect(totalPoints(r.build)).toBeGreaterThan(0);
    expect(validateBuild(patched, r.build).ok).toBe(true);
    for (const [id, rank] of Object.entries(r.build)) expect(rank).toBe(b[Number(id)]);
    expect(decodeBuild(patched, code)).toBeNull(); // la lectura estricta no acepta perdidas
  });

  it("recorta un rango que bajo (Enfoque elemental 5 -> 3) y avisa", () => {
    const t = mage.ordered.find((i) => i.talent.maxRank >= 3 && i.talent.row === 0)!.talent;
    const data = JSON.parse(JSON.stringify(mage.data)) as typeof mage.data;
    for (const s of data.specs) for (const x of s.talents) if (x.nodeId === t.nodeId) x.maxRank = 2;
    const r = decodeBuildReport(indexClass(data), encodeBuild(mage, { [t.nodeId]: 3 }));
    expect(r.build[t.nodeId]).toBe(2);
    expect(r.lost).toEqual([{ nodeId: t.nodeId, name: t.name ?? null, wanted: 3, kept: 2, reason: "max-rank-lowered" }]);
  });

  it("rechaza lo que no es un codigo y lo que no cumple las reglas", () => {
    expect(decodeBuildReport(mage, "x--").malformed).toBe(true);
    expect(decodeBuildReport(mage, "V2zz").malformed).toBe(true);
    expect(decodeBuild(mage, "x--")).toBeNull();
    // un talento de fila 1 sin puntos arriba: se descarta y se avisa en vez de invalidar todo el enlace
    const row1 = mage.ordered.find((i) => i.specIndex === 0 && i.talent.row === 1)!.talent;
    const r = decodeBuildReport(mage, encodeBuild(mage, { [row1.nodeId]: 1 }));
    expect(r.build).toEqual({});
    expect(r.lost).toMatchObject([{ nodeId: row1.nodeId, wanted: 1, kept: 0, reason: "row-locked" }]);
  });

  it("sigue leyendo los codigos del formato 1 (un digito por posicion) si encajan con los datos", () => {
    const b = fill(mage, 20);
    const old = ["0", "1", "2"].map((s) => mage.ordered.filter((i) => i.specIndex === Number(s)).map((i) => b[i.talent.nodeId] ?? 0).join("").replace(/0+$/, "")).join("-");
    const r = decodeBuildReport(mage, old);
    expect(r).toMatchObject({ legacyFormat: true, malformed: false, lost: [] });
    expect(r.build).toEqual(b);
    expect(decodeBuild(mage, "--")).toEqual({});
    expect(decodeBuildReport(mage, "9--").lost[0]).toMatchObject({ reason: "max-rank-lowered" });
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
