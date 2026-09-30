Attribute VB_Name = "KcmMatrixPanel"
Option Explicit

Public Const KCM_PANEL_SHEET As String = "KCM_ESTADO"

Public Const KCM_PANEL_OK As String = "CORRECTO"
Public Const KCM_PANEL_AVISO As String = "AVISO"
Public Const KCM_PANEL_FALLO As String = "FALLO"

Private Const ESTADO_PREFIJO As String = "KCMS_"
Private Const ESTADO_FILA_TITULOS As Long = 6
Private Const ESTADO_ALTO_FILA As Double = 56.4
Private Const ESTADO_RESULTADO_ARRIBA As Double = 122
Private Const ESTADO_CUENTAS_ARRIBA As Double = 180
Private Const ESTADO_ACCIONES_ARRIBA As Double = 238
Private Const ESTADO_HUECO As Double = 12

Private Const ESTADO_COL_DATOS As Long = 8
Private Const ESTADO_EN_CURSO As String = "CURSO"
Private Const ESTADO_TERMINO_BIEN As String = "BIEN"
Private Const ESTADO_TERMINO_MAL As String = "MAL"

Private Const MODO_VERIFICAR As Long = 0
Private Const MODO_BARRIDO As Long = 1
Private Const MODO_TRANSMITIR As Long = 2

Public Sub KcmVerificarMatriz()
    KcmPanelCorrer MODO_VERIFICAR
End Sub

Public Sub KcmBarrerMatriz()
    KcmPanelCorrer MODO_BARRIDO
End Sub

Public Sub KcmTransmitirMatriz()
    KcmPanelCorrer MODO_TRANSMITIR
End Sub

Private Sub KcmPanelCorrer(ByVal modo As Long)
    Dim master As Workbook
    Dim rutaMatriz As String
    Dim problema As String
    Dim huella As String
    Dim snapshot As String
    Dim respuesta As KcmDiccionario
    Dim faltantes As String
    Dim endpoint As String
    Dim token As String
    Dim abierto As Boolean
    Dim trabajadores As Double
    Dim cursos As Double
    Dim fechas As Double
    Dim retiradas As Double
    Dim avisoTitulo As String
    Dim avisoMensaje As String
    Dim avisoDetalle As String

    On Error GoTo PanelError
    abierto = False

    KcmResetCaches
    If modo = MODO_TRANSMITIR Then
        KcmPanelAbrir "Actualizacion completa de la matriz"
    ElseIf modo = MODO_BARRIDO Then
        KcmPanelAbrir "Barrido de la matriz, para revision"
    Else
        KcmPanelAbrir "Verificacion de la matriz, sin enviar datos"
    End If

    endpoint = KcmConfigValue("ENDPOINT", False)
    rutaMatriz = KcmConfigValue("MATRIX_PATH", False)
    faltantes = ""
    If Len(endpoint) = 0 Then faltantes = faltantes & " ENDPOINT"
    If Len(KcmConfigValue("CLIENT_ID", False)) = 0 Then faltantes = faltantes & " CLIENT_ID"
    If Len(rutaMatriz) = 0 Then faltantes = faltantes & " MATRIX_PATH"
    If Len(KcmConfigValue("MATRIX_SHEET", False)) = 0 Then faltantes = faltantes & " MATRIX_SHEET"
    If Len(KcmConfigValue("EMPLOYEE_COLUMN", False)) = 0 Then faltantes = faltantes & " EMPLOYEE_COLUMN"
    If Len(KcmConfigValue("FIRST_COURSE_COLUMN", False)) = 0 Then faltantes = faltantes & " FIRST_COURSE_COLUMN"
    If Len(KcmConfigValue("LAST_COURSE_COLUMN", False)) = 0 Then faltantes = faltantes & " LAST_COURSE_COLUMN"

    If Len(faltantes) > 0 Then
        KcmPanelPaso "1. Configuracion", KCM_PANEL_FALLO, "Faltan datos:" & faltantes
        KcmPanelCerrar "Faltan datos en " & KCM_CONFIG_SHEET & ".", False
        GoTo PanelFin
    End If
    KcmPanelPaso "1. Configuracion", KCM_PANEL_OK, _
        "Hoja " & KcmConfigValue("MATRIX_SHEET") & ", trabajador en " & _
        KcmConfigValue("EMPLOYEE_COLUMN") & ", cursos de " & _
        KcmConfigValue("FIRST_COURSE_COLUMN") & " a " & KcmConfigValue("LAST_COURSE_COLUMN") & _
        ". Endpoint " & endpoint

    token = KcmCredencialLeer()
    If Len(token) = 0 Then
        KcmPanelPaso "2. Credencial", KCM_PANEL_FALLO, _
            "Sin credencial. Se registra con Conectar este equipo"
        KcmPanelCerrar "Falta la credencial.", False
        GoTo PanelFin
    End If
    KcmPanelPaso "2. Credencial", KCM_PANEL_OK, "Credencial registrada"

    problema = KcmLocalFileProblem(rutaMatriz)
    If Len(problema) > 0 Then
        KcmPanelPaso "3. Archivo", KCM_PANEL_FALLO, problema
        KcmPanelCerrar "No se encontro el archivo de la matriz.", False
        GoTo PanelFin
    End If

    Application.StatusBar = "KCM: abriendo la matriz..."
    Set master = KcmOpenMaster(True)
    abierto = True
    If Not master.Saved Then
        KcmPanelPaso "3. Archivo", KCM_PANEL_FALLO, "La matriz tiene cambios sin guardar"
        KcmPanelCerrar "La matriz debe estar guardada.", False
        GoTo PanelFin
    End If

    Application.StatusBar = "KCM: verificando la matriz..."
    huella = KcmFileSha256(master.FullName)
    KcmPanelPaso "3. Archivo", KCM_PANEL_OK, _
        master.Name & ", " & Format$(FileLen(master.FullName) / 1048576, "0.0") & " MB"

    Application.StatusBar = "KCM: leyendo la matriz..."
    snapshot = KcmBuildHcSnapshot(master, huella)
    trabajadores = KcmPanelNumeroJson(snapshot, "employeeCount")
    cursos = KcmPanelNumeroJson(snapshot, "courseCount")
    fechas = KcmPanelNumeroJson(snapshot, "completionCount")
    KcmPanelPaso "4. Lectura", KCM_PANEL_OK, _
            Format$(trabajadores, "#,##0") & " trabajadores, " & Format$(cursos, "#,##0") & _
            " cursos y " & Format$(fechas, "#,##0") & " fechas"

    If trabajadores = 0 Or fechas = 0 Then
        KcmPanelPaso "4. Lectura", KCM_PANEL_AVISO, _
            "La matriz se leyo casi vacia. Causas comunes: un filtro en la hoja o un rango de cursos recortado"
    End If

    Application.StatusBar = "KCM: conectando con la plataforma..."
    Set respuesta = KcmHttpPost("STATUS_V1", "")
    KcmPanelPaso "5. Conexion", KCM_PANEL_OK, "Conexion correcta con " & KcmConfigValue("CLIENT_ID")

    If modo = MODO_VERIFICAR Then
        KcmPanelCerrar "Verificacion correcta. No se envio nada.", True
        GoTo PanelFin
    End If

    If modo = MODO_BARRIDO Then
        Application.StatusBar = "KCM: enviando la matriz..."
        Set respuesta = KcmHttpPost("MATRIX_SCAN_V1", snapshot, "vba-scan-" & Left$(huella, 24))
        KcmPanelPaso "6. Barrido", KCM_PANEL_OK, _
            "Revision " & KcmPanelCampo(respuesta, "scanId") & ". Trabajadores nuevos " & _
            KcmPanelCampo(respuesta, "newWorkers") & ", en la base y no en la matriz " & _
            KcmPanelCampo(respuesta, "missingWorkers") & ", cambios de puesto o area " & _
            KcmPanelCampo(respuesta, "attributionChanges") & ", columnas nuevas " & _
            KcmPanelCampo(respuesta, "newColumns") & ", fechas nuevas " & _
            KcmPanelCampo(respuesta, "newDates") & ", corregidas " & _
            KcmPanelCampo(respuesta, "correctedDates") & ", retiradas " & _
            KcmPanelCampo(respuesta, "retiredDates")

        If LCase$(KcmPanelCampo(respuesta, "blocked")) = "true" Then
            KcmPanelPaso "6. Barrido", KCM_PANEL_AVISO, _
                "Contradice " & KcmPanelCampo(respuesta, "conflicts") & _
                " fechas liberadas en sesion. No se aplica hasta corregirlas en la matriz"
        End If

        KcmPanelCerrar "Barrido enviado (" & KcmDescribirEnvio(respuesta) & _
            "). La revision espera aprobacion en la plataforma.", True
        avisoTitulo = "Barrer para revision"
        avisoMensaje = "Barrido enviado: " & KcmDescribirEnvio(respuesta) & "."
        avisoDetalle = "La revision espera aprobacion en la plataforma."
        GoTo PanelFin
    End If

    Application.StatusBar = "KCM: enviando la matriz..."
    Set respuesta = KcmHttpPost("MATRIX_IMPORT_V1", snapshot, "vba-hc-" & Left$(huella, 24))
    retiradas = Val(KcmPanelCampo(respuesta, "retired"))
    KcmPanelPaso "6. Transmision", KCM_PANEL_OK, _
        "Importacion " & KcmPanelCampo(respuesta, "importId") & ". Altas " & _
        KcmPanelCampo(respuesta, "inserted") & ", fechas corregidas " & _
        KcmPanelCampo(respuesta, "corrected") & ", retiradas " & _
        KcmPanelCampo(respuesta, "retired") & ", reactivadas " & _
        KcmPanelCampo(respuesta, "reactivated") & ", liberaciones aun no escritas en el maestro " & _
        KcmPanelCampo(respuesta, "pendingExcel")

    If retiradas > 0 Then
        KcmPanelPaso "6. Envio", KCM_PANEL_AVISO, _
                "Se retiraron " & Format$(retiradas, "#,##0") & " fechas que la matriz ya no trae"
    End If

    KcmPanelCerrar "Matriz enviada y aplicada (" & KcmDescribirEnvio(respuesta) & ").", True
    avisoTitulo = "Actualizacion completa"
    avisoMensaje = "Matriz enviada y aplicada: " & KcmDescribirEnvio(respuesta) & "."
    If retiradas > 0 Then avisoDetalle = "Se retiraron " & Format$(retiradas, "#,##0") & _
        " fechas que la matriz ya no trae."

PanelFin:
    If abierto Then KcmReleaseMaster
    Application.StatusBar = False
    If Len(avisoMensaje) > 0 Then KcmAvisoHecho avisoTitulo, avisoMensaje, avisoDetalle
    Exit Sub

PanelError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    KcmPanelPaso "Interrumpido", KCM_PANEL_FALLO, descripcion
    KcmPanelCerrar "El proceso se detuvo. La etapa anterior indica donde.", False
    If abierto Then KcmReleaseMaster
    Application.StatusBar = False
    On Error GoTo 0
    KcmAvisoFallo "Actualizacion completa", "La actualizacion completa no termino.", _
        descripcion & vbCrLf & vbCrLf & "Detalle por etapa en la hoja " & KCM_PANEL_SHEET & "."
End Sub

Public Sub KcmAbrirEstado()
    Dim sheet As Worksheet

    On Error GoTo EstadoError
    Application.ScreenUpdating = False
    Set sheet = KcmEstadoHoja()

    If Not KcmEstadoEsDeEstaVersion(sheet) Then KcmEstadoVaciar sheet

    KcmEstadoDibujar sheet
    Application.ScreenUpdating = True
    sheet.Range("A1").Select
    Exit Sub

EstadoError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Estado", "No se pudo abrir la hoja de estado.", Err.Description
End Sub

Public Sub KcmEstadoVaciarTodo()
    Dim sheet As Worksheet
    Set sheet = KcmEstadoHoja()
    KcmEstadoVaciar sheet
    KcmEstadoDibujar sheet
End Sub

Public Sub KcmEstadoLimpiar()
    Dim sheet As Worksheet

    On Error GoTo LimpiarError
    If Not KcmAvisoConfirmar("Limpiar registro", _
        "Se borrara el detalle de la ultima ejecucion.", _
        "Lo que se envio a la plataforma no cambia: solo se limpia esta hoja.") Then Exit Sub

    Application.ScreenUpdating = False
    Set sheet = KcmEstadoHoja()
    KcmEstadoVaciar sheet
    KcmEstadoDibujar sheet
    Application.ScreenUpdating = True
    Exit Sub

LimpiarError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Limpiar registro", "No se pudo limpiar la hoja de estado.", Err.Description
End Sub

Public Sub KcmPanelAbrir(ByVal titulo As String)
    Dim sheet As Worksheet

    Set sheet = KcmEstadoHoja()
    KcmEstadoVaciar sheet
    KcmEstadoGuardar sheet, titulo, _
        "Iniciado el " & Format$(Now, "dd/mm/yyyy") & " a las " & Format$(Now, "hh:nn"), _
        "En curso", ESTADO_EN_CURSO
    KcmEstadoDibujar sheet
End Sub

Public Sub KcmPanelPaso(ByVal etapa As String, ByVal estado As String, ByVal detalle As String)
    Dim sheet As Worksheet
    Dim fila As Long

    Set sheet = ThisWorkbook.Worksheets(KCM_PANEL_SHEET)
    fila = sheet.Cells(sheet.Rows.Count, 2).End(xlUp).Row + 1
    If fila <= ESTADO_FILA_TITULOS Then fila = ESTADO_FILA_TITULOS + 1

    sheet.Cells(fila, 2).Value2 = etapa
    sheet.Cells(fila, 4).Value2 = detalle
    sheet.Cells(fila, 5).Value2 = Format$(Now, "hh:nn:ss")
    KcmPaginaRenglon sheet.Range(sheet.Cells(fila, 2), sheet.Cells(fila, 5))
    sheet.Range(sheet.Cells(fila, 2), sheet.Cells(fila, 5)).VerticalAlignment = xlCenter
    sheet.Cells(fila, 2).Font.Bold = True
    sheet.Cells(fila, 2).Font.Color = COLOR_TINTA
    sheet.Cells(fila, 2).IndentLevel = 1
    sheet.Cells(fila, 4).WrapText = True
    sheet.Cells(fila, 4).IndentLevel = 1
    sheet.Cells(fila, 5).Font.Color = COLOR_APAGADO
    sheet.Cells(fila, 5).HorizontalAlignment = xlCenter
    KcmPaginaEtiqueta sheet.Cells(fila, 3), estado, KcmPanelColor(estado)
    sheet.Rows(fila).AutoFit
    If sheet.Rows(fila).RowHeight < 26 Then sheet.Rows(fila).RowHeight = 26

    KcmEstadoFichas sheet
    Application.StatusBar = "KCM: " & etapa & " " & estado
    DoEvents
End Sub

Public Sub KcmPanelCerrar(ByVal resumen As String, ByVal correcto As Boolean)
    Dim sheet As Worksheet

    Set sheet = ThisWorkbook.Worksheets(KCM_PANEL_SHEET)
    sheet.Cells(3, ESTADO_COL_DATOS).Value2 = resumen
    If correcto Then
        sheet.Cells(4, ESTADO_COL_DATOS).Value2 = ESTADO_TERMINO_BIEN
    Else
        sheet.Cells(4, ESTADO_COL_DATOS).Value2 = ESTADO_TERMINO_MAL
    End If
    KcmEstadoFichas sheet
    DoEvents
End Sub

Private Function KcmEstadoHoja() As Worksheet
    Dim candidata As Worksheet
    Dim encontrada As Worksheet

    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_PANEL_SHEET, vbTextCompare) = 0 Then
            Set encontrada = candidata
            Exit For
        End If
    Next candidata

    If encontrada Is Nothing Then
        Set encontrada = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        encontrada.Name = KCM_PANEL_SHEET
    End If

    encontrada.Visible = xlSheetVisible
    Set KcmEstadoHoja = encontrada
End Function

Private Sub KcmEstadoVaciar(ByVal sheet As Worksheet)
    KcmPaginaBorrar sheet, ESTADO_PREFIJO
    sheet.Cells.UnMerge
    sheet.Cells.Clear
    sheet.Cells.Interior.Color = COLOR_LIENZO
    KcmEstadoGuardar sheet, "Estado de las ejecuciones", _
        KcmAcentos("Aqu{i} queda, etapa por etapa, la {u}ltima verificaci{o}n, barrido o autoprueba."), _
        KcmAcentos("Sin ejecuciones todav{i}a"), ""
End Sub

Private Sub KcmEstadoGuardar(ByVal sheet As Worksheet, ByVal titulo As String, _
    ByVal subtitulo As String, ByVal resultado As String, ByVal estado As String)
    sheet.Cells(1, ESTADO_COL_DATOS).Value2 = titulo
    sheet.Cells(2, ESTADO_COL_DATOS).Value2 = subtitulo
    sheet.Cells(3, ESTADO_COL_DATOS).Value2 = resultado
    sheet.Cells(4, ESTADO_COL_DATOS).Value2 = estado
End Sub

Private Function KcmEstadoLeer(ByVal sheet As Worksheet, ByVal fila As Long) As String
    KcmEstadoLeer = Trim$(KcmCellText(sheet.Cells(fila, ESTADO_COL_DATOS).Value2))
End Function

Private Function KcmEstadoEsDeEstaVersion(ByVal sheet As Worksheet) As Boolean
    If Len(KcmEstadoLeer(sheet, 1)) = 0 Then Exit Function
    If sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row > 1 Then Exit Function
    If Len(Trim$(KcmCellText(sheet.Cells(1, 1).Value2))) > 0 Then Exit Function
    If Trim$(KcmCellText(sheet.Cells(ESTADO_FILA_TITULOS, 2).Value2)) <> "ETAPA" Then Exit Function
    KcmEstadoEsDeEstaVersion = True
End Function

Private Function KcmEstadoUltimaFila(ByVal sheet As Worksheet) As Long
    KcmEstadoUltimaFila = sheet.Cells(sheet.Rows.Count, 2).End(xlUp).Row
End Function

Private Sub KcmEstadoDibujar(ByVal sheet As Worksheet)
    Dim fila As Long
    Dim anchoTotal As Double

    sheet.Cells.Font.Name = KcmPanelFuente()
    sheet.Columns("A").ColumnWidth = 3
    sheet.Columns("B").ColumnWidth = 24
    sheet.Columns("C").ColumnWidth = 13
    sheet.Columns("D").ColumnWidth = 110
    sheet.Columns("E").ColumnWidth = 10
    sheet.Columns("F").ColumnWidth = 3
    sheet.Columns(ESTADO_COL_DATOS).Hidden = True
    For fila = 1 To ESTADO_FILA_TITULOS - 1
        sheet.Rows(fila).RowHeight = ESTADO_ALTO_FILA
    Next fila
    sheet.Rows(ESTADO_FILA_TITULOS).RowHeight = 24
    sheet.Range(sheet.Cells(1, 1), sheet.Cells(ESTADO_FILA_TITULOS - 1, 6)).Interior.Color = COLOR_LIENZO

    sheet.Cells(ESTADO_FILA_TITULOS, 2).Value2 = "ETAPA"
    sheet.Cells(ESTADO_FILA_TITULOS, 3).Value2 = "ESTADO"
    sheet.Cells(ESTADO_FILA_TITULOS, 4).Value2 = "DETALLE"
    sheet.Cells(ESTADO_FILA_TITULOS, 5).Value2 = "HORA"
    KcmPaginaEncabezadoDeTabla sheet.Range(sheet.Cells(ESTADO_FILA_TITULOS, 2), _
        sheet.Cells(ESTADO_FILA_TITULOS, 5))
    sheet.Cells(ESTADO_FILA_TITULOS, 3).HorizontalAlignment = xlCenter
    sheet.Cells(ESTADO_FILA_TITULOS, 5).HorizontalAlignment = xlCenter

    KcmPaginaBorrar sheet, ESTADO_PREFIJO
    anchoTotal = sheet.Columns("F").Left + sheet.Columns("F").Width
    KcmPaginaEncabezado sheet, ESTADO_PREFIJO, sheet.Columns("B").Left, anchoTotal, _
        KcmEstadoLeer(sheet, 1), KcmEstadoLeer(sheet, 2)

    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "N0", anchoTotal - 16 - 130, 13, 130, 32, _
        "Volver al panel", "KcmAbrirPanel"
    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "N1", anchoTotal - 16 - 270, 13, 130, 32, _
        "Ver liberaciones", "KcmEntradasAbrir"

    KcmEstadoFichas sheet
    KcmEstadoAcciones sheet
    KcmPaginaVentana sheet
End Sub

Private Sub KcmEstadoFichas(ByVal sheet As Worksheet)
    Dim izquierda As Double
    Dim anchoUtil As Double
    Dim ancho As Double
    Dim fila As Long
    Dim correctas As Long
    Dim avisos As Long
    Dim fallos As Long
    Dim estado As String
    Dim color As Long

    For fila = ESTADO_FILA_TITULOS + 1 To KcmEstadoUltimaFila(sheet)
        estado = Trim$(KcmCellText(sheet.Cells(fila, 3).Value2))
        If estado = KCM_PANEL_OK Then
            correctas = correctas + 1
        ElseIf estado = KCM_PANEL_AVISO Then
            avisos = avisos + 1
        ElseIf estado = KCM_PANEL_FALLO Then
            fallos = fallos + 1
        End If
    Next fila

    estado = KcmEstadoLeer(sheet, 4)
    If estado = ESTADO_TERMINO_BIEN Then
        color = COLOR_OK
    ElseIf estado = ESTADO_TERMINO_MAL Then
        color = COLOR_ALERTA
    ElseIf estado = ESTADO_EN_CURSO Then
        color = COLOR_MARCA
    Else
        color = COLOR_APAGADO
    End If

    KcmPaginaBorrar sheet, ESTADO_PREFIJO & "F"
    izquierda = sheet.Columns("B").Left
    anchoUtil = sheet.Columns("F").Left - izquierda
    ancho = (anchoUtil - 2 * ESTADO_HUECO) / 3

    KcmPaginaFicha sheet, ESTADO_PREFIJO & "F0", izquierda, ESTADO_RESULTADO_ARRIBA, anchoUtil, _
        "RESULTADO", KcmEstadoLeer(sheet, 3), color
    KcmPaginaFicha sheet, ESTADO_PREFIJO & "F1", izquierda, ESTADO_CUENTAS_ARRIBA, ancho, _
        "CORRECTAS", CStr(correctas), KcmEstadoColorCuenta(correctas, COLOR_OK)
    KcmPaginaFicha sheet, ESTADO_PREFIJO & "F2", izquierda + ancho + ESTADO_HUECO, _
        ESTADO_CUENTAS_ARRIBA, ancho, _
        "AVISOS", CStr(avisos), KcmEstadoColorCuenta(avisos, COLOR_AVISO)
    KcmPaginaFicha sheet, ESTADO_PREFIJO & "F3", izquierda + 2 * (ancho + ESTADO_HUECO), _
        ESTADO_CUENTAS_ARRIBA, ancho, _
        "FALLOS", CStr(fallos), KcmEstadoColorCuenta(fallos, COLOR_ALERTA)
End Sub

Private Function KcmEstadoColorCuenta(ByVal cuenta As Long, ByVal color As Long) As Long
    If cuenta > 0 Then
        KcmEstadoColorCuenta = color
    Else
        KcmEstadoColorCuenta = COLOR_APAGADO
    End If
End Function

Private Sub KcmEstadoAcciones(ByVal sheet As Worksheet)
    Dim izquierda As Double
    Dim anchoUtil As Double
    Dim escala As Double
    Dim x As Double

    izquierda = sheet.Columns("B").Left
    anchoUtil = sheet.Columns("F").Left - izquierda
    escala = (anchoUtil - 30) / 630
    If escala > 1 Then escala = 1

    x = izquierda
    KcmPintarBoton sheet, ESTADO_PREFIJO & "A0", x, ESTADO_ACCIONES_ARRIBA, 150 * escala, 32, _
        "Verificar matriz", "KcmVerificarMatriz", COLOR_MARCA, 10
    x = x + 150 * escala + 10
    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "A1", x, ESTADO_ACCIONES_ARRIBA, _
        170 * escala, 32, KcmAcentos("Barrer para revisi{o}n"), "KcmBarrerMatriz"
    x = x + 170 * escala + 10
    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "A2", x, ESTADO_ACCIONES_ARRIBA, _
        170 * escala, 32, "Autoprueba del equipo", "KcmAutoprueba"
    x = x + 170 * escala + 10
    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "A3", x, ESTADO_ACCIONES_ARRIBA, _
        140 * escala, 32, "Limpiar registro", "KcmEstadoLimpiar"
End Sub

Private Function KcmPanelColor(ByVal estado As String) As Long
    If estado = KCM_PANEL_OK Then
        KcmPanelColor = COLOR_OK
    ElseIf estado = KCM_PANEL_AVISO Then
        KcmPanelColor = COLOR_AVISO
    Else
        KcmPanelColor = COLOR_ALERTA
    End If
End Function

Public Function KcmPanelCampo(ByVal respuesta As KcmDiccionario, ByVal clave As String) As String
    If respuesta.Exists(clave) Then
        KcmPanelCampo = CStr(respuesta.Item(clave))
    Else
        KcmPanelCampo = "0"
    End If
End Function

Private Function KcmPanelNumeroJson(ByVal json As String, ByVal nombre As String) As Double
    Dim marca As String
    Dim inicio As Long
    Dim fin As Long
    Dim caracter As String

    marca = """" & nombre & """:"
    inicio = InStr(1, json, marca, vbBinaryCompare)
    If inicio = 0 Then Exit Function

    inicio = inicio + Len(marca)
    fin = inicio
    Do While fin <= Len(json)
        caracter = Mid$(json, fin, 1)
        If InStr(1, "0123456789", caracter, vbBinaryCompare) = 0 Then Exit Do
        fin = fin + 1
    Loop
    If fin > inicio Then KcmPanelNumeroJson = Val(Mid$(json, inicio, fin - inicio))
End Function
