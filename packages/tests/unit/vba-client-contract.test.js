import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const files = [
  "KcmBridgeCore.bas", "KcmBridgeHttp.bas", "KcmMatrixSync.bas",
  "KcmReleaseSync.bas", "KcmActualizador.bas",
  "KcmMatrixPanel.bas", "KcmPadronSync.bas", "KcmJornada.bas",
  "KcmPlataforma.bas", "KcmCodec.bas", "KcmDiccionario.cls", "KcmPruebas.bas",
  "KcmEntradas.bas",
  "KcmAvisos.bas", "KcmPanel.bas", "KcmConfigButtons.bas", "KcmAsistente.bas",
];
const modules = Object.fromEntries(await Promise.all(files.map(async (file) => [
  file, await readFile(`clients/excel/vba/${file}`, "utf8")
])));
const everything = Object.values(modules).join("\n");

test("el cliente es uno solo con modulos separados y sin secreto incrustado", () => {
  for (const [file, source] of Object.entries(modules)) {
    assert.match(source, /Option Explicit/, `${file} exige declaraciones explicitas`);
    assert.doesNotMatch(source, /\/\*|\*\//, `${file} usa comentarios validos de VBA`);
  }
  assert.match(modules["KcmJornada.bas"], /KcmApplyPendingReleases/);
  assert.match(modules["KcmMatrixPanel.bas"], /Public Sub KcmTransmitirMatriz\(\)/);
  assert.match(modules["KcmBridgeHttp.bas"], /token = KcmCredencialLeer\(\)/);
  assert.match(modules["KcmPlataforma.bas"], /Environment\("USER"\)\(KCM_TOKEN_ENV\)/);
  assert.match(modules["KcmPlataforma.bas"], /security.*find-generic-password/s);
  assert.doesNotMatch(everything, /UqU7cJ-_HnsNA3fRtMy/);
});

test("el cliente VBA no emite constancias DC-3", () => {
  for (const [file, source] of Object.entries(modules)) {
    const code = source.split(/\r?\n/).filter((line) => !/^\s*'/.test(line)).join("\n");
    assert.doesNotMatch(code, /Dc3|DC3/, `${file} conserva codigo de DC-3`);
    assert.doesNotMatch(code, /DC3_TEMPLATE_PATH|DC3_OUTPUT_PATH/,
      `${file} conserva la emision de documentos`);
    if (file !== "KcmPlataforma.bas") {
      assert.doesNotMatch(code, /FileCopy/, `${file} copia archivos`);
    }
  }
  assert.doesNotMatch(everything, /CUTOFF_DATE/,
    "la fecha de corte solo servia a la DC-3 y la resuelve el generador Node");
});

test("ROSTER_PATH sirve al barrido del padron y no a la emision", () => {
  const permitidos = new Set([
    "KcmBridgeCore.bas", "KcmPadronSync.bas", "KcmJornada.bas", "KcmPanel.bas"
  ]);
  for (const [file, source] of Object.entries(modules)) {
    const code = source.split(/\r?\n/).filter((line) => !/^\s*'/.test(line)).join("\n");
    if (permitidos.has(file)) continue;
    assert.doesNotMatch(code, /ROSTER_PATH/, `${file} no deberia conocer la ruta del padron`);
  }
  const barrido = modules["KcmPadronSync.bas"];
  assert.ok(barrido, "falta el modulo del barrido del padron");
  assert.match(barrido, /KcmFileBase64/, "el barrido debe entregar los bytes del archivo");
  assert.match(barrido, /ROSTER_SCAN_V1/, "el barrido debe usar la accion de solo lectura");
  assert.doesNotMatch(barrido, /Workbooks\.Open|KcmOpenMaster/,
    "el barrido no debe abrir el padron en Excel: dispararia sus formulas y sus vinculos");

  const jornada = modules["KcmJornada.bas"];
  assert.ok(jornada, "falta el modulo de la jornada");
  assert.doesNotMatch(jornada, /KcmFileBase64|Workbooks\.Open|KcmOpenMaster/,
    "la jornada declara la ruta del padron, pero leer el archivo le toca al barrido");

  const fijar = jornada.slice(jornada.indexOf("Public Sub KcmJornadaFijar"));
  assert.match(fijar.slice(0, fijar.indexOf("End Sub")), /KcmResetCaches/,
    "fijar una clave debe vaciar la cache de configuracion");
  const semanal = jornada.slice(jornada.indexOf("Public Sub KcmPadronDeLaSemana"));
  const cuerpoSemanal = semanal.slice(0, semanal.indexOf("End Sub"));
  assert.ok(
    cuerpoSemanal.indexOf("KcmResetCaches") > -1 &&
      cuerpoSemanal.indexOf("KcmResetCaches") < cuerpoSemanal.indexOf('KcmJornadaValor("ROSTER_PATH")'),
    "Padron de la semana debe leer ROSTER_PATH de configuracion fresca"
  );

  const panel = modules["KcmPanel.bas"];
  assert.ok(panel, "falta el modulo del panel");
  assert.doesNotMatch(panel, /KcmFileBase64|Workbooks\.Open|KcmOpenMaster/,
    "el panel rotula la ruta del padron, pero no abre ni lee el archivo");
});

test("el analisis estatico de las fuentes VBA no reporta hallazgos", () => {
  const result = spawnSync(process.execPath, ["tools/check/vba.js"], { encoding: "utf8" });
  assert.equal(result.status, 0, `tools/check/vba.js reporto:\n${result.stderr}`);
});

test("las fuentes respetan el limite de continuaciones del editor VBA", () => {
  for (const [file, source] of Object.entries(modules)) {
    let continuations = 0;
    let maximum = 0;
    for (const line of source.split(/\r?\n/)) {
      if (/ _\s*$/.test(line)) {
        continuations += 1;
        maximum = Math.max(maximum, continuations);
      } else {
        continuations = 0;
      }
    }
    assert.ok(maximum <= 24, `${file} usa ${maximum} continuaciones consecutivas`);
  }
});

test("las fuentes son ASCII puro para sobrevivir la importacion del editor VBA", () => {
  for (const [file, source] of Object.entries(modules)) {
    const match = /[^\x00-\x7F]/.exec(source);
    assert.equal(match, null,
      `${file} contiene ${JSON.stringify(match?.[0])}; use ChrW$ en su lugar`);
  }
  for (const [file, source] of Object.entries(modules)) {
    if (file === "KcmPruebas.bas") continue;
    assert.doesNotMatch(source, /ChrW\$/, `${file} construye un caracter fuera de ASCII`);
  }
  assert.match(modules["KcmPruebas.bas"], /ChrW\$\(209\)/, "la enie del vector va por codigo");
});

test("la liberacion VBA decide por la fecha de la celda y conserva la nota que ya estaba", () => {
  const source = modules["KcmReleaseSync.bas"];
  assert.match(source, /KcmNotaConMarcador/);
  assert.match(source, /KcmNotaSinMarcador/);
  assert.doesNotMatch(source, /nota ajena/);
  assert.doesNotMatch(source, /currentComment = marker/);
});

test("la nota de cada fecha liberada dice el codigo de su sesion", () => {
  const source = modules["KcmReleaseSync.bas"];
  assert.match(source, /target\.AddComment KcmNotaConMarcador\(previousNote, KcmNotaDeLaSesion\(row\)\)/);
  const aplicar = source.slice(source.indexOf("Public Sub KcmApplyPendingReleases"));
  const cuerpo = aplicar.slice(0, aplicar.indexOf("End Sub"));
  const consulta = cuerpo.indexOf("Set codigos = KcmCodigosDeSesion()");
  assert.ok(consulta > 0 && consulta < cuerpo.indexOf("KcmOpenMaster"),
    "el codigo de sesion debe conocerse antes de tocar la matriz");
  assert.match(source, /KcmHttpPost\("RELEASE_SESSIONS_V1", ""\)/);
  assert.match(source, /"idempotencyKey", "batchId", "sessionId", "employeeId", "trainingId", _\r?\n\s+"completionDate", "destinationSheet", "destinationColumn", "headerRow", _\r?\n\s+"destinationHeader", "targetMappingVersion", "overwritePolicy"\)/);
  const linea = source.slice(source.indexOf("Private Function KcmEsLineaDeLaPlataforma"));
  const reconoce = linea.slice(0, linea.indexOf("End Function"));
  assert.match(reconoce, /Like "KC-####"/);
  assert.match(reconoce, /KCM_MARKER_PREFIX/);
  const nota = source.slice(source.indexOf("Private Function KcmNotaDeLaSesion"));
  assert.match(nota.slice(0, nota.indexOf("End Function")), /KcmReleaseMarker\(row\)/);
});

test("la liberacion VBA hace preflight atomico y gobierna la sobrescritura", () => {
  const source = modules["KcmReleaseSync.bas"];
  assert.match(source, /NO_OVERWRITE/);
  assert.match(source, /OVERWRITE_WITH_HISTORY/);
  assert.match(source, /target\.HasFormula/);
  assert.match(source, /EXISTING_VALUE_CONFLICT/);
  assert.match(source, /ATOMIC_BATCH_ABORTED/);
  assert.match(source, /KCM_MARKER_PREFIX/);
  assert.match(modules["KcmBridgeCore.bas"], /KCM_MARKER_PREFIX As String = "KCM_VBA_V1"/);
  assert.match(source, /master\.Save/);
  assert.doesNotMatch(source, /Kill\s|DeleteFile|SaveAs/);
});

test("la sobrescritura VBA registra historial antes del valor y conserva rollback", () => {
  const source = modules["KcmReleaseSync.bas"];
  const history = source.indexOf("KcmRecordOverwriteHistory row, target");
  const write = source.indexOf("target.Value = KcmDateFromIso", history);
  assert.ok(history > 0 && write > history,
    "el historial append-only debe persistirse antes de tocar la celda");
  const core = modules["KcmBridgeCore.bas"];
  assert.match(core, /KCM_SOBRESCRITURAS/);
  assert.match(core, /"previousValue"/);
  assert.match(core, /"actor"/);
  assert.match(core, /"reasonReference"/);
  assert.match(source, /writtenCell\.Value = previousValues\(rollbackIndex\)/,
    "un fallo previo al guardado debe restituir el valor anterior");
});

test("un conflicto de hoja, columna o encabezado produce acuse en lugar de abortar el ciclo", () => {
  const source = modules["KcmReleaseSync.bas"];
  assert.match(source, /KcmSheetExists/, "la hoja destino se verifica antes de indexarla");
  assert.match(source, /InspectionError:/, "el preflight por fila atrapa lo inesperado");
  assert.match(source, /KcmSetRowStatus row, "ERROR"/, "un fallo inesperado viaja como ERROR");
  assert.match(source, /row\.(?:Item|Fijar)[ (]"destinationRow"/);
  assert.match(source, /row\.(?:Item|Fijar)[ (]"destinationColumnNumber"/);
  assert.doesNotMatch(source, /Split\(CStr\(row\.Item\("destinationAddress"\)\), "!"\)/,
    "un nombre de hoja con signo de admiracion rompia la direccion partida");
});

test("el encabezado destino se compara con conciencia de celdas combinadas", () => {
  const source = modules["KcmReleaseSync.bas"];
  assert.match(source, /KcmMergeAwareText/);
  assert.match(source, /MergeArea\.Cells\(1, 1\)/);
  assert.match(source, /For rowNumber = headerRow To 1 Step -1/,
    "el encabezado aprobado puede vivir en una fila superior del mismo camino");
});

test("el modo de calculo se restituye antes de guardar la matriz maestra", () => {
  const release = modules["KcmReleaseSync.bas"];
  const restore = release.indexOf("Application.Calculation = previousCalculation");
  const save = release.indexOf("master.Save", restore);
  assert.ok(restore > 0 && save > restore,
    "guardar en calculo manual archivaria la matriz en ese modo");
  assert.match(release, /If previousCalculation = xlCalculationAutomatic Then Application\.Calculate/);
  assert.doesNotMatch(modules["KcmJornada.bas"], /xlCalculationManual/,
    "la jornada no fija el modo de calculo: lo restituye quien lo cambia");
});

test("ni la huella ni el acuse pueden revertir un lote ya guardado", () => {
  const source = modules["KcmReleaseSync.bas"];
  const save = source.indexOf("If written.Count > 0 Then master.Save");
  const disable = source.indexOf("On Error GoTo 0", save);
  const hash = source.indexOf("workbookHash = KcmFileSha256(master.FullName)", disable);
  const send = source.indexOf("KcmSendReleaseAcknowledgements rows, workbookHash", hash);
  assert.ok(save > 0 && disable > save && hash > disable && send > hash,
    "el rollback debe quedar desactivado antes de calcular la huella y de enviar el acuse");
});

test("revertir un lote restituye el formato previo de cada celda", () => {
  const source = modules["KcmReleaseSync.bas"];
  const remember = source.indexOf("previousFormats.Add CStr(target.NumberFormat)");
  const write = source.indexOf("target.Value = KcmDateFromIso", remember);
  assert.ok(remember > 0 && write > remember,
    "el formato debe recordarse antes de que el lote toque la celda");
  assert.match(source, /writtenCell\.NumberFormat = CStr\(previousFormats\(rollbackIndex\)\)/,
    "limpiar solo el contenido dejaba impuesto el formato de fecha");
});

test("la matriz en cache se sondea antes de reutilizarla", () => {
  const core = modules["KcmBridgeCore.bas"];
  assert.match(core, /Private Function KcmMasterStillOpen/);
  const probe = core.indexOf("If Not KcmMasterStillOpen() Then");
  const reuse = core.indexOf("If Not mMaster Is Nothing Then", probe);
  assert.ok(probe > 0 && reuse > probe, "el sondeo precede a la reutilizacion");
});

test("la sincronizacion emite HC_SNAPSHOT_V1 sin literales de comillas triples", () => {
  const matrix = modules["KcmMatrixSync.bas"];
  assert.match(matrix, /HC_SNAPSHOT_V1/);
  assert.match(modules["KcmMatrixPanel.bas"], /KcmHttpPost\("MATRIX_IMPORT_V1"/);
  assert.match(modules["KcmMatrixPanel.bas"], /KcmHttpPost\("MATRIX_SCAN_V1"/);
  assert.match(matrix, /Dos columnas comparten la misma identidad/);
  assert.match(matrix, /If IsError\(values\(rowIndex, columnIndex\)\) Then/);
  assert.match(matrix, /celdas de error en el rango importado/);
  assert.match(matrix, /direcciones/);
  assert.match(matrix, /KcmDecidirCeldasConError/);
  assert.match(matrix, /MATRIX_CELDAS_ERROR/);
  assert.match(matrix, /skippedEmployeeCount", skippedEmployeeCount/);
  assert.match(matrix, /EMPLOYEE_CELL_ERROR/);
  assert.doesNotMatch(matrix, /"""/,
    "el JSON se arma con KcmJsonPair/KcmJsonRaw, no con comillas escapadas a mano");
  assert.match(matrix, /KcmJsonPair\("schemaVersion", "HC_SNAPSHOT_V1"\)/);
  assert.match(matrix, /KcmJsonPair\("sheetName", sheetName\)/,
    "el nombre de hoja proviene de la configuracion, no de un literal");
});

test("el snapshot lee en bloque y bloquea el truncamiento del rango de cursos", () => {
  const matrix = modules["KcmMatrixSync.bas"];
  assert.match(matrix, /KcmRangeValues\(sheet, firstEmployeeRow, employeeColumn/);
  assert.match(matrix, /KcmRangeFormulas\(sheet, firstEmployeeRow, employeeColumn/);
  assert.doesNotMatch(matrix, /sheet\.Cells\(rowNumber, columnNumber\)\.Value/,
    "no debe quedar lectura celda por celda del bloque de datos");
  assert.match(matrix, /KcmAssertNoCoursesBeyondLimit/);
  assert.match(matrix, /LAST_COURSE_COLUMN no llega hasta ahi/);
  assert.match(matrix, /KcmAssertUnmergedBlock/);
  assert.match(matrix, /KcmCountHeaderMerges/);
  assert.doesNotMatch(matrix, /mergedCellCount", 0/,
    "el conteo de combinaciones se calcula, no se declara cero");
});

test("los atributos laborales se leen por desplazamiento desde EMPLOYEE_COLUMN", () => {
  const matrix = modules["KcmMatrixSync.bas"];
  assert.match(matrix, /If employeeColumn \+ 7 >= firstCourseColumn Then/);
  assert.match(matrix, /KcmEmployeeText\(values, rowIndex, 8, sheetRow, "planta"\)/);
  assert.match(matrix, /es un error de formula/,
    "un valor de error debe senalar su campo en lugar de fallar con desajuste de tipo");
});

test("el sorteo de identidad y la codificacion lineal sobreviven al puerto", () => {
  const puerto = modules["KcmPlataforma.bas"];
  const codec = modules["KcmCodec.bas"];
  const http = modules["KcmBridgeHttp.bas"];
  assert.match(puerto, /CoCreateGuid Lib "ole32"/, "Windows conserva CoCreateGuid");
  assert.match(puerto, /\/dev\/urandom/, "macOS sortea con entropia del sistema");
  assert.doesNotMatch(everything, /CreateObject\("Scriptlet\.TypeLib"\)/,
    "scrobj.dll suele estar bloqueado y su GUID trae un terminador nulo");
  assert.match(codec, /ReDim destino\(0 To \(usados \* 6\) - 1\)/);
  assert.doesNotMatch(codec, /salida = salida & Chr\$/);
  assert.match(http, /encodedPayload = KcmBase64WebEncode\(payload\)/);
  assert.match(http, /"&payload=" & encodedPayload/,
    "base64 web-safe ya es no reservado: recodificarlo solo duplicaba el costo");
});

test("todo lo que depende del sistema operativo vive en el puerto", () => {
  for (const [file, source] of Object.entries(modules)) {
    if (file === "KcmPlataforma.bas") continue;
    const codigo = source.split(/\r?\n/).filter((line) => !/^\s*'/.test(line)).join("\n");
    assert.doesNotMatch(codigo, /#If\s+.*\bMac\b/i, `${file} abre una rama por sistema`);
    assert.doesNotMatch(codigo, /CreateObject\(/, `${file} instancia COM de Windows`);
    assert.doesNotMatch(codigo, /\bDeclare\b/, `${file} declara una API nativa`);
  }
});

test("el cliente no depende de ningun objeto COM que falte en macOS", () => {
  const codigo = Object.entries(modules)
    .map(([, source]) => source.split(/\r?\n/).filter((line) => !/^\s*'/.test(line)).join("\n"))
    .join("\n");
  for (const ausente of ["Scripting.Dictionary", "ADODB.Stream", "Msxml2.DOMDocument", "Scripting.FileSystemObject"]) {
    assert.ok(!codigo.includes(ausente), `${ausente} no existe en Excel para Mac`);
  }
  assert.match(modules["KcmDiccionario.cls"], /^VERSION [\d.]+ CLASS/m, "el .cls conserva su encabezado");
  assert.match(modules["KcmBridgeCore.bas"], /Set KcmNuevoDiccionario = New KcmDiccionario/);
});

test("macOS ejecuta vectores de argumentos y no lineas de shell", () => {
  const puerto = modules["KcmPlataforma.bas"];
  assert.match(puerto, /AppleScriptTask\(KCM_MAC_GUION, "kcmComando", argv\)/);
  assert.match(puerto, /KcmCitarShell\(CStr\(piezas\(indice\)\)\)/);
  assert.match(puerto, /Split\(argv, vbTab\)/);
  assert.match(puerto, /--data-binary" & vbTab & "@" & rutaCuerpo/);
  assert.match(puerto, /KcmBorrarArchivo rutaCuerpo/);
});

test("el reintento renueva nonce y sentAt pero conserva el requestId", () => {
  const http = modules["KcmBridgeHttp.bas"];
  const attempt = http.slice(http.indexOf("Private Function KcmHttpAttempt"));
  assert.match(attempt, /"&nonce=" & KcmUrlEncode\(KcmNewRequestId\("nonce"\)\)/);
  assert.match(attempt, /"&sentAt=" & KcmUrlEncode\(KcmUtcIsoNow\(\)\)/);
  assert.match(http, /If intentos < 1 Then intentos = KCM_HTTP_ATTEMPTS\s+For attempt = 1 To intentos/);
  assert.match(http, /retryable = \(status = 408 Or status = 429 Or status >= 500\)/);
  assert.match(http, /If Not KcmEndpointPermitido\(endpoint\) Then/);
  assert.match(http, /endpoint = KcmConfigValue\("ENDPOINT"\)/);
  assert.doesNotMatch(http, /ENDPOINT_LOCAL|ENVIO_LOCAL|KCM_ACCIONES_LOCALES/);
  assert.match(http, /Private Const KCM_PARTE_MAXIMA As Long = 3000000/);
  assert.match(http, /If Len\(encodedPayload\) <= KCM_PARTE_MAXIMA Then/);
  assert.match(http, /"&target=" & KcmUrlEncode\(action\)/);
  assert.match(http, /"&part=" & CStr\(parte\)/);
  assert.match(http, /"&parts=" & CStr\(partes\)/);
  assert.match(http, /"&length=" & CStr\(Len\(encodedPayload\)\)/);
  assert.match(http, /KcmHttpConReintentos\(endpoint, "UPLOAD_PART_V1", clientId, requestId, token/);
  assert.match(http, /KcmResponseField\(response, "uploadComplete"\)\) <> "TRUE"/);
  assert.match(http, /response\.Fijar "envioPartes"/);
  assert.match(http, /Public Function KcmDescribirEnvio\(/);
  for (const modulo of ["KcmMatrixPanel.bas", "KcmPadronSync.bas"]) {
    assert.match(modules[modulo], /KcmDescribirEnvio\(/, `${modulo} avisa como salio el envio`);
  }
  assert.match(http, /If Left\$\(lower, 8\) = "https:\/\/" Then/);
  assert.match(http, /If Left\$\(lower, 7\) <> "http:\/\/" Then Exit Function/);
  assert.match(http, /KcmEndpointPermitido = \(host = "127\.0\.0\.1" Or host = "localhost"\)/);
});

test("el ledger local se escribe en bloque en lugar de guardar el libro por fila", () => {
  const core = modules["KcmBridgeCore.bas"];
  assert.match(core, /Public Sub KcmLedgerAppendRows/);
  assert.match(modules["KcmReleaseSync.bas"], /KcmLedgerAppendRows KCM_RELEASE_LEDGER_SHEET, ledgerRows/);
  assert.doesNotMatch(modules["KcmReleaseSync.bas"], /KcmAppendLedger\b/);
  assert.doesNotMatch(core, /KcmLedgerIndex|KcmFindLedgerRow|KcmLedgerSetCell|KcmSaveControlWorkbook/);
});

test("la configuracion se lee una vez por ejecucion y detecta claves repetidas", () => {
  const core = modules["KcmBridgeCore.bas"];
  assert.match(core, /Public Sub KcmResetCaches/);
  assert.match(core, /esta repetida en/);
  for (const entry of ["Public Sub KcmApplyPendingReleases", "Private Sub KcmPanelCorrer"]) {
    const source = Object.values(modules).find((text) => text.includes(entry));
    const body = source.slice(source.indexOf(entry));
    assert.match(body.slice(0, body.indexOf("End Sub")), /KcmResetCaches/,
      `${entry} debe partir de configuracion fresca`);
  }
  assert.match(modules["KcmMatrixPanel.bas"], /If abierto Then KcmReleaseMaster/,
    "el panel cierra la matriz que abrio en lugar de dejarla abierta");
});

test("la tabla de plegado del cliente cubre la regla de normalizacion del servidor", () => {
  const core = modules["KcmBridgeCore.bas"];
  const table = new Map();
  for (const match of core.matchAll(/KcmAddFold "([A-Z]+)", "([0-9A-F,]+)"/g)) {
    for (const code of match[2].split(",")) table.set(Number.parseInt(code, 16), match[1]);
  }
  assert.ok(table.size >= 160, `la tabla solo declara ${table.size} caracteres`);

  const serverFold = (character) => character
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "");

  const missing = [];
  for (let code = 0xC0; code <= 0x17F; code += 1) {
    const expected = serverFold(String.fromCharCode(code));
    if (!/^[A-Z0-9]+$/.test(expected)) continue;
    if (table.get(code) !== expected) {
      missing.push(`U+${code.toString(16).toUpperCase().padStart(4, "0")} espera ${expected}`);
    }
  }
  assert.deepEqual(missing, [], `plegado incompleto: ${missing.join("; ")}`);
  assert.doesNotMatch(core, /Replace\$\(text, source\(index\), target\(index\)\)/,
    "la cadena de Replace$ anterior dependia de UCase$ y de la configuracion regional");
});

test("el subpanel de entradas escoge sesiones sin volverse un reloj", () => {
  const entradas = modules["KcmEntradas.bas"];
  const release = modules["KcmReleaseSync.bas"];

  assert.match(release, /Optional ByVal sesiones As String = ""/,
    "el filtro por sesion debe tener valor por omision");
  assert.match(modules["KcmJornada.bas"], /\r?\n    KcmApplyPendingReleases\r?\n/,
    "Actualizar sigue recibiendo todo por la misma entrada, sin argumentos");
  const filtro = release.slice(release.indexOf("Private Function KcmSesionEscogida"));
  assert.match(filtro.slice(0, filtro.indexOf("End Function")), /If Len\(sesiones\) = 0 Then/,
    "una lista vacia de sesiones significa todas");

  assert.doesNotMatch(entradas, /Application\.OnTime/,
    "el subpanel se actualiza a peticion, no por reloj");
  const actualizar = entradas.slice(entradas.indexOf("Public Sub KcmEntradasActualizar"));
  assert.match(actualizar.slice(0, actualizar.indexOf("End Sub")), /KcmResetCaches/,
    "consultar debe partir de configuracion fresca");
  assert.match(entradas, /RELEASE_SESSIONS_V1/);
  assert.match(entradas, /"sessionId", "sessionCode", "trainingId", "completionDate", "pending"/);
});

test("todo aviso sale por KcmAvisos y ninguno se escribe a mano", () => {
  for (const [file, source] of Object.entries(modules)) {
    if (file === "KcmAvisos.bas") continue;
    assert.doesNotMatch(source, /\bMsgBox\b/,
      `${file} abre un cuadro de dialogo por su cuenta; use KcmAvisoHecho, ` +
      "KcmAvisoAtencion, KcmAvisoFallo o KcmAvisoConfirmar");
  }
});

test("todo aviso lleva titulo con la marca, que es lo que lo separa de una nota", () => {
  const avisos = modules["KcmAvisos.bas"];
  assert.match(avisos, /MARCA As String = "Plataforma KCM"/);
  for (const llamada of ["KcmAvisoHecho", "KcmAvisoAtencion", "KcmAvisoFallo", "KcmAvisoConfirmar"]) {
    assert.match(avisos, new RegExp(`${llamada}[\\s\\S]{0,400}?KcmAvisoTitulo\\(accion\\)`),
      `${llamada} debe pasar un titulo a MsgBox`);
  }
});

test("la causa tecnica va rotulada y aparte, no pegada detras de dos puntos", () => {
  assert.match(modules["KcmAvisos.bas"],
    /cuerpo = cuerpo & vbCrLf & vbCrLf & "Detalle tecnico: " & causa/);
});

test("el plural se resuelve y no se insinua entre parentesis", () => {
  assert.match(modules["KcmAvisos.bas"], /Function KcmPlural\(/);
  for (const [file, source] of Object.entries(modules)) {
    if (file === "KcmAvisos.bas") continue;
    assert.doesNotMatch(source, /\(s\)|\(es\)/,
      `${file} insinua el plural entre parentesis; use KcmPlural`);
  }
});

test("las dos superficies pintan el boton con el mismo pintor", () => {
  assert.match(modules["KcmPanel.bas"], /Public Sub KcmPintarBoton\(/,
    "el pintor compartido vive en KcmPanel");
  assert.match(modules["KcmConfigButtons.bas"], /KcmPintarBoton sheet,/,
    "la hoja de configuracion delega el dibujo en el pintor compartido");
  assert.doesNotMatch(modules["KcmConfigButtons.bas"], /Shapes\.AddShape/,
    "la hoja de configuracion ya no dibuja formas por su cuenta");
});

test("el relieve de las formas no puede tumbar el dibujo", () => {
  const panel = modules["KcmPanel.bas"];
  const relieve = panel.slice(panel.indexOf("Public Sub KcmPanelRelieve"));
  assert.match(relieve.slice(0, relieve.indexOf("End Sub")), /On Error Resume Next/);
});

test("ninguna declaracion de modulo aparece despues de un procedimiento", () => {
  for (const [file, source] of Object.entries(modules)) {
    let profundidad = 0;
    let dentro = false;
    let yaHuboProcedimiento = false;
    source.split(/\r?\n/).forEach((linea, indice) => {
      if (/^#If\b/i.test(linea)) profundidad += 1;
      if (/^#End If\b/i.test(linea)) profundidad -= 1;
      if (/^(Public |Private |Friend )?(Static )?(Sub|Function|Property) /i.test(linea)) dentro = true;
      if (/^End (Sub|Function|Property)\b/i.test(linea)) {
        dentro = false;
        yaHuboProcedimiento = true;
        return;
      }
      if (dentro || profundidad > 0 || !yaHuboProcedimiento) return;
      assert.doesNotMatch(
        linea,
        /^(Public |Private |Global )?(Const|Declare|Type|Enum|Dim) /i,
        `${file}:${indice + 1} declara algo despues de un procedimiento`,
      );
    });
  }
});

test("toda sentencia VBA cierra los parentesis que abre", () => {
  for (const [file, source] of Object.entries(modules)) {
    const lineas = source.split(/\r?\n/);
    for (let i = 0; i < lineas.length; i += 1) {
      const inicio = i;
      let sentencia = "";
      for (;;) {
        let codigo = "";
        let enCadena = false;
        for (const caracter of lineas[i]) {
          if (caracter === '"') enCadena = !enCadena;
          if (caracter === "'" && !enCadena) break;
          codigo += caracter;
        }
        if (/\s_\s*$/.test(codigo) && i + 1 < lineas.length) {
          sentencia += codigo.replace(/\s_\s*$/, " ");
          i += 1;
          continue;
        }
        sentencia += codigo;
        break;
      }
      const sinCadenas = sentencia.replace(/"[^"]*"/g, "");
      const abre = (sinCadenas.match(/\(/g) || []).length;
      const cierra = (sinCadenas.match(/\)/g) || []).length;
      assert.equal(abre, cierra, `${file}:${inicio + 1} tiene parentesis desbalanceados`);
    }
  }
});
