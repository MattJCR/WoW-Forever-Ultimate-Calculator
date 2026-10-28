import { int, type RawTables } from "./csv.js";
import { spellEffectInfo } from "./items.js";
import type { SpellTables } from "./spell-tables.js";
import { clientEnchantValues } from "./wowsims.js";
import type { WeaponEnhancement, WeaponEnhancements } from "./model.js";

/**
 * Mejoras temporales de arma: piedras de afilar y contrapesos, aceites, venenos, piedras de brujo y pergaminos de imbuir. Son objetos
 * de uso cuyo hechizo aplica un encantamiento temporal (`SpellEffect.Effect` 54, o 360 en los venenos) a un arma. Todo es del cliente
 * (`client-db2`): la duración y las cargas del encantamiento, lo que da (`SpellItemEnchantment`), los hechizos que dispara y el tipo de
 * arma que admite el hechizo de uso (`SpellEquippedItems`). El juego solo deja una mejora temporal por arma.
 */

/** SpellEffect.Effect: encantar objeto temporalmente (y su variante de los venenos). */
const ENCHANT_ITEM_TEMPORARY = new Set([54, 360]);
/** SpellItemEnchantment.Effect: 1 = hechizo con probabilidad al golpear. */
const ENCHANT_COMBAT_SPELL = 1;
/** Bit de la ItemSubclass 20 (caña de pescar): un hechizo que solo admite cañas es un cebo, no una mejora de combate. */
const FISHING_POLE_BIT = 1 << 20;
const JUNK_NAME = /Deprecated|DEPRECATED|\(OLD\)|\bOLD\b|\(DND\)|\bTEST\b|\(DNT\)|\[PH\]|Runecarving Test|\[DNT\]/;

export function buildWeaponEnhancements(raw: RawTables, build: string, spells: SpellTables, warnings: string[]): WeaponEnhancements {
  const sparse = new Map(raw.table("ItemSparse").map((r) => [r.ID!, r]));
  const itemRows = new Map(raw.table("Item").map((r) => [r.ID!, r]));
  const effectById = new Map(raw.table("ItemEffect").map((r) => [r.ID!, r]));
  const enchantRows = new Map(raw.table("SpellItemEnchantment").map((r) => [int(r.ID), r]));
  const effectsByItem = new Map<string, string[]>();
  for (const x of raw.table("ItemXItemEffect")) effectsByItem.set(x.ItemID!, [...(effectsByItem.get(x.ItemID!) ?? []), x.ItemEffectID!]);

  const enhancements: WeaponEnhancement[] = [];
  const skipped: WeaponEnhancements["skipped"] = [];
  const seen = new Set<number>();
  for (const [itemId, item] of itemRows) {
    for (const eid of effectsByItem.get(itemId) ?? []) {
      const useEffect = effectById.get(eid);
      if (!useEffect || int(useEffect.TriggerType) !== 0) continue; // solo «Uso»
      const spellId = int(useEffect.SpellID);
      let enchantId = 0;
      for (let i = 0; i < spells.effectCount(spellId); i++) {
        const e = spells.effect(spellId, i);
        if (e && ENCHANT_ITEM_TEMPORARY.has(int(e.Effect))) enchantId = int(e["EffectMiscValue[0]"]);
      }
      const enchant = enchantRows.get(enchantId);
      if (!enchant || int(enchant.Duration) <= 0) continue; // sin duración = encantamiento permanente (ya está en enchants.json)
      if (seen.has(int(itemId))) continue;
      seen.add(int(itemId));

      const s = sparse.get(itemId);
      const enchantName = (enchant.Name_lang ?? "").replace(/\$k[123]/g, "").trim();
      const nameFromEnchant = !s?.Display_lang;
      const name = nameFromEnchant ? enchantName : spells.ownName(s!.Display_lang!);
      if (JUNK_NAME.test(name)) {
        skipped.push({ itemId: int(itemId), name, reason: "objeto de prueba o retirado" });
        continue;
      }
      const restriction = spells.equippedItems(spellId).find((r) => r.itemClass === 2);
      if (!restriction) {
        skipped.push({ itemId: int(itemId), name, reason: "no se aplica a un arma (fórmula de encantamiento de armadura)" });
        continue;
      }
      if ((restriction.subclassMask & ~FISHING_POLE_BIT) === 0 && restriction.subclassMask !== 0) {
        skipped.push({ itemId: int(itemId), name, reason: "cebo de pesca: no es de combate" });
        continue;
      }

      const values = clientEnchantValues(enchant, spells);
      // Probabilidad al golpear (venenos y aceites): el encantamiento la trae como cifra del efecto (EffectPointsMin, en %)
      for (let i = 0; i < 3; i++) {
        if (int(enchant[`Effect[${i}]`]) !== ENCHANT_COMBAT_SPELL) continue;
        const chance = int(enchant[`EffectPointsMin[${i}]`]);
        const ref = values.effects.find((x) => x.spellId === int(enchant[`EffectArg[${i}]`]));
        if (ref?.proc && chance > 0 && ref.proc.chancePct === null && ref.proc.ppm === null) ref.proc = { ...ref.proc, chancePct: chance };
      }
      if (values.unhandled.length > 0) warnings.push(`mejora de arma «${name}» (${itemId}): efectos de encantamiento sin interpretar (${values.unhandled.join(", ")})`);

      const info = spellEffectInfo(spells, spellId);
      if (info.text === "NYI." && values.effects.every((x) => x.text === "" && x.auras.length === 0 && !x.proc?.damage)) {
        skipped.push({ itemId: int(itemId), name, reason: "sin implementar en el cliente (texto «NYI.» y sin efecto)" });
        continue;
      }
      const allowable = int(s?.AllowableClass ?? "-1");
      const kind: WeaponEnhancement["kind"] = values.stats.some((x) => x.key === "physical-damage") ? "damage" : values.effects.some((x) => x.trigger === 2) ? "proc" : "stats";
      const allowableMask = allowable > 0 ? allowable : 0;
      enhancements.push({
        itemId: int(itemId),
        name,
        nameEn: null,
        nameFromEnchant,
        iconFileDataId: int(item.IconFileDataID) || spells.iconFileDataId(spellId),
        spellId,
        enchantId,
        kind,
        durationMs: int(enchant.Duration) * 1000,
        charges: int(enchant.Charges) > 0 ? int(enchant.Charges) : null,
        requiredLevel: s ? int(s.RequiredLevel) : null,
        classMask: allowableMask,
        weaponSubclassMask: restriction.subclassMask,
        invTypeMask: restriction.invTypeMask,
        stats: values.stats,
        effects: values.effects,
        text: info.text,
        textComplete: info.textComplete,
        textOrigin: spells.textOrigin(spellId),
      });
    }
  }
  enhancements.sort((a, b) => a.kind.localeCompare(b.kind) || (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0) || a.name.localeCompare(b.name, "es") || a.itemId - b.itemId);
  return { schemaVersion: 1, build, provenance: "client-db2", enhancements, skipped };
}
