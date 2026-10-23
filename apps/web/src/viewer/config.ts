/**
 * Carpeta de los modelos 3D del probador (los genera tools/model). Por defecto, junto a la web (`public/models/<build>`);
 * con `VITE_MODELS_BASE` se puede servir desde otro alojamiento estático (ver docs/GEAR-PLAN.md).
 */
export const MODELS_BASE: string = import.meta.env.VITE_MODELS_BASE ?? `${import.meta.env.BASE_URL}models/1.60.1.70532`;
