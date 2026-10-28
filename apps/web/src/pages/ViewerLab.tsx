// Pantalla de pruebas del probador 3D (solo desarrollo): /viewer-lab?m=1&r=1&e=5:12422,7:39
import { useMemo, useState } from "react";
import { Viewer3D } from "../viewer/Viewer3D";
import { defaultSelection, type Recipe, type Selection } from "../viewer/recipe";

export function ViewerLab({ query }: { query: URLSearchParams }) {
  const m = Number(query.get("m") ?? 1);
  const race = Number(query.get("r") ?? 1);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [sel, setSel] = useState<Selection | undefined>(() => {
    const a = query.get("a");
    if (!a) return undefined;
    return Object.fromEntries(a.split("~").map((p) => p.split("-").map(Number) as [number, number]));
  });
  const [eq, setEq] = useState(query.get("e") ?? "");
  const equipped = useMemo(
    () => eq.split(",").filter(Boolean).map((p) => {
      const [t = 0, i = 0] = p.split(":").map(Number);
      const slot = [13, 17, 21].includes(t) ? "mainHand" : [14, 22, 23].includes(t) ? "offHand" : [15, 25, 26].includes(t) ? "ranged" : "armor";
      return { slot, inventoryType: t, classId: 0, subclassId: 0, itemId: i };
    }),
    [eq],
  );
  const cur = recipe ? { ...defaultSelection(recipe), ...sel } : {};
  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, height: "calc(100vh - 120px)" }}>
      <div style={{ overflow: "auto" }}>
        <label style={{ display: "block", marginBottom: 8 }}>Equipo (tipo:objeto)<input value={eq} onChange={(e) => setEq(e.target.value)} style={{ width: "100%" }} /></label>
        {recipe?.options.map((o) => (
          <label key={o.id} style={{ display: "block", marginBottom: 8 }}>
            {o.name}
            <select value={cur[o.id]} onChange={(e) => setSel({ ...cur, [o.id]: Number(e.target.value) })} style={{ width: "100%" }}>
              {o.choices.map((c, i) => <option key={c.id} value={c.id}>{c.name || `#${i + 1}`}</option>)}
            </select>
          </label>
        ))}
      </div>
      <Viewer3D chrModelId={m} race={race} selection={recipe ? cur : undefined} sheathed={query.get("s") === "1"} equipped={equipped} onRecipe={setRecipe} />
    </div>
  );
}
