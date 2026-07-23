# Plantilla geométrica OCR

Estado: **VERIFICADO para geometria y transformacion real de pixeles** en PNG,
JPEG y PDF local de una pagina. Tesseract y Glyph conservador estan
**VERIFICADOS EN BANCO SINTETICO**, no aprobados para escritura manuscrita o
piloto.

## Evidencia inspeccionada

- `referencias/formato/Formato_Control_Asistencia_OCR.docx`: inspección estructural OOXML.
- `referencias/formato/Formato_Control_Asistencia_OCR.pdf`: una página, `MediaBox [0 0 612 1008]`, tamaño Legal vertical (8.5 × 14 pulgadas).
- `referencias/formato/Formato_Control_Asistencia_OCR.png`: inspección visual del render existente a 1216 × 2002 px y 143 dpi.
- `referencias/privado/listas/IMG_0102.jpg`: revisión visual únicamente local para reconocer riesgos de captura. No se extrajeron ni registraron nombres, números, firmas u otros valores.

El PDF se rasterizo nuevamente con el adaptador macOS `sips` a 1216 x 2002. El
render nativo conserva el fondo como transparencia; el adaptador lo compone de
forma explicita sobre blanco. La salida opaca fue inspeccionada visualmente en
`artifacts/ocr-public/pdf/template-rasterized.png`. Poppler y LibreOffice siguen
sin estar disponibles en este entorno.

## Página y márgenes

El OOXML declara página Legal vertical de 12240 × 20160 twips. Los márgenes son: izquierdo 979 twips (17.27 mm), superior 173 twips (3.05 mm), derecho 216 twips (3.81 mm) e inferior 29 twips (0.51 mm). El margen izquierdo es deliberadamente mayor y deja espacio para perforación; los otros tres son mínimos.

La tabla de participantes usa 11016 twips de ancho. En el render su borde izquierdo está en x=95 y el derecho en x=1190. Las líneas verticales largas detectadas están en x=95, 131, 281, 603, 738, 889, 1067/1068, 1129 y 1189 px. Esto confirma las columnas No., Número de nómina, Nombre, Puesto, Departamento, Firma, Calificación y Turno.

## Contenido visual verificado

La página contiene logo y razón social, planta, título “Control de Asistencia”, código de sesión, fecha, duración, hoja, ubicación, tema o evento, tipo de evento en dos renglones, las clasificaciones originales, tipo de evaluación, cuarenta participantes, cinco casillas separadas para nómina, nombre, puesto, departamento, firma, calificación, turno, nombre o firma del instructor, exámenes entregados, total de asistentes y la nota de control. La cuadrícula de participantes no presenta recortes, sobreposición ni filas fuera de página en el PNG inspeccionado.

Regiones principales en píxeles del render de referencia:

| Región | x | y | ancho | alto |
|---|---:|---:|---:|---:|
| Marca | 116 | 18 | 806 | 51 |
| Código de sesión | 976 | 17 | 216 | 56 |
| Título | 509 | 75 | 306 | 35 |
| Metadatos de sesión | 95 | 113 | 1095 | 35 |
| Tipo de evento | 94 | 149 | 1096 | 48 |
| Tipo de evaluación | 95 | 198 | 1095 | 15 |
| Encabezado de participantes | 95 | 214 | 1095 | 51 |
| Filas de participantes | 95 | 265 | 1095 | 1668 |
| Instructor | 95 | 1934 | 644 | 29 |
| Conteos de exámenes/asistentes | 739 | 1934 | 451 | 30 |
| Nota | 96 | 1967 | 1094 | 18 |

Las regiones son referencias aproximadas para alineación y revisión; los límites de filas y casillas que siguen son coordenadas detectadas y constituyen el contrato operativo.

## Contrato exacto 40 × 5

El origen `(0,0)` está arriba a la izquierda. Los rectángulos usan límite derecho e inferior exclusivo. Las coordenadas normalizadas se calculan contra ancho 1216 y alto 2002, respectivamente. `buildTemplateMap()` entrega para cada una de las 200 casillas `visualRect`, `visualRectNormalized`, `recognitionRect` y `recognitionRectNormalized`; así no es necesario mantener una segunda tabla derivada.

Las cinco posiciones x se combinan cartesiana y ordenadamente con cada una de las cuarenta posiciones y:

| Dígito | x | ancho | x normalizada | ancho normalizado |
|---:|---:|---:|---:|---:|
| 1 | 140 | 26 | 0.11513158 | 0.02138158 |
| 2 | 167 | 25 | 0.13733553 | 0.02055921 |
| 3 | 193 | 26 | 0.15871711 | 0.02138158 |
| 4 | 220 | 25 | 0.18092105 | 0.02055921 |
| 5 | 246 | 26 | 0.20230263 | 0.02138158 |

| Fila | y superior fila | y inferior fila | y casilla | alto casilla | y casilla normalizada |
|---:|---:|---:|---:|---:|---:|
| 1 | 265 | 306 | 270 | 31 | 0.13486513 |
| 2 | 306 | 348 | 311 | 31 | 0.15534466 |
| 3 | 348 | 389 | 353 | 31 | 0.17632368 |
| 4 | 389 | 431 | 394 | 31 | 0.19680320 |
| 5 | 431 | 473 | 436 | 31 | 0.21778222 |
| 6 | 473 | 515 | 478 | 31 | 0.23876124 |
| 7 | 515 | 556 | 520 | 31 | 0.25974026 |
| 8 | 556 | 598 | 561 | 31 | 0.28021978 |
| 9 | 598 | 640 | 603 | 31 | 0.30119880 |
| 10 | 640 | 681 | 645 | 31 | 0.32217782 |
| 11 | 681 | 723 | 686 | 31 | 0.34265734 |
| 12 | 723 | 765 | 728 | 31 | 0.36363636 |
| 13 | 765 | 807 | 770 | 31 | 0.38461538 |
| 14 | 807 | 848 | 812 | 31 | 0.40559441 |
| 15 | 848 | 890 | 853 | 31 | 0.42607393 |
| 16 | 890 | 932 | 895 | 31 | 0.44705295 |
| 17 | 932 | 973 | 937 | 31 | 0.46803197 |
| 18 | 973 | 1015 | 978 | 31 | 0.48851149 |
| 19 | 1015 | 1057 | 1020 | 31 | 0.50949051 |
| 20 | 1057 | 1099 | 1062 | 31 | 0.53046953 |
| 21 | 1099 | 1140 | 1104 | 31 | 0.55144855 |
| 22 | 1140 | 1182 | 1145 | 31 | 0.57192807 |
| 23 | 1182 | 1224 | 1187 | 31 | 0.59290709 |
| 24 | 1224 | 1265 | 1229 | 31 | 0.61388611 |
| 25 | 1265 | 1307 | 1270 | 31 | 0.63436563 |
| 26 | 1307 | 1349 | 1312 | 31 | 0.65534466 |
| 27 | 1349 | 1390 | 1354 | 31 | 0.67632368 |
| 28 | 1390 | 1432 | 1395 | 31 | 0.69680320 |
| 29 | 1432 | 1474 | 1437 | 31 | 0.71778222 |
| 30 | 1474 | 1516 | 1479 | 31 | 0.73876124 |
| 31 | 1516 | 1557 | 1521 | 31 | 0.75974026 |
| 32 | 1557 | 1599 | 1562 | 31 | 0.78021978 |
| 33 | 1599 | 1641 | 1604 | 31 | 0.80119880 |
| 34 | 1641 | 1682 | 1646 | 31 | 0.82217782 |
| 35 | 1682 | 1724 | 1687 | 31 | 0.84265734 |
| 36 | 1724 | 1766 | 1729 | 31 | 0.86363636 |
| 37 | 1766 | 1808 | 1771 | 31 | 0.88461538 |
| 38 | 1808 | 1849 | 1813 | 31 | 0.90559441 |
| 39 | 1849 | 1891 | 1854 | 31 | 0.92607393 |
| 40 | 1891 | 1933 | 1896 | 31 | 0.94705295 |

El alto normalizado de todas las casillas es 0.01548452. El mapa aplica un
`inset` de 2 px a cada lado y el extractor local aplica 2 px interiores
adicionales para evitar sangrado de la linea impresa tras interpolar. Un detector
de tinta en el recorte exterior evita descartar silenciosamente trazos pegados al
borde y los fuerza a revision. La primera
casilla visible `(140,270,26,31)` conserva ese rectangulo para revision, parte de
`(142,272,22,27)` y reconoce el interior efectivo. Los cinco recortes ampliados
se ordenan siempre por fila y digito, con vista original y procesada lado a lado.

Fuente ejecutable: `src/ocr/config/template-geometry.js`. El arreglo exacto de 41 límites y la función de escalado están versionados como `formato-ocr-v6-1`.

## Flujo de normalización

El orden implementado es: decodificar o rasterizar, normalizar orientacion EXIF,
detectar el cuadrilatero mediante un modelo robusto de iluminacion del fondo,
corregir perspectiva por homografia inversa, remuestrear a 1216 x 2002,
normalizar escala de grises/contraste y aplicar el mapa fijo. La ruta real declara
`PIXEL_HOMOGRAPHY_V1` y `pixelTransformApplied=true`; la ruta historica simulada
se conserva solamente para pruebas unitarias aisladas.

La fotografía privada de referencia confirmó riesgos generales que este orden debe cubrir: perspectiva, rotación, iluminación no uniforme, sombras, obstrucciones parciales y trazos que pueden cruzar celdas. Además corresponde a un formato histórico sin las cinco casillas separadas, por lo que no debe usarse como plantilla geométrica ni como fixture del formato nuevo.

## Decisión OCR y revisión

- El proveedor simulado aísla reglas de dominio; Tesseract 5.5.2 es el baseline
  por casilla y Glyph compara contra un banco tipografico sin usar verdad ni
  padron durante inferencia. Glyph limita su confianza a 0.93 y obliga revision.
- Sólo se autoacepta un texto de exactamente cinco dígitos, con confianza completa ≥0.96, cada dígito ≥0.94, coincidencia activa en padrón y sin duplicado en el documento.
- Blanco detectado se descarta; fila no detectada, formato inválido, confianza baja, número inexistente/inactivo o duplicado siempre requiere revisión.
- Una corrección humana exige cinco dígitos, coincidencia activa, actor y motivo; conserva valor original, corregido, actor, fecha y motivo.
- Los umbrales están centralizados en `DEFAULT_OCR_THRESHOLDS` y no dispersos en la UI.

## Banco sintético y métricas

`src/ocr/testing/synthetic-fixture.js` conserva la cuadrícula mínima usada por el
demo. `src/ocr/testing/distorted-fixture.js` usa la plantilla pública vacía,
números ficticios, perspectiva, rotación, gradiente, viñeta y ruido con semilla;
además entrega la homografía verdadera de las 200 casillas. El banco local real
se ejecuta con `scripts/measure-local-ocr.js` y sus artefactos seguros quedan en
`artifacts/ocr-public/local-bank-v1/`.

Métricas implementadas: error geometrico e IoU, exactitud del número completo,
exactitud por dígito, aceptación falsa, revisión manual, detección correcta de
renglones y tiempo por hoja. La fotografía privada queda fuera del banco
automatizado y de toda salida. Las cifras locales actuales se detallan en
`docs/OCR_LOCAL.md` y no estiman precisión manuscrita.
