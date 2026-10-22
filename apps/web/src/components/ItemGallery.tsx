import type { Item } from "@wfuc/schema";
import { useEffect, useState } from "react";
import { loadAppearance } from "../viewer/appearance";
import { MODELS_BASE } from "../viewer/config";
import type { AppearanceData } from "../viewer/equipment";
import { iName, qualityColor } from "./gear-format";
import { Icon } from "./Icon";

/** appearance.json (objeto -> apariencia) cuando se pide; null mientras carga o si esta versión no trae modelos. */
export function useAppearance(enabled: boolean): AppearanceData | null | undefined {
  const [ap, setAp] = useState<AppearanceData | null | undefined>(undefined);
  useEffect(() => {
    if (enabled && ap === undefined) void loadAppearance(MODELS_BASE).then(setAp);
  }, [enabled, ap]);
  return ap;
}

/** Cuadrícula de miniaturas 3D (la pieza sobre un personaje base); sin miniatura, el icono del objeto. */
export function ItemGallery({ items, wornId, appearance, onEquip, onTip }: {
  items: Item[];
  wornId: number | undefined;
  appearance: AppearanceData | null | undefined;
  onEquip: (item: Item) => void;
  onTip: (t: { item: Item; x: number; y: number } | null) => void;
}) {
  return (
    <ul className="item-gallery">
      {items.map((i) => {
        const display = appearance?.items[String(i.id)];
        return (
          <li key={i.id}>
            <button
              type="button"
              className={`gallery-item${wornId === i.id ? " on" : ""}`}
              style={{ borderColor: qualityColor(i.quality) }}
              onClick={() => onEquip(i)}
              onMouseEnter={(e) => onTip({ item: i, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => onTip({ item: i, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => onTip(null)}
            >
              {display ? (
                <img src={`${MODELS_BASE}/bust/${display}.webp`} alt="" loading="lazy" width={96} height={96} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              ) : (
                <span className="gallery-icon"><Icon id={i.iconFileDataId} name={iName(i)} /></span>
              )}
              <b style={{ color: qualityColor(i.quality) }}>{iName(i)}</b>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
