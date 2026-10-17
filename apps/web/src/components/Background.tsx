const base = import.meta.env.BASE_URL;

/**
 * Arte de fondo de un arbol de talentos: las 4 texturas del cliente (Interface/TALENTFRAME/<Fondo>-*) forman una
 * imagen de 320x384 (256+64 de ancho, 256+128 de alto); aqui se colocan en porcentajes para que escale.
 */
export function Background({ name }: { name: string }) {
  const src = (part: string) => `${base}data/backgrounds/${name}-${part}.png`;
  const img = (part: string, style: React.CSSProperties) => <img className="bg-part" alt="" src={src(part)} style={style} draggable={false} loading="lazy" decoding="async" />;
  return (
    <div className="bg" aria-hidden="true">
      {img("TopLeft", { left: 0, top: 0, width: "80%", height: "66.667%" })}
      {img("TopRight", { left: "80%", top: 0, width: "20%", height: "66.667%" })}
      {img("BottomLeft", { left: 0, top: "66.667%", width: "80%", height: "33.333%" })}
      {img("BottomRight", { left: "80%", top: "66.667%", width: "20%", height: "33.333%" })}
    </div>
  );
}
