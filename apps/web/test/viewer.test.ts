import { describe, expect, it } from "vitest";
import { decodeAvatar, encodeAvatar } from "../src/viewer/avatar";
import { resolveEquipment, type AppearanceData, type Equipped } from "../src/viewer/equipment";
import { defaultChoice, defaultSelection, groupOfOption, isColorOption, resolveSelection, stepChoice, swatchCss, type Recipe } from "../src/viewer/recipe";

describe("estado del avatar en el enlace", () => {
  it("lo de por defecto no viaja", () => {
    expect(encodeAvatar({ sex: 0, choices: {} })).toBe("");
    expect(encodeAvatar({ sex: 0, choices: {}, sheathed: true })).toBe("0s");
    expect(decodeAvatar("1s.9-5")).toEqual({ sex: 1, choices: { 9: 5 }, sheathed: true });
    expect(decodeAvatar(null)).toEqual({ sex: 0, choices: {} });
  });
  it("ida y vuelta con cuerpo y elecciones", () => {
    const a = { sex: 1 as const, choices: { 9: 60786, 11: 45 } };
    expect(encodeAvatar(a)).toBe("1.9-60786~11-45");
    expect(decodeAvatar("1.9-60786~11-45")).toEqual(a);
    expect(decodeAvatar("1")).toEqual({ sex: 1, choices: {} });
  });
  it("la raza del avatar viaja con el cuerpo y las armas envainadas", () => {
    expect(encodeAvatar({ sex: 0, choices: {}, race: 6 })).toBe("0r6");
    expect(encodeAvatar({ sex: 1, choices: { 9: 5 }, sheathed: true, race: 96 })).toBe("1sr96.9-5");
    expect(decodeAvatar("1sr96.9-5")).toEqual({ sex: 1, choices: { 9: 5 }, sheathed: true, race: 96 });
    expect(decodeAvatar("0r6")).toEqual({ sex: 0, choices: {}, race: 6 });
    expect(decodeAvatar("0s")).toEqual({ sex: 0, choices: {}, sheathed: true });
  });
  it("el fondo del probador viaja con b<id> (b0 = liso) y sin él sigue a la raza", () => {
    expect(encodeAvatar({ sex: 0, choices: {}, bg: 2 })).toBe("0b2");
    expect(encodeAvatar({ sex: 0, choices: {}, bg: 0 })).toBe("0b0");
    expect(encodeAvatar({ sex: 1, choices: { 9: 5 }, sheathed: true, race: 96, bg: 6 })).toBe("1sr96b6.9-5");
    expect(decodeAvatar("1sr96b6.9-5")).toEqual({ sex: 1, choices: { 9: 5 }, sheathed: true, race: 96, bg: 6 });
    expect(decodeAvatar("0b0")).toEqual({ sex: 0, choices: {}, bg: 0 });
    expect(decodeAvatar("0r6")).toEqual({ sex: 0, choices: {}, race: 6 });
  });
  it("ignora basura", () => {
    expect(decodeAvatar("0.x-y~3")).toEqual({ sex: 0, choices: {} });
  });
});

const recipe = {
  chrModelId: 1,
  sex: 0,
  layout: { width: 2048, height: 1024, sections: [] },
  materials: [],
  layers: [],
  geosets: [],
  options: [
    { id: 1, name: "Color de piel", category: 1, categoryName: "", choices: [
      { id: 10, name: "", req: 12, npc: true, swatch: 0, elements: [] },
      { id: 11, name: "", req: 141, swatch: 0, elements: [{ related: 0, material: { target: 1, file: 111 } }] },
      { id: 12, name: "", req: 141, swatch: 0xff00ff00, elements: [{ related: 0, material: { target: 1, file: 112 } }] },
    ] },
    { id: 2, name: "Rostro", category: 1, categoryName: "", choices: [
      { id: 20, name: "", req: 141, swatch: 0, elements: [
        { related: 11, material: { target: 5, file: 211 } },
        { related: 12, material: { target: 5, file: 212 } },
        { related: 0, boneSet: 3 },
      ] },
    ] },
    { id: 3, name: "Peinado", category: 1, categoryName: "", choices: [
      { id: 30, name: "Rapado", req: 141, swatch: 0, elements: [{ related: 0, geoset: 0, hair: true }] },
      { id: 31, name: "Soldado", req: 141, swatch: 0, elements: [{ related: 0, geoset: 3, hair: true }, { related: 0, skinned: { file: 7, type: 34, id: 2 } }] },
    ] },
  ],
} as unknown as Recipe;

describe("personalización", () => {
  it("por defecto: la primera elección que el juego ofrece a los jugadores, en los colores con color y en el peinado una con pelo", () => {
    expect(defaultChoice(recipe.options[0]!)?.id).toBe(12);
    expect(defaultSelection(recipe)).toEqual({ 1: 12, 2: 20, 3: 31 });
  });
  it("el rapado solo es el peinado por defecto si no hay otro", () => {
    const only = { ...recipe.options[2]!, choices: [recipe.options[2]!.choices[0]!] };
    expect(defaultChoice(only)?.id).toBe(30);
  });
  it("las cejas de malla no salen «Afeitadas» (subgrupo 0) por defecto si hay otras", () => {
    const brow = (id: number, geoset: number) => ({ id, name: "", req: 0, swatch: 0, elements: [{ related: 0, geoset }] });
    const o = { id: 5, name: "Cejas", category: 0, categoryName: "", choices: [brow(1, 3400), brow(2, 3401), brow(3, 3402)] };
    expect(defaultChoice(o)?.id).toBe(2);
    expect(defaultChoice({ ...o, name: "Pendientes" })?.id).toBe(1);
  });
  it("la textura de la cara depende del color de piel elegido", () => {
    expect(resolveSelection(recipe, { 1: 11, 2: 20, 3: 30 }).targets.get(5)).toBe(211);
    expect(resolveSelection(recipe, { 1: 12, 2: 20, 3: 30 }).targets.get(5)).toBe(212);
  });
  it("peinados y colecciones dan sus subgeometrías", () => {
    const r = resolveSelection(recipe, { 1: 12, 2: 20, 3: 31 });
    expect(r.geosets.has(3)).toBe(true);
    expect(r.geosets.has(7 * 10000 + 3402)).toBe(true);
  });
});

const ap: AppearanceData = {
  build: "t",
  items: { "1": 100, "2": 200, "3": 300, "4": 400, "5": 500, "6": 600, "7": 700, "8": 800 },
  display: {
    // pecho: mangas 1 -> 802, pecho 1 -> 1002, faldón 0 -> 1301 (sin faldón largo)
    "100": { g: [1, 1, 0], s: [[3, 1001]] },
    // camisa: mangas 2 -> 803 (debajo del pecho)
    "200": { g: [2], s: [[3, 1002]] },
    // túnica: faldón largo 1 -> 1302
    "300": { g: [1, 0, 1], s: [[3, 1003], [5, 1004]] },
    // pantalón: rodilleras 2 -> 903, pantalón 1 -> 1102
    "400": { g: [2, 1, 0], s: [[5, 1005]] },
    // casco: oculta lo que dice la variante 246 en la raza 1; modelo por sexo
    "500": { h: [246, 247], m: [[50, 55, 0]] },
    // hombreras: dos modelos (izquierda y derecha)
    "600": { m: [[60, 0, 0]] },
    // espada a dos manos
    "700": { m: [[70, 77, 0]] },
    // escudo
    "800": { m: [[80, 0, 0]] },
  },
  tex: { "1001": { "3": 9001 }, "1002": { "3": 9002 }, "1003": { "0": 9030, "1": 9031 }, "1004": { "3": 9004 }, "1005": { "3": 9005 }, "55": { "3": 9055 }, "77": { "3": 9077 } },
  model: {
    "50": [{ f: 5001, g: 0, r: 1, p: -1 }, { f: 5002, g: 1, r: 1, p: -1 }, { f: 5003, g: 0, r: 2, p: -1 }],
    "60": [{ f: 6001, g: 3, r: 0, p: 0 }, { f: 6002, g: 3, r: 0, p: 1 }],
    "70": [{ f: 7001, g: 3, r: 0, p: -1 }],
    "80": [{ f: 8001, g: 3, r: 0, p: -1 }],
  },
  helm: { "246": { "1": [0] }, "247": { "1": [0] } },
};
const url = (f: number) => `tex/${f}.webp`;
const eq = (itemId: number, inventoryType: number, slot = "armor", extra: Partial<Equipped> = {}): Equipped => ({ slot, inventoryType, classId: 4, subclassId: 0, itemId, ...extra });

describe("equipo → lo que se ve", () => {
  it("el pecho mueve mangas, pecho y faldón a la variante 01 + valor", () => {
    const r = resolveEquipment(ap, 1, 0, [eq(1, 5)], url);
    expect([...r.geosets].sort()).toEqual([1002, 1301, 802]);
    expect(r.hiddenGroups.has(13)).toBe(true);
  });
  it("el pecho gana a la camisa en las mangas, sea cual sea el orden en que se equipan", () => {
    const a = resolveEquipment(ap, 1, 0, [eq(2, 4), eq(1, 5)], url);
    const b = resolveEquipment(ap, 1, 0, [eq(1, 5), eq(2, 4)], url);
    expect(a.geosets.has(802)).toBe(true);
    expect(a.geosets.has(803)).toBe(false);
    expect([...b.geosets].sort()).toEqual([...a.geosets].sort());
  });
  it("una túnica larga pone el faldón largo y oculta pantalón y rodilleras", () => {
    const r = resolveEquipment(ap, 1, 0, [eq(4, 7), eq(3, 20)], url);
    expect(r.geosets.has(1302)).toBe(true);
    expect(r.geosets.has(1301)).toBe(false);
    expect(r.geosets.has(903)).toBe(false);
    expect(r.geosets.has(1102)).toBe(false);
  });
  it("los pantalones ponen rodilleras y pantalón", () => {
    const r = resolveEquipment(ap, 1, 0, [eq(4, 7)], url);
    expect(r.geosets.has(903)).toBe(true);
    expect(r.geosets.has(1102)).toBe(true);
  });
  it("las texturas de sección van por sexo, con las de ambos como respaldo", () => {
    expect(resolveEquipment(ap, 1, 1, [eq(3, 20)], url).overlays.map((o) => o.url)).toEqual(["tex/9031.webp", "tex/9004.webp"]);
    expect(resolveEquipment(ap, 1, 0, [eq(3, 20)], url).overlays.map((o) => o.url)).toEqual(["tex/9030.webp", "tex/9004.webp"]);
  });
  it("el casco ancla un modelo de su raza y sexo y oculta el peinado", () => {
    const r = resolveEquipment(ap, 1, 1, [eq(5, 1)], url);
    expect(r.models).toEqual([{ attachment: 11, file: 5002, textures: { [-1]: 9055 }, slot: 1 }]);
    expect(r.helmetHides).toEqual([0]);
    expect(resolveEquipment(ap, 2, 0, [eq(5, 1)], url).helmetHides).toEqual([]);
  });
  it("una raza sin modelo propio usa el de la primera que lo tenga para su sexo", () => {
    expect(resolveEquipment(ap, 95, 0, [eq(5, 1)], url).models.map((m) => m.file)).toEqual([5001]);
  });
  it("las hombreras cuelgan de los dos hombros", () => {
    const r = resolveEquipment(ap, 1, 0, [eq(6, 3)], url);
    expect(r.models.map((m) => [m.file, m.attachment]).sort()).toEqual([[6001, 6], [6002, 5]]);
  });
  it("un solo modelo de hombrera se refleja para el otro hombro", () => {
    const one = { ...ap, display: { ...ap.display, "600": { m: [[61, 0, 0]] as [number, number, number][] } }, model: { ...ap.model, "61": [{ f: 6101, g: 3, r: 0, p: -1 }] } };
    const r = resolveEquipment(one, 1, 0, [eq(6, 3)], url);
    expect(r.models.map((m) => [m.attachment, !!m.mirror]).sort()).toEqual([[5, true], [6, false]]);
  });
  it("armas: dos manos pide su pose; escudo y una mano, la de una mano", () => {
    const two = resolveEquipment(ap, 1, 0, [eq(7, 17, "mainHand")], url);
    expect(two.pose).toBe("Ready2H");
    expect(two.models[0]).toMatchObject({ attachment: 1, file: 7001 });
    const one = resolveEquipment(ap, 1, 0, [eq(7, 13, "mainHand"), eq(8, 14, "offHand")], url);
    expect(one.pose).toBe("Ready1H");
    expect(one.models.map((m) => m.attachment).sort()).toEqual([0, 1]);
    expect(resolveEquipment(ap, 1, 0, [eq(1, 5)], url).pose).toBe("Stand");
  });
  it("objetos sin apariencia se ignoran", () => {
    const r = resolveEquipment(ap, 1, 0, [eq(999, 5)], url);
    expect(r.geosets.size).toBe(0);
    expect(r.models).toEqual([]);
  });
  it("avisa de los objetos que el cliente no deja dibujar (sin apariencia o con un modelo sin fichero), no de cuello ni anillos", () => {
    const hole = { ...ap, items: { ...ap.items, "9": 900 }, display: { ...ap.display, "900": { m: [[90, 0, 0]] as [number, number, number][] } } };
    expect(resolveEquipment(hole, 1, 0, [eq(999, 3)], url).missing).toEqual([999]);
    expect(resolveEquipment(hole, 1, 0, [eq(9, 3)], url).missing).toEqual([9]);
    expect(resolveEquipment(hole, 1, 0, [eq(999, 2), eq(998, 11), eq(997, 12)], url).missing).toEqual([]);
    expect(resolveEquipment(ap, 1, 0, [eq(6, 3)], url).missing).toEqual([]);
  });
});

describe("opciones de personalización del probador", () => {
  it("se reparten por zona según el nombre que da el cliente", () => {
    expect(["Color de piel", "Rostro", "Peinado", "Color de pelo", "Forma de cara", "Cejas", "Color de ojos", "Estilo de ojos", "Orejas", "Vello facial"].map((name) => groupOfOption({ name }))).toEqual([
      "body", "face", "hair", "hair", "face", "face", "face", "face", "face", "hair",
    ]);
    expect(["Tatuaje corporal", "Color del tatuaje", "Tatuaje facial", "Color del tatuaje facial", "Marcas", "Plumas", "Cuernos", "Crin frontal", "Pelo", "Roña"].map((name) => groupOfOption({ name }))).toEqual([
      "body", "body", "face", "face", "body", "body", "face", "hair", "hair", "body",
    ]);
  });
  it("las muestras de color salen del ARGB del cliente", () => {
    expect(swatchCss(0)).toBeNull();
    expect(swatchCss(0xff112233)).toBe("rgba(17, 34, 51, 1)");
    expect(isColorOption([{ swatch: 1 }, { swatch: 2 }, { swatch: 3 }])).toBe(true);
    expect(isColorOption([{ swatch: 0 }, { swatch: 0 }])).toBe(false);
  });
  it("◀ ▶ dan la vuelta a la lista", () => {
    const shown = [{ id: 10 }, { id: 11 }, { id: 12 }];
    expect(stepChoice(shown, 12, 1)).toBe(10);
    expect(stepChoice(shown, 10, -1)).toBe(12);
    expect(stepChoice(shown, 11, 1)).toBe(12);
    expect(stepChoice([], 5, 1)).toBe(5);
  });
});

describe("color de piel por defecto", () => {
  const choice = (id: number, swatch: number) => ({ id, name: "", req: 0, swatch, elements: [] });
  it("si la primera muestra es casi negra (Tauren) se parte de un marrón medio", () => {
    const o = { id: 1, name: "Color de piel", category: 0, categoryName: "", choices: [choice(1, 0xff343333), choice(2, 0xff857b54), choice(3, 0xff946026), choice(4, 0xffbebcaa)] };
    expect(defaultChoice(o)?.id).toBe(3);
  });
  it("si la primera es normal no se toca, ni en otras opciones de color (pelo negro)", () => {
    expect(defaultChoice({ id: 1, name: "Color de piel", category: 0, categoryName: "", choices: [choice(1, 0xffc6a07c), choice(2, 0xff343333)] })?.id).toBe(1);
    expect(defaultChoice({ id: 2, name: "Color de pelo", category: 0, categoryName: "", choices: [choice(1, 0xff191919), choice(2, 0xff946026)] })?.id).toBe(1);
  });
});
