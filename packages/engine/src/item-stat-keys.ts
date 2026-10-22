/**
 * Estadísticas de objeto de Forever que el motor reconoce por familia (tipos 90-140 del cliente; `client-db2`): el nombre sale de los
 * textos ITEM_MOD_* del cliente (GlobalStrings) y la clave de `data-pipeline/src/items.ts`.
 */

/** Tipos de criatura de los bonos «contra …»: clave del objeto y nombre en plural (el del cliente). */
export const CREATURE_TYPES: { key: string; label: string }[] = [
  { key: "humanoid", label: "humanoides" },
  { key: "elemental", label: "elementales" },
  { key: "demon", label: "demonios" },
  { key: "undead", label: "no-muertos" },
  { key: "dragonkin", label: "dragonantes" },
  { key: "giant", label: "gigantes" },
  { key: "beast", label: "bestias" },
  { key: "mechanical", label: "unidades mecánicas" },
];

/** Habilidad con cada tipo de arma (`skill-<clave>`). */
export const WEAPON_SKILLS: { key: string; label: string }[] = [
  { key: "2h-axes", label: "hachas de dos manos" },
  { key: "2h-maces", label: "mazas de dos manos" },
  { key: "2h-swords", label: "espadas de dos manos" },
  { key: "axes", label: "hachas" },
  { key: "bows", label: "arcos" },
  { key: "crossbows", label: "ballestas" },
  { key: "daggers", label: "dagas" },
  { key: "dual-wield", label: "doble empuñadura" },
  { key: "fist-weapons", label: "armas de puño" },
  { key: "guns", label: "armas de fuego" },
  { key: "maces", label: "mazas" },
  { key: "polearms", label: "armas de asta" },
  { key: "staves", label: "báculos" },
  { key: "swords", label: "espadas" },
  { key: "thrown", label: "armas arrojadizas" },
  { key: "wands", label: "varitas" },
];

/** Habilidad de profesión (`profession-<clave>`). */
export const PROFESSION_SKILLS: { key: string; label: string }[] = [
  { key: "alchemy", label: "alquimia" },
  { key: "blacksmithing", label: "herrería" },
  { key: "enchanting", label: "encantamiento" },
  { key: "engineering", label: "ingeniería" },
  { key: "jewelcrafting", label: "joyería" },
  { key: "leatherworking", label: "peletería" },
  { key: "herbalism", label: "herboristería" },
  { key: "mining", label: "minería" },
  { key: "skinning", label: "desuello" },
  { key: "cooking", label: "cocina" },
  { key: "first-aid", label: "primeros auxilios" },
  { key: "fishing", label: "pesca" },
  { key: "tailoring", label: "sastrería" },
];

/** Penetración por escuela (`<escuela>-penetration`). */
export const PENETRATION_SCHOOLS: { key: string; label: string }[] = [
  { key: "fire", label: "Fuego" },
  { key: "nature", label: "Naturaleza" },
  { key: "frost", label: "Escarcha" },
  { key: "shadow", label: "Sombras" },
  { key: "arcane", label: "Arcano" },
];

/** Clave del poder de ataque / daño con hechizos contra un tipo de criatura. */
export const attackPowerVsKey = (creature: string): string => `attack-power-vs-${creature}`;
export const spellDamageVsKey = (creature: string): string => `spell-damage-vs-${creature}`;
