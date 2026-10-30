#!/usr/bin/env bash
# Exporta tablas DB2 a CSV desde wow.tools.local (debe estar arrancado en modo LOCAL,
# ver docs/EXTRACTION.md). Solo hace peticiones HTTP a localhost; no toca el cliente.
# Uso: [HOTFIXES=1] tools/extract/export-tables.sh [build] [tabla ...]
#
# Sin HOTFIXES: datos estaticos del cliente      -> data/raw/<build>/
# HOTFIXES=1:   con los hotfixes de la cache     -> data/raw/<build>-hotfix/
# (los hotfixes salen de Cache\ADB\<locale>\DBCache.bin, que el propio juego actualiza al
#  iniciar sesion; wow.tools.local los lee al arrancar. Hay que volver a arrancarlo tras entrar al juego.)
set -euo pipefail

BUILD="${1:-1.60.1.70685}"
shift || true
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "${HOTFIXES:-0}" = "1" ]; then
  OUT="$ROOT/data/raw/$BUILD-hotfix"; EXTRA="&useHotfixes=true"
else
  OUT="$ROOT/data/raw/$BUILD"; EXTRA=""
fi
# OUT_SUFFIX=-enUS deja la exportacion en data/raw/<build>-hotfix-enUS (textos en ingles del cliente: ver docs/EXTRACTION.md)
OUT="$OUT${OUT_SUFFIX:-}"
mkdir -p "$OUT"

DEFAULT_TABLES=(
  # Talentos de Forever (sistema Trait)
  TraitTree TraitNode TraitNodeEntry TraitNodeXTraitNodeEntry TraitDefinition
  TraitDefinitionEffectPoints TraitEdge TraitNodeGroup TraitNodeGroupXTraitNode
  TraitSystem TraitCost TraitCurrency TraitTreeXTraitCost TraitCond
  TraitNodeXTraitCond TraitNodeGroupXTraitCond Curve CurvePoint
  # Talentos de Classic Era (solo para el diff "vs Classic")
  TalentTab Talent
  # Clases, razas, especializaciones
  ChrClasses ChrRaces ChrSpecialization SkillRaceClassInfo CharBaseInfo ChrRaceRacialAbility ChrClassesXPowerTypes
  # Hechizos
  Spell SpellName SpellEffect SpellMisc SpellPower SpellCooldowns SpellLevels
  SpellClassOptions SpellAuraOptions SpellCastTimes SpellDuration SpellRange
  SpellCategories SkillLineAbility SpellRadius
  # Objetos que hay que llevar equipados para que valga un hechizo (armas de dos manos, varitas, escudo...)
  SpellEquippedItems
  # Variables de las descripciones ($<damagepower>, $<minDam>...): bloques `$nombre=expresion` por hechizo
  SpellDescriptionVariables SpellXDescriptionVariables
  # Objetivos maximos ($i) y nivel maximo del objetivo ($v)
  SpellTargetRestrictions
  # Critico por agilidad/intelecto, mana base y vida por aguante por clase y nivel (client-stats.json)
  PlayerExpectedStat
)
# Objetos y equipo (spike de Equipo, sesion 6). ITEMS=1 exporta solo estas, con hotfixes: la
# mitad de los ItemSparse de Forever llegan por hotfix (ver DATA-FINDINGS, "Objetos").
ITEM_TABLES=(
  Item ItemSparse ItemSearchName ItemEffect ItemXItemEffect ItemSet ItemSetSpell ItemLimitCategory
  ItemClass ItemSubClass ItemNameDescription SpellItemEnchantment
  # Textos del cliente (ITEM_MOD_*, TOOLTIP_ITEM_STAT_*): etiqueta de cada tipo de estadistica de objeto
  GlobalStrings
  # Fuente «Fabricado»: profesiones (SkillLine) y hechizos de creación de objeto (SkillLineAbility + SpellEffect)
  SkillLine SkillLineAbility
  # Presupuesto de estadisticas, armadura y dano de arma por nivel de objeto
  RandPropPoints ItemArmorTotal ItemArmorQuality ItemArmorShield ArmorLocation
  ItemDamageOneHand ItemDamageOneHandCaster ItemDamageTwoHand ItemDamageTwoHandCaster
  ItemDamageWand ItemDamageThrown ItemDamageAmmo ItemDamageRanged
  # Procs por minuto de los hechizos nuevos
  SpellProcsPerMinute
)
# Apariencia (probador 3D): modelos de raza/sexo, personalizacion, apariencia de objetos y texturas.
# APPEARANCE=1 exporta solo estas; algunas pueden no existir en este cliente (el script avisa).
APPEARANCE_TABLES=(
  ItemModifiedAppearance ItemAppearance ItemDisplayInfo ItemDisplayInfoMaterialRes ItemDisplayInfoModelMatRes
  ItemDisplayInfoMaterial ItemVisuals ItemVisualEffects ModelFileData TextureFileData ComponentModelFileData
  ComponentTextureFileData ChrModel ChrRaceXChrModel ChrCustomization ChrCustomizationOption ChrCustomizationChoice
  ChrCustomizationElement ChrCustomizationDisplayInfo ChrCustomizationGeoset ChrCustomizationMaterial
  ChrCustomizationSkinnedModel ChrCustomizationBoneSet ChrCustomizationReq ChrCustomizationCategory
  CharComponentTextureLayouts CharComponentTextureSections CharSections CharacterFacialHairStyles CharHairGeosets
  GeosetGroup CreatureDisplayInfo CreatureDisplayInfoExtra CreatureModelData ItemSetSpell AnimationData
  AnimKit ModelAnimData ChrRaces ItemSet ItemClass ItemSubClass HelmetGeosetData HelmetGeosetVisData
  ItemDisplayInfoGeosetOverride SkinnedModel
  # Ajustes de posición de objetos envainados (ItemDisplayInfo.SheatheTransformMatrixID, 173 apariencias, casi todo atrezo); aún sin aplicar
  TransformMatrix
  # Los usa tools/model (modelos de personaje); se olvidaron en la lista hasta el parche 70532
  ChrModelMaterial ChrModelTextureLayer
)
TABLES=("$@")
if [ ${#TABLES[@]} -eq 0 ]; then
  if [ "${APPEARANCE:-0}" = "1" ]; then TABLES=("${APPEARANCE_TABLES[@]}")
  elif [ "${ITEMS:-0}" = "1" ]; then TABLES=("${ITEM_TABLES[@]}"); else TABLES=("${DEFAULT_TABLES[@]}"); fi
fi

for t in "${TABLES[@]}"; do
  code=$(curl -s -m 180 "http://localhost:5000/dbc/export/?name=$t&build=$BUILD$EXTRA" \
        -o "$OUT/$t.csv" -w "%{http_code}")
  size=$(wc -c < "$OUT/$t.csv")
  if [ "$code" != "200" ] || [ "$size" -eq 0 ]; then
    echo "AVISO $t: http $code, $size bytes (tabla vacia o inexistente)"; rm -f "$OUT/$t.csv"
  else
    echo "OK    $t: $size bytes"
  fi
done
