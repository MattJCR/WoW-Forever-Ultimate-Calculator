import { int, type RawTables, type Row } from "./csv.js";
import type { ClassTalents, InactiveTalent, Talent } from "./model.js";
import { SpellTables } from "./spell-tables.js";
import { groupBy, TraitIndex, type NodeSpell } from "./trait-index.js";

/**
 * Valor de SpellClassOptions.SpellClassSet (SpellFamilyName de Blizzard) -> ChrClasses.ID.
 * La clase de cada TraitTree no viene en los datos: se deduce votando con la clase de sus hechizos.
 */
export const CLASS_ID_BY_SPELL_SET: Record<number, number> = {
  3: 8, // Mago
  4: 1, // Guerrero
  5: 9, // Brujo
  6: 5, // Sacerdote
  7: 11, // Druida
  8: 4, // Pícaro
  9: 3, // Cazador
  10: 2, // Paladín
  11: 7, // Chamán
};

/**
 * Un TraitTree es candidato a arbol de clase si tiene Flags=1, no es del sistema Legacy (45) y tiene
 * tamano de arbol de clase. El TraitSystemID NO sirve para filtrar: la mayoria de clases usan 10, pero
 * el Druida (1089) y el Chaman (1082) completos estan en el sistema 0; los arboles 1083 y 1081 (sistema 10,
 * coordenadas distintas) son versiones parciales de esas mismas clases.
 */
export const LEGACY_SYSTEM = "45";
const MIN_CLASS_TREE_NODES = 30;
/** Separacion entre columnas en el eje X del cliente. */
const COL_STEP = 600;
/** Separacion entre filas en el eje Y del cliente. */
const ROW_STEP = 600;
/** Un salto mayor que esto en X separa dos especializaciones. */
const SPEC_GAP = 1000;
/** La rejilla real cabe en ~12000 x 6000; lo que pase de aqui son nodos huerfanos del cliente. */
const MAX_GRID_X = 15000;
const MAX_GRID_Y = 8000;
/** Una especializacion con menos talentos que esto se marca como incompleta. */
const MIN_SPEC_TALENTS = 10;
/** Primer punto de talento al nivel 10 (la referencia); sin confirmar en el cliente. */
const FIRST_POINT_LEVEL = 10;

export interface BuildResult {
  classes: ClassTalents[];
  unresolved: { traitTreeId: number; nodeCount: number; reason: string }[];
  /** Tablas ya cargadas, reutilizables (Legacy, iconos y textos de lo no asignado). */
  spells: SpellTables;
  trait: TraitIndex;
}

export function buildClassTalents(raw: RawTables, build: string, locale: string): BuildResult {
  const nodesByTree = groupBy(raw.table("TraitNode"), (n) => n.TraitTreeID!);
  const allTrees = raw.table("TraitTree").filter((t) => t.Flags === "1" && t.TraitSystemID !== LEGACY_SYSTEM);
  const trees = allTrees.filter((t) => (nodesByTree.get(t.ID!)?.length ?? 0) >= MIN_CLASS_TREE_NODES);
  const classes: ClassTalents[] = [];
  const unresolved: BuildResult["unresolved"] = [];
  for (const t of allTrees) {
    const n = nodesByTree.get(t.ID!)?.length ?? 0;
    if (n < MIN_CLASS_TREE_NODES) {
      unresolved.push({ traitTreeId: int(t.ID), nodeCount: n, reason: `arbol demasiado pequeno para ser de clase (< ${MIN_CLASS_TREE_NODES} nodos)` });
    }
  }
  const spellName = new Map(raw.table("SpellName").map((r) => [r.ID!, r.Name_lang!]));
  const classSets = groupBy(raw.table("SpellClassOptions"), (r) => r.SpellID!);
  const currency = new Map(raw.table("TraitCurrency").map((r) => [r.ID!, r]));
  const chrClass = new Map(raw.table("ChrClasses").map((r) => [int(r.ID), r]));
  const talentTabs = raw.table("TalentTab");
  const spells = new SpellTables(raw);
  const trait = new TraitIndex(raw, spells);

  const candidates: ClassTalents[] = [];

  for (const tree of trees) {
    const treeId = tree.ID!;
    const nodes = nodesByTree.get(treeId) ?? [];
    const nodeIds = new Set(nodes.map((n) => n.ID!));
    const warnings: string[] = [];

    // --- Nodo -> hechizo (un nodo normal tiene una sola entrada)
    const spellOfNode = new Map<string, NodeSpell>();
    for (const n of nodes) {
      const sp = trait.nodeSpell(n.ID!, warnings);
      if (sp) spellOfNode.set(n.ID!, sp);
    }

    // --- Clase por votacion
    const votes = new Map<number, number>();
    for (const { spellId } of spellOfNode.values()) {
      for (const c of classSets.get(String(spellId)) ?? []) {
        const classId = CLASS_ID_BY_SPELL_SET[int(c.SpellClassSet)];
        if (classId) votes.set(classId, (votes.get(classId) ?? 0) + 1);
      }
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((s, [, v]) => s + v, 0);
    const winner = ranked[0];
    if (!winner || winner[1] / total < 0.8) {
      unresolved.push({
        traitTreeId: int(treeId),
        nodeCount: nodes.length,
        reason: winner ? `clase ambigua: ${JSON.stringify(ranked)}` : "ningun hechizo del arbol tiene SpellClassOptions",
      });
      continue;
    }
    const classId = winner[0];
    const classRow = chrClass.get(classId);

    // --- Requisitos de puntos por nodo (TraitCond via grupos)
    const nodeGates = trait.gates(treeId, nodeIds);
    const requiredPoints = new Map([...nodeGates].map(([id, g]) => [id, g.points]));

    // --- Prerrequisitos (TraitEdge dentro del arbol)
    const prereqs = trait.prerequisites(nodeIds);

    // --- Rejilla. El cliente trae nodos huerfanos con coordenadas imposibles (p. ej. Y=39300, X=102800):
    // se conservan como `inactiveTalents` (visibles, no seleccionables). Las filas se calculan por
    // redondeo porque hay desfases de +-10 en Y.
    const offGrid = nodes.filter((n) => int(n.PosX) > MAX_GRID_X || int(n.PosY) > MAX_GRID_Y);
    for (const n of offGrid) {
      const sp = spellOfNode.get(n.ID!);
      const label = sp ? `${spellName.get(String(sp.spellId)) ?? "?"} (hechizo ${sp.spellId})` : "sin hechizo";
      warnings.push(`Nodo ${n.ID} fuera de la rejilla (${n.PosX}, ${n.PosY}): ${label}; se conserva como nodo no activo`);
    }
    const gridNodes = nodes.filter((n) => !offGrid.includes(n));
    const baseY = Math.min(...gridNodes.map((n) => int(n.PosY)));
    const rowOf = (n: Row) => Math.round((int(n.PosY) - baseY) / ROW_STEP);
    const remainders = gridNodes.map((n) => (int(n.PosY) - baseY) % ROW_STEP);
    const modeRemainder = [...groupBy(remainders.map(String), (r) => r)].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    const jittered = remainders.filter((r) => String(r) !== modeRemainder).length;
    if (jittered > 0) warnings.push(`${jittered} nodos con desfase de Y respecto a la rejilla (se redondean a la fila mas cercana)`);
    const xs = [...new Set(gridNodes.map((n) => int(n.PosX)))].sort((a, b) => a - b);
    const specStarts: number[] = [];
    xs.forEach((x, i) => {
      if (i === 0 || x - xs[i - 1]! > SPEC_GAP) specStarts.push(x);
    });
    if (specStarts.length !== 3) warnings.push(`Se esperaban 3 especializaciones y se han detectado ${specStarts.length}`);

    const specTabs = talentTabs
      .filter((t) => int(t.ClassMask) === 1 << (classId - 1))
      .sort((a, b) => int(a.OrderIndex) - int(b.OrderIndex));

    const specs = specStarts.map((start, index) => {
      const end = specStarts[index + 1] ?? Number.POSITIVE_INFINITY;
      const talents: Talent[] = [];
      for (const n of gridNodes) {
        const x = int(n.PosX);
        if (x < start || x >= end) continue;
        const sp = spellOfNode.get(n.ID!);
        if (!sp) continue;
        const col = Math.round((x - start) / COL_STEP);
        const row = rowOf(n);
        if (col > 3 || row > 6) warnings.push(`Nodo ${n.ID}: posicion (fila ${row}, col ${col}) fuera de la rejilla de 7x4`);
        talents.push({
          nodeId: int(n.ID),
          spellId: sp.spellId,
          name: spells.name(sp.spellId),
          ...trait.textForNode(sp),
          maxRank: sp.maxRank,
          row,
          col,
          requiredPoints: requiredPoints.get(n.ID!) ?? 0,
          gate: nodeGates.get(n.ID!) ?? null,
          prerequisites: prereqs.get(n.ID!) ?? [],
          effectPoints: trait.effectPointsOf(sp.defId),
          raw: { posX: x, posY: int(n.PosY) },
        });
      }
      talents.sort((a, b) => a.row - b.row || a.col - b.col);
      const tab = specTabs[index];
      // Los nombres, iconos y fondos de especializacion salen de TalentTab (Classic) por orden izquierda-derecha: supuesto.
      return {
        index,
        name: tab?.Name_lang ?? null,
        nameProvenance: "assumption" as const,
        iconFileDataId: tab ? int(tab.SpellIconID) || null : null,
        backgroundFile: tab?.BackgroundFile || null,
        talents,
      };
    });

    // --- Nodos no activos: se conservan para poder observarlos, nunca seleccionables
    const nearestSpec = (x: number): number | null =>
      x > MAX_GRID_X ? null : specStarts.reduce((best, start, i) => (x >= start ? i : best), 0);
    const inactiveTalents: InactiveTalent[] = offGrid.flatMap((n) => {
      const sp = spellOfNode.get(n.ID!);
      if (!sp) return [];
      return [
        {
          nodeId: int(n.ID),
          spellId: sp.spellId,
          name: spells.name(sp.spellId),
          ...trait.textForNode(sp),
          maxRank: sp.maxRank,
          selectable: false as const,
          inactiveReason: "off-grid" as const,
          nearestSpecIndex: nearestSpec(int(n.PosX)),
          requiredPoints: requiredPoints.get(n.ID!) ?? 0,
          prerequisites: prereqs.get(n.ID!) ?? [],
          effectPoints: trait.effectPointsOf(sp.defId),
          raw: { posX: int(n.PosX), posY: int(n.PosY) },
        },
      ];
    });
    inactiveTalents.sort((a, b) => a.nodeId - b.nodeId);

    for (const sp of specs) {
      if (sp.talents.length < MIN_SPEC_TALENTS) {
        warnings.push(`Especializacion ${sp.index} (${sp.name ?? "?"}) incompleta: solo ${sp.talents.length} talentos en los datos del cliente`);
      }
    }

    // --- Reglas derivadas de los datos
    const gates = [...new Set([...requiredPoints.values()])].sort((a, b) => a - b);
    const steps = gates.slice(1).map((g, i) => g - gates[i]!);
    const pointsPerRowDerived = steps.length > 0 && steps.every((s) => s === steps[0]) ? steps[0]! : null;
    const cur = [...new Set(
      raw.table("TraitCond").filter((c) => c.TraitTreeID === treeId).map((c) => c.TraitCurrencyID!),
    )][0];
    const maxPoints = cur ? int(currency.get(cur)?.SourcedMax) : 0;

    candidates.push({
      schemaVersion: 1,
      kind: "class",
      build,
      locale,
      classId,
      className: classRow?.Name_lang ?? null,
      classToken: classRow?.Filename ?? null,
      iconFileDataId: classRow ? int(classRow.IconFileDataID) || null : null,
      traitTreeId: int(treeId),
      rules: {
        maxPoints,
        maxPointsProvenance: "client-db2",
        pointsPerRowDerived,
        prerequisiteRule: "max-rank-of-prerequisite",
        prerequisiteRuleProvenance: "assumption",
        firstPointLevel: FIRST_POINT_LEVEL,
        firstPointLevelProvenance: "community",
      },
      specs,
      inactiveTalents,
      warnings,
    });
  }

  // Si hay varios arboles para la misma clase se queda el mas completo y los demas se informan.
  const total = (c: ClassTalents) => c.specs.reduce((s, sp) => s + sp.talents.length, 0);
  for (const group of groupBy(candidates, (c) => String(c.classId)).values()) {
    group.sort((a, b) => total(b) - total(a));
    classes.push(group[0]!);
    for (const alt of group.slice(1)) {
      unresolved.push({
        traitTreeId: alt.traitTreeId,
        nodeCount: total(alt),
        reason: `alternativa descartada para ${alt.className}: el arbol ${group[0]!.traitTreeId} es mas completo (${total(group[0]!)} talentos)`,
      });
    }
  }
  classes.sort((a, b) => a.classId - b.classId);
  unresolved.sort((a, b) => a.traitTreeId - b.traitTreeId);
  return { classes, unresolved, spells, trait };
}
