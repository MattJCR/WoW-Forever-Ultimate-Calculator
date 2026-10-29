import { describe, expect, it } from "vitest";
import { pageLd, siteUrl, withLd } from "../src/seo/meta";

type Node = Record<string, unknown> & { "@type": string; "@id"?: string };
const graph = (ld: object): Node[] => (ld as { "@graph": Node[] })["@graph"];
const ofType = (ld: object, type: string): Node[] => graph(ld).filter((n) => n["@type"] === type);

/** Dirección absoluta de una ruta (con SITE_URL en el entorno lleva el dominio; sin ella, solo la ruta). */
const abs = (path: string): string => `${siteUrl()}${path}`;

const meta = { title: "Bola de Fuego: habilidad de Mago", description: "Lanza una bola de fuego." };
const crumbs = [
  { name: "WoW Forever", path: "/es/" },
  { name: "Mago", path: "/es/clases/mago/" },
  { name: "Habilidades", path: "/es/clases/mago/habilidades/" },
  { name: "Bola de Fuego", path: "/es/clases/mago/habilidades/bola-de-fuego/" },
];
const here = crumbs[3]!.path;

describe("pageLd", () => {
  const ld = pageLd(meta, "es", here, { kind: "ItemPage", crumbs, about: { name: "Bola de Fuego", description: "Lanza una bola de fuego." } });

  it("es un solo @graph con el sitio, la página y las migas", () => {
    expect((ld as { "@context": string })["@context"]).toBe("https://schema.org");
    expect(graph(ld).map((n) => n["@type"])).toEqual(["WebSite", "ItemPage", "BreadcrumbList"]);
  });

  it("todo @id al que se hace referencia existe en el grafo y ninguno se repite", () => {
    const ids = graph(ld).map((n) => n["@id"]).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    const refs: string[] = [];
    const walk = (v: unknown, top: boolean): void => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, false));
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const keys = Object.keys(o);
        if (!top && keys.length === 1 && keys[0] === "@id") refs.push(o["@id"] as string);
        for (const k of keys) walk(o[k], false);
      }
    };
    graph(ld).forEach((n) => walk(n, true));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(ids).toContain(r);
  });

  it("la página enlaza con el sitio y con sus migas, en su idioma", () => {
    const page = ofType(ld, "ItemPage")[0]!;
    expect(page.inLanguage).toBe("es");
    expect(page.isPartOf).toEqual({ "@id": ofType(ld, "WebSite")[0]!["@id"] });
    expect(page.breadcrumb).toEqual({ "@id": ofType(ld, "BreadcrumbList")[0]!["@id"] });
    expect(page.name).toBe(meta.title);
    expect(page.about).toEqual({ "@type": "Thing", name: "Bola de Fuego", description: "Lanza una bola de fuego." });
  });

  it("las migas van numeradas desde 1, con nombre y dirección, y acaban en la propia página", () => {
    const items = ofType(ld, "BreadcrumbList")[0]!.itemListElement as { position: number; name: string; item: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(items.every((i) => i.name && i.item)).toBe(true);
    expect(items[3]!.item).toBe(abs(here));
  });

  it("nunca lleva valoraciones, preguntas frecuentes ni autores", () => {
    const text = JSON.stringify(ld);
    for (const bad of ["aggregateRating", "review", "FAQPage", "Question", "author", "Person"]) expect(text).not.toContain(bad);
  });
});

describe("pageLd según el tipo de página", () => {
  it("una lista presenta sus elementos como ItemList numerada", () => {
    const items = [
      { name: "Bola de Fuego", path: "/a/" },
      { name: "Nova de Escarcha", path: "/b/" },
    ];
    const ld = pageLd(meta, "es", "/es/clases/mago/habilidades/", { kind: "CollectionPage", crumbs: crumbs.slice(0, 3), items });
    const page = ofType(ld, "CollectionPage")[0]!;
    const list = page.mainEntity as { "@type": string; numberOfItems: number; itemListElement: { position: number; url: string; name: string }[] };
    expect(list["@type"]).toBe("ItemList");
    expect(list.numberOfItems).toBe(2);
    expect(list.itemListElement.map((i) => [i.position, i.name, i.url])).toEqual([
      [1, "Bola de Fuego", abs("/a/")],
      [2, "Nova de Escarcha", abs("/b/")],
    ]);
  });

  it("la entrada a una herramienta es una aplicación web gratuita enlazada como entidad principal", () => {
    const ld = pageLd(meta, "en", "/en/classes/mage/calculator/talents/", { crumbs: crumbs.slice(0, 2), app: { name: "Mage talent calculator", description: "Plan your build." } });
    const app = ofType(ld, "WebApplication")[0]!;
    expect(app).toMatchObject({ applicationCategory: "GameApplication", isAccessibleForFree: true, offers: { price: "0" }, inLanguage: "en" });
    expect(ofType(ld, "WebPage")[0]!.mainEntity).toEqual({ "@id": app["@id"] });
  });

  it("la portada no lleva migas (una sola) y no repite el sitio", () => {
    const ld = pageLd(meta, "es", "/es/", { crumbs: [] });
    expect(ofType(ld, "BreadcrumbList")).toHaveLength(0);
    expect(ofType(ld, "WebSite")).toHaveLength(1);
    expect(ofType(ld, "WebPage")[0]!.breadcrumb).toBeUndefined();
  });

  it("withLd conserva el resto de los metadatos", () => {
    const out = withLd({ ...meta, noindex: true, type: "article" }, "es", here, { crumbs });
    expect(out.noindex).toBe(true);
    expect(out.type).toBe("article");
    expect(out.jsonLd).toHaveLength(1);
  });
});
