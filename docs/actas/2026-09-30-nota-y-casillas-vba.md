# Acta · Nota chica en la fecha y casillas en Liberaciones · 2026-09-30

- `KcmReleaseSync.bas`: tras `AddComment`, `KcmAjustarNota` fija el recuadro a su texto (una línea de hasta 20 caracteres: ancho 30 + 5 por carácter, alto 16; más texto: `AutoSize`). Envuelto en `On Error Resume Next`: el tamaño nunca deshace un lote.
- `KcmEntradas.bas`: la columna MARCA lleva casillas de formulario (`AddFormControl xlCheckBox`) ligadas a la celda, que guarda VERDADERO/FALSO oculto con `;;;`. Se rehacen al actualizar y al limpiar; las escritas no llevan casilla. «Marcar todas» palomea las pendientes. Una marca de texto previa sigue contando.
- Evidencia: `npm run check:vba` sin hallazgos; `npm test` 118/118. Pendiente: importar en el libro y probar en Excel (Mac y Windows).
