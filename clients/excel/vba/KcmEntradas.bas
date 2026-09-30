Attribute VB_Name = "KcmEntradas"
Option Explicit

Public Const KCM_ENTRADAS_SHEET As String = "KCM_ENTRADAS"

Private Const KCM_ENTRADAS_PREFIJO As String = "KCME_"
Private Const KCM_ENTRADAS_CASILLA As String = "KCME_C"
Private Const KCM_ENTRADAS_FILA_PRIMERA As Long = 8

Private Const COL_MARCA As Long = 2
Private Const COL_CODIGO As Long = 3
Private Const COL_CURSO As Long = 4
Private Const COL_FECHA As Long = 5
Private Const COL_PENDIENTES As Long = 6
Private Const COL_ESTADO As Long = 7
Private Const COL_SESION As Long = 8

Private Const ESTADO_PENDIENTE As String = "Pendiente"
Private Const ESTADO_ESCRITA As String = "Escrita"

Private Const ENTRADAS_ALTO_FILA As Double = 37.5
Private Const ENTRADAS_FICHAS_ARRIBA As Double = 120
Private Const ENTRADAS_ACCIONES_ARRIBA As Double = 178

Public Sub KcmEntradasAbrir()
    Dim hoja As Worksheet

    On Error GoTo AbrirError

    Set hoja = KcmEntradasHoja()
    KcmPaginaVentana hoja
    hoja.Range("A1").Select
    KcmEntradasActualizar
    Exit Sub

AbrirError:
    KcmAvisoFallo "Ver liberaciones", "No se pudo abrir la lista de liberaciones.", Err.Description
End Sub

Public Sub KcmEntradasActualizar()
    Dim hoja As Worksheet
    Dim respuesta As KcmDiccionario
    Dim filas As Collection
    Dim fila As KcmDiccionario
    Dim pendientes As KcmDiccionario
    Dim yaListadas As KcmDiccionario
    Dim renglon As Long
    Dim ultima As Long
    Dim sesion As String
    Dim nuevas As Long

    On Error GoTo ActualizarError

    Application.ScreenUpdating = False
    Set hoja = KcmEntradasHoja()
    KcmEntradasEncabezado hoja
    KcmEntradasResumen hoja, KcmEntradasContarPendientes(hoja), 0, "Consultando..."
    KcmEntradasBotones hoja

    KcmResetCaches
    Set respuesta = KcmHttpPost("RELEASE_SESSIONS_V1", "")
    Set filas = KcmParseTsv(KcmDecodeResponsePayload(respuesta), _
        Array("sessionId", "sessionCode", "trainingId", "completionDate", "pending"))

    Set pendientes = KcmNuevoDiccionario()
    For Each fila In filas
        pendientes.AgregarObjeto CStr(fila.Item("sessionId")), fila
    Next fila

    Set yaListadas = KcmNuevoDiccionario()
    ultima = KcmEntradasUltimaFila(hoja)
    For renglon = KCM_ENTRADAS_FILA_PRIMERA To ultima
        sesion = KcmEntradasTexto(hoja.Cells(renglon, COL_SESION).Value2)
        If Len(sesion) > 0 Then
            If Not yaListadas.Exists(sesion) Then yaListadas.Add sesion, renglon
            If pendientes.Exists(sesion) Then
                Set fila = pendientes.Objeto(sesion)
                KcmEntradasPintarRenglon hoja, renglon, fila, ESTADO_PENDIENTE
            Else
                hoja.Cells(renglon, COL_PENDIENTES).Value2 = 0
                hoja.Cells(renglon, COL_MARCA).Value2 = False
                KcmEntradasPintarEstado hoja, renglon, ESTADO_ESCRITA
            End If
        End If
    Next renglon

    For Each fila In filas
        sesion = CStr(fila.Item("sessionId"))
        If Not yaListadas.Exists(sesion) Then
            ultima = ultima + 1
            hoja.Cells(ultima, COL_SESION).Value2 = sesion
            KcmEntradasPintarRenglon hoja, ultima, fila, ESTADO_PENDIENTE
            yaListadas.Add sesion, ultima
            nuevas = nuevas + 1
        End If
    Next fila

    KcmEntradasResumen hoja, filas.Count, nuevas, Format$(Now, "dd/mm/yyyy hh:nn")
    KcmEntradasCasillas hoja
    Application.ScreenUpdating = True
    Exit Sub

ActualizarError:
    Dim causa As String
    causa = Err.Description
    Application.ScreenUpdating = True
    On Error Resume Next
    KcmEntradasResumen hoja, KcmEntradasContarPendientes(hoja), 0, "Sin respuesta"
    KcmEntradasCasillas hoja
    On Error GoTo 0
    KcmAvisoFallo "Ver liberaciones", "No se pudo actualizar la lista.", causa
End Sub

Public Sub KcmEntradasRecibir()
    Dim hoja As Worksheet
    Dim renglon As Long
    Dim ultima As Long
    Dim escogidas As String
    Dim cuantas As Long
    Dim sesion As String

    On Error GoTo RecibirError

    Set hoja = KcmEntradasHoja()
    ultima = KcmEntradasUltimaFila(hoja)

    For renglon = KCM_ENTRADAS_FILA_PRIMERA To ultima
        sesion = KcmEntradasTexto(hoja.Cells(renglon, COL_SESION).Value2)
        If Len(sesion) > 0 And KcmEntradasMarcada(hoja, renglon) Then
            escogidas = escogidas & sesion & "|"
            cuantas = cuantas + 1
        End If
    Next renglon

    If cuantas = 0 Then
        KcmAvisoAtencion "Escribir en la matriz", "Ninguna sesion seleccionada.", _
            "Las sesiones se marcan con la casilla de la primera columna."
        Exit Sub
    End If

    If Not KcmAvisoConfirmar("Escribir en la matriz", _
        "Se escribiran en la matriz las fechas de " & _
        KcmPlural(cuantas, "sesion", "sesiones") & ".") Then Exit Sub

    KcmApplyPendingReleases False, escogidas
    KcmEntradasActualizar
    Exit Sub

RecibirError:
    KcmAvisoFallo "Escribir en la matriz", _
        "Las sesiones seleccionadas no se escribieron.", Err.Description
End Sub

Public Sub KcmEntradasMarcarTodas()
    Dim hoja As Worksheet
    Dim renglon As Long
    Dim ultima As Long

    On Error GoTo MarcarError

    Set hoja = KcmEntradasHoja()
    ultima = KcmEntradasUltimaFila(hoja)
    For renglon = KCM_ENTRADAS_FILA_PRIMERA To ultima
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_PENDIENTE Then
            hoja.Cells(renglon, COL_MARCA).Value2 = True
        End If
    Next renglon
    KcmEntradasCasillas hoja
    Exit Sub

MarcarError:
    KcmAvisoFallo "Ver liberaciones", _
        "No se pudieron seleccionar las sesiones pendientes.", Err.Description
End Sub

Public Sub KcmEntradasLimpiar()
    Dim hoja As Worksheet
    Dim renglon As Long
    Dim ultima As Long

    On Error GoTo LimpiarError

    Set hoja = KcmEntradasHoja()
    ultima = KcmEntradasUltimaFila(hoja)
    For renglon = ultima To KCM_ENTRADAS_FILA_PRIMERA Step -1
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_ESCRITA Then
            hoja.Rows(renglon).Delete
        End If
    Next renglon
    KcmEntradasCasillas hoja
    Exit Sub

LimpiarError:
    KcmAvisoFallo "Ver liberaciones", _
        "No se pudieron retirar las sesiones escritas.", Err.Description
End Sub

Private Function KcmEntradasHoja() As Worksheet
    Dim candidata As Worksheet
    Dim encontrada As Worksheet

    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_ENTRADAS_SHEET, vbTextCompare) = 0 Then
            Set encontrada = candidata
            Exit For
        End If
    Next candidata

    If encontrada Is Nothing Then
        Set encontrada = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(1))
        encontrada.Name = KCM_ENTRADAS_SHEET
    End If

    encontrada.Visible = xlSheetVisible
    Set KcmEntradasHoja = encontrada
End Function

Private Sub KcmEntradasEncabezado(ByVal hoja As Worksheet)
    Dim fila As Long
    Dim izquierda As Double
    Dim anchoTotal As Double
    Dim subtitulo As String

    hoja.Range("A1:I7").UnMerge
    hoja.Range("A1:I7").Clear
    hoja.Range("A1:I6").Interior.Color = COLOR_LIENZO
    hoja.Cells.Font.Name = KcmPanelFuente()

    hoja.Columns("A").ColumnWidth = 3
    hoja.Columns("B").ColumnWidth = 8
    hoja.Columns("C").ColumnWidth = 22
    hoja.Columns("D").ColumnWidth = 70
    hoja.Columns("E").ColumnWidth = 13
    hoja.Columns("F").ColumnWidth = 13
    hoja.Columns("G").ColumnWidth = 14
    hoja.Columns("H").ColumnWidth = 30
    hoja.Columns("H").Hidden = True
    hoja.Columns("I").ColumnWidth = 3
    For fila = 1 To 6
        hoja.Rows(fila).RowHeight = ENTRADAS_ALTO_FILA
    Next fila
    hoja.Rows(7).RowHeight = 24

    KcmPaginaBorrar hoja, KCM_ENTRADAS_PREFIJO
    izquierda = hoja.Columns("B").Left
    anchoTotal = hoja.Columns("I").Left + hoja.Columns("I").Width
    subtitulo = KcmAcentos("Sesiones con fechas por escribir en la matriz.")
    KcmPaginaEncabezado hoja, KCM_ENTRADAS_PREFIJO, izquierda, anchoTotal, "Liberaciones", subtitulo

    hoja.Cells(7, COL_MARCA).Value2 = "MARCA"
    hoja.Cells(7, COL_CODIGO).Value2 = KcmAcentos("C{O}DIGO DE SESI{O}N")
    hoja.Cells(7, COL_CURSO).Value2 = "CURSO"
    hoja.Cells(7, COL_FECHA).Value2 = "FECHA"
    hoja.Cells(7, COL_PENDIENTES).Value2 = "POR ESCRIBIR"
    hoja.Cells(7, COL_ESTADO).Value2 = "ESTADO"
    hoja.Cells(7, COL_SESION).Value2 = ""
    KcmPaginaEncabezadoDeTabla hoja.Range(hoja.Cells(7, COL_MARCA), hoja.Cells(7, COL_SESION))
    hoja.Cells(7, COL_MARCA).HorizontalAlignment = xlCenter
    hoja.Cells(7, COL_PENDIENTES).HorizontalAlignment = xlCenter
    hoja.Cells(7, COL_ESTADO).HorizontalAlignment = xlCenter
End Sub

Private Sub KcmEntradasResumen(ByVal hoja As Worksheet, ByVal pendientes As Long, _
    ByVal nuevas As Long, ByVal consulta As String)
    Dim izq As Double
    Dim ancho As Double
    Dim color As Long

    KcmPaginaBorrar hoja, KCM_ENTRADAS_PREFIJO & "R"
    izq = hoja.Columns("B").Left
    ancho = (hoja.Columns("I").Left - izq - 24) / 3

    If pendientes > 0 Then
        color = COLOR_AVISO
    Else
        color = COLOR_OK
    End If
    KcmPaginaFicha hoja, KCM_ENTRADAS_PREFIJO & "R0", izq, ENTRADAS_FICHAS_ARRIBA, ancho, _
        "SESIONES POR ESCRIBIR", CStr(pendientes), color
    KcmPaginaFicha hoja, KCM_ENTRADAS_PREFIJO & "R1", izq + ancho + 12, ENTRADAS_FICHAS_ARRIBA, _
        ancho, "NUEVAS EN ESTA CONSULTA", CStr(nuevas), COLOR_MARCA
    KcmPaginaFicha hoja, KCM_ENTRADAS_PREFIJO & "R2", izq + 2 * (ancho + 12), ENTRADAS_FICHAS_ARRIBA, _
        ancho, "{U}LTIMA CONSULTA", consulta, COLOR_APAGADO
End Sub

Private Sub KcmEntradasBotones(ByVal hoja As Worksheet)
    Dim izq As Double
    Dim y As Double

    izq = hoja.Columns("B").Left
    y = ENTRADAS_ACCIONES_ARRIBA
    KcmPintarBoton hoja, KCM_ENTRADAS_PREFIJO & "B0", izq, y, 170, 34, _
        "Escribir marcadas", "KcmEntradasRecibir", COLOR_MARCA, 11
    KcmPintarBotonSecundario hoja, KCM_ENTRADAS_PREFIJO & "B1", izq + 180, y, 140, 34, _
        "Actualizar lista", "KcmEntradasActualizar"
    KcmPintarBotonSecundario hoja, KCM_ENTRADAS_PREFIJO & "B2", izq + 330, y, 130, 34, _
        "Marcar todas", "KcmEntradasMarcarTodas"
    KcmPintarBotonSecundario hoja, KCM_ENTRADAS_PREFIJO & "B3", izq + 470, y, 140, 34, _
        "Quitar escritas", "KcmEntradasLimpiar"
    KcmPintarBotonSecundario hoja, KCM_ENTRADAS_PREFIJO & "B4", hoja.Columns("I").Left - 140, y, _
        140, 34, "Volver al panel", "KcmAbrirPanel"
End Sub

Private Sub KcmEntradasPintarRenglon(ByVal hoja As Worksheet, ByVal renglon As Long, _
    ByVal fila As KcmDiccionario, ByVal estado As String)
    hoja.Cells(renglon, COL_CODIGO).Value2 = CStr(fila.Item("sessionCode"))
    hoja.Cells(renglon, COL_CURSO).Value2 = CStr(fila.Item("trainingId"))
    hoja.Cells(renglon, COL_FECHA).Value2 = CStr(fila.Item("completionDate"))
    hoja.Cells(renglon, COL_PENDIENTES).Value2 = CLng(Val(CStr(fila.Item("pending"))))
    KcmEntradasPintarEstado hoja, renglon, estado
End Sub

Private Sub KcmEntradasPintarEstado(ByVal hoja As Worksheet, ByVal renglon As Long, _
    ByVal estado As String)
    Dim color As Long
    Dim lado As Variant

    hoja.Rows(renglon).RowHeight = 24
    KcmPaginaRenglon hoja.Range(hoja.Cells(renglon, COL_MARCA), hoja.Cells(renglon, COL_SESION))
    hoja.Range(hoja.Cells(renglon, COL_MARCA), hoja.Cells(renglon, COL_SESION)).VerticalAlignment = xlCenter
    hoja.Cells(renglon, COL_CODIGO).Font.Bold = True
    hoja.Cells(renglon, COL_CODIGO).Font.Color = COLOR_TINTA
    hoja.Cells(renglon, COL_CODIGO).IndentLevel = 1
    hoja.Cells(renglon, COL_CURSO).IndentLevel = 1
    hoja.Cells(renglon, COL_FECHA).HorizontalAlignment = xlCenter
    hoja.Cells(renglon, COL_PENDIENTES).HorizontalAlignment = xlCenter
    hoja.Cells(renglon, COL_SESION).Font.Color = COLOR_APAGADO
    hoja.Cells(renglon, COL_SESION).Font.Size = 8

    With hoja.Cells(renglon, COL_MARCA)
        .HorizontalAlignment = xlCenter
        .Font.Bold = True
        .Font.Color = COLOR_MARCA
        .NumberFormat = ";;;"
    End With
    For Each lado In Array(xlEdgeLeft, xlEdgeTop, xlEdgeRight, xlEdgeBottom)
        With hoja.Cells(renglon, COL_MARCA).Borders(CLng(lado))
            .LineStyle = xlContinuous
            .Weight = xlThin
            .Color = COLOR_MARCA_SUAVE
        End With
    Next lado

    If estado = ESTADO_ESCRITA Then
        color = COLOR_OK
    Else
        color = COLOR_AVISO
    End If
    KcmPaginaEtiqueta hoja.Cells(renglon, COL_ESTADO), estado, color
End Sub

Private Function KcmEntradasUltimaFila(ByVal hoja As Worksheet) As Long
    Dim ultima As Long

    ultima = hoja.Cells(hoja.Rows.Count, COL_SESION).End(xlUp).Row
    If ultima < KCM_ENTRADAS_FILA_PRIMERA - 1 Then ultima = KCM_ENTRADAS_FILA_PRIMERA - 1
    KcmEntradasUltimaFila = ultima
End Function

Private Function KcmEntradasContarPendientes(ByVal hoja As Worksheet) As Long
    Dim renglon As Long

    For renglon = KCM_ENTRADAS_FILA_PRIMERA To KcmEntradasUltimaFila(hoja)
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_PENDIENTE Then
            KcmEntradasContarPendientes = KcmEntradasContarPendientes + 1
        End If
    Next renglon
End Function

Private Function KcmEntradasMarcada(ByVal hoja As Worksheet, ByVal renglon As Long) As Boolean
    Dim valor As Variant

    valor = hoja.Cells(renglon, COL_MARCA).Value2
    If VarType(valor) = vbBoolean Then
        KcmEntradasMarcada = CBool(valor)
    Else
        KcmEntradasMarcada = Len(KcmEntradasTexto(valor)) > 0
    End If
End Function

Private Sub KcmEntradasCasillas(ByVal hoja As Worksheet)
    Dim renglon As Long
    Dim celda As Range
    Dim casilla As Shape
    Dim lado As Double

    KcmPaginaBorrar hoja, KCM_ENTRADAS_CASILLA
    lado = 16
    For renglon = KCM_ENTRADAS_FILA_PRIMERA To KcmEntradasUltimaFila(hoja)
        Set celda = hoja.Cells(renglon, COL_MARCA)
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_PENDIENTE Then
            If VarType(celda.Value2) <> vbBoolean Then celda.Value2 = KcmEntradasMarcada(hoja, renglon)
            Set casilla = hoja.Shapes.AddShape(msoShapeRoundedRectangle, _
                celda.Left + (celda.Width - lado) / 2, celda.Top + (celda.Height - lado) / 2, lado, lado)
            casilla.Name = KCM_ENTRADAS_CASILLA & CStr(renglon)
            casilla.OnAction = "KcmEntradasAlternar"
            casilla.Placement = xlMove
            KcmEntradasPintarCasilla casilla, CBool(celda.Value2)
        Else
            celda.Value2 = False
        End If
    Next renglon
End Sub

Private Sub KcmEntradasPintarCasilla(ByVal casilla As Shape, ByVal marcada As Boolean)
    casilla.Line.ForeColor.RGB = COLOR_MARCA
    casilla.Line.Weight = 1.25
    With casilla.TextFrame2
        .MarginLeft = 0
        .MarginRight = 0
        .MarginTop = 0
        .MarginBottom = 0
        .VerticalAnchor = msoAnchorMiddle
        .HorizontalAnchor = msoAnchorCenter
        .WordWrap = msoFalse
    End With
    With casilla.TextFrame2.TextRange
        .Font.Size = 10
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_BLANCO
        If marcada Then
            .Text = ChrW(10003)
        Else
            .Text = ""
        End If
    End With
    If marcada Then
        casilla.Fill.ForeColor.RGB = COLOR_MARCA
    Else
        casilla.Fill.ForeColor.RGB = COLOR_BLANCO
    End If
End Sub

Public Sub KcmEntradasAlternar()
    Dim hoja As Worksheet
    Dim nombre As String
    Dim renglon As Long
    Dim marcada As Boolean

    On Error GoTo AlternarError

    nombre = CStr(Application.Caller)
    If Left$(nombre, Len(KCM_ENTRADAS_CASILLA)) <> KCM_ENTRADAS_CASILLA Then Exit Sub
    renglon = CLng(Val(Mid$(nombre, Len(KCM_ENTRADAS_CASILLA) + 1)))
    If renglon < KCM_ENTRADAS_FILA_PRIMERA Then Exit Sub

    Set hoja = KcmEntradasHoja()
    marcada = Not KcmEntradasMarcada(hoja, renglon)
    hoja.Cells(renglon, COL_MARCA).Value2 = marcada
    KcmEntradasPintarCasilla hoja.Shapes(nombre), marcada
    Exit Sub

AlternarError:
    KcmAvisoFallo "Ver liberaciones", "No se pudo cambiar la marca.", Err.Description
End Sub

Private Function KcmEntradasTexto(ByVal valor As Variant) As String
    If IsError(valor) Then Exit Function
    If IsEmpty(valor) Then Exit Function
    KcmEntradasTexto = Trim$(CStr(valor))
End Function
