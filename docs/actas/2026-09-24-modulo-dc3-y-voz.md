# Acta · Módulo DC-3, voz de la consola y tipografía

**22 al 24 de septiembre de 2026.** Rama `despliegue-nube-local`.

Registro breve de los movimientos de la sesión.

## Movimientos

1. **Skills.** Se instaló `emilkowalski/skill` y se conservó sólo `apple-design`.
   Legible por cualquier agente del proyecto; excluida de la entrega por
   `.gitignore` y `.dockerignore` (`.agents/`, `.claude/skills/`,
   `skills-lock.json`).

2. **Tipografía y contraste.** `--kcm-muted` a `#4a5a78` (6.94:1) y
   `--capta-tenue` a `#515f80` (6.37:1); tamaños de apoyo a 0.875 rem con peso
   500; opacidades del quiosco subidas. Se probó la pila de fuente del sistema y
   **se revirtió**: se vio demasiado gruesa. `COLOR_APAGADO` del VBA sincronizado.

3. **Apagado.** Sin franja roja, sin vista comprimida y sin texto de sobra.
   Quedó como emergente `:target` sin JavaScript: confirmación, rueda de doce
   trazos, palomita animada y «Servidor local apagado». El formulario manda a
   `POST /`, así que el acuse no cambia de dirección.

4. **Voz.** Reescritura de los textos de toda la consola y de nueve módulos del
   libro de Excel (unos 45 mensajes). Reglas en
   [`VOZ_DE_LA_CONSOLA.md`](../referencia/VOZ_DE_LA_CONSOLA.md) y guarda
   automática en `tests/estilo/voz.test.ts`.

5. **Módulo DC-3.** De una pantalla a cuatro: Emisión, Panel, Lote e Historial.
   Lista poblada al abrir —desaparece «Revisar el plan»—, paginación real,
   emisión múltiple en ZIP propio (`server/zip.ts`), filtro de emitidas contra la
   bitácora, CSV de pendientes y de historial, cobertura por curso con
   `<progress>`. Documentado en
   [`DC3_AUTOMATIZACION.md`](../referencia/DC3_AUTOMATIZACION.md).

6. **Texto muerto.** Empezó la depuración de las explicaciones largas que
   quedaron en las pantallas del módulo DC-3. **En curso.**

## Estado

607 pruebas de plataforma y 127 unitarias en verde; typecheck, guardas y
Prettier conformes. `npm run verify` sigue fallando por 160 errores de ESLint
preexistentes en diez archivos de otro frente de trabajo.
