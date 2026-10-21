import { int, type RawTables } from "./csv.js";
import type { ClassTalents, Talent } from "./model.js";
import type { SpellTables } from "./spell-tables.js";
import { LEGACY_SYSTEM } from "./build.js";
import type { TraitIndex } from "./trait-index.js";

/** Separacion de la rejilla de Legacy en el cliente (X e Y), distinta de la de clase (600). */
const STEP = 900;

/**
 * Los arboles Legacy no traen nombre en el cliente (TraitTree.TitleText_lang vacio). Estos salen de la referencia
 * (Adventure / Resourcefulness / Professions), emparejados por el contenido de cada arbol (p. ej. "Maestro cocinero"
 * esta en el 1187 = Professions). Orden de la web de referencia.
 */
const TREE_NAMES: { id: number; name: string }[] = [
  { id: 1188, name: "Aventura" },
  { id: 1189, name: "Recursos" },
  { id: 1187, name: "Profesiones" },
];

/**
 * Legacy: ventajas de cuenta que se ganan con desafios (16 puntos). Se modela como un "arbol de clase" con
 * kind = "legacy" para reutilizar las reglas y la interfaz; sus puntos se suman a los del personaje.
 */
export function buildLegacy(raw: RawTables, build: string, locale: string, spells: SpellTables, trait: TraitIndex): ClassTalents {
  const warnings: string[] = [];
  const allNodeRows = raw.table("TraitNode");
  // El sistema 45 incluye un arbol vacio (1118): solo cuentan los que tienen nodos.
  const trees = raw
    .table("TraitTree")
    .filter((t) => t.TraitSystemID === LEGACY_SYSTEM && allNodeRows.some((n) => n.TraitTreeID === t.ID));
  const order = (id: number) => {
    const i = TREE_NAMES.findIndex((t) => t.id === id);
    return i < 0 ? 99 : i;
  };
  trees.sort((a, b) => order(int(a.ID)) - order(int(b.ID)) || int(a.ID) - int(b.ID));

  const allNodes = allNodeRows.filter((n) => trees.some((t) => t.ID === n.TraitTreeID));
  const minX = Math.min(...allNodes.map((n) => int(n.PosX)));
  const minY = Math.min(...allNodes.map((n) => int(n.PosY)));

  const cond = raw.table("TraitCond").filter((c) => trees.some((t) => t.ID === c.TraitTreeID));
  const currencyId = cond[0]?.TraitCurrencyID;
  const maxPoints = int(raw.table("TraitCurrency").find((c) => c.ID === currencyId)?.SourcedMax);

  const allRequired: number[] = [];
  const specs = trees.map((tree, index) => {
    const nodes = allNodes.filter((n) => n.TraitTreeID === tree.ID);
    const nodeIds = new Set(nodes.map((n) => n.ID!));
    const gates = trait.gates(tree.ID!, nodeIds);
    const prereqs = trait.prerequisites(nodeIds);
    allRequired.push(...[...gates.values()].map((g) => g.points));
    const talents: Talent[] = [];
    for (const n of nodes) {
      const sp = trait.nodeSpell(n.ID!, warnings);
      if (!sp) continue;
      talents.push({
        nodeId: int(n.ID),
        spellId: sp.spellId,
        name: spells.name(sp.spellId),
        ...trait.textForNode(sp),
        maxRank: sp.maxRank,
        row: Math.round((int(n.PosY) - minY) / STEP),
        col: Math.round((int(n.PosX) - minX) / STEP),
        requiredPoints: gates.get(n.ID!)?.points ?? 0,
        gate: gates.get(n.ID!) ?? null,
        prerequisites: prereqs.get(n.ID!) ?? [],
        effectPoints: trait.effectPointsOf(sp.defId),
        raw: { posX: int(n.PosX), posY: int(n.PosY) },
      });
    }
    talents.sort((a, b) => a.row - b.row || a.col - b.col);
    const named = TREE_NAMES.find((t) => t.id === int(tree.ID));
    return {
      index,
      name: named?.name ?? null,
      nameProvenance: "community" as const,
      traitTreeId: int(tree.ID),
      // Los arboles de Legacy no traen icono en el cliente: se usa el de su primera ventaja (la de arriba).
      iconFileDataId: talents[0]?.iconFileDataId ?? null,
      talents,
    };
  });

  const gates = [...new Set(allRequired)].sort((a, b) => a - b);
  const steps = gates.slice(1).map((g, i) => g - gates[i]!);

  return {
    schemaVersion: 1,
    kind: "legacy",
    build,
    locale,
    classId: 0,
    className: "Legacy",
    classToken: "LEGACY",
    // Icono de Legacy: el de Talentoso (la ventaja que condiciona el resto del calculo), o el primero que haya.
    iconFileDataId: specs.flatMap((sp) => sp.talents).find((t) => t.spellId === 1225474)?.iconFileDataId ?? specs[0]?.iconFileDataId ?? null,
    traitTreeId: int(trees[0]?.ID),
    rules: {
      maxPoints,
      maxPointsProvenance: "client-db2",
      pointsPerRowDerived: steps.length > 0 && steps.every((s) => s === steps[0]) ? steps[0]! : null,
      prerequisiteRule: "max-rank-of-prerequisite",
      prerequisiteRuleProvenance: "assumption",
      // Los puntos de Legacy se ganan con desafios de cuenta, no por nivel.
      firstPointLevel: null,
      firstPointLevelProvenance: "assumption",
    },
    specs,
    inactiveTalents: [],
    warnings,
  };
}
