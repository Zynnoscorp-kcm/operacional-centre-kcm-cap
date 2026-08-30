Attribute VB_Name = "KcmReleaseSync"
Option Explicit

Public Sub KcmApplyPendingReleases(Optional ByVal silent As Boolean = False)
    Dim response As KcmDiccionario
    Dim rows As Collection
    Dim headers As Variant
    Dim batches As KcmDiccionario
    Dim batchRows As Collection
    Dim row As KcmDiccionario
    Dim batchKey As Variant
    Dim master As Workbook

    KcmResetCaches
    Set response = KcmHttpPost("RELEASE_PULL_V1", "")
    headers = Array( _
        "idempotencyKey", "batchId", "sessionId", "employeeId", "trainingId", _
        "completionDate", "destinationSheet", "destinationColumn", "headerRow", _
        "destinationHeader", "targetMappingVersion", "overwritePolicy")
    Set rows = KcmParseTsv(KcmDecodeResponsePayload(response), headers)
    If rows.Count = 0 Then
        If Not silent Then MsgBox "No hay liberaciones pendientes para Excel.", vbInformation
        Exit Sub
    End If

    Set batches = KcmNuevoDiccionario()
    For Each row In rows
        If Len(CStr(row.Item("batchId"))) = 0 Then Err.Raise vbObjectError + 7400, _
            "KcmApplyPendingReleases", "Una liberacion no conserva batchId"
        If Not batches.Exists(CStr(row.Item("batchId"))) Then
            Set batchRows = New Collection
            batches.AgregarObjeto CStr(row.Item("batchId")), batchRows
        End If
        Set batchRows = batches.Objeto(CStr(row.Item("batchId")))
        batchRows.Add row
    Next row

    Set master = KcmOpenMaster(False)
    For Each batchKey In batches.Keys
        Set batchRows = batches.Objeto(CStr(batchKey))
        KcmApplyReleaseBatch master, batchRows
    Next batchKey
    If Not silent Then MsgBox CStr(rows.Count) & _
        " liberaciones fueron revisadas. Consulte los acuses en la plataforma.", vbInformation
End Sub

''' Un lote es todo o nada. El preflight completo ocurre antes de la primera escritura y cada fila
''' recibe un estado propio, de modo que la plataforma siempre reciba un acuse: un conflicto de
''' hoja, columna o encabezado ya no aborta el ciclo entero con un error de Excel sin explicar.
Private Sub KcmApplyReleaseBatch(ByVal master As Workbook, ByVal rows As Collection)
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

    Set employeeIndexes = KcmNuevoDiccionario()

    For Each row In rows
        KcmInspectReleaseRow master, row, employeeIndexes
        If CStr(row.Item("applyStatus")) <> "READY" And _
            CStr(row.Item("applyStatus")) <> "RECOVERED" Then
            hasConflict = True
        End If
    Next row

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
            ' borrarlo seria perder informacion que nadie mas guarda. Solo se retira el marcador
            ' anterior, para que no se acumulen uno debajo de otro liberacion tras liberacion.
            previousNote = KcmNotaSinMarcador(previousComments(previousComments.Count))
            If Not target.Comment Is Nothing Then target.Comment.Delete
            target.AddComment KcmNotaConMarcador(previousNote, KcmReleaseMarker(row))
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
    If Not employeeIndexes.Exists(indexKey) Then
        employeeIndexes.AgregarObjeto indexKey, KcmEmployeeRowIndex(sheet, _
            KcmColumnNumber(KcmConfigValue("EMPLOYEE_COLUMN")), headerRow + 1)
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
        If currentDate = CStr(row.Item("completionDate")) Then
            KcmSetRowStatus row, "RECOVERED", "Efecto recuperado por la fecha de la celda"
        ElseIf CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" Then
            KcmSetRowStatus row, "READY", "Sobrescritura gobernada por la plataforma"
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

''' La nota de una celda sin la linea del marcador de la plataforma.
'''
''' Sirve para dos cosas: recuperar lo que una persona escribio a mano, para no perderlo al
''' reescribir la nota, y evitar que el marcador se acumule cada vez que se libera esa celda.
Private Function KcmNotaSinMarcador(ByVal texto As String) As String
    Dim lineas() As String
    Dim conservadas As String
    Dim indice As Long
    Dim linea As String

    If Len(texto) = 0 Then Exit Function
    lineas = Split(Replace$(texto, vbCrLf, vbLf), vbLf)
    For indice = 0 To UBound(lineas)
        linea = lineas(indice)
        If Left$(LTrim$(linea), Len(KCM_MARKER_PREFIX)) <> KCM_MARKER_PREFIX Then
            If Len(Trim$(linea)) > 0 Then
                If Len(conservadas) > 0 Then conservadas = conservadas & vbLf
                conservadas = conservadas & linea
            End If
        End If
    Next indice
    KcmNotaSinMarcador = conservadas
End Function

''' La nota que se escribe en la celda: primero lo que la persona haya anotado, y debajo el
''' marcador. El marcador va al final a proposito: quien abre la nota lee su apunte, no la clave
''' tecnica, y la plataforma lo encuentra igual porque lo busca dentro del texto.
Private Function KcmNotaConMarcador(ByVal nota As String, ByVal marcador As String) As String
    If Len(nota) = 0 Then
        KcmNotaConMarcador = marcador
    Else
        KcmNotaConMarcador = nota & vbLf & marcador
    End If
End Function

Private Function KcmReleaseMarker(ByVal row As KcmDiccionario) As String
    KcmReleaseMarker = KCM_MARKER_PREFIX & "|" & CStr(row.Item("idempotencyKey")) & "|" & _
        CStr(row.Item("targetMappingVersion")) & "|" & CStr(row.Item("completionDate"))
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
