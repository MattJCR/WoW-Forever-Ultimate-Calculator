import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alternates, allPages, hasCharacterState, isIndexable, legacyHashToUrl, legacyView, pagePath, parsePath, slugify, type SeoIndex } from "../src/seo/routes";

const index: SeoIndex = {
  build: "test",
  classes: [{ token: "mage", id: 8, es: "mago", en: "mage" }, { token: "rogue", id: 4, es: "picaro", en: "rogue" }],
  races: [{ id: 2, es: "orco", en: "orc" }],
  abilities: { mage: [{ id: 133, es: "bola-de-fuego", en: "fireball" }] },
  talents: { mage: [{ id: 105815, es: "especializacion-en-varitas", en: "wand-specialization" }] },
};

describe("slugify", () => {
  it("quita tildes, signos y mayúsculas", () => {
    expect(slugify("Pícaro")).toBe("picaro");
    expect(slugify("Bola de Fuego")).toBe("bola-de-fuego");
    expect(slugify("Ner'zhul's Gaze!")).toBe("nerzhuls-gaze");
  });
});

describe("rutas", () => {
  it("construye y lee las URLs de cada idioma", () => {
    expect(pagePath({ kind: "class", cls: "mage" }, "es", index)).toBe("/es/clases/mago/");
    expect(pagePath({ kind: "class", cls: "mage" }, "en", index)).toBe("/en/classes/mage/");
    expect(pagePath({ kind: "ability", cls: "mage", id: 133 }, "en", index)).toBe("/en/classes/mage/abilities/fireball/");
    expect(pagePath({ kind: "talent", cls: "mage", id: 105815 }, "es", index)).toBe("/es/clases/mago/talentos/especializacion-en-varitas/");
    expect(pagePath({ kind: "race", id: 2 }, "es", index)).toBe("/es/razas/orco/");
    expect(parsePath("/en/classes/mage/abilities/fireball", index)).toEqual({ lang: "en", page: { kind: "ability", cls: "mage", id: 133 } });
    expect(parsePath("/es/clases/mago/", index)).toEqual({ lang: "es", page: { kind: "class", cls: "mage" } });
  });

  it("cada paso de la calculadora tiene su dirección en cada idioma", () => {
    expect(pagePath({ kind: "calc", cls: "mage", view: "talents" }, "es", index)).toBe("/es/clases/mago/calculadora/talentos/");
    expect(pagePath({ kind: "calc", cls: "mage", view: "gear" }, "en", index)).toBe("/en/classes/mage/calculator/gear/");
    expect(pagePath({ kind: "calc", cls: "rogue", view: "buffs" }, "es", index)).toBe("/es/clases/picaro/calculadora/beneficios/");
    expect(parsePath("/en/classes/mage/calculator/summary", index)).toEqual({ lang: "en", page: { kind: "calc", cls: "mage", view: "summary" } });
    expect(alternates({ kind: "calc", cls: "mage", view: "race" }, index)).toEqual({ es: "/es/clases/mago/calculadora/raza/", en: "/en/classes/mage/calculator/race/" });
    // el listado de talentos de consulta no choca con el paso de talentos de la calculadora
    expect(parsePath("/es/clases/mago/talentos/", index).page.kind).toBe("class-talents");
    for (const p of ["/es/clases/mago/calculadora/", "/es/clases/mago/calculadora/race/", "/es/clases/mago/calculadora/talentos/x", "/en/classes/mage/calculator/raza"]) {
      expect(parsePath(p, index).page.kind, p).toBe("not-found");
    }
  });

  it("solo se indexan los pasos con contenido propio de la clase", () => {
    const views = ["race", "legacy", "talents", "gear", "buffs", "summary"] as const;
    expect(views.filter((view) => isIndexable({ kind: "calc", cls: "mage", view }))).toEqual(["race", "talents", "gear", "summary"]);
    expect(isIndexable({ kind: "class", cls: "mage" })).toBe(true);
  });

  it("un enlace antiguo de la clase elige el paso como antes", () => {
    expect(legacyView(new URLSearchParams("v=gear&b=1"))).toBe("gear");
    expect(legacyView(new URLSearchParams("b=1-2"))).toBe("talents");
    expect(legacyView(new URLSearchParams("r=2"))).toBe("race");
    expect(hasCharacterState(new URLSearchParams("r=2"))).toBe(true);
    expect(hasCharacterState(new URLSearchParams(""))).toBe(false);
  });

  it("la raíz y el probador insertable no llevan idioma", () => {
    expect(parsePath("/", index)).toEqual({ lang: null, page: { kind: "home" } });
    expect(parsePath("/embed", index)).toEqual({ lang: null, page: { kind: "embed" } });
  });

  it("lo que no existe es not-found (también un slug de otro idioma)", () => {
    for (const p of ["/es/clases/nada", "/es/classes/mage", "/en/clases/mago", "/fr", "/es/clases/mago/habilidades/fireball", "/es/clases/mago/talentos/x/y", "/es/razas/orco/extra"]) {
      expect(parsePath(p, index).page.kind, p).toBe("not-found");
    }
  });

  it("la misma página en el otro idioma", () => {
    expect(alternates({ kind: "ability", cls: "mage", id: 133 }, index)).toEqual({ es: "/es/clases/mago/habilidades/bola-de-fuego/", en: "/en/classes/mage/abilities/fireball/" });
  });

  it("los enlaces antiguos con '#' pasan a la URL nueva", () => {
    expect(legacyHashToUrl("#/class/mage?b=1-2&v=talents", "es", index)).toBe("/es/clases/mago/calculadora/talentos/?b=1-2");
    expect(legacyHashToUrl("#/class/mage?b=1-2", "es", index)).toBe("/es/clases/mago/calculadora/talentos/?b=1-2");
    expect(legacyHashToUrl("#/class/mage?lang=en&r=2", "es", index)).toBe("/en/classes/mage/calculator/race/?r=2");
    expect(legacyHashToUrl("#/unassigned", "en", index)).toBe("/en/unassigned/");
    expect(legacyHashToUrl("#/embed?r=1&g=abc", "es", index)).toBe("/embed/?r=1&g=abc");
    expect(legacyHashToUrl("#/class/zzz", "es", index)).toBe("/es/");
    expect(legacyHashToUrl("", "es", index)).toBeNull();
  });
});

const realFile = new URL("../public/data/seo-index.json", import.meta.url);
describe.skipIf(!existsSync(realFile))("índice real", () => {
  const real = JSON.parse(readFileSync(realFile, "utf8")) as SeoIndex;
  it("cada página indexable tiene URL única en cada idioma y se lee de vuelta", () => {
    for (const lang of ["es", "en"] as const) {
      const seen = new Map<string, string>();
      for (const page of allPages(real)) {
        const path = pagePath(page, lang, real);
        expect(path, JSON.stringify(page)).not.toBeNull();
        expect(seen.has(path!), `URL repetida ${path}`).toBe(false);
        seen.set(path!, JSON.stringify(page));
        expect(parsePath(path!, real)).toEqual({ lang, page });
      }
    }
  });
});
