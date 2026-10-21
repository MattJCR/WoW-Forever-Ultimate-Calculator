import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { allModifiersFor, applyModifiers, canCrit, collectStatEffects, dealsDamage, findAbility, healsTarget, indexClass, rankAtLevel, renderAbilityText, spellModifiersOf, type Build } from "../src/index.js";

/**
 * CRITERIO COMUN para revisar TODAS las habilidades de TODAS las clases (docs/STATUS.md › «Criterio de revisión»):
 *  1. Un talento pasivo que modifica habilidades llega a las que su máscara de clase cruza, en la propia habilidad o en el hechizo que
 *     de verdad hace el efecto (el veneno, no la habilidad que lo aplica; el golpe de arma de Mutilar).
 *  2. La mejora se ve en la descripción de la habilidad (daño, daño periódico, % de daño de arma, efecto 1/2/3, duración…).
 *  3. Las habilidades que el texto del talento nombra y su máscara no cruza quedan listadas aquí (decisión pendiente, no silencio).
 *  4. El crítico solo cuenta en lo que hace daño o sana.
 * Cada lista de abajo es EXACTA: si cambia (para bien o para mal) la prueba falla y obliga a revisarla.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70450");
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));
const classes = readdirSync(join(D, "classes")).map((f) => {
  const token = f.replace(".json", "");
  return { token, cls: indexClass(ClassTalents.parse(json(`classes/${f}`))), abilities: Abilities.parse(json(`abilities/${f}`)), rules: TalentRules.parse(json(`rules/${f}`)) };
});
const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
const only = (cls: ReturnType<typeof indexClass>, name: string): Build => {
  const t = cls.ordered.find((i) => i.talent.name === name)!.talent;
  return { [t.nodeId]: t.maxRank };
};
const byToken = (token: string) => classes.find((c) => c.token === token)!;
const rogue = byToken("rogue");
const textOf = (c: (typeof classes)[number], talent: string, ability: string): { base: string; mod: string } => {
  const r = rankAtLevel(findAbility(c.abilities, ability)!, 60)!;
  const mods = spellModifiersOf(c.cls, only(c.cls, talent));
  return { base: text(renderAbilityText(r, applyModifiers(r, 60, []))), mod: text(renderAbilityText(r, applyModifiers(r, 60, mods))) };
};

describe("la mejora de un talento se ve en la descripción de la habilidad (las 9 clases)", () => {
  // Combinaciones talento → habilidad (daño/sanación, nivel 60, talento al máximo) cuyo texto NO cambia, con el motivo
  const UNCHANGED: Record<string, string> = {
    "druid: Génesis → Arreglo rápido": "el texto no lleva cifra (la sanación se calcula con los efectos de otro hechizo)",
    "druid: Regalo de la Naturaleza → Arreglo rápido": "el texto no lleva cifra (la sanación se calcula con los efectos de otro hechizo)",
    "hunter: Picaduras mejoradas → Disparo de quimera": "la cifra es un % del daño de la Picadura: el talento sube la Picadura, no esta cifra",
    "hunter: Aluvión → Multidisparo": "el daño de Multidisparo lo calcula el juego (efecto de arma sin cifra en el texto)",
    "mage: Escarcha permanente → Orbe congelado": "la ralentización del texto es una cifra escrita en el texto del cliente (30 %), no un hueco",
    "priest: Disciplinas gemelas → Rezo de alivio (runa)": "valores del texto del cliente sin resolver (…)",
    "priest: Curación espiritual → Plan de contingencia": "la sanación de 670 es de otro hechizo (1277460) cuya máscara no cruza la del talento; el escudo es una absorción. Disciplinas gemelas sí llega (+5 %)",
    "shaman: Armas elementales → Arma lengua de Fuego": "el daño es una fórmula con la velocidad del arma (efecto dummy): el +15 % no se aplica al texto",
  };

  it("lista exacta de combinaciones sin cambio en el texto", () => {
    const found: string[] = [];
    let checked = 0;
    for (const c of classes) {
      for (const { talent } of c.cls.ordered) {
        if (!talent.passive) continue;
        const mods = spellModifiersOf(c.cls, { [talent.nodeId]: talent.maxRank }).filter((m) => [0, 8, 22, 3, 12, 23].includes(m.op));
        if (mods.length === 0) continue;
        for (const a of c.abilities.abilities) {
          const r = rankAtLevel(a, 60);
          if (!r || !(dealsDamage(r) || healsTarget(r)) || allModifiersFor(r, mods).length === 0) continue;
          checked++;
          const base = text(renderAbilityText(r, applyModifiers(r, 60, [])));
          if (text(renderAbilityText(r, applyModifiers(r, 60, mods))) === base) found.push(`${c.token}: ${talent.name} → ${a.name}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(found.sort()).toEqual(Object.keys(UNCHANGED).sort());
  });

  it("Venenos inmundos (+20 % de daño de venenos): el daño vive en el hechizo que aplica el veneno, no en la habilidad", () => {
    const inst = textOf(rogue, "Venenos inmundos", "Veneno instantáneo");
    expect(inst.base).toContain("88 p. de daño");
    expect(inst.mod).toContain("106 p. de daño");
    const mortal = textOf(rogue, "Venenos inmundos", "Veneno mortal");
    expect(mortal.base).toContain("92 p. de daño");
    expect(mortal.mod).toContain("110 p. de daño");
    // cada veneno cruza su propia máscara: el directo (op 0) llega al instantáneo y el periódico (op 22) al mortal, ambos con +20 %
    const ratio = (name: string) =>
      applyModifiers(rankAtLevel(findAbility(rogue.abilities, name)!, 60)!, 60, spellModifiersOf(rogue.cls, only(rogue.cls, "Venenos inmundos"))).effects.map((e) => Math.round((e.final.average / e.base.average) * 100));
    expect(ratio("Veneno instantáneo")).toEqual([120]);
    expect(ratio("Veneno mortal")).toEqual([120]);
  });

  it("«X % de daño de arma»: el % de los talentos se aplica una sola vez (Puñalada y Mutilar)", () => {
    expect(textOf(rogue, "Oportunidad", "Puñalada").base).toContain("150% de daño de arma más 150");
    expect(textOf(rogue, "Oportunidad", "Puñalada").mod).toContain("165% de daño de arma más 165");
    const mutilar = textOf(rogue, "Oportunidad", "Mutilar");
    expect(mutilar.base).toContain("75% de daño de arma más 50,25 p.");
    // 50,25 x 1,1 = 55,28 (no 60,8: el 10 % no se aplica al porcentaje y al daño plano a la vez)
    expect(mutilar.mod).toContain("82,5% de daño de arma más 55,28 p.");
  });

  it("Mutilar recibe los talentos pasivos que la nombran (Sangre fría es activo y no suma de forma permanente) porque su daño vive en un hechizo con la máscara que ellos usan", () => {
    const r = rankAtLevel(findAbility(rogue.abilities, "Mutilar")!, 60)!;
    const n = (talent: string) => allModifiersFor(r, spellModifiersOf(rogue.cls, only(rogue.cls, talent))).length;
    for (const t of ["Oportunidad", "Letalidad", "Heridas punzantes"]) expect(n(t), t).toBeGreaterThan(0);
    // Heridas punzantes: +30 % de crítico a Puñalada y +15 % a Mutilar (su efecto propio)
    const crit = (ability: string) => applyModifiers(rankAtLevel(findAbility(rogue.abilities, ability)!, 60)!, 60, spellModifiersOf(rogue.cls, only(rogue.cls, "Heridas punzantes"))).critChanceBonus;
    expect(crit("Puñalada")).toBe(30);
    expect(crit("Mutilar")).toBe(15);
  });

  it("los puntos planos de un talento (aura 107) se suman al daño plano de arma, nunca al porcentaje del arma", () => {
    const r = rankAtLevel(findAbility(rogue.abilities, "Mutilar")!, 60)!;
    const flat = { source: { name: "t", spellId: 1, nodeId: 1, rank: 1, maxRank: 1 }, kind: "flat" as const, op: 0, value: 10, mask: [0, 2, 0, 0] };
    const m = applyModifiers(r, 60, [flat]);
    const pct = m.weaponEffects.find((e) => e.effect.effect === 31)!;
    const plain = m.weaponEffects.find((e) => e.effect.effect === 121)!;
    expect(pct.final.average).toBe(pct.base.average);
    expect(plain.final.average).toBe(plain.base.average + 10);
  });

  it("Escarcha permanente (+33 % de duración del escalofrío, −10 puntos de velocidad): cambia el porcentaje y la duración del texto", () => {
    const t = textOf(byToken("mage"), "Escarcha permanente", "Descarga de Escarcha");
    expect(t.base).toContain("reduce un 40% su velocidad de movimiento durante 9 s");
    expect(t.mod).toContain("reduce un 50% su velocidad de movimiento durante 12 s");
  });

  it("Espiral mortal (efecto 9, drenar salud) cuenta como daño y recibe Maestría de las Sombras (+10 %)", () => {
    const t = textOf(byToken("warlock"), "Maestría de las Sombras", "Espiral mortal");
    expect(t.base).toContain("causa 460 p. de daño");
    expect(t.mod).toContain("causa 506 p. de daño");
  });

  it("sin talentos el texto es el del cliente: ningún efecto sale modificado", () => {
    for (const c of classes) {
      for (const a of c.abilities.abilities) {
        const r = rankAtLevel(a, 60);
        if (!r) continue;
        const m = applyModifiers(r, 60, []);
        for (const e of [...m.effects, ...m.weaponEffects, ...m.otherEffects]) expect(e.final.average, `${c.token}: ${a.name}`).toBe(e.base.average);
      }
    }
  });
});

describe("el crítico solo cuenta en lo que hace daño o sana", () => {
  it("Robar (Pícaro) no puede ser crítico y los ataques sí", () => {
    expect(canCrit(rankAtLevel(findAbility(rogue.abilities, "Robar")!, 60)!)).toBe(false);
    expect(canCrit(rankAtLevel(findAbility(rogue.abilities, "Puñalada")!, 60)!)).toBe(true);
    expect(canCrit(rankAtLevel(findAbility(byToken("warlock").abilities, "Espiral mortal")!, 60)!)).toBe(true);
  });
});

describe("habilidades que el texto de un talento nombra y su máscara (propia o del hechizo que la lleva) no cruza", () => {
  // Unión de las máscaras de los efectos 107/108 del talento frente a las habilidades cuyo nombre (5+ letras) aparece en su texto.
  // «REAL» = el cliente no las incluye aunque el texto las nombre (decidir con el usuario / confirmar en el juego); «ruido» = el texto
  // nombra la habilidad como condición o es una palabra genérica (Venenos, Amenaza, Sentencia, formas…) y no es un hueco.
  const KNOWN: Record<string, string> = {
    // Hotfix del 16/10 (cliente 70450): el talento ahora lleva dos efectos, el 0 con la máscara de Maldición de debilidad y el 1 (op. 8, −20) con la de
    // Maldición de agotamiento (que sube su máscara a [4194304,0,262144,0]); el hueco anterior de Agotamiento queda cerrado. Terror de agonía ya no
    // va por la máscara del talento: el propio hechizo trae un efecto 271 (valor $w2 que rellena el juego al activar el talento, que es ACTIVO).
    "warlock: Amplificar maldición → Terror de agonía": "ruido: el mecanismo es un efecto 271 del propio Terror de agonía (valor en tiempo de ejecución); el talento es activo y no entra en el cálculo permanente",
    "hunter: Matanza rápida → Picadura de serpiente": "ruido: Picadura de serpiente es la condición, no la habilidad modificada",
    "paladin: Sellos mejorados → Sentencia": "ruido: Sentencia no hace daño; el daño está en el hechizo del sello",
    "paladin: Enjuiciador Sagrado → Sentencia": "ruido: idem",
    "paladin: Furia justa mejorada → Furia recta": "ruido: Furia recta es la condición («mientras está activa»)",
    "paladin: Credo férreo → Furia recta": "ruido: idem",
    "paladin: Instrumento de la ley → Furia recta": "ruido: idem",
    "rogue: Venenos inmundos → Veneno": "ruido: palabra genérica (los venenos concretos sí están cubiertos)",
    "rogue: Venenos inmundos → Venenos": "ruido: palabra genérica",
    "rogue: Venenos mejorados → Veneno": "ruido: palabra genérica",
    "rogue: Venenos mejorados → Venenos": "ruido: palabra genérica",
    "rogue: Golpe a los riñones mejorado → Veneno": "ruido: palabra genérica",
    "rogue: Golpe a los riñones mejorado → Venenos": "ruido: palabra genérica",
    "rogue: Veneno → Veneno": "ruido: el talento se llama así",
    "rogue: Veneno → Venenos": "ruido: palabra genérica",
    "rogue: Distraer mejorado → Sigilo": "ruido: «detección de sigilo», no la habilidad Sigilo",
    "priest: Forma de las Sombras → Forma de las Sombras": "ruido: el talento se llama así",
    "mage: Nova de Escarcha mejorada → Regeneración": "ruido: palabra genérica",
    "warlock: Cauce de salud mejorado → Amenaza": "ruido: palabra genérica",
    "warlock: Marca demoníaca → Amenaza": "ruido: palabra genérica",
    "warlock: Secuelas → Conflagrar": "ruido: Conflagrar solo recibe un aturdimiento (aura 42), sin cifra de daño",
    "druid: Rabia → Forma de oso": "ruido: formas, son condiciones",
    "druid: Rabia → Forma felina": "ruido: formas, son condiciones",
  };

  it("lista exacta (propia o por hechizo disparado)", () => {
    const masksIntersect = (a: number[], b: number[]) => a.some((m, i) => m !== 0 && (m & (b[i] ?? 0)) !== 0);
    const gaps: string[] = [];
    for (const c of classes) {
      for (const { talent: t } of c.cls.ordered) {
        const effs = t.effectInfo.filter((e) => (e.aura === 107 || e.aura === 108) && e.classMask.some((m) => m !== 0));
        if (effs.length === 0) continue;
        const covered = new Set(
          c.abilities.abilities
            .filter((a) => a.ranks.some((r) => effs.some((e) => masksIntersect(e.classMask, r.classMask) || r.effects.some((x) => x.classMask !== null && masksIntersect(e.classMask, x.classMask)))))
            .map((a) => a.name),
        );
        const low = (t.descriptions.at(-1) ?? "").toLowerCase();
        for (const a of c.abilities.abilities) if (a.name.length >= 5 && low.includes(a.name.toLowerCase()) && !covered.has(a.name)) gaps.push(`${c.token}: ${t.name} → ${a.name}`);
      }
    }
    expect(gaps.sort()).toEqual(Object.keys(KNOWN).sort());
  });
});

describe("las cifras que se suman salen del texto del cliente y se aplican donde toca (las 9 clases)", () => {
  const solo = (c: (typeof classes)[number], name: string) => {
    const t = c.cls.ordered.find((i) => i.talent.name === name)!.talent;
    return collectStatEffects({ cls: c.cls, classBuild: { [t.nodeId]: t.maxRank }, legacy: null, legacyBuild: {}, race: null, abilities: c.abilities, rules: c.rules });
  };

  // Líneas sumadas cuya cifra no aparece en el texto del cliente (en valor absoluto, o minutos/ms), con el motivo
  const NOT_IN_TEXT: Record<string, string> = {
  };
  it("cada línea sumada de un talento pasivo aparece en su texto (lista exacta de excepciones)", () => {
    const found: string[] = [];
    let lines = 0;
    for (const c of classes) {
      for (const { talent } of c.cls.ordered) {
        if (!talent.passive) continue;
        const fx = solo(c, talent.name!);
        const text = (talent.descriptions[talent.maxRank - 1] ?? "").replace(/(\d)\.(\d{3})/g, "$1$2");
        const nums = new Set([...text.matchAll(/\d+(?:,\d+)?/g)].map((m) => Number(m[0].replace(",", "."))));
        for (const t of fx.totals) {
          if (t.sources.some((x) => x.name !== talent.name)) continue;
          lines++;
          const v = Math.abs(t.value);
          if (!(nums.has(v) || nums.has(Math.round(v * 10) / 10) || (t.unit === "s" && (nums.has(v / 60) || nums.has(v * 1000))))) found.push(`${c.token}: ${talent.name} → ${t.label} ${t.value}`);
        }
      }
    }
    expect(lines).toBeGreaterThan(300);
    expect(found.sort()).toEqual(Object.keys(NOT_IN_TEXT).sort());
  });

  it("el coste plano de ira va x10 en el cliente: Ferocidad −5 de ira (Magullar…) y −5 de energía (Zarpa, Arañazo), como dice su texto", () => {
    const costs = solo(byToken("druid"), "Ferocidad").totals.filter((t) => t.category === "Coste");
    expect(costs.map((t) => t.value).sort()).toEqual([-5, -5]);
    const triturar = solo(byToken("druid"), "Ataques trituradores").totals.filter((t) => t.category === "Coste");
    expect(triturar.map((t) => t.value).sort((a, b) => a - b)).toEqual([-18, -3]);
  });

  it("Embestir mejorado: +6 de ira generada por Cargar (el cliente guarda 60, la ira va x10)", () => {
    const line = solo(byToken("warrior"), "Embestir mejorado").totals.find((t) => t.label === "ira generada");
    expect(line).toMatchObject({ value: 6, scope: ["Embestir"] });
  });

  it("un modificador de hechizos con la máscara vacía no afecta a nadie: Aluvión no da +15 % periódico a todo el personaje", () => {
    const fx = solo(byToken("hunter"), "Aluvión");
    expect(fx.totals.filter((t) => t.category === "Daño periódico")).toEqual([]);
    expect(fx.conditional.some((c) => c.source.name === "Aluvión")).toBe(true); // se conserva como texto, no se descarta
  });

  it("auras de duración de control, velocidad, mano izquierda y maná máximo con la cifra del texto", () => {
    expect(solo(byToken("paladin"), "Fe implacable").totals.map((t) => `${t.label} ${t.value}`).sort()).toEqual(["duración de desorientación sobre ti -30", "duración de miedo sobre ti -30"]);
    expect(solo(byToken("paladin"), "Búsqueda de justicia").totals.map((t) => `${t.label} ${t.value}`).sort()).toEqual(["velocidad de movimiento 15", "velocidad de movimiento sobre montura 15"]);
    expect(solo(byToken("warrior"), "Especialización en doble empuñadura").totals.find((t) => t.label === "daño del arma de la mano izquierda")?.value).toBe(25);
    expect(solo(byToken("warlock"), "Vitalidad vil").totals.find((t) => t.target === "mana")?.value).toBe(15);
    // Voluntad férrea: el cliente trae un +15 positivo para la mecánica 1 que no cuadra con el texto: solo se suma la reducción del aturdimiento
    const iron = solo(byToken("warrior"), "Voluntad férrea");
    expect(iron.totals.map((t) => `${t.label} ${t.value}`)).toEqual(["duración de aturdimiento sobre ti -15"]);
    expect(iron.conditional.some((c) => c.source.name === "Voluntad férrea")).toBe(true);
  });
});

describe("probabilidad de activación («cada golpe tiene un N % de probabilidad»): operación 18 de los talentos", () => {
  it("Venenos mejorados (+10): el porcentaje del veneno sube en la descripción (Instantáneo 20 → 30 %, Mortal 30 → 40 %)", () => {
    const inst = textOf(rogue, "Venenos mejorados", "Veneno instantáneo");
    expect(inst.base).toContain("un 20% de probabilidad de envenenar");
    expect(inst.mod).toContain("un 30% de probabilidad de envenenar");
    const mortal = textOf(rogue, "Venenos mejorados", "Veneno mortal");
    expect(mortal.base).toContain("un 30% de probabilidad de envenenar");
    expect(mortal.mod).toContain("un 40% de probabilidad de envenenar");
    // Veneno oculto trae el 30 % escrito a mano en su texto: la cifra es la del texto y la máscara la de su hechizo de daño
    expect(textOf(rogue, "Venenos mejorados", "Veneno oculto").base).toContain("un 30% de probabilidades de envenenar");
    expect(textOf(rogue, "Venenos mejorados", "Veneno oculto").mod).toContain("un 40% de probabilidades de envenenar");
    for (const name of ["Veneno entorpecedor", "Veneno de aturdimiento mental", "Envenenar herida", "Veneno paralizante"]) {
      expect(textOf(rogue, "Venenos mejorados", name).mod, name).not.toBe(textOf(rogue, "Venenos mejorados", name).base);
    }
  });

  it("con el 100 % como tope y sin talentos el porcentaje es el del cliente", () => {
    const r = rankAtLevel(findAbility(rogue.abilities, "Veneno instantáneo")!, 60)!;
    expect(applyModifiers(r, 60, []).procs.map((p) => [p.base, p.final])).toEqual([[20, 20]]);
    const big = { source: { name: "t", spellId: 1, nodeId: 1, rank: 1, maxRank: 1 }, kind: "flat" as const, op: 18, value: 500, mask: [8192, 0, 0, 0] };
    expect(applyModifiers(r, 60, [big]).procs[0]!.final).toBe(100);
  });

  // Habilidades con «N % de probabilidad» de aplicar un veneno (hueco procs vacío o sin cruzar con Venenos mejorados)
  const POISON_NOT_COVERED: Record<string, string> = {
    "Veneno atrófico": "no es de Forever: veneno de Season of Discovery (hechizo 439473, máscara [0,0,1,0]); Blizzard no lo menciona, la referencia no lo lista y el filtro «Solo activas en Forever» lo oculta",
    "Veneno entumecedor": "idem (SoD, hechizo 439472)",
    "Veneno sebáceo": "idem (SoD, hechizo 439471)",
  };

  it("venenos que NO reciben Venenos mejorados (lista exacta, a confirmar en el juego)", () => {
    const notCovered: string[] = [];
    const talent = rogue.cls.ordered.find((i) => i.talent.name === "Venenos mejorados")!.talent;
    const mods = spellModifiersOf(rogue.cls, { [talent.nodeId]: talent.maxRank });
    for (const a of rogue.abilities.abilities) {
      const r = rankAtLevel(a, 60);
      if (!r || !/Cada golpe tiene un \d+% de probabilidad/.test(r.description) || !/^Veneno|^Envenenar/.test(a.name)) continue;
      if (applyModifiers(r, 60, mods).procs.every((p) => p.final === p.base)) notCovered.push(a.name);
    }
    expect(notCovered.sort()).toEqual(Object.keys(POISON_NOT_COVERED).sort());
  });
});

describe("cargas, radio y duración de hechizos citados (operaciones 4, 6 y 1)", () => {
  it("Fuego interno mejorado (+12 cargas): «hasta que se hayan usado 20 cargas» pasa a 32", () => {
    const t = textOf(byToken("priest"), "Fuego interno mejorado", "Fuego interno");
    expect(t.base).toContain("hasta que se hayan usado 20 cargas");
    expect(t.mod).toContain("hasta que se hayan usado 32 cargas");
  });

  it("el radio de las habilidades de área viene del cliente y lo modifican los talentos (Alcance ártico +20 %, Distraer mejorado +5 m)", () => {
    const radius = (c: string, talent: string, ability: string) => {
      const k = byToken(c);
      const r = rankAtLevel(findAbility(k.abilities, ability)!, 60)!;
      return { base: r.radiusYd, mod: applyModifiers(r, 60, spellModifiersOf(k.cls, only(k.cls, talent))).radiusYd };
    };
    expect(radius("mage", "Alcance ártico", "Nova de Escarcha")).toEqual({ base: 10, mod: 12 });
    expect(radius("mage", "Alcance ártico", "Cono de frío")).toEqual({ base: 10, mod: 12 });
    expect(radius("rogue", "Distraer mejorado", "Distraer")).toEqual({ base: 10, mod: 15 });
  });

  it("la duración de un hechizo citado por el texto se modifica con la máscara de ESE hechizo (Trampas inteligentes → placa de hielo)", () => {
    const hunter = byToken("hunter");
    const r = rankAtLevel(findAbility(hunter.abilities, "Trampa de Escarcha")!, 60)!;
    const m = applyModifiers(r, 60, spellModifiersOf(hunter.cls, only(hunter.cls, "Trampas inteligentes")));
    const changed = m.viaDurations.filter((v) => v.final !== v.base);
    expect(changed.length).toBeGreaterThan(0);
    const t = textOf(hunter, "Trampas inteligentes", "Trampa de Escarcha");
    expect(t.mod).not.toBe(t.base);
  });
});

describe("todas las operaciones de talentos que el motor calcula se ven en la ficha o en el texto (las 9 clases)", () => {
  // Combinaciones con la operación aplicada pero sin cambio observable, con el motivo
  const SELF = "hechizo de uso propio sin alcance: el talento no tiene nada que ampliar";
  const NO_OBSERVABLE_CHANGE: Record<string, string> = {
    "hunter: Aspectos letales → Aspecto del halcón (op 18)": "el proc (10 %) es del propio talento y se explica en su texto; el texto del aspecto no lo cita",
    "hunter: Aspectos letales → Aspecto de la bestia (op 18)": "idem",
    "hunter: Ojo de águila → Disparo de quimera (op 5)": "el talento llega por el hechizo de la picadura, no por el alcance de Disparo de quimera",
    "mage: Lanzallamas → Bomba viva (op 5)": "idem: llega por el hechizo disparado, el alcance de la habilidad no cambia",
    "warlock: Alcance macabro → Aullido de terror (op 5)": "el alcance del hechizo es nulo (es de área: radio 10 m, que este talento no modifica)",
    "warlock: Alcance destructivo → Piroinferno (op 5)": SELF,
    "priest: Alcance de las Sombras → Guardia de las Sombras (op 5)": SELF,
    ...Object.fromEntries(
      [
        "Conjurar agua",
        "Conjurar comida",
        "Caída lenta",
        "Teletransporte a: Entrañas",
        "Teletransporte a: Forjaz",
        "Teletransporte a: Orgrimmar",
        "Teletransporte a: Ventormenta",
        "Conjurar ágata de maná",
        "Teletransporte a Darnassus",
        "Teletransporte a: Cima del Trueno",
        "Conjurar jade de maná",
        "Conjurar citrino de maná",
        "Teletransporte a: Dalaran",
        "Conjurar rubí de maná",
        "Crear agua",
      ].map((n) => [`mage: Geometría Arcana → ${n} (op 5)`, SELF]),
    ),
  };
  const ops: [number, string][] = [[1, "duración"], [4, "cargas"], [5, "alcance"], [6, "radio"], [18, "activación"]];
  it("cada operación 1/4/5/6/18 cambia algo observable de la habilidad a la que llega (lista exacta de excepciones)", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const c of classes) {
      for (const { talent } of c.cls.ordered) {
        if (!talent.passive) continue;
        for (const [op] of ops) {
          const mods = spellModifiersOf(c.cls, { [talent.nodeId]: talent.maxRank }).filter((m) => m.op === op);
          if (mods.length === 0) continue;
          for (const a of c.abilities.abilities) {
            const r = rankAtLevel(a, 60);
            if (!r || allModifiersFor(r, mods).length === 0) continue;
            checked++;
            const base = applyModifiers(r, 60, []);
            const m = applyModifiers(r, 60, mods);
            const observable =
              text(renderAbilityText(r, m)) !== text(renderAbilityText(r, base)) ||
              m.rangeYd !== base.rangeYd ||
              m.durationMs !== base.durationMs ||
              m.radiusYd !== base.radiusYd ||
              m.charges.some((x) => x.final !== x.base) ||
              m.viaDurations.some((x) => x.final !== x.base) ||
              m.procs.some((x) => x.final !== x.base);
            if (!observable) missing.push(`${c.token}: ${talent.name} → ${a.name} (op ${op})`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(missing.sort()).toEqual(Object.keys(NO_OBSERVABLE_CHANGE).sort());
  });
});
