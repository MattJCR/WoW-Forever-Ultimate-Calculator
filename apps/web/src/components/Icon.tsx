import { useState } from "react";
import { initials } from "../messages";

const base = import.meta.env.BASE_URL;

/**
 * Icono del hechizo extraido del cliente (data/forever/<build>/icons/<FileDataID>.png).
 * Si falta o no carga, muestra las iniciales del nombre.
 */
export function Icon({ id, name }: { id: number | null | undefined; name: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!id || failed) return <span className="initials">{initials(name)}</span>;
  return (
    <img
      className="icon"
      src={`${base}data/icons/${id}.png`}
      alt=""
      width={64}
      height={64}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
