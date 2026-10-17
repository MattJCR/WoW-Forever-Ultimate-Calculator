/**
 * Variables de descripcion de los hechizos (tablas SpellDescriptionVariables y SpellXDescriptionVariables del cliente):
 * bloques de lineas `$nombre=expresion` que los textos usan como `$<nombre>`. Las de Forever escalan los valores con el
 * nivel del personaje ($damagepower = a + b x $PL + c x $PL^2, $healpower...) y hay otras de uso puntual ($minDam, $mult...).
 *
 * Lenguaje de las expresiones: `${...}` aritmetica, `$PL`/`$pl` nivel, `$SPS`/`$SPFI`... poder con hechizos (aqui 0: no hay
 * estadisticas de Forever), `$<otra>` otra variable, `$cond(c,a,b)`, `$gt(a,b)`..., y `$?s123[a][b]` / `$?a123[a][b]` =
 * «si el personaje conoce el hechizo / tiene el aura 123 vale a, si no b» (aqui siempre b: sin talentos).
 */

export type Poly = [number, number, number];

export function parseVariables(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const m = /^\$([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

const POLY = /^\$\{\s*(-?[\d.]+)\s*([+-])\s*([\d.]+)\*\$PL\s*([+-])\s*([\d.]+)\*\$PL\*\$PL\s*\}$/;

/** `${a+b*$PL+c*$PL*$PL}` -> [a, b, c]; null si la variable no tiene esa forma. */
export function polynomialOf(def: string | undefined): Poly | null {
  const m = def ? POLY.exec(def.trim()) : null;
  if (!m) return null;
  return [Number(m[1]), Number(`${m[2]}${m[3]}`), Number(`${m[4]}${m[5]}`)];
}

export const polyAt = (p: Poly, level: number): number => p[0] + p[1] * level + p[2] * level * level;

const FUNCTIONS = /(cond|gte|gt|lte|lt|min|max|abs|floor|NaN)/g;

/** Valor de la variable `name` al nivel `pl`, o null si depende de algo que no se puede calcular. */
export function evaluateVariable(defs: ReadonlyMap<string, string>, name: string, pl: number, seen: ReadonlySet<string> = new Set()): number | null {
  const def = defs.get(name);
  if (def === undefined || seen.has(name)) return null;
  let e = def.trim();
  e = e.replace(/\$\?[sa]\d+\[([^\]]*)\]\[([^\]]*)\]/g, "$2").replace(/\$\{/g, "(").replace(/\}/g, ")");
  let failed = false;
  e = e.replace(/\$<(\w+)>/g, (_m, n: string) => {
    const v = evaluateVariable(defs, n, pl, new Set([...seen, name]));
    if (v === null) failed = true;
    return `(${v ?? 0})`;
  });
  e = e.replace(/\$(?:PL|pl)(?![A-Za-z])/g, String(pl)).replace(/\$(?:SP[A-Za-z]*|sp[A-Za-z]*)(?![A-Za-z])/g, "0");
  e = e.replace(/\$(cond|gte|gt|lte|lt|min|max|abs|floor)\(/g, "$1(");
  if (failed || e.includes("$") || !/^[0-9+\-*/().,\s]*$/.test(e.replace(FUNCTIONS, ""))) return null;
  try {
    const fn = new Function("cond", "gt", "gte", "lt", "lte", "min", "max", "abs", "floor", `return (${e});`) as (...f: unknown[]) => number;
    const v = fn(
      (c: number, a: number, b: number) => (c ? a : b),
      (a: number, b: number) => (a > b ? 1 : 0),
      (a: number, b: number) => (a >= b ? 1 : 0),
      (a: number, b: number) => (a < b ? 1 : 0),
      (a: number, b: number) => (a <= b ? 1 : 0),
      Math.min,
      Math.max,
      Math.abs,
      Math.floor,
    );
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
