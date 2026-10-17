import { int, type RawTables, type Row } from "./csv.js";
import type { EffectPointsData } from "./types.js";
import type { SpellTables } from "./spell-tables.js";
import { renderSpellText } from "./spell-text.js";

export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export interface NodeSpell {
  spellId: number;
  /** Rangos del nodo. Un nodo "escalonado" con varias entradas del mismo hechizo suma sus rangos. */
  maxRank: number;
  defId: string;
  entryId: number;
  /** Entradas del nodo (>1 en nodos de eleccion o escalonados). */
  entryCount: number;
  /** true si varias entradas distintas compiten (nodo de eleccion); con el mismo hechizo es un nodo escalonado. */
  isChoice: boolean;
  /**
   * Nodo escalonado (varias entradas del mismo hechizo, una por rango): la TraitDefinition de cada rango, en orden.
   * Cada una trae su propia curva, asi que el texto de cada rango sale de su definicion, no de la primera.
   */
  tierDefIds: string[] | null;
}

/** Consultas comunes sobre las tablas Trait (nodos, entradas, requisitos, prerrequisitos, textos). */
export class TraitIndex {
  readonly entriesByNode;
  readonly entryById;
  readonly defById;
  private readonly effectsByDef;
  private readonly groupMembers;
  private readonly condById;
  private readonly groupConds;
  private readonly edges;

  constructor(
    raw: RawTables,
    private readonly spells: SpellTables,
  ) {
    this.entriesByNode = groupBy(raw.table("TraitNodeXTraitNodeEntry"), (r) => r.TraitNodeID!);
    this.entryById = new Map(raw.table("TraitNodeEntry").map((r) => [r.ID!, r]));
    this.defById = new Map(raw.table("TraitDefinition").map((r) => [r.ID!, r]));
    this.effectsByDef = groupBy(raw.table("TraitDefinitionEffectPoints"), (r) => r.TraitDefinitionID!);
    this.groupMembers = groupBy(raw.table("TraitNodeGroupXTraitNode"), (r) => r.TraitNodeGroupID!);
    this.condById = new Map(raw.table("TraitCond").map((r) => [r.ID!, r]));
    this.groupConds = groupBy(raw.table("TraitNodeGroupXTraitCond"), (r) => r.TraitNodeGroupID!);
    this.edges = raw.table("TraitEdge");
  }

  /** Hechizo y rangos de un nodo; null si no tiene entrada o definicion. */
  nodeSpell(nodeId: string, warnings?: string[]): NodeSpell | null {
    const links = this.entriesByNode.get(nodeId) ?? [];
    const first = links[0];
    if (!first) return null;
    const entry = this.entryById.get(first.TraitNodeEntryID!);
    const def = entry && this.defById.get(entry.TraitDefinitionID!);
    if (!entry || !def) {
      warnings?.push(`Nodo ${nodeId}: entrada o definicion no encontrada`);
      return null;
    }
    const spellIds = new Set<string>();
    let ranks = 0;
    const ordered = [...links].sort((a, b) => int(a.Index) - int(b.Index));
    const defIds: string[] = [];
    for (const l of ordered) {
      const e = this.entryById.get(l.TraitNodeEntryID!);
      const d = e && this.defById.get(e.TraitDefinitionID!);
      if (e && d) {
        spellIds.add(d.SpellID!);
        ranks += int(e.MaxRanks);
        defIds.push(d.ID!);
      }
    }
    const isChoice = spellIds.size > 1;
    if (isChoice) warnings?.push(`Nodo ${nodeId} tiene ${links.length} entradas distintas (nodo de eleccion); se usa la primera`);
    const tiered = !isChoice && defIds.length > 1 && defIds.length === ranks;
    return {
      spellId: int(def.SpellID),
      maxRank: isChoice ? int(entry.MaxRanks) : Math.max(ranks, 1),
      defId: def.ID!,
      entryId: int(entry.ID),
      entryCount: links.length,
      isChoice,
      tierDefIds: tiered ? defIds : null,
    };
  }

  /** Icono y descripcion por rango de un nodo, respetando los nodos escalonados (una definicion por rango). */
  textForNode(sp: NodeSpell) {
    if (!sp.tierDefIds) return this.textFor(sp.spellId, sp.defId, sp.maxRank);
    const ranks = sp.tierDefIds.map((defId) => this.renderRank(sp.spellId, defId, 1));
    return {
      iconFileDataId: this.spells.iconFileDataId(sp.spellId),
      effectInfo: this.effectInfoOf(sp.spellId),
      passive: this.spells.isPassive(sp.spellId),
      textOrigin: this.spells.textOrigin(sp.spellId),
      rankValues: sp.tierDefIds.map((defId) => this.valuesAt(sp.spellId, defId, 1)),
      descriptions: ranks.map((r) => r.text),
      descriptionsComplete: ranks.every((r) => r.complete),
      descriptionsApproximate: ranks.some((r) => r.approximate),
    };
  }

  /** Efectos de aura del hechizo con su operacion y mascara de clase (que habilidades afecta). */
  private effectInfoOf(spellId: number) {
    const out: { index: number; aura: number; miscValue: number; miscValueB: number; classMask: number[] }[] = [];
    for (let i = 0; i < this.spells.effectCount(spellId); i++) {
      const e = this.spells.effect(spellId, i)!;
      const aura = int(e.EffectAura);
      if (aura === 0) continue;
      out.push({ index: i, aura, miscValue: int(e["EffectMiscValue[0]"]), miscValueB: int(e["EffectMiscValue[1]"]), classMask: [0, 1, 2, 3].map((k) => int(e[`EffectSpellClassMask[${k}]`])) });
    }
    return out;
  }

  /** Valores numericos (con signo) de cada efecto del hechizo en ese rango: lo que consume el motor de calculo. */
  private valuesAt(spellId: number, defId: string, rank: number): (number | null)[] {
    const curves = new Map(this.effectPointsOf(defId).map((e) => [e.effectIndex, e.curveId]));
    return Array.from({ length: this.spells.effectCount(spellId) }, (_, i) => this.spells.effectValue(spellId, i, curves.get(i), rank));
  }

  private renderRank(spellId: number, defId: string, rank: number) {
    const curves = new Map(this.effectPointsOf(defId).map((e) => [e.effectIndex, e.curveId]));
    const template = this.defById.get(defId)?.OverrideDescription_lang || this.spells.description(spellId);
    return renderSpellText(this.spells, template, { spellId, rank, curves });
  }

  /**
   * Requisito de puntos de cada nodo: "gastar al menos N puntos entre los nodos del grupo contador".
   * Cada TraitCond tiene un grupo contador (TraitNodeGroupID: de donde se cuentan los puntos) y se enlaza
   * (TraitNodeGroupXTraitCond) a los grupos de nodos que bloquea. En las clases el grupo contador son las
   * filas superiores; en Legacy, todo el arbol. Si un nodo tiene varias, gana la de mas puntos.
   */
  gates(treeId: string, nodeIds: Set<string>): Map<string, { points: number; fromNodeIds: number[] }> {
    const gates = new Map<string, { points: number; fromNodeIds: number[] }>();
    const inTree = (groupId: string) => (this.groupMembers.get(groupId) ?? []).map((m) => m.TraitNodeID!).filter((id) => nodeIds.has(id));
    for (const [groupId, links] of this.groupConds) {
      const gated = inTree(groupId);
      if (gated.length === 0) continue;
      for (const link of links) {
        const cond = this.condById.get(link.TraitCondID!);
        if (!cond || cond.TraitTreeID !== treeId) continue;
        const points = int(cond.SpentAmountRequired);
        const fromNodeIds = inTree(cond.TraitNodeGroupID!).map(int).sort((a, b) => a - b);
        for (const id of gated) {
          const prev = gates.get(id);
          if (!prev || points > prev.points) gates.set(id, { points, fromNodeIds });
        }
      }
    }
    return gates;
  }

  /** Puntos que cada nodo exige haber gastado (solo el numero; ver `gates` para saber de donde se cuentan). */
  requiredPoints(treeId: string, nodeIds: Set<string>): Map<string, number> {
    return new Map([...this.gates(treeId, nodeIds)].map(([id, g]) => [id, g.points]));
  }

  /** Prerrequisitos por nodo (TraitEdge con los dos extremos dentro del conjunto). */
  prerequisites(nodeIds: Set<string>): Map<string, { nodeId: number; edgeType: number }[]> {
    const out = new Map<string, { nodeId: number; edgeType: number }[]>();
    for (const e of this.edges) {
      if (!nodeIds.has(e.LeftTraitNodeID!) || !nodeIds.has(e.RightTraitNodeID!)) continue;
      const arr = out.get(e.RightTraitNodeID!) ?? [];
      arr.push({ nodeId: int(e.LeftTraitNodeID), edgeType: int(e.Type) });
      out.set(e.RightTraitNodeID!, arr);
    }
    return out;
  }

  effectPointsOf(defId: string): EffectPointsData[] {
    return (this.effectsByDef.get(defId) ?? []).map((e: Row) => ({
      effectIndex: int(e.EffectIndex),
      operationType: int(e.OperationType),
      curveId: int(e.CurveID),
    }));
  }

  /** Icono y descripcion por rango de un hechizo de talento (valores segun las curvas de su TraitDefinition). */
  textFor(spellId: number, defId: string, maxRank: number) {
    const ranks = Array.from({ length: maxRank }, (_, i) => this.renderRank(spellId, defId, i + 1));
    return {
      iconFileDataId: this.spells.iconFileDataId(spellId),
      effectInfo: this.effectInfoOf(spellId),
      passive: this.spells.isPassive(spellId),
      textOrigin: this.spells.textOrigin(spellId),
      rankValues: Array.from({ length: maxRank }, (_, i) => this.valuesAt(spellId, defId, i + 1)),
      descriptions: ranks.map((r) => r.text),
      descriptionsComplete: ranks.every((r) => r.complete),
      descriptionsApproximate: ranks.some((r) => r.approximate),
    };
  }
}
