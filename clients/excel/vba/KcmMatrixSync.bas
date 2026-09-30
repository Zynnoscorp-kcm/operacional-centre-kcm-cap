Attribute VB_Name = "KcmMatrixSync"
Option Explicit
Option Private Module

Private Const KCM_SOURCE_KEY_LIMIT As Long = 200

Public Function KcmBuildHcSnapshot(ByVal master As Workbook, ByVal sourceHash As String) As String
    Dim sheet As Worksheet
    Dim sheetName As String
    Dim employeeColumn As Long
    Dim firstCourseColumn As Long
    Dim lastCourseColumn As Long
    Dim firstEmployeeRow As Long
    Dim lastEmployeeRow As Long
    Dim courses As KcmDiccionario
    Dim course As KcmDiccionario
    Dim values As Variant
    Dim formulas As Variant
    Dim employees As New Collection
    Dim completions As New Collection
    Dim courseJson As New Collection
    Dim employeeIds As KcmDiccionario
    Dim rowIndex As Long
    Dim columnNumber As Long
    Dim columnIndex As Long
    Dim employeeId As String
    Dim completionDate As String
    Dim formulaCount As Long
    Dim errorCellCount As Long
    Dim skippedEmployeeCount As Long
    Dim filasConError As KcmDiccionario
    Dim direcciones As New Collection
    Dim listaTruncada As Boolean
    Dim issueMembers As New Collection
    Dim issueJson As New Collection
    Dim mergedCellCount As Long
    Dim cellValue As Variant
    Dim members As New Collection
    Dim sourceMembers As New Collection
    Dim countMembers As New Collection
    Dim diagnosticMembers As New Collection

    If LCase$(Right$(master.Name, 5)) <> ".xlsb" Then Err.Raise vbObjectError + 7301, _
        "KcmBuildHcSnapshot", "La matriz configurada debe ser XLSB"
    If Len(sourceHash) <> 64 Or sourceHash Like "*[!0-9a-f]*" Then Err.Raise vbObjectError + 7302, _
        "KcmBuildHcSnapshot", "La huella de la matriz no es valida"

    sheetName = KcmConfigValue("MATRIX_SHEET")
    Set sheet = master.Worksheets(sheetName)
    employeeColumn = KcmColumnNumber(KcmConfigValue("EMPLOYEE_COLUMN"))
    firstCourseColumn = KcmColumnNumber(KcmConfigValue("FIRST_COURSE_COLUMN"))
    lastCourseColumn = KcmColumnNumber(KcmConfigValue("LAST_COURSE_COLUMN"))
    If lastCourseColumn < firstCourseColumn Then Err.Raise vbObjectError + 7303, _
        "KcmBuildHcSnapshot", "El rango de cursos es invalido"
    If employeeColumn + 7 >= firstCourseColumn Then Err.Raise vbObjectError + 7313, _
        "KcmBuildHcSnapshot", "Los atributos del trabajador se traslapan con el rango de cursos"

    lastEmployeeRow = sheet.Cells(sheet.Rows.Count, employeeColumn).End(xlUp).Row
    firstEmployeeRow = KcmFirstEmployeeRow(sheet, employeeColumn, lastEmployeeRow)
    If firstEmployeeRow < 2 Then Err.Raise vbObjectError + 7314, "KcmBuildHcSnapshot", _
        "La hoja " & sheetName & " no reserva filas de encabezado"
    KcmAssertUnmergedBlock sheet, firstEmployeeRow, employeeColumn, lastEmployeeRow, lastCourseColumn

    Set courses = KcmBuildCourseCatalog(sheet, firstEmployeeRow, firstCourseColumn, lastCourseColumn)
    mergedCellCount = KcmCountHeaderMerges(sheet, firstEmployeeRow, employeeColumn, lastCourseColumn)
    KcmAssertNoCoursesBeyondLimit sheet, firstEmployeeRow, firstCourseColumn, lastCourseColumn

    values = KcmRangeValues(sheet, firstEmployeeRow, employeeColumn, lastEmployeeRow, lastCourseColumn)
    formulas = KcmRangeFormulas(sheet, firstEmployeeRow, employeeColumn, lastEmployeeRow, lastCourseColumn)
    Set employeeIds = KcmNuevoDiccionario()

    Set filasConError = KcmNuevoDiccionario()
    For rowIndex = 1 To UBound(values, 1)
        For columnIndex = 1 To UBound(values, 2)
            If IsError(values(rowIndex, columnIndex)) Then
                errorCellCount = errorCellCount + 1
                filasConError.Fijar CStr(rowIndex), True
                If direcciones.Count < 20 Then
                    direcciones.Add KcmColumnLetters(employeeColumn + columnIndex - 1) & _
                        CStr(firstEmployeeRow + rowIndex - 1)
                Else
                    listaTruncada = True
                End If
            End If
        Next columnIndex
    Next rowIndex
    If errorCellCount > 0 Then
        If Not KcmDecidirCeldasConError(errorCellCount, filasConError.Count, direcciones, listaTruncada) Then
            Err.Raise vbObjectError + 7307, "KcmBuildHcSnapshot", _
                "La matriz contiene " & CStr(errorCellCount) & " celdas de error en el rango importado; " & _
                "la primera es " & CStr(direcciones(1))
        End If
    End If

    For rowIndex = 1 To UBound(values, 1)
        If Not filasConError.Exists(CStr(rowIndex)) Then
            For columnIndex = 1 To UBound(values, 2)
                If Left$(KcmCellText(formulas(rowIndex, columnIndex)), 1) = "=" Then
                    formulaCount = formulaCount + 1
                End If
            Next columnIndex
        End If
    Next rowIndex

    For rowIndex = 1 To UBound(values, 1)
        cellValue = values(rowIndex, 1)
        If filasConError.Exists(CStr(rowIndex)) Then
            skippedEmployeeCount = skippedEmployeeCount + 1
        ElseIf Not IsError(cellValue) And Len(Trim$(KcmCellText(cellValue))) > 0 Then
            employeeId = KcmNormalizeEmployeeId(cellValue)
            If Len(employeeId) = 0 Then Err.Raise vbObjectError + 7304, "KcmBuildHcSnapshot", _
                "La matriz contiene un numero de trabajador invalido en la fila " & _
                CStr(firstEmployeeRow + rowIndex - 1)
            If employeeIds.Exists(employeeId) Then Err.Raise vbObjectError + 7305, _
                "KcmBuildHcSnapshot", "La matriz contiene numeros de trabajador duplicados"
            employeeIds.Add employeeId, True
            employees.Add KcmEmployeeJson(values, rowIndex, employeeId, firstEmployeeRow, _
                employeeColumn)

            For columnNumber = firstCourseColumn To lastCourseColumn
                columnIndex = columnNumber - employeeColumn + 1
                cellValue = values(rowIndex, columnIndex)
                If Not IsError(cellValue) And Len(Trim$(KcmCellText(cellValue))) > 0 Then
                    completionDate = KcmIsoDate(cellValue)
                    If Len(completionDate) = 0 Then Err.Raise vbObjectError + 7306, _
                        "KcmBuildHcSnapshot", "La matriz contiene una fecha de capacitacion invalida en " & _
                        KcmColumnLetters(columnNumber) & CStr(firstEmployeeRow + rowIndex - 1)
                    Set course = courses.Objeto(CStr(columnNumber))
                    Set members = New Collection
                    members.Add KcmJsonPair("employeeId", employeeId)
                    members.Add KcmJsonPair("sourceKey", CStr(course.Item("sourceKey")))
                    members.Add KcmJsonPair("completionDate", completionDate)
                    completions.Add KcmJsonObject(members)
                End If
            Next columnNumber
        End If
    Next rowIndex

    For columnNumber = firstCourseColumn To lastCourseColumn
        Set course = courses.Objeto(CStr(columnNumber))
        Set members = New Collection
        members.Add KcmJsonPair("sourceKey", CStr(course.Item("sourceKey")))
        members.Add KcmJsonPair("sourceColumn", CStr(course.Item("sourceColumn")))
        members.Add KcmJsonPair("displayName", CStr(course.Item("displayName")))
        members.Add KcmJsonPair("normalizedName", CStr(course.Item("normalizedName")))
        courseJson.Add KcmJsonObject(members)
    Next columnNumber

    sourceMembers.Add KcmJsonPair("fileName", master.Name)
    sourceMembers.Add KcmJsonPair("sha256", sourceHash)
    sourceMembers.Add KcmJsonNumber("byteSize", CDbl(FileLen(master.FullName)))
    sourceMembers.Add KcmJsonPair("sheetName", sheetName)

    countMembers.Add KcmJsonNumber("employeeCount", employees.Count)
    countMembers.Add KcmJsonNumber("courseCount", courseJson.Count)
    countMembers.Add KcmJsonNumber("completionCount", completions.Count)
    countMembers.Add KcmJsonNumber("skippedEmployeeCount", skippedEmployeeCount)
    countMembers.Add KcmJsonNumber("skippedCourseCount", 0)
    countMembers.Add KcmJsonNumber("skippedCompletionCount", 0)
    countMembers.Add KcmJsonNumber("formulaCellCount", formulaCount)
    countMembers.Add KcmJsonNumber("formulaCachedValueCount", formulaCount)
    countMembers.Add KcmJsonNumber("formulaErrorCount", 0)
    countMembers.Add KcmJsonNumber("externalLinkCount", KcmExternalLinkCount(master))
    countMembers.Add KcmJsonNumber("mergedCellCount", mergedCellCount)

    diagnosticMembers.Add KcmJsonRaw("counts", KcmJsonObject(countMembers))
    If errorCellCount > 0 Then
        issueMembers.Add KcmJsonPair("code", "EMPLOYEE_CELL_ERROR")
        issueMembers.Add KcmJsonNumber("count", errorCellCount)
        issueMembers.Add KcmJsonPair("detail", KcmListaDirecciones(direcciones, listaTruncada))
        issueJson.Add KcmJsonObject(issueMembers)
    End If
    diagnosticMembers.Add KcmJsonRaw("issues", KcmJsonArray(issueJson))

    Set members = New Collection
    members.Add KcmJsonPair("schemaVersion", "HC_SNAPSHOT_V1")
    members.Add KcmJsonRaw("source", KcmJsonObject(sourceMembers))
    members.Add KcmJsonPair("extractedAt", KcmUtcIsoNow())
    members.Add KcmJsonRaw("employees", KcmJsonArray(employees))
    members.Add KcmJsonRaw("courses", KcmJsonArray(courseJson))
    members.Add KcmJsonRaw("completions", KcmJsonArray(completions))
    members.Add KcmJsonRaw("diagnostics", KcmJsonObject(diagnosticMembers))
    KcmBuildHcSnapshot = KcmJsonObject(members)
End Function

Private Function KcmDecidirCeldasConError(ByVal totalCeldas As Long, ByVal totalFilas As Long, _
    ByVal direcciones As Collection, ByVal truncada As Boolean) As Boolean
    Dim politica As String

    politica = UCase$(Trim$(KcmConfigValue("MATRIX_CELDAS_ERROR", False)))
    If politica = "OMITIR" Then
        KcmDecidirCeldasConError = True
        Exit Function
    End If
    If politica = "DETENER" Then Exit Function

    KcmDecidirCeldasConError = KcmAvisoConfirmar("Celdas con error en la matriz", _
        "La matriz tiene " & KcmPlural(totalCeldas, "celda con error", "celdas con error") & _
        " en " & KcmPlural(totalFilas, "trabajador", "trabajadores") & ".", _
        KcmListaDirecciones(direcciones, truncada) & vbCrLf & vbCrLf & _
        "Si: se envia la matriz sin esos trabajadores." & vbCrLf & _
        "No: no se envia nada.")
End Function

Private Function KcmListaDirecciones(ByVal direcciones As Collection, ByVal truncada As Boolean) As String
    Dim indice As Long
    Dim lista As String

    For indice = 1 To direcciones.Count
        If Len(lista) > 0 Then lista = lista & ", "
        lista = lista & CStr(direcciones(indice))
    Next indice
    If truncada Then lista = lista & ", ..."
    KcmListaDirecciones = lista
End Function

Private Sub KcmAssertUnmergedBlock(ByVal sheet As Worksheet, ByVal firstRow As Long, _
    ByVal firstColumn As Long, ByVal lastRow As Long, ByVal lastColumn As Long)
    Dim state As Variant
    state = sheet.Range(sheet.Cells(firstRow, firstColumn), sheet.Cells(lastRow, lastColumn)).MergeCells
    If IsNull(state) Then
        Err.Raise vbObjectError + 7315, "KcmAssertUnmergedBlock", _
            "El bloque de datos de " & sheet.Name & " contiene celdas combinadas"
    End If
    If state = True Then
        Err.Raise vbObjectError + 7315, "KcmAssertUnmergedBlock", _
            "El bloque de datos de " & sheet.Name & " esta completamente combinado"
    End If
End Sub

Private Sub KcmAssertNoCoursesBeyondLimit(ByVal sheet As Worksheet, ByVal firstEmployeeRow As Long, _
    ByVal firstCourseColumn As Long, ByVal lastCourseColumn As Long)
    Dim used As Range
    Dim scanLastColumn As Long
    Dim headerValues As Variant
    Dim columnNumber As Long
    Dim rowNumber As Long
    Set used = sheet.UsedRange
    scanLastColumn = used.Column + used.Columns.Count - 1
    If scanLastColumn > 16384 Then scanLastColumn = 16384
    If scanLastColumn <= lastCourseColumn Then Exit Sub
    headerValues = KcmRangeValues(sheet, 1, lastCourseColumn + 1, firstEmployeeRow - 1, scanLastColumn)
    For columnNumber = lastCourseColumn + 1 To scanLastColumn
        For rowNumber = 1 To firstEmployeeRow - 1
            If Len(KcmHeaderSegment(sheet, rowNumber, columnNumber, firstCourseColumn, _
                headerValues, lastCourseColumn + 1)) > 0 Then
                Err.Raise vbObjectError + 7316, "KcmAssertNoCoursesBeyondLimit", _
                    "La columna " & KcmColumnLetters(columnNumber) & " contiene un encabezado de " & _
                    "capacitacion fuera del rango autorizado; LAST_COURSE_COLUMN no llega hasta ahi"
            End If
        Next rowNumber
    Next columnNumber
End Sub

Private Function KcmExternalLinkCount(ByVal master As Workbook) As Long
    Dim links As Variant
    links = master.LinkSources(xlExcelLinks)
    If IsArray(links) Then KcmExternalLinkCount = UBound(links) - LBound(links) + 1
End Function

Private Function KcmCountHeaderMerges(ByVal sheet As Worksheet, ByVal firstEmployeeRow As Long, _
    ByVal firstColumn As Long, ByVal lastColumn As Long) As Long
    Dim areas As KcmDiccionario
    Dim rowNumber As Long
    Dim columnNumber As Long
    Dim cell As Range
    Dim mergedAddress As String
    Set areas = KcmNuevoDiccionario()
    For rowNumber = 1 To firstEmployeeRow - 1
        For columnNumber = firstColumn To lastColumn
            Set cell = sheet.Cells(rowNumber, columnNumber)
            If cell.MergeCells Then
                mergedAddress = cell.MergeArea.Address(True, True)
                If Not areas.Exists(mergedAddress) Then areas.Add mergedAddress, True
            End If
        Next columnNumber
    Next rowNumber
    KcmCountHeaderMerges = areas.Count
End Function

Private Function KcmEmployeeJson(ByVal values As Variant, ByVal rowIndex As Long, _
    ByVal employeeId As String, ByVal firstEmployeeRow As Long, ByVal employeeColumn As Long) As String
    Dim displayName As String
    Dim hireDate As String
    Dim members As New Collection
    Dim sheetRow As Long
    sheetRow = firstEmployeeRow + rowIndex - 1
    displayName = KcmEmployeeText(values, rowIndex, 2, sheetRow, "nombre")
    If Len(displayName) = 0 Or Left$(displayName, 1) = "=" Or Left$(displayName, 1) = "+" _
        Or Left$(displayName, 1) = "@" Then
        Err.Raise vbObjectError + 7308, "KcmEmployeeJson", _
            "La matriz contiene un nombre de trabajador invalido en la fila " & CStr(sheetRow)
    End If
    If Not IsError(values(rowIndex, 3)) Then
        If Len(Trim$(KcmCellText(values(rowIndex, 3)))) > 0 Then
            hireDate = KcmIsoDate(values(rowIndex, 3))
            If Len(hireDate) = 0 Then Err.Raise vbObjectError + 7309, "KcmEmployeeJson", _
                "La celda " & KcmColumnLetters(employeeColumn + 2) & CStr(sheetRow) & _
                " no tiene una fecha de ingreso valida; contiene: " & _
                Left$(KcmCellText(values(rowIndex, 3)), 40)
        End If
    Else
        Err.Raise vbObjectError + 7309, "KcmEmployeeJson", _
            "La celda " & KcmColumnLetters(employeeColumn + 2) & CStr(sheetRow) & _
            " es un error de formula y ahi va la fecha de ingreso"
    End If
    members.Add KcmJsonPair("employeeId", employeeId)
    members.Add KcmJsonPair("displayName", displayName)
    members.Add KcmJsonPair("hireDate", hireDate)
    members.Add KcmJsonPair("payrollType", KcmEmployeeText(values, rowIndex, 4, sheetRow, "nomina"))
    members.Add KcmJsonPair("position", KcmEmployeeText(values, rowIndex, 5, sheetRow, "puesto"))
    members.Add KcmJsonPair("department", KcmEmployeeText(values, rowIndex, 6, sheetRow, "departamento"))
    members.Add KcmJsonPair("area", KcmEmployeeText(values, rowIndex, 7, sheetRow, "area"))
    members.Add KcmJsonPair("plant", KcmEmployeeText(values, rowIndex, 8, sheetRow, "planta"))
    KcmEmployeeJson = KcmJsonObject(members)
End Function

Private Function KcmEmployeeText(ByVal values As Variant, ByVal rowIndex As Long, _
    ByVal columnIndex As Long, ByVal sheetRow As Long, ByVal fieldName As String) As String
    If IsError(values(rowIndex, columnIndex)) Then Err.Raise vbObjectError + 7317, _
        "KcmEmployeeText", "El campo " & fieldName & " de la fila " & CStr(sheetRow) & _
        " es un error de formula"
    KcmEmployeeText = Trim$(KcmCellText(values(rowIndex, columnIndex)))
End Function

Public Function KcmBuildCourseCatalog(ByVal sheet As Worksheet, ByVal firstEmployeeRow As Long, _
    ByVal firstCourseColumn As Long, ByVal lastCourseColumn As Long) As KcmDiccionario
    Dim courses As KcmDiccionario
    Dim sourceKeys As KcmDiccionario
    Dim headerValues As Variant
    Dim columnNumber As Long
    Dim rowNumber As Long
    Dim labels As Collection
    Dim slugs As Collection
    Dim text As String
    Dim slug As String
    Dim sourceKey As String
    Dim unfoldable As Long
    Dim repetido As Boolean
    Dim course As KcmDiccionario
    Set courses = KcmNuevoDiccionario()
    Set sourceKeys = KcmNuevoDiccionario()
    headerValues = KcmRangeValues(sheet, 1, firstCourseColumn, firstEmployeeRow - 1, lastCourseColumn)

    For columnNumber = firstCourseColumn To lastCourseColumn
        Set labels = New Collection
        Set slugs = New Collection
        For rowNumber = 1 To firstEmployeeRow - 1
            text = KcmHeaderSegment(sheet, rowNumber, columnNumber, firstCourseColumn, _
                headerValues, firstCourseColumn)
            unfoldable = KcmUnfoldableCharacter(text)
            If unfoldable > 0 Then Err.Raise vbObjectError + 7319, "KcmBuildCourseCatalog", _
                "El encabezado de " & KcmColumnLetters(columnNumber) & CStr(rowNumber) & _
                " contiene el caracter U+" & Right$("0000" & Hex$(unfoldable), 4) & _
                ", que el cliente y el extractor no normalizan igual; el texto de HC tiene que corregirse"
            slug = KcmSourceSlug(text)
            If Len(slug) > 0 Then
                repetido = False
                If slugs.Count > 0 Then repetido = (CStr(slugs(slugs.Count)) = slug)
                If Not repetido Then
                    labels.Add text
                    slugs.Add slug
                End If
            End If
        Next rowNumber
        If slugs.Count = 0 Then Err.Raise vbObjectError + 7310, "KcmBuildCourseCatalog", _
            "Falta un encabezado de capacitacion en la columna " & KcmColumnLetters(columnNumber)
        sourceKey = "hc-course:" & KcmJoinCollection(slugs, "/")
        If Len(sourceKey) > KCM_SOURCE_KEY_LIMIT Then Err.Raise vbObjectError + 7318, _
            "KcmBuildCourseCatalog", "La identidad de la columna " & KcmColumnLetters(columnNumber) & _
            " excede " & CStr(KCM_SOURCE_KEY_LIMIT) & " caracteres"
        If sourceKeys.Exists(sourceKey) Then Err.Raise vbObjectError + 7311, _
            "KcmBuildCourseCatalog", "Dos columnas comparten la misma identidad de capacitacion"
        sourceKeys.Add sourceKey, True
        Set course = KcmNuevoDiccionario()
        course.Add "sourceKey", sourceKey
        course.Add "sourceColumn", KcmColumnLetters(columnNumber)
        course.Add "displayName", CStr(labels(labels.Count))
        course.Add "normalizedName", KcmNormalizeLabel(CStr(labels(labels.Count)))
        course.Add "columnNumber", columnNumber
        courses.AgregarObjeto CStr(columnNumber), course
    Next columnNumber
    Set KcmBuildCourseCatalog = courses
End Function

Private Function KcmHeaderSegment(ByVal sheet As Worksheet, ByVal rowNumber As Long, _
    ByVal columnNumber As Long, ByVal firstCourseColumn As Long, ByVal headerValues As Variant, _
    ByVal headerFirstColumn As Long) As String
    Dim raw As Variant
    Dim cell As Range
    Dim area As Range
    raw = headerValues(rowNumber, columnNumber - headerFirstColumn + 1)
    If Not IsError(raw) Then
        If Len(Trim$(KcmCellText(raw))) > 0 Then
            KcmHeaderSegment = Trim$(KcmCellText(raw))
            Exit Function
        End If
    End If
    Set cell = sheet.Cells(rowNumber, columnNumber)
    If Not cell.MergeCells Then Exit Function
    Set area = cell.MergeArea
    If area.Column < firstCourseColumn Then Exit Function
    KcmHeaderSegment = Trim$(KcmCellText(area.Cells(1, 1).Value))
End Function

Public Function KcmSourceSlug(ByVal value As String) As String
    Dim normalized As String
    normalized = LCase$(KcmNormalizeLabel(Replace$(value, "&", " y ")))
    KcmSourceSlug = Replace$(normalized, " ", "-")
End Function

Private Function KcmFirstEmployeeRow(ByVal sheet As Worksheet, ByVal employeeColumn As Long, _
    ByVal lastRow As Long) As Long
    Dim values As Variant
    Dim rowIndex As Long
    values = KcmRangeValues(sheet, 1, employeeColumn, lastRow, employeeColumn)
    For rowIndex = 1 To UBound(values, 1)
        If Len(KcmNormalizeEmployeeId(values(rowIndex, 1))) = 5 Then
            KcmFirstEmployeeRow = rowIndex
            Exit Function
        End If
    Next rowIndex
    Err.Raise vbObjectError + 7312, "KcmFirstEmployeeRow", _
        "La hoja " & sheet.Name & " no contiene trabajadores validos en la columna " & _
        KcmColumnLetters(employeeColumn)
End Function
