Attribute VB_Name = "KcmBridgeCore"
Option Explicit
Option Private Module

Public Const KCM_PROTOCOL_VERSION As String = "KCM_VBA_BRIDGE_V1"
Public Const KCM_CONFIG_SHEET As String = "KCM_CONFIG"
Public Const KCM_RELEASE_LEDGER_SHEET As String = "KCM_ACUSES"
Public Const KCM_OVERWRITE_LEDGER_SHEET As String = "KCM_SOBRESCRITURAS"
Public Const KCM_TOKEN_ENV As String = "KCM_VBA_BRIDGE_TOKEN"
Public Const KCM_MARKER_PREFIX As String = "KCM_VBA_V1"

Private mConfig As KcmDiccionario
Private mFold As KcmDiccionario
Private mMaster As Workbook
Private mMasterOpenedHere As Boolean

Public Sub KcmInstallBridge()
    Dim configSheet As Worksheet
    Dim releaseLedger As Worksheet
    Dim overwriteLedger As Worksheet
    Dim configRow As Long

    Set configSheet = KcmEnsureSheet(ThisWorkbook, KCM_CONFIG_SHEET, xlSheetVisible)
    Set releaseLedger = KcmEnsureSheet(ThisWorkbook, KCM_RELEASE_LEDGER_SHEET, xlSheetVeryHidden)
    Set overwriteLedger = KcmEnsureSheet(ThisWorkbook, KCM_OVERWRITE_LEDGER_SHEET, xlSheetVeryHidden)

    If Len(CStr(configSheet.Cells(1, 1).Value2)) = 0 Then
        configSheet.Cells(1, 1).Value2 = "CLAVE"
        configSheet.Cells(1, 2).Value2 = "VALOR"
        configRow = 2
        KcmWriteConfig configSheet, configRow, "ENDPOINT", ""
        KcmWriteConfig configSheet, configRow, "CLIENT_ID", ""
        KcmWriteConfig configSheet, configRow, "MATRIX_PATH", ""
        KcmWriteConfig configSheet, configRow, "MATRIX_SHEET", "HC"
        KcmWriteConfig configSheet, configRow, "EMPLOYEE_COLUMN", "B"
        KcmWriteConfig configSheet, configRow, "FIRST_COURSE_COLUMN", "J"
        KcmWriteConfig configSheet, configRow, "LAST_COURSE_COLUMN", "AJ"
        KcmWriteConfig configSheet, configRow, "ROSTER_PATH", ""
        KcmWriteConfig configSheet, configRow, "CLOSE_MASTER_AFTER_CYCLE", "TRUE"
        configSheet.Columns("A").ColumnWidth = 34
        configSheet.Columns("B").ColumnWidth = 72
        configSheet.Rows(1).Font.Bold = True
        configSheet.Rows(1).Interior.Color = RGB(31, 78, 121)
        configSheet.Rows(1).Font.Color = RGB(255, 255, 255)
        configSheet.Range("D1").Value2 = "El token no se guarda aqui: vive en la variable de usuario " & KCM_TOKEN_ENV & "."
        configSheet.Range("D1").WrapText = True
        configSheet.Columns("D").ColumnWidth = 52
    End If

    KcmEnsureHeaders releaseLedger, Array( _
        "idempotencyKey", "batchId", "status", "destination", "completionDate", _
        "targetMappingVersion", "requestId", "workbookSha256", "recordedAt")
    KcmEnsureHeaders overwriteLedger, Array( _
        "idempotencyKey", "batchId", "destination", "previousValue", "previousComment", _
        "completionDate", "targetMappingVersion", "actor", "reasonReference", "recordedAt")

    KcmResetCaches
    ThisWorkbook.Save
    KcmAvisoHecho "Instalacion", "Cliente de Excel instalado.", _
        "Conectar este equipo completa la configuracion."
End Sub

Public Sub KcmResetCaches()
    Set mConfig = Nothing
End Sub

Public Function KcmNuevoDiccionario() As KcmDiccionario
    Set KcmNuevoDiccionario = New KcmDiccionario
End Function

Private Sub KcmWriteConfig(ByVal sheet As Worksheet, ByRef rowNumber As Long, _
    ByVal key As String, ByVal value As String)
    sheet.Cells(rowNumber, 1).Value2 = key
    sheet.Cells(rowNumber, 2).Value2 = value
    rowNumber = rowNumber + 1
End Sub

Private Function KcmEnsureSheet(ByVal book As Workbook, ByVal sheetName As String, _
    ByVal visibility As XlSheetVisibility) As Worksheet
    On Error Resume Next
    Set KcmEnsureSheet = book.Worksheets(sheetName)
    Err.Clear
    On Error GoTo 0
    If KcmEnsureSheet Is Nothing Then
        Set KcmEnsureSheet = book.Worksheets.Add(After:=book.Worksheets(book.Worksheets.Count))
        KcmEnsureSheet.Name = sheetName
    End If
    KcmEnsureSheet.Visible = visibility
End Function

Private Sub KcmEnsureHeaders(ByVal sheet As Worksheet, ByVal headers As Variant)
    Dim index As Long
    If Len(CStr(sheet.Cells(1, 1).Value2)) > 0 Then Exit Sub
    For index = LBound(headers) To UBound(headers)
        sheet.Cells(1, index + 1).Value2 = headers(index)
    Next index
    sheet.Rows(1).Font.Bold = True
    sheet.Rows(1).Interior.Color = RGB(31, 78, 121)
    sheet.Rows(1).Font.Color = RGB(255, 255, 255)
End Sub

Private Function KcmConfigMap() As KcmDiccionario
    Dim sheet As Worksheet
    Dim values As Variant
    Dim lastRow As Long
    Dim index As Long
    Dim key As String
    If Not mConfig Is Nothing Then
        Set KcmConfigMap = mConfig
        Exit Function
    End If
    Set mConfig = KcmNuevoDiccionario()
    Set sheet = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    lastRow = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row
    If lastRow >= 2 Then
        values = KcmRangeValues(sheet, 2, 1, lastRow, 2)
        For index = LBound(values, 1) To UBound(values, 1)
            key = Trim$(KcmCellText(values(index, 1)))
            If Len(key) > 0 Then
                If mConfig.Exists(key) Then Err.Raise vbObjectError + 7105, "KcmConfigMap", _
                    "La configuracion " & key & " esta repetida en " & KCM_CONFIG_SHEET
                mConfig.Add key, Trim$(KcmCellText(values(index, 2)))
            End If
        Next index
    End If
    Set KcmConfigMap = mConfig
End Function

Public Function KcmConfigValue(ByVal key As String, Optional ByVal required As Boolean = True) As String
    Dim map As KcmDiccionario
    Set map = KcmConfigMap()
    If Not map.Exists(key) Then
        If required Then Err.Raise vbObjectError + 7100, "KcmConfigValue", "Falta la configuracion " & key
        Exit Function
    End If
    KcmConfigValue = CStr(map.Item(key))
    If required And Len(KcmConfigValue) = 0 Then
        Err.Raise vbObjectError + 7101, "KcmConfigValue", "La configuracion " & key & " esta vacia"
    End If
End Function

Public Function KcmConfigFlag(ByVal key As String, ByVal fallback As Boolean) As Boolean
    Dim raw As String
    raw = UCase$(KcmConfigValue(key, False))
    If Len(raw) = 0 Then
        KcmConfigFlag = fallback
    ElseIf raw = "TRUE" Then
        KcmConfigFlag = True
    ElseIf raw = "FALSE" Then
        KcmConfigFlag = False
    Else
        Err.Raise vbObjectError + 7106, "KcmConfigFlag", "La configuracion " & key & " debe ser TRUE o FALSE"
    End If
End Function

Private Function KcmSamePath(ByVal leftPath As String, ByVal rightPath As String) As Boolean
    Dim a As String
    Dim b As String
    a = UCase$(Trim$(leftPath))
    b = UCase$(Trim$(rightPath))
    Do While Len(a) > 3 And Right$(a, 1) = Application.PathSeparator
        a = Left$(a, Len(a) - 1)
    Loop
    Do While Len(b) > 3 And Right$(b, 1) = Application.PathSeparator
        b = Left$(b, Len(b) - 1)
    Loop
    KcmSamePath = (a = b)
End Function

Private Function KcmMasterStillOpen() As Boolean
    Dim probe As String
    If mMaster Is Nothing Then Exit Function
    On Error Resume Next
    probe = mMaster.Name
    If Err.Number <> 0 Then
        Err.Clear
        Exit Function
    End If
    On Error GoTo 0
    KcmMasterStillOpen = (Len(probe) > 0)
End Function

Public Function KcmOpenMaster(Optional ByVal readOnlyAccess As Boolean = False) As Workbook
    Dim targetPath As String
    Dim book As Workbook
    Dim problem As String
    If Not KcmMasterStillOpen() Then
        Set mMaster = Nothing
        mMasterOpenedHere = False
    End If
    If Not mMaster Is Nothing Then
        If Not readOnlyAccess And mMaster.readOnly Then
            Err.Raise vbObjectError + 7102, "KcmOpenMaster", "La matriz ya esta abierta como solo lectura"
        End If
        Set KcmOpenMaster = mMaster
        Exit Function
    End If
    targetPath = KcmConfigValue("MATRIX_PATH")
    problem = KcmLocalFileProblem(targetPath)
    If Len(problem) > 0 Then Err.Raise vbObjectError + 7107, "KcmOpenMaster", _
        "La ruta configurada de la matriz no sirve: " & problem
    For Each book In Application.Workbooks
        If KcmSamePath(book.FullName, targetPath) Then
            If Not readOnlyAccess And book.readOnly Then
                Err.Raise vbObjectError + 7102, "KcmOpenMaster", "La matriz ya esta abierta como solo lectura"
            End If
            Set mMaster = book
            mMasterOpenedHere = False
            Set KcmOpenMaster = book
            Exit Function
        End If
    Next book
    Set mMaster = Application.Workbooks.Open( _
        Filename:=targetPath, UpdateLinks:=0, readOnly:=readOnlyAccess, AddToMru:=False, Notify:=False)
    mMasterOpenedHere = True
    Set KcmOpenMaster = mMaster
End Function

Public Sub KcmReleaseMaster()
    If mMaster Is Nothing Then Exit Sub
    If mMasterOpenedHere And KcmConfigFlag("CLOSE_MASTER_AFTER_CYCLE", True) Then
        On Error Resume Next
        mMaster.Close SaveChanges:=False
        On Error GoTo 0
    End If
    Set mMaster = Nothing
    mMasterOpenedHere = False
End Sub

Public Function KcmCellText(ByVal value As Variant) As String
    If IsError(value) Then Exit Function
    If IsEmpty(value) Or IsNull(value) Then Exit Function
    If IsObject(value) Then Exit Function
    KcmCellText = CStr(value)
End Function

Public Function KcmRangeValues(ByVal sheet As Worksheet, ByVal firstRow As Long, _
    ByVal firstColumn As Long, ByVal lastRow As Long, ByVal lastColumn As Long) As Variant
    Dim raw As Variant
    Dim single1 As Variant
    If lastRow < firstRow Or lastColumn < firstColumn Then Err.Raise vbObjectError + 7108, _
        "KcmRangeValues", "El rango solicitado es invalido"
    raw = sheet.Range(sheet.Cells(firstRow, firstColumn), sheet.Cells(lastRow, lastColumn)).Value
    If IsArray(raw) Then
        KcmRangeValues = raw
        Exit Function
    End If
    ReDim single1(1 To 1, 1 To 1)
    single1(1, 1) = raw
    KcmRangeValues = single1
End Function

Public Function KcmRangeFormulas(ByVal sheet As Worksheet, ByVal firstRow As Long, _
    ByVal firstColumn As Long, ByVal lastRow As Long, ByVal lastColumn As Long) As Variant
    Dim raw As Variant
    Dim single1 As Variant
    If lastRow < firstRow Or lastColumn < firstColumn Then Err.Raise vbObjectError + 7109, _
        "KcmRangeFormulas", "El rango solicitado es invalido"
    raw = sheet.Range(sheet.Cells(firstRow, firstColumn), sheet.Cells(lastRow, lastColumn)).Formula
    If IsArray(raw) Then
        KcmRangeFormulas = raw
        Exit Function
    End If
    ReDim single1(1 To 1, 1 To 1)
    single1(1, 1) = raw
    KcmRangeFormulas = single1
End Function

Public Function KcmNormalizeEmployeeId(ByVal value As Variant) As String
    Dim text As String
    If IsError(value) Or IsEmpty(value) Or IsNull(value) Then Exit Function
    text = Trim$(Replace(KcmCellText(value), ChrW(160), " "))
    If Len(text) < 1 Or Len(text) > 5 Then Exit Function
    If Not text Like String$(Len(text), "#") Then Exit Function
    KcmNormalizeEmployeeId = Right$("00000" & text, 5)
End Function

Private Function KcmFoldMap() As KcmDiccionario
    If Not mFold Is Nothing Then
        Set KcmFoldMap = mFold
        Exit Function
    End If
    Set mFold = KcmNuevoDiccionario()
    KcmAddFold "A", "00C0,00C1,00C2,00C3,00C4,00C5,00E0,00E1,00E2,00E3,00E4,00E5,0100,0101,0102,0103,0104,0105"
    KcmAddFold "C", "00C7,00E7,0106,0107,0108,0109,010A,010B,010C,010D"
    KcmAddFold "D", "010E,010F"
    KcmAddFold "E", "00C8,00C9,00CA,00CB,00E8,00E9,00EA,00EB,0112,0113,0114,0115,0116,0117,0118,0119,011A,011B"
    KcmAddFold "G", "011C,011D,011E,011F,0120,0121,0122,0123"
    KcmAddFold "H", "0124,0125"
    KcmAddFold "I", "00CC,00CD,00CE,00CF,00EC,00ED,00EE,00EF,0128,0129,012A,012B,012C,012D,012E,012F,0130,0131"
    KcmAddFold "J", "0134,0135"
    KcmAddFold "K", "0136,0137"
    KcmAddFold "L", "0139,013A,013B,013C,013D,013E"
    KcmAddFold "N", "00D1,00F1,0143,0144,0145,0146,0147,0148,0149"
    KcmAddFold "O", "00D2,00D3,00D4,00D5,00D6,00F2,00F3,00F4,00F5,00F6,014C,014D,014E,014F,0150,0151"
    KcmAddFold "R", "0154,0155,0156,0157,0158,0159"
    KcmAddFold "S", "015A,015B,015C,015D,015E,015F,0160,0161,017F"
    KcmAddFold "SS", "00DF"
    KcmAddFold "T", "0162,0163,0164,0165"
    KcmAddFold "U", "00D9,00DA,00DB,00DC,00F9,00FA,00FB,00FC,0168,0169,016A,016B,016C,016D,016E,016F,0170,0171,0172,0173"
    KcmAddFold "W", "0174,0175"
    KcmAddFold "Y", "00DD,00FD,00FF,0176,0177,0178"
    KcmAddFold "Z", "0179,017A,017B,017C,017D,017E"
    Set KcmFoldMap = mFold
End Function

Private Sub KcmAddFold(ByVal target As String, ByVal codePoints As String)
    Dim items As Variant
    Dim index As Long
    items = Split(codePoints, ",")
    For index = LBound(items) To UBound(items)
        mFold.Add CStr(CLng("&H" & Trim$(CStr(items(index))))), target
    Next index
End Sub

Public Function KcmNormalizeLabel(ByVal value As Variant) As String
    Dim source As String
    Dim buffer As String
    Dim length As Long
    Dim used As Long
    Dim index As Long
    Dim code As Long
    Dim folded As String
    Dim map As KcmDiccionario
    source = KcmCellText(value)
    length = Len(source)
    If length = 0 Then Exit Function
    Set map = KcmFoldMap()
    buffer = Space$(length * 2)
    For index = 1 To length
        code = AscW(Mid$(source, index, 1))
        If code < 0 Then code = code + 65536
        folded = ""
        If code >= 97 And code <= 122 Then
            folded = Chr$(code - 32)
        ElseIf (code >= 65 And code <= 90) Or (code >= 48 And code <= 57) Then
            folded = Chr$(code)
        ElseIf map.Exists(CStr(code)) Then
            folded = CStr(map.Item(CStr(code)))
        End If
        If Len(folded) > 0 Then
            Mid$(buffer, used + 1, Len(folded)) = folded
            used = used + Len(folded)
        ElseIf used > 0 Then
            If Mid$(buffer, used, 1) <> " " Then
                Mid$(buffer, used + 1, 1) = " "
                used = used + 1
            End If
        End If
    Next index
    KcmNormalizeLabel = RTrim$(Left$(buffer, used))
End Function

Private Function KcmIsSharedSeparator(ByVal code As Long) As Boolean
    If code >= &HA0 And code <= &HA9 Then KcmIsSharedSeparator = True: Exit Function
    If code >= &HAB And code <= &HB1 Then KcmIsSharedSeparator = True: Exit Function
    If code >= &HB6 And code <= &HB8 Then KcmIsSharedSeparator = True: Exit Function
    If code = &HB4 Or code = &HBB Or code = &HBF Then KcmIsSharedSeparator = True: Exit Function
    If code = &HD7 Or code = &HF7 Then KcmIsSharedSeparator = True: Exit Function
    If code >= &H2010 And code <= &H2027 Then KcmIsSharedSeparator = True: Exit Function
    If code >= &H2030 And code <= &H205E Then KcmIsSharedSeparator = True: Exit Function
    If code >= &H20A0 And code <= &H20A7 Then KcmIsSharedSeparator = True: Exit Function
    If code >= &H20A9 And code <= &H20BF Then KcmIsSharedSeparator = True: Exit Function
End Function

Public Function KcmUnfoldableCharacter(ByVal value As String) As Long
    Dim map As KcmDiccionario
    Dim index As Long
    Dim code As Long
    If Len(value) = 0 Then Exit Function
    Set map = KcmFoldMap()
    For index = 1 To Len(value)
        code = AscW(Mid$(value, index, 1))
        If code < 0 Then code = code + 65536
        If code > 127 Then
            If Not map.Exists(CStr(code)) And Not KcmIsSharedSeparator(code) Then
                KcmUnfoldableCharacter = code
                Exit Function
            End If
        End If
    Next index
End Function

Public Function KcmIsoDate(ByVal value As Variant) As String
    Dim serie As Double

    If IsError(value) Or IsEmpty(value) Or IsNull(value) Then Exit Function
    If Len(Trim$(KcmCellText(value))) = 0 Then Exit Function
    If IsDate(value) Then
        KcmIsoDate = Format$(CDate(value), "yyyy-mm-dd")
        Exit Function
    End If
    If VarType(value) = vbString Then
        KcmIsoDate = KcmIsoDateFromText(KcmCellText(value))
        Exit Function
    End If
    Select Case VarType(value)
        Case vbInteger, vbLong, vbSingle, vbDouble, vbCurrency, vbDecimal
        Case Else
            Exit Function
    End Select
    serie = CDbl(value)
    If serie < 2 Or serie > 73051 Then Exit Function
    KcmIsoDate = Format$(CDate(serie), "yyyy-mm-dd")
End Function

Private Function KcmIsoDateFromText(ByVal texto As String) As String
    Dim partes() As String
    Dim limpio As String
    Dim anio As Long
    Dim mes As Long
    Dim dia As Long

    limpio = Trim$(texto)
    limpio = Replace$(Replace$(limpio, ".", "/"), "-", "/")
    If InStr(limpio, "/") = 0 Then Exit Function
    partes = Split(limpio, "/")
    If UBound(partes) <> 2 Then Exit Function
    If Not (IsNumeric(partes(0)) And IsNumeric(partes(1)) And IsNumeric(partes(2))) Then Exit Function

    If Len(Trim$(partes(0))) = 4 Then
        anio = CLng(partes(0))
        mes = CLng(partes(1))
        dia = CLng(partes(2))
    Else
        dia = CLng(partes(0))
        mes = CLng(partes(1))
        anio = CLng(partes(2))
    End If

    If anio < 1900 Or anio > 2100 Then Exit Function
    If mes < 1 Or mes > 12 Then Exit Function
    If dia < 1 Or dia > 31 Then Exit Function
    If Day(DateSerial(anio, mes, dia)) <> dia Then Exit Function
    KcmIsoDateFromText = Format$(DateSerial(anio, mes, dia), "yyyy-mm-dd")
End Function

Public Function KcmDateFromIso(ByVal value As String) As Date
    If Len(value) <> 10 Then Err.Raise vbObjectError + 7110, "KcmDateFromIso", "Fecha ISO invalida"
    If Not value Like "####-##-##" Then Err.Raise vbObjectError + 7110, "KcmDateFromIso", "Fecha ISO invalida"
    KcmDateFromIso = DateSerial(CInt(Left$(value, 4)), CInt(Mid$(value, 6, 2)), CInt(Right$(value, 2)))
End Function

Public Function KcmColumnNumber(ByVal letters As String) As Long
    Dim index As Long
    Dim value As Long
    Dim character As String
    letters = UCase$(Trim$(letters))
    If Len(letters) < 1 Or Len(letters) > 3 Then Err.Raise vbObjectError + 7103, _
        "KcmColumnNumber", "Columna invalida"
    For index = 1 To Len(letters)
        character = Mid$(letters, index, 1)
        If character < "A" Or character > "Z" Then
            Err.Raise vbObjectError + 7104, "KcmColumnNumber", "Columna invalida"
        End If
        value = value * 26 + Asc(character) - 64
    Next index
    If value > 16384 Then Err.Raise vbObjectError + 7104, "KcmColumnNumber", "Columna invalida"
    KcmColumnNumber = value
End Function

Public Function KcmColumnLetters(ByVal columnNumber As Long) As String
    Dim remaining As Long
    Dim output As String
    If columnNumber < 1 Or columnNumber > 16384 Then Err.Raise vbObjectError + 7111, _
        "KcmColumnLetters", "Columna invalida"
    remaining = columnNumber
    Do While remaining > 0
        remaining = remaining - 1
        output = Chr$(65 + (remaining Mod 26)) & output
        remaining = remaining \ 26
    Loop
    KcmColumnLetters = output
End Function

Public Function KcmJsonEscape(ByVal value As String) As String
    Dim index As Long
    Dim code As Long
    Dim character As String
    Dim buffer As String
    Dim used As Long
    Dim piece As String
    If Len(value) = 0 Then Exit Function
    buffer = Space$(Len(value) * 6)
    For index = 1 To Len(value)
        character = Mid$(value, index, 1)
        code = AscW(character)
        Select Case character
            Case """": piece = "\" & """"
            Case "\": piece = "\\"
            Case vbCr: piece = "\r"
            Case vbLf: piece = "\n"
            Case vbTab: piece = "\t"
            Case Else
                If code >= 0 And code < 32 Then
                    piece = "\u" & Right$("0000" & Hex$(code), 4)
                Else
                    piece = character
                End If
        End Select
        Mid$(buffer, used + 1, Len(piece)) = piece
        used = used + Len(piece)
    Next index
    KcmJsonEscape = Left$(buffer, used)
End Function

Public Function KcmJsonString(ByVal value As String) As String
    KcmJsonString = """" & KcmJsonEscape(value) & """"
End Function

Public Function KcmJsonPair(ByVal name As String, ByVal value As String) As String
    KcmJsonPair = KcmJsonString(name) & ":" & KcmJsonString(value)
End Function

Public Function KcmJsonRaw(ByVal name As String, ByVal rawValue As String) As String
    KcmJsonRaw = KcmJsonString(name) & ":" & rawValue
End Function

Public Function KcmJsonNumber(ByVal name As String, ByVal value As Double) As String
    KcmJsonNumber = KcmJsonString(name) & ":" & Format$(value, "0")
End Function

Public Function KcmJsonObject(ByVal members As Collection) As String
    KcmJsonObject = "{" & KcmJoinCollection(members) & "}"
End Function

Public Function KcmJsonArray(ByVal items As Collection) As String
    KcmJsonArray = "[" & KcmJoinCollection(items) & "]"
End Function

Public Function KcmJoinCollection(ByVal values As Collection, _
    Optional ByVal delimiter As String = ",") As String
    Dim items() As String
    Dim index As Long
    If values.Count = 0 Then Exit Function
    ReDim items(0 To values.Count - 1)
    For index = 1 To values.Count
        items(index - 1) = CStr(values(index))
    Next index
    KcmJoinCollection = Join(items, delimiter)
End Function

Public Sub KcmLedgerAppendRows(ByVal sheetName As String, ByVal rows As Collection)
    Dim sheet As Worksheet
    Dim block As Variant
    Dim values As Variant
    Dim rowIndex As Long
    Dim columnIndex As Long
    Dim columnCount As Long
    Dim nextRow As Long
    If rows.Count = 0 Then Exit Sub
    Set sheet = ThisWorkbook.Worksheets(sheetName)
    values = rows(1)
    columnCount = UBound(values) - LBound(values) + 1
    ReDim block(1 To rows.Count, 1 To columnCount)
    For rowIndex = 1 To rows.Count
        values = rows(rowIndex)
        If UBound(values) - LBound(values) + 1 <> columnCount Then Err.Raise vbObjectError + 7112, _
            "KcmLedgerAppendRows", "Las filas del ledger no comparten el mismo ancho"
        For columnIndex = 1 To columnCount
            block(rowIndex, columnIndex) = values(LBound(values) + columnIndex - 1)
        Next columnIndex
    Next rowIndex
    nextRow = KcmLedgerNextRow(sheet)
    sheet.Range(sheet.Cells(nextRow, 1), sheet.Cells(nextRow + rows.Count - 1, columnCount)).Value2 = block
    ThisWorkbook.Save
End Sub

Private Function KcmLedgerNextRow(ByVal sheet As Worksheet) As Long
    Dim nextRow As Long
    nextRow = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row + 1
    If nextRow < 2 Then nextRow = 2
    KcmLedgerNextRow = nextRow
End Function
