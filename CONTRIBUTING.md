# Cómo contribuir

¡Gracias por querer ayudar! Esto es un proyecto **comunitario y gratuito**: consultarlo y contribuir es libre para todos. El mantenedor ([@MattJCR](https://github.com/MattJCR)) **tiene la decisión final** sobre qué se acepta y hacia dónde va el proyecto. Si no se acepta algo, se explicará el motivo, pero la decisión no se negocia.

> **Antes de nada, lee la licencia** ([LICENSE](LICENSE) y [LICENSE-ADDENDUM.md](LICENSE-ADDENDUM.md)): el proyecto es de uso no comercial y **no se puede copiar, redistribuir ni publicar versiones modificadas** fuera de este repositorio. Hacer un fork es solo para preparar una contribución.

## Formas de ayudar (sin escribir código)

- **Reportar errores**: abre un *issue* con la clase, el talento o la habilidad, lo que ves y lo que esperabas. Una captura o el enlace del build (`/es/clases/mago/?b=…`) ayuda mucho.
- **Contrastar datos con la beta**: si en el juego un número, un coste o un efecto no coincide con la web, dilo con la prueba (captura, texto del tooltip, build del cliente). Es lo más valioso: **el cliente manda**.
- **Revisar textos** en español y proponer traducciones de lo que el cliente aún trae en inglés (`data/i18n/`).
- **Sugerir funciones** (estadísticas, daño, curación, builds de equipo…): primero un issue para comentarlo.

## Reglas del proyecto

1. **El cliente de WoW es la fuente de verdad.** Cualquier web externa solo sirve para contrastar; pueden estar desactualizadas.
2. **Cada fórmula lleva procedencia y confianza**: `client-db2` | `community` | `beta-measured` | `assumption`. Lo no confirmado se muestra como estimación.
3. **No se descarta nada en silencio**: lo que el cliente trae pero no está activo se conserva y se marca; lo que otras fuentes no listan se conserva y se marca.
4. **Todas las habilidades se revisan con el mismo criterio** (alcance por máscara, mejora visible en la descripción, cifras que salen del texto del cliente, crítico solo en daño/sanación); lo fija `packages/engine/test/talent-ability-audit.test.ts`.
5. **La web está solo en español.** Los textos en inglés del cliente se traducen en `data/i18n/` y se marcan como traducción propia.
6. **Nunca subas contenido extraído del cliente en bruto** (`data/raw/`, ya excluido por `.gitignore`), ni binarios del juego, ni cuentas, ni claves.

> **Seguridad con el cliente:** quien extraiga datos del cliente de WoW lo hace en **solo lectura**. Nunca modifiques, muevas ni borres nada de la carpeta del juego, ni lances el cliente con herramientas de terceros que lo alteren: hay riesgo de baneo.

## Preparar un entorno

```
git clone https://github.com/MattJCR/wowforeverultimatecalculator.git
cd wowforeverultimatecalculator
npm install
npm run dev -w @wfuc/web     # http://localhost:5173
npm test -w @wfuc/engine     # pruebas del motor (necesitan datos de contraste locales del mantenedor)
npm run typecheck            # tipos de todos los paquetes
```

Necesitas Node 22 o superior. Las pruebas de `packages/data-pipeline` necesitan los CSV en bruto del cliente (`data/raw/`), que no se suben; si no los tienes, el CI y yo las ejecutamos por ti.

Mapa de carpetas: está en la tabla «Estructura» del [README](README.md).

## Enviar una contribución

1. Abre (o comenta) un **issue** si el cambio es grande, para no trabajar en balde.
2. Haz un fork **solo para contribuir** y crea una rama (`fix/nombre-corto`, `feat/nombre-corto`).
3. Cambios **pequeños y centrados**: un tema por *pull request*.
4. Antes de abrir el PR: `npm run typecheck` y `npm test -w @wfuc/engine` en verde. Si tocas datos o reglas de talentos, pasa también la auditoría de habilidades y explica qué listas cambian.
5. En el PR explica **qué cambia, por qué y de dónde sale el dato** (cliente, la referencia, captura de la beta…).
6. Si cambias algo relevante, descríbelo bien en el PR; el mantenedor lleva el seguimiento del estado.

Los datos de `data/forever/<build>/` se **regeneran** con `npm run pipeline`; no se editan a mano. Las reglas de talentos clasificadas a mano viven en `data/rules/`.

## Acuerdo de contribución

Al enviar una contribución (código, datos, textos, traducciones…):

- Declaras que es **tuya** o que tienes derecho a aportarla, y que no incluye material copiado de terceros con licencia incompatible ni contenido en bruto del cliente.
- **Cedes al mantenedor una licencia perpetua, mundial, gratuita e irrevocable** para usar, modificar, distribuir y **relicenciar** tu contribución como parte del proyecto, bajo la licencia actual o cualquier otra que el mantenedor decida más adelante. Conservas la autoría y se te citará en los créditos si lo deseas.
- Entiendes que la contribución puede rechazarse, modificarse o retirarse en cualquier momento.

## Trato

Sé respetuoso y constructivo. Se puede discrepar de forma educada; los comentarios ofensivos, el acoso o el spam se eliminan y pueden suponer el bloqueo del usuario.

## Ayuda

Abre un issue con la etiqueta de pregunta. Para algo privado, escribe al mantenedor a través de su perfil de GitHub.
