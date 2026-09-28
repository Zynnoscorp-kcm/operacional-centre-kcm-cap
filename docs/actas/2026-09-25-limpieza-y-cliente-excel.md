# Acta · Limpieza del piloto y cliente de Excel

**25 de septiembre de 2026.** Rama `despliegue-nube-local`.

## Base de datos

Se borraron las simulaciones del piloto: sesiones, asistencias, registros del
quiosco, revisiones de preliberación, liberaciones con sus lotes y acuses,
reservas de sala, nonces y su bitácora, más los dos registros de historial que
habían salido de liberaciones simuladas y doce actores de prueba. Las tablas de
sólo agregado se abrieron dentro de la misma transacción y se volvieron a cerrar.

Se conservan el padrón (1 685), el historial de la matriz (9 730) y las
inducciones del padrón (1 684), el catálogo, las salas, la configuración DC-3,
las tres cuentas de consola, los dos PIN y las cinco credenciales de Excel. La
bitácora deja constancia con `DATOS_DE_PRUEBA_BORRADOS`.

## Plataforma

- `main.ts` no conectaba la bitácora de cargas a la base: el historial de cargas
  vivía en memoria y se perdía con cada instancia. Corregido.
- Un curso fuera del catálogo en el quiosco responde «Seleccione un nombre
  válido de la lista.» (400) en lugar de un error interno.

## Cliente de Excel

- 61 avisos y 42 renglones del reporte por etapas reescritos: una línea de
  desenlace, detalle corto, sin vocabulario del programa ni trato de usted.
- El resultado de la actualización completa enseña sólo las cifras distintas de
  cero.
- Panel: campos reordenados (los del equipo del departamento al final), ayudas
  de una línea, cuarta ficha de estado «Envío local», botón «Abrir la
  plataforma» y dibujo con la pantalla quieta.
- Lista de liberaciones: ya no dibuja dos veces encabezado y botones al abrirse.
- El asistente pide `CARPETA_PLATAFORMA` cuando se da una dirección local.
- `KCM-VBA-CRLF` regenerada desde el repositorio.

Nada de lo anterior se ha probado todavía dentro de Excel.
