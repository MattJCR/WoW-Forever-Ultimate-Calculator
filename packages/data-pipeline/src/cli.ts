import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClassTalents } from "./build.js";
import { contrastAbilities, contrastClass, contrastLegacy, contrastOrphans, contrastRaces } from "./contrast.js";
import { openRawTables } from "./csv.js";
import { ClientStats, CombatFormulas, EnglishText, TalentRules, Abilities, BaseStats, ClassTalents, CombatRatings, Buffs, Enchants, EquipRules, ItemSources, Items, Manifest, RandomSuffixes, Races, Unassigned } from "./model.js";
import { buildEquipRules } from "./equip-rules.js";
import { buildItems } from "./items.js";
import { buildItemSources } from "./item-sources.js";
import { buildBuffs, type BuffRules } from "./buffs.js";
import { applyWowsims, buildCombatRatings, buildEnchants, buildRandomSuffixes, type WowsimsDb } from "./wowsims.js";
import { buildAbilities } from "./abilities.js";
import { buildEnglish } from "./english.js";
import { applyOfficialEnglish, loadEnglishOverrides } from "./english-apply.js";
import { applyOfficialRacials, loadOfficialEnglish } from "./english-official.js";
import { buildRules } from "./rules.js";
import { buildLegacy } from "./legacy.js";
import { attachClassRacials, buildRaces } from "./races.js";
import { contrastRacials } from "./racial-contrast.js";
import { buildBaseStats, type ClassicEra } from "./stats.js";
import { buildClientStats } from "./client-stats.js";
import { buildUnassigned } from "./unassigned.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_BUILD = "1.60.1.70658";
const DEFAULT_LOCALE = "esES";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const stableJson = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * --source hotfix (por defecto): data/raw/<build>-hotfix -> data/forever/<build>
 * --source static: datos estaticos del cliente sin hotfixes -> data/forever/<build>-static
 */
function sourceDirs(buildId: string): { rawDir: string; outDir: string; hotfixes: boolean } {
  const hotfixes = arg("source", "hotfix") !== "static";
  return {
    hotfixes,
    rawDir: resolve(arg("raw", join(repoRoot, "data", "raw", hotfixes ? `${buildId}-hotfix` : buildId))),
    outDir: resolve(arg("out", join(repoRoot, "data", "forever", hotfixes ? buildId : `${buildId}-static`))),
  };
}

function build(): void {
  const buildId = arg("build", DEFAULT_BUILD);
  const locale = arg("locale", DEFAULT_LOCALE);
  const { rawDir, outDir, hotfixes } = sourceDirs(buildId);

  const raw = openRawTables(rawDir);
  const { classes, unresolved, spells, trait } = buildClassTalents(raw, buildId, locale);

  mkdirSync(join(outDir, "classes"), { recursive: true });
  const entries: Manifest["classes"] = [];
  for (const cls of classes) {
    ClassTalents.parse(cls);
    const file = `classes/${(cls.classToken ?? `class-${cls.classId}`).toLowerCase()}.json`;
    const text = stableJson(cls);
    writeFileSync(join(outDir, file), text);
    entries.push({
      classId: cls.classId,
      className: cls.className,
      iconFileDataId: cls.iconFileDataId ?? null,
      traitTreeId: cls.traitTreeId,
      talentCount: cls.specs.reduce((s, sp) => s + sp.talents.length, 0),
      specNames: cls.specs.map((sp) => sp.name).filter((n): n is string => !!n),
      inactiveCount: cls.inactiveTalents.length,
      file,
      sha256: sha256(text),
      warnings: cls.warnings.length,
    });
  }
  const legacy = ClassTalents.parse(buildLegacy(raw, buildId, locale, spells, trait));
  const legacyText = stableJson(legacy);
  writeFileSync(join(outDir, "legacy.json"), legacyText);

  const unassigned = Unassigned.parse(buildUnassigned(raw, classes, legacy, buildId, locale, spells, trait));
  const unassignedText = stableJson(unassigned);
  writeFileSync(join(outDir, "unassigned.json"), unassignedText);

  const races = Races.parse(buildRaces(raw, buildId, locale, spells));
  let racesText = stableJson(races);
  writeFileSync(join(outDir, "races.json"), racesText);

  // Objetos equipables (armas y armadura): solo si el volcado trae las tablas de objetos (ITEMS=1 export-tables.sh, con hotfixes)
  const itemTables = ["Item", "ItemSparse", "ItemEffect", "ItemXItemEffect", "RandPropPoints", "ItemArmorTotal", "ItemArmorQuality", "ItemArmorShield", "ArmorLocation", "ItemDamageOneHand", "ItemDamageTwoHand", "ItemDamageWand", "ItemDamageThrown", "SkillRaceClassInfo"];
  let itemsEntry: Manifest["items"];
  let itemsData: Items | undefined;
  let equipEntry: Manifest["equipRules"];
  let ratingsEntry: Manifest["combatRatings"];
  let enchantsEntry: Manifest["enchants"];
  let sourcesEntry: Manifest["itemSources"];
  let buffsEntry: Manifest["buffs"];
  let buffsData: Buffs | undefined;
  let suffixesEntry: Manifest["randomSuffixes"];
  let wsDb: WowsimsDb | null = null;
  let enchantsData: Enchants | undefined;
  if (itemTables.every((t) => existsSync(join(rawDir, `${t}.csv`)))) {
    let built = buildItems(raw, buildId, spells);
    // La comunidad (MIT, data/external/wowsims): objetos nuevos, sufijos aleatorios, encantamientos y puntuaciones
    const wsDir = resolve(arg("wowsims", join(repoRoot, "data", "external", "wowsims")));
    if (existsSync(join(wsDir, "db.json")) && existsSync(join(wsDir, "CombatRatings.txt"))) {
      const db = JSON.parse(readFileSync(join(wsDir, "db.json"), "utf8")) as WowsimsDb;
      wsDb = db;
      const merged = applyWowsims(built, db);
      built = merged.items;
      const ws: string[] = [];
      const ratings = CombatRatings.parse(buildCombatRatings(readFileSync(join(wsDir, "CombatRatings.txt"), "utf8"), buildId));
      const ratingsText = stableJson(ratings);
      writeFileSync(join(outDir, "combat-ratings.json"), ratingsText);
      ratingsEntry = { file: "combat-ratings.json", sha256: sha256(ratingsText) };
      const enchants = Enchants.parse(buildEnchants(db, raw, buildId, ws, spells));
      enchantsData = enchants;
      const enchantsText = `${JSON.stringify(enchants)}
`;
      writeFileSync(join(outDir, "enchants.json"), enchantsText);
      enchantsEntry = { file: "enchants.json", sha256: sha256(enchantsText), count: enchants.enchants.length };
      const suffixNamesFile = resolve(repoRoot, "data", "i18n", "suffixes-esES.json");
      const suffixNames = existsSync(suffixNamesFile) ? (JSON.parse(readFileSync(suffixNamesFile, "utf8")) as { names: Record<string, string> }).names : {};
      const suffixes = RandomSuffixes.parse(buildRandomSuffixes(db, buildId, suffixNames));
      const suffixesText = `${JSON.stringify(suffixes)}
`;
      writeFileSync(join(outDir, "random-suffixes.json"), suffixesText);
      suffixesEntry = { file: "random-suffixes.json", sha256: sha256(suffixesText), count: suffixes.suffixes.length };
      console.log(`La comunidad: ${merged.extra} objetos nuevos (${merged.skipped} sin ranura omitidos), ${enchants.enchants.length} encantamientos, ${suffixes.suffixes.length} sufijos aleatorios, puntuaciones ${ratings.constantAcrossLevels ? "constantes en los 123 niveles" : "que VARIAN por nivel"}`);
      for (const w of ws) console.log(`   aviso (la comunidad): ${w}`);
    } else {
      console.log("datos de la comunidad: no encontrados (db.json y CombatRatings.txt); se omiten encantamientos, sufijos, puntuaciones y objetos nuevos");
    }
    itemsData = Items.parse(built);
    const itemsText = `${JSON.stringify(itemsData)}\n`; // compacto: ~12 500 objetos
    writeFileSync(join(outDir, "items.json"), itemsText);
    itemsEntry = { file: "items.json", sha256: sha256(itemsText), itemCount: itemsData.items.length, unavailableCount: itemsData.unavailable.length };
    for (const w of itemsData.warnings) console.log(`   aviso (objetos): ${w}`);
    if (["SkillLine", "SkillLineAbility", "SpellEffect"].every((t) => existsSync(join(rawDir, `${t}.csv`)))) {
      const sources = ItemSources.parse(buildItemSources(raw, buildId, new Set(itemsData.items.filter((i) => !i.placeholder).map((i) => i.id))));
      const sourcesText = `${JSON.stringify(sources)}
`;
      writeFileSync(join(outDir, "sources.json"), sourcesText);
      sourcesEntry = { file: "sources.json", sha256: sha256(sourcesText), count: Object.keys(sources.items).length };
      const kinds = new Map<string, number>();
      for (const list of Object.values(sources.items)) for (const k of new Set(list.map((e) => e.kind))) kinds.set(k, (kinds.get(k) ?? 0) + 1);
      console.log(`Fuentes (sources.json): ${sourcesEntry.count} objetos con fuente (${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")})`);
    }
    const equip = EquipRules.parse(buildEquipRules(raw, buildId));
    const equipText = stableJson(equip);
    writeFileSync(join(outDir, "equip-rules.json"), equipText);
    equipEntry = { file: "equip-rules.json", sha256: sha256(equipText) };
    for (const w of equip.warnings) console.log(`   aviso (equipar): ${w}`);
  } else {
    console.log("Objetos: sin tablas de objetos en el volcado (usa ITEMS=1 HOTFIXES=1 tools/extract/export-tables.sh); se omite items.json");
  }

  // La referencia (solo contraste) y sus habilidades retiradas
  const tfDir = resolve(arg("tf", join(repoRoot, "data", "external", "talentsforever")));
  const goneFile = resolve(repoRoot, "data", "rules", "tf-gone.json");
  const goneFileData = existsSync(goneFile) ? (JSON.parse(readFileSync(goneFile, "utf8")) as { classes: Record<string, Record<string, string | null>>; official?: Record<string, Record<string, string>> }) : null;
  const goneByClass: Record<string, Record<string, string | null>> = goneFileData?.classes ?? {};
  const officialByClass = goneFileData?.official ?? {};

  // Habilidades (libro de hechizos) de las clases ya revisadas
  mkdirSync(join(outDir, "abilities"), { recursive: true });
  const abilityEntries: Manifest["abilities"] = [];
  const abilityIcons = new Set<number>();
  const abilityData: Abilities[] = [];
  const ruleEntries: Manifest["rules"] = [];
  mkdirSync(join(outDir, "rules"), { recursive: true });
  for (const cls of classes) {
    const data = buildAbilities(raw, spells, cls.classId, buildId, locale, cls);
    if (!data) continue;
    // Contraste con la referencia: cada habilidad lleva su estado (lista / parcial / no la lista / retirada)
    const token = (cls.classToken ?? "").toLowerCase();
    const contrasted = contrastAbilities(Abilities.parse(data), token, tfDir, goneByClass[token] ?? {}, officialByClass[token] ?? {});
    if (contrasted) {
      const r = contrasted.report;
      console.log(`   contraste externo ${cls.className}: ${r.listed} listadas, ${r.partial.length} parciales, ${r.notListed.length} que la referencia no lista, ${r.retired.length} retiradas; la referencia lista y no tenemos: ${r.tfOnly.length ? r.tfOnly.join(", ") : "ninguna"}`);
    }
    const parsed = contrasted ? contrasted.abilities : Abilities.parse(data);
    abilityData.push(parsed);
    const text = stableJson(parsed);
    const file = `abilities/${(cls.classToken ?? `class-${cls.classId}`).toLowerCase()}.json`;
    writeFileSync(join(outDir, file), text);
    for (const a of parsed.abilities) if (a.iconFileDataId) abilityIcons.add(a.iconFileDataId);
    const rules = buildRules(cls, parsed, buildId);
    if (rules) {
      const parsedRules = TalentRules.parse(rules);
      const rulesText = stableJson(parsedRules);
      const rulesFile = `rules/${(cls.classToken ?? `class-${cls.classId}`).toLowerCase()}.json`;
      writeFileSync(join(outDir, rulesFile), rulesText);
      ruleEntries.push({ classId: cls.classId, file: rulesFile, sha256: sha256(rulesText), ruleCount: parsedRules.rules.length });
      for (const w of parsedRules.warnings) console.log(`   aviso (reglas ${cls.className}): ${w}`);
    }
    abilityEntries.push({ classId: cls.classId, file, sha256: sha256(text), abilityCount: parsed.abilities.length, rankCount: parsed.abilities.reduce((n, a) => n + a.ranks.length, 0) });
    for (const w of parsed.warnings) console.log(`   aviso (habilidades ${cls.className}): ${w}`);
  }

  // Habilidades de clase ligadas a una raza (Sacerdote…): se cuelgan de la raza para la pantalla de razas
  attachClassRacials(races, abilityData, spells);
  // Contraste de cada racial con la referencia externa (cambios futuros que el cliente aún no trae): el cliente manda, solo se avisa
  const racialNames = (JSON.parse(readFileSync(resolve(repoRoot, "data", "i18n", "racials-en.json"), "utf8")) as { names: Record<string, string> }).names;
  const refNotesFile = resolve(repoRoot, "data", "rules", "reference-notes.json");
  const refNotes = existsSync(refNotesFile) ? (JSON.parse(readFileSync(refNotesFile, "utf8")) as { racials?: Record<string, string> }).racials ?? {} : {};
  const racialContrast = contrastRacials(races, tfDir, racialNames, refNotes);
  if (racialContrast) {
    console.log(`Raciales frente a la referencia: ${racialContrast.same} iguales; con otras cifras (cambio futuro): ${racialContrast.differs.length ? racialContrast.differs.join(", ") : "ninguna"}; que la referencia no lista: ${racialContrast.notListed.length ? racialContrast.notListed.join(", ") : "ninguna"}; que solo lista la referencia: ${racialContrast.referenceOnly.length ? racialContrast.referenceOnly.join(", ") : "ninguna"}; revisadas a mano: ${racialContrast.reviewed.length}`);
  }
  racesText = stableJson(Races.parse(races));
  writeFileSync(join(outDir, "races.json"), racesText);
  console.log(`Raciales de clase: ${races.races.map((r) => `${r.name} ${r.classRacials.length}`).filter((s) => !s.endsWith(" 0")).join(", ")}`);

  // Beneficios («buffs»): habilidades de clase, tótems, mascota y consumibles (client-db2)
  const buffRulesFile = resolve(repoRoot, "data", "rules", "buffs.json");
  if (["Item", "ItemSparse", "ItemEffect", "ItemXItemEffect", "SpellClassOptions", "SkillLine", "SkillLineAbility"].every((t) => existsSync(join(rawDir, `${t}.csv`))) && existsSync(buffRulesFile)) {
    const warnings: string[] = [];
    buffsData = Buffs.parse(buildBuffs(raw, buildId, spells, abilityData, JSON.parse(readFileSync(buffRulesFile, "utf8")) as BuffRules, warnings));
    const by = (c: string) => buffsData!.buffs.filter((b) => b.category === c).length;
    console.log(`Beneficios (buffs.json): ${buffsData.buffs.length} (clase ${by("class")}, tótems ${by("totem")}, mascota ${by("pet")}, campamento ${by("camp")}, profesión ${by("profession")}, pociones ${by("potion")}, elixires ${by("elixir")}, frascos ${by("flask")}, pergaminos ${by("scroll")}, comida ${by("food")}, otros ${by("other")})`);
    for (const w of warnings) console.log(`   aviso (buffs): ${w}`);
  }

  // Formulas de combate de Classic (estimacion): se validan y se publican tal cual
  const formulasSource = resolve(repoRoot, "data", "rules", "combat-formulas.json");
  let formulasEntry: Manifest["combatFormulas"];
  if (existsSync(formulasSource)) {
    const { _readme: _ignored, ...raw } = JSON.parse(readFileSync(formulasSource, "utf8")) as Record<string, unknown>;
    const formulasText = stableJson(CombatFormulas.parse(raw));
    writeFileSync(join(outDir, "combat-formulas.json"), formulasText);
    formulasEntry = { file: "combat-formulas.json", sha256: sha256(formulasText) };
  }

  // Critico por atributo, mana base y poder de ataque por atributo: SI estan en el cliente (PlayerExpectedStat, ChrClasses)
  const clientStats = ClientStats.parse(buildClientStats(raw, buildId));
  const clientStatsText = stableJson(clientStats);
  writeFileSync(join(outDir, "client-stats.json"), clientStatsText);

  // Estadisticas base: los atributos por raza y clase no estan en el cliente; salen de Classic Era (tools/extract/fetch-classic-stats.mjs)
  const classicFile = resolve(arg("classic", join(repoRoot, "data", "external", "classic-stats", "classic-era.json")));
  const classic = JSON.parse(readFileSync(classicFile, "utf8")) as ClassicEra;
  const stats = BaseStats.parse(buildBaseStats(races, classic, buildId));
  const statsText = stableJson(stats);
  writeFileSync(join(outDir, "stats.json"), statsText);

  // Textos en ingles (opcion «English» de la web): de la referencia externa y de la comunidad, no del cliente
  let englishEntry: Manifest["english"];
  if (existsSync(tfDir)) {
    const { english, report } = buildEnglish(buildId, classes, legacy, races, abilityData, itemsData, tfDir, wsDb);
    // Tablas oficiales del juego en inglés (data/external/enus): rellenan y contrastan lo que la referencia externa no trae
    const enusDir = resolve(arg("enus", join(repoRoot, "data", "external", "enus")));
    const official = loadOfficialEnglish(enusDir, raw, spells);
    if (official) {
      const o = applyOfficialEnglish(english, official, { classes, legacy, abilities: abilityData, items: itemsData, enchants: enchantsData, buffs: buffsData, unassigned, own: loadEnglishOverrides() });
      const racials = applyOfficialRacials(english, races, official);
      console.log(`   raciales con el inglés del cliente: ${racials.official}/${racials.official + racials.fallback.length}${racials.fallback.length ? `; con el inglés de la comunidad: ${racials.fallback.join(", ")}` : ""}`);
      // Nombre en inglés de cada beneficio (hechizo o objeto): de las tablas oficiales
      for (const b of buffsData?.buffs ?? []) b.nameEn = (b.itemId !== null ? official.itemNames.get(b.itemId) : official.spells.name(b.id)) ?? b.nameEn;
      console.log(`Inglés oficial (tablas ${official.tablesBuild}): habilidades ${o.ranks.named}/${o.ranks.total} rangos (${o.ranks.templated} con plantilla, ${o.ranks.own} traducción propia); talentos ${o.talents.checked} (referencia ${o.talents.reference}, oficial ${o.talents.official}, propia ${o.talents.own}); sin asignar ${o.unassigned.entriesNamed}/${o.unassigned.entries} talentos y ${o.unassigned.nodesNamed}/${o.unassigned.nodes} nodos; objetos +${o.items.filled} (propios ${o.items.own}, faltan ${o.items.stillMissing.length}); efectos ${o.effectSpells.filled}/${o.effectSpells.total}`);
      console.log(`   pendientes de traducción propia (cifras distintas o sin inglés): ${o.pending.length}; traducciones propias con otras cifras: ${o.ownMismatches.length}`);
      mkdirSync(join(repoRoot, "data", "i18n"), { recursive: true });
      writeFileSync(join(repoRoot, "data", "i18n", "en-verification.json"), stableJson({ build: buildId, tablesBuild: official.tablesBuild, ...o }));
    } else {
      console.log("Inglés oficial: sin tablas en data/external/enus (tools/extract/fetch-enus-tables.mjs); solo la referencia externa");
    }
    const englishText = `${JSON.stringify(EnglishText.parse(english))}
`;
    mkdirSync(join(outDir, "i18n"), { recursive: true });
    writeFileSync(join(outDir, "i18n", "en.json"), englishText);
    englishEntry = { file: "i18n/en.json", sha256: sha256(englishText) };
    console.log(`Inglés (i18n/en.json): talentos ${report.talents.matched}/${report.talents.ours}, Legacy ${report.legacy.matched}/${report.legacy.ours}, habilidades con nombre ${report.abilities.named}/${report.abilities.ours} (con texto ${report.abilities.described}), objetos ${report.items.matched}/${report.items.ours}, razas ${report.races.matched}/${report.races.ours}`);
    for (const w of report.racialWarnings) console.log(`   aviso (raciales en inglés): ${w}`);
  } else {
    console.log("Inglés: sin export de la referencia; se omite i18n/en.json");
  }

  if (buffsData) {
    const buffsText = `${JSON.stringify(buffsData)}
`;
    writeFileSync(join(outDir, "buffs.json"), buffsText);
    buffsEntry = { file: "buffs.json", sha256: sha256(buffsText), count: buffsData.buffs.length };
  }

  // Iconos que necesita la web; tools/extract/fetch-icons.mjs los descarga del cliente (solo lectura).
  const iconIds = new Set<number>(abilityIcons);
  for (const c of classes) {
    if (c.iconFileDataId) iconIds.add(c.iconFileDataId);
    for (const s of c.specs) if (s.iconFileDataId) iconIds.add(s.iconFileDataId);
    for (const t of c.specs.flatMap((s) => s.talents)) if (t.iconFileDataId) iconIds.add(t.iconFileDataId);
    for (const t of c.inactiveTalents) if (t.iconFileDataId) iconIds.add(t.iconFileDataId);
  }
  for (const t of legacy.specs.flatMap((s) => s.talents)) if (t.iconFileDataId) iconIds.add(t.iconFileDataId);
  for (const r of races.races) for (const a of r.racials) if (a.iconFileDataId) iconIds.add(a.iconFileDataId);
  for (const e of unassigned.orphanEntries) if (e.iconFileDataId) iconIds.add(e.iconFileDataId);
  for (const t of unassigned.alternativeTrees) for (const n of t.nodes) if (n.iconFileDataId) iconIds.add(n.iconFileDataId);
  // Objetos: los iconos de todos los equipables que la web puede ofrecer (los de prueba no se ofrecen)
  if (itemsData) for (const i of itemsData.items) if (!i.placeholder && i.iconFileDataId) iconIds.add(i.iconFileDataId);
  for (const b of buffsData?.buffs ?? []) if (b.iconFileDataId) iconIds.add(b.iconFileDataId);
  const iconsText = stableJson({ build: buildId, ids: [...iconIds].sort((a, b) => a - b) });
  writeFileSync(join(outDir, "icons.json"), iconsText);

  const manifest: Manifest = Manifest.parse({
    schemaVersion: 1,
    build: buildId,
    locale,
    generatedAt: new Date().toISOString(),
    hotfixesApplied: hotfixes,
    source: "Cliente WoW Forever beta (solo lectura) via wow.tools.local; ver docs/EXTRACTION.md",
    classes: entries,
    legacy: {
      file: "legacy.json",
      sha256: sha256(legacyText),
      talentCount: legacy.specs.reduce((s, sp) => s + sp.talents.length, 0),
      unplacedEntries: unassigned.orphanEntries.filter((e) => e.isLegacy && !e.legacyPlaced).length,
    },
    abilities: abilityEntries,
    combatFormulas: formulasEntry,
    clientStats: { file: "client-stats.json", sha256: sha256(clientStatsText) },
    items: itemsEntry,
    equipRules: equipEntry,
    combatRatings: ratingsEntry,
    enchants: enchantsEntry,
    itemSources: sourcesEntry,
    buffs: buffsEntry,
    randomSuffixes: suffixesEntry,
    english: englishEntry,
    rules: ruleEntries,
    stats: { file: "stats.json", sha256: sha256(statsText), comboCount: stats.combos.length, missingCount: stats.missing.length },
    races: { file: "races.json", sha256: sha256(racesText), raceCount: races.races.length },
    icons: { file: "icons.json", count: iconIds.size, sha256: sha256(iconsText) },
    unassigned: {
      file: "unassigned.json",
      sha256: sha256(unassignedText),
      orphanEntries: unassigned.orphanEntries.length,
      alternativeTrees: unassigned.alternativeTrees.length,
    },
    unresolvedTrees: unresolved,
    inputs: raw.inputs(),
  });
  writeFileSync(join(outDir, "manifest.json"), stableJson(manifest));

  for (const e of entries) {
    console.log(`${(e.className ?? "?").padEnd(10)} arbol ${e.traitTreeId}  ${String(e.talentCount).padStart(3)} talentos  ${e.inactiveCount} no activos  avisos: ${e.warnings}`);
  }
  for (const u of unresolved) console.log(`SIN CLASE  arbol ${u.traitTreeId}  ${u.nodeCount} nodos  (${u.reason})`);
  console.log(`\nLegacy: ${manifest.legacy.talentCount} ventajas en ${legacy.specs.length} arboles, ${legacy.rules.maxPoints} puntos, ${manifest.legacy.unplacedEntries} sin colocar (legacy.json)`);
  console.log(`Sin asignar: ${unassigned.orphanEntries.length} entradas sin nodo (${unassigned.orphanEntries.filter((e) => !e.isLegacy).length} no Legacy, ${unassigned.orphanEntries.filter((e) => e.isLegacy && e.legacyPlaced).length} duplicados de ventajas colocadas) y ${unassigned.alternativeTrees.length} arboles descartados (unassigned.json)`);
  for (const a of abilityEntries) console.log(`Habilidades clase ${a.classId}: ${a.abilityCount} habilidades, ${a.rankCount} rangos (${a.file})`);
  console.log(`Razas: ${races.races.length} (${races.races.map((r) => r.name).join(", ")}), ${races.warnings.length} avisos (races.json)`);
  if (itemsData) console.log(`Objetos (items.json): ${itemsData.items.length} equipables con datos, ${itemsData.items.filter((i) => i.placeholder).length} de prueba/retirados, ${itemsData.unavailable.length} sin ItemSparse en el cliente`);
  console.log(`Estadisticas del cliente (client-stats.json): ${clientStats.classes.length} clases x ${clientStats.maxLevel} niveles (critico por atributo, mana base, poder de ataque)`);
  console.log(`Estadisticas base (Classic Era): ${stats.combos.filter((c) => c.provenance === "community").length} combinaciones exactas, ${stats.combos.filter((c) => c.provenance === "assumption").length} estimadas, ${stats.missing.length} sin datos (stats.json)`);
  for (const w of stats.warnings) console.log(`   aviso: ${w}`);
  for (const w of races.warnings) console.log(`   aviso: ${w}`);
  console.log(`Escrito en ${outDir}`);
}

function contrast(): void {
  const buildId = arg("build", DEFAULT_BUILD);
  const dataDir = resolve(arg("data", sourceDirs(buildId).outDir));
  const tfDir = resolve(arg("tf", join(repoRoot, "data", "external", "talentsforever")));
  const manifest = Manifest.parse(JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8")));
  let allOk = true;
  for (const e of manifest.classes) {
    const cls = ClassTalents.parse(JSON.parse(readFileSync(join(dataDir, e.file), "utf8")));
    const r = contrastClass(cls, tfDir);
    if (!r) {
      console.log(`${e.className}: sin export de la referencia en ${tfDir}`);
      continue;
    }
    allOk &&= r.ok;
    console.log(`${r.ok ? "OK " : "DIF"} ${(r.className ?? "?").padEnd(10)} cliente ${r.totals.ours} vs web ${r.totals.theirs}`);
    for (const s of r.specs) {
      const bad = s.maxRankMismatches.length + s.positionOnlyOurs.length + s.positionOnlyTheirs.length;
      if (s.ours !== s.theirs || bad > 0) {
        console.log(`   spec ${s.index} (${s.theirsName}): ${s.ours} vs ${s.theirs}`);
        for (const m of s.maxRankMismatches) console.log(`     rango  ${m}`);
        for (const p of s.positionOnlyOurs) console.log(`     solo cliente: ${p}`);
        for (const p of s.positionOnlyTheirs) console.log(`     solo web:     ${p}`);
      }
    }
  }
  // Habilidades: lo que la referencia no lista se conserva y se cuenta aparte (no es un fallo: el cliente manda)
  for (const e of manifest.abilities) {
    const ab = Abilities.parse(JSON.parse(readFileSync(join(dataDir, e.file), "utf8")));
    const by = (st: string) => ab.abilities.filter((a) => a.talentsForever?.status === st);
    if (!ab.abilities.some((a) => a.talentsForever)) continue;
    console.log(`
Habilidades ${e.file.replace(/^abilities\//, "").replace(/\.json$/, "")}: ${by("listed").length} en la referencia, ${by("partial").length} parciales, ${by("not-listed").length} que la referencia no lista, ${by("retired").length} retiradas`);
    for (const a of [...by("partial"), ...by("retired"), ...by("not-listed")]) console.log(`   ${a.talentsForever!.status.padEnd(10)} ${a.name}: ${a.talentsForever!.note}`);
  }
  if (existsSync(join(dataDir, "legacy.json"))) {
    const lc = contrastLegacy(ClassTalents.parse(JSON.parse(readFileSync(join(dataDir, "legacy.json"), "utf8"))), tfDir);
    if (lc) {
      console.log(`
${lc.diffs.length ? "DIF" : "OK "} Legacy: ${lc.matchedPositions} de ${lc.perks} ventajas de la referencia en su posición (la referencia dice venir de: ${lc.tfSource})`);
      for (const d of lc.diffs) console.log(`   ${d}`);
    }
  }
  if (existsSync(join(dataDir, "unassigned.json"))) {
    const un = JSON.parse(readFileSync(join(dataDir, "unassigned.json"), "utf8")) as { orphanEntries: { name: string | null; descriptions: string[] }[] };
    const oc = contrastOrphans(un.orphanEntries, tfDir);
    if (oc) {
      console.log(`
Entradas de talento sin nodo del cliente: ${oc.total}; ${oc.withTfTwin} con una gemela en la referencia (mismas cifras) y ${oc.withoutTfTwin.length} que la referencia no lista:`);
      for (const o of oc.withoutTfTwin) console.log(`   ${o.name}${o.numbers ? ` (${o.numbers})` : ""}`);
    }
  }
  const races = Races.parse(JSON.parse(readFileSync(join(dataDir, manifest.races.file), "utf8")));
  const rc = contrastRaces(
    races,
    manifest.classes.map((e) => ({ classId: e.classId, className: e.className ?? "?", token: e.file.replace(/^classes\//, "").replace(/\.json$/, "") })),
    tfDir,
  );
  if (rc) {
    allOk &&= rc.ok;
    console.log(`\n${rc.ok ? "OK " : "DIF"} razas: matriz raza/clase y numero de raciales vs la referencia`);
    for (const c of rc.classes) if (c.onlyClient.length || c.onlyWeb.length) console.log(`   ${c.className}: solo cliente [${c.onlyClient}] solo web [${c.onlyWeb}]`);
    for (const m of rc.racialCountMismatches) console.log(`   raciales ${m}`);
  }
  console.log(allOk ? "\nTodo coincide con la referencia." : "\nHay diferencias (el cliente manda; revisar a mano).");
}

const cmd = process.argv[2];
if (cmd === "build") build();
else if (cmd === "contrast") contrast();
else {
  console.error("Uso: tsx src/cli.ts build|contrast [--build X] [--raw dir] [--out dir] [--tf dir]");
  process.exit(1);
}
