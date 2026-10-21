# Calculadora Forever

Planificador y simulador de talentos para **WoW Forever**, con datos extraídos del cliente de la beta. Proyecto de fans, **no oficial**: no está afiliado ni respaldado por Blizzard Entertainment. World of Warcraft es marca registrada de Blizzard Entertainment, Inc.; nombres y textos de hechizos © Blizzard.

Web estática (React + TypeScript + Vite), sin servidor: se despliega en GitHub Pages con el workflow de `.github/workflows`.

## Qué hay

- Flujo en pasos: Raza (pronto) → **Legacy** → **Clase y talentos** → **Resumen**. Legacy va primero porque *Talentoso* adelanta el primer punto de talento y cambia el nivel que exigen los talentos de clase.
- Árboles de las 9 clases (466 talentos) con las reglas del propio cliente: 51 puntos, 5 puntos por fila, prerrequisitos. Legacy: 3 árboles, 16 puntos de cuenta que se suman a los de clase.
- «Copiar build para IA» (Theorycraft) con el texto completo de cada talento.
- Iconos y descripciones de cada talento por rango, con los valores calculados a partir de los datos del cliente.
- Enlace compartible con el build (`#/class/mage?b=…`).
- Nodos que el cliente trae pero no están activos: visibles, marcados "nodo no activo" y no seleccionables. Datos sin asignar (árboles descartados en cuadrícula y talentos sin nodo) en una sección aparte (`#/unassigned`) con prueba libre de rangos.
- Pendiente: valores exactos según el nivel, estadísticas por raza y clase, daño/curación/costes, builds de equipo. Las novedades y el siguiente paso se comentan en los issues.

## Ejecutar

```
npm install
npm run dev -w @wfuc/web      # http://localhost:5173
npm test                      # motor + pipeline (el pipeline necesita data/raw, solo en local)
npm run build -w @wfuc/web    # sitio estático en apps/web/dist
```

## Estructura

| Ruta | Contenido |
|---|---|
| `apps/web` | La web (React + Vite) |
| `packages/engine` | Reglas de talentos y códigos de build, TypeScript puro |
| `packages/schema` | Esquemas (zod) compartidos |
| `packages/data-pipeline` | Convierte los CSV del cliente en JSON normalizado |
| `data/forever/<build>/` | JSON normalizado que lee la web (versionado) |
| `tools/extract` | Extracción del cliente, **solo lectura** |

## Contribuir y licencia

Proyecto **comunitario y gratuito**: consultarlo y contribuir es libre. Lee [CONTRIBUTING.md](CONTRIBUTING.md). El mantenedor tiene la decisión final sobre el proyecto.

Licencia: [PolyForm Strict 1.0.0](LICENSE) más los avisos y el permiso para contribuir de [LICENSE-ADDENDUM.md](LICENSE-ADDENDUM.md). Resumen: **uso no comercial; no se permite copiar, redistribuir ni publicar versiones modificadas** fuera de este repositorio. Es *source-available*, no código abierto.

## Datos y créditos

- Fuente de verdad: el cliente de la beta (build 1.60.1.70425), leído sin modificarlo.
- Avisos de terceros exigidos por licencia: [NOTICE.md](NOTICE.md).
