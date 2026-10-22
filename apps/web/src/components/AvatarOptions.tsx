import { useMemo, useState } from "react";
import { tr } from "../i18n";
import { groupOfOption, isColorOption, OPTION_GROUPS, stepChoice, swatchCss, type OptionGroup, type Recipe, type RecipeChoice, type RecipeOption, type Selection } from "../viewer/recipe";

const GROUP_LABEL: Record<OptionGroup, string> = { body: "Cuerpo", face: "Cara", hair: "Pelo" };

/** Elecciones que se muestran de una opción: sin las de PNJ salvo que se pidan o sea la que está puesta. */
function shownChoices(o: RecipeOption, npc: boolean, current: number | undefined): RecipeChoice[] {
  return o.choices.filter((c) => npc || !c.npc || c.id === current);
}

/**
 * Personalización del probador por zonas (Cuerpo, Cara, Pelo): las opciones de color se eligen con muestras y el resto con ◀ ▶ (o la lista).
 * Los nombres salen del cliente.
 */
export function AvatarOptions({ recipe, selection, npc, onPick }: { recipe: Recipe; selection: Selection | undefined; npc: boolean; onPick: (optionId: number, choiceId: number) => void }) {
  const groups = useMemo(() => {
    const out = new Map<OptionGroup, RecipeOption[]>();
    for (const o of recipe.options) {
      if (shownChoices(o, npc, selection?.[o.id]).length < 2) continue;
      const g = groupOfOption(o);
      out.set(g, [...(out.get(g) ?? []), o]);
    }
    return out;
  }, [recipe, npc, selection]);
  const tabs = OPTION_GROUPS.filter((g) => groups.has(g));
  const [tab, setTab] = useState<OptionGroup>("face");
  const active = tabs.includes(tab) ? tab : tabs[0];
  if (!active) return null;

  return (
    <div className="avatar-custom">
      <div className="avatar-tabs" role="tablist" aria-label={tr("Zona del personaje")}>
        {tabs.map((g) => (
          <button key={g} type="button" role="tab" aria-selected={g === active} className={g === active ? "on" : ""} onClick={() => setTab(g)}>
            {tr(GROUP_LABEL[g])}
          </button>
        ))}
      </div>
      <div className="avatar-options-list" role="tabpanel">
        {groups.get(active)!.map((o) => {
          const current = selection?.[o.id] ?? 0;
          const shown = shownChoices(o, npc, current);
          const label = (c: RecipeChoice, i: number) => c.name || `#${i + 1}`;
          if (isColorOption(shown)) {
            return (
              <div key={o.id} className="avatar-opt">
                <span className="avatar-opt-name">{o.name}</span>
                <div className="swatches" role="radiogroup" aria-label={o.name}>
                  {shown.map((c, i) => (
                    <button key={c.id} type="button" role="radio" aria-checked={c.id === current} className={`swatch${c.id === current ? " on" : ""}`} title={label(c, i)} aria-label={label(c, i)} style={{ background: swatchCss(c.swatch) ?? "transparent" }} onClick={() => onPick(o.id, c.id)} />
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={o.id} className="avatar-opt">
              <span className="avatar-opt-name">{o.name}</span>
              <div className="stepper">
                <button type="button" aria-label={tr("Anterior")} onClick={() => onPick(o.id, stepChoice(shown, current, -1))}>◀</button>
                <select aria-label={o.name} value={current} onChange={(e) => onPick(o.id, Number(e.target.value))}>
                  {shown.map((c, i) => <option key={c.id} value={c.id}>{label(c, i)}</option>)}
                </select>
                <button type="button" aria-label={tr("Siguiente")} onClick={() => onPick(o.id, stepChoice(shown, current, 1))}>▶</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
