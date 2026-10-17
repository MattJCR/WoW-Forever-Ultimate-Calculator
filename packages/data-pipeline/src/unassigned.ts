import { CLASS_ID_BY_SPELL_SET, LEGACY_SYSTEM } from "./build.js";
import { int, type RawTables } from "./csv.js";
import type { ClassTalents, Unassigned, UnassignedEntry, UnassignedTree } from "./model.js";
import type { SpellTables } from "./spell-tables.js";
import type { TraitIndex } from "./trait-index.js";

/** Margen por encima del mayor hechizo Legacy colocado: los perks Legacy sin colocar son contiguos (1225504-1225509). */
const LEGACY_SPELL_MARGIN = 10;
/** Hechizo "Desconocido" de los huecos de Legacy: no sirve para delimitar el rango. */
const LEGACY_PLACEHOLDER_SPELL_MIN = 1_300_000;
/** Coordenadas del cliente a menos de esto de distancia se consideran la misma fila/columna (hay +-10 de ruido). */
const AXIS_TOLERANCE = 60;

/** Indice de columna/fila comprimido: agrupa coordenadas casi iguales y numera los grupos de menor a mayor. */
function compressAxis(values: number[]): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out = new Map<number, number>();
  let group = -1;
  let last = Number.NEGATIVE_INFINITY;
  for (const v of sorted) {
    if (v - last > AXIS_TOLERANCE) group++;
    out.set(v, group);
    last = v;
  }
  return out;
}

/**
 * Reune lo que el cliente trae pero NO esta en un arbol de clase activo ni en Legacy:
 *  - TraitNodeEntry que ningun nodo usa (talentos "sin asignar"; los de Legacy se marcan `isLegacy`).
 *  - TraitTree descartados (versiones parciales/antiguas de una clase, casi vacios u otros tipos), con sus nodos
 *    en cuadricula, descripciones y requisitos, para poder ver como serian.
 * Nada de esto cuenta para el calculo; en la web se puede probar rango a rango gratis.
 */
export function buildUnassigned(
  raw: RawTables,
  classes: ClassTalents[],
  legacy: ClassTalents,
  build: string,
  locale: string,
  spells: SpellTables,
  trait: TraitIndex,
): Unassigned {
  const nodes = raw.table("TraitNode");
  const entries = raw.table("TraitNodeEntry");
  const chrClass = new Map(raw.table("ChrClasses").map((r) => [int(r.ID), r]));

  const setsBySpell = new Map<string, string[]>();
  for (const r of raw.table("SpellClassOptions")) {
    const arr = setsBySpell.get(r.SpellID!);
    if (arr) arr.push(r.SpellClassSet!);
    else setsBySpell.set(r.SpellID!, [r.SpellClassSet!]);
  }

  /** Vota la clase con los hechizos dados; solo la asigna si gana con >= 80 % de los votos. */
  const guessClass = (spellIds: (number | null)[]) => {
    const votes = new Map<number, number>();
    for (const id of spellIds) {
      if (id === null) continue;
      for (const set of setsBySpell.get(String(id)) ?? []) {
        const classId = CLASS_ID_BY_SPELL_SET[int(set)];
        if (classId) votes.set(classId, (votes.get(classId) ?? 0) + 1);
      }
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((s, [, v]) => s + v, 0);
    const win = ranked[0];
    const classId = win && win[1] / total >= 0.8 ? win[0] : null;
    return {
      classId,
      className: classId === null ? null : (chrClass.get(classId)?.Name_lang ?? null),
      classVote: Object.fromEntries(ranked.map(([c, v]) => [chrClass.get(c)?.Name_lang ?? String(c), v])),
    };
  };

  // --- Ventajas de Legacy sin colocar: sus hechizos estan en el mismo bloque contiguo que las colocadas (heuristica)
  const legacySpells = legacy.specs.flatMap((s) => s.talents.map((t) => t.spellId));
  const legacySet = new Set(legacySpells);
  const core = legacySpells.filter((id) => id < LEGACY_PLACEHOLDER_SPELL_MIN);
  const lo = Math.min(...core);
  const hi = Math.max(...core) + LEGACY_SPELL_MARGIN;
  const looksLegacy = (spellId: number | null) => spellId !== null && (legacySet.has(spellId) || (spellId >= lo && spellId <= hi));

  // --- Entradas sin nodo
  const linkedEntries = new Set(raw.table("TraitNodeXTraitNodeEntry").map((l) => l.TraitNodeEntryID!));
  const orphanEntries: UnassignedEntry[] = entries
    .filter((e) => !linkedEntries.has(e.ID!))
    .map((e) => {
      const def = trait.defById.get(e.TraitDefinitionID!);
      const spellId = def ? int(def.SpellID) : null;
      const maxRank = Math.max(int(e.MaxRanks), 1);
      const text =
        spellId === null || !def
          ? { iconFileDataId: null, effectInfo: [], passive: true, textOrigin: "client" as const, rankValues: [], descriptions: [], descriptionsComplete: true, descriptionsApproximate: false }
          : trait.textFor(spellId, def.ID!, maxRank);
      return {
        entryId: int(e.ID),
        definitionId: int(e.TraitDefinitionID),
        spellId,
        name: spellId === null ? null : spells.name(spellId),
        ...text,
        maxRank,
        ...guessClass([spellId]),
        isLegacy: looksLegacy(spellId),
        legacyPlaced: spellId !== null && legacySet.has(spellId),
        status: "unassigned" as const,
        selectable: false as const,
        reason: "entry-without-node" as const,
      };
    })
    .sort((a, b) => a.entryId - b.entryId);

  // --- Arboles descartados (sin los de Legacy, que son una calculadora aparte)
  const chosen = new Set(classes.map((c) => c.traitTreeId));
  const alternativeTrees: UnassignedTree[] = raw
    .table("TraitTree")
    .filter((t) => !chosen.has(int(t.ID)) && t.TraitSystemID !== LEGACY_SYSTEM)
    .map((t) => {
      const treeNodes = nodes.filter((n) => n.TraitTreeID === t.ID);
      const nodeIds = new Set(treeNodes.map((n) => n.ID!));
      const required = trait.requiredPoints(t.ID!, nodeIds);
      const prereqs = trait.prerequisites(nodeIds);
      const cols = compressAxis(treeNodes.map((n) => int(n.PosX)));
      const rows = compressAxis(treeNodes.map((n) => int(n.PosY)));

      const outNodes = treeNodes.map((n) => {
        const sp = trait.nodeSpell(n.ID!);
        const text = sp
          ? trait.textForNode(sp)
          : { iconFileDataId: null, effectInfo: [], passive: true, textOrigin: "client" as const, rankValues: [], descriptions: [], descriptionsComplete: true, descriptionsApproximate: false };
        return {
          nodeId: int(n.ID),
          entryId: sp ? sp.entryId : null,
          spellId: sp ? sp.spellId : null,
          name: sp ? spells.name(sp.spellId) : null,
          ...text,
          maxRank: sp ? sp.maxRank : null,
          row: rows.get(int(n.PosY)) ?? 0,
          col: cols.get(int(n.PosX)) ?? 0,
          requiredPoints: required.get(n.ID!) ?? 0,
          prerequisites: prereqs.get(n.ID!) ?? [],
          posX: int(n.PosX),
          posY: int(n.PosY),
        };
      });
      const guess = guessClass(outNodes.map((n) => n.spellId));
      const sameClass = classes.find((c) => c.classId === guess.classId);
      const reason =
        treeNodes.length < 30
          ? `arbol demasiado pequeno para ser de clase (${treeNodes.length} nodos)`
          : sameClass
            ? `version parcial de ${sameClass.className}: el arbol activo es el ${sameClass.traitTreeId}`
            : "no es un arbol de clase activo";
      return {
        traitTreeId: int(t.ID),
        traitSystemId: int(t.TraitSystemID),
        flags: int(t.Flags),
        nodeCount: treeNodes.length,
        ...guess,
        reason: t.Flags === "1" ? reason : `${reason}; Flags=0 (otro tipo de arbol)`,
        status: "unassigned" as const,
        selectable: false as const,
        nodes: outNodes.sort((a, b) => a.row - b.row || a.col - b.col || a.nodeId - b.nodeId),
      };
    })
    .sort((a, b) => a.traitTreeId - b.traitTreeId);

  return { schemaVersion: 1, build, locale, orphanEntries, alternativeTrees };
}
