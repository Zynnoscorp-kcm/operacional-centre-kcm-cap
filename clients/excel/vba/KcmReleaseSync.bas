Attribute VB_Name = "KcmReleaseSync"
Option Explicit
Option Private Module

' Modulo interno: sus rutinas las llaman otros modulos del cliente y no aparecen
' en Herramientas > Macros, donde solo quedan las que se usan a mano.

''' Escribe en la matriz las fechas que la plataforma tenga pendientes.
'''
''' `sesiones` acota el trabajo a las sesiones escogidas en el subpanel de
''' entradas: es una lista de identificadores separados por barra vertical, y
''' vacia significa todas, que es como se comporto siempre y como sigue
''' comportandose el boton del panel y el ciclo programado.
'''
''' El filtro se aplica sobre lo descargado y no sobre lo pedido. RELEASE_PULL_V1
''' entrega la carga entera en una lectura; pedirla por sesion habria significado
''' una llamada por sesion escogida para obtener exactamente los mismos
''' renglones. Lo que no se puede es partir un lote: la unidad que se aplica todo
''' o nada es el lote, y una sesion produce lotes enteros.
Public Sub KcmApplyPendingReleases(Optional ByVal silent As Boolean = False, _
    Optional ByVal sesiones As String = "")
    Dim response As KcmDiccionario
    Dim rows As Collection
    Dim headers As Variant
    Dim batches As KcmDiccionario
    Dim batchRows As Collection
    Dim row As KcmDiccionario
    Dim batchKey As Variant
    Dim master As Workbook
    Dim escogidas As Long
    Dim codigos As KcmDiccionario
    Dim nombres As KcmDiccionario
    Dim fechasPrevias As KcmDiccionario
    Dim clave As String

    KcmResetCaches
    Set response = KcmHttpPost("RELEASE_PULL_V1", "")
    headers = Array( _
        "idempotencyKey", "batchId", "sessionId", "employeeId", "trainingId", _
        "completionDate", "destinationSheet", "destinationColumn", "headerRow", _
        "destinationHeader", "targetMappingVersion", "overwritePolicy")
    Set rows = KcmParseTsv(KcmDecodeResponsePayload(response), headers)
    If rows.Count = 0 Then
        If Not silent Then KcmAvisoHecho "Actualizar", "Sin liberaciones pendientes."
        Exit Sub
    End If

    Set batches = KcmNuevoDiccionario()
    For Each row In rows
        If Len(CStr(row.Item("batchId"))) = 0 Then Err.Raise vbObjectError + 7400, _
            "KcmApplyPendingReleases", "Una liberacion no conserva batchId"
        If KcmSesionEscogida(CStr(row.Item("sessionId")), sesiones) Then
            If Not batches.Exists(CStr(row.Item("batchId"))) Then
                Set batchRows = New Collection
                batches.AgregarObjeto CStr(row.Item("batchId")), batchRows
            End If
            Set batchRows = batches.Objeto(CStr(row.Item("batchId")))
            batchRows.Add row
            escogidas = escogidas + 1
        End If
    Next row

    If escogidas = 0 Then
        If Not silent Then KcmAvisoHecho "Escribir en la matriz", _
            "Las sesiones seleccionadas no tienen fechas pendientes."
        Exit Sub
    End If

    ' Cada fecha lleva en su nota el codigo de su sesion (KC-0001). Se consulta antes de abrir
    ' la matriz: si la consulta falla, no se escribe nada, igual que si fallara la descarga.
    Set codigos = KcmCodigosDeSesion()
    ' Y el nombre del padron y la fecha que la plataforma autorizo reemplazar, para no escribir
    ' en la persona equivocada ni pisar una fecha que nadie reviso. Si la consulta falla, tampoco
    ' se escribe nada.
    Set nombres = KcmNuevoDiccionario()
    Set fechasPrevias = KcmNuevoDiccionario()
    KcmContextoDeLiberacion nombres, fechasPrevias
    For Each batchKey In batches.Keys
        Set batchRows = batches.Objeto(CStr(batchKey))
        For Each row In batchRows
            If codigos.Exists(CStr(row.Item("sessionId"))) Then
                row.Add "sessionCode", CStr(codigos.Item(CStr(row.Item("sessionId"))))
            Else
                row.Add "sessionCode", ""
            End If
            clave = CStr(row.Item("idempotencyKey"))
            If nombres.Exists(clave) Then
                row.Add "workerName", CStr(nombres.Item(clave))
            Else
                row.Add "workerName", ""
            End If
            If fechasPrevias.Exists(clave) Then
                row.Add "expectedPreviousDate", CStr(fechasPrevias.Item(clave))
            Else
                row.Add "expectedPreviousDate", ""
            End If
        Next row
    Next batchKey

    Set master = KcmOpenMaster(False)
    For Each batchKey In batches.Keys
        Set batchRows = batches.Objeto(CStr(batchKey))
        KcmApplyReleaseBatch master, batchRows, Not silent
    Next batchKey
    If Not silent Then KcmAvisoHecho "Actualizar", _
        KcmPlural(escogidas, "liberacion escrita", "liberaciones escritas") & " en la matriz."
End Sub

''' Si una liberacion entra en el trabajo de esta corrida.
'''
''' La lista se compara con las barras puestas a los dos lados para que un
''' identificador no case por ser prefijo de otro; sin ellas, marcar una sesion
''' podria arrastrar a otra cuyo identificador empezara igual.
Private Function KcmSesionEscogida(ByVal sesion As String, ByVal sesiones As String) As Boolean
    If Len(sesiones) = 0 Then
        KcmSesionEscogida = True
        Exit Function
    End If
    KcmSesionEscogida = InStr(1, "|" & sesiones, "|" & sesion & "|", vbBinaryCompare) > 0
End Function

''' El preflight completo ocurre antes de la primera escritura y cada fila recibe un estado propio,
''' de modo que la plataforma siempre reciba un acuse.
'''
''' Lo que la revision encuentra ya no detiene el lote por su cuenta: se ensena en un aviso con el
''' nombre y la nomina de cada trabajador, y quien opera decide. "Si" escribe todo lo que se puede
''' escribir -tambien un nombre distinto o una fecha mas reciente- y deja pendiente lo que no tiene
''' donde escribirse (trabajador ausente, encabezado cambiado, formula). "No" no escribe nada del
''' lote, como antes. Sin nadie delante (corrida programada) la respuesta es "No".
Private Sub KcmApplyReleaseBatch(ByVal master As Workbook, ByVal rows As Collection, _
    Optional ByVal preguntar As Boolean = True)
    Dim employeeIndexes As KcmDiccionario
    Dim row As KcmDiccionario
    Dim sheet As Worksheet
    Dim target As Range
    Dim written As New Collection
    Dim previousFormats As New Collection
    Dim previousValues As New Collection
    Dim previousComments As New Collection
    Dim hasConflict As Boolean
    Dim previousNote As String
    Dim workbookHash As String
    Dim previousCalculation As XlCalculation
    Dim previousEvents As Boolean
    Dim previousScreenUpdating As Boolean
    Dim avisos As String
    Dim cuantosAvisos As Long
    Dim escribibles As Long
    Dim sinDestino As Long
    Dim estado As String

    Set employeeIndexes = KcmNuevoDiccionario()

    For Each row In rows
        KcmInspectReleaseRow master, row, employeeIndexes
        estado = CStr(row.Item("applyStatus"))
        If estado <> "READY" And estado <> "RECOVERED" Then
            hasConflict = True
            cuantosAvisos = cuantosAvisos + 1
            If KcmAdvertenciaEscribible(estado) Then
                escribibles = escribibles + 1
            Else
                sinDestino = sinDestino + 1
            End If
            If cuantosAvisos <= 12 Then
                avisos = avisos & vbLf & "- " & CStr(row.Item("employeeId")) & " " & _
                    Left$(KcmTextoDeFila(row, "workerName"), 40) & ": " & _
                    Left$(CStr(row.Item("detail")), 110)
            End If
        End If
    Next row
    If cuantosAvisos > 12 Then avisos = avisos & vbLf & "- y " & CStr(cuantosAvisos - 12) & " mas."

    If hasConflict And preguntar Then
        If KcmAvisoConfirmar("Escribir en la matriz", _
            "La sesion " & KcmTextoDeFila(rows(1), "sessionCode") & " tiene " & _
            KcmPlural(cuantosAvisos, "advertencia", "advertencias") & ". Escribir de todos modos?", _
            Mid$(avisos, 2) & vbLf & vbLf & _
            "Si: se escriben las demas fechas y las que tienen advertencia. " & _
            IIf(sinDestino > 0, KcmPlural(sinDestino, "fecha no tiene", "fechas no tienen") & _
                " donde escribirse y queda" & IIf(sinDestino > 1, "n", "") & " pendiente" & _
                IIf(sinDestino > 1, "s", "") & ". ", "") & _
            "No: no se escribe nada de esta sesion.") Then
            hasConflict = False
            For Each row In rows
                estado = CStr(row.Item("applyStatus"))
                If KcmAdvertenciaEscribible(estado) Then
                    row.Fijar "applyStatus", "READY"
                    row.Fijar "detail", Left$("Escrita tras confirmar: " & CStr(row.Item("detail")), 300)
                End If
            Next row
        End If
    End If

    If hasConflict Then
        For Each row In rows
            If CStr(row.Item("applyStatus")) = "READY" Then
                row.Fijar "applyStatus", "ATOMIC_BATCH_ABORTED"
                row.Fijar "detail", "El lote contiene al menos un conflicto"
            End If
        Next row
        KcmSendReleaseAcknowledgements rows, KcmFileSha256(master.FullName)
        Exit Sub
    End If

    previousCalculation = Application.Calculation
    previousEvents = Application.EnableEvents
    previousScreenUpdating = Application.ScreenUpdating
    On Error GoTo RollbackBatch
    Application.EnableEvents = False
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual

    For Each row In rows
        If CStr(row.Item("applyStatus")) = "READY" Then
            Set sheet = master.Worksheets(CStr(row.Item("destinationSheet")))
            Set target = sheet.Cells(CLng(row.Item("destinationRow")), _
                CLng(row.Item("destinationColumnNumber")))
            ' El formato previo se recuerda antes de tocarlo y en el mismo orden que `written`: al
            ' revertir hay que restituirlo. Limpiar solo el contenido dejaba impuesto el formato de
            ' fecha sobre una celda que el lote ya no ocupa.
            previousFormats.Add CStr(target.NumberFormat)
            previousValues.Add target.Value
            If target.Comment Is Nothing Then
                previousComments.Add ""
            Else
                previousComments.Add CStr(target.Comment.text)
            End If
            ' Se guarda historia cuando hay un valor que se pisa. La nota ya no cuenta para
            ' esto: dejo de perderse al escribir, asi que una celda vacia con un apunte no es una
            ' sobrescritura y anotarla como tal llenaria el ledger de renglones que no pisaron nada.
            If CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" And _
                Len(Trim$(KcmCellText(target.Value))) > 0 Then
                KcmRecordOverwriteHistory row, target
            End If
            written.Add target
            target.Value = KcmDateFromIso(CStr(row.Item("completionDate")))
            ' Una celda con formato General mostraria el numero de serie en lugar de la fecha.
            If target.NumberFormat = "General" Then target.NumberFormat = "dd/mm/yyyy"
            ' La nota que ya estaba se conserva: puede ser un apunte del area sobre esa persona y
            ' borrarlo seria perder informacion que nadie mas guarda. Solo se retira la linea que
            ' dejo la plataforma, para que no se acumulen una debajo de otra liberacion tras
            ' liberacion, y debajo va el codigo de la sesion de donde viene esta fecha.
            previousNote = KcmNotaSinMarcador(previousComments(previousComments.Count))
            If Not target.Comment Is Nothing Then target.Comment.Delete
            target.AddComment KcmNotaConMarcador(previousNote, KcmNotaDeLaSesion(row))
            KcmAjustarNota target.Comment
            row.Fijar "applyStatus", "APPLIED"
        End If
    Next row

    ' El modo de calculo se restituye y el libro se recalcula antes de guardar: la matriz conserva
    ' sus dependencias al dia y no queda archivada en modo manual para quien la abra despues.
    Application.Calculation = previousCalculation
    If previousCalculation = xlCalculationAutomatic Then Application.Calculate
    ' Un lote sin escrituras es todo RECOVERED: guardar reescribiria el maestro entero y cambiaria
    ' su huella sin que ninguna celda haya cambiado.
    If written.Count > 0 Then master.Save
    ' El efecto ya es durable y recuperable por fecha mas marcador, de modo que el rollback se
    ' desactiva ANTES de calcular la huella. Mientras esa llamada quedaba dentro de la ventana, un
    ' fallo al calcular SHA-256 borraba y volvia a guardar un lote ya aplicado y guardado. Ahora el
    ' error se propaga intacto y la siguiente descarga reconoce el lote como RECOVERED.
    On Error GoTo 0
    Application.EnableEvents = previousEvents
    Application.ScreenUpdating = previousScreenUpdating
    workbookHash = KcmFileSha256(master.FullName)
    KcmSendReleaseAcknowledgements rows, workbookHash
    Exit Sub

RollbackBatch:
    Dim originalNumber As Long
    Dim originalDescription As String
    Dim writtenCell As Range
    Dim rollbackIndex As Long
    originalNumber = Err.Number
    originalDescription = Err.Description
    On Error Resume Next
    ' Se recorre por indice, no con `For Each`: cada celda debe emparejarse con el formato que tenia
    ' antes de que este lote la tocara.
    For rollbackIndex = 1 To written.Count
        Set writtenCell = written(rollbackIndex)
        If Not writtenCell.Comment Is Nothing Then writtenCell.Comment.Delete
        writtenCell.Value = previousValues(rollbackIndex)
        writtenCell.NumberFormat = CStr(previousFormats(rollbackIndex))
        If Len(CStr(previousComments(rollbackIndex))) > 0 Then _
            writtenCell.AddComment CStr(previousComments(rollbackIndex))
    Next rollbackIndex
    Application.Calculation = previousCalculation
    If written.Count > 0 Then master.Save
    Application.EnableEvents = previousEvents
    Application.ScreenUpdating = previousScreenUpdating
    On Error GoTo 0
    Err.Raise originalNumber, "KcmApplyReleaseBatch", originalDescription
End Sub

''' Las advertencias que tienen donde escribirse: la celda existe y no es formula ni error. Un
''' trabajador ausente, un encabezado cambiado o una formula no se pueden escribir aunque se quiera.
Private Function KcmAdvertenciaEscribible(ByVal estado As String) As Boolean
    KcmAdvertenciaEscribible = (estado = "NAME_MISMATCH" Or estado = "NEWER_DATE_CONFLICT" Or _
        estado = "UNEXPECTED_DATE_CONFLICT")
End Function

''' Clasifica una fila sin escribir. Cualquier fallo inesperado se convierte en `ERROR`, un estado
''' que el puente acepta, en lugar de propagarse y dejar al lote sin acuse.
Private Sub KcmInspectReleaseRow(ByVal master As Workbook, ByVal row As KcmDiccionario, _
    ByVal employeeIndexes As KcmDiccionario)
    Dim sheet As Worksheet
    Dim target As Range
    Dim employeeRows As KcmDiccionario
    Dim columnNumber As Long
    Dim headerRow As Long
    Dim indexKey As String
    Dim currentDate As String
    Dim employeeColumn As Long
    Dim nombrePadron As String
    Dim nombreMatriz As String
    Dim fechaEsperada As String

    row.Add "applyStatus", ""
    row.Add "detail", ""
    row.Add "destinationAddress", ""
    row.Add "destinationRow", 0
    row.Add "destinationColumnNumber", 0

    On Error GoTo InspectionError
    If CStr(row.Item("overwritePolicy")) <> "NO_OVERWRITE" And _
        CStr(row.Item("overwritePolicy")) <> "OVERWRITE_WITH_HISTORY" Then
        KcmSetRowStatus row, "ERROR", "La politica de escritura no es compatible"
        Exit Sub
    End If
    If Not KcmSheetExists(master, CStr(row.Item("destinationSheet"))) Then
        KcmSetRowStatus row, "HEADER_CONFLICT", "La hoja destino no existe en la matriz"
        Exit Sub
    End If
    Set sheet = master.Worksheets(CStr(row.Item("destinationSheet")))
    columnNumber = KcmColumnNumber(CStr(row.Item("destinationColumn")))
    headerRow = CLng(row.Item("headerRow"))
    If headerRow < 1 Then
        KcmSetRowStatus row, "ERROR", "La fila de encabezado del mapeo no es valida"
        Exit Sub
    End If
    row.Fijar "destinationColumnNumber", columnNumber

    If Not KcmHeaderMatches(sheet, headerRow, columnNumber, CStr(row.Item("destinationHeader"))) Then
        row.Fijar "destinationAddress", sheet.Name & "!" & _
            KcmColumnLetters(columnNumber) & CStr(headerRow)
        KcmSetRowStatus row, "HEADER_CONFLICT", "El encabezado cambio desde el mapeo aprobado"
        Exit Sub
    End If

    indexKey = sheet.Name & "|" & CStr(headerRow)
    employeeColumn = KcmColumnNumber(KcmConfigValue("EMPLOYEE_COLUMN"))
    If Not employeeIndexes.Exists(indexKey) Then
        employeeIndexes.AgregarObjeto indexKey, KcmEmployeeRowIndex(sheet, _
            employeeColumn, headerRow + 1)
    End If
    Set employeeRows = employeeIndexes.Objeto(indexKey)
    If Not employeeRows.Exists(CStr(row.Item("employeeId"))) Then
        row.Fijar "destinationAddress", sheet.Name & "!"
        KcmSetRowStatus row, "EMPLOYEE_NOT_FOUND", "El trabajador no existe en la hoja destino"
        Exit Sub
    End If

    row.Fijar "destinationRow", CLng(employeeRows.Item(CStr(row.Item("employeeId"))))
    Set target = sheet.Cells(CLng(row.Item("destinationRow")), columnNumber)
    row.Fijar "destinationAddress", sheet.Name & "!" & KcmColumnLetters(columnNumber) & _
        CStr(row.Item("destinationRow"))

    ' La nomina encontro un renglon, pero hay que confirmar que es la misma persona: una nomina
    ' mal capturada en la matriz puede ser la de otro trabajador, y la fecha se escribiria en el
    ' renglon equivocado sin que nada lo delatara. El nombre va en la columna siguiente a la
    ' nomina, la misma que lee el barrido.
    nombrePadron = KcmTextoDeFila(row, "workerName")
    If Len(nombrePadron) > 0 Then
        nombreMatriz = KcmCellText(sheet.Cells(CLng(row.Item("destinationRow")), employeeColumn + 1).Value)
        If Not KcmMismoNombre(nombreMatriz, nombrePadron) Then
            KcmSetRowStatus row, "NAME_MISMATCH", "La nomina " & CStr(row.Item("employeeId")) & _
                " es de " & Left$(Trim$(nombreMatriz), 60) & " en la matriz y de " & _
                Left$(nombrePadron, 60) & " en el padron"
            Exit Sub
        End If
    End If

    If target.HasFormula Then
        KcmSetRowStatus row, "EXISTING_VALUE_CONFLICT", "La celda destino contiene una formula"
    ElseIf IsError(target.Value) Then
        KcmSetRowStatus row, "EXISTING_VALUE_CONFLICT", "La celda destino contiene un error"
    ElseIf Len(Trim$(KcmCellText(target.Value))) = 0 Then
        ' La celda esta vacia: no hay fecha que respetar y la nota no es un valor. Antes esto era
        ' conflicto y detenia el lote entero por una anotacion que alguien dejo escrita a mano. Se
        ' escribe la fecha y la nota de esa persona se conserva; el marcador se le agrega debajo.
        KcmSetRowStatus row, "READY", ""
    Else
        currentDate = KcmIsoDate(target.Value)
        ' La celda ya trae la fecha que este lote iba a escribir, asi que no hay nada que hacer.
        ' Antes se exigia ademas que la nota fuera identica al marcador: una nota agregada
        ' despues, o el marcador conviviendo con un apunte del area, convertia un renglon ya
        ' aplicado en conflicto. Lo que decide es el numero de la celda; la nota acompana.
        fechaEsperada = KcmTextoDeFila(row, "expectedPreviousDate")
        If currentDate = CStr(row.Item("completionDate")) Then
            KcmSetRowStatus row, "RECOVERED", "Efecto recuperado por la fecha de la celda"
        ElseIf Len(currentDate) > 0 And currentDate > CStr(row.Item("completionDate")) Then
            ' Nunca se reemplaza una fecha mas reciente por una mas vieja, ni con motivo. Las
            ' fechas van en ISO, asi que comparar el texto es comparar el calendario.
            KcmSetRowStatus row, "NEWER_DATE_CONFLICT", "La matriz ya tiene una fecha mas reciente: " & _
                currentDate
        ElseIf CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" And _
            Len(fechaEsperada) > 0 And currentDate = fechaEsperada Then
            ' La plataforma vio esta misma fecha, pidio el motivo y autorizo reemplazarla.
            KcmSetRowStatus row, "READY", "Sobrescritura autorizada en la plataforma"
        ElseIf CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" Then
            ' La celda trae algo que la plataforma no conocia: una fecha capturada despues del
            ' ultimo barrido. Reemplazarla aqui seria sobrescribir sin que nadie lo revisara.
            KcmSetRowStatus row, "UNEXPECTED_DATE_CONFLICT", "La celda tiene " & _
                Left$(KcmCellText(target.Value), 20) & " y la plataforma no autorizo reemplazarla"
        Else
            KcmSetRowStatus row, "EXISTING_VALUE_CONFLICT", "La celda ya contiene otro valor o marcador"
        End If
    End If
    Exit Sub

InspectionError:
    KcmSetRowStatus row, "ERROR", "No fue posible evaluar la celda destino: " & Err.Description
End Sub

''' Conserva el valor anterior en el libro controlador antes de tocar la celda. El motivo completo
''' permanece en el journal autenticado de Node; `reasonReference` enlaza este ledger fisico con esa
''' decision sin copiar datos sensibles al XLSB.
Private Sub KcmRecordOverwriteHistory(ByVal row As KcmDiccionario, ByVal target As Range)
    Dim historyRows As New Collection
    Dim previousComment As String
    previousComment = ""
    If Not target.Comment Is Nothing Then previousComment = CStr(target.Comment.text)
    historyRows.Add Array( _
        CStr(row.Item("idempotencyKey")), CStr(row.Item("batchId")), CStr(row.Item("destinationAddress")), _
        KcmCellText(target.Value), previousComment, CStr(row.Item("completionDate")), _
        CStr(row.Item("targetMappingVersion")), KcmConfigValue("CLIENT_ID"), _
        CStr(row.Item("idempotencyKey")), KcmUtcIsoNow())
    KcmLedgerAppendRows KCM_OVERWRITE_LEDGER_SHEET, historyRows
End Sub

Private Sub KcmSetRowStatus(ByVal row As KcmDiccionario, ByVal status As String, _
    ByVal detail As String)
    row.Fijar "applyStatus", status
    row.Fijar "detail", detail
End Sub

Private Function KcmSheetExists(ByVal master As Workbook, ByVal sheetName As String) As Boolean
    Dim sheet As Worksheet
    For Each sheet In master.Worksheets
        If StrComp(sheet.Name, sheetName, vbTextCompare) = 0 Then
            KcmSheetExists = True
            Exit Function
        End If
    Next sheet
End Function

''' El encabezado aprobado puede vivir en una celda combinada o en una fila superior del mismo
''' camino. Comparar solo `Cells(headerRow, columna)` devolvia vacio en una combinacion vertical y
''' marcaba todo el lote como HEADER_CONFLICT.
Private Function KcmHeaderMatches(ByVal sheet As Worksheet, ByVal headerRow As Long, _
    ByVal columnNumber As Long, ByVal expected As String) As Boolean
    Dim normalizedExpected As String
    Dim rowNumber As Long
    normalizedExpected = KcmNormalizeLabel(expected)
    If Len(normalizedExpected) = 0 Then Exit Function
    For rowNumber = headerRow To 1 Step -1
        If KcmNormalizeLabel(KcmMergeAwareText(sheet, rowNumber, columnNumber)) = normalizedExpected Then
            KcmHeaderMatches = True
            Exit Function
        End If
    Next rowNumber
End Function

Private Function KcmMergeAwareText(ByVal sheet As Worksheet, ByVal rowNumber As Long, _
    ByVal columnNumber As Long) As String
    Dim cell As Range
    Set cell = sheet.Cells(rowNumber, columnNumber)
    If cell.MergeCells Then
        KcmMergeAwareText = Trim$(KcmCellText(cell.MergeArea.Cells(1, 1).Value))
    Else
        KcmMergeAwareText = Trim$(KcmCellText(cell.Value))
    End If
End Function

Private Function KcmEmployeeRowIndex(ByVal sheet As Worksheet, ByVal employeeColumn As Long, _
    ByVal firstDataRow As Long) As KcmDiccionario
    Dim result As KcmDiccionario
    Dim values As Variant
    Dim lastRow As Long
    Dim rowIndex As Long
    Dim employeeId As String
    Set result = KcmNuevoDiccionario()
    lastRow = sheet.Cells(sheet.Rows.Count, employeeColumn).End(xlUp).Row
    If lastRow < firstDataRow Then
        Set KcmEmployeeRowIndex = result
        Exit Function
    End If
    values = KcmRangeValues(sheet, firstDataRow, employeeColumn, lastRow, employeeColumn)
    For rowIndex = 1 To UBound(values, 1)
        employeeId = KcmNormalizeEmployeeId(values(rowIndex, 1))
        If Len(employeeId) > 0 Then
            If result.Exists(employeeId) Then Err.Raise vbObjectError + 7402, _
                "KcmEmployeeRowIndex", "La matriz contiene numeros de trabajador duplicados"
            result.Add employeeId, firstDataRow + rowIndex - 1
        End If
    Next rowIndex
    Set KcmEmployeeRowIndex = result
End Function

''' La nota de una celda sin las lineas que dejo la plataforma.
'''
''' Sirve para dos cosas: recuperar lo que una persona escribio a mano, para no perderlo al
''' reescribir la nota, y evitar que la linea de la plataforma se acumule cada vez que se libera
''' esa celda.
Private Function KcmNotaSinMarcador(ByVal texto As String) As String
    Dim lineas() As String
    Dim conservadas As String
    Dim indice As Long
    Dim linea As String

    If Len(texto) = 0 Then Exit Function
    lineas = Split(Replace$(texto, vbCrLf, vbLf), vbLf)
    For indice = 0 To UBound(lineas)
        linea = lineas(indice)
        If Not KcmEsLineaDeLaPlataforma(linea) Then
            If Len(Trim$(linea)) > 0 Then
                If Len(conservadas) > 0 Then conservadas = conservadas & vbLf
                conservadas = conservadas & linea
            End If
        End If
    Next indice
    KcmNotaSinMarcador = conservadas
End Function

''' Si una linea de la nota la escribio la plataforma: el marcador tecnico que llevaban las notas
''' hasta el 2026-09-29, o un codigo de sesion solo en su linea, del formato nuevo (KC-0001) o del
''' anterior (KCM-260803-ABC123). Un apunte que mencione un codigo junto a otras palabras no casa
''' y se conserva.
Private Function KcmEsLineaDeLaPlataforma(ByVal linea As String) As Boolean
    Dim limpia As String
    limpia = Trim$(linea)
    If Left$(limpia, Len(KCM_MARKER_PREFIX)) = KCM_MARKER_PREFIX Then
        KcmEsLineaDeLaPlataforma = True
    ElseIf limpia Like "KC-####" Then
        KcmEsLineaDeLaPlataforma = True
    Else
        KcmEsLineaDeLaPlataforma = _
            limpia Like "KCM-######-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]"
    End If
End Function

''' La nota que se escribe en la celda: primero lo que la persona haya anotado, y debajo la linea
''' de la plataforma. Va al final a proposito: quien abre la nota lee primero su apunte.
''' La nota se ajusta a su texto. Excel la crea con un recuadro fijo de unos 100 x 60 puntos, y para
''' un codigo corto como KC-0001 eso es un cuadro casi vacio que tapa media hoja al pasar el puntero.
''' Una sola linea corta queda en un recuadro chico; una nota con apuntes previos se ajusta sola. Si
''' la version de Excel no deja cambiar el tamano, la nota se queda como estaba: el dato ya se
''' escribio y el tamano del recuadro no justifica deshacer el lote.
Private Sub KcmAjustarNota(ByVal nota As Comment)
    Dim texto As String

    If nota Is Nothing Then Exit Sub
    On Error Resume Next
    texto = CStr(nota.text)
    If InStr(texto, vbLf) = 0 And Len(texto) <= 20 Then
        nota.Shape.TextFrame.AutoSize = False
        nota.Shape.Width = 30 + 5 * Len(texto)
        nota.Shape.Height = 16
    Else
        nota.Shape.TextFrame.AutoSize = True
    End If
    On Error GoTo 0
End Sub

Private Function KcmNotaConMarcador(ByVal nota As String, ByVal marcador As String) As String
    If Len(nota) = 0 Then
        KcmNotaConMarcador = marcador
    Else
        KcmNotaConMarcador = nota & vbLf & marcador
    End If
End Function

''' La linea que la plataforma deja en la nota: el codigo de la sesion de donde viene la fecha,
''' como KC-0001, que es lo que una persona reconoce. Si el codigo no llego, queda el marcador
''' tecnico de antes, que al menos enlaza la celda con su liberacion.
Private Function KcmNotaDeLaSesion(ByVal row As KcmDiccionario) As String
    Dim codigo As String
    codigo = Trim$(CStr(row.Item("sessionCode")))
    If Len(codigo) > 0 Then
        KcmNotaDeLaSesion = codigo
    Else
        KcmNotaDeLaSesion = KcmReleaseMarker(row)
    End If
End Function

Private Function KcmReleaseMarker(ByVal row As KcmDiccionario) As String
    KcmReleaseMarker = KCM_MARKER_PREFIX & "|" & CStr(row.Item("idempotencyKey")) & "|" & _
        CStr(row.Item("targetMappingVersion")) & "|" & CStr(row.Item("completionDate"))
End Function

''' El codigo visible de cada sesion con fechas pendientes, por su identificador.
'''
''' Sale de RELEASE_SESSIONS_V1, la misma consulta del subpanel de entradas. RELEASE_PULL_V1 no
''' trae el codigo, y agregarle una columna romperia a cualquier libro que siga con los modulos
''' anteriores: su lector exige las columnas exactas.
''' El nombre del padron y la fecha que la liberacion autorizo reemplazar, por clave de
''' idempotencia. Sale de RELEASE_CONTEXT_V1 por la misma razon que los codigos: RELEASE_PULL_V1
''' conserva sus columnas exactas.
Private Sub KcmContextoDeLiberacion(ByVal nombres As KcmDiccionario, _
    ByVal fechasPrevias As KcmDiccionario)
    Dim respuesta As KcmDiccionario
    Dim filas As Collection
    Dim fila As KcmDiccionario
    Dim clave As String

    Set respuesta = KcmHttpPost("RELEASE_CONTEXT_V1", "")
    Set filas = KcmParseTsv(KcmDecodeResponsePayload(respuesta), _
        Array("idempotencyKey", "workerName", "expectedPreviousDate"))
    For Each fila In filas
        clave = CStr(fila.Item("idempotencyKey"))
        If Not nombres.Exists(clave) Then nombres.Add clave, CStr(fila.Item("workerName"))
        If Not fechasPrevias.Exists(clave) Then _
            fechasPrevias.Add clave, CStr(fila.Item("expectedPreviousDate"))
    Next fila
End Sub

''' El valor de `clave` en la fila, o cadena vacia si la fila no lo trae.
Private Function KcmTextoDeFila(ByVal row As KcmDiccionario, ByVal clave As String) As String
    If row.Exists(clave) Then KcmTextoDeFila = Trim$(CStr(row.Item(clave)))
End Function

''' Si dos nombres son de la misma persona, sin exigir que esten escritos igual.
'''
''' Se comparan por palabras, sin acentos ni mayusculas y en cualquier orden, porque la matriz y
''' el padron no siempre ponen apellidos y nombres en el mismo lugar. Basta con que coincidan todas
''' las palabras del nombre mas corto menos una, y al menos dos: asi una letra de mas o un apellido
''' mal escrito no detienen el lote, pero un renglon de otra persona si.
Private Function KcmMismoNombre(ByVal enMatriz As String, ByVal enPadron As String) As Boolean
    Dim a As String
    Dim b As String
    Dim palabrasA As Variant
    Dim palabrasB As Variant
    Dim termino As Variant
    Dim otra As Variant
    Dim contadasA As Long
    Dim contadasB As Long
    Dim comunes As Long
    Dim menor As Long

    a = KcmNormalizeLabel(enMatriz)
    b = KcmNormalizeLabel(enPadron)
    If Len(a) = 0 Or Len(b) = 0 Then Exit Function
    If a = b Then
        KcmMismoNombre = True
        Exit Function
    End If
    palabrasA = Split(a, " ")
    palabrasB = Split(b, " ")
    For Each termino In palabrasA
        If Len(termino) >= 2 Then contadasA = contadasA + 1
    Next termino
    For Each otra In palabrasB
        If Len(otra) >= 2 Then contadasB = contadasB + 1
    Next otra
    For Each termino In palabrasA
        If Len(termino) >= 2 Then
            For Each otra In palabrasB
                If CStr(otra) = CStr(termino) Then
                    comunes = comunes + 1
                    Exit For
                End If
            Next otra
        End If
    Next termino
    menor = contadasA
    If contadasB < menor Then menor = contadasB
    If menor <= 1 Then
        KcmMismoNombre = (comunes >= 1)
    Else
        KcmMismoNombre = (comunes >= 2 And comunes >= menor - 1)
    End If
End Function

Private Function KcmCodigosDeSesion() As KcmDiccionario
    Dim codigos As KcmDiccionario
    Dim respuesta As KcmDiccionario
    Dim filas As Collection
    Dim fila As KcmDiccionario

    Set codigos = KcmNuevoDiccionario()
    Set respuesta = KcmHttpPost("RELEASE_SESSIONS_V1", "")
    Set filas = KcmParseTsv(KcmDecodeResponsePayload(respuesta), _
        Array("sessionId", "sessionCode", "trainingId", "completionDate", "pending"))
    For Each fila In filas
        If Not codigos.Exists(CStr(fila.Item("sessionId"))) Then
            codigos.Add CStr(fila.Item("sessionId")), CStr(fila.Item("sessionCode"))
        End If
    Next fila
    Set KcmCodigosDeSesion = codigos
End Function

''' El acuse viaja una sola vez por lote y el ledger local se escribe en un bloque. La version
''' anterior guardaba el libro controlador una vez por fila: quinientas liberaciones significaban
''' quinientos guardados completos.
Private Sub KcmSendReleaseAcknowledgements(ByVal rows As Collection, _
    ByVal workbookHash As String)
    Dim headers As Variant
    Dim payloadRows As New Collection
    Dim ledgerRows As New Collection
    Dim row As KcmDiccionario
    Dim requestId As String
    Dim recordedAt As String
    headers = Array("idempotencyKey", "batchId", "targetMappingVersion", "completionDate", _
        "status", "workbookSha256", "destinationAddress", "detail")
    For Each row In rows
        payloadRows.Add Array( _
            CStr(row.Item("idempotencyKey")), CStr(row.Item("batchId")), CStr(row.Item("targetMappingVersion")), _
            CStr(row.Item("completionDate")), CStr(row.Item("applyStatus")), workbookHash, _
            CStr(row.Item("destinationAddress")), Left$(CStr(row.Item("detail")), 300))
    Next row
    requestId = KcmNewRequestId("vba-release-ack")
    KcmHttpPost "RELEASE_ACK_V1", KcmBuildTsv(headers, payloadRows), requestId
    recordedAt = KcmUtcIsoNow()
    For Each row In rows
        ledgerRows.Add Array( _
            CStr(row.Item("idempotencyKey")), CStr(row.Item("batchId")), CStr(row.Item("applyStatus")), _
            CStr(row.Item("destinationAddress")), CStr(row.Item("completionDate")), _
            CStr(row.Item("targetMappingVersion")), requestId, workbookHash, recordedAt)
    Next row
    KcmLedgerAppendRows KCM_RELEASE_LEDGER_SHEET, ledgerRows
End Sub
