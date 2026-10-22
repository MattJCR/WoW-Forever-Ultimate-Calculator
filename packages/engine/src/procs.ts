import type { ItemProc } from "@wfuc/schema";
import type { GearEffect } from "./gear.js";
import type { GearEffectSource } from "./gear-effects.js";
import type { SwingEstimate } from "./power-bonus.js";

/**
 * Procs del equipo (objetos, conjuntos, encantamientos): lo que se puede estimar sin un simulador de combate. **Estimación**: la
 * probabilidad, el enfriamiento y el daño del hechizo son del cliente (`client-db2`); los procs por minuto de los objetos antiguos, de
 * la comunidad (`community`: el cliente solo trae los de los hechizos nuevos). Solo cuentan los procs que hacen daño directo con una
 * tasa conocida y no son defensivos; el daño es el medio del hechizo, sin crítico, resistencias ni mitigación. Los procs que dan un
 * beneficio (poder de ataque, celeridad…) o cuya tasa no se conoce se quedan como texto del cliente.
 */

export interface ProcSource {
  name: string;
  /** Objeto, conjunto o encantamiento de donde sale. */
  origin: string;
  spellId: number;
  text: string;
  proc: ItemProc;
}

export interface ProcEstimate {
  source: ProcSource;
  /** Veces que se activa por segundo. */
  perSecond: number;
  damagePerProc: number;
  /** Daño por segundo (sin crítico ni mitigación). */
  dps: number;
  /** Cómo sale la cifra, en una línea. */
  basis: string;
  /** El enfriamiento interno limita la tasa. */
  capped: boolean;
}

/** Procs de los efectos de los objetos llevados (incluidos los de sus encantamientos) y de los bonos de conjunto activos. */
export function procSourcesOf(itemEffects: GearEffect[], setEffects: GearEffectSource[]): ProcSource[] {
  const out: ProcSource[] = [];
  const seen = new Set<string>();
  const add = (s: ProcSource, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const e of itemEffects) if (e.effect.proc) add({ name: e.effect.name || e.itemName, origin: e.itemName, spellId: e.effect.spellId, text: e.effect.text, proc: e.effect.proc }, `${e.slot}:${e.effect.spellId}`);
  for (const e of setEffects) if (e.kind === "set" && e.proc) add({ name: e.name, origin: e.origin, spellId: e.spellId, text: e.text, proc: e.proc }, `set:${e.spellId}`);
  return out;
}

export const hasKnownRate = (p: ItemProc): boolean => (p.ppm !== null && p.ppm > 0) || (p.chancePct !== null && p.chancePct > 0);

/** Procs que hacen daño directo con una tasa conocida; el resto no se puede estimar. */
export const isEstimable = (p: ItemProc): boolean => !p.onTaken && p.damage !== null && hasKnownRate(p);

/**
 * Estima los procs de daño: por minuto (`ppm / 60`, con la celeridad) o por probabilidad (`% × golpes por segundo` de todas las armas
 * cuerpo a cuerpo; sin armas no hay golpes y no se estima), limitados por el enfriamiento interno.
 */
export function estimateProcs(sources: ProcSource[], swings: SwingEstimate[], meleeHastePct: number): ProcEstimate[] {
  const meleeSwingsPerSecond = swings.filter((s) => s.hand !== "ranged").reduce((n, s) => n + 1 / s.hastedSpeed, 0);
  const out: ProcEstimate[] = [];
  for (const source of sources) {
    const p = source.proc;
    if (!isEstimable(p)) continue;
    let perSecond: number;
    let basis: string;
    if (p.ppm !== null && p.ppm > 0) {
      perSecond = (p.ppm / 60) * (1 + meleeHastePct / 100);
      basis = `${p.ppm} procs por minuto${meleeHastePct ? ` con ${Math.round(meleeHastePct * 10) / 10} % de celeridad` : ""}`;
    } else {
      if (meleeSwingsPerSecond === 0) continue;
      perSecond = ((p.chancePct ?? 0) / 100) * meleeSwingsPerSecond;
      basis = `${p.chancePct} % por golpe × ${Math.round(meleeSwingsPerSecond * 100) / 100} golpes por segundo`;
    }
    let capped = false;
    if (p.icdMs && perSecond > 1000 / p.icdMs) {
      perSecond = 1000 / p.icdMs;
      capped = true;
    }
    const damagePerProc = p.damage!.average;
    out.push({ source, perSecond, damagePerProc, dps: perSecond * damagePerProc, basis, capped });
  }
  return out;
}
