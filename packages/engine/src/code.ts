import { rankOf, validateBuild, type Build, type ClassIndex } from "./rules.js";

/**
 * Codigo corto de un build: un digito de rango (0-5) por talento en orden estable
 * (especializacion, fila, columna), con '-' entre especializaciones y sin ceros finales.
 * Ejemplo: "5500-0-23". Depende del orden de los datos de la version: la URL guarda tambien el build del juego.
 */
export function encodeBuild(idx: ClassIndex, build: Build): string {
  const parts: string[] = [];
  for (const spec of idx.data.specs) {
    const digits = idx.ordered
      .filter((i) => i.specIndex === spec.index)
      .map((i) => String(rankOf(build, i.talent.nodeId)))
      .join("");
    parts.push(digits.replace(/0+$/, ""));
  }
  return parts.join("-");
}

/** Devuelve el build o null si el codigo no es valido para estos datos. */
export function decodeBuild(idx: ClassIndex, code: string): Build | null {
  const parts = code.split("-");
  if (parts.length !== idx.data.specs.length) return null;
  const build: Record<number, number> = {};
  for (const spec of idx.data.specs) {
    const digits = parts[spec.index]!;
    if (!/^[0-9]*$/.test(digits)) return null;
    const talents = idx.ordered.filter((i) => i.specIndex === spec.index);
    if (digits.length > talents.length) return null;
    for (let i = 0; i < digits.length; i++) {
      const rank = Number(digits[i]);
      if (rank > 0) build[talents[i]!.talent.nodeId] = rank;
    }
  }
  return validateBuild(idx, build).ok ? build : null;
}
