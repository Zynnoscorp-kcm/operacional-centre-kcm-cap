# Plan de pruebas

## Capas

- Unitarias: contratos, cinco digitos, estados, OCR, elegibilidad, examenes y mapeo.
- Integracion: ambas rutas, revision OCR, liberacion parcial, auditoria e idempotencia.
- Concurrencia: dos solicitudes con la misma clave producen un solo efecto.
- Rendimiento: lote sintetico equivalente a 500 registros y OCR de 40 filas.
- Seguridad: roles servidor, formula injection, token, MIME/hash y mensajes genericos.
- Visual: plantilla OCR, recortes de cinco casillas y HTML accesible.
- Geometria: homografia estimada contra verdad de las 200 casillas, error de
  centros e IoU bajo perspectiva, rotacion e iluminacion sinteticas.
- Proveedor local: Tesseract como baseline y Glyph tipografico conservador, con
  ceros iniciales, inferencia aislada de truth/padron, confianza por casilla,
  negativo adversarial y enrutamiento obligatorio a revision.
- Formatos: PNG, JPEG y PDF de una pagina; composicion explicita de transparencia.
- Fronteras: umbrales incompletos/NaN, renglones duplicados o fuera de rango,
  alfa transparente, limites de pixeles, simulacion explicita y copias defensivas.
- Revision: bundle 40 x 5 sin binarios/PII, referencias opacas, hashes,
  asociacion candidato-casilla, endpoint agregado limitado a diez blobs y
  rechazo de IDs Drive aportados por cliente.
- UI: lista accesible, cinco pares, motivo obligatorio, URLs same-origin y
  confirmacion bloqueada hasta diez eventos `load` sin errores ni carreras.
- Preview HTTP: loopback, CSP, JSON obligatorio, origen local y rechazo de rutas
  fuera del conjunto servido.
- Evidencia: 200 pares, 400 blobs, hashes, rollback local, journal Google,
  reintento secuencial/concurrente, payload conflictivo y referencias corruptas.
- Frontera remota: contratos cerrados, HMAC, correlacion/hash, tipos JSON sin
  coercion, 40 x 5, 200 pares, limites, timeout, backoff y errores sanitizados.
- Worker contenedorizado: pipeline Tesseract real, versiones efectivas de motor
  y herramientas, PDF estructural de una pagina, temporal efimero y respuesta
  compatible con el cliente Apps Script.
- Cierre de revision: evidencia completa antes de preliberacion y resolucion
  auditada de renglones fisicos vacios sin crear asistencias ficticias.
- Quiosco: recibo exactamente igual para numero valido, repetido o inexistente;
  sin nombre, area, señal de existencia ni ocupacion exacta; secreto base64url
  fuerte y rechazo fail-closed de configuraciones debiles.
- Recuperacion de quiosco: fallos antes de asistencia, despues de asistencia y
  despues de auditoria; el bootstrap completa un solo journal, asistencia y
  evento.
- Recuperacion OCR: transicion y evento inicial durables, concesion exclusiva,
  candidatos ya persistidos, asistencia faltante y auditorias faltantes.
- Liberacion durable: fallos entre matriz, journal, dominio, auditoria y cierre;
  reanudacion exclusiva por request original; HMAC de plan/fase/resultados;
  marcador ligado a lote y verificacion del efecto antes del dominio.
- Matriz: exactamente un mapeo activo sin cache de commit, marcador SHA publico
  rechazado, contexto sin lote rechazado y commit Google Sheets bloqueado sin CAS.

## Criterios obligatorios

| Caso | Evidencia esperada |
|---|---|
| ID valido y ceros iniciales | Coincidencia unica como cadena |
| ID inexistente | Sin PII ni asistencia valida |
| Duplicado en sesion | Un solo registro efectivo |
| Valido/duplicado/inexistente en quiosco | Mismo recibo generico; sin PII ni señal de existencia |
| Caida parcial del quiosco | Bootstrap repara journal, asistencia y auditoria una sola vez |
| Digital y OCR | Mismo `ParticipantAttendance` |
| OCR dudoso | `REVISION_REQUERIDA` |
| Correccion | Antes/despues/actor/fecha/motivo |
| Examenes | Diferencia igual a personas marcadas |
| Examen faltante | Exclusion individual, no global |
| Identidad/asistencia invalidas | Liberacion bloqueada |
| Reintento/concurrencia | Una sola fecha y un solo efecto |
| Request nuevo con lote pendiente | Rechazo; no adopta marcador ni crea otro lote |
| Sesion revocada, `ERROR` o elegibilidad derivada | Falla antes del primer efecto o de reanudar dominio |
| `phase`, `results` o `journalMac` adulterado | Conflicto antes de cualquier efecto de dominio |
| Fase firmada sin efecto de matriz | Verificacion contra matriz falla cerrada |
| Dos mapeos activos o mapeo cambiado | Commit rechazado sin usar cache anterior |
| Matriz real sin CAS | Solo vista previa; cero escrituras aun con celdas vacias |
| Fecha existente | Conflicto, sin sobreescritura |
| Parcial | Incluidos, excluidos y motivos |
| Auditoria | Reconstruccion cronologica completa |
| 500 registros | Tiempo y conteos documentados |
| Alineacion 40 x 5 | Error medio <= 4 px e IoU medio >= 0.75 |
| PDF | Fondo blanco opaco y normalizacion 1216 x 2002 |
| OCR local dudoso | Sin autoaceptacion incorrecta; revision humana |
| Exactitud por digito | Comparacion contra la casilla original, sin correr blancos |
| Negativo no numerico | Cero autoaceptaciones aun si la lectura coincide con padron |
| Geometria fallback | `PAGE_ALIGNMENT_REVIEW_REQUIRED` |
| PNG transparente | Composicion blanca o rechazo por bajo contraste |
| Umbral invalido | Error explicito; nunca aceptacion permisiva |
| Bundle de revision | 40 filas maximo, cinco slots por candidato, sin padron ni buffers |
| Evidencia cruzada | Rechazo antes de devolver un blob |
| Revision HTML | Diez imagenes cargadas antes de confirmar |
| API local | Solo loopback, mismo origen y `application/json` |
| Evidencia OCR | 40 candidatos, 200 casillas y 400 variantes sin binarios en DTO/Sheets |
| Recuperacion OCR | Repara asistencia y eventos faltantes sin duplicar candidatos ni evidencia |
| Red/timeout remoto | Reintentos acotados; agotamiento sanitizado e idempotente |
| Tipos del worker | Rechazo de indices texto, confianza `null` o blanco con confianza no cero |
| Proveniencia OCR | Versiones efectivas persistidas y recuperables en replay/auditoria |
| Evidencia remota parcial | Cotejo y preliberacion bloqueados hasta completar cinco pares por fila |
| Renglon fisico vacio | Descarte humano con actor, fecha y motivo; sin asistencia creada |
| PDF remoto | `pdfinfo` confirma exactamente una pagina antes de rasterizar |

Los resultados reales de cada ejecucion se registran en
`docs/ESTADO_PROYECTO.md` y el acta correspondiente; este archivo no marca una
prueba como exitosa antes de ejecutarla.

La validacion de DOM, sintaxis, contratos HTTP y carga de imagenes esta
automatizada. La inspeccion visual de `Kiosk.html` y de la revision OCR en un
navegador real sigue siendo obligatoria antes del piloto y debe registrarse por
separado.
