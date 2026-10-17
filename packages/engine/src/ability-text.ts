import type { AbilityRank } from "@wfuc/schema";
import { effectAt, isWeaponDamageEffect, WEAPON_PERCENT_EFFECT } from "./abilities.js";
import type { ModifiedAbility } from "./spell-mods.js";

/** Un trozo del texto de la habilidad; `changed` = la cifra es distinta por tus talentos. */
export interface TextPart {
  text: string;
  changed: boolean;
}

const MARKER = /\{\{(?:([a-z]):(\d+):(\d+)(?:\*([\d.]+))?|=([^;|}]*)((?:;[A-Za-z]:\d+:\d+)*))\|([^}]*)\}\}/g;

/** Aritmetica segura (+ - * / y parentesis) para los huecos de expresion. */
function evalArithmetic(expr: string): number | null {
  const s = expr.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]*$/.test(s)) return null;
  let pos = 0;
  const atom = (): number => {
    if (s[pos] === "(") {
      pos++;
      const v = sum();
      pos++;
      return v;
    }
    if (s[pos] === "-") {
      pos++;
      return -atom();
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(pos));
    if (!m) throw new Error("numero esperado");
    pos += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = atom();
    while (s[pos] === "*" || s[pos] === "/") v = s[pos++] === "*" ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (s[pos] === "+" || s[pos] === "-") v = s[pos++] === "+" ? v + product() : v - product();
    return v;
  };
  try {
    const v = sum();
    return pos === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Cifras pequenas con decimales (1,24), el resto enteras. */
const fmtValue = (n: number): string => (Math.abs(n) < 10 ? n.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : fmtNumber(n));

const fmtNumber = (n: number): string => Math.round(n).toLocaleString("es-ES");
const fmtSeconds = (ms: number): string => {
  const s = ms / 1000;
  if (s >= 60) return `${(s / 60).toLocaleString("es-ES", { maximumFractionDigits: 1 })} min`;
  return `${s.toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`;
};

/**
 * Texto de la habilidad con las cifras recalculadas al nivel y con los talentos: el mismo texto del cliente, pero cada
 * hueco `{{tipo:hechizo:efecto|base}}` se rellena con el valor del efecto a ese nivel (con la dispersion y los puntos por
 * nivel) y con los modificadores de tus talentos. Si un hueco no se puede resolver se deja el valor base del cliente.
 * No incluye el poder con hechizos (depende de las estadisticas de Forever, que no estan en el cliente).
 */
export function renderAbilityText(rank: AbilityRank, mod: ModifiedAbility): TextPart[] {
  const template = rank.descriptionTemplate || rank.description;
  const parts: TextPart[] = [];
  let last = 0;
  // Formulas del cliente con variables del personaje que no se pueden calcular (${$m1+(1*$b1*$<mult>)}) y variables sueltas
  // ($i objetivos maximos, $7376s3, $d, $e...): se ocultan con «…»; las referencias a iconos o textos de otros hechizos ($@spellicon...) se quitan
  const hideUnresolved = (s: string): string =>
    s
      .replace(/\$\{[^{}]*\}/g, "…")
      .replace(/\$@[A-Za-z]+\d*/g, "")
      .replace(/\$\d*[A-Za-z]\w*/g, "…");
  const push = (text: string, changed = false) => {
    if (text) parts.push({ text: hideUnresolved(text), changed });
  };

  /**
   * Efecto citado por un hueco. Los de dano/sanacion vienen ya con los talentos; el resto (auras de ataque, escudos de absorcion,
   * resistencias: Grito de guerra, Palabra de poder: escudo) no los modifican los talentos pero SI escalan con el nivel.
   */
  const effectOf = (ref: number, idx: number) => {
    const all = [...mod.effects, ...mod.weaponEffects, ...mod.otherEffects];
    const found = all.find((e) => (e.effect.viaSpellId ?? rank.spellId) === ref && e.effect.index === idx - 1);
    if (found) return found;
    // El texto cita el efecto 2 de un hechizo de un solo efecto (el cliente se equivoca de indice): vale el unico efecto
    const sameSpell = all.filter((e) => (e.effect.viaSpellId ?? rank.spellId) === ref);
    if (idx > 1 && sameSpell.length === 1 && sameSpell[0]!.effect.index === 0) return sameSpell[0];
    const raw = rank.effects.find((e) => (e.viaSpellId ?? rank.spellId) === ref && e.index === idx - 1);
    if (!raw) return undefined;
    const base = effectAt(raw, rank, mod.level);
    return { effect: raw, base, final: base, coefficient: null };
  };
  const durationFor = (): { base: number | null; final: number | null } => ({ base: rank.durationMs, final: mod.durationMs });

  for (const m of template.matchAll(MARKER)) {
    push(template.slice(last, m.index));
    last = m.index + m[0].length;
    const [, kind0, refText0, idxText0, mulText, exprText, tokText, fallback] = m as unknown as [string, string | undefined, string | undefined, string | undefined, string | undefined, string | undefined, string | undefined, string];
    if (exprText !== undefined) {
      // Hueco de expresion: se recalcula con el valor de cada efecto citado (m minimo, M maximo, s medio) a este nivel y con los talentos
      const toks = (tokText ?? "").split(";").filter(Boolean).map((tok) => tok.split(":") as [string, string, string]);
      const finals: number[] = [];
      const bases: number[] = [];
      let complete = true;
      let weaponExpr = false;
      for (const [k, r, i] of toks) {
        const ef = effectOf(Number(r), Number(i));
        if (!ef) {
          complete = false;
          break;
        }
        const pick = (x: { min: number; max: number; average: number }) => (k === "m" ? x.min : k === "M" ? x.max : x.average);
        if (k === "o") {
          // Total periodico: valor por tick x (duracion del hechizo que lleva el efecto / periodo)
          const dur = ef.effect.durationMs ?? mod.durationMs;
          if (!ef.effect.periodMs || !dur) {
            complete = false;
            break;
          }
          finals.push(ef.final.average * (dur / ef.effect.periodMs));
          bases.push(ef.base.average * ((ef.effect.durationMs ?? rank.durationMs ?? dur) / ef.effect.periodMs));
          continue;
        }
        // «X % de arma» por un daño plano de arma (Mutilar: 75 % de 67): el % de daño de los talentos multiplica el resultado UNA vez,
        // asi que el porcentaje entra sin modificar y el daño plano ya lleva el factor
        const weaponProduct = ef.effect.effect === WEAPON_PERCENT_EFFECT && toks.some(([, r2, i2]) => {
          const other = effectOf(Number(r2), Number(i2));
          return other !== undefined && other !== ef && isWeaponDamageEffect(other.effect);
        });
        finals.push(weaponProduct ? pick(ef.base) : pick(ef.final));
        bases.push(pick(ef.base));
        if (isWeaponDamageEffect(ef.effect)) weaponExpr = true;
      }
      let exprRes: string | null = null;
      let exprChanged = false;
      if (complete) {
        const fill = (vals: number[]) => exprText.replace(/@(\d+)/g, (_x, n: string) => `(${vals[Number(n)]})`);
        const v = evalArithmetic(fill(finals));
        const b = evalArithmetic(fill(bases));
        if (v !== null) {
          // El daño de arma lleva decimales en el texto del cliente (17,25 p.): se conservan
          exprRes = weaponExpr ? v.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : fmtValue(v);
          exprChanged = b !== null && (weaponExpr ? Math.abs(v - b) > 0.005 : Math.round(v) !== Math.round(b));
        }
      }
      push(exprRes ?? fallback, exprChanged);
      continue;
    }
    const kind = kind0!;
    const refText = refText0!;
    const idxText = idxText0!;
    const mul = mulText ? Number(mulText) : 1;
    const e = effectOf(Number(refText), Number(idxText));
    const d = durationFor();
    let text = fallback;
    let changed = false;

    if (kind === "n") {
      // Cargas (Fuego interno: «hasta que se hayan usado 20 cargas»)
      const ch = mod.charges.find((x) => x.spellId === Number(refText));
      if (ch) {
        text = fmtNumber(ch.final);
        changed = ch.final !== ch.base;
      }
    } else if (kind === "c") {
      // Probabilidad de activacion (el 20 % de «cada golpe tiene un 20 % de probabilidad de envenenar»)
      const proc = mod.procs.find((x) => x.spellId === Number(refText));
      if (proc) {
        text = proc.final.toLocaleString("es-ES", { maximumFractionDigits: 1 });
        changed = Math.abs(proc.final - proc.base) > 0.05;
      }
    } else if (kind === "s" || kind === "m") {
      if (e) {
        const weaponPct = e.effect.effect === WEAPON_PERCENT_EFFECT;
        text = weaponPct ? Math.abs(e.final.average * mul).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : fmtNumber(Math.abs(e.final.average * mul));
        changed = weaponPct ? Math.abs(e.final.average - e.base.average) * mul > 0.05 : Math.round(e.final.average * mul) !== Math.round(e.base.average * mul);
      }
    } else if (kind === "l" || kind === "h") {
      if (e) {
        const key = kind === "l" ? "min" : "max";
        text = fmtNumber(e.final[key] * mul);
        changed = Math.round(e.final[key] * mul) !== Math.round(e.base[key] * mul);
      }
    } else if (kind === "o") {
      // El total periodico usa la duracion del hechizo que lleva el efecto si es otro (Lanzarse: sangra 18 s aunque aturda 2 s)
      const own = e?.effect.durationMs ?? null;
      const dur = own ?? d.final;
      if (e && e.effect.periodMs && dur) {
        const total = (v: number, ms: number) => v * (ms / (e.effect.periodMs as number));
        text = fmtNumber(total(e.final.average, dur));
        changed = Math.round(total(e.final.average, dur)) !== Math.round(total(e.base.average, own ?? d.base ?? dur));
      }
    } else if (kind === "z") {
      const own = e?.effect.durationMs ?? null;
      const dur = own ?? d.final;
      if (e && dur) {
        text = fmtNumber(e.final.average * (dur / 1000));
        changed = Math.round(e.final.average * (dur / 1000)) !== Math.round(e.base.average * ((own ?? d.base ?? dur) / 1000));
      }
    } else if (kind === "d") {
      if (d.final !== null && Number(refText) === rank.spellId) {
        text = fmtSeconds(d.final);
        changed = d.final !== (d.base ?? d.final);
      } else {
        // Duracion de otro hechizo citado (la placa de hielo de una trampa): la modifican los talentos que cruzan SU mascara
        const via = mod.viaDurations.find((x) => x.spellId === Number(refText));
        if (via) {
          text = fmtSeconds(via.final);
          changed = via.final !== via.base;
        }
      }
    } else if (kind === "a") {
      // Radio: los modificadores de "radio" (operacion 6) cambian la cifra base del cliente
      const base = Number.parseFloat(fallback.replace(",", "."));
      if (Number.isFinite(base)) {
        const flat = mod.applied.filter((x) => x.kind === "flat" && x.op === 6).reduce((n, x) => n + x.value, 0);
        const pct = mod.applied.filter((x) => x.kind === "pct" && x.op === 6).reduce((n, x) => n + x.value, 0);
        const radius = (base + flat) * (1 + pct / 100);
        text = radius.toLocaleString("es-ES", { maximumFractionDigits: 1 });
        changed = radius !== base;
      }
    } else if (kind === "t") {
      if (e?.effect.periodMs) text = (e.effect.periodMs / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 });
    }
    push(text, changed);
  }
  push(template.slice(last));
  return parts;
}
