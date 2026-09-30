# Acta · Nota chica en la fecha y casillas en Liberaciones · 2026-09-30

- `KcmReleaseSync.bas`: tras `AddComment`, `KcmAjustarNota` fija el recuadro a su texto (una línea de hasta 20 caracteres: ancho 30 + 5 por carácter, alto 16; más texto: `AutoSize`). Envuelto en `On Error Resume Next`: el tamaño nunca deshace un lote.
- `KcmEntradas.bas`: la columna MARCA lleva casillas de formulario (`AddFormControl xlCheckBox`) ligadas a la celda, que guarda VERDADERO/FALSO oculto con `;;;`. Se rehacen al actualizar y al limpiar; las escritas no llevan casilla. «Marcar todas» palomea las pendientes. Una marca de texto previa sigue contando.
- Evidencia: `npm run check:vba` sin hallazgos; `npm test` 118/118. Pendiente: importar en el libro y probar en Excel (Mac y Windows).

## Corrección, mismo día

- En el Excel del usuario la columna seguía viéndose como texto: los controles de formulario no aparecieron. Las casillas pasan a ser formas redondeadas con `OnAction = "KcmEntradasAlternar"` (mismo mecanismo que los botones del panel); el clic cambia VERDADERO/FALSO en la celda y repinta la forma (azul con ✓ o blanca).
- La columna IDENTIFICADOR (H) queda oculta y sin título; el curso (D) se ensancha lo que ocupaba. El identificador se conserva porque es lo que filtra la escritura.
- Evidencia: `npm run check:vba` sin hallazgos; `npm test` 118/118. Pendiente: probar en Excel.
