/** Margen que se deja a cada lado entre una tarjeta flotante y el borde de la ventana. */
export const CARD_MARGIN = 8;
/** Escala minima de la letra: por debajo de esto la tarjeta deja de ser legible. */
const MIN_SCALE = 0.4;

/**
 * Ajusta una tarjeta flotante para que quepa entera en la ventana SIN scroll: reduce su escala de letra y de relleno
 * (variable CSS `--fit`, 1 = tamaño normal) lo justo para que su altura sea como mucho la de la ventana menos los margenes.
 * Busca por biseccion la mayor escala que cabe (el texto se reparte en mas lineas al crecer, asi que no es lineal).
 * Devuelve la escala aplicada. Debe llamarse antes de medir la tarjeta para colocarla.
 */
export function fitCardToViewport(el: HTMLElement): number {
  const maxHeight = window.innerHeight - 2 * CARD_MARGIN;
  const fits = (scale: number): boolean => {
    el.style.setProperty("--fit", String(scale));
    return el.offsetHeight <= maxHeight;
  };
  if (fits(1)) return 1;
  let lo = MIN_SCALE;
  let hi = 1;
  if (!fits(lo)) return lo; // ni al minimo cabe: se queda al minimo (nunca hay scroll)
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const scale = Math.floor(lo * 1000) / 1000;
  el.style.setProperty("--fit", String(scale));
  return scale;
}
