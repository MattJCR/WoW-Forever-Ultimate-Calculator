// Metadatos de las páginas que no son de consulta: portada, calculadora de clase y páginas auxiliares.
import type { Manifest } from "@wfuc/schema";
import { classLabel, currentLang, specLabel, tr } from "../i18n";
import { getSeoIndex } from "../router";
import { VIEWS } from "../components/ClassShell";
import { clip, SITE_NAME, withLd, type PageMeta } from "./meta";
import { CALC_VIEWS, isIndexable, pagePath, type CalcView, type Page } from "./routes";

const classEntry = (manifest: Manifest, token: string) => manifest.classes.find((c) => c.file === `classes/${token}.json`);

const path = (page: Page): string => {
  const index = getSeoIndex();
  return (index && pagePath(page, currentLang(), index)) || "";
};

export function homeMeta(manifest: Manifest): PageMeta {
  const lang = currentLang();
  const here = path({ kind: "home" });
  const meta: PageMeta = {
    title: tr("Calculadora de talentos de WoW Forever: clases, razas y equipo"),
    description: clip(tr("Planifica tu personaje de WoW Forever: talentos de las {n} clases, razas, Puntos de Legado, equipo con probador 3D y el daño de cada habilidad. Datos reales del cliente de la beta.", { n: manifest.classes.length })),
  };
  return withLd(meta, lang, here, { crumbs: [], app: { name: SITE_NAME, description: meta.description } });
}

const stepLabel = (view: CalcView): string => tr(VIEWS.find((v) => v.id === view)?.label ?? view);

/** Página de la clase: la entrada a los pasos de la calculadora. */
export function classMeta(manifest: Manifest, token: string): PageMeta {
  const entry = classEntry(manifest, token);
  const name = classLabel(token, entry?.className ?? token);
  const specs = (entry?.specNames ?? []).map((s, i) => specLabel(token, i, s)).join(", ");
  const here = path({ kind: "class", cls: token });
  const meta: PageMeta = {
    title: tr("{clase} en WoW Forever: talentos, razas, equipo y habilidades", { clase: name }),
    description: clip(tr("Todo para planificar tu {clase} de WoW Forever: árboles de talentos ({specs}), razas, Puntos de Legado, equipo con probador 3D y el daño de cada habilidad.", { clase: name, specs })),
  };
  return withLd(meta, currentLang(), here, {
    kind: "CollectionPage",
    crumbs: [{ name: "WoW Forever", path: path({ kind: "home" }) }, { name, path: here }],
    about: { name: tr("{clase} en WoW Forever", { clase: name }), description: specs },
    items: CALC_VIEWS.map((view) => ({ name: stepLabel(view), path: path({ kind: "calc", cls: token, view }) })),
  });
}

/** Un paso de la calculadora de una clase (cada uno tiene su dirección). */
export function calcMeta(manifest: Manifest, token: string, view: CalcView): PageMeta {
  const entry = classEntry(manifest, token);
  const name = classLabel(token, entry?.className ?? token);
  const specs = (entry?.specNames ?? []).map((s, i) => specLabel(token, i, s)).join(", ");
  const noindex = !isIndexable({ kind: "calc", cls: token, view });
  const crumbs = [{ name: "WoW Forever", path: path({ kind: "home" }) }, { name, path: path({ kind: "class", cls: token }) }];
  const here = path({ kind: "calc", cls: token, view });
  const step = (title: string, description: string, label: string): PageMeta =>
    withLd({ title, description: clip(description), noindex }, currentLang(), here, {
      crumbs: [...crumbs, { name: label, path: here }],
      app: { name: title, description: clip(description) },
    });
  switch (view) {
    case "race":
      return step(tr("Razas de {clase} en WoW Forever: raciales y estadísticas", { clase: name }), tr("Qué razas pueden ser {clase} en WoW Forever, con sus habilidades raciales, y cómo cambian tus estadísticas según la que elijas.", { clase: name }), tr("Raza"));
    case "legacy":
      return step(tr("Puntos de Legado para {clase} – WoW Forever", { clase: name }), tr("Reparte los 16 Puntos de Legado de tu cuenta antes de gastar los talentos de {clase}: ventajas de aventura, recursos y profesiones.", { clase: name }), tr("Puntos de Legado"));
    case "talents":
      return step(tr("Calculadora de talentos de {clase} – WoW Forever", { clase: name }), tr("Calculadora de {clase} de WoW Forever: árboles de talentos ({specs}), requisitos por filas y nivel necesario. Tu build se guarda en el enlace.", { clase: name, specs }), tr("Talentos"));
    case "gear":
      return step(tr("Equipo de {clase} en WoW Forever: armaduras, armas y probador 3D", { clase: name }), tr("Qué armaduras y armas lleva {clase} en WoW Forever y prueba tu equipo en el probador 3D, con encantamientos, sufijos aleatorios y conjuntos.", { clase: name }), tr("Equipo"));
    case "buffs":
      return step(tr("Beneficios y consumibles para {clase} – WoW Forever", { clase: name }), tr("Marca los beneficios de tu {clase}: bendiciones, gritos, elixires, frascos, comida y objetos de campamento, con las cifras del cliente.", { clase: name }), tr("Beneficios"));
    case "summary":
      return step(tr("Estadísticas y daño de {clase} en WoW Forever", { clase: name }), tr("Estadísticas con su desglose y el daño o la sanación de cada habilidad de {clase} en WoW Forever, según tu raza, talentos, equipo y beneficios.", { clase: name }), tr("Resumen"));
  }
}

export const unassignedMeta = (): PageMeta => ({
  title: tr("Datos del cliente sin asignar – WoW Forever"),
  description: tr("Talentos y árboles que el cliente de la beta trae pero no están en ningún árbol activo."),
  noindex: true,
});

export const notFoundMeta = (): PageMeta => ({ title: tr("Página no encontrada – WoW Forever"), description: tr("Esta página no existe."), noindex: true });

export const embedMeta = (): PageMeta => ({ title: tr("Probador 3D – WoW Forever"), description: tr("Probador 3D de equipo de WoW Forever."), noindex: true });
