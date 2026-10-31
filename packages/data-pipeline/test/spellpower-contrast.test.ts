import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = join(root, "data", "forever", "1.60.1.70707", "abilities");
const READINGS = join(root, "data", "external", "lootified", "SpellPower.lua");
const ready = existsSync(READINGS) && existsSync(OUT);

interface Effect { kind: string; coefficient: number | null; periodMs: number | null; viaSpellId: number | null }
interface Ability { name: string; ranks: { spellId: number; effects: Effect[] }[] }

/** `[hechizo] = { directo, por tic }` de las lecturas del juego (build 70205): la parte del poder con hechizos de cada hechizo. */
const readings = (): Map<number, [number, number]> =>
  new Map([...readFileSync(READINGS, "utf8").matchAll(/\[(\d+)\]\s*=\s*\{\s*([\d.]+),\s*([\d.]+)\s*\}/g)].map((m) => [Number(m[1]), [Number(m[2]) === 1 ? 0 : Number(m[2]), Number(m[3]) === 1 ? 0 : Number(m[3])] as [number, number]]));

/** Coeficiente directo y por tic que tiene cada hechizo en nuestras habilidades (el 1 exacto es relleno de la columna, no un coeficiente). */
function ours(): { own: Map<number, [number, number]>; triggered: Map<number, [number, number]> } {
  const own = new Map<number, [number, number]>();
  const triggered = new Map<number, [number, number]>();
  const add = (map: Map<number, [number, number]>, id: number, e: Effect) => {
    const cur = map.get(id) ?? [0, 0];
    if (e.coefficient !== null && e.coefficient !== 1) {
      if (e.periodMs) cur[1] = Math.max(cur[1], e.coefficient);
      else if (e.kind !== "other") cur[0] = Math.max(cur[0], e.coefficient);
    }
    map.set(id, cur);
  };
  for (const f of readdirSync(OUT).filter((n) => n.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(OUT, f), "utf8")) as { abilities?: Ability[] };
    for (const a of data.abilities ?? []) for (const r of a.ranks) for (const e of r.effects) {
      add(own, r.spellId, e); // lo que suma el rango, venga de su hechizo o de uno disparado
      if (e.viaSpellId) add(triggered, e.viaSpellId, e);
    }
  }
  return { own, triggered };
}

describe.skipIf(!ready)("coeficientes de poder con hechizos frente a las lecturas del juego (solo contraste local)", () => {
  const ref = readings();
  const { own, triggered } = ours();
  const close = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 0.002 && Math.abs(a[1] - b[1]) < 0.002;
  const found = (id: number): [number, number] | undefined => {
    const a = own.get(id), b = triggered.get(id);
    return a && b ? [Math.max(a[0], b[0]), Math.max(a[1], b[1])] : (a ?? b);
  };

  /** La referencia pone en «directo» la cifra de los hechizos canalizados o de zona por tics (Ventisca, Misiles Arcanos); el cliente la trae por tic. */
  const asChannel = (o: [number, number], v: [number, number]) => v[1] === 0 && o[0] === 0 && Math.abs(o[1] - v[0]) < 0.002;

  it("la gran mayoría coincide y lo que difiere es una lista cerrada (ids del hechizo)", () => {
    const known = [...ref].filter(([id]) => found(id));
    const same = known.filter(([id, v]) => close(found(id)!, v) || asChannel(found(id)!, v)).length;
    const different = known.filter(([id, v]) => !close(found(id)!, v) && !asChannel(found(id)!, v)).map(([id]) => id);
    expect(same).toBeGreaterThan(480);
    // Consagración 0,095 frente a 0,042, Explosión Arcana 0,714 frente a 0,429, Penitencia 0,285 frente a 0,19 y Nova de fuego 0,1 frente a 0,143:
    // el cliente trae nuestra cifra en las dos copias que tenemos (70425 y 70450); la referencia es de un build anterior (70205)
    expect(different).toEqual([20116, 20922, 20923, 20924, 26573, 400574, 402174, 408341, 1239696, 1239697, 1239699, 1239700, 1240720, 1240721, 1310911, 1311590, 1311595, 1316995]);
    // 1310911, 1311590 y 1311595 (Vigilia de la Luz): desde el 70707 sana a un aliado (antes dañaba) y el cliente trae otro coeficiente que la lectura antigua de la comunidad
  });

  it("los hechizos que la referencia no ve en nuestras habilidades son disparados, un hechizo de objeto o una raza", () => {
    const missing = [...ref.keys()].filter((id) => !found(id));
    // 24530 Pirovil (objeto), 1219275 Peste devoradora (racial de los no-muertos, no es habilidad de clase)
    expect(missing).toEqual([24530, 1219275]);
  });
});
