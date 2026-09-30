# Acta · Código sin comentarios · 2026-09-30

- Pedido: dejar el código limpio, sin anotaciones ni divisores, idéntico en comportamiento.
- Alcance: 359 archivos rastreados (`.ts`, `.js`, `.mjs`, `.gs`, `.css`, `.bas`, `.cls`, `.sh`, `.yml`, `.yaml`, `Dockerfile*`, `*ignore`, `.gitattributes`, HTML de Apps Script). Los comentarios se localizaron con el analizador de TypeScript, no con expresiones regulares, para no confundir texto dentro de cadenas o expresiones regulares.
- Se conservan: directivas `eslint-disable` (sin su explicación) y `prettier-ignore` de `agenda.ts`, que protege el valor del `<textarea>`; un comentario en cada `catch` vacío (regla `no-empty`); el hexadecimal de las constantes `COLOR_*` de `KcmPanel.bas` (lo exige `vba-paleta.test.js`).
- Ajuste de prueba: `vba-client-contract.test.js` buscaba `KcmTransmitirMatriz` en `KcmJornada.bas`, donde sólo aparecía en un comentario; ahora comprueba que `KcmMatrixPanel.bas` lo declare.
- Excluidos: `docs/`, `database/` (las migraciones aplicadas no se reescriben), `referencias/`, `artifacts/`, `AGENTS.md`, `README*`, `PROMPT_MAESTRO.xml`.
- Evidencia: comparación de tokens contra `HEAD` en cada archivo: iguales salvo paréntesis de agrupación, una coma final y un `;` en un tipo literal que Prettier normalizó al desaparecer los comentarios; VBA idéntico línea por línea sin comentarios. Typecheck limpio; linter con los mismos 163 errores heredados; Prettier limpio; `npm test` 118/118; plataforma 785/785; `check:vba` sin hallazgos.
