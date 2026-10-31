import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities } from "@wfuc/schema";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70707", "abilities");
const has = existsSync(D);

/**
 * AUDITORÍA (sesión 12): efectos de habilidades de clase que el motor NO convierte en daño, curación ni absorción (`kind: "other"`).
 * Son estados y efectos propios de la habilidad: formas, aspectos, auras de grupo, controles (miedo, aturdimiento, raíces), rastreo,
 * invocaciones, teletransportes, resurrecciones, cambios de velocidad, escudos con condiciones, procs y auras «dummy» (4, 42). Ninguno es
 * una estadística del personaje: los que sí lo son (atributos, armadura, poder de ataque, celeridad) se suman cuando vienen de talentos,
 * raza o equipo, no de habilidades activables. Se conservan con el texto del cliente (nada se descarta en silencio) y la lista es EXACTA:
 * si un parche añade un efecto nuevo la prueba falla y hay que decidir qué es.
 */
const KNOWN_AURAS = [
  1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 31, 33, 34, 36, 39, 41, 42, 43, 44, 45, 47, 49, 51, 52, 54, 56, 57,
  58, 60, 61, 64, 65, 66, 67, 68, 72, 74, 75, 77, 79, 80, 81, 82, 86, 87, 88, 91, 92, 94, 97, 99, 101, 103, 104, 105, 106, 107, 108, 110, 113, 115, 118, 120, 121, 124,
  127, 133, 134, 135, 136, 137, 140, 142, 149, 151, 161, 168, 174, 175, 184, 185, 197, 226, 227, 230, 232, 270, 271, 290, 319, 332, 342, 378, 466, 560, 562, 588, 668, 674,
];
/** Efectos sin aura (`SpellEffect.Effect`): invocaciones (28, 56, 97), creación de objetos (24, 94), disipación (38), portales y teletransportes (50, 252), resurrección (329), encantar arma (54/360)… */
const KNOWN_EFFECTS = [0, 1, 3, 8, 17, 19, 24, 28, 29, 30, 31, 32, 33, 38, 47, 50, 56, 58, 62, 63, 64, 67, 68, 69, 71, 72, 77, 79, 94, 96, 97, 101, 102, 104, 108, 109, 110, 114, 118, 121, 131, 136, 137, 142, 167, 179, 252, 329, 360];

describe.skipIf(!has)("auditoría: efectos de habilidades que no son daño, curación ni absorción", () => {
  const auras = new Set<number>();
  const effects = new Set<number>();
  let total = 0;
  let other = 0;
  for (const f of readdirSync(D)) {
    const abilities = Abilities.parse(JSON.parse(readFileSync(join(D, f), "utf8")));
    for (const a of abilities.abilities) {
      for (const r of a.ranks) {
        for (const e of r.effects) {
          total++;
          if (e.kind !== "other") continue;
          other++;
          if (e.aura) auras.add(e.aura);
          else effects.add(e.effect);
        }
      }
    }
  }

  it("las auras y los efectos que quedan como texto son exactamente los inventariados (115 auras y 50 efectos distintos)", () => {
    expect([...auras].sort((a, b) => a - b)).toEqual(KNOWN_AURAS);
    expect([...effects].sort((a, b) => a - b)).toEqual(KNOWN_EFFECTS);
  });

  it("la mayoría de los efectos de habilidades son estados y efectos auxiliares; los que calculan daño, curación y absorción son el resto", () => {
    expect(total).toBeGreaterThan(3400);
    expect(other).toBeGreaterThan(2400);
    expect(total - other).toBeGreaterThan(900);
  });
});
