import type { ClassTalents } from "@wfuc/schema";
import { encodeBuild } from "./code.js";
import { characterRequiredLevel, firstPointLevel } from "./modifiers.js";
import { rankOf, totalPoints, type Build, type ClassIndex } from "./rules.js";

/** Un talento escogido, de clase o de Legacy: la unidad que luego alimentara el calculo de estadisticas y habilidades. */
export interface SelectedTalent {
  source: "class" | "legacy";
  treeName: string | null;
  nodeId: number;
  spellId: number;
  name: string | null;
  rank: number;
  maxRank: number;
  /** Texto del tooltip al rango escogido (valores ya calculados). */
  text: string;
  approximate: boolean;
  unresolved: boolean;
  /** De donde sale el texto (cliente en espanol, traduccion propia o ingles sin traducir). */
  textOrigin: "client" | "translated-by-us" | "untranslated";
}

export function selectedTalents(idx: ClassIndex, build: Build): SelectedTalent[] {
  const out: SelectedTalent[] = [];
  const source = idx.data.kind === "legacy" ? "legacy" : "class";
  for (const spec of idx.data.specs) {
    for (const t of [...spec.talents].sort((a, b) => a.row - b.row || a.col - b.col)) {
      const rank = rankOf(build, t.nodeId);
      if (rank < 1) continue;
      out.push({
        source,
        treeName: spec.name,
        nodeId: t.nodeId,
        spellId: t.spellId,
        name: t.name,
        rank,
        maxRank: t.maxRank,
        text: t.descriptions[rank - 1] ?? "",
        approximate: t.descriptionsApproximate,
        unresolved: !t.descriptionsComplete,
        textOrigin: t.textOrigin,
      });
    }
  }
  return out;
}

export interface CharacterSummary {
  classPoints: number;
  classMax: number;
  legacyPoints: number;
  legacyMax: number;
  /** Nivel necesario para los puntos de clase (los de Legacy no dependen del nivel: se ganan con desafios). */
  requiredLevel: number;
  /** Nivel del primer punto de talento (10, o menos con Talentoso de Legacy). */
  firstPointLevel: number;
  /** true si Legacy (Talentoso) adelanta el primer punto de talento. */
  firstPointFromLegacy: boolean;
  /** Puntos por especializacion, en el orden de los arboles. */
  treePoints: number[];
  selected: SelectedTalent[];
}

/** Resumen del personaje: lo que se ha escogido en clase y en Legacy, listo para calcular efectos. */
export function summarizeCharacter(cls: ClassIndex, classBuild: Build, legacy: ClassIndex | null, legacyBuild: Build): CharacterSummary {
  const classPoints = totalPoints(classBuild);
  return {
    classPoints,
    classMax: cls.data.rules.maxPoints,
    legacyPoints: legacy ? totalPoints(legacyBuild) : 0,
    legacyMax: legacy ? legacy.data.rules.maxPoints : 0,
    requiredLevel: characterRequiredLevel(cls, classPoints, legacy, legacyBuild),
    firstPointLevel: firstPointLevel(cls, legacy, legacyBuild).level,
    firstPointFromLegacy: firstPointLevel(cls, legacy, legacyBuild).fromLegacy,
    treePoints: cls.data.specs.map((s) => cls.ordered.filter((i) => i.specIndex === s.index).reduce((n, i) => n + rankOf(classBuild, i.talent.nodeId), 0)),
    selected: [...selectedTalents(cls, classBuild), ...(legacy ? selectedTalents(legacy, legacyBuild) : [])],
  };
}

export interface AiExportInput {
  cls: ClassIndex;
  classBuild: Build;
  legacy: ClassIndex | null;
  legacyBuild: Build;
  /** Raza escogida (nombre), si ya hay paso de raza. */
  raceName?: string | null;
  /** Habilidades raciales de esa raza (texto del cliente). */
  racials?: { name: string; kind: "active" | "passive"; description: string }[];
  /** Enlace al build (URL actual). */
  link: string;
  /** Enlace a los datos en bruto de la clase. */
  dataLink?: string;
  hotfixesApplied: boolean;
}

/**
 * Texto de "Copiar build para IA": el build con el texto completo de cada talento al rango escogido, para pegarlo
 * en una IA y preguntarle algo. Mismo esquema que el de la referencia, ampliado con raza, Legacy y rango de nivel.
 * Devuelve null si no hay puntos gastados.
 */
export function formatBuildForAI(input: AiExportInput): string | null {
  const { cls, classBuild, legacy, legacyBuild } = input;
  const s = summarizeCharacter(cls, classBuild, legacy, legacyBuild);
  if (s.classPoints + s.legacyPoints === 0) return null;
  const d: ClassTalents = cls.data;
  const trees = d.specs.map((sp) => sp.name ?? `Arbol ${sp.index + 1}`);
  const lines: string[] = [];
  lines.push(
    `WoW Forever ${input.raceName ? `${input.raceName} ` : ""}${d.className} talent build: ${s.treePoints.join("/")} (${trees.join(" / ")}), ` +
      `level ${s.requiredLevel} needed for the class talents${s.firstPointFromLegacy ? ` (the first talent point comes at level ${s.firstPointLevel} thanks to the Legacy perk Talented)` : ""}, ` +
      `${s.classPoints}/${s.classMax} class points spent` +
      (legacy ? `, ${s.legacyPoints}/${s.legacyMax} Legacy points spent` : "") +
      `. Built on this calculator; talent text comes from the WoW Forever beta client (build ${d.build}` +
      `${input.hotfixesApplied ? ", with the server's hotfixes from the beta's hotfix cache" : ""}), so treat it as the beta build, not the final game.`,
  );
  lines.push(input.link, "");

  const byTree = new Map<string, SelectedTalent[]>();
  for (const t of s.selected.filter((x) => x.source === "class")) {
    const k = t.treeName ?? "";
    byTree.set(k, [...(byTree.get(k) ?? []), t]);
  }
  for (const [name, list] of byTree) {
    lines.push(`${name} (${list.reduce((n, t) => n + t.rank, 0)} points)`);
    for (const t of list) lines.push(`- ${t.name ?? `Spell ${t.spellId}`} ${t.rank}/${t.maxRank}${t.approximate ? " (base values)" : ""}: ${oneLine(t.text)}`);
    lines.push("");
  }
  const legacyTalents = s.selected.filter((x) => x.source === "legacy");
  if (legacyTalents.length > 0) {
    lines.push(`Legacy perks (${s.legacyPoints}/${s.legacyMax} points; account-wide, added on top of the class talents)`);
    for (const t of legacyTalents) lines.push(`- ${t.treeName}: ${t.name ?? `Spell ${t.spellId}`} ${t.rank}/${t.maxRank}: ${oneLine(t.text)}`);
    lines.push("");
  }
  if (input.racials && input.racials.length > 0) {
    lines.push(`Racial abilities (${input.raceName ?? "race"}; client text, not yet included in any calculation)`);
    for (const r of input.racials) lines.push(`- ${r.name} (${r.kind}): ${oneLine(r.description)}`);
    lines.push("");
  }
  const flags = [
    s.selected.some((x) => x.approximate) ? "(base values) marks numbers that scale with character level: the text shows the client's base value" : "",
    s.selected.some((x) => x.unresolved) ? "$-tokens are values that depend on the character (attack power, level...) and are not calculated yet" : "",
  ].filter(Boolean);
  lines.push(
    `Notes: each line is the in-game tooltip at the rank chosen${flags.length ? `; ${flags.join("; ")}` : ""}. ` +
      `Every ${d.rules.pointsPerRowDerived ?? 5} points spent in a tree unlock its next row. ` +
      `Build code: class ${encodeBuild(cls, classBuild)}${legacy ? `, Legacy ${encodeBuild(legacy, legacyBuild)}` : ""}.` +
      `${input.dataLink ? ` Full data for this class (every talent at every rank): ${input.dataLink}` : ""}`,
  );
  return lines.join("\n");
}

const oneLine = (text: string): string => text.replace(/\s*\n+\s*/g, " ").trim();
