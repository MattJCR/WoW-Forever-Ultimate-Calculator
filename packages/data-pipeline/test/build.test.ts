import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildClassTalents } from "../src/build.js";
import { contrastAbilities, contrastClass, contrastLegacy, contrastOrphans, contrastRaces } from "../src/contrast.js";
import { openRawTables } from "../src/csv.js";
import { Abilities, BaseStats, ClassTalents, ClientStats, CombatFormulas, Races } from "../src/model.js";
import { buildBaseStats, type ClassicEra } from "../src/stats.js";
import { auditLevelStats } from "../src/stats-audit.js";
import { buildAbilities, racesOfMasks } from "../src/abilities.js";
import { CLIENT_TEXT_FIXES } from "../src/spell-tables.js";
import { looksEnglish } from "../src/language.js";
import { CLIENT_TYPOS, attachClassRacials, buildRaces, parseRacialName } from "../src/races.js";
import { buildLegacy } from "../src/legacy.js";
import { buildUnassigned } from "../src/unassigned.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70658";
const load = (dir: string) => buildClassTalents(openRawTables(join(root, "data", "raw", dir)), BUILD, "esES");

/** Con los hotfixes de la cache del juego aplicados: la verdad "en vivo". */
const live = load(`${BUILD}-hotfix`);
/** Solo los ficheros estaticos del cliente. */
const stat = load(BUILD);
const legacyData = buildLegacy(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells, live.trait);
const byToken = (r: typeof live, t: string) => r.classes.find((c) => c.classToken === t)!;
const TOKENS = ["DRUID", "HUNTER", "MAGE", "PALADIN", "PRIEST", "ROGUE", "SHAMAN", "WARLOCK", "WARRIOR"];

describe("arboles de talentos de Forever (cliente 1.60.1.70658, con hotfixes)", () => {
  it("cumple el esquema en todas las clases", () => {
    for (const c of live.classes) expect(() => ClassTalents.parse(c)).not.toThrow();
  });

  it("resuelve las 9 clases", () => {
    expect(live.classes.map((c) => c.classToken).sort()).toEqual(TOKENS);
  });

  it("elige el arbol completo de cada clase y deja claros los descartados", () => {
    // Druida = 1089 y Chaman = 1082 (TraitSystemID 0); 1083 es una version parcial del Druida; 1066 esta casi vacio.
    expect(byToken(live, "DRUID").traitTreeId).toBe(1089);
    expect(byToken(live, "SHAMAN").traitTreeId).toBe(1082);
    expect(live.unresolved.map((u) => u.traitTreeId)).toEqual([1066, 1083]);
  });

  it("el Mago tiene 54 talentos en 3 especializaciones (19/17/18; Piercing Ice se retiró con el hotfix del 20/10) con la rejilla de 7x4", () => {
    const mage = byToken(live, "MAGE");
    expect(mage.traitTreeId).toBe(1112);
    expect(mage.specs.map((s) => s.talents.length)).toEqual([19, 17, 18]);
    for (const t of mage.specs.flatMap((s) => s.talents)) {
      expect(t.row).toBeGreaterThanOrEqual(0);
      expect(t.row).toBeLessThanOrEqual(6);
      expect(t.col).toBeGreaterThanOrEqual(0);
      expect(t.col).toBeLessThanOrEqual(3);
      expect(t.name).not.toBeNull();
    }
  });

  it("todas las clases tienen 3 especializaciones con al menos 10 talentos", () => {
    for (const c of live.classes) {
      expect(c.specs).toHaveLength(3);
      for (const s of c.specs) expect(s.talents.length).toBeGreaterThanOrEqual(10);
      expect(c.warnings.filter((w) => w.includes("incompleta"))).toEqual([]);
    }
  });

  it("las reglas salen del cliente: 51 puntos y 5 puntos por fila", () => {
    for (const c of live.classes) {
      expect(c.rules.maxPoints).toBe(51);
      expect(c.rules.pointsPerRowDerived).toBe(5);
    }
  });

  it("el requisito de puntos del Mago es exactamente 5 x fila", () => {
    const talents = byToken(live, "MAGE").specs.flatMap((s) => s.talents);
    expect(talents.filter((t) => t.requiredPoints !== t.row * 5)).toEqual([]);
  });

  it("los prerrequisitos apuntan a nodos de la misma clase", () => {
    for (const c of live.classes) {
      const ids = new Set(c.specs.flatMap((s) => s.talents.map((t) => t.nodeId)));
      for (const t of c.specs.flatMap((s) => s.talents)) {
        for (const p of t.prerequisites) expect(ids.has(p.nodeId)).toBe(true);
      }
    }
  });

  it("no hay nodos repetidos dentro de una clase", () => {
    for (const c of live.classes) {
      const all = c.specs.flatMap((s) => s.talents.map((t) => t.nodeId));
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("es determinista: dos ejecuciones dan exactamente lo mismo", () => {
    expect(JSON.stringify(load(`${BUILD}-hotfix`))).toBe(JSON.stringify(live));
  });

  it("conserva los nodos fuera de la rejilla como nodos no activos: visibles pero no seleccionables", () => {
    const counts = Object.fromEntries(live.classes.map((c) => [c.classToken, c.inactiveTalents.length]));
    expect(counts).toEqual({ DRUID: 0, HUNTER: 2, MAGE: 0, PALADIN: 0, PRIEST: 1, ROGUE: 0, SHAMAN: 0, WARLOCK: 0, WARRIOR: 0 });
    for (const c of live.classes) {
      for (const t of c.inactiveTalents) {
        expect(t.selectable).toBe(false);
        expect(t.inactiveReason).toBe("off-grid");
        expect(t.name).not.toBeNull();
        expect(t.maxRank).toBeGreaterThanOrEqual(1);
      }
      expect(c.warnings.filter((w) => w.includes("fuera de la rejilla")).length).toBeGreaterThanOrEqual(c.inactiveTalents.length);
    }
  });

  it("los nodos no activos no se mezclan con los activos ni cuentan en el total", () => {
    for (const c of live.classes) {
      const active = new Set(c.specs.flatMap((s) => s.talents.map((t) => t.nodeId)));
      for (const t of c.inactiveTalents) expect(active.has(t.nodeId)).toBe(false);
      for (const s of c.specs) for (const t of s.talents) expect(t.raw.posX).toBeLessThan(15000);
    }
    expect(byToken(live, "HUNTER").specs).toHaveLength(3);
  });

  it("el Cazador conserva Aguijon de serpiente mejorado (Y=39300) y Reflejos de relampago (X=102800)", () => {
    const h = byToken(live, "HUNTER").inactiveTalents;
    expect(h.map((t) => t.nodeId).sort()).toEqual([104982, 105003]);
    const serpent = h.find((t) => t.nodeId === 105003)!;
    expect(serpent.raw).toEqual({ posX: 6820, posY: 39300 });
    expect(serpent.nearestSpecIndex).toBe(1); // su X cae en la columna de Punteria
    expect(h.find((t) => t.nodeId === 104982)!.nearestSpecIndex).toBeNull(); // X=102800: sin especializacion
  });
});

describe("descripciones por rango e iconos", () => {
  const allTalents = live.classes.flatMap((c) => c.specs.flatMap((s) => s.talents.map((t) => ({ c, t }))));

  it("cada talento tiene icono y un texto por rango", () => {
    for (const { t } of allTalents) {
      expect(t.iconFileDataId, t.name ?? "").toBeGreaterThan(0);
      expect(t.descriptions).toHaveLength(t.maxRank);
      expect(t.descriptions[0]!.length).toBeGreaterThan(10);
    }
  });

  it("los valores por rango salen de las curvas del cliente (Enfoque Arcano: 1 %, 2 %... 5 %)", () => {
    const focus = byToken(live, "MAGE").specs.flatMap((s) => s.talents).find((t) => t.spellId === 11222)!;
    expect(focus.descriptions.map((d) => /(\d+)%/.exec(d)![1])).toEqual(["1", "2", "3", "4", "5"]);
    expect(focus.descriptions[0]).toBe("Aumenta un 1% tu probabilidad de golpear con hechizos Arcanos.");
  });

  it("interpreta expresiones ${...} con signo y decimales fijos (Eclipse: 0,17 / 0,33 / 0,50 s)", () => {
    const eclipse = byToken(live, "DRUID").specs.flatMap((s) => s.talents).find((t) => t.spellId === 408248)!;
    expect(eclipse.descriptions.map((d) => /reduce ([\d,]+) s/.exec(d)![1])).toEqual(["0,17", "0,33", "0,50"]);
  });

  it("solo quedan sin resolver los marcadores que dependen del personaje", () => {
    const incomplete = allTalents.filter(({ t }) => !t.descriptionsComplete);
    expect(incomplete.length).toBeLessThanOrEqual(12);
    for (const { t } of incomplete) expect(t.descriptions.join(" ")).toMatch(/\$/);
  });

  it("marca como aproximados los valores que dependen del nivel (Explosion Arcana)", () => {
    const blast = byToken(live, "MAGE").specs.flatMap((s) => s.talents).find((t) => t.spellId === 400574)!;
    expect(blast.descriptionsApproximate).toBe(true);
    const focus = byToken(live, "MAGE").specs.flatMap((s) => s.talents).find((t) => t.spellId === 11222)!;
    expect(focus.descriptionsApproximate).toBe(false);
  });

  it("coincide con los numeros de la referencia en >= 94 % de los textos por rango", () => {
    const nums = (s: string) => (s.replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) ?? []).sort().join("|");
    let total = 0;
    let same = 0;
    for (const c of live.classes) {
      const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", `${c.classToken!.toLowerCase()}.json`), "utf8")) as {
        talents: { trees: { talents: { row: number; col: number; desc: string[] }[] }[] };
      };
      for (const s of c.specs) {
        const theirs = new Map(tf.talents.trees[s.index]!.talents.map((t) => [`${t.row - 1},${t.col - 1}`, t]));
        for (const t of s.talents) {
          const o = theirs.get(`${t.row},${t.col}`);
          if (!o) continue;
          t.descriptions.forEach((d, i) => {
            total++;
            if (o.desc[i] !== undefined && nums(d) === nums(o.desc[i]!)) same++;
          });
        }
      }
    }
    expect(total).toBeGreaterThan(1200);
    expect(same / total).toBeGreaterThanOrEqual(0.94);
  });
});

describe("Legacy (ventajas de cuenta)", () => {
  it("son 3 arboles de 9 ventajas, 16 puntos, con icono y texto, y sin el arbol vacio 1118", () => {
    expect(legacyData.kind).toBe("legacy");
    expect(legacyData.specs.map((s) => [s.traitTreeId, s.name, s.talents.length])).toEqual([
      [1188, "Aventura", 9],
      [1189, "Recursos", 9],
      [1187, "Profesiones", 9],
    ]);
    expect(legacyData.rules.maxPoints).toBe(16);
    for (const t of legacyData.specs.flatMap((s) => s.talents)) {
      expect(t.iconFileDataId).toBeGreaterThan(0);
      expect(t.descriptions).toHaveLength(t.maxRank);
    }
  });

  it("cada requisito cuenta los puntos de TODO su arbol (no las filas de arriba)", () => {
    for (const spec of legacyData.specs) {
      const gated = spec.talents.filter((t) => t.gate);
      expect(gated.length).toBeGreaterThan(0);
      for (const t of gated) {
        const inTree = new Set(spec.talents.map((x) => x.nodeId));
        for (const id of t.gate!.fromNodeIds) expect(inTree.has(id)).toBe(true);
        expect([5, 10]).toContain(t.gate!.points);
      }
    }
  });

  it("los requisitos de las clases coinciden con 'filas superiores', salvo los finales de fila 7 que se cuentan a si mismos", () => {
    for (const c of live.classes) {
      for (const s of c.specs) {
        for (const t of s.talents) {
          if (!t.gate) continue;
          const above = new Set(s.talents.filter((x) => x.row < t.row).map((x) => x.nodeId));
          const from = new Set(t.gate.fromNodeIds);
          const inactive = new Set(c.inactiveTalents.map((i) => i.nodeId)); // nodos no activos del grupo: nunca tienen puntos
          const extra = [...from].filter((id) => !above.has(id) && !inactive.has(id));
          const missing = [...above].filter((id) => !from.has(id));
          expect(missing).toEqual([]);
          expect(extra.length).toBeLessThanOrEqual(1); // el propio nodo de la ultima fila
        }
      }
    }
  });

  it("Talentoso es un nodo escalonado: 5 rangos, texto de nivel 9 a 5 y valores numericos", () => {
    const t = legacyData.specs.flatMap((s) => s.talents).find((x) => x.spellId === 1225474)!;
    expect(t.maxRank).toBe(5);
    expect(t.rankValues.map((v) => v[0])).toEqual([9, 8, 7, 6, 5]);
    expect(t.descriptions.map((d) => /nivel (\d+),/.exec(d)![1])).toEqual(["9", "8", "7", "6", "5"]);
  });
});

describe("seccion aparte: datos sin asignar", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const un = buildUnassigned(raw, live.classes, legacyData, BUILD, "esES", live.spells, live.trait);

  it("conserva los arboles descartados con todos sus nodos", () => {
    expect(un.alternativeTrees.map((t) => t.traitTreeId)).toEqual([1058, 1066, 1081, 1083]);
    const druid = un.alternativeTrees.find((t) => t.traitTreeId === 1083)!;
    expect(druid.className).toBe("Druida");
    expect(druid.reason).toContain("1089");
    expect(druid.nodes).toHaveLength(druid.nodeCount);
    for (const t of un.alternativeTrees) {
      expect(t.selectable).toBe(false);
      expect(t.status).toBe("unassigned");
    }
  });

  it("conserva las entradas de talento sin nodo, ninguna seleccionable", () => {
    const entries = raw.table("TraitNodeEntry").length;
    const linked = new Set(raw.table("TraitNodeXTraitNodeEntry").map((l) => l.TraitNodeEntryID)).size;
    expect(un.orphanEntries).toHaveLength(entries - linked);
    expect(un.orphanEntries.length).toBe(99); // 98 + Hielo penetrante (Piercing Ice), retirado el 20/10: se conserva sin nodo
    for (const e of un.orphanEntries) expect(e.selectable).toBe(false);
    expect(new Set(un.orphanEntries.map((e) => e.entryId)).size).toBe(un.orphanEntries.length);
  });

  it("los nodos de los arboles descartados vienen en cuadricula, con descripcion por rango y requisitos", () => {
    const druid = un.alternativeTrees.find((t) => t.traitTreeId === 1083)!;
    const withSpell = druid.nodes.filter((n) => n.maxRank !== null);
    expect(withSpell.length).toBeGreaterThan(30);
    for (const n of withSpell) expect(n.descriptions).toHaveLength(n.maxRank!);
    // salvo hechizos que el cliente no trae (2 nodos del arbol parcial del Druida), todos tienen texto e icono
    const withText = withSpell.filter((n) => n.descriptions[0]!.length > 5 && n.iconFileDataId);
    expect(withSpell.length - withText.length).toBeLessThanOrEqual(2);
    expect(withSpell.filter((n) => n.name === null).every((n) => !n.descriptions[0])).toBe(true);
    // sin dos nodos en la misma casilla
    const cells = druid.nodes.map((n) => `${n.row},${n.col}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(Math.max(...druid.nodes.map((n) => n.col))).toBeLessThanOrEqual(12);
  });

  it("las entradas de Legacy cuyo hechizo ya esta colocado son duplicados, no ventajas sin colocar (24 + 30 en 16 ventajas)", () => {
    const placed = un.orphanEntries.filter((e) => e.isLegacy && e.legacyPlaced);
    const unplaced = un.orphanEntries.filter((e) => e.isLegacy && !e.legacyPlaced);
    expect(placed).toHaveLength(24);
    expect(unplaced).toHaveLength(30);
    expect(new Set(unplaced.map((e) => e.spellId)).size).toBe(16);
    const inTrees = new Set(legacyData.specs.flatMap((s) => s.talents.map((t) => t.spellId)));
    for (const e of placed) expect(inTrees.has(e.spellId!)).toBe(true);
    for (const e of unplaced) expect(inTrees.has(e.spellId!)).toBe(false);
  });

  it("separa las ventajas de Legacy sin colocar de los demas talentos sin nodo (54 + 45)", () => {
    const legacyOnes = un.orphanEntries.filter((e) => e.isLegacy);
    const others = un.orphanEntries.filter((e) => !e.isLegacy);
    expect(legacyOnes).toHaveLength(54);
    expect(others).toHaveLength(45);
    const legacyIds = legacyData.specs.flatMap((s) => s.talents.map((t) => t.spellId)).filter((id) => id < 1_300_000);
    const lo = Math.min(...legacyIds);
    for (const e of legacyOnes) expect(e.spellId!).toBeGreaterThanOrEqual(lo);
    // los de clase (p. ej. un talento de Paladin) no se marcan como Legacy
    expect(others.some((e) => e.className === "Paladín")).toBe(true);
    expect(legacyOnes.some((e) => e.className !== null)).toBe(false);
  });

  it("todos los talentos sin nodo traen descripcion por rango (para la prueba libre)", () => {
    for (const e of un.orphanEntries.filter((x) => x.spellId !== null)) {
      expect(e.descriptions).toHaveLength(e.maxRank);
    }
  });

  it("no mezcla las entradas sin nodo con los talentos activos", () => {
    const orphanSpells = new Set(un.orphanEntries.map((e) => e.entryId));
    const linkedEntries = new Set(raw.table("TraitNodeXTraitNodeEntry").map((l) => Number(l.TraitNodeEntryID)));
    for (const id of orphanSpells) expect(linkedEntries.has(id)).toBe(false);
  });
});

describe("hotfixes del servidor frente a los ficheros estaticos", () => {
  it("el Mago corregido por hotfix (Colera Arcana a 15 puntos, dos nodos de Escarcha cambian de columna) ya viene en los ficheros estaticos desde el 70658", () => {
    const flat = (r: typeof live) => new Map(byToken(r, "MAGE").specs.flatMap((s) => s.talents).map((t) => [t.nodeId, t]));
    // Hasta el 70532 solo lo traian los hotfixes (estatico: 0 puntos, columnas 3 y 1); el 70658 lo incorpora al estatico
    for (const r of [stat, live]) {
      const m = flat(r);
      expect(m.get(113627)!.requiredPoints).toBe(15);
      expect([m.get(105774)!.col, m.get(105776)!.col]).toEqual([1, 3]);
    }
  });

  it("no cambian la estructura del resto de clases", () => {
    for (const t of TOKENS.filter((x) => x !== "MAGE")) {
      const sig = (r: typeof live) =>
        byToken(r, t).specs.flatMap((s) => s.talents).map((x) => `${x.nodeId}:${x.row}:${x.col}:${x.maxRank}`).join("|");
      expect(sig(live)).toBe(sig(stat));
    }
  });
});

describe("contraste con la referencia (CC BY 4.0)", () => {
  const tf = join(root, "data", "external", "talentsforever");
  it.each(TOKENS)("%s coincide en posiciones y rangos maximos", (token) => {
    const report = contrastClass(byToken(live, token), tf);
    expect(report).not.toBeNull();
    expect(report!.ok).toBe(true);
  });

  it("suman 465 talentos en total", () => {
    const total = live.classes.reduce((s, c) => s + c.specs.reduce((n, sp) => n + sp.talents.length, 0), 0);
    expect(total).toBe(465);
  });
});

describe("razas (CharBaseInfo + ChrRaceRacialAbility)", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const byId = (id: number) => racesData.races.find((r) => r.id === id)!;

  it("cumple el esquema y trae las 10 razas jugables de Forever (8 clasicas + 2 Cielonato), sin avisos", () => {
    expect(() => Races.parse(racesData)).not.toThrow();
    expect(racesData.races.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 95, 96]);
    expect(racesData.warnings).toEqual([]);
  });

  it("separa Alianza y Horda con el campo del cliente (Cielonato 95 = Alianza, 96 = Horda)", () => {
    expect(racesData.races.filter((r) => r.faction === "alliance").map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 3, 4, 7, 95]);
    expect(racesData.races.filter((r) => r.faction === "horde").map((r) => r.id).sort((a, b) => a - b)).toEqual([2, 5, 6, 8, 96]);
  });

  it("la matriz raza/clase sale de CharBaseInfo: el Tauren no es Mago y el Humano si", () => {
    expect(byId(6).classIds).not.toContain(8);
    expect(byId(1).classIds).toContain(8);
    expect(byId(3).classIds).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("efectos de raciales: los de utilidad tienen significado (sesión 12) y los que quedan sin interpretar son exactamente los de esta lista, con su motivo", () => {
    const nulls = racesData.races.flatMap((r) => r.racials.flatMap((a) => a.spells.flatMap((s) => s.effects.filter((e) => e.kind === null).map((e) => `${r.id}|${a.name}|${e.aura}:${e.miscValue}`))));
    expect([...new Set(nulls)].sort()).toEqual(
      [
        // Guías de la comunidad (fuentes de terceros, 2026-10-22): «Eureka!»: 8 s sin cargas, −10 % de coste y +10 % de daño o sanación; los valores 10 y 1 de las auras dummy son el
        // porcentaje y el consumo de cargas de los periódicos, sin cifra propia que enseñar (el coste y el 10 % salen de las auras 108).
        "7|¡Eureka!|4:null",
        // «Caminar sobre el aire»: planeo de 10 s (la caída lenta, aura 105, ya tiene significado); 409 y 139 son efectos visuales y de reacción sin cifra
        "95|Caminar sobre el aire|409:null",
        "95|Caminar sobre el aire|139:2402",
        "95|Caminar sobre el aire|139:2403",
        "95|Caminar sobre el aire|139:2754",
        "96|Caminar sobre el aire|409:null",
        "96|Caminar sobre el aire|139:2402",
        "96|Caminar sobre el aire|139:2403",
        "96|Caminar sobre el aire|139:2754",
        // «Pisotón de guerra»: el aturdimiento de la propia habilidad (2 s a un máximo de 5 enemigos: lo dice el texto; la duración está en el hechizo)
        "6|Pisotón de guerra|12:null",
      ].sort(),
    );
    // Correr planicies (Tauren): +1 % de velocidad cada 5 s moviéndote, hasta un 30 % (valores del cliente 5 y 30; el significado, de guías de la comunidad)
    const plains = byId(6).racials.find((a) => a.name === "Correr planicies")!.spells[0]!.effects.find((e) => e.kind === "stacking-speed-pct")!;
    expect([plains.miscValue, plains.value]).toEqual([5, 30]);
    expect(byId(4).racials.find((a) => a.name === "Fusión de las Sombras")!.spells[0]!.effects.map((e) => e.kind)).toContain("threat-drop");
    expect(byId(95).racials.find((a) => a.name === "Caminar sobre el aire")!.spells[0]!.effects.map((e) => e.kind)).toContain("slow-fall");
    // Los de utilidad: cifras del cliente
    const kind = (raceId: number, name: string) => [...new Set(byId(raceId).racials.find((a) => a.name === name)!.spells.flatMap((s) => s.effects.map((e) => e.kind)))];
    expect(kind(1, "Percepción")).toEqual(["stealth-detection"]);
    expect(kind(5, "Respiración subacuática")).toEqual(["water-breathing-pct"]);
    expect(kind(3, "Petraforma")).toEqual(expect.arrayContaining(["mechanic-immunity", "dispel-immunity", "damage-taken-pct"]));
    expect(kind(7, "Artista del escape")).toEqual(["mechanic-immunity"]);
    expect(kind(7, "Especialización de ingeniería")).toEqual(["engineering-failure-pct"]);
  });

  it("cada raza tiene 4 raciales ordenadas, activas y pasivas reconocidas", () => {
    for (const r of racesData.races) {
      expect(r.racials).toHaveLength(4);
      expect(r.racials.map((a) => a.order)).toEqual([0, 1, 2, 3]);
    }
    expect(byId(1).racials.map((a) => `${a.kind}:${a.name}`)).toContain("passive:Crueldad");
    expect(byId(95).racials.find((a) => a.name === "Leer línea Ley")?.kind).toBe("active");
  });

  it("interpreta los nombres de raciales en espanol e ingles", () => {
    expect(parseRacialName("Humano - Activa - Percepción")).toEqual({ name: "Percepción", kind: "active" });
    expect(parseRacialName("Skyborne - Horde - Passive - Wind Blessed")).toEqual({ name: "Wind Blessed", kind: "passive" });
    expect(parseRacialName("sin guiones")).toBeNull();
  });

  it("coincide con la matriz y el numero de raciales de la referencia", () => {
    const manifestClasses = live.classes.map((c) => ({ classId: c.classId, className: c.className ?? "?", token: c.classToken! }));
    const report = contrastRaces(racesData, manifestClasses, join(root, "data", "external", "talentsforever"));
    expect(report).not.toBeNull();
    expect(report!.ok).toBe(true);
  });
});

describe("estadisticas base (Classic Era, procedencia community)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const racesData = buildRaces(raw, BUILD, "esES", live.spells);
  const classic = JSON.parse(readFileSync(join(root, "data", "external", "classic-stats", "classic-era.json"), "utf8")) as ClassicEra;
  const stats = buildBaseStats(racesData, classic, BUILD);
  const combo = (r: number, c: number) => stats.combos.find((x) => x.raceId === r && x.classId === c)!;

  it("cumple el esquema y cubre los 60 niveles de cada combinacion", () => {
    expect(() => BaseStats.parse(stats)).not.toThrow();
    for (const c of stats.combos) {
      expect(c.stats).toHaveLength(60);
      expect(c.stats.every((row) => row.length === 5)).toBe(true);
    }
  });

  it("Humano guerrero nivel 1 = 23/20/22/20/20 (Classic menos el +5 % de espiritu, que en Forever es una racial)", () => {
    expect(combo(1, 1).stats[0]).toEqual([23, 20, 22, 20, 20]);
    expect(combo(1, 1).provenance).toBe("community");
  });

  it("50 combinaciones con fila en Classic o Cielonato (community), 6 estimadas (las nuevas de Forever) y ninguna sin datos", () => {
    expect(stats.combos.filter((c) => c.provenance === "community")).toHaveLength(50);
    const est = stats.combos.filter((c) => c.provenance === "assumption").map((c) => `${c.raceId}/${c.classId}`).sort();
    expect(est).toEqual(["1/3", "2/8", "3/7", "5/2", "7/5", "8/9"]);
    expect(stats.missing).toEqual([]);
  });

  it("las diferencias de raza de las 8 razas clasicas son las del juego original (la comunidad revirtio las menores del 2026-10-20) y el espiritu si cambia", () => {
    expect(stats.raceOffsets.provenance).toBe("community");
    expect(stats.raceOffsets.source.date).toBe("2026-10-21");
    // Tauren guerrero nivel 1: Humano 23/20/22/20/20 + (5,-5,2,-5,2) = 28/15/24/15/22, igual que Classic
    expect(combo(6, 1).stats[0]).toEqual([28, 15, 24, 15, 22]);
    expect(combo(2, 1).stats[0]).toEqual([26, 17, 24, 17, 23]);
    // Fuera de lo que Forever cambia a mano (espiritu del Humano, intelecto del Gnomo) cada raza reproduce la tabla de Classic
    // (ya auditada): 8 287 de 8 400 celdas exactas, 101 con 1 de diferencia (redondeo de la fuente) y 12 con 2 o mas,
    // que son el ruido de la propia fuente (hasta 3 en Orco picaro agilidad 19-20, Gnomo brujo espiritu 59, aguante del Orco brujo).
    const audited = auditLevelStats(classic.levelStats).levelStats;
    let cells = 0;
    let exact = 0;
    for (const c of stats.combos) {
      if (c.provenance !== "community" || c.raceId > 8 || c.derivedFromRaceId !== null) continue;
      const classicRows = audited[c.raceId]?.[c.classId];
      if (!classicRows) continue;
      c.stats.forEach((row, l) => {
        for (let i = 0; i < 5; i++) {
          if (c.raceId === 1 && i === 4) continue; // +5 % de espiritu: racial
          if (c.raceId === 7 && i === 3) continue; // +5 % de intelecto: no existe en Forever
          const diff = Math.abs(row[i]! - classicRows[l]![i]!);
          expect(diff, `${c.raceId}/${c.classId} nivel ${l + 1} atributo ${i}`).toBeLessThanOrEqual(3);
          cells++;
          if (diff === 0) exact++;
        }
      });
    }
    expect(cells).toBeGreaterThan(8000);
    expect(exact / cells).toBeGreaterThan(0.98);
  });

  it("Cielonato (95 y 96) = base de la clase + (-1,+1,-1,+1) y comparte filas entre facciones", () => {
    for (const classId of [1, 3, 4, 8]) {
      const human = combo(1, classId).stats[0]!;
      const sky = combo(95, classId).stats[0]!;
      expect(sky.slice(0, 4)).toEqual([human[0]! - 1, human[1]! + 1, human[2]! - 1, human[3]! + 1]);
      if (stats.combos.some((c) => c.raceId === 96 && c.classId === classId)) expect(combo(96, classId).stats).toEqual(combo(95, classId).stats);
    }
  });

  it("a nivel 60 reproduce las bases de clase medidas por la comunidad (fuerza/agilidad/aguante/intelecto/espiritu sin racial) en las 56 parejas", () => {
    const WOWSIMS_L60: Record<number, number[]> = {
      1: [120, 80, 110, 30, 45], 2: [105, 65, 100, 70, 75], 3: [55, 125, 90, 65, 70], 4: [80, 130, 75, 35, 50], 5: [35, 40, 50, 120, 125],
      7: [85, 55, 95, 90, 100], 8: [30, 35, 45, 125, 120], 9: [45, 50, 65, 110, 115], 11: [65, 60, 70, 100, 110],
    };
    for (const c of stats.combos) {
      const delta = stats.raceOffsets.offsets.find((o) => o.raceId === c.raceId)!.delta;
      const row = c.stats[59]!;
      const want = WOWSIMS_L60[c.classId]!;
      for (let i = 0; i < 4; i++) expect(row[i]! - delta[i]!, `${c.raceId}/${c.classId} atributo ${i}`).toBe(want[i]);
      // El espiritu de la base de la clase es el del Humano sin racial (su +5 % se aplica aparte); cada raza suma su desplazamiento
      expect(row[4]! - delta[4]!, `${c.raceId}/${c.classId} espiritu`).toBe(want[4]);
    }
  });

  it("la estimacion queda cerca de una combinacion real parecida (Humano cazador ~ Orco cazador +-5)", () => {
    const est = combo(1, 3).stats[59]!;
    const real = combo(2, 3).stats[59]!;
    est.forEach((v, i) => expect(Math.abs(v - real[i]!)).toBeLessThanOrEqual(8));
  });

  it("vida y mana base crecen con el nivel y hay una fila por clase", () => {
    expect(stats.classBase).toHaveLength(9);
    for (const c of stats.classBase) expect(c.hp[59]!).toBeGreaterThan(c.hp[0]!);
    expect(stats.betaMaxLevel).toBe(30);
  });
});

describe("estadisticas base: el +5 % de intelecto de Classic del Gnomo no existe en Forever", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const classic = JSON.parse(readFileSync(join(root, "data", "external", "classic-stats", "classic-era.json"), "utf8")) as ClassicEra;
  const stats = buildBaseStats(racesData, classic, BUILD);
  const combo = (r: number, c: number) => stats.combos.find((x) => x.raceId === r && x.classId === c)!;

  it("el intelecto del Gnomo es el del Humano + 3 en los 60 niveles (base sin el +5 % de Classic) y lleva aviso", () => {
    const human = classic.levelStats[1]![8]!;
    const ours = combo(7, 8).stats.map((row) => row[3]!);
    expect(new Set(ours.map((v, l) => v - human[l]![3]!))).toEqual(new Set([3])); // exacto: una sola constante
    expect(ours[59]).toBeLessThan(classic.levelStats[7]![8]![59]![3]!);
    expect(combo(7, 8).note).toContain("Mente expansiva");
  });

  it("el espiritu del Humano va SIN su +5 % (es una racial de Forever, se aplica aparte): Classic 126 = 120 x 1,05 hacia abajo", () => {
    expect(classic.levelStats[1]![8]![59]![4]).toBe(126);
    expect(combo(1, 8).stats[59]![4]).toBe(120);
    expect(combo(1, 8).note).toContain("5 %");
    for (const [cls, rows] of Object.entries(classic.levelStats[1]!)) {
      // Classic no es exacto en todos los niveles (hay valores que x * 1,05 hacia abajo no puede dar): +-1 como mucho
      rows.forEach((row, l) => expect(Math.abs(Math.floor(combo(1, Number(cls)).stats[l]![4]! * 1.05) - row[4]!), `clase ${cls} nivel ${l + 1}`).toBeLessThanOrEqual(1));
    }
  });
});

describe("raciales que pueden compartir enfriamiento con la insignia de PvP (sin confirmar)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const racesData = buildRaces(raw, BUILD, "esES", live.spells);
  const marked = racesData.races.flatMap((r) => r.racials.filter((a) => a.pvpTrinket).map((a) => `${r.name}: ${a.name} (${a.pvpTrinket!.overlaps.join(", ")})`));

  it("el cliente no enlaza ninguna racial con la categoria de enfriamiento de la insignia (2269): por eso va sin confirmar", () => {
    const racialIds = new Set(racesData.races.flatMap((r) => r.racials.flatMap((a) => a.spells.map((s) => s.spellId))));
    const inTrinketCategory = raw.table("SpellCategories").filter((r) => Number(r.Category) === 2269).map((r) => Number(r.SpellID));
    expect(inTrinketCategory.length).toBeGreaterThan(0);
    expect(inTrinketCategory.filter((id) => racialIds.has(id))).toEqual([]);
  });

  it("solo se marcan las raciales activas que quitan el mismo control que la insignia (lista exacta)", () => {
    expect(marked).toEqual([
      "Humano: Voluntad de supervivencia (aturdimiento)",
      "Gnomo: Artista del escape (inmovilización, ralentización)",
      "No-muerto: Voluntad de los Renegados (embelesamiento, miedo)",
    ]);
    for (const r of racesData.races) for (const a of r.racials) if (a.pvpTrinket) {
      expect(a.kind).toBe("active");
      expect(a.pvpTrinket.status).toBe("unconfirmed");
      expect(a.pvpTrinket.provenance).toBe("assumption");
      expect(a.pvpTrinket.trinketCooldownMs).toBe(300000);
    }
  });
});

/** Nombre de cada racial en la tabla ChrRaceRacialAbility («raza:orden» -> nombre), sin el prefijo «Raza - Activa - ». */
function parseRawNames(dir: string): [string, string][] {
  return openRawTables(dir).table("ChrRaceRacialAbility").map((r) => [`${r.ChrRacesID}:${r.Order}`, parseRacialName(r.Name_lang ?? "")!.name] as [string, string]);
}
function parseRawDescriptions(dir: string): Map<string, string> {
  return new Map(openRawTables(dir).table("ChrRaceRacialAbility").map((r) => [`${r.ChrRacesID}:${r.Order}`, r.Description_lang ?? ""] as [string, string]));
}

describe("cifras de las raciales (hechizos del cliente)", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const spell = (raceId: number, name: string, spellId?: number) =>
    racesData.races.find((r) => r.id === raceId)!.racials.find((a) => a.name === name)!.spells.find((s) => spellId === undefined || s.spellId === spellId)!;
  const effect = (raceId: number, name: string, kind: string) => spell(raceId, name).effects.find((e) => e.kind === kind);

  it("todas las raciales tienen al menos un hechizo, y todos estan en la SkillLine racial de su raza (sin avisos)", () => {
    expect(racesData.warnings).toEqual([]);
    for (const r of racesData.races) for (const a of r.racials) expect(a.spells.length, `${r.name}: ${a.name}`).toBeGreaterThan(0);
  });

  it("el nombre de cada racial es el de su hechizo (libro de hechizos), no el de la tabla de raciales: lista exacta de las que difieren", () => {
    const table = new Map(parseRawNames(join(root, "data", "raw", `${BUILD}-hotfix`)));
    const differ = racesData.races.flatMap((r) => r.racials.filter((a) => table.get(`${r.id}:${a.order}`) !== a.name).map((a) => `${table.get(`${r.id}:${a.order}`)} -> ${a.name}`));
    expect(differ.sort()).toEqual(
      [
        "Canibalismo -> Canibalizar",
        "Encontrar tesoro -> Buscar tesoro",
        "Forma de piedra -> Petraforma",
        "Presura -> Prontitud",
        "Robustez -> Aguante",
        "Rabiar -> Iracundia",
        // Cielonato trae los nombres en inglés en la tabla (sus hechizos sí están en español)
        "Elemental Insight -> Perspicacia elemental",
        "Elemental Insight -> Perspicacia elemental",
        "Read Leyline -> Leer línea Ley",
        "Skysight -> Visión cielonata",
        "Walk on Air -> Caminar sobre el aire",
        "Walk on Air -> Caminar sobre el aire",
        "Wind Blessed -> Bendición del viento",
        "Wind Blessed -> Bendición del viento",
      ].sort(),
    );
  });

  it("Leer línea Ley y Visión cielonata: la tabla dice «5 min» pero sus hechizos duran 30 s / 15 min; se muestra el texto del hechizo (si el cliente corrige la tabla, esta prueba avisa)", () => {
    const rows = parseRawDescriptions(join(root, "data", "raw", `${BUILD}-hotfix`));
    expect(rows.get("95:1")).toContain("5 min");
    expect(rows.get("96:1")).toContain("5 min");
    for (const [raceId, name] of [[95, "Leer línea Ley"], [96, "Visión cielonata"]] as const) {
      const a = racesData.races.find((r) => r.id === raceId)!.racials.find((x) => x.name === name)!;
      expect(a.description, name).toMatch(/Dura 30 s .* 15 min/);
      expect(a.description, name).not.toMatch(/b5 min/);
    }
  });

  it("erratas del cliente corregidas: solo «amentados» (Mente expansiva)", () => {
    expect(CLIENT_TYPOS).toEqual([["amentados", "aumentados"]]);
    const text = racesData.races.find((r) => r.id === 7)!.racials.find((a) => a.name === "Mente expansiva")!.description;
    expect(text).toBe("Maná, ira o energía máximos aumentados un 5%.");
  });

  it("pasivas: Crueldad +2 % critico, Espiritu humano +5 % espiritu, Salvajismo +1 %, Aguante +5 % salud", () => {
    expect(effect(1, "Crueldad", "crit-chance")?.value).toBe(2);
    expect(effect(1, "El espíritu humano", "spirit-pct")).toMatchObject({ value: 5, miscValue: 4 });
    expect(effect(2, "Salvajismo", "crit-chance")?.value).toBe(1);
    expect(effect(6, "Aguante", "health-pct")?.value).toBe(5);
    expect(effect(6, "Aguante", "crit-damage-bonus")?.value).toBe(2);
  });

  it("activas: Furia sangrienta +10 % poder de ataque y con hechizos, 15 s, 2 min (3 min hasta el 70532); Iracundia +10 % celeridad", () => {
    const bf = spell(2, "Furia sangrienta");
    expect(bf.durationMs).toBe(15000);
    expect(bf.cooldownMs).toBe(120000);
    expect(bf.effects.map((e) => e.kind).sort()).toEqual(["attack-power-pct", "ranged-attack-power-pct", "spell-power-pct"]);
    expect(effect(8, "Iracundia", "haste-spell-pct")?.value).toBe(10);
    expect(spell(8, "Iracundia").durationMs).toBe(10000);
  });

  it("variantes por clase: Mente expansiva del Gnomo (5 % de mana, ira o energia segun clase)", () => {
    const variants = racesData.races.find((r) => r.id === 7)!.racials.find((a) => a.name === "Mente expansiva")!.spells;
    expect(variants.map((v) => v.classMask).sort((a, b) => a - b)).toEqual([1, 8, 400]);
    expect(variants.find((v) => v.classMask === 1)!.effects[0]).toMatchObject({ kind: "max-power-pct", value: 5, miscValue: 1 });
    expect(variants.find((v) => v.classMask === 8)!.effects[0]).toMatchObject({ kind: "max-power-pct", value: 5, miscValue: 3 });
  });

  it("Cielonato: Bendicion del viento da 3 % de celeridad y Perspicacia elemental 5 % contra elementales", () => {
    for (const id of [95, 96]) {
      expect(effect(id, "Bendición del viento", "haste-spell-pct")?.value).toBe(3);
      expect(effect(id, "Perspicacia elemental", "damage-vs-creature")).toMatchObject({ value: 5, miscValue: 8 });
    }
  });
});

describe("auditoria de todas las clases y razas", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const classic = JSON.parse(readFileSync(join(root, "data", "external", "classic-stats", "classic-era.json"), "utf8")) as ClassicEra;
  const stats = buildBaseStats(racesData, classic, BUILD);
  const pairs = racesData.races.flatMap((r) => r.classIds.map((c) => ({ raceId: r.id, classId: c })));

  it("cada pareja raza/clase del cliente tiene estadisticas (56 de 56) y ninguna esta en 'sin datos'", () => {
    expect(pairs).toHaveLength(56); // 40 de Classic + 6 nuevas + 10 de Cielonato
    for (const p of pairs) expect(stats.combos.some((c) => c.raceId === p.raceId && c.classId === p.classId), `${p.raceId}/${p.classId}`).toBe(true);
    expect(stats.missing).toEqual([]);
    expect(stats.combos.length).toBe(pairs.length);
  });

  it("cada clase tiene vida/mana base y al menos una raza con estadisticas", () => {
    for (const c of live.classes) {
      expect(stats.classBase.some((b) => b.classId === c.classId), c.className ?? "").toBe(true);
      expect(stats.combos.some((x) => x.classId === c.classId), c.className ?? "").toBe(true);
    }
  });

  it("los atributos crecen o se mantienen con el nivel en todas las combinaciones", () => {
    for (const c of stats.combos) {
      for (let i = 0; i < 5; i++) {
        for (let l = 1; l < 60; l++) expect(c.stats[l]![i]!, `${c.raceId}/${c.classId} nivel ${l + 1} atributo ${i}`).toBeGreaterThanOrEqual(c.stats[l - 1]![i]! - 1);
      }
    }
  });
});

describe("auditoria de la fuente de Classic (valores aislados que no encajan)", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const classic = JSON.parse(readFileSync(join(root, "data", "external", "classic-stats", "classic-era.json"), "utf8")) as ClassicEra;
  const stats = buildBaseStats(racesData, classic, BUILD);
  const audit = auditLevelStats(classic.levelStats);

  it("detecta exactamente los 5 puntos anomalos conocidos de la fuente (si cambia, este test avisa)", () => {
    expect(audit.anomalies.map((a) => `${a.raceId}/${a.classId} L${a.level} ${a.stat}${a.corrected ? " corregido" : ""}`)).toEqual([
      "2/4 L19 agi",
      "2/4 L20 agi",
      "5/8 L1 int corregido",
      "5/8 L1 spi corregido",
      "7/9 L59 spi",
    ]);
  });

  it("corrige el intercambio de intelecto/espiritu del No-muerto mago a nivel 1 en la copia auditada, no en la fuente", () => {
    expect(classic.levelStats[5]![8]![0]!.slice(3)).toEqual([27, 21]); // fuente: intercambiados
    expect(audit.levelStats[5]![8]![0]!.slice(3)).toEqual([21, 27]);
    expect(audit.levelStats[5]![8]![1]).toEqual(classic.levelStats[5]![8]![1]);
  });

  it("stats.json solo informa de dudosos en filas de Classic que usa (hoy ninguna: la base de cada clase es la del Humano o de una raza sin anomalias)", () => {
    expect(stats.anomalies).toEqual([]);
    // Las filas dudosas del Orco pícaro y del Gnomo brujo ya no entran en ninguna cifra
    expect(stats.combos.find((c) => c.raceId === 2 && c.classId === 4)!.stats[18]![1]).toBe(combo(1, 4).stats[18]![1]! - 3);
  });
  function combo(r: number, c: number) {
    return stats.combos.find((x) => x.raceId === r && x.classId === c)!;
  }
});

describe("raciales cuyo valor esta en otro hechizo o es un proc", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const spells = (raceId: number, name: string) => racesData.races.find((r) => r.id === raceId)!.racials.find((a) => a.name === name)!.spells;

  it("Toque de la tumba: 20 % (guerrero, paladin, picaro) o 30 % (lanzadores), 5 % de la salud maxima, 25 s de enfriamiento interno", () => {
    const [melee, casters] = [spells(5, "Toque de la tumba").find((s) => s.classMask === 11)!, spells(5, "Toque de la tumba").find((s) => s.classMask === 400)!];
    expect(melee).toMatchObject({ procChance: 20, procCooldownMs: 25000 });
    expect(casters).toMatchObject({ procChance: 30, procCooldownMs: 25000 });
    expect(melee.effects[0]).toMatchObject({ kind: "proc-drain-health-pct", value: 5 });
  });

  it("Leyline remite a 'Energizado': +100 % de regeneracion de salud y de mana, sin duplicados", () => {
    const e = spells(95, "Leer línea Ley")[0]!.effects;
    expect(e.map((x) => x.kind).sort()).toEqual(["health-regen-pct", "mana-regen-pct"]);
    expect(e.every((x) => x.value === 100 && x.fromSpellId !== null)).toBe(true);
  });

  it("Visión cielonata (Horda) da +10 % de velocidad, tambien al montar", () => {
    const e = spells(96, "Visión cielonata")[0]!.effects;
    expect(e.map((x) => `${x.kind}=${x.value}`).sort()).toEqual(["mounted-speed-pct=10", "movement-speed-pct=10"]);
  });

  it("Canibalizar recupera 7 % de salud y de mana cada 2 s durante 10 s (35 % en total)", () => {
    const s = spells(5, "Canibalizar")[0]!;
    expect(s.durationMs).toBe(10000);
    expect(s.effects.map((x) => `${x.kind}=${x.value}/${x.periodMs}`).sort()).toEqual(["periodic-health-pct=7/2000", "periodic-mana-pct=7/2000"]);
  });

  it("Regeneracion rapida del Trol: 10 % cada 1,2 s durante 6 s = 50 % de la salud maxima", () => {
    const s = spells(8, "Regeneración rápida")[0]!;
    const e = s.effects.find((x) => x.kind === "periodic-health-pct")!;
    expect(e.value * (s.durationMs! / e.periodMs!)).toBe(50);
  });
});

describe("habilidades del Mago (libro de hechizos del cliente)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const data = buildAbilities(raw, live.spells, 8, BUILD, "esES", live.classes.find((c) => c.classId === 8))!;
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "mage.json"), "utf8")).spell_desc as Record<string, { id?: number; l?: string[][]; lv?: string }>;
  const byId = new Map<number, (typeof data.abilities)[number]["ranks"][number]>();
  for (const a of data.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("cumple el esquema y solo hay Mago configurado (una clase sin lineas configuradas devuelve null)", () => {
    expect(() => Abilities.parse(data)).not.toThrow();
    expect(data.abilities).toHaveLength(72);
    expect(data.abilities.reduce((n, a) => n + a.ranks.length, 0)).toBe(220);
    expect(buildAbilities(raw, live.spells, 99, BUILD, "esES")).toBeNull(); // una clase sin SkillLines configuradas no devuelve nada
  });

  it("los rangos de cada habilidad van ordenados por nivel y numerados desde 1", () => {
    for (const a of data.abilities) {
      expect(a.ranks.map((r) => r.rank)).toEqual(a.ranks.map((_, i) => i + 1));
      for (let i = 1; i < a.ranks.length; i++) expect(a.ranks[i]!.level).toBeGreaterThanOrEqual(a.ranks[i - 1]!.level);
    }
  });

  it("coste, lanzamiento, enfriamiento y alcance coinciden con la referencia en los 197 hechizos que comparten", () => {
    let compared = 0;
    const bad: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r) continue;
      compared++;
      const flat = (v.l ?? []).flat().filter(Boolean).join(" | ");
      const mana = /^([\d,]+) Mana/.exec(flat);
      const pct = /(\d+)% of base mana/.exec(flat);
      if (mana ? r.cost !== Number(mana[1]!.replace(/,/g, "")) : pct ? r.costPctOfBase !== Number(pct[1]) : r.cost || r.costPctOfBase) bad.push(`${key} coste`);
      const cast = /([\d.]+) sec cast/.exec(flat);
      if (cast ? r.castMs !== Math.round(Number(cast[1]) * 1000) : /Instant/.test(flat) ? r.castMs !== 0 : /Channeled/.test(flat) && !r.channeled) bad.push(`${key} lanzamiento`);
      const cd = /([\d.]+) (sec|min) cooldown/.exec(flat);
      if (cd ? r.cooldownMs !== Number(cd[1]) * (cd[2] === "min" ? 60000 : 1000) : r.cooldownMs) bad.push(`${key} enfriamiento`);
      const range = /(\d+) yd range/.exec(flat);
      if (range && r.rangeYd !== Number(range[1])) bad.push(`${key} alcance`);
    }
    expect(compared).toBe(197);
    expect(bad).toEqual([]);
  });

  it("el nivel de aprendizaje coincide con la referencia en todos los hechizos (las que ensena un talento: 10 + puntos que exige su fila)", () => {
    const diffs: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      const lv = /Learned at level (\d+)/.exec(v.lv ?? "");
      if (r && lv && r.level !== Number(lv[1])) diffs.push(key.replace(/^Mage\|/, "").replace(/\|.*$/, ""));
    }
    expect(diffs).toEqual([]);
  });

  it("los talentos traen la estructura de sus efectos y si son pasivos o dan una habilidad activa", () => {
    const talents = live.classes.find((c) => c.classToken === "MAGE")!.specs.flatMap((s) => s.talents);
    const impact = talents.find((t) => t.name === "Impacto Arcano")!;
    expect(impact.effectInfo).toEqual([{ index: 0, aura: 107, miscValue: 7, miscValueB: 0, classMask: [538972160, 32768, 0, 0] }]);
    expect(impact.passive).toBe(true);
    expect(talents.filter((t) => !t.passive).map((t) => t.name).sort()).toContain("Poder Arcano");
  });
});

describe("idioma: el cliente trae algunos textos de Forever en ingles", () => {
  const racesData = buildRaces(openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`)), BUILD, "esES", live.spells);
  const all = live.classes.flatMap((c) => c.specs.flatMap((s) => s.talents.map((t) => ({ cls: c.className, t }))));

  it("detecta ingles y no se confunde con el espanol del cliente", () => {
    expect(looksEnglish("Gives your spells a $s1% chance to not lose casting time when you take damage.")).toBe(true);
    expect(looksEnglish("Te da un $m1% de probabilidad de evitar la interrupción causada por daño mientras lanzas cualquier hechizo.")).toBe(false);
    expect(looksEnglish("Aumenta un $s1% la probabilidad de conseguir un golpe crítico con todos los hechizos y ataques.")).toBe(false);
    expect(looksEnglish("")).toBe(false);
  });

  it("ningun talento de clase se muestra en ingles: los que el cliente trae sin traducir llevan traduccion propia marcada (hoy solo Tromba de misiles)", () => {
    const own = all.filter(({ t }) => t.textOrigin === "translated-by-us").map(({ cls, t }) => `${cls}: ${t.name}`);
    // Hasta el 17/10 eran 13; los hotfixes del 19/10 traducen 12 y dejan Tromba de misiles en ingles (y le anaden Explosion de Escarcha)
    expect(own).toEqual(["Mago: Tromba de misiles"]);
    expect(all.filter(({ t }) => t.textOrigin === "untranslated")).toEqual([]);
    for (const { t } of all) for (const d of t.descriptions) expect(looksEnglish(d), `${t.name}: ${d}`).toBe(false);
  });

  it("la traduccion propia conserva los numeros del cliente (Intensidad del Brujo 23 %, Canalizacion mejorada 20 % y 14 %)", () => {
    const text = (name: string) => all.find(({ t }) => t.name === name)!.t.descriptions;
    expect(text("Intensidad")[0]).toContain("23%");
    expect(text("Canalización mejorada")[4]).toMatch(/100%.*70%/);
  });

  it("las raciales de Cielonato salen en espanol: nombres de sus hechizos y Leer linea ley con traduccion propia", () => {
    const skyborne = racesData.races.filter((r) => r.id >= 95).flatMap((r) => r.racials);
    expect(skyborne.map((a) => a.name)).not.toContain("Walk on Air");
    // Desde el hotfix del 19/10 el cliente trae el nombre y el texto en espanol (antes eran traduccion propia)
    expect(skyborne.find((a) => a.name === "Leer línea Ley")!.textOrigin).toBe("client");
    expect(skyborne.filter((a) => looksEnglish(a.description))).toEqual([]);
    expect(skyborne.filter((a) => a.name === "Caminar sobre el aire")).toHaveLength(2);
  });
});

describe("habilidades del Pícaro (libro de hechizos del cliente)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const data = buildAbilities(raw, live.spells, 4, BUILD, "esES", live.classes.find((c) => c.classId === 4))!;
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "rogue.json"), "utf8")).spell_desc as Record<string, { id?: number; l?: string[][]; lv?: string }>;
  const byId = new Map<number, (typeof data.abilities)[number]["ranks"][number]>();
  for (const a of data.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("cumple el esquema y trae las lineas de Combate, Sutileza, Venenos y Asesinato", () => {
    expect(() => Abilities.parse(data)).not.toThrow();
    expect(data.abilities).toHaveLength(53);
    expect(data.abilities.reduce((n, a) => n + a.ranks.length, 0)).toBe(135);
  });

  it("Mutilar tiene los 4 rangos de la referencia: los golpes auxiliares de cada mano (sin texto) no cuentan como rangos", () => {
    const m = data.abilities.find((a) => a.name === "Mutilar")!;
    expect(m.ranks.map((r) => r.spellId)).toEqual([1310707, 399956, 1241582, 1241584]);
  });

  it("coste (energia), lanzamiento, enfriamiento, alcance y nivel coinciden con la referencia en los 119 hechizos que comparten", () => {
    let compared = 0;
    const bad: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r) continue;
      compared++;
      const flat = (v.l ?? []).flat().filter(Boolean).join(" | ");
      const cost = /^([\d,]+) (Mana|Energy|Rage)/.exec(flat);
      if (cost ? r.cost !== Number(cost[1]!.replace(/,/g, "")) * (cost[2] === "Rage" ? 10 : 1) : r.cost) bad.push(`${key} coste`);
      const cast = /([\d.]+) sec cast/.exec(flat);
      if (cast ? r.castMs !== Math.round(Number(cast[1]) * 1000) : /Instant/.test(flat) ? r.castMs !== 0 : false) bad.push(`${key} lanzamiento`);
      const cd = /([\d.]+) (sec|min) cooldown/.exec(flat);
      if (cd ? r.cooldownMs !== Number(cd[1]) * (cd[2] === "min" ? 60000 : 1000) : r.cooldownMs) bad.push(`${key} enfriamiento`);
      const range = /(\d+) yd range/.exec(flat);
      if (range && r.rangeYd !== Number(range[1])) bad.push(`${key} alcance`);
      const lv = /Learned at level (\d+)/.exec(v.lv ?? "");
      if (lv && r.level !== Number(lv[1])) bad.push(`${key} nivel`);
    }
    expect(compared).toBe(119);
    expect(bad).toEqual([]);
  });

  it("los venenos se aprenden por SpellLevel y las habilidades de talento al nivel de su fila (Sangre fria 25, Frenesi de cuchillas 30)", () => {
    const level = (name: string) => data.abilities.find((a) => a.name === name)!.ranks[0]!;
    expect(level("Sangre fría")).toMatchObject({ level: 25, learnedByTalent: true });
    expect(level("Veneno instantáneo").level).toBe(20);
  });
});

describe("habilidades del Guerrero (libro de hechizos del cliente)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const data = buildAbilities(raw, live.spells, 1, BUILD, "esES", live.classes.find((c) => c.classId === 1))!;
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "warrior.json"), "utf8")).spell_desc as Record<string, { id?: number; l?: string[][]; lv?: string }>;
  const byId = new Map<number, (typeof data.abilities)[number]["ranks"][number]>();
  for (const a of data.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("cumple el esquema y trae las lineas de Armas, Furia y Proteccion", () => {
    expect(() => Abilities.parse(data)).not.toThrow();
    expect(data.abilities).toHaveLength(50);
    expect(data.abilities.reduce((n, a) => n + a.ranks.length, 0)).toBe(125);
    expect(data.warnings).toEqual([]);
  });

  it("coste (ira x10 en el cliente), lanzamiento, enfriamiento, alcance y nivel coinciden con la referencia en los 116 hechizos que comparten", () => {
    let compared = 0;
    const bad: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r) continue;
      compared++;
      const flat = (v.l ?? []).flat().filter(Boolean).join(" | ");
      const cost = /^([\d,]+) (Mana|Energy|Rage)/.exec(flat);
      if (cost ? r.cost !== Number(cost[1]!.replace(/,/g, "")) * (cost[2] === "Rage" ? 10 : 1) : r.cost) bad.push(`${key} coste`);
      const cast = /([\d.]+) sec cast/.exec(flat);
      if (cast ? r.castMs !== Math.round(Number(cast[1]) * 1000) : /Instant/.test(flat) ? r.castMs !== 0 : false) bad.push(`${key} lanzamiento`);
      const cd = /([\d.]+) (sec|min) cooldown/.exec(flat);
      if (cd ? r.cooldownMs !== Number(cd[1]) * (cd[2] === "min" ? 60000 : 1000) : r.cooldownMs) bad.push(`${key} enfriamiento`);
      const range = /(\d+) yd range/.exec(flat);
      if (range && r.rangeYd !== Number(range[1])) bad.push(`${key} alcance`);
      const lv = /Learned at level (\d+)/.exec(v.lv ?? "");
      if (lv && r.level !== Number(lv[1])) bad.push(`${key} nivel`);
    }
    expect(compared).toBe(116);
    expect(bad).toEqual([]);
  });

  it("Ejecutar tiene los 5 rangos de la referencia: el hechizo auxiliar sin texto (20647) no cuenta como rango", () => {
    const e = data.abilities.find((a) => a.name === "Ejecutar")!;
    expect(e.ranks.map((r) => r.spellId)).toEqual([5308, 20658, 20660, 20661, 20662]);
  });
});

describe("habilidades del Paladin (libro de hechizos del cliente)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const data = buildAbilities(raw, live.spells, 2, BUILD, "esES", live.classes.find((c) => c.classId === 2))!;
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "paladin.json"), "utf8")).spell_desc as Record<string, { id?: number; l?: string[][]; lv?: string }>;
  const byId = new Map<number, (typeof data.abilities)[number]["ranks"][number]>();
  for (const a of data.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("cumple el esquema y trae las lineas de Sagrado, Proteccion y Reprension", () => {
    expect(() => Abilities.parse(data)).not.toThrow();
    expect(data.abilities).toHaveLength(66);
    expect(data.abilities.reduce((n, a) => n + a.ranks.length, 0)).toBe(184);
  });

  it("los hechizos auxiliares (1 punto de Luz Sagrada, mitades de Choque Sagrado, debilitamientos de las Sentencias) no son rangos: los rangos por nombre cuadran con la referencia", () => {
    const ranks = (name: string) => data.abilities.find((a) => a.name === name)!.ranks.length;
    expect([ranks("Luz Sagrada"), ranks("Destello de Luz"), ranks("Choque Sagrado"), ranks("Sello de rectitud")]).toEqual([9, 6, 4, 8]);
    expect(data.abilities.some((a) => ["Sentencia de Luz", "Sentencia de furia", "Sentencia del cruzado"].includes(a.name))).toBe(false);
    // Las habilidades de runa de Forever con el nombre de una normal van aparte
    expect(ranks("Exorcismo")).toBe(6);
    expect(ranks("Exorcismo (runa)")).toBe(6);
  });

  it("coste, lanzamiento, enfriamiento, alcance y nivel coinciden con la referencia en los hechizos que comparten", () => {
    let compared = 0;
    const bad: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r) continue;
      compared++;
      const flat = (v.l ?? []).flat().filter(Boolean).join(" | ");
      const mana = /(?:^|\| )([\d,]+) Mana/.exec(flat);
      const pct = /(\d+)% of base mana/.exec(flat);
      if (mana ? r.cost !== Number(mana[1]!.replace(/,/g, "")) : pct ? r.costPctOfBase !== Number(pct[1]) : r.cost || r.costPctOfBase) bad.push(`${key} coste`);
      const cast = /([\d.]+) sec cast/.exec(flat);
      if (cast ? r.castMs !== Math.round(Number(cast[1]) * 1000) : /Instant/.test(flat) ? r.castMs !== 0 : false) bad.push(`${key} lanzamiento`);
      const cd = /([\d.]+) (sec|min|hour) cooldown/.exec(flat);
      if (cd ? r.cooldownMs !== Number(cd[1]) * ({ sec: 1000, min: 60000, hour: 3600000 }[cd[2] as "sec" | "min" | "hour"]) : r.cooldownMs) bad.push(`${key} enfriamiento`);
      // Choque Sagrado y Vigilia de la Luz traen dos alcances (enemigo / amigo): el cliente guarda el mayor
      const ranges = [...flat.matchAll(/(\d+) yd range/g)].map((m) => Number(m[1]));
      if (ranges.length && r.rangeYd !== Math.max(...ranges)) bad.push(`${key} alcance`);
      const lv = /Learned at level (\d+)/.exec(v.lv ?? "");
      if (lv && r.level !== Number(lv[1])) bad.push(`${key} nivel`);
    }
    expect(compared).toBe(167);
    // Furia justa: el hotfix del 23/10 la baja de nivel 16 a 10 (SpellLevels del cliente); la referencia externa aún dice 16
    expect(bad).toEqual(["Paladin|Righteous Fury| nivel"]);
  });
});

describe("habilidades del Sacerdote (libro de hechizos del cliente)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const data = buildAbilities(raw, live.spells, 5, BUILD, "esES", live.classes.find((c) => c.classId === 5))!;
  const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "priest.json"), "utf8")).spell_desc as Record<string, { id?: number; l?: string[][]; lv?: string }>;
  const byId = new Map<number, (typeof data.abilities)[number]["ranks"][number]>();
  for (const a of data.abilities) for (const r of a.ranks) byId.set(r.spellId, r);

  it("cumple el esquema y trae las lineas de Disciplina, Sagrado y Sombras", () => {
    expect(() => Abilities.parse(data)).not.toThrow();
    expect(data.abilities).toHaveLength(75);
    expect(data.abilities.reduce((n, a) => n + a.ranks.length, 0)).toBe(269);
  });

  it("las habilidades de raza del Sacerdote van ligadas a su raza por las mascaras del cliente; Peste devoradora y Custodia de miedo son de todas", () => {
    const races = (name: string) => [...new Set(data.abilities.find((a) => a.name === name)!.ranks.map((r) => JSON.stringify(r.races)))];
    // Humano 1, Enano 3, Elfo de la noche 4, No-muerto 5, Gnomo 7, Trol 8
    expect(races("Rezo desesperado")).toEqual(["[3]"]);
    expect(races("Castigar")).toEqual(["[3]"]);
    expect(races("Rebote")).toEqual(["[1]"]);
    expect(races("Gracia divina")).toEqual(["[1]"]);
    expect(races("Gracia de Elune")).toEqual(["[4]"]);
    expect(races("Fragmentos estelares")).toEqual(["[4]"]);
    expect(races("Toque de debilidad")).toEqual(["[5]"]);
    expect(races("Sacrificio oscuro")).toEqual(["[5]"]);
    expect(races("Plan de contingencia")).toEqual(["[7]"]);
    expect(races("Destello desconcertante")).toEqual(["[7]"]);
    expect(races("Maleficio de debilidad")).toEqual(["[8]"]);
    expect(races("Guardia de las Sombras")).toEqual(["[8]"]);
    expect(races("Peste devoradora")).toEqual(["null"]);
    expect(races("Custodia de miedo")).toEqual(["null"]);
    expect(races("Palabra de poder: escudo")).toEqual(["null"]);
  });

  it("la ranura «Facultad racial de sacerdote» y los cuatro «Secretos de…» entran como habilidades del Sacerdote (sin cifras)", () => {
    for (const n of ["Facultad racial de sacerdote", "Secretos de la Luz", "Secretos de Elune", "Secretos de los loa", "Secretos de la no-muerte"]) {
      const a = data.abilities.find((x) => x.name === n);
      expect(a, n).toBeDefined();
      expect(a!.ranks[0]!.level).toBe(1);
    }
  });

  it("los hechizos auxiliares (descargas de Guardia de las Sombras, debilitamiento de Toque de debilidad, golpes de Penitencia) no son rangos: los rangos por nombre cuadran con la referencia", () => {
    const ranks = (name: string) => data.abilities.find((a) => a.name === name)!.ranks.length;
    expect([ranks("Guardia de las Sombras"), ranks("Toque de debilidad"), ranks("Penitencia"), ranks("Renovar"), ranks("Abrasamiento mental")]).toEqual([6, 6, 4, 10, 1]);
    // Las runas de Forever con el nombre de una normal van aparte
    expect(ranks("Renovar (runa)")).toBe(10);
    expect(data.abilities.some((a) => a.name === "Penitencia (runa)")).toBe(false);
  });

  it("coste, lanzamiento, enfriamiento, alcance y nivel coinciden con la referencia en los hechizos que comparten", () => {
    let compared = 0;
    const bad: string[] = [];
    for (const [key, v] of Object.entries(tf)) {
      const r = v.id ? byId.get(v.id) : undefined;
      if (!r) continue;
      compared++;
      const flat = (v.l ?? []).flat().filter(Boolean).join(" | ");
      const mana = /(?:^|\| )([\d,]+) Mana/.exec(flat);
      const pct = /(\d+)% of base mana/.exec(flat);
      if (mana ? r.cost !== Number(mana[1]!.replace(/,/g, "")) : pct ? r.costPctOfBase !== Number(pct[1]) : r.cost || r.costPctOfBase) bad.push(`${key} coste`);
      const cast = /([\d.]+) sec cast/.exec(flat);
      if (cast ? r.castMs !== Math.round(Number(cast[1]) * 1000) : /Instant/.test(flat) ? r.castMs !== 0 : false) bad.push(`${key} lanzamiento`);
      const cd = /([\d.]+) (sec|min|hour) cooldown/.exec(flat);
      if (cd ? r.cooldownMs !== Number(cd[1]) * ({ sec: 1000, min: 60000, hour: 3600000 }[cd[2] as "sec" | "min" | "hour"]) : r.cooldownMs) bad.push(`${key} enfriamiento`);
      // Choque Sagrado y Vigilia de la Luz traen dos alcances (enemigo / amigo): el cliente guarda el mayor
      const ranges = [...flat.matchAll(/(\d+) yd range/g)].map((m) => Number(m[1]));
      if (ranges.length && r.rangeYd !== Math.max(...ranges)) bad.push(`${key} alcance`);
      const lv = /Learned at level (\d+)/.exec(v.lv ?? "");
      if (lv && r.level !== Number(lv[1])) bad.push(`${key} nivel`);
    }
    expect(compared).toBe(238);
    expect(bad).toEqual([]);
  });
});

describe("textos de los talentos del Paladin frente a la referencia", () => {
  const tfTrees = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "paladin.json"), "utf8")).talents.trees as { talents: { name: string; max: number; row: number; col: number; desc: string[] }[] }[];
  const ours = byToken(live, "PALADIN");
  const nums = (t: string | undefined) => [...(t ?? "").replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).sort((a, b) => a - b).join(",");

  it("las cifras de cada rango coinciden con la referencia; las que no, dependen del nivel (valores base) y estan marcadas", () => {
    let total = 0;
    const diff: string[] = [];
    tfTrees.forEach((tree, si) => {
      for (const t of tree.talents) {
        const o = ours.specs[si]!.talents.find((x) => x.row === t.row - 1 && x.col === t.col - 1)!;
        expect(o, t.name).toBeDefined();
        for (let r = 0; r < t.max; r++) {
          total++;
          if (nums(t.desc[r]) !== nums(o.descriptions[r])) {
            diff.push(`${o.name} r${r + 1}`);
            // Campeon de la Luz: hotfix del servidor del 16/10 (10/20/30 -> 20/40/60 % del intelecto); la referencia aun trae 10/20/30
            if (o.name !== "Campeón de la Luz") expect(o.descriptionsApproximate, `${o.name} r${r + 1} difiere de la referencia y no esta marcado como valor base`).toBe(true);
          }
        }
      }
    });
    expect(total).toBe(138);
    // Choque Sagrado, Vigilia de la Luz, Sello de orden (nivel), Sello de furia mejorado (1 p. por nivel), Reivindicacion x3 (poder de ataque por nivel)
    expect(diff).toEqual(["Choque Sagrado r1", "Vigilia de la Luz r1", "Sello de furia mejorado r1", "Reivindicación r1", "Reivindicación r2", "Reivindicación r3", "Sello de orden r1"]);
    // Campeón de la Luz (10/20/30 % del intelecto) ya coincide con la referencia desde su export del 27/10 (build 70630)
  });

  it("$proccooldown sale del cliente: Especializacion en escudos 3 s y La hora de la verdad 1,5 s (como la referencia)", () => {
    const text = (name: string) => ours.specs.flatMap((s) => s.talents).find((t) => t.name === name)!.descriptions.at(-1)!;
    expect(text("Especialización en escudos")).toMatch(/una vez cada 3 s\.$/);
    expect(text("La hora de la verdad")).toMatch(/una vez cada 1,5 s( tras un bloqueo)?\.$/);
    for (const c of live.classes) for (const t of c.specs.flatMap((s) => s.talents)) expect(t.descriptions.join(" "), `${c.classToken} ${t.name}`).not.toMatch(/proccooldown/i);
  });
});

describe("textos de los talentos del Sacerdote frente a la referencia", () => {
  const tfTrees = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "priest.json"), "utf8")).talents.trees as { talents: { name: string; max: number; row: number; col: number; desc: string[] }[] }[];
  const ours = byToken(live, "PRIEST");
  const nums = (t: string | undefined) => [...(t ?? "").replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).sort((a, b) => a - b).join(",");

  it("las cifras de cada rango coinciden con la referencia; las que no, dependen del nivel (valores base) y estan marcadas", () => {
    let total = 0;
    const diff: string[] = [];
    tfTrees.forEach((tree, si) => {
      for (const t of tree.talents) {
        const o = ours.specs[si]!.talents.find((x) => x.row === t.row - 1 && x.col === t.col - 1)!;
        expect(o, t.name).toBeDefined();
        for (let r = 0; r < t.max; r++) {
          total++;
          if (nums(t.desc[r]) !== nums(o.descriptions[r])) {
            diff.push(`${o.name} r${r + 1}`);
            expect(o.descriptionsApproximate, `${o.name} r${r + 1} difiere de la referencia y no esta marcado como valor base`).toBe(true);
          }
        }
      }
    });
    expect(total).toBe(148);
    // Penitencia, Nova Sagrada y Sanacion conjunta: cifras que escalan con el nivel (valor base frente al del nivel 60 de la referencia)
    expect(diff).toEqual(["Penitencia r1", "Nova Sagrada r1", "Sanación conjunta r1"]);
  });

  it("las variables del personaje se resuelven sin poder con hechizos: Egida divina 1200 (20 x $pl) y Rezo de alivio 172 ($bh y $bc valen 0), como la referencia", () => {
    const text = (name: string, r = 0) => ours.specs.flatMap((s) => s.talents).find((t) => t.name === name)!.descriptions[r]!;
    expect(text("Égida divina", 2)).toContain("Absorbe 1200 p. de daño");
    expect(text("Rezo de alivio")).toContain("lo sanará 172 p.");
    for (const t of ours.specs.flatMap((s) => s.talents)) expect(t.descriptions.join(" "), t.name ?? "").not.toMatch(/\$pl|\$b[hc]|\$<mult>/);
  });
});

describe("habilidades de Chaman, Cazador, Brujo y Druida frente a la referencia (coste, lanzamiento, enfriamiento, alcance y nivel)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const classes = [
    { id: 7, token: "shaman", name: "Chaman", abilities: 66, ranks: 207, compared: 183 },
    { id: 3, token: "hunter", name: "Cazador", abilities: 68, ranks: 171, compared: 145 },
    { id: 9, token: "warlock", name: "Brujo", abilities: 66, ranks: 198, compared: 171 },
    { id: 11, token: "druid", name: "Druida", abilities: 69, ranks: 221, compared: 207 },
  ];
  for (const c of classes) {
    it(`${c.name}: cumple el esquema y coincide con la referencia`, () => {
      const data = buildAbilities(raw, live.spells, c.id, BUILD, "esES", live.classes.find((x) => x.classId === c.id))!;
      expect(() => Abilities.parse(data)).not.toThrow();
      const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", `${c.token}.json`), "utf8")).spell_desc as Record<string, { id?: number; l?: string[][]; lv?: string }>;
      const byId = new Map<number, (typeof data.abilities)[number]["ranks"][number]>();
      for (const a of data.abilities) for (const r of a.ranks) byId.set(r.spellId, r);
      let compared = 0;
      const bad: string[] = [];
      for (const [key, v] of Object.entries(tf)) {
        const r = v.id ? byId.get(v.id) : undefined;
        if (!r) continue;
        compared++;
        const flat = (v.l ?? []).flat().filter(Boolean).join(" | ");
        const mana = /(?:^|\| )([\d,]+) (Mana|Energy|Rage|Health)/.exec(flat);
        const pct = /([\d.]+)% of base mana/.exec(flat);
        const scale = mana?.[2] === "Rage" ? 10 : 1;
        if (mana ? r.cost !== Number(mana[1]!.replace(/,/g, "")) * scale : pct ? r.costPctOfBase !== Number(pct[1]) : r.cost || r.costPctOfBase) bad.push(`${key} coste`);
        const cast = /([\d.]+) sec cast/.exec(flat);
        if (cast ? r.castMs !== Math.round(Number(cast[1]) * 1000) : /Instant/.test(flat) ? r.castMs !== 0 : false) bad.push(`${key} lanzamiento`);
        const cd = /([\d.]+) (sec|min|hour) cooldown/.exec(flat);
        if (cd ? r.cooldownMs !== Number(cd[1]) * ({ sec: 1000, min: 60000, hour: 3600000 }[cd[2] as "sec" | "min" | "hour"]) : r.cooldownMs) bad.push(`${key} enfriamiento`);
        const ranges = [...flat.matchAll(/(\d+) yd range/g)].map((m) => Number(m[1]));
        if (ranges.length && r.rangeYd !== Math.max(...ranges)) bad.push(`${key} alcance`);
        const lv = /Learned at level (\d+)/.exec(v.lv ?? "");
        if (lv && r.level !== Number(lv[1])) bad.push(`${key} nivel`);
      }
      expect(bad).toEqual([]);
      expect([data.abilities.length, data.abilities.reduce((n, a) => n + a.ranks.length, 0), compared]).toEqual([c.abilities, c.ranks, c.compared]);
    });
  }
});

describe("textos de los talentos de Chaman, Cazador, Brujo y Druida frente a la referencia", () => {
  const nums = (t: string | undefined) => [...(t ?? "").replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d),(\d)/g, "$1.$2").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).sort((a, b) => a - b).join(",");
  // Diferencias esperadas: cifras que escalan con el nivel (valor base frente al del nivel 60 de la referencia) o formulas del texto sin resolver
  const CASES = [
    { token: "SHAMAN", file: "shaman", total: 148, diff: ["Ráfaga de lava r1", "Mareas vivas r1"], notApprox: [] as string[] },
    // Aura de disparo certero r1: el 70658 baja el poder de ataque a distancia de 30 a 15 (y Aspecto del halcón, Pies de plomo); la referencia (70630) aún trae 30
    { token: "HUNTER", file: "hunter", total: 148, diff: ["Aura de disparo certero r1", "Contraataque r1"], notApprox: ["Aura de disparo certero r1", "Contraataque r1"] },
    // Amplificar maldición r1 (hotfix del 16/10, Maldición de agotamiento 50 % → 20 %): la referencia ya lo trae desde su export del 27/10.
    { token: "WARLOCK", file: "warlock", total: 146, diff: ["Quemadura de las Sombras r1", "Conflagrar r1", "Terror de caos r1", "Incinerar r1"], notApprox: ["Terror de caos r1"] },
    { token: "DRUID", file: "druid", total: 148, diff: ["Carga feral r1", "Crecimiento salvaje r1"], notApprox: ["Carga feral r1"] },
  ];
  for (const c of CASES) {
    it(`${c.token}: las cifras de cada rango coinciden con la referencia salvo ${c.diff.length} (nivel / formulas conocidas)`, () => {
      const tfTrees = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", `${c.file}.json`), "utf8")).talents.trees as { talents: { name: string; max: number; row: number; col: number; desc: string[] }[] }[];
      const ours = byToken(live, c.token);
      let total = 0;
      const diff: string[] = [];
      const unflagged: string[] = [];
      tfTrees.forEach((tree, si) => {
        for (const t of tree.talents) {
          const o = ours.specs[si]!.talents.find((x) => x.row === t.row - 1 && x.col === t.col - 1)!;
          for (let r = 0; r < t.max; r++) {
            total++;
            if (nums(t.desc[r]) !== nums(o.descriptions[r])) {
              diff.push(`${o.name} r${r + 1}`);
              if (!o.descriptionsApproximate) unflagged.push(`${o.name} r${r + 1}`);
            }
          }
        }
      });
      expect(total).toBe(c.total);
      expect(diff).toEqual(c.diff);
      // Las que difieren y no estan marcadas como valor base son casos distintos (poder de ataque 50 % de arma de la referencia, texto con formula): se listan aqui para no perderlos
      expect(unflagged).toEqual(c.notApprox);
    });
  }

  it("los marcadores de referencia ya no salen crudos: $@spelltooltip, $c, $s2 de un hechizo de un efecto y el poder de ataque a distancia", () => {
    const text = (token: string, name: string) => byToken(live, token).specs.flatMap((s) => s.talents).find((t) => t.name === name)!.descriptions[0]!;
    expect(text("WARLOCK", "Amplificar maldición")).toContain("siguiente Maldición de agotamiento un 20%");
    expect(text("DRUID", "Poder cambiante")).toContain("55 % del maná base en 40 p. de energía");
    expect(text("DRUID", "Carga feral")).not.toContain("$@");
    expect(text("HUNTER", "Invocar halcón")).toContain("32 (más un 5% de tu poder de ataque a distancia)");
    for (const c of live.classes) for (const t of c.specs.flatMap((s) => s.talents)) expect(t.descriptions.join(" "), `${c.classToken} ${t.name}`).not.toMatch(/\$@|\$rap|\$c p\./);
  });
});

describe("variables de descripcion de Forever ($<minDam>, $<damagepower>, $<base>, $b1) frente a la referencia", () => {
  it("Marca demoniaca: 65 a 68 de dano ($<minDam> y $<maxDam> a nivel 60 sin poder con hechizos), como la referencia", () => {
    const t = byToken(live, "WARLOCK").specs.flatMap((s) => s.talents).find((x) => x.name === "Marca demoníaca")!;
    expect(t.descriptions[0]).toContain("infligen de 65 a 68 de daño");
    expect(t.descriptionsApproximate).toBe(true);
  });

  it("Eviscerar: los rangos 2, 5 y 8 de la referencia coinciden punto a punto (formula con $<base>, $<percombo>, $<mult> y $b1)", () => {
    const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
    const data = buildAbilities(raw, live.spells, 4, BUILD, "esES", live.classes.find((c) => c.classId === 4))!;
    const tf = JSON.parse(readFileSync(join(root, "data", "external", "talentsforever", "rogue.json"), "utf8")).spell_desc as Record<string, { id?: number; d?: string }>;
    const evis = data.abilities.find((a) => a.name === "Eviscerar")!;
    let checked = 0;
    for (const [key, v] of Object.entries(tf)) {
      if (!key.startsWith("Rogue|Eviscerate|Rank")) continue;
      const rank = evis.ranks.find((r) => r.spellId === v.id);
      if (!rank) continue;
      const want = [...v.d!.matchAll(/([\d,]+)-([\d,]+) damage/g)].map((m) => `${m[1]}-${m[2]}`.replace(/,/g, ""));
      const got = [...rank.description.matchAll(/(\d+)-(\d+) p\. de daño/g)].map((m) => `${m[1]}-${m[2]}`);
      expect(got, key).toEqual(want);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it("los efectos de los hechizos nuevos llevan el polinomio del nivel: Pua mental 132 % = 248 a nivel 60", () => {
    const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
    const data = buildAbilities(raw, live.spells, 5, BUILD, "esES", live.classes.find((c) => c.classId === 5))!;
    const e = data.abilities.find((a) => a.name === "Púa mental")!.ranks[0]!.effects[0]!;
    expect(e.levelPoly).not.toBeNull();
    const [a, b, c] = e.levelPoly!;
    expect(Math.round((e.base * (a + b * 60 + c * 3600)) / 100)).toBe(248);
  });
});

describe("contraste de habilidades y Legacy con la referencia (lo que la referencia no lista se conserva y se marca)", () => {
  const tfDir = join(root, "data", "external", "talentsforever");
  const gone = JSON.parse(readFileSync(join(root, "data", "rules", "tf-gone.json"), "utf8")).classes as Record<string, Record<string, string | null>>;
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const run = (classId: number, token: string) => {
    const data = Abilities.parse(buildAbilities(raw, live.spells, classId, BUILD, "esES", live.classes.find((c) => c.classId === classId)));
    return contrastAbilities(data, token, tfDir, gone[token] ?? {})!;
  };

  it("cada habilidad lleva su estado y nada se descarta: listadas + parciales + no listadas + retiradas = todas", () => {
    for (const [id, token] of [[1, "warrior"], [2, "paladin"], [4, "rogue"], [5, "priest"], [8, "mage"]] as const) {
      const { abilities, report } = run(id, token);
      expect(abilities.abilities.every((a) => a.talentsForever !== null)).toBe(true);
      expect(report.listed + report.partial.length + report.notListed.length + report.retired.length).toBe(abilities.abilities.length);
      expect(report.tfOnly, `${token}: hechizos de la referencia que no tenemos`).toEqual([]);
    }
  });

  it("las runas de Forever que la referencia no lista se marcan como runa y Pozo de Luz como retirada segun la referencia (el cliente aun la trae)", () => {
    const priest = run(5, "priest").abilities.abilities;
    const wells = priest.find((a) => a.name === "Pozo de Luz")!;
    expect(wells.talentsForever).toMatchObject({ status: "retired", listedRanks: 0 });
    expect(wells.ranks.map((r) => r.level)).toEqual([40, 50, 60]);
    const renew = priest.find((a) => a.name === "Renovar (runa)")!;
    expect(renew.talentsForever!.status).toBe("not-listed");
    expect(renew.talentsForever!.note).toContain("runa");
    expect(priest.find((a) => a.name === "Renovar")!.talentsForever!.status).toBe("listed");
    // Cono de frio: La referencia lista 4 de sus 5 rangos
    expect(run(8, "mage").report.partial).toEqual(["Cono de frío 4/5"]);
  });

  it("Legacy: las 27 ventajas de la referencia caen en la misma posicion del cliente (la referencia declara ya el cliente 1.60.1.70425; antes 70170 y 2 estaban en otra columna)", () => {
    const lc = contrastLegacy(ClassTalents.parse(JSON.parse(readFileSync(join(root, "data", "forever", BUILD, "legacy.json"), "utf8"))), tfDir)!;
    expect(lc.tfSource).toContain("1.60.1.70425");
    expect(lc.perks).toBe(27);
    expect(lc.matchedPositions).toBe(27);
    // Solo queda Estudio dedicado (3 esencias en el cliente, 2 a 4 en la referencia)
    expect(lc.diffs).toHaveLength(lc.diffs.filter((d) => d.startsWith("Professions: «Dedicated Study»")).length);
    expect(lc.diffs.filter((d) => d.startsWith("Professions: «Dedicated Study»"))).toHaveLength(1);
  });
});

describe("entradas de talento sin nodo frente a la referencia", () => {
  it("la mayoria tiene gemela en la referencia (mismas cifras); las que no, quedan listadas con su nombre", () => {
    const un = JSON.parse(readFileSync(join(root, "data", "forever", BUILD, "unassigned.json"), "utf8")) as { orphanEntries: { name: string | null; descriptions: string[] }[] };
    const oc = contrastOrphans(un.orphanEntries, join(root, "data", "external", "talentsforever"))!;
    expect(oc.total).toBe(99);
    expect(oc.withTfTwin + oc.withoutTfTwin.length).toBe(99);
    expect(oc.withTfTwin).toBeGreaterThanOrEqual(60);
    // Las ventajas de Legacy sin colocar con otras cifras que las de la referencia (la referencia viene de un cliente mas antiguo)
    expect(oc.withoutTfTwin.map((o) => o.name)).toContain("Estudio dedicado");
  });
});

describe("formulas de combate de Classic (estimacion)", () => {
  const file = join(root, "data", "rules", "combat-formulas.json");
  const { _readme, ...raw } = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

  it("cumplen el esquema y se declaran como community con confianza baja (no son de Forever)", () => {
    const f = CombatFormulas.parse(raw);
    expect(_readme).toBeTruthy();
    expect(f.provenance).toBe("community");
    expect(f.confidence).toBe("low");
  });

  it("tablas de fallo de la comunidad: hechizos 4 % / 17 % y cuerpo a cuerpo 5 % / 8 % (5 % + 15 puntos de arma x 0,2 %); sin 1 % minimo de fallo: tope 100 %", () => {
    const f = CombatFormulas.parse(raw);
    expect(f.miss).toEqual({ spell: { same: 4, boss: 17 }, melee: { same: 5, boss: 8 } });
    expect(f.miss.melee.boss).toBeCloseTo(f.miss.melee.same + 15 * 0.2, 6);
    expect(f.hitCap).toEqual({ spell: 100, melee: 100 });
    expect(f.dualWieldMissPenalty).toBe(19);
    expect(f.critSuppression).toEqual({ meleeBossSkill: 3, meleeBossAuraMax: 1.8, spellBoss: 0 });
    expect(f.critMultiplier).toEqual({ spell: 1.5, physical: 2 });
  });

  it("valores base por clase (comunidad): las 9 clases, y el critico/mana base coinciden con el cliente", () => {
    const f = CombatFormulas.parse(raw);
    expect(f.classBase.map((c) => c.classId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 11]);
    // La comunidad da el critico y el esquive base de las clases con mana distintos de 0 y 0 para guerrero, picaro y cazador (fisico)
    const byClass = new Map(f.classBase.map((c) => [c.classId, c]));
    expect(byClass.get(8)).toMatchObject({ spellCritPct: 0.2, physicalCritPct: 3.2, dodgePct: 3.2 });
    expect(byClass.get(2)).toMatchObject({ spellCritPct: 3.5, physicalCritPct: 0.7 });
    // El poder de ataque base (Classic) reproduce las cifras de la comunidad a nivel 60
    const ap60 = (id: number) => byClass.get(id)!.attackPower.perLevel * 60 + byClass.get(id)!.attackPower.flat;
    expect([1, 2, 3, 4, 5, 7, 8, 9, 11].map(ap60)).toEqual([160, 160, 100, 100, -10, 100, -10, -10, -20]);
    const hunter = byClass.get(3)!.rangedAttackPower!;
    expect(hunter.perLevel * 60 + hunter.flat).toBe(110);
  });

  it("ya no lleva ratios de critico: salen del cliente (client-stats.json)", () => {
    expect(raw).not.toHaveProperty("spellCrit");
    expect(raw).not.toHaveProperty("meleeCrit");
  });
});

describe("estadisticas por clase y nivel del cliente (PlayerExpectedStat y ChrClasses)", () => {
  const cs = ClientStats.parse(JSON.parse(readFileSync(join(root, "data", "forever", BUILD, "client-stats.json"), "utf8")));
  const row = (classId: number, level: number) => cs.classes.find((c) => c.classId === classId)!.levels.find((l) => l.level === level)!;
  const perPercent = (x: number) => Math.round((1 / (x * 100)) * 10) / 10;

  it("es del cliente, 9 clases y 60 niveles", () => {
    expect(cs.provenance).toBe("client-db2");
    expect(cs.classes).toHaveLength(9);
    for (const c of cs.classes) expect(c.levels.map((l) => l.level)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });

  it("nivel 30: reproduce las cifras que publica ForeverDB (agilidad por 1 % de critico, intelecto por 1 % de critico de hechizo y mana base)", () => {
    const foreverDb: Record<number, { agi: number | null; int: number | null; mana: number }> = {
      1: { agi: 10.4, int: null, mana: 0 },
      2: { agi: 10.7, int: 31.9, mana: 702 },
      3: { agi: 24, int: 32.9, mana: 775 },
      4: { agi: 13, int: null, mana: 0 },
      5: { agi: 14, int: 26.9, mana: 627 },
      7: { agi: 11.5, int: 28.2, mana: 665 },
      8: { agi: 14.5, int: 27.3, mana: 613 },
      9: { agi: 12, int: 28.2, mana: 638 },
      11: { agi: 11.2, int: 28.4, mana: 614 },
    };
    for (const [id, x] of Object.entries(foreverDb)) {
      const r = row(Number(id), 30);
      expect(perPercent(r.critPerAgility), `clase ${id} agilidad`).toBe(x.agi);
      if (x.int !== null) expect(perPercent(r.spellCritPerIntellect), `clase ${id} intelecto`).toBe(x.int);
      expect(r.baseMana, `clase ${id} mana`).toBe(x.mana);
      expect(r.hpPerStamina).toBe(10);
    }
  });

  it("nivel 60: coincide con los ratios de Classic que antes eran estimacion (Mago 59,5 de intelecto, Picaro 29 y Cazador 52,9 de agilidad) y con Warcraft Tavern (Picaro 29, Guerrero 20)", () => {
    expect(perPercent(row(8, 60).spellCritPerIntellect)).toBe(59.5);
    expect(perPercent(row(4, 60).critPerAgility)).toBe(29);
    expect(perPercent(row(3, 60).critPerAgility)).toBe(52.9);
    expect(perPercent(row(1, 60).critPerAgility)).toBe(20);
    // El cliente trae el mana base de Forever, distinto del de Classic (Mago nivel 60: 1213 y no 1273)
    expect(row(8, 60).baseMana).toBe(1213);
  });

  it("poder de ataque por atributo (ChrClasses): Guerrero, Paladin, Chaman y Druida 2 por fuerza; Cazador 1 + 1 (a distancia 2) y Picaro 1 + 1 (a distancia 2)", () => {
    const ap = (id: number) => {
      const c = cs.classes.find((x) => x.classId === id)!;
      return [c.attackPowerPerStrength, c.attackPowerPerAgility, c.rangedAttackPowerPerAgility];
    };
    expect(ap(1)).toEqual([2, 0, 2]);
    expect(ap(2)).toEqual([2, 0, 0]);
    expect(ap(3)).toEqual([1, 1, 2]);
    expect(ap(4)).toEqual([1, 1, 2]);
    expect(ap(8)).toEqual([1, 0, 0]);
    // Warcraft Tavern dice 1 de PA a distancia por agilidad para Guerrero y Picaro; ForeverDB y el cliente dicen 2: manda el cliente
  });
});


describe("condicionales de la plantilla, requisitos de objeto equipado y mano de las armas (cliente 1.60.1.70658)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const abilitiesOf = (classId: number) => buildAbilities(raw, live.spells, classId, BUILD, "esES", live.classes.find((c) => c.classId === classId))!;
  const COND = /\uE000([sa]\d+(?:\|[sa]\d+)*)\uE001([^\uE001]*)\uE001([^\uE002]*)\uE002/;

  it("«$?s17245[si][no]» (Sobrecrecimiento en Enredaderas) queda como marcador con las dos ramas; el texto sin talentos no cambia", () => {
    const entangle = abilitiesOf(11).abilities.find((a) => a.name === "Enredaderas")!;
    for (const r of entangle.ranks) {
      const m = COND.exec(r.descriptionTemplate)!;
      expect(m[1]).toBe("s17245");
      expect(m[2]).toMatch(/máximo de .* objetivos enraizados/);
      expect(m[3]).toBe("tener 1 solo objetivo enraizado");
      // El texto plano (sin plantilla) conserva la rama sin talentos
      expect(r.description).toContain("tener 1 solo objetivo enraizado");
      expect(r.description).not.toContain("\uE000");
    }
  });

  it("las condicionales cuyas dos ramas dicen lo mismo (solo cambia el color: «Requiere Forma felina») no dejan marcador", () => {
    const tiger = abilitiesOf(11).abilities.find((a) => a.name === "Furia del tigre")!;
    expect(tiger.ranks.every((r) => !/Requiere Forma felina[\s\S]*Requiere Forma felina/.test(r.descriptionTemplate))).toBe(true);
  });

  it("los hechizos que cita la rama «con talento» no se añaden como efectos de la habilidad", () => {
    const entangle = abilitiesOf(11).abilities.find((a) => a.name === "Enredaderas")!;
    for (const r of entangle.ranks) expect(r.effects.every((e) => e.viaSpellId !== 17245)).toBe(true);
  });

  it("los talentos con requisito de arma lo traen del cliente (SpellEquippedItems): dos manos, varita y escudo", () => {
    const warrior = byToken(live, "WARRIOR").specs.flatMap((s) => s.talents);
    const twoHand = warrior.find((t) => t.spellId === 12163)!;
    expect(twoHand.equipped).toEqual([{ itemClass: 2, invTypeMask: 0, subclassMask: 136546 }]);
    const bastion = warrior.find((t) => t.spellId === 16538)!;
    expect(bastion.equipped).toEqual([{ itemClass: 4, invTypeMask: 0, subclassMask: 64 }]);
    const wands = byToken(live, "MAGE").specs.flatMap((s) => s.talents).find((t) => t.spellId === 6057)!;
    expect(wands.equipped).toEqual([{ itemClass: 2, invTypeMask: 0, subclassMask: 524288 }]);
    expect(warrior.filter((t) => t.equipped.length === 0).length).toBeGreaterThan(0);
  });

  it("las habilidades con requisito de arma lo traen: Mutilar exige una daga", () => {
    const mutilate = abilitiesOf(4).abilities.find((a) => a.name === "Mutilar")!;
    expect(mutilate.ranks[0]!.equipped).toEqual([{ itemClass: 2, invTypeMask: 0, subclassMask: 32768 }]);
  });

  it("con qué arma golpea: Mutilar y Huracán con las dos, Puyazo y Latigazo de lava solo con la izquierda, Puñalada con la derecha", () => {
    const hand = (classId: number, name: string) => abilitiesOf(classId).abilities.find((a) => a.name === name)!.ranks.map((r) => r.weaponHand);
    expect(new Set(hand(4, "Mutilar"))).toEqual(new Set(["both"]));
    expect(new Set(hand(1, "Huracán"))).toEqual(new Set(["both"]));
    expect(new Set(hand(4, "Puyazo"))).toEqual(new Set(["off"]));
    expect(new Set(hand(7, "Latigazo de lava"))).toEqual(new Set(["off"]));
    expect(new Set(hand(4, "Puñalada"))).toEqual(new Set(["main"]));
  });
});

describe("razas de una fila de SkillLineAbility", () => {
  it("decodifica las mascaras: bit = id de raza - 1 y Cielonato en RaceMasks[1]", () => {
    expect(racesOfMasks(4, 0)).toEqual([3]);
    expect(racesOfMasks(5, 0)).toEqual([1, 3]);
    expect(racesOfMasks(16, 0)).toEqual([5]);
    expect(racesOfMasks(0, 3)).toEqual([95, 96]);
    expect(racesOfMasks(0, 1)).toEqual([95]);
    // Sin restriccion: 0 o -1
    expect(racesOfMasks(0, 0)).toBeNull();
    expect(racesOfMasks(-1, -1)).toBeNull();
    // Mascara de faccion (portales del Mago): Alianza = Humano, Enano, Elfo de la noche, Gnomo + Cielonato de la Orden Eminente
    expect(racesOfMasks(-1321907123, 1427461461)).toEqual([1, 3, 4, 7, 95]);
  });
});

describe("texto completo de las raciales y raciales de clase (pantalla de razas)", () => {
  const raw = openRawTables(join(root, "data", "raw", `${BUILD}-hotfix`));
  const racesData = buildRaces(raw, BUILD, "esES", live.spells);
  const classes = [1, 2, 3, 4, 5, 7, 8, 9, 11].map((id) => buildAbilities(raw, live.spells, id, BUILD, "esES", live.classes.find((c) => c.classId === id))!);
  attachClassRacials(racesData, classes, live.spells);
  const byId = (id: number) => racesData.races.find((r) => r.id === id)!;
  const full = (raceId: number, name: string, spellId?: number) => byId(raceId).racials.find((a) => a.name === name)!.spells.find((s) => spellId === undefined || s.spellId === spellId)!.description;

  it("cada hechizo trae el texto completo del cliente con sus cifras (el resumen de la tabla es más corto)", () => {
    // Prontitud: la segunda frase (sigilo de pícaros y druidas) no está en el resumen
    expect(byId(4).racials.find((a) => a.name === "Prontitud")!.description).not.toContain("sigilo");
    expect(full(4, "Prontitud")).toBe("Probabilidad de esquivar aumentada un 1% y velocidad de movimiento aumentada un 2%. Los pícaros y druidas elfos de la noche aumentan el sigilo como si tuvieran 1 nivel más.");
    expect(full(4, "Fusión de las Sombras")).toContain("el tiempo de reutilización aumenta a 2 min");
    expect(full(7, "¡Eureka!", 1259823)).toContain("daño o de sanación");
  });

  it("los textos sin cifras sin calcular quedan en null (la web usa entonces el resumen); lista exacta", () => {
    const missing = racesData.races.flatMap((r) => r.racials.flatMap((a) => a.spells.filter((s) => s.description === null).map((s) => `${r.name}: ${a.name} (${s.spellId})`)));
    expect(missing.sort()).toEqual(["Enano: Buscar tesoro (2481)", "Trol: Iracundia (20554)"]);
  });

  it("ningún texto completo conserva marcadores del cliente ($s1, $d…)", () => {
    for (const r of racesData.races) for (const a of r.racials) for (const s of a.spells) expect(s.description ?? "", `${r.name}: ${a.name}`).not.toMatch(/\$/);
  });

  it("las raciales de clase son las habilidades ligadas a una sola raza: 12 del Sacerdote; los portales del Mago (de toda la facción) no cuentan", () => {
    const list = racesData.races.flatMap((r) => r.classRacials.map((c) => `${r.id}:${c.classId}:${c.name}`));
    expect(list).toHaveLength(12);
    expect(list.every((l) => l.split(":")[1] === "5")).toBe(true);
    expect(byId(1).classRacials.map((c) => c.name).sort()).toEqual(["Gracia divina", "Rebote"]);
    expect(byId(5).classRacials.map((c) => c.name).sort()).toEqual(["Sacrificio oscuro", "Toque de debilidad"]);
    // Solo las razas que pueden ser Sacerdote
    for (const r of racesData.races) if (r.classRacials.length > 0) expect(r.classIds).toContain(5);
    expect(() => Races.parse(racesData)).not.toThrow();
  });

  it("los 12 textos de las raciales de clase salen del cliente con sus cifras, y sin marcadores (la paridad de cifras con el inglés oficial la audita tools/update/audit-texts.mjs)", () => {
    const text = (raceId: number, name: string) => byId(raceId).classRacials.find((c) => c.name === name)!.description;
    // Gracia divina: el cliente trae «…de salud durante 1383» (errata de redacción; el inglés dice «for 1383»): se corrige conservando la cifra
    expect(text(1, "Gracia divina")).toBe("Sana instantáneamente 1383 p. a un objetivo amistoso por debajo del 50% de salud y elimina Alma debilitada de dicho objetivo. No se puede lanzar sobre sí mismo.");
    expect(text(3, "Rezo desesperado")).toBe("Cura instantáneamente 1383 p.");
    expect(text(5, "Toque de debilidad")).toContain("infligirá 56 p. de daño de las Sombras y reducirá 204 p.");
    for (const r of racesData.races) for (const c of r.classRacials) expect(c.description, `${r.name}: ${c.name}`).not.toMatch(/[$]|durante \d+ y /);
  });

  it("las cifras que suman un atributo del personaje se avisan: Sacrificio oscuro suma el espíritu (el texto trae solo la base)", () => {
    const scaled = racesData.races.flatMap((r) => r.classRacials.filter((c) => c.scalesWith.length > 0).map((c) => `${r.name}: ${c.name} (${c.scalesWith.join(", ")})`));
    expect(scaled).toEqual(["No-muerto: Sacrificio oscuro (spirit)"]);
  });

  it("erratas de redacción del cliente corregidas a mano: lista exacta", () => {
    expect(CLIENT_TEXT_FIXES.map(([wrong]) => wrong)).toEqual(["Sana instantáneamente a un objetivo amistoso por debajo del $s2% de salud durante $s1 y elimina"]);
    // Gracia divina también en el libro de hechizos del Sacerdote, con las cifras de cada rango
    const priest = classes.find((c) => c.classId === 5)!.abilities.find((a) => a.name === "Gracia divina")!;
    expect(priest.ranks.map((r) => r.description)).toSatisfy((d: string[]) => d.every((x) => /^Sana instantáneamente \d+ p\. a un objetivo amistoso/.test(x)));
  });
});
