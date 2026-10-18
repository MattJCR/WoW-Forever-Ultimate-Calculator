const base = import.meta.env.BASE_URL;

/**
 * Arte de fondo de un arbol de talentos: las 4 texturas del cliente (Interface/TALENTFRAME/<Fondo>-*) forman una
 * imagen de 320x384 (256+64 de ancho, 256+128 de alto); aqui se colocan en porcentajes para que escale.
 */
export function Background({ name }: { name: string }) {
  const src = (part: string) => `${base}data/backgrounds/${name}-${part}.png`;
  const img = (part: string, className: string) => <img className={`bg-part ${className}`} alt="" src={src(part)} draggable={false} decoding="async" />;
  return (
    <div className="bg" aria-hidden="true">
      <div className="bg-art">
        {img("TopLeft", "top-left")}
        {img("TopRight", "top-right")}
        {img("BottomLeft", "bottom-left")}
        {img("BottomRight", "bottom-right")}
      </div>
    </div>
  );
}
