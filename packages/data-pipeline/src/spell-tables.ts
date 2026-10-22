import { int, type RawTables, type Row } from "./csv.js";
import { evaluateVariable, parseVariables, polynomialOf, type Poly } from "./desc-variables.js";
import { loadOverrides, looksEnglish, type Overrides, type TextOrigin } from "./language.js";

export interface AuraOptions {
  procChance: number;
  procCharges: number;
  cumulativeAura: number;
  /** Enfriamiento interno del proc en ms (ProcCategoryRecovery); 0 si no tiene. */
  procCooldownMs: number;
}

/** Consulta de los datos de hechizos del cliente que necesita el texto de las descripciones. */
export class SpellTables {
  private readonly descriptions = new Map<string, string>();
  private readonly auraDescriptions = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly effects = new Map<string, Row>();
  private readonly misc = new Map<string, Row>();
  private readonly auras = new Map<string, Row>();
  private readonly durations = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>();
  private readonly radii = new Map<string, number>();
  private readonly curves = new Map<number, [number, number][]>();
  private readonly powers = new Map<string, { mana: number; pct: number }>();
  /** Variables de descripcion ($<nombre>) por hechizo: nombre -> definicion. */
  private readonly descVars = new Map<string, Map<string, string>>();
  private readonly rangeMax = new Map<string, number>();
  private readonly targetLimits = new Map<string, { maxTargets: number; maxTargetLevel: number }>();
  /** SpellEquippedItems: objetos que hay que llevar para que valga el hechizo, por hechizo. */
  private readonly equippedItemsBySpell = new Map<string, { itemClass: number; invTypeMask: number; subclassMask: number }[]>();

  private readonly overrides: Overrides = loadOverrides("esES");

  constructor(raw: RawTables) {
    for (const r of raw.table("Spell")) {
      this.descriptions.set(r.ID!, r.Description_lang ?? "");
      this.auraDescriptions.set(r.ID!, r.AuraDescription_lang ?? "");
    }
    for (const r of raw.table("SpellName")) this.names.set(r.ID!, r.Name_lang ?? "");
    // DifficultyID 0 es el normal; las otras dificultades no aplican a talentos.
    for (const r of raw.table("SpellEffect")) {
      const key = `${r.SpellID}:${r.EffectIndex}`;
      if (!this.effects.has(key) || r.DifficultyID === "0") this.effects.set(key, r);
    }
    for (const r of raw.table("SpellMisc")) if (!this.misc.has(r.SpellID!) || r.DifficultyID === "0") this.misc.set(r.SpellID!, r);
    for (const r of raw.table("SpellAuraOptions")) if (!this.auras.has(r.SpellID!) || r.DifficultyID === "0") this.auras.set(r.SpellID!, r);
    for (const r of raw.table("SpellCooldowns")) if (!this.cooldowns.has(r.SpellID!) || r.DifficultyID === "0") this.cooldowns.set(r.SpellID!, Math.max(int(r.RecoveryTime), int(r.CategoryRecoveryTime)));
    for (const r of raw.table("SpellPower")) if (!this.powers.has(r.SpellID!)) this.powers.set(r.SpellID!, { mana: int(r.ManaCost), pct: Number(r.PowerCostPct) || 0 });
    this.loadDescriptionVariables(raw);
    for (const r of raw.table("SpellRange")) this.rangeMax.set(r.ID!, Math.max(Number(r["RangeMax[0]"]), Number(r["RangeMax[1]"])));
    try {
      for (const r of raw.table("SpellTargetRestrictions")) if (!this.targetLimits.has(r.SpellID!) || r.DifficultyID === "0") this.targetLimits.set(r.SpellID!, { maxTargets: int(r.MaxTargets), maxTargetLevel: int(r.MaxTargetLevel) });
    } catch {
      // tabla opcional
    }
    try {
      for (const r of raw.table("SpellEquippedItems")) {
        const list = this.equippedItemsBySpell.get(r.SpellID!) ?? [];
        list.push({ itemClass: int(r.EquippedItemClass), invTypeMask: int(r.EquippedItemInvTypes), subclassMask: int(r.EquippedItemSubclass) });
        this.equippedItemsBySpell.set(r.SpellID!, list);
      }
    } catch {
      // tabla opcional
    }
    for (const r of raw.table("SpellDuration")) this.durations.set(r.ID!, int(r.Duration));
    for (const r of raw.table("SpellRadius")) this.radii.set(r.ID!, Number(r.Radius));
    const points = new Map<number, { order: number; x: number; y: number }[]>();
    for (const r of raw.table("CurvePoint")) {
      const id = int(r.CurveID);
      const arr = points.get(id) ?? [];
      arr.push({ order: int(r.OrderIndex), x: Number(r["Pos[0]"]), y: Number(r["Pos[1]"]) });
      points.set(id, arr);
    }
    for (const [id, arr] of points) this.curves.set(id, arr.sort((a, b) => a.order - b.order).map((p) => [p.x, p.y]));
  }

  /**
   * Copia con los textos (descripcion, aura y nombre) de otro idioma y los mismos datos de efectos, duraciones y costes:
   * sirve para renderizar la plantilla inglesa con las cifras del cliente. Sin traducciones propias (`overrides`).
   */
  withTexts(texts: { descriptions: Map<string, string>; auraDescriptions: Map<string, string>; names: Map<string, string> }): SpellTables {
    const copy = Object.create(SpellTables.prototype) as SpellTables;
    return Object.assign(copy, this, texts, { overrides: { spells: {}, names: {}, racials: {} } });
  }

  /** SpellDescriptionVariables + SpellXDescriptionVariables (opcionales: sin ellas las variables $<...> quedan sin resolver). */
  private loadDescriptionVariables(raw: RawTables): void {
    let blocks: Map<string, string>;
    let links: Row[];
    try {
      blocks = new Map(raw.table("SpellDescriptionVariables").map((r) => [r.ID!, r.Variables ?? ""]));
      links = raw.table("SpellXDescriptionVariables");
    } catch {
      return;
    }
    for (const r of links) {
      const defs = parseVariables(blocks.get(r.SpellDescriptionVariablesID!) ?? "");
      const have = this.descVars.get(r.SpellID!);
      this.descVars.set(r.SpellID!, have ? new Map([...have, ...defs]) : defs);
    }
  }

  /** Valor de `$<name>` en el hechizo al nivel `pl` (60 por defecto), sin poder con hechizos ni talentos; null si no se puede. */
  variable(spellId: number, name: string, pl = 60): number | null {
    const defs = this.descVars.get(String(spellId));
    return defs ? evaluateVariable(defs, name, pl) : null;
  }

  /** La variable como polinomio del nivel ($damagepower = a + b x nivel + c x nivel^2), si tiene esa forma. */
  variablePolynomial(spellId: number, name: string): Poly | null {
    return polynomialOf(this.descVars.get(String(spellId))?.get(name));
  }

  /** La variable existe y su valor depende del nivel ($PL). */
  variableDependsOnLevel(spellId: number, name: string): boolean {
    return /\$(PL|pl)(?![A-Za-z])/.test(this.descVars.get(String(spellId))?.get(name) ?? "");
  }

  /** Objetos que hay que llevar equipados para que valga el hechizo (varitas, armas de dos manos, escudo...); vacío si no hay requisito. */
  equippedItems(spellId: number): { itemClass: number; invTypeMask: number; subclassMask: number }[] {
    return this.equippedItemsBySpell.get(String(spellId)) ?? [];
  }

  name(spellId: number): string | null {
    const name = this.names.get(String(spellId));
    return name === undefined ? null : (this.overrides.names[name] ?? name);
  }

  /** Texto del cliente tal cual (descripcion; si esta vacia, la de aura). */
  clientDescription(spellId: number): string {
    return this.descriptions.get(String(spellId)) || this.auraDescriptions.get(String(spellId)) || "";
  }

  /**
   * Descripcion que se muestra. Si el cliente la trae en ingles y hay una traduccion propia (data/i18n), se usa esta;
   * en cuanto el cliente traiga el espanol, manda el del cliente.
   */
  description(spellId: number): string {
    const text = this.clientDescription(spellId);
    const own = this.overrides.spells[String(spellId)];
    return own && looksEnglish(text) ? own : text;
  }

  /** client = espanol del cliente; translated-by-us = traduccion propia; untranslated = ingles del cliente sin traduccion. */
  textOrigin(spellId: number): TextOrigin {
    const text = this.clientDescription(spellId);
    if (!looksEnglish(text)) return "client";
    return this.overrides.spells[String(spellId)] ? "translated-by-us" : "untranslated";
  }

  /** Efecto `index` (0 = primero) del hechizo. */
  effect(spellId: number, index: number): Row | undefined {
    return this.effects.get(`${spellId}:${index}`);
  }

  /** true si el hechizo es pasivo (SPELL_ATTR0_PASSIVE: sus efectos valen siempre, no hay que activarlo). */
  isPassive(spellId: number): boolean {
    return (int(this.misc.get(String(spellId))?.["Attributes[0]"]) & 0x40) !== 0;
  }

  iconFileDataId(spellId: number): number | null {
    const id = int(this.misc.get(String(spellId))?.SpellIconFileDataID);
    return id > 0 ? id : null;
  }

  /** Duracion en milisegundos; null si no tiene o es indefinida. */
  durationMs(spellId: number): number | null {
    const idx = this.misc.get(String(spellId))?.DurationIndex;
    const ms = idx ? this.durations.get(idx) : undefined;
    return ms !== undefined && ms > 0 ? ms : null;
  }

  /** Enfriamiento del hechizo en milisegundos (SpellCooldowns: el propio o el de su categoria, el mayor); null si no tiene. */
  cooldownMs(spellId: number): number | null {
    const ms = this.cooldowns.get(String(spellId));
    return ms !== undefined && ms > 0 ? ms : null;
  }

  aura(spellId: number): AuraOptions | null {
    const r = this.auras.get(String(spellId));
    return r ? { procChance: int(r.ProcChance), procCharges: int(r.ProcCharges), cumulativeAura: int(r.CumulativeAura), procCooldownMs: int(r.ProcCategoryRecovery) } : null;
  }

  /** Alcance maximo en yardas del hechizo ($r) o null (SpellMisc.RangeIndex -> SpellRange). */
  rangeYd(spellId: number): number | null {
    const v = this.rangeMax.get(this.misc.get(String(spellId))?.RangeIndex ?? "");
    return v !== undefined && v > 0 && v < 1000 ? v : null;
  }

  /** Objetivos maximos ($i) y nivel maximo del objetivo ($v) del hechizo (SpellTargetRestrictions). */
  targetLimit(spellId: number): { maxTargets: number; maxTargetLevel: number } | null {
    return this.targetLimits.get(String(spellId)) ?? null;
  }

  /** Coste del hechizo ($c): puntos de recurso o % del maná base (SpellPower). */
  powerCost(spellId: number): { mana: number; pct: number } | null {
    return this.powers.get(String(spellId)) ?? null;
  }

  /** Radio en metros de la ranura `slot` (0 o 1) del efecto, si la tiene. */
  radius(effect: Row, slot: 0 | 1 = 0): number | null {
    const v = this.radii.get(effect[`EffectRadiusIndex[${slot}]`] ?? "");
    return v !== undefined && v > 0 ? v : null;
  }

  /** Radio de un marcador $aN: ranura del efecto N, o la N-esima ranura de radio del hechizo. */
  radiusFor(spellId: number, n: number): number | null {
    const own = this.effect(spellId, n - 1);
    const direct = own ? (this.radius(own, 0) ?? this.radius(own, 1)) : null;
    if (direct !== null) return direct;
    for (let i = 0; i < 4; i++) {
      const e = this.effect(spellId, i);
      const r = e ? this.radius(e, n >= 2 ? 1 : 0) : null;
      if (r !== null) return r;
    }
    return null;
  }

  /** Numero de efectos del hechizo (indices consecutivos desde 0). */
  effectCount(spellId: number): number {
    let n = 0;
    while (this.effect(spellId, n)) n++;
    return n;
  }

  /** Valor (con signo) del efecto `effectIndex`: el de su curva en `rank` si la tiene, o el base del cliente. */
  effectValue(spellId: number, effectIndex: number, curveId: number | undefined, rank: number): number | null {
    const e = this.effect(spellId, effectIndex);
    if (!e) return null;
    const fromCurve = curveId === undefined ? null : this.curveValue(curveId, rank);
    const v = fromCurve ?? Number(e.EffectBasePointsF);
    return Number.isFinite(v) ? v : null;
  }

  /** true si el valor del efecto depende del nivel del personaje (puntos por nivel o variacion). */
  isLevelScaled(spellId: number, effectIndex: number): boolean {
    const e = this.effect(spellId, effectIndex);
    return !!e && (Number(e.EffectRealPointsPerLevel) !== 0 || Number(e.Variance) !== 0);
  }

  /** Valor de una curva en `x` (interpolacion lineal, fuera de rango se queda en el extremo). */
  curveValue(curveId: number, x: number): number | null {
    const pts = this.curves.get(curveId);
    if (!pts || pts.length === 0) return null;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (x <= first[0]) return first[1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if (x <= b[0]) return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
    return null;
  }
}
