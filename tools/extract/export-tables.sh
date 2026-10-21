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

BUILD="${1:-1.60.1.70450}"
shift || true
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "${HOTFIXES:-0}" = "1" ]; then
  OUT="$ROOT/data/raw/$BUILD-hotfix"; EXTRA="&useHotfixes=true"
else
  OUT="$ROOT/data/raw/$BUILD"; EXTRA=""
fi
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
  # Presupuesto de estadisticas, armadura y dano de arma por nivel de objeto
  RandPropPoints ItemArmorTotal ItemArmorQuality ItemArmorShield ArmorLocation
  ItemDamageOneHand ItemDamageOneHandCaster ItemDamageTwoHand ItemDamageTwoHandCaster
  ItemDamageWand ItemDamageThrown ItemDamageAmmo ItemDamageRanged
)
TABLES=("$@")
if [ ${#TABLES[@]} -eq 0 ]; then
  if [ "${ITEMS:-0}" = "1" ]; then TABLES=("${ITEM_TABLES[@]}"); else TABLES=("${DEFAULT_TABLES[@]}"); fi
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
