import type { GearData, GearSelection, GearSlot } from "@wfuc/engine";
import { GEAR_SLOTS } from "@wfuc/engine";
import { useEffect, useRef, useState } from "react";
import { fmtNum, tr } from "../i18n";
import { iName, nameOf, qualityColor, slotLabel } from "./gear-format";
import { Icon } from "./Icon";

/** Cierra con Escape (los diálogos del probador). */
function useEscape(onClose: () => void): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
}

/** Copia un texto al portapapeles; false si el navegador no lo permite. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Botón que copia un texto y avisa un momento («Copiado»). */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 1800);
    return () => window.clearTimeout(t);
  }, [state]);
  return (
    <button type="button" className="btn" onClick={() => void copyText(text).then((ok) => setState(ok ? "ok" : "fail"))}>
      {state === "ok" ? tr("Copiado") : state === "fail" ? tr("No se pudo copiar") : label}
    </button>
  );
}

interface Row {
  slot: GearSlot;
  itemId: number;
  name: string;
  quality: number;
  icon: number | null;
  itemLevel: number;
  extras: string[];
}

/** Una fila por ranura con objeto: nombre, nivel de objeto, sufijo, encantamiento y mejora temporal. */
function equippedRows(gear: GearSelection, data: GearData): Row[] {
  const rows: Row[] = [];
  for (const slot of GEAR_SLOTS) {
    const worn = gear[slot];
    if (!worn) continue;
    const item = data.items.get(worn.itemId);
    const extras: string[] = [];
    const suffix = worn.suffixId ? data.suffixes.get(worn.suffixId) : undefined;
    const enchant = worn.enchantId ? data.enchants.get(worn.enchantId) : undefined;
    const temp = worn.tempId ? data.enhancements.get(worn.tempId) : undefined;
    if (enchant) extras.push(nameOf(enchant));
    if (temp) extras.push(`${nameOf(temp)} (${tr("temporal")})`);
    rows.push({
      slot,
      itemId: worn.itemId,
      name: item ? `${iName(item)}${suffix ? ` ${nameOf(suffix)}` : ""}` : `${tr("Objeto")} ${worn.itemId}`,
      quality: item?.quality ?? 1,
      icon: item?.iconFileDataId ?? null,
      itemLevel: item?.itemLevel ?? 0,
      extras,
    });
  }
  return rows;
}

/** Tabla de lo que lleva el personaje puesto, con un botón que la copia como texto (una línea por ranura). */
export function EquippedDialog({ gear, data, onClose }: { gear: GearSelection; data: GearData; onClose: () => void }) {
  useEscape(onClose);
  const rows = equippedRows(gear, data);
  const text = rows.map((r) => `${slotLabel(r.slot)}: ${r.name}${r.extras.length ? ` (${r.extras.join(", ")})` : ""}`).join("\n");
  const average = rows.filter((r) => r.itemLevel > 0 && !["shirt", "tabard"].includes(r.slot));
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal equipped-dialog" role="dialog" aria-modal="true" aria-label={tr("Equipado")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Equipado")}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label={tr("Cerrar")}>×</button>
        </div>
        {rows.length === 0 ? (
          <p className="muted">{tr("No llevas ningún objeto puesto.")}</p>
        ) : (
          <>
            <table className="equipped-table">
              <thead>
                <tr>
                  <th scope="col">{tr("Ranura")}</th>
                  <th scope="col">{tr("Objeto")}</th>
                  <th scope="col" className="num">{tr("Nivel de objeto")}</th>
                  <th scope="col">{tr("Mejoras")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.slot}>
                    <th scope="row">{slotLabel(r.slot)}</th>
                    <td>
                      <span className="equipped-item">
                        <span className="gear-icon small" style={{ borderColor: qualityColor(r.quality) }}>
                          <Icon id={r.icon} name={r.name} />
                        </span>
                        <b style={{ color: qualityColor(r.quality) }}>{r.name}</b>
                      </span>
                    </td>
                    <td className="num">{r.itemLevel || "—"}</td>
                    <td className="muted">{r.extras.join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              {rows.length} {tr("objetos")}
              {average.length > 0 ? ` · ${tr("nivel de objeto medio")} ${fmtNum(average.reduce((n, r) => n + r.itemLevel, 0) / average.length, 1)}` : ""}
            </p>
            <div className="set-actions">
              <CopyButton text={text} label={tr("Copiar como texto")} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Dirección de una vista del probador y código para insertarla en otra web (iframe). */
export interface ProbeLinks {
  /** El calculador con todo el personaje. */
  page: string;
  /** Solo el probador 3D (sin cabecera ni pie), para enlazar o insertar. */
  embed: string;
}

function LinkField({ label, value }: { label: string; value: string }) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <label className="link-field">
      <span>{label}</span>
      <span className="link-row">
        <input ref={field} readOnly value={value} onFocus={() => field.current?.select()} />
        <CopyButton text={value} label={tr("Copiar")} />
      </span>
    </label>
  );
}

/** Enlaces del probador: el calculador, solo el visor 3D y el código para insertarlo. */
export function LinksDialog({ links, onClose }: { links: ProbeLinks; onClose: () => void }) {
  useEscape(onClose);
  const iframe = `<iframe src="${links.embed}" width="480" height="640" style="border:0" loading="lazy" title="WoW Forever"></iframe>`;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal links-dialog" role="dialog" aria-modal="true" aria-label={tr("Enlaces")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{tr("Enlaces")}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label={tr("Cerrar")}>×</button>
        </div>
        <LinkField label={tr("Calculador con tu personaje")} value={links.page} />
        <LinkField label={tr("Solo el probador 3D")} value={links.embed} />
        <LinkField label={tr("Código para insertarlo en una web")} value={iframe} />
        <p className="muted small">{tr("Los enlaces llevan la raza, el equipo y el aspecto que ves ahora.")}</p>
      </div>
    </div>
  );
}

/** Dibuja el visor (y, si se pide, su fondo) en un lienzo nuevo y lo devuelve como PNG. */
async function stageBlob(stage: HTMLElement, withBackground: boolean): Promise<Blob | null> {
  const source = stage.querySelector("canvas");
  if (!source) return null;
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const g = out.getContext("2d");
  if (!g) return null;
  if (withBackground) {
    const style = getComputedStyle(stage);
    const a = style.getPropertyValue("--stage-a").trim() || "#4a3c28";
    const b = style.getPropertyValue("--stage-b").trim() || "#2a2116";
    const c = style.getPropertyValue("--stage-c").trim() || "#120e09";
    const grad = g.createRadialGradient(out.width / 2, out.height * 0.3, 0, out.width / 2, out.height * 0.3, Math.max(out.width, out.height) * 0.75);
    grad.addColorStop(0, a);
    grad.addColorStop(0.58, b);
    grad.addColorStop(1, c);
    g.fillStyle = grad;
    g.fillRect(0, 0, out.width, out.height);
    const art = stage.querySelector<HTMLImageElement>(".avatar-backdrop");
    if (art && art.complete && art.naturalWidth > 0) {
      // Como `object-fit: cover; object-position: center bottom`
      const k = Math.max(out.width / art.naturalWidth, out.height / art.naturalHeight);
      g.drawImage(art, (out.width - art.naturalWidth * k) / 2, out.height - art.naturalHeight * k, art.naturalWidth * k, art.naturalHeight * k);
    }
  }
  g.drawImage(source, 0, 0);
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Menú de la captura: descargar con o sin fondo (PNG transparente) o copiar la imagen al portapapeles. */
export function CaptureMenu({ stage, onClose }: { stage: HTMLElement | null; onClose: () => void }) {
  const [note, setNote] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) onClose();
    };
    // Un clic en el botón que abre el menú no debe cerrarlo en el mismo gesto
    const t = window.setTimeout(() => window.addEventListener("click", away), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("click", away);
    };
  }, [onClose]);
  const run = async (action: "transparent" | "background" | "copy") => {
    if (!stage) return;
    const blob = await stageBlob(stage, action === "background" || action === "copy");
    if (!blob) return setNote(tr("No se pudo hacer la captura."));
    if (action === "copy") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setNote(tr("Imagen copiada."));
      } catch {
        setNote(tr("El navegador no deja copiar imágenes: descárgala."));
      }
      return;
    }
    download(blob, action === "background" ? "wow-forever-personaje.png" : "wow-forever-personaje-transparente.png");
    onClose();
  };
  return (
    <div className="capture-menu" role="menu" aria-label={tr("Captura")} ref={menu}>
      <button type="button" role="menuitem" onClick={() => void run("background")}>{tr("Descargar con fondo")}</button>
      <button type="button" role="menuitem" onClick={() => void run("transparent")}>{tr("Descargar con fondo transparente")}</button>
      <button type="button" role="menuitem" onClick={() => void run("copy")}>{tr("Copiar imagen")}</button>
      {note && <p className="muted small" role="status">{note}</p>}
    </div>
  );
}
