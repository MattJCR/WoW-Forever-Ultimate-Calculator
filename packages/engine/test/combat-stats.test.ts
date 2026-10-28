import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Abilities, ClassTalents, ClientStats, CombatRatings, Enchants, Items, Races, RandomSuffixes, TalentRules } from "@wfuc/schema";
import { describe, expect, it } from "vitest";
import { collectStatEffects, deriveCombatStats, deriveStats, hasteFor, indexClass, type StatTotal } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const D = join(root, "data", "forever", "1.60.1.70658");
const has = existsSync(join(D, "items.json")) && existsSync(join(D, "combat-ratings.json"));
const json = (f: string) => JSON.parse(readFileSync(join(D, f), "utf8"));

const src = { from: "class" as const, name: "Talento", rank: 1, maxRank: 1 };
const total = (category: StatTotal["category"], label: string, value: number, unit: StatTotal["unit"] = "puntos porcentuales", scope: string[] | null = null): StatTotal => ({ category, label, value, unit, scope, sources: [src] });
const flat = deriveStats({ attributes: [100, 200, 100, 100, 100], hpBase: 0, manaBase: 0, totals: [] });
const ratings = has ? CombatRatings.parse(json("combat-ratings.json")) : null;
const classStats = { level: 60, baseMana: 0, hpPerStamina: 10, critPerAgility: 1 / 29 / 100, spellCritPerIntellect: 0 };
const row = (r: ReturnType<typeof deriveCombatStats>, key: string) => r.rows.find((x) => x.key === key);

describe("estadísticas de combate: equipo + talentos + raza", () => {
  it("sin nada solo sale el crítico por agilidad (200 ÷ 29 = 6,9 %)", () => {
    const r = deriveCombatStats({ derived: flat, totals: [], classStats });
    expect(r.rows.map((x) => x.key)).toEqual(["crit-melee"]);
    expect(row(r, "crit-melee")!.value).toBeCloseTo(6.9, 1);
    expect(r.haste).toEqual({ spell: 0, melee: 0, ranged: 0 });
  });

  it.skipIf(!has)("la puntuación del equipo se convierte con las constantes de la comunidad y se suma a talentos y raza", () => {
    const stats = { "crit-rating": 28, "hit-rating": 20, "haste-rating": 30, "dodge-rating": 24, "parry-rating": 15, "block-rating": 10, defense: 7, "expertise-rating": 10 };
    const totals = [
      total("Probabilidad de crítico", "probabilidad de crítico", 3),
      total("Probabilidad de impacto", "probabilidad de impacto", 2),
      total("Celeridad", "celeridad con hechizos", 5, "%"),
      total("Defensa", "probabilidad de esquivar", 1),
      total("Defensa", "habilidad en defensa", 5, "puntos"),
    ];
    const r = deriveCombatStats({ derived: flat, totals, gear: { stats, armor: 0, ratings }, classStats });
    expect(row(r, "crit-melee")!.value).toBeCloseTo(6.9 + 3 + 2, 1); // agilidad + talentos + 28 ÷ 14
    expect(row(r, "hit")!.value).toBe(2 + 2); // 20 ÷ 10
    expect(row(r, "haste-spell")!.value).toBe(5 + 3); // 30 ÷ 10
    expect(row(r, "haste-melee")!.value).toBe(3);
    expect(row(r, "dodge")!.value).toBe(1 + 2); // 24 ÷ 12
    expect(row(r, "parry")!.value).toBe(1); // 15 ÷ 15
    expect(row(r, "block")!.value).toBe(2); // 10 ÷ 5
    expect(row(r, "defense")!.value).toBe(5 + 7);
    expect(row(r, "expertise")!.value).toBe(1);
    expect(r.haste).toEqual({ spell: 8, melee: 3, ranged: 3 });
  });

  it("la armadura de las piezas lleva el % de talentos; la armadura extra y la «sin modificadores» no", () => {
    const totals = [total("Atributos, salud y recursos", "armadura de tus objetos", 10, "%")];
    const r = deriveCombatStats({ derived: flat, totals, gear: { stats: { "extra-armor": 100, "armor-no-mods": 50 }, armor: 1000, ratings: null }, classStats: null });
    expect(row(r, "armor")!.value).toBe(1000 * 1.1 + 100 + 50);
    // Sin equipo, el % se enseña tal cual para no perderlo
    expect(row(deriveCombatStats({ derived: flat, totals, classStats: null }), "armor-pct")!.value).toBe(10);
  });

  it("el crítico cuerpo a cuerpo de talentos no se suma al de hechizos; el general sí a los dos", () => {
    const totals = [total("Probabilidad de crítico", "probabilidad de crítico", 2), total("Probabilidad de crítico", "probabilidad de crítico cuerpo a cuerpo", 5, "puntos porcentuales", ["Golpe"])];
    const r = deriveCombatStats({ derived: flat, totals, classStats: { ...classStats, critPerAgility: 0.0001, spellCritPerIntellect: 0.0001 } });
    expect(row(r, "crit-melee")!.value).toBe(2 + 2 + 5); // 200 × 0,0001 = 2 % + 2 + 5
    expect(row(r, "crit-spell")!.value).toBe(1 + 2); // 100 × 0,0001 = 1 %
  });

  it("las cifras que modifican habilidades concretas no entran en las del personaje", () => {
    const totals = [total("Probabilidad de crítico", "probabilidad de crítico", 8, "puntos porcentuales", ["Bola de Fuego"]), total("Coste", "coste", -10, "%", ["Bola de Fuego"])];
    const r = deriveCombatStats({ derived: flat, totals, classStats });
    expect(row(r, "crit-melee")!.value).toBeCloseTo(6.9, 1);
    expect(r.rows.some((x) => x.group === "Otros bonos")).toBe(false);
  });

  it("lo que vale para todo el personaje y no tiene fila propia va a «Otros bonos» (velocidad, daño infligido por escuela, amenaza)", () => {
    const totals = [
      total("Velocidad de movimiento", "velocidad de movimiento", 3, "%"),
      total("Daño y curación", "daño infligido", 5, "%", ["Fuego"]),
      total("Amenaza", "amenaza generada", -10, "%", ["Sagrado"]),
    ];
    const r = deriveCombatStats({ derived: flat, totals, classStats: null });
    expect(r.rows.filter((x) => x.group === "Otros bonos").map((x) => `${x.label}=${x.value}`)).toEqual(["Velocidad de movimiento=3", "Daño infligido (Fuego)=5", "Amenaza generada (Sagrado)=-10"]);
  });

  it("la celeridad de una habilidad física usa la de cuerpo a cuerpo (o a distancia con alcance) y la de las demás la de hechizos", () => {
    const h = { spell: 10, melee: 5, ranged: 7 };
    expect(hasteFor(h, { schoolMask: 4, rangeYd: 30 })).toBe(10);
    expect(hasteFor(h, { schoolMask: 1, rangeYd: 5 })).toBe(5);
    expect(hasteFor(h, { schoolMask: 1, rangeYd: 35 })).toBe(7);
    expect(hasteFor(h, { schoolMask: 1, rangeYd: null })).toBe(5);
  });
});

/**
 * AUDITORIA: nada de lo que suma el equipo ni de lo que dan los talentos al personaje se queda sin reflejar en el Resumen. Las listas
 * de excepciones son EXACTAS: si cambian la prueba falla y obliga a revisarlas.
 */
describe.skipIf(!has)("auditoría: el equipo y los talentos se reflejan en las estadísticas del Resumen", () => {
  const items = Items.parse(json("items.json"));
  const enchants = existsSync(join(D, "enchants.json")) ? Enchants.parse(json("enchants.json")) : null;
  const suffixes = existsSync(join(D, "random-suffixes.json")) ? RandomSuffixes.parse(json("random-suffixes.json")) : null;
  const clientStats = ClientStats.parse(json("client-stats.json"));
  const attackPower = { perStrength: 2, perAgility: 1, rangedPerAgility: 1 };
  const gearKeys = new Set<string>();
  for (const i of items.items) for (const s of i.stats) gearKeys.add(s.key ?? `type:${s.type}`);
  for (const e of enchants?.enchants ?? []) for (const s of e.stats) gearKeys.add(s.key ?? `type:${s.type}`);
  void suffixes;

  /** Estadisticas del equipo que ninguna fila del Resumen refleja, con el motivo. */
  const NOT_REFLECTED = (k: string): string | null => {
    if (k.startsWith("type:")) return "estadística de Forever que el cliente no nombra: solo texto en el selector (hoy ninguna: los tipos 83-140 se interpretaron en la sesión 12)";
    if (k === "untyped") return "tipo -1 del cliente (3 anillos grabados): hueco sin tipo; se conserva marcado y no suma a nada";
    return null;
  };

  it("cada clave de estadística de objetos y encantamientos cambia alguna fila (estadísticas base o de combate)", () => {
    const missing: string[] = [];
    const baseline = (cs: ReturnType<typeof deriveCombatStats>, d: ReturnType<typeof deriveStats>) => JSON.stringify([d.rows.map((r) => [r.key, r.final]), cs.rows.map((r) => [r.key, r.value])]);
    const attrs: [number, number, number, number, number] = [50, 50, 50, 50, 50];
    const zeroD = deriveStats({ attributes: attrs, hpBase: 100, manaBase: 100, totals: [], attackPower });
    const zero = baseline(deriveCombatStats({ derived: zeroD, totals: [], gear: { stats: {}, armor: 0, ratings }, classStats: clientStats.classes[0]!.levels.find((l) => l.level === 60)! }), zeroD);
    for (const k of [...gearKeys].sort()) {
      if (NOT_REFLECTED(k)) continue;
      const stats = { [k]: 100 };
      const d = deriveStats({ attributes: attrs, hpBase: 100, manaBase: 100, totals: [], attackPower, gear: stats });
      const cs = deriveCombatStats({ derived: d, totals: [], gear: { stats, armor: 0, ratings }, classStats: clientStats.classes[0]!.levels.find((l) => l.level === 60)! });
      if (baseline(cs, d) === zero) missing.push(k);
    }
    // Claves sin fila propia: se piden explicitamente aqui para que alguien las revise
    expect(missing).toEqual([]);
  });

  it("las piezas con armadura suman armadura", () => {
    const d = deriveStats({ attributes: [1, 1, 1, 1, 1], hpBase: 0, manaBase: 0, totals: [] });
    expect(row(deriveCombatStats({ derived: d, totals: [], gear: { stats: {}, armor: 321, ratings }, classStats: null }), "armor")!.value).toBe(321);
  });

  describe("talentos, Legacy y raza (9 clases, todos los talentos al máximo, todas las razas)", () => {
    const races = Races.parse(json("races.json")).races;
    const classes = readdirSync(join(D, "classes")).map((f) => ({
      token: f.replace(".json", ""),
      cls: indexClass(ClassTalents.parse(json(`classes/${f}`))),
      abilities: Abilities.parse(json(`abilities/${f}`)),
      rules: TalentRules.parse(json(`rules/${f}`)),
    }));

    it("cada cifra que vale para todo el personaje sale en alguna fila (atributo/poder en deriveStats, el resto en combate)", () => {
      const lost: string[] = [];
      for (const c of classes) {
        const build: Record<number, number> = {};
        for (const { talent } of c.cls.ordered) build[talent.nodeId] = talent.maxRank;
        const classStat = clientStats.classes.find((x) => x.classId === c.cls.data.classId)!;
        for (const race of races) {
          const fx = collectStatEffects({ cls: c.cls, classBuild: build, legacy: null, legacyBuild: {}, race, abilities: c.abilities, rules: c.rules });
          const derived = deriveStats({ attributes: [100, 100, 100, 100, 100], hpBase: 100, manaBase: 100, totals: fx.totals, attackPower });
          const cs = deriveCombatStats({ derived, totals: fx.totals, classStats: classStat.levels.find((l) => l.level === 60)! });
          const shown = new Set(cs.rows.flatMap((r) => r.sources.map((s) => `${s.from}:${s.name}`)));
          for (const t of fx.totals) {
            if (t.target || t.ofStat) continue; // las recoge deriveStats
            if (t.scope !== null && !/cuerpo a cuerpo/.test(t.label) && !["daño infligido", "daño recibido", "amenaza generada", "armadura del objetivo ignorada", "daño del arma de la mano izquierda"].includes(t.label)) continue; // afecta a habilidades concretas: va en su tarjeta
            if (["Coste", "Tiempo de lanzamiento", "Enfriamiento", "Alcance y radio", "Duración", "Efecto 1 / 2 / 3 de los hechizos", "Otros modificadores", "Retroceso al lanzar", "Daño periódico"].includes(t.category)) continue;
            const reflected = t.sources.every((s) => shown.has(`${s.from}:${s.name}`));
            if (!reflected) lost.push(`${c.token}/${race.id}: ${t.category} | ${t.label} (${t.sources.map((s) => s.name).join(", ")})`);
          }
        }
      }
      expect([...new Set(lost.map((l) => l.replace(/^\w+\/\d+: /, "")))].sort()).toEqual([]);
    });
  });
});
