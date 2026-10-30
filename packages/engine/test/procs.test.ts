import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Items } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { deriveCombatStats, deriveStats, estimateProcs, hasKnownRate, isEstimable, procSourcesOf, type GearEffect, type SwingEstimate } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70685");
const has = existsSync(join(D, "items.json"));
const swing = (hand: SwingEstimate["hand"], speed: number): SwingEstimate => ({ hand, min: 100, max: 100, average: 100, speed, hastedSpeed: speed, dps: 100 / speed, formula: "" });

/** Procs del equipo (sesión 12): tasa y daño del cliente, procs por minuto de los objetos antiguos de la comunidad; solo los de daño con tasa conocida se estiman. */
describe.skipIf(!has)("procs del equipo", () => {
  const items = Items.parse(JSON.parse(readFileSync(join(D, "items.json"), "utf8")));
  const effectsOf = (id: number): GearEffect[] => items.items.find((i) => i.id === id)!.effects.map((effect) => ({ slot: "mainHand" as const, itemName: "x", effect }));

  it("Trueno furioso: 6 procs por minuto de 300 de daño de Naturaleza (comunidad + cliente) = 30 de daño por segundo", () => {
    const sources = procSourcesOf(effectsOf(19019), []);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.proc).toMatchObject({ ppm: 6, onTaken: false, source: "community" });
    expect(sources[0]!.proc.damage).toEqual({ average: 300, schoolMask: 8 });
    const [e] = estimateProcs(sources, [swing("main", 1.9)], 0);
    expect(e!.perSecond).toBeCloseTo(0.1, 5);
    expect(e!.dps).toBeCloseTo(30, 5);
    // la celeridad sube los procs por minuto
    expect(estimateProcs(sources, [swing("main", 1.9)], 10)[0]!.dps).toBeCloseTo(33, 5);
  });

  it("un proc por probabilidad usa los golpes por segundo de las armas cuerpo a cuerpo (no la distancia) y respeta el enfriamiento interno", () => {
    const base = procSourcesOf(effectsOf(19019), [])[0]!;
    const byChance = { ...base, proc: { ...base.proc, ppm: null, chancePct: 10, icdMs: null, source: "client-db2" as const } };
    const swings = [swing("main", 2), swing("off", 2), swing("ranged", 2)];
    expect(estimateProcs([byChance], swings, 0)[0]!.perSecond).toBeCloseTo(0.1 * 1, 5); // 10 % × (0,5 + 0,5)
    expect(estimateProcs([byChance], [swing("ranged", 2)], 0)).toEqual([]);
    const capped = { ...byChance, proc: { ...byChance.proc, chancePct: 90, icdMs: 5000 } };
    const est = estimateProcs([capped], [swing("main", 1)], 0)[0]!;
    expect(est.capped).toBe(true);
    expect(est.perSecond).toBeCloseTo(0.2, 5);
  });

  it("los defensivos, los sin daño y los de tasa desconocida no se estiman", () => {
    const all = items.items.flatMap((i) => i.effects.filter((e) => e.proc).map((e) => e.proc!));
    expect(all.length).toBeGreaterThan(250);
    expect(all.filter((p) => p.onTaken && isEstimable(p))).toEqual([]);
    expect(all.filter((p) => isEstimable(p)).every((p) => hasKnownRate(p) && p.damage !== null)).toBe(true);
    expect(all.filter(isEstimable).length).toBeGreaterThanOrEqual(40); // 40 hoy: el resto de procs no trae tasa conocida
  });

  it("aparecen como filas de «Armas» con su nota", () => {
    const sources = procSourcesOf(effectsOf(19019), []);
    const procs = estimateProcs(sources, [swing("main", 1.9)], 0);
    const flat = deriveStats({ attributes: [100, 100, 100, 100, 100], hpBase: 0, manaBase: 0, totals: [] });
    const rows = deriveCombatStats({ derived: flat, totals: [], classStats: null, procs }).rows;
    const row = rows.find((r) => r.key.startsWith("proc-"))!;
    expect(row).toMatchObject({ group: "Armas", value: 30 });
    expect(row.label).toContain("daño por segundo");
    expect(row.note).toContain("6 procs por minuto");
  });
});
