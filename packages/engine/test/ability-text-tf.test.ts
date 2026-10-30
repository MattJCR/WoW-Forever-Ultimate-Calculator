import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { applyModifiers, renderAbilityText } from "../src/index.js";

/**
 * Contraste de los TEXTOS de las habilidades (con las cifras recalculadas al nivel 60, sin talentos) con los de la referencia (la referencia): cada
 * cifra del texto del cliente debe estar en el de la referencia y al reves. Las diferencias que quedan son conocidas (ver el segundo bloque).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CLASSES = ["warrior", "paladin", "rogue", "priest", "mage", "hunter", "shaman", "warlock", "druid"] as const;
const nums = (s: string) => [...s.replace(/\n/g, " ").replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((x) => x > 0);
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

function load(c: string) {
  const ab = Abilities.parse(JSON.parse(readFileSync(join(root, `data/forever/1.60.1.70685/abilities/${c}.json`), "utf8")));
  const tf = JSON.parse(readFileSync(join(root, `data/external/talentsforever/${c}.json`), "utf8")).spell_desc as Record<string, { id?: number; d?: string }>;
  const by = new Map<number, { name: string; rank: (typeof ab.abilities)[number]["ranks"][number] }>();
  for (const a of ab.abilities) for (const r of a.ranks) by.set(r.spellId, { name: a.name, rank: r });
  return { tf, by };
}

const textOf = (rank: Parameters<typeof renderAbilityText>[0]) => renderAbilityText(rank, applyModifiers(rank, 60, [])).map((p) => p.text).join("");

describe("textos de las habilidades frente a la referencia (nivel 60, sin talentos)", () => {
  // Hotfix del 20/10 (Mago): Barrera de hielo ×4 lleva el +3 % de daño de Escarcha y la referencia aún no; Cazador: Marca del cazador rango 4 (71 → 143, el cliente tenía un valor menor que el rango 3); Chamán: Ráfaga de lava rango 3 (+53 % → +20 % contra Choque de llamas, como los rangos 1 y 2).
  // Hotfixes del servidor posteriores a la referencia (el cliente manda): Fuego Sagrado rango 1 (18/10: 57-70 → 53-65, Sacerdote) y Amplificar maldición (16/10: Maldición de agotamiento 50 % → 20 %, Brujo).
  // Parche 70658 (la referencia declara el 70630, 27/10): Guerrero, Revancha ×6 (el cliente ahora suma poder de ataque a su daño; la referencia trae la cifra fija);
  // Cazador, Aspecto del halcón ×5 (20/35/50/70/90 → 15/22/30/38/47) y Aura de disparo certero ×4 (30/40/50/75 → 15/22/30/40). Sacerdote, Chamán y Brujo +1 cada uno
  // porque la referencia ya trae los hotfixes del servidor que antes la separaban.
  const EXPECTED: Record<string, [number, number]> = {
    warrior: [116, 110], paladin: [167, 143], rogue: [119, 98], priest: [238, 235], mage: [194, 186], hunter: [145, 110], shaman: [183, 182], warlock: [171, 166], druid: [207, 194],
  };
  for (const c of CLASSES) {
    it(`${c}: ${EXPECTED[c]![1]} de ${EXPECTED[c]![0]} textos con las mismas cifras`, () => {
      const { tf, by } = load(c);
      let total = 0;
      let same = 0;
      for (const v of Object.values(tf)) {
        const o = v.id ? by.get(v.id) : undefined;
        if (!o || !v.d) continue;
        const tfText = v.d
          .replace(/(\d+(?:\.\d+)?) hours?/g, (_m, n: string) => `${Number(n) * 60} min`)
          .replace(/(\d[\d,]*(?:\.\d+)?) to (\d[\d,]*(?:\.\d+)?)/g, (_m, a: string, b: string) => String((Number(a.replace(/,/g, "")) + Number(b.replace(/,/g, ""))) / 2));
        const ours = textOf(o.rank)
          .replace(/(\d+(?:[.,]\d+)?) a (\d+(?:[.,]\d+)?) p\./g, (_m, a: string, b: string) => `${(Number(a.replace(",", ".")) + Number(b.replace(",", "."))) / 2} p.`)
          .replace(/(\d+(?:,\d+)?) h\b/g, (_m, n: string) => `${Number(n.replace(",", ".")) * 60} min`);
        const A = nums(ours);
        const B = nums(tfText);
        total++;
        if (A.every((x) => B.some((y) => close(x, y))) && B.every((y) => A.some((x) => close(x, y)))) same++;
      }
      expect([total, same]).toEqual(EXPECTED[c]);
    });
  }
});

describe("diferencias conocidas con la referencia", () => {
  it("el extra de los ataques con «X % de daño de arma» (Golpe Sagrado, Mutilar, Puñalada, Contraataque, Triturar, Zarpa): La referencia muestra el valor del cliente × el % de arma", () => {
    const families: [string, string, RegExp][] = [
      ["paladin", "Holy Strike", /(\d+)% de daño con arma y ([\d,.]+) p\. más/],
      ["rogue", "Mutilate", /(\d+)% de daño de arma más ([\d,.]+) p\./],
      ["rogue", "Backstab", /(\d+)% de daño de arma más ([\d,.]+)/],
      ["hunter", "Counterattack", /(\d+)% de daño de arma más ([\d,.]+) p\./],
      ["druid", "Shred", /(\d+)% de daño y ([\d,.]+) al objetivo/],
    ];
    let checked = 0;
    for (const [c, name, re] of families) {
      const { tf, by } = load(c);
      for (const [key, v] of Object.entries(tf)) {
        if (!key.startsWith(`${c[0]!.toUpperCase()}${c.slice(1)}|${name}|Rank`) || !v.id || !v.d) continue;
        const o = by.get(v.id);
        const m = o && re.exec(o.rank.description.replace(/\n/g, " "));
        const t = /(?:plus|additional)\s+(?:an additional )?(\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))?/i.exec(v.d);
        const [lo, hi] = t ? [Number(t[1]), Number(t[2] ?? t[1])] : [0, 0];
        if (!m || !t) continue;
        const pct = Number(m[1]) / 100;
        const mine = Number(m[2]!.replace(",", "."));
        // El cliente da mine; la referencia da mine x pct (Backstab 150 % -> 1,5; Golpe Sagrado 50 % -> 0,5), con el redondeo de la referencia
        expect(mine * pct, `${key}: ${mine} x ${pct} vs la referencia ${lo}-${hi}`).toBeGreaterThanOrEqual(lo - 3);
        expect(mine * pct, `${key}: ${mine} x ${pct} vs la referencia ${lo}-${hi}`).toBeLessThanOrEqual(hi + 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it("Palabra de poder: escudo, Grito de guerra y las auras de otro hechizo escalan con el nivel como la referencia (antes salía el valor del rango base)", () => {
    const { tf: tfPri, by: byPri } = load("priest");
    const shield = byPri.get(tfPri["Priest|Power Word: Shield|Rank 2"]!.id!)!;
    expect(textOf(shield.rank)).toContain("92 p. de daño"); // La referencia 92; el rango base del cliente da 86
    const { tf: tfWar, by: byWar } = load("warrior");
    expect(textOf(byWar.get(tfWar["Warrior|Battle Shout|Rank 1"]!.id!)!.rank)).toContain("12 p."); // base 9
  });

  it("el total periódico usa la duración del hechizo que lleva el efecto: Lanzarse sangra 90 en 18 s aunque aturda 2 s (antes 10)", () => {
    const { tf, by } = load("druid");
    const pounce = by.get(tf["Druid|Pounce|Rank 1"]!.id!)!;
    expect(textOf(pounce.rank)).toContain("90 p. de daño durante 18 s");
  });
});
