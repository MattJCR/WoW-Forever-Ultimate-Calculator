import { int } from "./csv.js";
import { polyAt } from "./desc-variables.js";
import type { SpellTables } from "./spell-tables.js";

export interface RenderContext {
  /** Hechizo del talento: sus efectos se escalan con las curvas del rango. */
  spellId: number;
  rank: number;
  /** effectIndex (0-based) -> CurveID, de TraitDefinitionEffectPoints. */
  curves: ReadonlyMap<number, number>;
  /**
   * Modo plantilla: los marcadores de valor ($s1, $d, $a1, $t1, $o1...) salen como {{tipo:hechizo:indice|valorBase}} para que el motor
   * los rellene con el valor del nivel y de los talentos. Las expresiones ${...} se calculan como siempre.
   */
  slots?: boolean;
}

export interface Rendered {
  text: string;
  /** false si algun marcador no se pudo calcular (queda tal cual en el texto). */
  complete: boolean;
  /** true si algun valor depende del nivel del personaje (puntos por nivel/variacion): es el valor base. */
  approximate: boolean;
}

interface Value {
  num: number | null;
  text: string;
  /** El valor depende del nivel del personaje; aqui es el valor base del cliente. */
  approx?: boolean;
}

export type RenderLocale = "es" | "en";
let locale: RenderLocale = "es";

/** Ejecuta `fn` renderizando en ese idioma (decimales, unidades y frases que añade el propio render). Es sincrono: no se mezclan idiomas. */
export function withRenderLocale<T>(l: RenderLocale, fn: () => T): T {
  const before = locale;
  locale = l;
  try {
    return fn();
  } finally {
    locale = before;
  }
}

/** 1 -> "1", 2.5 -> "2,5" (el cliente en espanol usa coma decimal; en ingles, punto). */
export function formatNumber(v: number): string {
  const r = Math.round(v * 100) / 100;
  return locale === "en" ? String(r) : String(r).replace(".", ",");
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (locale === "en") {
    if (s < 60) return `${formatNumber(s)} sec`;
    if (s < 3600) return `${formatNumber(s / 60)} min`;
    return `${formatNumber(s / 3600)} hr`;
  }
  if (s < 60) return `${formatNumber(s)} s`;
  if (s < 3600) return `${formatNumber(s / 60)} min`;
  return `${formatNumber(s / 3600)} h`;
}

/** Quita los codigos de color del cliente: |cAARRGGBB ... |r (mayusculas o minusculas). */
const stripColors = (s: string): string => s.replace(/\|c[0-9a-f]{8}/gi, "").replace(/\|r/gi, "");

/** Marcadores que dependen del personaje (poder de ataque, nivel...): no se pueden calcular sin el. */
const PLAYER_DEPENDENT = /^(pl|ap|sp|rap|bc|mhd|ohd|rd)/i;
const TOKEN = /\$(\d+)?(pl|ap|sp|rap|bc|[A-Za-z])(\d*)/g;

/** Valor de un marcador: $s1, $d, $22959s1, $h... o null si no se puede calcular. */
function tokenValue(t: SpellTables, ctx: RenderContext, spellRef: number | null, kind: string, idxText: string): Value | null {
  if (PLAYER_DEPENDENT.test(kind) && kind.length > 1) return null;
  const spellId = spellRef ?? ctx.spellId;
  const idx = idxText ? int(idxText) : 1;
  const own = spellId === ctx.spellId;

  // Un texto de Forever puede citar el efecto 2 en un hechizo de un solo efecto (Amplificar maldicion «$s2%», Poder cambiante
  // «$s2 p. de energia», Plan de contingencia «$o2»): vale el unico efecto. Reproduce las cifras de la referencia (50 %, 40 de energia, 670 de sanacion)
  const effectRow = (i: number) => t.effect(spellId, i - 1) ?? (i > 1 && t.effectCount(spellId) === 1 ? t.effect(spellId, 0) : null);
  /** Valor (con signo) del efecto idx, o el de la curva del rango si es el hechizo del talento. */
  const effectValue = (i: number): number | null => {
    const e = effectRow(i);
    if (!e) return null;
    const curve = own ? ctx.curves.get(i - 1) : undefined;
    const fromCurve = curve === undefined ? null : t.curveValue(curve, ctx.rank);
    const v = fromCurve ?? Number(e.EffectBasePointsF);
    return Number.isFinite(v) ? v : null;
  };

  switch (kind) {
    case "w":
    case "W":
    case "s":
    case "S": {
      // $s muestra y calcula siempre el valor absoluto
      const v = effectValue(idx);
      return v === null ? null : { num: Math.abs(v), text: formatNumber(Math.abs(v)), approx: t.isLevelScaled(spellId, idx - 1) };
    }
    case "m":
    case "M": {
      // $m = minimo y $M = maximo del efecto (media -/+ la mitad de la dispersion: valor x variacion). $m se muestra en valor
      // absoluto, pero dentro de ${...} conserva el signo (p. ej. ${$m2/-1000})
      const base = effectValue(idx);
      if (base === null) return null;
      const spread = Number(t.effect(spellId, idx - 1)?.Variance) || 0;
      const v = base * (1 + (kind === "M" ? 1 : -1) * (spread / 2));
      return { num: v, text: formatNumber(Math.abs(v)), approx: t.isLevelScaled(spellId, idx - 1) };
    }
    case "d":
    case "D": {
      const ms = t.durationMs(spellId);
      return ms === null ? null : { num: ms / 1000, text: formatDuration(ms) };
    }
    case "t":
    case "T": {
      const ms = int(t.effect(spellId, idx - 1)?.EffectAuraPeriod);
      return ms > 0 ? { num: ms / 1000, text: formatNumber(ms / 1000) } : null;
    }
    case "o":
    case "O": {
      const v = effectValue(idx);
      const ms = t.durationMs(spellId);
      const period = int(effectRow(idx)?.EffectAuraPeriod);
      if (v === null || ms === null || period <= 0) return null;
      const total = Math.abs(v) * (ms / period);
      return { num: total, text: formatNumber(total), approx: t.isLevelScaled(spellId, idx - 1) };
    }
    case "a":
    case "A": {
      const r = t.radiusFor(spellId, idx);
      return r === null ? null : { num: r, text: formatNumber(r) };
    }
    case "f":
    case "F": {
      // $f / $F = amplitud de cadena del efecto (Ejecutar: $*10;F1 = 10 x 1,5 = 15 p. de dano extra por cada punto de ira)
      const amp = Number(t.effect(spellId, idx - 1)?.EffectChainAmplitude);
      return Number.isFinite(amp) && amp > 0 ? { num: amp, text: formatNumber(amp) } : null;
    }
    case "b":
    case "B": {
      // $bN = puntos extra por cada recurso (punto de combo) del efecto N: Eviscerar «${$m1+(3*$b1*$<mult>)}»
      const v = Number(t.effect(spellId, idx - 1)?.EffectPointsPerResource);
      return Number.isFinite(v) && v !== 0 ? { num: v, text: formatNumber(v), approx: t.isLevelScaled(spellId, idx - 1) } : null;
    }
    case "q":
    case "Q": {
      // $qN = valor auxiliar (EffectMiscValue) del efecto N: Revivir «750 de salud y $q1 de maná» = 1000
      const v = Math.abs(int(t.effect(spellId, idx - 1)?.["EffectMiscValue[0]"]));
      return v > 0 ? { num: v, text: formatNumber(v) } : null;
    }
    case "r":
    case "R": {
      // $NNNr = alcance del hechizo NNN en yardas (Totem abrasador «en un radio de $10436r metros» = 20)
      const v = t.rangeYd(spellId);
      return v === null ? null : { num: v, text: formatNumber(v) };
    }
    case "i":
    case "I": {
      // $i = objetivos maximos (Trueno «hasta 4 objetivos»)
      const v = t.targetLimit(spellId)?.maxTargets ?? 0;
      return v > 0 ? { num: v, text: String(v) } : null;
    }
    case "v":
    case "V": {
      // $v = nivel maximo del objetivo
      const v = t.targetLimit(spellId)?.maxTargetLevel ?? 0;
      return v > 0 ? { num: v, text: String(v) } : null;
    }
    case "x":
    case "X": {
      const n = int(t.effect(spellId, idx - 1)?.EffectChainTargets);
      return n > 0 ? { num: n, text: String(n) } : null;
    }
    case "u":
    case "U": {
      const n = t.aura(spellId)?.cumulativeAura ?? 0;
      return n > 0 ? { num: n, text: String(n) } : null;
    }
    case "h":
    case "H": {
      const p = t.aura(spellId)?.procChance ?? 0;
      return p > 0 && p <= 100 ? { num: p, text: String(p) } : null;
    }
    case "n":
    case "N": {
      const n = t.aura(spellId)?.procCharges ?? 0;
      return n > 0 ? { num: n, text: String(n) } : null;
    }
    default:
      return null;
  }
}

/** Evaluador aritmetico seguro (+ - * / y parentesis) para las expresiones ${...}. Lanza si es invalida. */
function evaluate(expr: string): number {
  let pos = 0;
  const s = expr.replace(/\s+/g, "");
  const peek = () => s[pos];
  const number = (): number => {
    if (peek() === "(") {
      pos++;
      const v = sum();
      if (peek() !== ")") throw new Error("falta )");
      pos++;
      return v;
    }
    if (peek() === "-") {
      pos++;
      return -number();
    }
    if (peek() === "+") {
      pos++;
      return number();
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(pos));
    if (!m) throw new Error(`numero esperado en ${expr}`);
    pos += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = number();
    while (peek() === "*" || peek() === "/") {
      const op = s[pos++];
      const r = number();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = s[pos++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  if (pos !== s.length) throw new Error(`sobra texto en ${expr}`);
  if (!Number.isFinite(v)) throw new Error("no finito");
  return v;
}

/** Evalua el interior de ${...}: sustituye los marcadores por su valor numerico y calcula. */
function evaluateExpression(t: SpellTables, ctx: RenderContext, inner: string): { value: number; approx: boolean } | null {
  let failed = false;
  let approx = false;
  const substituted = inner.replace(TOKEN, (_m, ref: string | undefined, kind: string, idx: string) => {
    const v = tokenValue(t, ctx, ref ? int(ref) : null, kind, idx);
    if (!v || v.num === null) {
      failed = true;
      return "0";
    }
    approx ||= !!v.approx;
    return `(${v.num})`;
  });
  if (failed || !/^[0-9+\-*/().\s]*$/.test(substituted)) return null;
  try {
    return { value: evaluate(substituted), approx };
  } catch {
    return null;
  }
}

/** Cierra el `}` que corresponde al `{` de la posicion `open` (con anidamiento). */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

const PLAYER_LEVEL = /\$pl(?![A-Za-z])/;
const MAX_PLAYER_LEVEL = 60;

/**
 * `$proccooldown` = enfriamiento interno del proc del propio hechizo (SpellAuraOptions.ProcCategoryRecovery, en ms):
 * 3000 -> "3" y `${$proccooldown}.1` -> "1,5" (Especializacion en escudos 3 s, La hora de la verdad 1,5 s: coincide con
 * La referencia). Sin enfriamiento en el cliente se deja el marcador y el texto queda incompleto.
 */
function withProcCooldown(t: SpellTables, spellId: number, src: string): string {
  if (!/\$proccooldown/i.test(src)) return src;
  const ms = t.aura(spellId)?.procCooldownMs ?? 0;
  if (ms <= 0) return src;
  const seconds = ms / 1000;
  return src
    .replace(/\$\{([^}]*)\}/g, (m, inner: string) => (/\$proccooldown/i.test(inner) ? m.replace(/\$proccooldown/gi, String(seconds)) : m))
    .replace(/\$proccooldown/gi, formatNumber(seconds));
}

/**
 * Referencias a otros textos o datos del hechizo que se resuelven antes de calcular los marcadores:
 * `$@spelltooltipNNN` / `$@spelldescNNN` = el texto de ese hechizo; `$c p. de maná` = el coste del propio hechizo (en % del maná
 * base si el cliente lo guarda asi: Poder cambiante «55 % del maná base», como la referencia); `${$s1+($rap*($s4/100))}` = valor mas un
 * porcentaje del poder de ataque a distancia (el poder no se calcula: no hay estadisticas de Forever).
 */
function expandReferences(t: SpellTables, ctx: RenderContext, text: string, depth = 0): string {
  let out = text;
  if (depth < 3) {
    out = out.replace(/\$@spell(?:tooltip|desc)(\d+)/g, (_m, id: string) => {
      const sub = t.clientDescription(Number(id));
      return sub ? renderSpellText(t, sub, { ...ctx, spellId: Number(id), curves: new Map(), slots: false }).text : "";
    });
  }
  // Multiplicador de un talento pasivo (`(1+$18182m1/100)` = Transfusion de vida mejorada): sin el talento vale 1
  out = out.replace(/\(1\+\$(\d+)[mMsS]\d\/100\)/g, (m, id: string) => (t.isPassive(Number(id)) ? "(1)" : m));
  // Mismo multiplicador con el orden invertido (`($11189s3/100+1)` = Custodia de Escarcha en Barrera de hielo, hotfix del 20/10)
  out = out.replace(/\(\$(\d+)[mMsS]\d\/100\+1\)/g, (m, id: string) => (t.isPassive(Number(id)) ? "(1)" : m));
  // Condicionales de talento/aura: `$?a12792[con talento][sin talento]` -> la rama sin talentos (aqui no hay talentos)
  out = out.replace(/\$\?\$?[sap]\d+(?:\|[sap]\d+)*\[([^\]]*)\]\[([^\]]*)\]/g, "$2");
  // Poder de ataque: `${1+$AP*$m3/100}` -> «un 15% de tu poder de ataque» (el poder no se calcula: no hay estadisticas de Forever)
  const en = locale === "en";
  out = out.replace(/\$\{(?:(\d+(?:\.\d+)?)\+)?\$AP\*(\$\d*[mMsS]\d)\/100\}/g, (_m, k: string | undefined, ref: string) =>
    en ? `${k && Number(k) > 1 ? `\${${k}} plus ` : ""}\${${ref}}% of your attack power` : `${k && Number(k) > 1 ? `\${${k}} más ` : ""}un \${${ref}}% de tu poder de ataque`,
  );
  out = out.replace(en ? /\$c mana/g : /\$c p\. de maná/g, () => {
    const pw = t.powerCost(ctx.spellId);
    if (pw && pw.pct > 0) return en ? `${formatNumber(pw.pct)}% of base mana` : `${formatNumber(pw.pct)} % del maná base`;
    if (pw && pw.mana > 0) return en ? `${formatNumber(pw.mana)} mana` : `${formatNumber(pw.mana)} p. de maná`;
    return en ? "$c mana" : "$c p. de maná";
  });
  out = out.replace(/\$\{(\$\d*s\d+)\+\(\$rap\*\((\$\d*s\d+)\/100\)\)\}/g, en ? "${$1} (plus ${$2}% of your ranged attack power)" : "${$1} (más un ${$2}% de tu poder de ataque a distancia)");
  return out;
}

/**
 * `${$m1*$<damagepower>/100}` (o `$<healpower>*$m1/100`, con `*N` opcional): valor del efecto por un polinomio del nivel de las
 * variables de Forever. Devuelve el hueco `{{tipo:hechizo:efecto|valor a nivel 60}}` (l minimo, h maximo, s medio, o total periodico).
 */
function powerSlot(t: SpellTables, ctx: RenderContext, rawInner: string): { text: string; value: number } | null {
  const norm = rawInner.replace(/\s+/g, "");
  const a = /^\$(\d*)([mMsS])(\d)\*\$<(\w+)>\/100(?:\*(\d+))?$/.exec(norm);
  const b = /^\$<(\w+)>\*\$(\d*)([mMsS])(\d)\/100(?:\*(\d+))?$/.exec(norm);
  const m = a ? { ref: a[1], letter: a[2]!, idx: a[3]!, name: a[4]!, times: a[5] } : b ? { ref: b[2], letter: b[3]!, idx: b[4]!, name: b[1]!, times: b[5] } : null;
  if (!m) return null;
  const poly = t.variablePolynomial(ctx.spellId, m.name);
  if (!poly) return null;
  const ref = m.ref ? int(m.ref) : ctx.spellId;
  const base = tokenValue(t, ctx, ref, m.letter === "M" ? "M" : "m", m.idx);
  if (!base || base.num === null) return null;
  const value = ((m.letter === "s" || m.letter === "S" ? Math.abs(base.num) : base.num) * polyAt(poly, MAX_PLAYER_LEVEL)) / 100;
  const slot = m.times ? "o" : m.letter === "M" ? "h" : m.letter === "m" ? "l" : "s";
  const shown = m.times ? value * Number(m.times) : value;
  return { text: `{{${slot}:${ref}:${m.idx}|${formatNumber(Math.abs(shown))}}}`, value: shown };
}

/**
 * `${4*$1282380m1}` / `${$m2*4}`: un efecto por una constante. Hueco `{{tipo:hechizo:efecto*K|valor}}`: el motor recalcula el efecto con el
 * nivel y lo multiplica por K (Lluvia de Fuego: 160 base, 164 a nivel 60 como la referencia).
 */
function multiplierSlot(t: SpellTables, ctx: RenderContext, rawInner: string): { text: string; value: number } | null {
  const norm = rawInner.replace(/\s+/g, "");
  const a = /^(\d+(?:\.\d+)?)\*\$(\d*)([mMsS])(\d)$/.exec(norm);
  const b = /^\$(\d*)([mMsS])(\d)\*(\d+(?:\.\d+)?)$/.exec(norm);
  const m = a ? { k: a[1]!, ref: a[2], letter: a[3]!, idx: a[4]! } : b ? { k: b[4]!, ref: b[1], letter: b[2]!, idx: b[3]! } : null;
  if (!m) return null;
  const ref = m.ref ? int(m.ref) : ctx.spellId;
  const base = tokenValue(t, ctx, ref, m.letter === "M" ? "M" : m.letter === "m" ? "m" : "s", m.idx);
  if (!base || base.num === null) return null;
  const value = Math.abs(base.num) * Number(m.k);
  const slot = m.letter === "M" ? "h" : m.letter === "m" ? "l" : "s";
  return { text: `{{${slot}:${ref}:${m.idx}*${m.k}|${formatNumber(value)}}}`, value };
}

/**
 * Expresion aritmetica con valores de efectos ($m1, $18182m1...) convertida a `EXPR` con `@0`, `@1`... y la lista de `tipo:hechizo:efecto`
 * (m minimo, M maximo, s medio) para que el motor la evalue con el nivel. Null si no hay efectos o algo no se puede calcular.
 */
function expressionSlot(t: SpellTables, ctx: RenderContext, inner: string): { expr: string; tokens: string[] } | null {
  const tokens: string[] = [];
  let failed = false;
  const expr = inner.replace(TOKEN, (_m, ref: string | undefined, kind: string, idx: string) => {
    const refId = ref ? int(ref) : ctx.spellId;
    if (kind.length === 1 && "sSmMwWoO".includes(kind) && idx) {
      const v = tokenValue(t, ctx, refId === ctx.spellId ? null : refId, kind === "S" || kind === "w" || kind === "W" ? "s" : kind === "O" ? "o" : kind, idx);
      if (!v || v.num === null) {
        failed = true;
        return "0";
      }
      tokens.push(`${kind === "m" || kind === "M" ? kind : kind === "o" || kind === "O" ? "o" : "s"}:${refId}:${idx}`);
      return `@${tokens.length - 1}`;
    }
    const v = tokenValue(t, ctx, ref ? int(ref) : null, kind, idx);
    if (!v || v.num === null) {
      failed = true;
      return "0";
    }
    return `(${v.num})`;
  });
  const clean = expr.replace(/\s+/g, "");
  if (failed || tokens.length === 0 || !/^[0-9+\-*/().@]*$/.test(clean)) return null;
  return { expr: clean, tokens };
}

/**
 * Sustituye los marcadores de una descripcion del cliente ($s1, $d, ${$m1/1000}, $l singular:plural;...).
 * Lo que no se pueda calcular (poder de ataque, condiciones de aura...) se deja tal cual y se marca incompleto.
 */
export function renderSpellText(t: SpellTables, template: string, ctx: RenderContext): Rendered {
  const rawText = expandReferences(t, ctx, stripColors(template).replace(/\|n/gi, "\n"));
  // $pl = nivel del personaje: se toma el maximo (60, como la referencia: Egida divina "hasta 1.200" = 20 x 60) y el valor es aproximado
  const usesLevel = PLAYER_LEVEL.test(rawText);
  const src = withProcCooldown(t, ctx.spellId, rawText.replace(new RegExp(PLAYER_LEVEL, "g"), String(MAX_PLAYER_LEVEL)));
  let out = "";
  let complete = true;
  let approximate = usesLevel;
  let lastNumber: number | null = null;

  for (let i = 0; i < src.length; ) {
    const ch = src[i]!;
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    const rest = src.slice(i);

    // ${ expresion }
    if (rest.startsWith("${")) {
      const end = matchBrace(src, i + 1);
      if (end > 0) {
        // Expresiones nuevas de Forever: valor del efecto por una variable del personaje ($<frostdamage>). Con el modo
        // plantilla se convierten en huecos (l = minimo, h = maximo, z = valor x duracion) y la variable vale 1
        // (sin poder con hechizos).
        // Variables del personaje sin poder con hechizos: bonus de sanacion/dano ($bh, $bc, $<1h>, $<2h>) = 0 y multiplicador $<mult> = 1.
        // Reproduce las cifras de la referencia (Rezo de alivio 172, Sello de rectitud 22-75)
        const rawInner = src.slice(i + 2, end);
        // Valor del efecto x variable de nivel de Forever ($m1*$<damagepower>/100): en el modo plantilla es un hueco que el motor
        // recalcula con el nivel (el efecto lleva el polinomio); si no, se calcula a nivel 60
        const power = ctx.slots ? (powerSlot(t, ctx, rawInner) ?? multiplierSlot(t, ctx, rawInner)) : null;
        if (power) {
          out += power.text;
          lastNumber = power.value;
          approximate = true;
          i = end + 1;
          continue;
        }
        let inner = rawInner.replace(/\$<mult>/g, "1").replace(/\$<\d+h>/g, "0").replace(/\$b[hc](?![A-Za-z])/g, "0").replace(/\$(?:SPI|STR|AGI|STA|INT|SP[A-Z]{2})(?![A-Za-z])/g, "0");
        if (ctx.slots && /\$<\w+>/.test(rawInner)) {
          const norm = inner.replace(/\$\*/g, "*").replace(/\$<\w+>/g, "1").replace(/\s+/g, "");
          const own = /^\$([mM])(\d+)\*1$/.exec(norm);
          const over = /^\$(\d+)([mM])(\d+)\*\$d\*1$/.exec(norm);
          if (own || over) {
            const ref = over ? int(over[1]) : ctx.spellId;
            const letter = (own ? own[1] : over![2])!;
            const idx = own ? own[2]! : over![3]!;
            const base = tokenValue(t, ctx, ref, "m", idx);
            if (base) {
              const slot = over ? "z" : letter === "M" ? "h" : "l";
              const shown = over ? (base.num ?? 0) * ((t.durationMs(ctx.spellId) ?? 0) / 1000) : (base.num ?? 0);
              out += `{{${slot}:${ref}:${idx}|${formatNumber(Math.abs(shown))}}}`;
              lastNumber = shown;
              i = end + 1;
              continue;
            }
          }
        }
        // Variables de descripcion del hechizo ($<minDam>, $<damagepower>, $<base>...): su valor a nivel 60, sin poder con hechizos
        inner = inner.replace(/\$<(\w+)>/g, (m, n: string) => {
          const v = t.variable(ctx.spellId, n);
          if (v === null) return m;
          if (t.variableDependsOnLevel(ctx.spellId, n)) approximate = true;
          return `(${v})`;
        });
        const res = evaluateExpression(t, ctx, inner);
        // Modo plantilla: una expresion con valores de efectos se deja como hueco `{{=EXPR;m:hechizo:efecto;...|valor}}` que el motor
        // recalcula con el nivel (Transfusion de vida «${($m1+$SPI*1)*(1+$18182m1/100)}», Lengua de Fuego «${$8026m1/77-1+($29469m1)}»)
        const noDecimals = !/^\.\d/.test(src.slice(end + 1));
        const slot = ctx.slots && res !== null && noDecimals ? expressionSlot(t, ctx, inner) : null;
        if (slot && res !== null) {
          out += `{{=${slot.expr};${slot.tokens.join(";")}|${formatNumber(Math.abs(res.value) < 1e-9 ? 0 : res.value)}}}`;
          lastNumber = res.value;
          approximate ||= res.approx;
          i = end + 1;
          continue;
        }
        // ${expr}.2 = exactamente 2 decimales
        const decimals = /^\.(\d)/.exec(src.slice(end + 1));
        if (res === null) {
          complete = false;
          out += src.slice(i, end + 1);
          i = end + 1;
        } else {
          const v = res.value;
          out += decimals ? (locale === "en" ? v.toFixed(Number(decimals[1])) : v.toFixed(Number(decimals[1])).replace(".", ",")) : formatNumber(Math.abs(v) < 1e-9 ? 0 : v);
          lastNumber = v;
          approximate ||= res.approx;
          i = end + 1 + (decimals ? decimals[0].length : 0);
        }
        continue;
      }
    }

    // $<minDam>: variable de descripcion suelta (valor a nivel 60 sin poder con hechizos)
    const bare = /^\$<(\w+)>/.exec(rest);
    if (bare) {
      const v = t.variable(ctx.spellId, bare[1]!);
      if (v !== null) {
        out += formatNumber(v);
        lastNumber = v;
        approximate ||= t.variableDependsOnLevel(ctx.spellId, bare[1]!);
        i += bare[0].length;
        continue;
      }
    }

    // $/10;17057s1 o $*2;s1 : marcador dividido o multiplicado
    const op = /^\$([/*])(-?\d+(?:\.\d+)?);(\d*)([A-Za-z])(\d*)/.exec(rest);
    if (op) {
      const v = tokenValue(t, ctx, op[3] ? int(op[3]) : null, op[4]!, op[5]!);
      if (v?.num != null) {
        const n = op[1] === "/" ? v.num / Number(op[2]) : v.num * Number(op[2]);
        out += formatNumber(n);
        lastNumber = n;
        approximate ||= !!v.approx;
      } else {
        complete = false;
        out += op[0];
      }
      i += op[0].length;
      continue;
    }

    // $l singular:plural;  y  $g masculino:femenino;
    const word = /^\$([lgLG])([^:;]*):([^;]*);/.exec(rest);
    if (word) {
      const plural = word[1]!.toLowerCase() === "l";
      out += plural ? (lastNumber === 1 ? word[2] : word[3]) : word[2];
      i += word[0].length;
      continue;
    }

    // $@spellname1234
    const nameRef = /^\$@spellname(\d+)/.exec(rest);
    if (nameRef) {
      out += t.name(int(nameRef[1])) ?? "";
      i += nameRef[0].length;
      continue;
    }

    // $@spelltooltip1234 (texto de otro hechizo): no se incluye; se deja el marcador y se marca incompleto
    const otherSpell = /^\$@[A-Za-z]+\d*/.exec(rest);
    if (otherSpell) {
      complete = false;
      out += otherSpell[0];
      i += otherSpell[0].length;
      continue;
    }

    // $?condicion[si][no]: depende del personaje. Si las dos ramas dicen lo mismo (solo cambia el color)
    // da igual cual; si no, se elige la ultima y se marca incompleto.
    const cond = /^\$\?[^\[]*/.exec(rest);
    if (cond) {
      let j = i + cond[0].length;
      const branches: string[] = [];
      while (src[j] === "[") {
        const close = src.indexOf("]", j);
        if (close < 0) break;
        branches.push(stripColors(src.slice(j + 1, close)));
        j = close + 1;
      }
      if (new Set(branches).size > 1) complete = false;
      out += branches[branches.length - 1] ?? "";
      i = j;
      continue;
    }

    // $s1, $d, $22959s1 ...
    TOKEN.lastIndex = 0;
    const tok = new RegExp(TOKEN.source, "y");
    tok.lastIndex = i;
    const m = tok.exec(src);
    if (m) {
      const v = tokenValue(t, ctx, m[1] ? int(m[1]) : null, m[2]!, m[3]!);
      if (v) {
        const slotKind = m[2]!.toLowerCase();
        // $NNNh = probabilidad de activacion del hechizo NNN (hueco «c»: los talentos con «probabilidad de exito» la modifican)
        out +=
          ctx.slots && slotKind === "h" && m[1]
            ? `{{c:${int(m[1])}:1|${v.text}}}`
            : ctx.slots && slotKind === "n"
              ? `{{n:${m[1] ? int(m[1]) : ctx.spellId}:1|${v.text}}}`
              : ctx.slots && "smotda".includes(slotKind)
              ? `{{${slotKind}:${m[1] ? int(m[1]) : ctx.spellId}:${m[3] || 1}|${v.text}}}`
              : v.text;
        lastNumber = v.num;
        approximate ||= !!v.approx;
      } else {
        complete = false;
        out += m[0];
      }
      i += m[0].length;
      continue;
    }

    out += ch;
    i++;
  }
  return { text: out.replace(/[ \t]+\n/g, "\n").trim(), complete, approximate };
}
