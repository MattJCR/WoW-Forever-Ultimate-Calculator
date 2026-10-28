// Metadatos de las páginas que no son de consulta: portada, calculadora de clase y páginas auxiliares.
import type { Manifest } from "@wfuc/schema";
import { classLabel, currentLang, specLabel, tr } from "../i18n";
import { getSeoIndex } from "../router";
import { breadcrumbs, clip, siteUrl, SITE_NAME, type PageMeta } from "./meta";
import { pagePath, type Page } from "./routes";

const classEntry = (manifest: Manifest, token: string) => manifest.classes.find((c) => c.file === `classes/${token}.json`);

const path = (page: Page): string => {
  const index = getSeoIndex();
  return (index && pagePath(page, currentLang(), index)) || "";
};

export function homeMeta(manifest: Manifest): PageMeta {
  const lang = currentLang();
  const title = tr("Calculadora de talentos de WoW Forever: clases, razas y equipo");
  const description = clip(tr("Planifica tu personaje de WoW Forever: talentos de las {n} clases, razas, Puntos de Legado, equipo con probador 3D y el daño de cada habilidad. Datos reales del cliente de la beta.", { n: manifest.classes.length }));
  return {
    title,
    description,
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: `${siteUrl()}${path({ kind: "home" })}`, inLanguage: lang },
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: SITE_NAME,
        url: `${siteUrl()}${path({ kind: "home" })}`,
        applicationCategory: "GameApplication",
        operatingSystem: "Any",
        inLanguage: lang,
        description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      },
    ],
  };
}

/** Calculadora de una clase (la página interactiva). */
export function classMeta(manifest: Manifest, token: string): PageMeta {
  const entry = classEntry(manifest, token);
  const name = classLabel(token, entry?.className ?? token);
  const specs = (entry?.specNames ?? []).map((s, i) => specLabel(token, i, s)).join(", ");
  return {
    title: tr("Calculadora de talentos de {clase} – WoW Forever", { clase: name }),
    description: clip(tr("Calculadora de {clase} de WoW Forever: árboles de talentos ({specs}), raza, Puntos de Legado, equipo y el daño de cada habilidad. Tu build se guarda en el enlace.", { clase: name, specs })),
    jsonLd: [breadcrumbs([{ name: "WoW Forever", path: path({ kind: "home" }) }, { name, path: path({ kind: "class", cls: token }) }])],
  };
}

export const unassignedMeta = (): PageMeta => ({
  title: tr("Datos del cliente sin asignar – WoW Forever"),
  description: tr("Talentos y árboles que el cliente de la beta trae pero no están en ningún árbol activo."),
  noindex: true,
});

export const notFoundMeta = (): PageMeta => ({ title: tr("Página no encontrada – WoW Forever"), description: tr("Esta página no existe."), noindex: true });

export const embedMeta = (): PageMeta => ({ title: tr("Probador 3D – WoW Forever"), description: tr("Probador 3D de equipo de WoW Forever."), noindex: true });
