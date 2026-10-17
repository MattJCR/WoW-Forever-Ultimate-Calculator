import type { StatCategory, StatEffects, StatSource, StatTotal } from "./stat-effects.js";

/** Una linea del resumen de una habilidad: todas las cifras de la misma categoria y etiqueta, sumadas. */
export interface AbilityEffectLine {
  category: StatCategory;
  label: string;
  value: number;
  unit: StatTotal["unit"];
  sources: StatSource[];
}

/** Categorias que la tarjeta ya muestra dentro de las cifras de la habilidad (coste, lanzamiento...): aqui solo se anota de donde sale el cambio. */
const INLINE: StatCategory[] = ["Coste", "Tiempo de lanzamiento", "Enfriamiento", "Alcance y radio", "Duración"];
/** Categorias que se listan en «Con tus talentos» (las que cambian lo que la habilidad hace o con que probabilidad). */
const LISTED: StatCategory[] = [
  "Probabilidad de crítico",
  "Probabilidad de impacto",
  "Bonus de daño crítico",
  "Daño y curación",
  "Daño periódico",
  "Efecto 1 / 2 / 3 de los hechizos",
  "Celeridad",
  "Amenaza",
  "Retroceso al lanzar",
  "Otros modificadores",
];

const CRIT_CATEGORIES: StatCategory[] = ["Probabilidad de crítico", "Bonus de daño crítico"];

export interface AbilityEffectSummary {
  /** Lo que se suma a la habilidad (crítico, impacto, bonus de crítico, daño...), con cada cifra ya sumada. */
  lines: AbilityEffectLine[];
  /** De donde sale el cambio de coste, lanzamiento, enfriamiento, alcance y duracion (para anotarlo junto a la cifra). */
  inline: Partial<Record<StatCategory, AbilityEffectLine[]>>;
}

/**
 * Efectos que afectan a UNA habilidad: los que se aplican a todo el personaje (p. ej. el +2 % de crítico de la raza) y los
 * que se aplican a esa habilidad (por su nombre). Las cifras de la misma categoria y etiqueta se suman, para que la
 * tarjeta de la habilidad dé el total directamente (p. ej. crítico = +6 % de Incineración + 2 % de la raza = +8 %).
 */
export function abilityEffectSummary(abilityName: string, fx: StatEffects, options: { canCrit?: boolean } = {}): AbilityEffectSummary {
  // Una habilidad que no hace daño ni sana no puede ser crítica: no recibe ni probabilidad ni bonus de crítico (aunque sean «de todo el personaje»)
  const applicable = fx.totals.filter((t) => (t.scope === null || t.scope.includes(abilityName)) && (options.canCrit !== false || !CRIT_CATEGORIES.includes(t.category)));
  const merged = new Map<string, AbilityEffectLine>();
  for (const t of applicable) {
    const key = [t.category, t.label, t.unit].join("#");
    const hit = merged.get(key);
    if (hit) {
      hit.value = Math.round((hit.value + t.value) * 100) / 100;
      hit.sources.push(...t.sources);
    } else merged.set(key, { category: t.category, label: t.label, value: t.value, unit: t.unit, sources: [...t.sources] });
  }
  const all = [...merged.values()];
  const inline: AbilityEffectSummary["inline"] = {};
  for (const l of all) if (INLINE.includes(l.category)) (inline[l.category] ??= []).push(l);
  const lines = all.filter((l) => LISTED.includes(l.category)).sort((a, b) => LISTED.indexOf(a.category) - LISTED.indexOf(b.category));
  return { lines, inline };
}
