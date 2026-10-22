import { z } from "zod";

/** De donde sale un dato. Se propaga a la UI como indicador de confianza. */
export const Provenance = z.enum(["client-db2", "community", "beta-measured", "assumption"]);
export type Provenance = z.infer<typeof Provenance>;

export const Prerequisite = z.object({
  /** Nodo que hay que tener antes. */
  nodeId: z.number().int(),
  /** TraitEdge.Type del cliente. 2 = conexion de rango (en Classic: rango maximo del prerrequisito). */
  edgeType: z.number().int(),
});

export const EffectPoints = z.object({
  effectIndex: z.number().int(),
  operationType: z.number().int(),
  /** Curva que da el valor segun el rango (tabla Curve/CurvePoint, aun sin exportar). */
  curveId: z.number().int(),
});

/** Estructura de un efecto de aura de un talento: que hace y a que habilidades afecta (valor por rango en `rankValues`). */
export const EffectInfo = z.object({
  /** Indice del efecto en el hechizo (columna de `rankValues`). */
  index: z.number().int(),
  /** SpellEffect.EffectAura (107 modificador plano, 108 modificador porcentual, 290 critico...). */
  aura: z.number().int(),
  /** EffectMiscValue[0]: en 107/108 es la operacion (0 dano, 7 critico, 10 tiempo de lanzamiento, 11 enfriamiento, 14 coste...). */
  miscValue: z.number().int(),
  /** EffectMiscValue[1]: en el aura 137 (atributo en %) es la mascara de atributos (1 fuerza, 2 agilidad, 4 aguante, 8 intelecto, 16 espiritu, 31 todos); [0] no es fiable ahi. */
  miscValueB: z.number().int().default(0),
  /** EffectSpellClassMask[0..3]: habilidades a las que afecta (se cruza con la mascara de cada rango). Todo ceros = a todas. */
  classMask: z.array(z.number().int()),
});
export type EffectInfo = z.infer<typeof EffectInfo>;

/**
 * Requisito de objeto equipado de un hechizo (SpellEquippedItems): hay que llevar un objeto de esa clase (2 arma, 4 armadura) cuyo subtipo
 * (bit `1 << subclase`) y tipo de ranura (bit `1 << tipo de inventario`) estén en las máscaras; 0 = cualquiera. Un hechizo con varias filas
 * se cumple con que se cumpla una. Procedencia client-db2.
 */
export const EquippedRequirement = z.object({
  itemClass: z.number().int(),
  invTypeMask: z.number().int(),
  subclassMask: z.number().int(),
});
export type EquippedRequirement = z.infer<typeof EquippedRequirement>;

/** Texto del talento por rango, resuelto a partir de la descripcion del hechizo del cliente. */
const TextFields = {
  /** Objetos que hay que llevar equipados para que valga el hechizo (armas de dos manos, varitas, escudo...); vacío = sin requisito. */
  equipped: z.array(EquippedRequirement).default([]),
  /** Efectos de aura del hechizo del talento (para el motor: a que habilidades modifica). */
  effectInfo: z.array(EffectInfo).default([]),
  /** De donde sale el texto: del cliente en espanol, una traduccion propia (el cliente aun lo trae en ingles) o ingles sin traducir. */
  textOrigin: z.enum(["client", "translated-by-us", "untranslated"]).default("client"),
  /** true = el hechizo del talento es pasivo (sus efectos valen siempre). false = es una habilidad activa: sus auras solo valen mientras esta activa. */
  passive: z.boolean().default(true),
  /** FileDataID del icono (SpellMisc.SpellIconFileDataID); la web lo sirve como icons/<id>.png. */
  iconFileDataId: z.number().int().nullable(),
  /** Una descripcion por rango (longitud = maxRank), con los marcadores $s1, $d... ya sustituidos. */
  descriptions: z.array(z.string()),
  /**
   * Valores numericos (con signo) de cada efecto del hechizo en cada rango: `rankValues[rango-1][indiceEfecto]`.
   * Son los valores base del cliente (con la curva del rango), sin escalado por nivel: la base del motor de calculo.
   */
  rankValues: z.array(z.array(z.number().nullable())),
  /**
   * false si algun marcador no se pudo calcular (p. ej. $w1, que depende del poder de ataque); ese
   * marcador queda tal cual en el texto. El resto de numeros salen del cliente.
   */
  descriptionsComplete: z.boolean(),
  /**
   * true si algun numero depende del nivel del personaje (puntos por nivel o variacion del efecto):
   * el texto lleva el valor base del cliente, no el que se veria en el juego a un nivel concreto.
   */
  descriptionsApproximate: z.boolean(),
};

export const Talent = z.object({
  nodeId: z.number().int(),
  spellId: z.number().int(),
  /** Nombre del hechizo en el idioma del cliente (SpellName.Name_lang). */
  name: z.string().nullable(),
  ...TextFields,
  maxRank: z.number().int().min(1),
  /** 0 = arriba. */
  row: z.number().int().min(0),
  /** 0 = izquierda. */
  col: z.number().int().min(0),
  /** Puntos que hay que haber gastado (TraitCond). Es `gate.points`, o 0 si no hay requisito. */
  requiredPoints: z.number().int().min(0),
  /**
   * Requisito de puntos exacto del cliente: hay que haber gastado `points` entre los nodos `fromNodeIds`
   * (en las clases son las filas superiores de la especializacion; en Legacy, todo el arbol).
   */
  gate: z.object({ points: z.number().int(), fromNodeIds: z.array(z.number().int()) }).nullable(),
  prerequisites: z.array(Prerequisite),
  effectPoints: z.array(EffectPoints),
  /** Posicion cruda del cliente, para depurar. */
  raw: z.object({ posX: z.number().int(), posY: z.number().int() }),
});
export type Talent = z.infer<typeof Talent>;

/**
 * Nodo del arbol que el cliente trae pero que NO esta activo: sus coordenadas caen fuera de la rejilla
 * (restos eliminados u ocultos). Se conserva para poder observarlo: la UI debe mostrarlo siempre,
 * claramente marcado como "nodo no activo", y nunca permitir gastar puntos en el (selectable = false).
 */
export const InactiveTalent = z.object({
  nodeId: z.number().int(),
  spellId: z.number().int(),
  name: z.string().nullable(),
  ...TextFields,
  maxRank: z.number().int().min(1),
  /** Siempre false: el motor y la UI no deben permitir seleccionarlo. */
  selectable: z.literal(false),
  inactiveReason: z.enum(["off-grid"]),
  /** Especializacion mas cercana por su X, o null si la X es absurda (p. ej. 102800). Solo orientativo. */
  nearestSpecIndex: z.number().int().min(0).nullable(),
  requiredPoints: z.number().int().min(0),
  prerequisites: z.array(Prerequisite),
  effectPoints: z.array(EffectPoints),
  raw: z.object({ posX: z.number().int(), posY: z.number().int() }),
});
export type InactiveTalent = z.infer<typeof InactiveTalent>;

export const Spec = z.object({
  index: z.number().int().min(0),
  name: z.string().nullable(),
  /** Los nombres de especializacion no estan en los Trait del cliente: se toman de TalentTab (Classic). */
  nameProvenance: Provenance,
  /** Arbol del cliente de este bloque (util en Legacy, donde cada especializacion es un TraitTree). */
  traitTreeId: z.number().int().optional(),
  /** Icono de la especializacion (TalentTab.SpellIconID, un FileDataID) y nombre de su textura de fondo. */
  iconFileDataId: z.number().int().nullable().optional(),
  backgroundFile: z.string().nullable().optional(),
  talents: z.array(Talent),
});

export const ClassTalents = z.object({
  schemaVersion: z.literal(1),
  /**
   * "class" = arbol de talentos de una clase; "legacy" = ventajas de Legacy (de cuenta, 16 puntos, se suman
   * al personaje junto con los talentos de clase). Comparten forma para reutilizar el motor y la interfaz.
   */
  kind: z.enum(["class", "legacy"]).default("class"),
  build: z.string(),
  locale: z.string(),
  classId: z.number().int(),
  className: z.string().nullable(),
  classToken: z.string().nullable(),
  /** Icono de la clase (ChrClasses.IconFileDataID). */
  iconFileDataId: z.number().int().nullable().optional(),
  traitTreeId: z.number().int(),
  rules: z.object({
    /** TraitCurrency.SourcedMax de la moneda del arbol. */
    maxPoints: z.number().int(),
    maxPointsProvenance: Provenance,
    /** Los puntos por fila salen de TraitCond, no se asumen (ver test). */
    pointsPerRowDerived: z.number().int().nullable(),
    prerequisiteRule: z.enum(["max-rank-of-prerequisite"]),
    prerequisiteRuleProvenance: Provenance,
    firstPointLevel: z.number().int().nullable(),
    firstPointLevelProvenance: Provenance,
  }),
  specs: z.array(Spec),
  /** Nodos presentes en el cliente pero no activos: visibles, no seleccionables. */
  inactiveTalents: z.array(InactiveTalent),
  warnings: z.array(z.string()),
});
export type ClassTalents = z.infer<typeof ClassTalents>;

/**
 * Datos del cliente que no forman parte de un arbol de clase activo. Se conservan en una seccion aparte
 * (`unassigned.json`) para poder observarlos: la UI debe mostrarlos como "sin asignar", nunca seleccionables.
 */
const ClassGuess = {
  classId: z.number().int().nullable(),
  className: z.string().nullable(),
  /** Hechizos del elemento por clase (SpellClassOptions), de donde sale la clase. Vacio = sin clase. */
  classVote: z.record(z.string(), z.number().int()),
};

/** TraitNodeEntry que ningun TraitNode usa. */
export const UnassignedEntry = z.object({
  entryId: z.number().int(),
  definitionId: z.number().int(),
  /** null si la TraitDefinition no existe. */
  spellId: z.number().int().nullable(),
  name: z.string().nullable(),
  ...TextFields,
  maxRank: z.number().int(),
  ...ClassGuess,
  /** Probablemente una ventaja de Legacy sin colocar (ver unassigned.ts). La web la muestra en Legacy. */
  isLegacy: z.boolean(),
  /** Solo con isLegacy: su hechizo ya esta en un arbol de Legacy, asi que esta entrada es un duplicado/version antigua de una ventaja colocada. */
  legacyPlaced: z.boolean(),
  status: z.literal("unassigned"),
  /** No cuenta para el calculo; en la web se puede probar rango a rango gratis (prueba libre). */
  selectable: z.literal(false),
  reason: z.literal("entry-without-node"),
});
export type UnassignedEntry = z.infer<typeof UnassignedEntry>;

export const UnassignedTreeNode = z.object({
  nodeId: z.number().int(),
  entryId: z.number().int().nullable(),
  spellId: z.number().int().nullable(),
  name: z.string().nullable(),
  ...TextFields,
  maxRank: z.number().int().nullable(),
  /** Posicion en la rejilla del arbol descartado (columnas/filas comprimidas a partir de las coordenadas). */
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  requiredPoints: z.number().int().min(0),
  prerequisites: z.array(Prerequisite),
  posX: z.number().int(),
  posY: z.number().int(),
});

/** TraitTree que no se uso como arbol de clase (parcial, antiguo, casi vacio o de otro tipo). */
export const UnassignedTree = z.object({
  traitTreeId: z.number().int(),
  traitSystemId: z.number().int(),
  flags: z.number().int(),
  nodeCount: z.number().int(),
  ...ClassGuess,
  /** Por que no es el arbol activo de su clase. */
  reason: z.string(),
  status: z.literal("unassigned"),
  selectable: z.literal(false),
  nodes: z.array(UnassignedTreeNode),
});
export type UnassignedTree = z.infer<typeof UnassignedTree>;

export const Unassigned = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  locale: z.string(),
  orphanEntries: z.array(UnassignedEntry),
  alternativeTrees: z.array(UnassignedTree),
});
export type Unassigned = z.infer<typeof Unassigned>;

/**
 * Que significa un efecto de aura de una racial para el calculo. Solo se rellenan los que se han comprobado contra el
 * texto del propio cliente; el resto queda en null (se conserva el numero de aura y el valor, sin interpretar).
 */
export const RacialEffectKind = z.enum([
  "crit-chance", // % de probabilidad de critico con todo
  "spirit-pct", // % de espiritu
  "max-power-pct", // % del maximo de mana/ira/energia (miscValue = tipo de poder: 0 mana, 1 ira, 3 energia)
  "health-pct", // % de salud maxima
  "crit-damage-bonus", // % al bonus de dano critico
  "crit-healing-bonus", // % al bonus de sanacion critica
  "dodge-pct",
  "damage-vs-creature", // % de dano contra un tipo de criatura (miscValue = mascara: 1 bestias, 8 elementales)
  "attack-power-pct",
  "ranged-attack-power-pct",
  "spell-power-pct",
  "haste-spell-pct",
  "haste-melee-pct",
  "haste-ranged-pct",
  "haste-melee-ranged-pct",
  "health-regen-pct",
  "health-regen-combat-pct", // % de la regeneracion de salud que continua en combate
  "damage-taken-pct", // % de dano recibido (negativo = reduccion; miscValue = mascara de escuela)
  "stun-duration-pct",
  "mana-regen-pct", // % de regeneracion de mana
  "movement-speed-pct",
  "mounted-speed-pct",
  "periodic-health-pct", // % de la salud total recuperada en cada tick (ver periodMs)
  "periodic-mana-pct", // % del mana total recuperado en cada tick (ver periodMs)
  "proc-drain-health-pct", // al procar, drena hasta este % de tu salud maxima (probabilidad y enfriamiento en el hechizo)
  "spell-modifier-pct", // modificador de hechizos de la clase (miscValue: 0 dano/efecto, 14 coste, 22 dano periodico)
]);
export type RacialEffectKind = z.infer<typeof RacialEffectKind>;

export const RacialEffect = z.object({
  kind: RacialEffectKind.nullable(),
  /** SpellEffect.EffectAura del cliente. */
  aura: z.number().int(),
  /** Puntos base del efecto (con signo; para los `-pct`, el porcentaje). */
  value: z.number(),
  miscValue: z.number().int().nullable(),
  /** Efectos periodicos: milisegundos entre ticks. */
  periodMs: z.number().int().nullable(),
  /** Si el efecto vive en otro hechizo al que remite el texto (`$1259691s1`): su id. Estos efectos son condicionales (no cuentan como pasivas permanentes). */
  fromSpellId: z.number().int().nullable(),
});
export type RacialEffect = z.infer<typeof RacialEffect>;

/** Un hechizo de una racial (algunas tienen una variante por clase). Valores del cliente (`client-db2`). */
export const RacialSpell = z.object({
  spellId: z.number().int(),
  /** Mascara de clases a las que aplica (bit = ClassID-1); 0 = todas. */
  classMask: z.number().int(),
  durationMs: z.number().int().nullable(),
  cooldownMs: z.number().int().nullable(),
  /** Probabilidad (%) y enfriamiento interno (ms) si la racial es un proc (SpellAuraOptions); null si no. */
  procChance: z.number().int().nullable(),
  procCooldownMs: z.number().int().nullable(),
  effects: z.array(RacialEffect),
});
export type RacialSpell = z.infer<typeof RacialSpell>;

/**
 * Posible enfriamiento compartido de una racial activa con la insignia/abalorio de PvP. El cliente NO lo dice (las
 * insignias usan la categoria 2269 y ninguna racial la usa), asi que `status` siempre es "unconfirmed" y la procedencia
 * `assumption`: solo se marca que la racial quita el mismo tipo de control que la insignia (`overlaps`, mecanicas del
 * cliente). Cuando se mida en el juego pasara a "shared" / "independent" con los segundos.
 */
export const RacialTrinketShare = z.object({
  status: z.literal("unconfirmed"),
  provenance: z.literal("assumption"),
  /** Control que quita la racial y tambien la insignia (mecanicas de SpellEffect), en espanol. */
  overlaps: z.array(z.string()),
  /** Enfriamiento de la insignia de PvP clasica (ms), del cliente. */
  trinketCooldownMs: z.number().int(),
});
export type RacialTrinketShare = z.infer<typeof RacialTrinketShare>;

/** Habilidad racial tal como la lista el cliente (`ChrRaceRacialAbility`) y sus hechizos con los numeros. */
export const RacialAbility = z.object({
  name: z.string(),
  /** Activa (se pulsa) o pasiva; sale del texto "Raza - Activa|Pasiva - Nombre" del cliente. */
  kind: z.enum(["active", "passive"]),
  description: z.string(),
  iconFileDataId: z.number().int().nullable(),
  order: z.number().int(),
  /** De donde sale el texto de la racial (ver Talent.textOrigin). */
  textOrigin: z.enum(["client", "translated-by-us", "untranslated"]).default("client"),
  /** Hechizos del cliente de esta racial (vacio si no se ha podido enlazar). */
  spells: z.array(RacialSpell),
  /** Solo en raciales activas que quitan el mismo control que la insignia de PvP; null en el resto. */
  pvpTrinket: RacialTrinketShare.nullable().default(null),
});
export type RacialAbility = z.infer<typeof RacialAbility>;

export const Race = z.object({
  /** ChrRaces.ID del cliente (Cielonato = 95 Alianza, 96 Horda). */
  id: z.number().int(),
  /** ChrRaces.ClientFileString (Human, NightElf, Scourge, Skyborne...). */
  token: z.string(),
  name: z.string(),
  nameFemale: z.string().nullable(),
  faction: z.enum(["alliance", "horde"]),
  /** ChrClasses.ID de las clases que la raza puede ser (`CharBaseInfo`, el cliente). */
  classIds: z.array(z.number().int()),
  /** SkillLine del cliente que da las raciales de la raza (SkillLineAbility): demuestra que los hechizos son suyos. */
  racialSkillLineId: z.number().int().nullable(),
  racials: z.array(RacialAbility),
});
export type Race = z.infer<typeof Race>;

export const Races = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  locale: z.string(),
  /** Las razas jugables de Forever: las que tienen filas en `CharBaseInfo` (el resto de `ChrRaces` es retail). */
  playableProvenance: Provenance,
  races: z.array(Race),
  warnings: z.array(z.string()),
});
export type Races = z.infer<typeof Races>;

/**
 * Estadisticas base por raza, clase y nivel. El cliente de Forever NO las trae (en Classic viven en el servidor):
 * la base de la clase sale de Classic Era 1.12 (`community`), las diferencias de raza son las del juego original (Cielonato,
 * medida en la beta) segun La comunidad (`raceOffsets`, `community`) y las combinaciones nuevas de Forever se estiman (`assumption`).
 */
export const BaseStats = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  source: z.object({ name: z.string(), url: z.string(), commit: z.string(), license: z.string() }),
  /**
   * Diferencia de atributos de cada raza respecto al Humano en Forever (medida por un tercero en la beta, `community`).
   * Las filas de `combos` son la base de la clase (Classic, como Humano sin racial) mas este desplazamiento.
   */
  raceOffsets: z.object({
    source: z.object({ name: z.string(), url: z.string(), commit: z.string(), date: z.string(), license: z.string() }),
    provenance: Provenance,
    note: z.string(),
    /** `delta` = [fue, agi, aguante, int, esp] respecto al Humano. */
    offsets: z.array(z.object({ raceId: z.number().int(), delta: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]) })),
  }),
  /** Orden de cada fila de `stats`: fuerza, agilidad, aguante, intelecto, espiritu. */
  statNames: z.array(z.string()),
  /** Niveles cubiertos (1..maxLevel). La beta de Forever solo llega al nivel `betaMaxLevel` (dato del usuario). */
  maxLevel: z.number().int(),
  betaMaxLevel: z.number().int(),
  /** Vida y mana base por clase y nivel (`hp[nivel-1]`), antes de aguante e intelecto. */
  classBase: z.array(z.object({ classId: z.number().int(), hp: z.array(z.number().int()), mana: z.array(z.number().int()) })),
  combos: z.array(
    z.object({
      raceId: z.number().int(),
      classId: z.number().int(),
      /** community = fila de Classic Era tal cual; assumption = combinacion nueva de Forever, estimada (ver derivedFrom). */
      provenance: Provenance,
      /** Con assumption: raza de Classic cuya clase se usa como base (mas la diferencia racial media). */
      derivedFromRaceId: z.number().int().nullable(),
      /** Aviso sobre la estimacion (p. ej. el intelecto del Gnomo), para mostrarlo tal cual. */
      note: z.string().nullable(),
      /** `stats[nivel-1]` = [fue, agi, aguante, int, esp]. */
      stats: z.array(z.array(z.number().int())),
    }),
  ),
  /**
   * Valores de la fuente (Classic) que no encajan con las demas razas de la misma clase. corrected = se corrigio
   * (intercambio inequivoco de intelecto/espiritu); si no, se conserva el valor de la fuente y solo se avisa.
   */
  anomalies: z.array(
    z.object({
      raceId: z.number().int(),
      classId: z.number().int(),
      level: z.number().int(),
      stat: z.enum(["str", "agi", "sta", "int", "spi"]),
      value: z.number().int(),
      expected: z.number(),
      corrected: z.boolean(),
    }),
  ),
  /** Combinaciones de Forever sin ningun dato (Cielonato). */
  missing: z.array(z.object({ raceId: z.number().int(), classId: z.number().int() })),
  warnings: z.array(z.string()),
});
export type BaseStats = z.infer<typeof BaseStats>;

/** Efecto de una habilidad con sus numeros del cliente (SpellEffect). */
export const AbilityEffect = z.object({
  index: z.number().int(),
  /** SpellEffect.Effect (2 dano de escuela, 10 sanar, 6 aplicar aura...). */
  effect: z.number().int(),
  aura: z.number().int(),
  kind: z.enum(["direct-damage", "direct-heal", "periodic-damage", "periodic-heal", "absorb", "other"]),
  /** Puntos base (EffectBasePointsF) al nivel base del rango. */
  base: z.number(),
  /** Puntos extra por nivel del personaje por encima del nivel base del rango (EffectRealPointsPerLevel). */
  perLevel: z.number(),
  /** Variacion relativa: el valor va de base*(1 - variance/2) a base*(1 + variance/2). */
  variance: z.number(),
  /** Fraccion del poder con hechizos que se suma (0,429 = 42,9 %); null si no escala. */
  coefficient: z.number().nullable(),
  periodMs: z.number().int().nullable(),
  miscValue: z.number().int().nullable(),
  /** Si el efecto vive en un hechizo disparado (p. ej. cada misil de Misiles Arcanos): su id. */
  viaSpellId: z.number().int().nullable(),
  /**
   * Niveles propios del hechizo disparado (SpellLevels): base desde el que suben los puntos por nivel y nivel maximo hasta el que
   * suben (en los hechizos nuevos de Forever suele ser base + 5). null = los del rango (hechizo propio).
   */
  levels: z.object({ base: z.number().int(), max: z.number().int().nullable() }).nullable().default(null),
  /**
   * Polinomio del nivel [a, b, c] de las variables de Forever ($damagepower, $healpower, $power): el valor del efecto es
   * base x (a + b x nivel + c x nivel^2) / 100 (la base es un porcentaje). null = los puntos del efecto son directos.
   */
  levelPoly: z.tuple([z.number(), z.number(), z.number()]).nullable().default(null),
  /**
   * Mascara de clase (SpellClassOptions) del hechizo que lleva el efecto, solo si es disparado o citado (`viaSpellId`) y la tiene.
   * Los talentos modifican el hechizo que de verdad hace el dano (el veneno, no la habilidad que lo aplica), asi que se cruzan con esta.
   */
  classMask: z.array(z.number().int()).nullable().default(null),
  /** Duracion (ms) del hechizo disparado o citado: el total de un efecto periodico lo usa en vez de la del rango (Lanzarse: aturde 2 s, sangra 18 s). */
  durationMs: z.number().int().nullable().default(null),
});
export type AbilityEffect = z.infer<typeof AbilityEffect>;

/** Probabilidad de activacion (proc) que cita el texto con `$NNNh%`: vive en SpellAuraOptions.ProcChance de un hechizo oculto (el del arma envenenada...). */
export const AbilityProc = z.object({
  spellId: z.number().int(),
  /** Probabilidad base en % (20 = «20 % de probabilidad»). */
  chance: z.number(),
  /** Mascara de clase del hechizo que la lleva: los talentos con «probabilidad de exito» (operacion 18) se cruzan con ella. */
  classMask: z.array(z.number().int()),
});
export type AbilityProc = z.infer<typeof AbilityProc>;

export const AbilityRank = z.object({
  /** 1..N por orden de nivel. */
  rank: z.number().int(),
  spellId: z.number().int(),
  /** Nivel al que se aprende (SpellLevels.BaseLevel o SpellLevel; las de talento: 10 + puntos que exige su fila). */
  level: z.number().int(),
  /** true = la habilidad la ensena un talento (no se aprende en el entrenador). */
  learnedByTalent: z.boolean().default(false),
  /** Nivel hasta el que escalan los puntos por nivel (SpellLevels.MaxLevel). */
  maxLevel: z.number().int().nullable(),
  costType: z.enum(["mana", "rage", "energy", "focus", "other"]).nullable(),
  cost: z.number().nullable(),
  /** Coste como % del maná base (p. ej. Explosión Arcana: 15). */
  costPctOfBase: z.number().nullable(),
  /** Tiempo de lanzamiento en ms; 0 = instantaneo (o canalizado, ver channeled). */
  castMs: z.number().int(),
  channeled: z.boolean(),
  durationMs: z.number().int().nullable(),
  cooldownMs: z.number().int().nullable(),
  rangeYd: z.number().nullable(),
  schoolMask: z.number().int(),
  /** SpellClassOptions.SpellClassMask[0..3]: que modificadores de talentos le afectan. */
  classMask: z.array(z.number().int()),
  effects: z.array(AbilityEffect),
  /** Radio maximo (m) de los efectos de area de la habilidad o de sus hechizos disparados (SpellRadius); null si no es de area. Los talentos lo modifican (operacion 6). */
  radiusYd: z.number().nullable().default(null),
  /** Cargas que cita el texto (`$n`, SpellAuraOptions.ProcCharges): los talentos con «cargas» (operacion 4) las modifican. */
  charges: z.array(z.object({ spellId: z.number().int(), charges: z.number() })).default([]),
  /** Probabilidades de activacion que cita el texto (`$NNNh%`), cada una con la mascara de su hechizo: los talentos las modifican (operacion 18). */
  procs: z.array(AbilityProc).default([]),
  /** Descripcion del cliente con los valores base del rango. */
  description: z.string(),
  /** Origen del texto: client | translated-by-us (el cliente lo trae en ingles: traduccion propia de data/i18n) | untranslated. */
  textOrigin: z.enum(["client", "translated-by-us", "untranslated"]).default("client"),
  /** SkillLineAbility.AcquireMethod: 0 se aprende (entrenador), 2 viene con la clase, 3 habilidad de runa de Forever; null = la ensena un talento. */
  acquireMethod: z.number().int().nullable().default(null),
  /** false si el texto lleva marcadores que no se pudieron calcular (expresiones nuevas de Forever como `${$123m1*$d}`). */
  descriptionComplete: z.boolean(),
  /**
   * La descripcion con huecos `{{tipo:hechizo:indice|valorBase}}` (tipo s/m valor del efecto, o total periodico,
   * d duracion, a radio, t periodo) para recalcularla con el nivel y los talentos.
   */
  descriptionTemplate: z.string().default(""),
  /** Objetos que hay que llevar equipados para lanzarla (una daga para Mutilar, un arma cuerpo a cuerpo...); vacío = sin requisito. */
  equipped: z.array(EquippedRequirement).default([]),
  /**
   * Con que arma(s) golpea una habilidad de daño de arma: la mano derecha (por defecto), solo la izquierda (Puyazo, Latigazo de lava: el atributo
   * «requiere arma en la mano izquierda» del cliente o su texto) o las dos (el texto dice «con ambas armas»: Mutilar, Huracán). client-db2.
   */
  weaponHand: z.enum(["main", "off", "both"]).default("main"),
});
export type AbilityRank = z.infer<typeof AbilityRank>;

/**
 * Contraste de la habilidad con el export de la referencia (la referencia, solo contraste): `listed` = todos sus rangos estan en
 * su libro de hechizos (mismo id de hechizo), `partial` = solo algunos, `not-listed` = la referencia no la lista (runas de Forever,
 * habilidades auxiliares... solo hay cifras del cliente), `retired` = la referencia la da por retirada (`spellbook.gone`).
 */
export const AbilityContrast = z.object({
  status: z.enum(["listed", "partial", "not-listed", "retired"]),
  /** Rangos que la referencia lista de los que tiene la habilidad (id de hechizo). */
  listedRanks: z.number().int(),
  note: z.string().nullable(),
});
export type AbilityContrast = z.infer<typeof AbilityContrast>;

export const Ability = z.object({
  name: z.string(),
  iconFileDataId: z.number().int().nullable(),
  ranks: z.array(AbilityRank),
  /** null = sin export de la referencia para la clase. */
  talentsForever: AbilityContrast.nullable().default(null),
});
export type Ability = z.infer<typeof Ability>;

/** Habilidades de una clase (libro de hechizos del cliente). Procedencia client-db2. */
export const Abilities = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  locale: z.string(),
  classId: z.number().int(),
  /** SpellClassOptions.SpellClassSet de la clase (familia de hechizos). */
  familySet: z.number().int(),
  abilities: z.array(Ability),
  warnings: z.array(z.string()),
});
export type Abilities = z.infer<typeof Abilities>;

/** A que hechizos afecta una regla de talento. */
export const RuleScope = z.object({
  /** A todos los hechizos (con damagingOnly: a todos los que hacen dano). */
  all: z.boolean().optional(),
  /** Bits de escuela de SpellMisc.SchoolMask: 1 fisico, 2 Sagrado, 4 Fuego, 8 Naturaleza, 16 Escarcha, 32 Sombras, 64 Arcano. */
  schools: z.array(z.number().int()).optional(),
  /** Nombres de habilidad del cliente. */
  spells: z.array(z.string()).optional(),
  damagingOnly: z.boolean().optional(),
});
export type RuleScope = z.infer<typeof RuleScope>;

export const RuleEffect = z.object({
  /** Efecto del hechizo del talento cuyo valor por rango es {v} (columna de rankValues). */
  index: z.number().int(),
  /** Multiplicador del valor del cliente (0,5 = la mitad; -1 = cambio de signo; 0,001 = ms a s). */
  factor: z.number().default(1),
  /** Otras cifras de la plantilla: {w}, {x}... -> indice de efecto. */
  extras: z.record(z.object({ index: z.number().int(), factor: z.number().default(1) })).default({}),
  /** Texto en espanol con {v} (y los extras). */
  label: z.string(),
  scope: RuleScope,
  /** none = solo informa; mana-return-pct-of-cost = {v} % del coste base de mana de la habilidad. */
  action: z.enum(["none", "mana-return-pct-of-cost"]).default("none"),
  unit: z.enum(["%", "s", "puntos"]).default("%"),
});
export type RuleEffect = z.infer<typeof RuleEffect>;

export const TalentRule = z.object({
  spellId: z.number().int(),
  /** Nombre del talento (lo rellena el pipeline). */
  name: z.string().nullable().default(null),
  effects: z.array(RuleEffect),
});
export type TalentRule = z.infer<typeof TalentRule>;

/** Reglas de talentos clasificadas a mano para una clase (procedencia assumption: la cifra es del cliente, la clasificacion nuestra). */
export const TalentRules = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  classId: z.number().int(),
  provenance: Provenance,
  rules: z.array(TalentRule),
  warnings: z.array(z.string()),
});
export type TalentRules = z.infer<typeof TalentRules>;

/**
 * Estadisticas por clase y nivel que el cliente de Forever SI trae (client-db2): `PlayerExpectedStat` (critico por punto de agilidad
 * y de intelecto, mana base, vida por aguante) y `ChrClasses` (poder de ataque por fuerza y agilidad). Sustituyen a las estimaciones de
 * Classic para el critico y el mana base. Comprobado contra ForeverDB (nivel 30) y Warcraft Tavern (nivel 60).
 */
export const ClassStatLevel = z.object({
  level: z.number().int(),
  /** Mana base de la clase a ese nivel, antes del intelecto. */
  baseMana: z.number(),
  /** Vida por punto de aguante (el cliente trae 10; los 20 primeros puntos dan 1 cada uno en el juego). */
  hpPerStamina: z.number(),
  /** Fraccion de probabilidad de critico por punto de agilidad (0,0025 = 0,25 % por punto). 0 = la clase no la usa. */
  critPerAgility: z.number(),
  /** Fraccion de probabilidad de critico de hechizo por punto de intelecto. */
  spellCritPerIntellect: z.number(),
});
export const ClassStats = z.object({
  classId: z.number().int(),
  attackPowerPerStrength: z.number(),
  attackPowerPerAgility: z.number(),
  rangedAttackPowerPerAgility: z.number(),
  levels: z.array(ClassStatLevel),
});
export const ClientStats = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  maxLevel: z.number().int(),
  classes: z.array(ClassStats),
});
export type ClassStatLevel = z.infer<typeof ClassStatLevel>;
export type ClassStats = z.infer<typeof ClassStats>;
export type ClientStats = z.infer<typeof ClientStats>;

/** Formulas de combate de Classic Era (estimacion, confianza baja): el cliente de Forever no trae estas tablas. */
/** Tablas de fallo y tope de impacto (estimacion de Classic, `community`). El critico por atributo ya NO esta aqui: sale del cliente (ClassStats). */
export const CombatFormulas = z.object({
  provenance: Provenance,
  confidence: z.enum(["low", "medium", "high"]),
  /** % de fallo contra un objetivo del mismo nivel ("same") o un jefe (+3 niveles, "boss"). */
  miss: z.object({ spell: z.object({ same: z.number(), boss: z.number() }), melee: z.object({ same: z.number(), boss: z.number() }) }),
  /** Tope de probabilidad de impacto (%). En Forever no hay 1 % minimo de fallo: 100. */
  hitCap: z.object({ spell: z.number(), melee: z.number() }),
  /** Penalizacion de fallo (puntos) de los ataques automaticos con dos armas. */
  dualWieldMissPenalty: z.number(),
  /** Critico (puntos) que pierde un ataque contra un jefe (+3 niveles): fisico = habilidad de arma + critico de auras hasta un tope; hechizos, ninguno. */
  critSuppression: z.object({ meleeBossSkill: z.number(), meleeBossAuraMax: z.number(), spellBoss: z.number() }),
  /** Multiplicador de un golpe critico (1,5 = +50 % de daño): hechizos y fisico. */
  critMultiplier: z.object({ spell: z.number(), physical: z.number() }),
  /** Poder de ataque por punto de daño por segundo del arma (golpe de arma = arma + velocidad x PA / este valor). */
  attackPowerPerDps: z.number(),
  /** Fraccion del daño que hace el arma de la mano izquierda (Classic: 0,5). Confirmada por el usuario (22/10/2026); los golpes con las dos armas la usan, con el bono de «daño del arma de la mano izquierda» de los talentos por encima. */
  offHandDamageFactor: z.number().default(0.5),
  /** Armadura por punto de agilidad. */
  armorPerAgility: z.number(),
  /** Mana cada 5 s por espiritu sin lanzar hechizos (regla del cuadro de los 5 segundos): base + espiritu x factor, redondeado hacia abajo. */
  spiritManaRegen: z.object({ per5sBase: z.number(), per5sPerSpirit: z.number() }),
  /** Valores base por clase que el cliente no trae: critico, esquive y poder de ataque base. */
  classBase: z.array(
    z.object({
      classId: z.number().int(),
      /** Critico con hechizos base de la clase (puntos porcentuales, antes del intelecto). */
      spellCritPct: z.number(),
      /** Critico fisico base de la clase (puntos porcentuales, antes de la agilidad). */
      physicalCritPct: z.number(),
      /** Esquive base de la clase (puntos porcentuales, antes de la agilidad). */
      dodgePct: z.number(),
      /** Esquive por agilidad = critico por agilidad del cliente x este factor (pícaro y cazador el doble). */
      dodgePerAgilityFactor: z.number(),
      /** Poder de ataque base = nivel x perLevel + flat (comprobado a nivel 60; en otros niveles es la formula de Classic). */
      attackPower: z.object({ perLevel: z.number(), flat: z.number() }),
      rangedAttackPower: z.object({ perLevel: z.number(), flat: z.number() }).nullable(),
    }),
  ),
});
export type CombatFormulas = z.infer<typeof CombatFormulas>;

/** Una estadistica de un objeto. `key` es null cuando el tipo del cliente aun no se ha interpretado (se conserva el numero). */
export const ItemStat = z.object({
  /** ItemSparse.StatModifier_bonusStat (ITEM_MOD_*). */
  type: z.number().int(),
  key: z.string().nullable(),
  value: z.number(),
  /** Solo si la cifra no sale del cliente (p. ej. el valor de bloqueo de los escudos, que el cliente no trae): su origen. */
  source: z.literal("community").optional(),
});
export const ItemWeapon = z.object({
  min: z.number(),
  max: z.number(),
  /** Velocidad en segundos. */
  speed: z.number(),
  dps: z.number(),
  /** Tabla ItemDamage* de la que sale (a distancia = 0,6 x la de dos manos, medido). */
  table: z.enum(["one-hand", "two-hand", "ranged", "wand", "thrown"]),
  /** verified = contrastado con lecturas del juego; estimated = la tabla no reproduce las lecturas. */
  confidence: z.enum(["verified", "estimated"]),
});
/** Efecto de aura de un hechizo de objeto o de bono de conjunto, con su valor base (para cuantificar lo que suma). */
export const ItemSpellAura = EffectInfo.extend({
  /** SpellEffect.EffectBasePointsF (con signo); algunos escalan con el nivel del personaje (`levelScaled`). */
  value: z.number(),
  levelScaled: z.boolean().default(false),
});
export type ItemSpellAura = z.infer<typeof ItemSpellAura>;
export const ItemEffectRef = z.object({
  /** Efectos de aura del hechizo (vacio si no tiene). */
  auras: z.array(ItemSpellAura).default([]),
  spellId: z.number().int(),
  /** ItemEffect.TriggerType: 0 uso, 1 equipar, 2 probabilidad al golpear, 6 aprender... */
  trigger: z.number().int(),
  /** Nombre y texto del hechizo (esES del cliente, cifras al nivel base); vacios si el hechizo no tiene descripcion. */
  name: z.string(),
  text: z.string(),
  /** false si algun valor del texto no se pudo calcular. */
  textComplete: z.boolean(),
});
/** Conjunto de objetos con sus bonos (ItemSet + ItemSetSpell): cada bono es un hechizo que se activa con N piezas. */
export const ItemSetDef = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Habilidad de profesion que exige (0 = ninguna) y su rango. */
  requiredSkill: z.number().int(),
  requiredSkillRank: z.number().int(),
  itemIds: z.array(z.number().int()),
  bonuses: z.array(z.object({ threshold: z.number().int(), spellId: z.number().int(), name: z.string(), text: z.string(), textComplete: z.boolean(), specId: z.number().int().nullable(), auras: z.array(ItemSpellAura).default([]) })),
});
export const Item = z.object({
  id: z.number().int(),
  name: z.string(),
  quality: z.number().int(),
  itemLevel: z.number().int(),
  requiredLevel: z.number().int(),
  /** Tipo de ranura del cliente (1 cabeza, 2 cuello, 3 hombros, 5 pecho, 13 una mano, 17 dos manos...). */
  inventoryType: z.number().int(),
  classId: z.number().int(),
  subclassId: z.number().int(),
  /** 0 ninguno, 1 al recoger, 2 al equipar, 3 al usar, 4 mision. */
  bonding: z.number().int(),
  iconFileDataId: z.number().int().nullable(),
  /** Mascara de clases que pueden usarlo (-1 = todas). */
  allowableClass: z.number().int(),
  /** Mascara de razas (-1 = todas). */
  allowableRace: z.number().int(),
  itemSetId: z.number().int().nullable(),
  limitCategory: z.number().int().nullable(),
  /** Unidades maximas que se pueden tener (1 = unico). */
  maxCount: z.number().int(),
  /** Unico-equipado (ItemSparse.Flags[0] 0x80000): solo se puede llevar uno equipado, aunque MaxCount no sea 1. */
  uniqueEquipped: z.boolean().default(false),
  /** Armadura extra de las piezas verdes (ItemSparse.QualityModifier de la armadura): parte de `armor`, no recibe el % de armadura de los talentos. */
  bonusArmor: z.number().default(0),
  /** Armadura base de las tablas (sin la estadistica de armadura extra). */
  armor: z.number().nullable(),
  weapon: ItemWeapon.nullable(),
  /** Arma de lanzador (ItemSparse.Flags[4] bit 8): Forever le aplica un modificador de dano que las tablas no reproducen. */
  casterWeapon: z.boolean(),
  /** Objeto de prueba, marcador o retirado (nombre con [PH], TEST, OLD, Deprecated...): se conserva pero la UI no lo ofrece. */
  placeholder: z.boolean(),
  stats: z.array(ItemStat),
  /** Presupuesto de estadisticas (RandPropPoints segun nivel, calidad y ranura): lo que reparte un sufijo aleatorio. 0 si no se conoce. */
  statBudget: z.number(),
  effects: z.array(ItemEffectRef),
  /** client-db2 = tablas del cliente; community = la comunidad (objetos que nuestro volcado no trae). */
  provenance: Provenance,
  /** client = nombre del cliente (esES); untranslated = ingles de la comunidad, pendiente de traducir. */
  textOrigin: z.enum(["client", "untranslated"]),
  /** Indice en `Items.suffixSets`: lista de sufijos aleatorios que puede llevar («del Mono»…); null = sin sufijo. */
  randomSuffixSet: z.number().int().nullable(),
});
export const Items = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  /** Equipables (armas y armadura con ranura) con datos en el cliente. */
  items: z.array(Item),
  /** Equipables que estan en `Item` pero el cliente no trae `ItemSparse` (ni nombre ni estadisticas): llegan por hotfix al verlos en el juego. */
  unavailable: z.array(z.object({ id: z.number().int(), classId: z.number().int(), subclassId: z.number().int(), inventoryType: z.number().int() })),
  /** Conjuntos de objetos y sus bonos. */
  sets: z.array(ItemSetDef),
  /** Listas de sufijos aleatorios posibles (ids de `RandomSuffixes`), compartidas por muchos objetos. */
  suffixSets: z.array(z.array(z.number().int())),
  warnings: z.array(z.string()),
});
export type ItemStat = z.infer<typeof ItemStat>;
export type ItemWeapon = z.infer<typeof ItemWeapon>;
export type ItemEffectRef = z.infer<typeof ItemEffectRef>;
export type ItemSetDef = z.infer<typeof ItemSetDef>;
export type Item = z.infer<typeof Item>;
export type Items = z.infer<typeof Items>;

/** Puntuacion necesaria por 1 % (defensa: por punto de habilidad) segun la comunidad (MIT), medida en la beta; `community`. */
export const CombatRatings = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  source: z.string(),
  /** true = los 123 niveles tienen las mismas cifras (comprobado al generar), asi que `ratings` vale para todos. */
  constantAcrossLevels: z.boolean(),
  levels: z.object({ min: z.number().int(), max: z.number().int() }),
  /** Clave (defense, dodge, parry, block, hit-melee, hit-ranged, hit-spell, crit-*, haste-*, expertise...) -> puntuacion por 1 %. */
  ratings: z.record(z.string(), z.number()),
});
export type CombatRatings = z.infer<typeof CombatRatings>;

/** Encantamiento aplicable a una ranura. El nombre sale del cliente (SpellItemEnchantment, esES); las cifras, de la comunidad. */
export const Enchant = z.object({
  /** SpellItemEnchantment.ID (el cliente lo llama effectId). */
  effectId: z.number().int(),
  spellId: z.number().int(),
  itemId: z.number().int().nullable(),
  name: z.string(),
  nameEn: z.string(),
  /** Tipo de ranura principal (ItemType de la comunidad: 1 cabeza, 2 cuello, 3 hombros, 4 espalda, 5 pecho, 6 muñecas, 7 manos, 8 cintura, 9 piernas, 10 pies, 11 anillo, 12 abalorio, 13 arma, 14 distancia). */
  slotType: z.number().int(),
  extraSlotTypes: z.array(z.number().int()),
  quality: z.number().int(),
  level: z.number().int().nullable(),
  stats: z.array(ItemStat),
});
export const Enchants = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  source: z.string(),
  enchants: z.array(Enchant),
});
export type Enchant = z.infer<typeof Enchant>;
export type Enchants = z.infer<typeof Enchants>;

/** Sufijo aleatorio de objeto («del Mono»): reparto de estadisticas en diezmilesimas del presupuesto del objeto. No estan en el cliente (sin tabla), solo en la comunidad. */
export const RandomSuffix = z.object({
  id: z.number().int(),
  /** Nombre que muestra la web: nuestra traduccion al español (`translated-by-us`) o, si falta, el ingles de la comunidad. */
  name: z.string(),
  nameEn: z.string(),
  textOrigin: z.enum(["translated-by-us", "untranslated"]),
  allocations: z.array(ItemStat),
});
export const RandomSuffixes = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  source: z.string(),
  suffixes: z.array(RandomSuffix),
});
export type RandomSuffix = z.infer<typeof RandomSuffix>;
export type RandomSuffixes = z.infer<typeof RandomSuffixes>;

/** Quien puede usar un tipo de objeto: mascara de clases y nivel minimo (SkillRaceClassInfo). Una clase puede salir en varias filas. */
export const Proficiency = z.object({
  classMask: z.number().int(),
  minLevel: z.number().int(),
});
/**
 * Reglas de equipar que el cliente trae: competencias de armadura y de armas por clase y nivel (SkillRaceClassInfo + la habilidad de cada
 * ItemSubclass). Las reliquias (libro, ídolo, tótem) no las trae: son de una sola clase (Classic) y van aparte como `assumption`.
 */
export const EquipRules = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  /** ItemSubclass de armadura (1 tela, 2 cuero, 3 malla, 4 placas, 6 escudo) -> quien puede llevarla. */
  armor: z.record(z.string(), z.array(Proficiency)),
  /** ItemSubclass de arma (0 hacha, 1 hacha 2M, 2 arco, 3 arma de fuego, 4 maza, 5 maza 2M, 6 asta, 7 espada, 8 espada 2M, 10 bastón, 13 arma de puño, 15 daga, 16 arrojadiza, 18 ballesta, 19 varita). */
  weapons: z.record(z.string(), z.array(Proficiency)),
  /** Habilidad «Doble empuñadura» (118): quien puede llevar un arma en cada mano. */
  dualWield: z.array(Proficiency),
  /** Reliquias de la ranura de distancia (ItemSubclass 7 libro, 8 ídolo, 9 tótem) -> mascara de clase. No esta en el cliente: Classic. */
  relics: z.object({ provenance: Provenance, byClassMask: z.record(z.string(), z.number().int()) }),
  warnings: z.array(z.string()),
});
export type Proficiency = z.infer<typeof Proficiency>;
export type EquipRules = z.infer<typeof EquipRules>;

/**
 * Textos en ingles (el cliente instalado solo trae esES): nombres y descripciones que la web muestra al elegir «English».
 * No salen del cliente sino de datos de la comunidad (`community`); lo que falta se muestra en español, marcado.
 */
export const EnglishText = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  provenance: Provenance,
  source: z.string(),
  /** Por token de clase (`MAGE`…): nombre y nombres de sus arboles (en orden). */
  classes: z.record(z.object({ name: z.string(), specs: z.array(z.string()) })),
  /** Arboles de Legacy, en orden. */
  legacyTrees: z.array(z.string()),
  /** Talentos y ventajas de Legacy por `nodeId`: nombre y descripcion por rango (nivel 60). */
  talents: z.record(z.object({ name: z.string(), descriptions: z.array(z.string()) })),
  /** Hechizos (rangos de habilidades) por `spellId`: nombre y texto fijo a nivel 60 sin talentos ni equipo (no se recalcula). */
  spells: z.record(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      lines: z.array(z.string()),
      /** Plantilla inglesa con huecos `{{tipo:hechizo:efecto|valor}}` (como `descriptionTemplate`): el motor la recalcula con el nivel y los talentos. */
      template: z.string().optional(),
    }),
  ),
  /** Talentos sin nodo (`UnassignedEntry`) por `entryId`: nombre y descripcion por rango. */
  entries: z.record(z.object({ name: z.string(), descriptions: z.array(z.string()) })).default({}),
  /** Objetos por `id`. */
  items: z.record(z.string()),
  /** Conjuntos de objetos por `id`. */
  itemSets: z.record(z.string()).default({}),
  /** Textos que son traduccion propia (data/i18n/enUS-overrides.json): `spell:<id>`, `talent:<nodeId>`, `entry:<entryId>`, `item:<id>`, `set:<id>`. La web los marca. */
  ownTranslation: z.array(z.string()).default([]),
  /** Razas por `ChrRaces.ID`: nombre y raciales por `order`. */
  races: z.record(z.object({ name: z.string(), racials: z.array(z.object({ name: z.string(), description: z.string() })) })),
});
export type EnglishText = z.infer<typeof EnglishText>;

export const Manifest = z.object({
  schemaVersion: z.literal(1),
  build: z.string(),
  locale: z.string(),
  generatedAt: z.string(),
  /** true = incluye los hotfixes de Cache\ADB\<locale>\DBCache.bin (la verdad "en vivo" del servidor). */
  hotfixesApplied: z.boolean(),
  source: z.string(),
  classes: z.array(
    z.object({
      classId: z.number().int(),
      className: z.string().nullable(),
      iconFileDataId: z.number().int().nullable(),
      traitTreeId: z.number().int(),
      talentCount: z.number().int(),
      /** Nombres de los arboles de la clase, en orden (para mostrarlos en la portada sin cargar la clase). */
      specNames: z.array(z.string()).default([]),
      /** Nodos del cliente que no estan activos (visibles pero no seleccionables). */
      inactiveCount: z.number().int(),
      file: z.string(),
      sha256: z.string(),
      warnings: z.number().int(),
    }),
  ),
  /** Ventajas de Legacy (de cuenta): calculadora aparte cuyos puntos se suman al personaje. */
  legacy: z.object({ file: z.string(), sha256: z.string(), talentCount: z.number().int(), unplacedEntries: z.number().int() }),
  /** Formulas de combate de Classic Era (estimacion): impacto y aporte de atributos al critico. */
  combatFormulas: z.object({ file: z.string(), sha256: z.string() }).optional(),
  /** Reglas de talentos clasificadas a mano (efectos genericos del cliente). */
  rules: z.array(z.object({ classId: z.number().int(), file: z.string(), sha256: z.string(), ruleCount: z.number().int() })).default([]),
  /** Habilidades por clase (solo las clases ya revisadas: hoy el Mago). */
  abilities: z.array(z.object({ classId: z.number().int(), file: z.string(), sha256: z.string(), abilityCount: z.number().int(), rankCount: z.number().int() })),
  /** Critico por atributo, mana base y poder de ataque por atributo por clase y nivel (client-db2). */
  clientStats: z.object({ file: z.string(), sha256: z.string() }).optional(),
  /** Puntuacion por 1 % de combate, encantamientos y sufijos aleatorios (la comunidad, MIT; `community`). */
  combatRatings: z.object({ file: z.string(), sha256: z.string() }).optional(),
  enchants: z.object({ file: z.string(), sha256: z.string(), count: z.number().int() }).optional(),
  randomSuffixes: z.object({ file: z.string(), sha256: z.string(), count: z.number().int() }).optional(),
  /** Objetos equipables (armas y armadura) del cliente. */
  items: z.object({ file: z.string(), sha256: z.string(), itemCount: z.number().int(), unavailableCount: z.number().int() }).optional(),
  /** Competencias de armadura y armas por clase y nivel (client-db2). */
  equipRules: z.object({ file: z.string(), sha256: z.string() }).optional(),
  /** Estadisticas base (Classic Era, estimacion). */
  stats: z.object({ file: z.string(), sha256: z.string(), comboCount: z.number().int(), missingCount: z.number().int() }),
  /** Razas jugables con su matriz de clases y raciales. */
  races: z.object({ file: z.string(), sha256: z.string(), raceCount: z.number().int() }),
  /** Iconos que necesita la web (FileDataIDs unicos); se descargan con tools/extract/fetch-icons.mjs. */
  icons: z.object({ file: z.string(), count: z.number().int(), sha256: z.string() }),
  /** Textos en ingles (community). */
  english: z.object({ file: z.string(), sha256: z.string() }).optional(),
  unassigned: z.object({
    file: z.string(),
    sha256: z.string(),
    orphanEntries: z.number().int(),
    alternativeTrees: z.number().int(),
  }),
  unresolvedTrees: z.array(z.object({ traitTreeId: z.number().int(), nodeCount: z.number().int(), reason: z.string() })),
  inputs: z.array(z.object({ table: z.string(), sha256: z.string() })),
});
export type Manifest = z.infer<typeof Manifest>;
