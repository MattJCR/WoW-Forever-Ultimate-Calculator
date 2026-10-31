import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildBuffs, type BuffRules } from "../src/buffs.js";
import { openRawTables } from "../src/csv.js";
import { Abilities, Buffs } from "../src/model.js";
import { SpellTables } from "../src/spell-tables.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUILD = "1.60.1.70707";
const RAW = join(root, "data", "raw", `${BUILD}-hotfix`);
const OUT = join(root, "data", "forever", BUILD);

describe.skipIf(!existsSync(join(RAW, "ItemSparse.csv")) || !existsSync(join(OUT, "abilities", "mage.json")))("beneficios (buffs) del cliente", () => {
  const raw = openRawTables(RAW);
  const abilities = readdirAbilities();
  const rules = JSON.parse(readFileSync(join(root, "data", "rules", "buffs.json"), "utf8")) as BuffRules;
  const warnings: string[] = [];
  const data = Buffs.parse(buildBuffs(raw, BUILD, new SpellTables(raw), abilities, rules, warnings));

  function readdirAbilities() {
    return ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"].map((c) => Abilities.parse(JSON.parse(readFileSync(join(OUT, "abilities", `${c}.json`), "utf8"))));
  }

  it("cumple el esquema, sin avisos, con las 9 clases, tótems, mascota y los seis tipos de consumible", () => {
    expect(warnings.map((w) => /«(.+?)»/.exec(w)![1])).toEqual(["Danza de hojas"]); // su poder de ataque depende de la habilidad de defensa; Valor de Azeroth y Cuerno de Lordaeron se resuelven con la fórmula a nivel 60
    expect(data.buffs.length).toBe(311); // 290 + los 10 consumibles «Endless» del hotfix del 22/10 (el elixir de tamaño y el de experiencia solo traen texto) + 9 objetos de campamento + 3 pasivos de profesión − 1 (70658: Ferocidad de Fengus, pergamino de Aggrend, pasa todos sus efectos a aura 4 sin efecto y deja de ser un beneficio)
    const cats = new Set(data.buffs.map((b) => b.category));
    expect([...cats].sort()).toEqual(["camp", "class", "elixir", "flask", "food", "other", "pet", "potion", "profession", "scroll", "totem"]);
  });

  it("solo auras amistosas de estadística: ningún perjuicio sobre el enemigo (maldiciones, gritos desmoralizadores)", () => {
    const names = new Set(data.buffs.map((b) => b.name));
    for (const enemyOnly of ["Maldición de los Elementos", "Grito desmoralizador", "Clamor desmoralizador", "Hender armadura", "Fuego feérico"]) expect(names.has(enemyOnly), enemyOnly).toBe(false);
    for (const mine of ["Grito de guerra", "Bendición del poderío", "Marca de lo salvaje", "Intelecto Arcano", "Aspecto del halcón", "Fuerza de la Tierra"]) expect(names.has(mine), mine).toBe(true);
  });

  it("los rangos de tótem se limitan al nivel 60 y los consumibles llevan su objeto", () => {
    const earth = data.buffs.find((b) => b.name === "Fuerza de la Tierra")!;
    expect(earth.auras[0]!.value).toBe(53); // rango 5 (nivel 60); el resto de rangos son menores
    const elixir = data.buffs.find((b) => b.name === "Elixir de la mangosta")!;
    expect(elixir).toMatchObject({ category: "elixir", itemId: 13452, classId: null });
    expect(data.buffs.filter((b) => ["potion", "elixir", "flask", "scroll", "food", "other"].includes(b.category)).every((b) => b.itemId !== null)).toBe(true);
  });

  it("campamento: los 9 objetos salen del texto «Beneficios de campamento» del cliente, con su profesión y la cifra de su aura", () => {
    const camp = data.buffs.filter((b) => b.category === "camp");
    expect(camp.map((b) => [b.name, b.profession, b.provenance, b.text])).toEqual(
      [
        ["Cuenco con pescado", "Pesca", "client-db2", "Aumenta todas las estadísticas un 8%."],
        ["Equipo de primeros auxilios", "Primeros auxilios", "client-db2", "Aumenta el aguante en 56."],
        ["Estandarte de facción", "Costura", "client-db2", "Aumenta el espíritu en 32."],
        ["Laúd encantado", "Encantamiento", "client-db2", "Aumenta la armadura en 308, todos los atributos un 13 y todas las resistencias en 22."],
        ["Magnetita", "Minería", "client-db2", "Aumenta el poder de ataque cuerpo a cuerpo en 90."],
        ["Pozo de maná", "Alquimia", "client-db2", "Restaura 29 p. de maná cada 5 s."],
        ["Rueda de afilar", "Herrería", "client-db2", "Aumenta la fuerza en 34."],
        ["Silla de campamento", "Desollar", "client-db2", "Aumenta la probabilidad de golpe crítico con todos los hechizos y ataques un 2%."],
        ["Vela de incienso", "Botánica", "client-db2", "Aumenta el intelecto en 25."],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!, "es")),
    );
    expect(camp.every((b) => b.itemId !== null && b.iconFileDataId !== null && b.durationMs === null)).toBe(true);
  });

  it("pasivos de profesión: estimación de la comunidad (el cliente no los trae), con traducción propia y sin ser del cliente", () => {
    const perks = data.buffs.filter((b) => b.category === "profession");
    expect(perks.map((b) => [b.name, b.nameEn, b.profession, b.provenance, b.textOrigin])).toEqual([
      ["Bestias salvajes", "Beasts of the Wild", "Desollar", "community", "translated-by-us"],
      ["Hecho de metal", "Made of Metal", "Minería", "community", "translated-by-us"],
      ["Talento natural", "Natural Talent", "Botánica", "community", "translated-by-us"],
    ]);
    expect(perks.find((b) => b.name === "Hecho de metal")!.auras.map((a) => [a.aura, a.value])).toEqual([[133, 5]]); // salud máxima +5 %
  });

  it("consumibles que no entraban: aumentos permanentes al consumir (sin duración) y pociones de protección (absorben daño)", () => {
    const permanent = data.buffs.find((b) => b.name === "IFRDHR permanente")!;
    expect(permanent).toMatchObject({ category: "other", durationMs: null });
    expect(permanent.auras.map((a) => a.value)).toEqual([25]);
    const shadow = data.buffs.filter((b) => /^Poción de protección de las Sombras/.test(b.name));
    expect(shadow.map((b) => [b.category, b.durationMs, b.auras[0]!.aura, b.auras[0]!.value])).toEqual([["potion", 120000, 69, 900], ["potion", 120000, 69, 2600]]);
  });
});
