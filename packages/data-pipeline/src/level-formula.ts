/**
 * Evalúa a un nivel de lanzador las fórmulas `${...}` del texto del cliente: aritmética con `$PL` (nivel del lanzador), `$cond(c,a,b)` y `$gte(a,b)`.
 * Devuelve el texto con las fórmulas sustituidas y las cifras de cada una; null si alguna no se puede evaluar.
 */
export function resolveLevelFormulas(text: string, level: number): { text: string; values: number[] } | null {
  const values: number[] = [];
  let failed = false;
  const out = text.replace(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_m, inner: string) => {
    const v = evalLevelFormula(inner, level);
    if (v === null) {
      failed = true;
      return "";
    }
    values.push(v);
    return String(Math.round(v * 100) / 100).replace(".", ",");
  });
  return failed ? null : { text: out, values };
}

export function evalLevelFormula(src: string, level: number): number | null {
  const s = src.replace(/\s+/g, "");
  let pos = 0;
  const fail = (): never => {
    throw new Error("fórmula no válida");
  };
  const call = (name: string): number => {
    const args: number[] = [];
    pos++; // (
    while (s[pos] !== ")") {
      args.push(sum());
      if (s[pos] === ",") pos++;
      else if (s[pos] !== ")") fail();
    }
    pos++;
    if (name === "gte" && args.length === 2) return args[0]! >= args[1]! ? 1 : 0;
    if (name === "cond" && args.length === 3) return args[0] !== 0 ? args[1]! : args[2]!;
    return fail();
  };
  const atom = (): number => {
    if (s[pos] === "(") {
      pos++;
      const v = sum();
      if (s[pos++] !== ")") fail();
      return v;
    }
    if (s[pos] === "-") {
      pos++;
      return -atom();
    }
    if (s[pos] === "$") {
      const m = /^\$([A-Za-z]+)/.exec(s.slice(pos));
      if (!m) return fail();
      pos += m[0].length;
      if (m[1] === "PL") return level;
      return call(m[1]!.toLowerCase());
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(pos));
    if (!m) return fail();
    pos += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = atom();
    while (s[pos] === "*" || s[pos] === "/") {
      const op = s[pos++];
      const r = atom();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (s[pos] === "+" || s[pos] === "-") {
      const op = s[pos++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    const v = sum();
    // El cliente cierra de más algún paréntesis (el de Cuerno de Lordaeron): se ignoran los sobrantes del final
    return (pos === s.length || /^\)+$/.test(s.slice(pos))) && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

