# Diccionario inicial de la matriz de competencias

## Alcance y fuentes

Analisis de solo lectura sobre el XLSB original y su copia convertida a XLSX. No
se copiaron valores de empleados a este documento ni a salidas del analizador.

- XLSB SHA-256: `f8325b056162362bc8e0615cc2a608d3a6ee438f9207f70a1689ec3eeb464be0`.
- XLSX SHA-256: `649a49b99c90efeb65bc3a7f87e88872df3688a11d621206cf89d4da6c062813`.
- Analizador reproducible: `node scripts/analyze-matrix.js`.

## Hojas

| Hoja | Visibilidad | Rango usado | Combinadas | Formulas | Formulas con vinculo externo |
|---|---:|---:|---:|---:|---:|
| Bajas | Oculta | A1:DR205 | 0 | 853 | 629 |
| Hoja1 | Visible | A3:K28 | 0 | 0 | 0 |
| HC | Visible | A1:DR1693 | 7 | 2,415 | 702 |
| Calidad | Visible | A1:I151 | 8 | 544 | 0 |
| Seguridad (con espacio final) | Oculta | A1:E25 | 1 | 92 | 0 |
| Seguridad | Visible | A2:F18 | 1 | 64 | 0 |
| Adicional (con espacio final) | Visible | A2:F8 | 1 | 24 | 0 |
| Reinduccion (con espacio final) | Oculta | A1:E25 | 1 | 69 | 0 |

El libro declara 37 referencias externas. Esto impide tratar la conversion como
una base transaccional equivalente sin reconciliar sus dependencias.

## Hoja HC verificada

Los encabezados estan en la fila 3 y los registros comienzan en la fila 4.

| Columna | Encabezado verificado | Interpretacion inicial |
|---|---|---|
| B | No. | Numero de trabajador; debe importarse como texto de cinco digitos |
| C | Nombre | Nombre de consulta, no identificador primario |
| D | Fecha de ingreso | Fecha laboral |
| E | Nomina | Tipo de nomina |
| F | Puesto | Puesto |
| G | Depto | Departamento |
| H | Area | Area |
| I | Planta | Planta |
| J:AJ | 27 encabezados de cursos | Fechas de capacitacion |

La hipotesis inicial queda corregida en un punto: departamento esta en `G` y
area en `H`; el resto de B:I coincide. Las capacitaciones efectivamente empiezan
en J. Las celdas pobladas de cursos usan mayoritariamente el formato
`dd/mm/yyyy`. Existen encabezados repetidos y celdas combinadas (`B1:G2`,
`J1:J2`, `L1:L2`, `M1:M2`, `O1:O2`, `P1:P2`, `Q1:Q2`), por lo que el nombre del
curso por si solo no es una clave suficiente.

## Mapeo configurable

`MATRIZ_MAPEO` debe contener al menos:

| Campo | Regla |
|---|---|
| mappingId | UUID estable |
| trainingId | ID interno del catalogo |
| matrixSheet | Hoja destino, inicialmente HC |
| matrixColumn | Letra o indice resuelto, nunca inferido por texto al liberar |
| matrixHeaderExpected | Encabezado normalizado usado para validar drift |
| effectiveFrom/effectiveTo | Vigencia |
| mappingVersion | Parte de la clave idempotente |
| overwritePolicy | `NO_OVERWRITE` por defecto |

## Migracion propuesta a Google Sheets

1. Conservar el XLSB original como evidencia de solo lectura.
2. Congelar una exportacion XLSX/CSV y verificar conteos y hashes.
3. Importar padron y catalogo a hojas normalizadas, preservando `No.` como texto.
4. Crear `MATRIZ_MAPEO` con revision humana, especialmente para encabezados
   repetidos o columnas con anio asociado.
5. Ejecutar `MatrixGateway` en modo vista previa contra una copia autorizada.
6. Reconciliar conteos y muestras enmascaradas antes de habilitar escritura.
7. Mantener `NO_OVERWRITE`; conflictos se envian a revision. El adaptador
   directo de Google Sheets permanece en solo lectura hasta contar con una
   precondicion CAS que impida carreras con editores externos.
