/** Nivel del personaje del Resumen: lo comparten las estadísticas y las habilidades. */
export function LevelPicker({ level, setLevel, minLevel }: { level: number; setLevel: (l: number) => void; minLevel: number }) {
  return (
    <div className="ab-controls level-picker">
      <label>
        Nivel{" "}
        <input type="number" min={1} max={60} value={level} onChange={(e) => setLevel(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} aria-label="Nivel del personaje" />
      </label>
      <button type="button" onClick={() => setLevel(Math.max(1, minLevel))} title="El nivel que exigen tus puntos de talento">
        Mi nivel ({Math.max(1, minLevel)})
      </button>
      <button type="button" onClick={() => setLevel(30)} title="El nivel máximo de la beta">
        30 (tope beta)
      </button>
      <button type="button" onClick={() => setLevel(60)}>
        60
      </button>
    </div>
  );
}
