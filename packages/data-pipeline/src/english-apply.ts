import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abilities, Buffs, ClassTalents, Enchants, EnglishText, Items, Unassigned } from "./model.js";
import { hideUnresolved, numbersOf, renderSpellEnglish, sameNumbers, type OfficialEnglish } from "./english-official.js";
import { withRenderLocale } from "./spell-text.js";

/**
 * Traducciones propias al inglés (data/i18n/enUS-overrides.json) de los textos cuyo inglés oficial no sirve (trae cifras antiguas) o no
 * existe. Cada una se contrasta con las cifras del texto español del cliente y la web la marca como traducción propia.
 */
export interface EnglishOverrides {
  /** Texto fijo (nivel 60) por id de hechizo. */
  spells: Record<string, string>;
  /** Nombre por id de hechizo. */
  spellNames: Record<string, string>;
  /** Descripción por rango de un talento o ventaja, por nodeId. */
  talents: Record<string, string[]>;
  /** Nombre de un talento por nodeId. */
  talentNames: Record<string, string>;
  /** Talentos sin nodo: descripción por rango, por entryId. */
  entries: Record<string, string[]>;
  /** Nombre de objeto por id. */
  items: Record<string, string>;
  /** Nombre de conjunto por id. */
  itemSets: Record<string, string>;
}

export function loadEnglishOverrides(): EnglishOverrides {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/i18n/enUS-overrides.json");
  const j = (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}) as Partial<EnglishOverrides>;
  return { spells: j.spells ?? {}, spellNames: j.spellNames ?? {}, talents: j.talents ?? {}, talentNames: j.talentNames ?? {}, entries: j.entries ?? {}, items: j.items ?? {}, itemSets: j.itemSets ?? {} };
}

/** Resultado de añadir y contrastar el inglés oficial. */
export interface OfficialReport {
  ranks: { total: number; templated: number; named: number; filledByOfficial: number; own: number };
  /** Nombre inglés de la referencia externa distinto del oficial (los rangos romanos «Veneno mortal II» no cuentan). */
  nameDifferences: string[];
  /** Textos cuyo inglés no tiene las cifras del texto español del cliente y que aún no tienen traducción propia (con el español y los ingleses descartados, para traducirlos). */
  pending: { what: string; es: string; english: string[] }[];
  /** Traducciones propias cuyas cifras no coinciden con las del texto español. */
  ownMismatches: string[];
  talents: { checked: number; official: number; reference: number; own: number };
  unassigned: { entries: number; entriesNamed: number; nodes: number; nodesNamed: number };
  items: { total: number; filled: number; own: number; stillMissing: number[]; qualityMismatch: string[] };
  effectSpells: { total: number; filled: number };
}

export interface OfficialInputs {
  classes: ClassTalents[];
  legacy: ClassTalents;
  abilities: Abilities[];
  items: Items | undefined;
  /** Encantamientos: sus hechizos (al equipar, al golpear, de uso) también llevan texto del cliente que hay que verificar en inglés. */
  enchants?: Enchants;
  /** Beneficios: el texto de su hechizo también se verifica en inglés. */
  buffs?: Buffs;
  unassigned: Unassigned;
  own: EnglishOverrides;
}

/**
 * Rellena y contrasta `english` con el inglés oficial. Regla de oro: un texto inglés solo se acepta si sus cifras son las del texto español
 * del cliente. Si el inglés oficial trae otras (texto antiguo con cifras fijas), manda la traducción propia (data/i18n) y, mientras no la
 * haya, no se publica ese inglés y la web muestra el español, que sí lleva las cifras correctas.
 */
export function applyOfficialEnglish(english: EnglishText, oe: OfficialEnglish, input: OfficialInputs): OfficialReport {
  const { own } = input;
  const report: OfficialReport = {
    ranks: { total: 0, templated: 0, named: 0, filledByOfficial: 0, own: 0 },
    nameDifferences: [],
    pending: [],
    ownMismatches: [],
    talents: { checked: 0, official: 0, reference: 0, own: 0 },
    unassigned: { entries: 0, entriesNamed: 0, nodes: 0, nodesNamed: 0 },
    items: { total: 0, filled: 0, own: 0, stillMissing: [], qualityMismatch: [] },
    effectSpells: { total: 0, filled: 0 },
  };
  const ownFlags = new Set<string>(english.ownTranslation);
  const nodeSpellOf = (nodeId: number) => oe.trait.nodeSpell(String(nodeId));
  const render = <T>(fn: () => T): T => withRenderLocale("en", fn);

  const hide = (t: string | null | undefined): string | null | undefined => (t ? hideUnresolved(t) : t);

  /** Texto inglés para `es`: la traducción propia, o el primero de los candidatos con las mismas cifras; null si ninguno sirve. */
  const choose = (what: string, es: string, ownText: string | undefined, candidates: (string | null | undefined)[]): { text: string; own: boolean } | null => {
    if (ownText !== undefined) {
      if (es && !sameNumbers(es, ownText)) report.ownMismatches.push(`${what}: español [${numbersOf(es)}] ↔ traducción propia [${numbersOf(ownText)}]`);
      return { text: ownText, own: true };
    }
    for (const c of candidates) if (c && (!es || sameNumbers(es, c))) return { text: hide(c)!, own: false };
    if (es) report.pending.push({ what, es, english: candidates.filter((c): c is string => !!c) });
    return null;
  };

  // --- Habilidades: nombre, texto a nivel 60 y plantilla por rango
  for (const file of input.abilities) {
    for (const ability of file.abilities) {
      for (const rank of ability.ranks) {
        report.ranks.total++;
        const id = rank.spellId;
        const have = english.spells[id];
        const name = own.spellNames[id] ?? have?.name ?? oe.spells.name(id);
        const officialName = oe.spells.name(id);
        if (have?.name && officialName && have.name !== officialName && !(officialName.startsWith(have.name + " ") && /^[IVX]+$/.test(officialName.slice(have.name.length + 1)))) {
          report.nameDifferences.push(`${ability.name} (${id}): referencia «${have.name}», oficial «${officialName}»`);
        }
        const rendered = renderSpellEnglish(oe, id);
        if (!name) continue;
        const text = choose(`${ability.name} (${id})`, rank.description, own.spells[id], [rendered && (rendered.text.complete || !rank.descriptionComplete) ? rendered.text.text : null, have?.description]);
        const entry: EnglishText["spells"][string] = { name, description: text?.text ?? null, lines: have?.lines ?? [] };
        // La plantilla recalculable solo si el texto oficial es el que se publica
        if (text && !text.own && rendered && text.text === hide(rendered.text.text)) {
          entry.template = rendered.template.text;
          report.ranks.templated++;
        }
        if (text?.own) {
          ownFlags.add(`spell:${id}`);
          report.ranks.own++;
        }
        if (!have) report.ranks.filledByOfficial++;
        english.spells[id] = entry;
        report.ranks.named++;
      }
    }
  }

  // --- Talentos de clase y Legacy: la referencia externa solo se conserva si sus cifras son las del cliente; si no, el texto oficial o el propio
  const talents = (c: ClassTalents) => {
    for (const spec of c.specs) {
      for (const t of spec.talents) {
        const sp = nodeSpellOf(t.nodeId);
        const en = english.talents[t.nodeId];
        const official = sp ? render(() => oe.trait.textForNode(sp)) : null;
        const ownTexts = own.talents[t.nodeId];
        const name = own.talentNames[t.nodeId] ?? en?.name ?? oe.spells.name(t.spellId);
        if (!name) continue;
        const officialName = oe.spells.name(t.spellId);
        if (en?.name && officialName && en.name !== officialName) report.nameDifferences.push(`talento ${t.name} (nodo ${t.nodeId}): referencia «${en.name}», oficial «${officialName}»`);
        report.talents.checked++;
        const descriptions: string[] = [];
        for (let i = 0; i < t.descriptions.length; i++) {
          const es = t.descriptions[i]!;
          const refText = en?.descriptions.length ? en.descriptions[Math.min(i, en.descriptions.length - 1)] : undefined;
          const chosen = choose(`talento ${t.name} (nodo ${t.nodeId}) rango ${i + 1}`, es, ownTexts?.[i], [refText, official && (official.descriptionsComplete || !t.descriptionsComplete) ? official.descriptions[i] : null]);
          descriptions.push(chosen?.text ?? "");
          if (chosen?.own) report.talents.own++;
          else if (chosen && chosen.text === refText) report.talents.reference++;
          else if (chosen) report.talents.official++;
          if (chosen?.own) ownFlags.add(`talent:${t.nodeId}`);
        }
        // Si algún rango no tiene inglés fiable, el talento queda sin descripción inglesa (la web muestra el español)
        english.talents[t.nodeId] = { name, descriptions: descriptions.every((d) => d) ? descriptions : [] };
      }
    }
  };
  for (const c of input.classes) talents(c);
  talents(input.legacy);

  // --- Nodos inactivos de cada clase
  for (const c of input.classes) {
    for (const t of c.inactiveTalents) {
      const sp = nodeSpellOf(t.nodeId);
      const name = own.talentNames[t.nodeId] ?? english.talents[t.nodeId]?.name ?? oe.spells.name(t.spellId);
      if (!name) continue;
      const official = sp ? render(() => oe.trait.textForNode(sp)) : null;
      const descriptions: string[] = [];
      for (let i = 0; i < t.descriptions.length; i++) {
        const chosen = choose(`nodo inactivo ${t.name} (nodo ${t.nodeId}) rango ${i + 1}`, t.descriptions[i]!, own.talents[t.nodeId]?.[i], [official && (official.descriptionsComplete || !t.descriptionsComplete) ? official.descriptions[i] : null]);
        descriptions.push(chosen?.text ?? "");
        if (chosen?.own) ownFlags.add(`talent:${t.nodeId}`);
      }
      english.talents[t.nodeId] = { name, descriptions: descriptions.every((d) => d) ? descriptions : [] };
    }
  }

  // --- Datos sin asignar: talentos sin nodo y nodos de los árboles descartados
  for (const e of input.unassigned.orphanEntries) {
    report.unassigned.entries++;
    if (e.spellId === null) continue;
    const name = own.spellNames[e.spellId] ?? oe.spells.name(e.spellId);
    if (!name) continue;
    const official = render(() => oe.trait.textFor(e.spellId!, String(e.definitionId), e.maxRank));
    const descriptions: string[] = [];
    for (let i = 0; i < e.descriptions.length; i++) {
      const chosen = choose(`sin nodo ${e.name} (entrada ${e.entryId}) rango ${i + 1}`, e.descriptions[i]!, own.entries[e.entryId]?.[i], [official.descriptionsComplete || !e.descriptionsComplete ? official.descriptions[i] : null]);
      descriptions.push(chosen?.text ?? "");
      if (chosen?.own) ownFlags.add(`entry:${e.entryId}`);
    }
    english.entries[e.entryId] = { name, descriptions: descriptions.every((d) => d) ? descriptions : [] };
    report.unassigned.entriesNamed++;
  }
  for (const tree of input.unassigned.alternativeTrees) {
    for (const n of tree.nodes) {
      report.unassigned.nodes++;
      if (n.spellId === null) continue;
      const sp = nodeSpellOf(n.nodeId);
      const name = own.talentNames[n.nodeId] ?? oe.spells.name(n.spellId);
      if (!sp || !name) continue;
      // Un nodo de un árbol descartado puede repetir nodeId con un talento activo: no se pisa
      if (english.talents[n.nodeId]) continue;
      const official = render(() => oe.trait.textForNode(sp));
      const descriptions: string[] = [];
      for (let i = 0; i < n.descriptions.length; i++) {
        const chosen = choose(`árbol descartado ${tree.traitTreeId}, nodo ${n.name} (${n.nodeId}) rango ${i + 1}`, n.descriptions[i]!, own.talents[n.nodeId]?.[i], [official.descriptionsComplete || !n.descriptionsComplete ? official.descriptions[i] : null]);
        descriptions.push(chosen?.text ?? "");
        if (chosen?.own) ownFlags.add(`talent:${n.nodeId}`);
      }
      english.talents[n.nodeId] = { name, descriptions: descriptions.every((d) => d) ? descriptions : [] };
      report.unassigned.nodesNamed++;
    }
  }

  // --- Objetos, efectos de objetos y conjuntos
  if (input.items) {
    for (const i of input.items.items) {
      report.items.total++;
      const ownName = own.items[i.id];
      if (ownName) {
        english.items[i.id] = ownName;
        ownFlags.add(`item:${i.id}`);
        report.items.own++;
        continue;
      }
      if (english.items[i.id]) continue;
      const n = oe.itemNames.get(i.id);
      // Un nombre consultado aparte solo vale si la calidad coincide (si no, puede ser otro objeto con ese id)
      const q = oe.itemQuality.get(i.id);
      if (n && q !== undefined && q !== i.quality) {
        report.items.qualityMismatch.push(`${i.id} «${i.name}» (calidad ${i.quality}) ↔ «${n}» (calidad ${q})`);
        report.items.stillMissing.push(i.id);
      } else if (n) {
        english.items[i.id] = n;
        report.items.filled++;
      } else if (!i.placeholder) report.items.stillMissing.push(i.id);
    }
    // Texto español de cada efecto de objeto y de cada bonus de conjunto, por hechizo
    const esText = new Map<number, { text: string; complete: boolean }>();
    for (const i of input.items.items) for (const e of i.effects) if (e.text) esText.set(e.spellId, { text: e.text, complete: e.textComplete });
    for (const s of input.items.sets) for (const b of s.bonuses) if (b.text) esText.set(b.spellId, { text: b.text, complete: b.textComplete });
    for (const en of input.enchants?.enchants ?? []) for (const e of en.effects) if (e.text && !esText.has(e.spellId)) esText.set(e.spellId, { text: e.text, complete: e.textComplete });
    for (const b of input.buffs?.buffs ?? []) if (b.text && !esText.has(b.id)) esText.set(b.id, { text: b.text, complete: b.textComplete });
    for (const [id, { text: es, complete }] of esText) {
      report.effectSpells.total++;
      const have = english.spells[id];
      if (have?.description && sameNumbers(es, have.description)) continue;
      const name = own.spellNames[id] ?? oe.spells.name(id) ?? have?.name;
      const r = renderSpellEnglish(oe, id);
      const chosen = choose(`efecto de objeto o conjunto (${id}) «${name ?? ""}»`, es, own.spells[id], [r && (r.text.complete || !complete) ? r.text.text : null, have?.description]);
      if (!name && !chosen) continue;
      english.spells[id] = { name: name ?? "", description: chosen?.text ?? null, lines: [] };
      if (chosen?.own) ownFlags.add(`spell:${id}`);
      report.effectSpells.filled++;
    }
    // Efectos y bonus que solo traen nombre (sin texto): el nombre inglés oficial
    const named = new Set<number>();
    for (const i of input.items.items) for (const e of i.effects) if (!e.text) named.add(e.spellId);
    for (const s of input.items.sets) for (const b of s.bonuses) if (!b.text) named.add(b.spellId);
    for (const en of input.enchants?.enchants ?? []) for (const e of en.effects) if (!e.text) named.add(e.spellId);
    for (const id of named) {
      if (english.spells[id]?.name) continue;
      const name = own.spellNames[id] ?? oe.spells.name(id);
      if (name) english.spells[id] = { name, description: null, lines: [] };
    }
    for (const s of input.items.sets) {
      const n = own.itemSets[s.id] ?? oe.itemSets.get(s.id);
      if (n) english.itemSets[s.id] = n;
      if (own.itemSets[s.id]) ownFlags.add(`set:${s.id}`);
    }
  }
  english.ownTranslation = [...ownFlags].sort();
  return report;
}
