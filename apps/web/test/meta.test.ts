import { describe, expect, it } from "vitest";
import { clip, sentences } from "../src/seo/meta";

describe("clip", () => {
  it("deja intacto lo que cabe", () => {
    expect(clip("Una frase corta.")).toBe("Una frase corta.");
  });

  it("corta en la última frase completa que cabe, sin puntos suspensivos", () => {
    const text = "Lanza una bola abrasadora que causa 483 p. de daño de Fuego durante 8 s. Dura 10 s y se acumula hasta tres veces sobre el mismo objetivo. Otra frase que ya no entra.";
    const out = clip(text, 150);
    expect(out).toBe("Lanza una bola abrasadora que causa 483 p. de daño de Fuego durante 8 s. Dura 10 s y se acumula hasta tres veces sobre el mismo objetivo.");
    expect(out.endsWith("…")).toBe(false);
  });

  it("si la primera frase no cabe, corta en una coma y marca el recorte", () => {
    const text = "Crea una violenta tormenta en la zona elegida que causa 132 p. de daño de Naturaleza a los enemigos cada segundo, y aumenta el tiempo entre sus ataques un 20 %. Dura 10 s.";
    const out = clip(text, 120);
    expect(out).toBe("Crea una violenta tormenta en la zona elegida que causa 132 p. de daño de Naturaleza a los enemigos cada segundo…");
  });

  it("nunca pasa de la longitud pedida", () => {
    expect(clip("palabra ".repeat(60), 155).length).toBeLessThanOrEqual(155);
  });
});

describe("sentences", () => {
  it("separa con punto las líneas del cliente que no lo llevan", () => {
    expect(sentences("Requiere Forma de gato\nCausa daño al objetivo.")).toBe("Requiere Forma de gato. Causa daño al objetivo.");
  });
});
