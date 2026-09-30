Attribute VB_Name = "KcmReleaseSync"
Option Explicit
Option Private Module

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

    Set codigos = KcmCodigosDeSesion()
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

Private Function KcmSesionEscogida(ByVal sesion As String, ByVal sesiones As String) As Boolean
    If Len(sesiones) = 0 Then
        KcmSesionEscogida = True
        Exit Function
    End If
    KcmSesionEscogida = InStr(1, "|" & sesiones, "|" & sesion & "|", vbBinaryCompare) > 0
End Function

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
            previousFormats.Add CStr(target.NumberFormat)
            previousValues.Add target.Value
            If target.Comment Is Nothing Then
                previousComments.Add ""
            Else
                previousComments.Add CStr(target.Comment.text)
            End If
            If CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" And _
                Len(Trim$(KcmCellText(target.Value))) > 0 Then
                KcmRecordOverwriteHistory row, target
            End If
            written.Add target
            target.Value = KcmDateFromIso(CStr(row.Item("completionDate")))
            If target.NumberFormat = "General" Then target.NumberFormat = "dd/mm/yyyy"
            previousNote = KcmNotaSinMarcador(previousComments(previousComments.Count))
            If Not target.Comment Is Nothing Then target.Comment.Delete
            target.AddComment KcmNotaConMarcador(previousNote, KcmNotaDeLaSesion(row))
            KcmAjustarNota target.Comment
            row.Fijar "applyStatus", "APPLIED"
        End If
    Next row

    Application.Calculation = previousCalculation
    If previousCalculation = xlCalculationAutomatic Then Application.Calculate
    If written.Count > 0 Then master.Save
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

Private Function KcmAdvertenciaEscribible(ByVal estado As String) As Boolean
    KcmAdvertenciaEscribible = (estado = "NAME_MISMATCH" Or estado = "NEWER_DATE_CONFLICT" Or _
        estado = "UNEXPECTED_DATE_CONFLICT")
End Function

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
        KcmSetRowStatus row, "READY", ""
    Else
        currentDate = KcmIsoDate(target.Value)
        fechaEsperada = KcmTextoDeFila(row, "expectedPreviousDate")
        If currentDate = CStr(row.Item("completionDate")) Then
            KcmSetRowStatus row, "RECOVERED", "Efecto recuperado por la fecha de la celda"
        ElseIf Len(currentDate) > 0 And currentDate > CStr(row.Item("completionDate")) Then
            KcmSetRowStatus row, "NEWER_DATE_CONFLICT", "La matriz ya tiene una fecha mas reciente: " & _
                currentDate
        ElseIf CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" And _
            Len(fechaEsperada) > 0 And currentDate = fechaEsperada Then
            KcmSetRowStatus row, "READY", "Sobrescritura autorizada en la plataforma"
        ElseIf CStr(row.Item("overwritePolicy")) = "OVERWRITE_WITH_HISTORY" Then
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

Private Function KcmTextoDeFila(ByVal row As KcmDiccionario, ByVal clave As String) As String
    If row.Exists(clave) Then KcmTextoDeFila = Trim$(CStr(row.Item(clave)))
End Function

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
