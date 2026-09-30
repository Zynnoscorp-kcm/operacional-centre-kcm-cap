Attribute VB_Name = "KcmPanel"
Option Explicit

Public Const KCM_PANEL_CONFIG_SHEET As String = "KCM_PANEL"

Public Const COLOR_MARCA As Long = 10439714        ' #224C9F
Public Const COLOR_MARCA_OSCURA As Long = 7288087  ' #17356F
Public Const COLOR_TINTA As Long = 4005391         ' #0F1E3D
Public Const COLOR_APAGADO As Long = 7887434       ' #4A5A78
Public Const COLOR_LIENZO As Long = 16249326       ' #EEF1F7
Public Const COLOR_BLANCO As Long = 16777215       ' #FFFFFF
Public Const COLOR_OK As Long = 4878354            ' #12704A
Public Const COLOR_AVISO As Long = 22170           ' #9A5600
Public Const COLOR_ALERTA As Long = 1975987        ' #B3261E
Public Const COLOR_MARCA_SUAVE As Long = 14530191  ' #8FB6DD

Private Const BOTON_PREFIJO As String = "KCMP_"
Private Const FILA_PRIMER_CAMPO As Long = 50

Private Const ALTO_FILA_LIENZO As Double = 13.5
Private Const BARRA_ALTO As Double = 58
Private Const FICHAS_ARRIBA As Double = 128
Private Const HUECO As Double = 12
Private Const TARJETAS_ARRIBA As Double = 192
Private Const TARJETA_ALTO As Double = 128
Private Const TARJETA_EQUIPO_ALTO As Double = 104
Private Const HUECO_TARJETAS As Double = 16

Private Const CAMPOS As String = _
    "ENDPOINT|Direcci{o}n de la plataforma|Termina en /api/v1/vba-bridge;" & _
    "CLIENT_ID|Identificador del equipo|El de la credencial emitida;" & _
    "MATRIX_PATH|Archivo de la matriz|Ruta completa del archivo .xlsb;" & _
    "ROSTER_PATH|Archivo del padr{o}n|Ruta del sem NN CAP.xlsx de la semana;" & _
    "MATRIX_SHEET|Hoja de la matriz|Normalmente HC;" & _
    "EMPLOYEE_COLUMN|Columna del n{u}mero de trabajador|Letra de columna;" & _
    "FIRST_COURSE_COLUMN|Primera columna de cursos|Letra de columna;" & _
    "LAST_COURSE_COLUMN|{U}ltima columna de cursos|Letra de columna. Recortar el rango retira fechas;" & _
    "CLOSE_MASTER_AFTER_CYCLE|Cerrar la matriz al terminar|TRUE o FALSE"

Public Sub KcmAbrirPanel()
    Dim hoja As Worksheet

    On Error GoTo PanelError

    Application.ScreenUpdating = False
    Set hoja = KcmPanelHoja()
    KcmPanelLimpiar hoja
    KcmPanelEncabezado hoja
    KcmPanelCampos hoja
    KcmPanelBotones hoja
    KcmPanelCargar
    Application.ScreenUpdating = True
    hoja.Activate
    hoja.Range("A1").Select
    Exit Sub

PanelError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Panel", "No se pudo abrir el panel.", Err.Description
End Sub

Public Sub KcmPanelRefrescar()
    Dim candidata As Worksheet

    On Error GoTo SinPanel
    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_PANEL_CONFIG_SHEET, vbTextCompare) = 0 Then
            KcmResetCaches
            KcmPanelCargar
            Exit Sub
        End If
    Next candidata
SinPanel:
End Sub

Public Sub KcmPanelCargar()
    Dim hoja As Worksheet
    Dim config As Worksheet
    Dim indice As Long
    Dim total As Long
    Dim clave As String

    On Error GoTo CargarError

    Set hoja = KcmPanelHoja()
    Set config = KcmPanelConfigHoja()
    total = KcmPanelTotalCampos()

    For indice = 0 To total - 1
        clave = KcmPanelParte(KcmPanelCampo(indice), 1)
        hoja.Cells(FILA_PRIMER_CAMPO + indice, 3).Value2 = KcmPanelLeerClave(config, clave)
    Next indice

    KcmPanelEstado hoja
    Exit Sub

CargarError:
    KcmAvisoFallo "Panel", "No se pudo leer la configuracion.", Err.Description
End Sub

Public Sub KcmPanelVaciar()
    Const CONSERVAR As String = _
        "|MATRIX_SHEET|EMPLOYEE_COLUMN|FIRST_COURSE_COLUMN|LAST_COURSE_COLUMN|CLOSE_MASTER_AFTER_CYCLE|"
    Dim config As Worksheet
    Dim ultima As Long
    Dim fila As Long
    Dim clave As String

    If Not KcmAvisoConfirmar("Vaciar", _
        "Se borrara todo lo guardado en este libro salvo la hoja y las columnas de la matriz.", _
        "Direccion, identificador, rutas, credencial, respaldo, estado y bitacoras locales. " & _
        "Despues hay que volver a conectar el equipo.") Then Exit Sub

    On Error GoTo VaciarError
    Application.ScreenUpdating = False
    Set config = KcmPanelConfigHoja()
    ultima = config.Cells(config.Rows.Count, 1).End(xlUp).Row
    For fila = ultima To 2 Step -1
        clave = UCase$(Trim$(KcmPanelTexto(config.Cells(fila, 1).Value2)))
        If InStr(1, CONSERVAR, "|" & clave & "|", vbBinaryCompare) = 0 Then config.Rows(fila).Delete
    Next fila

    KcmPanelBorrarHoja "KCM_CONFIG_RESPALDO"
    KcmPanelVaciarDesdeFila2 KCM_RELEASE_LEDGER_SHEET
    KcmPanelVaciarDesdeFila2 KCM_OVERWRITE_LEDGER_SHEET
    KcmCredencialBorrar
    KcmEstadoVaciarTodo
    KcmResetCaches
    KcmPanelCargar
    Application.ScreenUpdating = True
    KcmAvisoHecho "Vaciar", "El libro quedo vacio.", _
        "Conectar este equipo lo configura de nuevo."
    Exit Sub

VaciarError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Vaciar", "No se pudo vaciar.", Err.Description
End Sub

Private Sub KcmPanelBorrarHoja(ByVal nombre As String)
    Dim hoja As Worksheet
    For Each hoja In ThisWorkbook.Worksheets
        If StrComp(hoja.Name, nombre, vbTextCompare) = 0 Then
            Application.DisplayAlerts = False
            hoja.Visible = xlSheetHidden
            hoja.Delete
            Application.DisplayAlerts = True
            Exit Sub
        End If
    Next hoja
End Sub

Private Sub KcmPanelVaciarDesdeFila2(ByVal nombre As String)
    Dim hoja As Worksheet
    Dim ultima As Long
    For Each hoja In ThisWorkbook.Worksheets
        If StrComp(hoja.Name, nombre, vbTextCompare) = 0 Then
            ultima = hoja.UsedRange.Row + hoja.UsedRange.Rows.Count - 1
            If ultima >= 2 Then hoja.Rows("2:" & CStr(ultima)).ClearContents
            Exit Sub
        End If
    Next hoja
End Sub

Public Sub KcmPanelPermisos()
    Dim pendientes As String

    On Error GoTo PermisosError
    pendientes = KcmConcederPermisosEquipo(KcmConfigValue("MATRIX_PATH", False), _
        KcmConfigValue("ROSTER_PATH", False))
    If Len(pendientes) = 0 Then
        KcmAvisoHecho "Permisos", "Excel puede leer las carpetas de este equipo.", _
            "Escritorio, Documentos, Descargas y carpetas compartidas."
    Else
        KcmAvisoAtencion "Permisos", "Algunas carpetas siguen sin poder leerse.", pendientes
    End If
    Exit Sub

PermisosError:
    KcmAvisoFallo "Permisos", "No se pudieron pedir los permisos.", Err.Description
End Sub

Public Sub KcmPanelGuardar()
    Dim hoja As Worksheet
    Dim config As Worksheet
    Dim indice As Long
    Dim total As Long
    Dim clave As String
    Dim valor As String
    Dim problema As String

    On Error GoTo GuardarError

    Set hoja = KcmPanelHoja()
    Set config = KcmPanelConfigHoja()
    total = KcmPanelTotalCampos()

    For indice = 0 To total - 1
        clave = KcmPanelParte(KcmPanelCampo(indice), 1)
        valor = KcmPanelTexto(hoja.Cells(FILA_PRIMER_CAMPO + indice, 3).Value2)
        problema = KcmPanelProblema(clave, valor)
        If Len(problema) > 0 Then
            KcmAvisoAtencion "Panel", _
                "La configuracion no se guardo: " & _
                KcmAcentos(KcmPanelParte(KcmPanelCampo(indice), 2)) & " no es valido.", problema
            hoja.Cells(FILA_PRIMER_CAMPO + indice, 3).Select
            Exit Sub
        End If
    Next indice

    For indice = 0 To total - 1
        clave = KcmPanelParte(KcmPanelCampo(indice), 1)
        valor = KcmPanelTexto(hoja.Cells(FILA_PRIMER_CAMPO + indice, 3).Value2)
        KcmPanelEscribirClave config, clave, valor
    Next indice

    KcmResetCaches
    KcmPanelEstado hoja
    KcmAvisoHecho "Panel", "Configuracion guardada."
    Exit Sub

GuardarError:
    KcmAvisoFallo "Panel", "La configuracion no se guardo.", Err.Description
End Sub

Private Function KcmPanelHoja() As Worksheet
    Dim candidata As Worksheet
    Dim encontrada As Worksheet

    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_PANEL_CONFIG_SHEET, vbTextCompare) = 0 Then
            Set encontrada = candidata
            Exit For
        End If
    Next candidata

    If encontrada Is Nothing Then
        Set encontrada = ThisWorkbook.Worksheets.Add(Before:=ThisWorkbook.Worksheets(1))
        encontrada.Name = KCM_PANEL_CONFIG_SHEET
    End If

    encontrada.Visible = xlSheetVisible
    Set KcmPanelHoja = encontrada
End Function

Private Function KcmPanelConfigHoja() As Worksheet
    Dim candidata As Worksheet

    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_CONFIG_SHEET, vbTextCompare) = 0 Then
            Set KcmPanelConfigHoja = candidata
            Exit Function
        End If
    Next candidata

    Err.Raise vbObjectError + 7301, "KcmPanelConfigHoja", _
        "Falta la hoja " & KCM_CONFIG_SHEET & ": Reparar instalacion la vuelve a crear."
End Function

Private Sub KcmPanelLimpiar(ByVal hoja As Worksheet)
    Dim indice As Long
    Dim forma As Shape

    For indice = hoja.Shapes.Count To 1 Step -1
        Set forma = hoja.Shapes(indice)
        If Left$(forma.Name, Len(BOTON_PREFIJO)) = BOTON_PREFIJO Then forma.Delete
    Next indice

    hoja.Cells.UnMerge
    hoja.Cells.Clear
    hoja.Cells.Interior.Color = COLOR_LIENZO
    hoja.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.DisplayHeadings = False
End Sub

Public Function KcmAcentos(ByVal texto As String) As String
    texto = Replace(texto, "{a}", ChrW(225))
    texto = Replace(texto, "{e}", ChrW(233))
    texto = Replace(texto, "{i}", ChrW(237))
    texto = Replace(texto, "{o}", ChrW(243))
    texto = Replace(texto, "{u}", ChrW(250))
    texto = Replace(texto, "{n}", ChrW(241))
    texto = Replace(texto, "{A}", ChrW(193))
    texto = Replace(texto, "{E}", ChrW(201))
    texto = Replace(texto, "{I}", ChrW(205))
    texto = Replace(texto, "{O}", ChrW(211))
    texto = Replace(texto, "{U}", ChrW(218))
    texto = Replace(texto, "{-}", ChrW(183))
    KcmAcentos = texto
End Function

Public Function KcmPanelFuente() As String
    If KcmEsMac() Then
        KcmPanelFuente = "Helvetica Neue"
    Else
        KcmPanelFuente = "Segoe UI"
    End If
End Function

Private Function KcmPanelAncho(ByVal hoja As Worksheet) As Double
    KcmPanelAncho = hoja.Columns("E").Left - hoja.Columns("B").Left
End Function

Private Sub KcmPanelEncabezado(ByVal hoja As Worksheet)
    Dim fila As Long
    Dim barra As Shape
    Dim izq As Double

    hoja.Columns("A").ColumnWidth = 4
    hoja.Columns("B").ColumnWidth = 30
    hoja.Columns("C").ColumnWidth = 58
    hoja.Columns("D").ColumnWidth = 46
    hoja.Columns("E").ColumnWidth = 4
    hoja.Cells.Font.Name = KcmPanelFuente()

    For fila = 1 To FILA_PRIMER_CAMPO - 5
        hoja.Rows(fila).RowHeight = ALTO_FILA_LIENZO
    Next fila

    izq = hoja.Columns("B").Left

    Set barra = hoja.Shapes.AddShape(msoShapeRectangle, 0, 0, _
        hoja.Columns("E").Left + hoja.Columns("E").Width, BARRA_ALTO)
    barra.Name = BOTON_PREFIJO & "BARRA"
    barra.Fill.ForeColor.RGB = COLOR_MARCA
    barra.Line.Visible = msoFalse
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TMARCA", izq, 12, 300, 22, _
        "Plataforma KCM", 16, COLOR_BLANCO, True
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TSUB", izq, 34, 400, 14, _
        KcmAcentos("Cliente de Excel {-} Planta Ecatepec"), 9, COLOR_MARCA_SUAVE, False

    KcmPanelRotulo hoja, BOTON_PREFIJO & "TPAG", izq, 76, 400, 26, "Inicio", 18, COLOR_TINTA, True
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TPAGSUB", izq, 102, 500, 14, _
        KcmAcentos("Operaci{o}n del d{i}a desde este libro."), 10, COLOR_APAGADO, False

    hoja.Rows(FILA_PRIMER_CAMPO - 4).RowHeight = 30
    hoja.Rows(FILA_PRIMER_CAMPO - 3).RowHeight = 16
    hoja.Rows(FILA_PRIMER_CAMPO - 2).RowHeight = 12
    hoja.Rows(FILA_PRIMER_CAMPO - 1).RowHeight = 22
    With hoja.Cells(FILA_PRIMER_CAMPO - 4, 2)
        .Value2 = KcmAcentos("Configuraci{o}n de este equipo")
        .Font.Size = 14
        .Font.Bold = True
        .Font.Color = COLOR_TINTA
        .VerticalAlignment = xlBottom
    End With
    With hoja.Cells(FILA_PRIMER_CAMPO - 3, 2)
        .Value2 = KcmAcentos("Se guarda en la hoja " & KCM_CONFIG_SHEET & ".")
        .Font.Size = 9
        .Font.Color = COLOR_APAGADO
    End With
    KcmPanelEncabezadoDeTabla hoja.Cells(FILA_PRIMER_CAMPO - 1, 2), "CAMPO"
    KcmPanelEncabezadoDeTabla hoja.Cells(FILA_PRIMER_CAMPO - 1, 3), "VALOR"
    KcmPanelEncabezadoDeTabla hoja.Cells(FILA_PRIMER_CAMPO - 1, 4), KcmAcentos("DESCRIPCI{O}N")
End Sub

Private Sub KcmPanelEncabezadoDeTabla(ByVal celda As Range, ByVal texto As String)
    celda.Value2 = texto
    celda.Font.Size = 8
    celda.Font.Bold = True
    celda.Font.Color = COLOR_APAGADO
    celda.Interior.Color = COLOR_BLANCO
    celda.IndentLevel = 1
    celda.VerticalAlignment = xlCenter
    With celda.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous
        .Weight = xlThin
        .Color = COLOR_LIENZO
    End With
End Sub

Private Sub KcmPanelEstado(ByVal hoja As Worksheet)
    Dim config As Worksheet
    Dim izquierda As Double
    Dim ancho As Double
    Dim paso As Double
    Dim falta As String
    Dim ruta As String
    Dim marca As String

    Set config = KcmPanelConfigHoja()
    KcmPanelBorrarFichas hoja

    izquierda = hoja.Columns("B").Left
    ancho = (KcmPanelAncho(hoja) - 2 * HUECO) / 3
    paso = ancho + HUECO

    If Len(KcmPanelLeerClave(config, "ENDPOINT")) = 0 Then
        falta = "Falta la direcci{o}n"
    ElseIf Len(KcmPanelLeerClave(config, "CLIENT_ID")) = 0 Then
        falta = "Falta el identificador"
    ElseIf Len(KcmCredencialLeer()) = 0 Then
        falta = "Falta la credencial"
    End If

    If Len(falta) = 0 Then
        KcmPanelPildora hoja, izquierda + KcmPanelAncho(hoja) - 160, "Equipo conectado", COLOR_OK
        KcmPanelFicha hoja, 0, izquierda, FICHAS_ARRIBA, ancho, "EQUIPO", "Conectado", COLOR_OK
    Else
        KcmPanelPildora hoja, izquierda + KcmPanelAncho(hoja) - 160, "Sin configurar", COLOR_AVISO
        KcmPanelFicha hoja, 0, izquierda, FICHAS_ARRIBA, ancho, "EQUIPO", falta, COLOR_AVISO
    End If

    ruta = KcmPanelLeerClave(config, "MATRIX_PATH")
    If Len(ruta) = 0 Then
        KcmPanelFicha hoja, 1, izquierda + paso, FICHAS_ARRIBA, ancho, "MATRIZ", _
            "Se pide al actualizar", COLOR_APAGADO
    ElseIf KcmPanelExiste(ruta) Then
        KcmPanelFicha hoja, 1, izquierda + paso, FICHAS_ARRIBA, ancho, "MATRIZ", _
            KcmPanelNombreDeArchivo(ruta), COLOR_OK
    Else
        KcmPanelFicha hoja, 1, izquierda + paso, FICHAS_ARRIBA, ancho, "MATRIZ", _
            "No est{a} en su carpeta", COLOR_ALERTA
    End If

    marca = KcmPanelLeerClave(config, KCM_CLAVE_ULTIMA_COMPLETA)
    If KcmEsDeHoy(marca) Then
        KcmPanelFicha hoja, 2, izquierda + 2 * paso, FICHAS_ARRIBA, ancho, _
            "ACTUALIZACI{O}N COMPLETA", "Hecha a las " & Mid$(marca, 12, 5), COLOR_OK
    Else
        KcmPanelFicha hoja, 2, izquierda + 2 * paso, FICHAS_ARRIBA, ancho, _
            "ACTUALIZACI{O}N COMPLETA", "Pendiente hoy", COLOR_AVISO
    End If
End Sub

Private Sub KcmPanelBorrarFichas(ByVal hoja As Worksheet)
    Dim indice As Long
    Dim nombre As String

    For indice = hoja.Shapes.Count To 1 Step -1
        nombre = hoja.Shapes(indice).Name
        If Left$(nombre, Len(BOTON_PREFIJO) + 1) = BOTON_PREFIJO & "E" Or _
            Left$(nombre, Len(BOTON_PREFIJO) + 1) = BOTON_PREFIJO & "F" Then
            hoja.Shapes(indice).Delete
        End If
    Next indice
End Sub

Private Sub KcmPanelFicha(ByVal hoja As Worksheet, ByVal indice As Long, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal rotulo As String, ByVal valor As String, ByVal color As Long)
    KcmPaginaFicha hoja, BOTON_PREFIJO & "E" & CStr(indice), izquierda, arriba, ancho, _
        rotulo, valor, color
End Sub

Private Sub KcmPanelPildora(ByVal hoja As Worksheet, ByVal izquierda As Double, _
    ByVal texto As String, ByVal color As Long)
    Dim pildora As Shape

    Set pildora = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda, 18, 160, 22)
    pildora.Name = BOTON_PREFIJO & "EP"
    KcmPanelRedondeo pildora, 0.5
    pildora.Fill.ForeColor.RGB = color
    pildora.Line.Visible = msoFalse
    With pildora.TextFrame2.TextRange
        .Text = texto
        .Font.Name = KcmPanelFuente()
        .Font.Size = 9
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_BLANCO
    End With
    pildora.TextFrame2.HorizontalAnchor = msoAnchorCenter
    pildora.TextFrame2.VerticalAnchor = msoAnchorMiddle
End Sub

Private Function KcmPanelNombreDeArchivo(ByVal ruta As String) As String
    Dim corte As Long
    Dim limpia As String

    limpia = Replace(ruta, "\", "/")
    corte = InStrRev(limpia, "/")
    If corte > 0 Then
        KcmPanelNombreDeArchivo = Mid$(limpia, corte + 1)
    Else
        KcmPanelNombreDeArchivo = ruta
    End If
End Function

Private Sub KcmPanelCampos(ByVal hoja As Worksheet)
    Dim indice As Long
    Dim total As Long
    Dim fila As Long
    Dim definicion As String

    total = KcmPanelTotalCampos()

    For indice = 0 To total - 1
        definicion = KcmPanelCampo(indice)
        fila = FILA_PRIMER_CAMPO + indice
        hoja.Range(hoja.Cells(fila, 2), hoja.Cells(fila, 4)).Interior.Color = COLOR_BLANCO
        With hoja.Range(hoja.Cells(fila, 2), hoja.Cells(fila, 4)).Borders(xlEdgeBottom)
            .LineStyle = xlContinuous
            .Weight = xlThin
            .Color = COLOR_LIENZO
        End With

        With hoja.Cells(fila, 2)
            .Value2 = KcmAcentos(KcmPanelParte(definicion, 2))
            .Font.Bold = True
            .Font.Color = COLOR_TINTA
            .Font.Size = 10
            .IndentLevel = 1
            .VerticalAlignment = xlCenter
        End With

        With hoja.Cells(fila, 3)
            .Font.Color = COLOR_TINTA
            .Font.Size = 10
            .HorizontalAlignment = xlLeft
            .VerticalAlignment = xlCenter
            .IndentLevel = 1
        End With
        KcmPanelBorde hoja.Cells(fila, 3)

        With hoja.Cells(fila, 4)
            .Value2 = KcmAcentos(KcmPanelParte(definicion, 3))
            .Font.Color = COLOR_APAGADO
            .Font.Size = 9
            .WrapText = True
            .VerticalAlignment = xlCenter
            .IndentLevel = 1
        End With

        hoja.Rows(fila).RowHeight = 28
    Next indice

    For indice = 0 To total - 1
        fila = FILA_PRIMER_CAMPO + indice
        hoja.Cells(fila, 6).Value2 = KcmPanelParte(KcmPanelCampo(indice), 1)
        hoja.Cells(fila, 6).Font.Color = COLOR_APAGADO
        hoja.Cells(fila, 6).Font.Size = 8
    Next indice
    hoja.Columns("F").ColumnWidth = 26
End Sub

Private Sub KcmPanelBorde(ByVal celda As Range)
    Dim lado As Variant

    For Each lado In Array(xlEdgeLeft, xlEdgeTop, xlEdgeRight, xlEdgeBottom)
        With celda.Borders(CLng(lado))
            .LineStyle = xlContinuous
            .Weight = xlThin
            .Color = COLOR_MARCA_SUAVE
        End With
    Next lado
End Sub

Private Sub KcmPanelBotones(ByVal hoja As Worksheet)
    Dim izq As Double
    Dim ancho As Double
    Dim mitad As Double
    Dim y As Double
    Dim x As Double

    izq = hoja.Columns("B").Left
    ancho = KcmPanelAncho(hoja)
    mitad = (ancho - HUECO_TARJETAS) / 2
    y = TARJETAS_ARRIBA

    KcmPanelTarjeta hoja, "1", izq, y, mitad, TARJETA_ALTO, "Actualizar el libro", _
        "Escribe en la matriz las fechas liberadas en la plataforma."
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_ACT", izq + 18, y + TARJETA_ALTO - 52, 150, 34, _
        "Actualizar", "KcmActualizar", COLOR_MARCA, 11
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_VER", izq + 178, y + TARJETA_ALTO - 52, 150, 34, _
        "Ver liberaciones", "KcmEntradasAbrir"

    x = izq + mitad + HUECO_TARJETAS
    KcmPanelTarjeta hoja, "2", x, y, mitad, TARJETA_ALTO, "Actualizaci{o}n completa", _
        "Env{i}a la matriz completa para su revisi{o}n. Una vez al d{i}a."
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_COMP", x + 18, y + TARJETA_ALTO - 52, 190, 34, _
        KcmAcentos("Actualizaci{o}n completa"), "KcmActualizacionDiaria", COLOR_MARCA_OSCURA, 11
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_CERR", x + 218, y + TARJETA_ALTO - 52, 150, 34, _
        KcmAcentos("Cerrar el libro del d{i}a"), "KcmCerrarLibroDelDia"

    y = y + TARJETA_ALTO + HUECO_TARJETAS
    KcmPanelTarjeta hoja, "3", izq, y, ancho, TARJETA_ALTO, "Padr{o}n de la semana", _
        "Env{i}a el archivo sem NN CAP.xlsx para su revisi{o}n."
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_PAD", izq + 18, y + TARJETA_ALTO - 52, 190, 34, _
        KcmAcentos("Padr{o}n de la semana"), "KcmPadronDeLaSemana", COLOR_MARCA, 11

    y = y + TARJETA_ALTO + HUECO_TARJETAS
    KcmPanelTarjeta hoja, "5", izq, y, ancho, TARJETA_EQUIPO_ALTO, "Este equipo", _
        "Conexi{o}n del libro con la plataforma."
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_CON", izq + 18, y + TARJETA_EQUIPO_ALTO - 52, 160, 34, _
        "Conectar este equipo", "KcmAsistenteConexion"
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_VERIF", izq + 186, y + TARJETA_EQUIPO_ALTO - 52, 140, 34, _
        KcmAcentos("Verificar conexi{o}n"), "KcmVerificarConexion"
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_EST", izq + 334, y + TARJETA_EQUIPO_ALTO - 52, 100, 34, _
        "Ver estado", "KcmAbrirEstado"
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_PERM", izq + 442, y + TARJETA_EQUIPO_ALTO - 52, 100, 34, _
        "Permisos", "KcmPanelPermisos"
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_WEB", izq + ancho - 168, y + TARJETA_EQUIPO_ALTO - 52, 150, 34, _
        "Abrir la plataforma", "KcmAbrirPlataforma", COLOR_MARCA, 11

    y = hoja.Rows(FILA_PRIMER_CAMPO - 4).Top + 2
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_GUAR", izq + ancho - 120, y, 120, 30, _
        "Guardar", "KcmPanelGuardar", COLOR_MARCA, 10
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_REC", izq + ancho - 250, y, 120, 30, _
        "Vaciar", "KcmPanelVaciar"
End Sub

Private Sub KcmPanelTarjeta(ByVal hoja As Worksheet, ByVal clave As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal alto As Double, ByVal titulo As String, ByVal descripcion As String)
    KcmPaginaTarjeta hoja, BOTON_PREFIJO & "C" & clave, izquierda, arriba, ancho, alto, _
        titulo, descripcion
End Sub

Public Sub KcmPaginaTarjeta(ByVal hoja As Worksheet, ByVal nombre As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal alto As Double, ByVal titulo As String, ByVal descripcion As String)
    Dim tarjeta As Shape

    Set tarjeta = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda, arriba, ancho, alto)
    tarjeta.Name = nombre
    KcmPanelRedondeo tarjeta, 0.06
    tarjeta.Fill.ForeColor.RGB = COLOR_BLANCO
    tarjeta.Line.ForeColor.RGB = COLOR_LIENZO
    tarjeta.Line.Weight = 0.75
    KcmPanelRelieve tarjeta
    With tarjeta.TextFrame2
        .MarginLeft = 18
        .MarginRight = 18
        .MarginTop = 16
        .VerticalAnchor = msoAnchorTop
        .WordWrap = msoTrue
    End With
    KcmPanelDosLineas tarjeta.TextFrame2.TextRange, KcmAcentos(titulo), KcmAcentos(descripcion), _
        13, COLOR_TINTA, 9, COLOR_APAGADO, False
End Sub

Public Sub KcmPanelDosLineas(ByVal texto As Object, ByVal arriba As String, _
    ByVal abajo As String, ByVal tamanoArriba As Single, ByVal colorArriba As Long, _
    ByVal tamanoAbajo As Single, ByVal colorAbajo As Long, ByVal abajoEnNegrita As Boolean)
    texto.Text = arriba & vbCr & abajo
    texto.Font.Name = KcmPanelFuente()
    texto.ParagraphFormat.Alignment = msoAlignLeft
    With texto.Characters(1, Len(arriba)).Font
        .Size = tamanoArriba
        .Bold = msoTrue
        .Fill.ForeColor.RGB = colorArriba
    End With
    If Len(abajo) = 0 Then Exit Sub
    With texto.Characters(Len(arriba) + 2, Len(abajo)).Font
        .Size = tamanoAbajo
        .Fill.ForeColor.RGB = colorAbajo
        If abajoEnNegrita Then
            .Bold = msoTrue
        Else
            .Bold = msoFalse
        End If
    End With
End Sub

Public Sub KcmPanelRotulo(ByVal hoja As Worksheet, ByVal nombre As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal alto As Double, ByVal texto As String, ByVal tamano As Single, _
    ByVal color As Long, ByVal negrita As Boolean)
    Dim caja As Shape

    Set caja = hoja.Shapes.AddTextbox(msoTextOrientationHorizontal, izquierda, arriba, ancho, alto)
    caja.Name = nombre
    caja.Line.Visible = msoFalse
    caja.Fill.Visible = msoFalse
    With caja.TextFrame2
        .MarginLeft = 0
        .MarginRight = 0
        .MarginTop = 0
        .MarginBottom = 0
        .WordWrap = msoTrue
        With .TextRange
            .Text = texto
            .Font.Name = KcmPanelFuente()
            .Font.Size = tamano
            .Font.Fill.ForeColor.RGB = color
            If negrita Then
                .Font.Bold = msoTrue
            Else
                .Font.Bold = msoFalse
            End If
        End With
    End With
End Sub

Public Sub KcmPanelRedondeo(ByVal forma As Shape, ByVal radio As Single)
    On Error Resume Next
    forma.Adjustments.Item(1) = radio
    On Error GoTo 0
End Sub

Public Sub KcmPintarBoton(ByVal hoja As Worksheet, ByVal nombre As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal alto As Double, ByVal etiqueta As String, ByVal macro As String, _
    ByVal color As Long, ByVal tamano As Single)
    Dim forma As Shape

    Set forma = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda, arriba, ancho, alto)
    forma.Name = nombre
    KcmPanelRedondeo forma, 0.22
    forma.Fill.ForeColor.RGB = color
    forma.Line.Visible = msoFalse
    forma.OnAction = macro

    With forma.TextFrame2.TextRange
        .Text = etiqueta
        .Font.Name = KcmPanelFuente()
        .Font.Size = tamano
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_BLANCO
    End With
    forma.TextFrame2.VerticalAnchor = msoAnchorMiddle
    forma.TextFrame2.HorizontalAnchor = msoAnchorCenter
    forma.TextFrame2.WordWrap = msoTrue
    KcmPanelRelieve forma
End Sub

Public Sub KcmPintarBotonSecundario(ByVal hoja As Worksheet, ByVal nombre As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal alto As Double, ByVal etiqueta As String, ByVal macro As String)
    Dim forma As Shape

    Set forma = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda, arriba, ancho, alto)
    forma.Name = nombre
    KcmPanelRedondeo forma, 0.22
    forma.Fill.ForeColor.RGB = COLOR_BLANCO
    forma.Line.ForeColor.RGB = COLOR_MARCA
    forma.Line.Weight = 1
    forma.OnAction = macro

    With forma.TextFrame2.TextRange
        .Text = etiqueta
        .Font.Name = KcmPanelFuente()
        .Font.Size = 10
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_MARCA
    End With
    forma.TextFrame2.VerticalAnchor = msoAnchorMiddle
    forma.TextFrame2.HorizontalAnchor = msoAnchorCenter
    forma.TextFrame2.WordWrap = msoTrue
End Sub

Public Sub KcmPanelRelieve(ByVal forma As Shape)
    On Error Resume Next
    With forma.Shadow
        .Type = msoShadow25
        .Visible = msoTrue
        .ForeColor.RGB = COLOR_TINTA
        .Transparency = 0.84
        .Blur = 6
        .OffsetX = 0
        .OffsetY = 2
    End With
    On Error GoTo 0
End Sub

Private Function KcmPanelExiste(ByVal ruta As String) As Boolean
    KcmPanelExiste = KcmRutaExiste(ruta)
End Function

Private Function KcmPanelTotalCampos() As Long
    KcmPanelTotalCampos = UBound(Split(CAMPOS, ";")) + 1
End Function

Private Function KcmPanelCampo(ByVal indice As Long) As String
    Dim partes As Variant
    partes = Split(CAMPOS, ";")
    KcmPanelCampo = CStr(partes(indice))
End Function

Private Function KcmPanelParte(ByVal definicion As String, ByVal numero As Long) As String
    Dim partes As Variant
    partes = Split(definicion, "|")
    If numero - 1 > UBound(partes) Then Exit Function
    KcmPanelParte = CStr(partes(numero - 1))
End Function

Private Function KcmPanelTexto(ByVal valor As Variant) As String
    If IsError(valor) Then Exit Function
    If IsEmpty(valor) Then Exit Function
    KcmPanelTexto = Trim$(CStr(valor))
End Function

Private Function KcmPanelLeerClave(ByVal config As Worksheet, ByVal clave As String) As String
    Dim ultima As Long
    Dim fila As Long

    ultima = config.Cells(config.Rows.Count, 1).End(xlUp).Row
    For fila = 2 To ultima
        If StrComp(KcmPanelTexto(config.Cells(fila, 1).Value2), clave, vbBinaryCompare) = 0 Then
            KcmPanelLeerClave = KcmPanelTexto(config.Cells(fila, 2).Value2)
            Exit Function
        End If
    Next fila
End Function

Private Sub KcmPanelEscribirClave(ByVal config As Worksheet, ByVal clave As String, _
    ByVal valor As String)
    Dim ultima As Long
    Dim fila As Long

    ultima = config.Cells(config.Rows.Count, 1).End(xlUp).Row
    For fila = 2 To ultima
        If StrComp(KcmPanelTexto(config.Cells(fila, 1).Value2), clave, vbBinaryCompare) = 0 Then
            config.Cells(fila, 2).Value2 = valor
            Exit Sub
        End If
    Next fila

    If ultima < 1 Then ultima = 1
    config.Cells(ultima + 1, 1).Value2 = clave
    config.Cells(ultima + 1, 2).Value2 = valor
End Sub

Private Function KcmPanelProblema(ByVal clave As String, ByVal valor As String) As String
    If clave = "CLOSE_MASTER_AFTER_CYCLE" Then
        If Len(valor) > 0 Then
            If UCase$(valor) <> "TRUE" And UCase$(valor) <> "FALSE" Then
                KcmPanelProblema = "el valor es TRUE o FALSE."
            End If
        End If
        Exit Function
    End If

    If clave = "EMPLOYEE_COLUMN" Or clave = "FIRST_COURSE_COLUMN" Or clave = "LAST_COURSE_COLUMN" Then
        If Len(valor) > 0 Then
            If Not KcmPanelEsLetraDeColumna(valor) Then
                KcmPanelProblema = "va la letra de la columna, por ejemplo B o AJ."
            End If
        End If
        Exit Function
    End If

    If clave = "MATRIX_PATH" Or clave = "ROSTER_PATH" Then
        If InStr(1, valor, """") > 0 Then
            KcmPanelProblema = "la ruta no lleva comillas."
        ElseIf Len(valor) > 0 Then
            If Not KcmPanelExiste(valor) Then
                KcmPanelProblema = "no hay ningun archivo en esa ruta."
            End If
        End If
        Exit Function
    End If

    If clave = "ENDPOINT" Then
        If Len(valor) > 0 Then
            If LCase$(Left$(valor, 8)) <> "https://" Then
                KcmPanelProblema = "la direccion debe empezar con https://."
            End If
        End If
        Exit Function
    End If
End Function

Private Function KcmPanelEsLetraDeColumna(ByVal valor As String) As Boolean
    Dim indice As Long
    Dim caracter As String

    If Len(valor) = 0 Or Len(valor) > 3 Then Exit Function
    For indice = 1 To Len(valor)
        caracter = UCase$(Mid$(valor, indice, 1))
        If caracter < "A" Or caracter > "Z" Then Exit Function
    Next indice
    KcmPanelEsLetraDeColumna = True
End Function

Public Function KcmPanelClaves() As Variant
    Dim claves() As String
    Dim indice As Long
    Dim total As Long

    total = KcmPanelTotalCampos()
    ReDim claves(0 To total - 1)
    For indice = 0 To total - 1
        claves(indice) = KcmPanelParte(KcmPanelCampo(indice), 1)
    Next indice
    KcmPanelClaves = claves
End Function

Public Function KcmPanelDescripcion(ByVal clave As String) As String
    Dim indice As Long
    Dim definicion As String

    For indice = 0 To KcmPanelTotalCampos() - 1
        definicion = KcmPanelCampo(indice)
        If StrComp(KcmPanelParte(definicion, 1), clave, vbBinaryCompare) = 0 Then
            KcmPanelDescripcion = KcmAcentos(KcmPanelParte(definicion, 2) & ". " & _
                KcmPanelParte(definicion, 3))
            Exit Function
        End If
    Next indice
End Function

Public Function KcmPanelRevisarValor(ByVal clave As String, ByVal valor As String) As String
    KcmPanelRevisarValor = KcmPanelProblema(clave, valor)
End Function

Public Sub KcmPaginaEncabezado(ByVal hoja As Worksheet, ByVal prefijo As String, _
    ByVal izquierda As Double, ByVal anchoTotal As Double, ByVal titulo As String, _
    ByVal subtitulo As String)
    Dim barra As Shape

    Set barra = hoja.Shapes.AddShape(msoShapeRectangle, 0, 0, anchoTotal, BARRA_ALTO)
    barra.Name = prefijo & "BARRA"
    barra.Fill.ForeColor.RGB = COLOR_MARCA
    barra.Line.Visible = msoFalse
    KcmPanelRotulo hoja, prefijo & "TMARCA", izquierda, 12, 300, 22, _
        "Plataforma KCM", 16, COLOR_BLANCO, True
    KcmPanelRotulo hoja, prefijo & "TSUB", izquierda, 34, 400, 14, _
        KcmAcentos("Cliente de Excel {-} Planta Ecatepec"), 9, COLOR_MARCA_SUAVE, False
    KcmPanelRotulo hoja, prefijo & "TPAG", izquierda, 72, 600, 26, titulo, 18, COLOR_TINTA, True
    KcmPanelRotulo hoja, prefijo & "TPAGSUB", izquierda, 98, 700, 14, subtitulo, 10, COLOR_APAGADO, False
End Sub

Public Sub KcmPaginaFicha(ByVal hoja As Worksheet, ByVal nombre As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal rotulo As String, ByVal valor As String, ByVal color As Long)
    Dim tarjeta As Shape
    Dim franja As Shape

    Set tarjeta = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda, arriba, ancho, 46)
    tarjeta.Name = nombre
    KcmPanelRedondeo tarjeta, 0.12
    tarjeta.Fill.ForeColor.RGB = COLOR_BLANCO
    tarjeta.Line.ForeColor.RGB = COLOR_LIENZO
    tarjeta.Line.Weight = 0.75
    KcmPanelRelieve tarjeta
    KcmPanelDosLineas tarjeta.TextFrame2.TextRange, KcmAcentos(rotulo), KcmAcentos(valor), _
        7, COLOR_APAGADO, 11, COLOR_TINTA, True
    tarjeta.TextFrame2.MarginLeft = 18
    tarjeta.TextFrame2.VerticalAnchor = msoAnchorMiddle
    tarjeta.TextFrame2.WordWrap = msoTrue

    Set franja = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda + 6, arriba + 10, 4, 26)
    franja.Name = nombre & "_F"
    franja.Fill.ForeColor.RGB = color
    franja.Line.Visible = msoFalse
End Sub

Public Sub KcmPaginaVentana(ByVal hoja As Worksheet)
    hoja.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.DisplayHeadings = False
End Sub

Public Sub KcmPaginaBorrar(ByVal hoja As Worksheet, ByVal prefijo As String)
    Dim indice As Long

    For indice = hoja.Shapes.Count To 1 Step -1
        If Left$(hoja.Shapes(indice).Name, Len(prefijo)) = prefijo Then hoja.Shapes(indice).Delete
    Next indice
End Sub

Public Sub KcmPaginaEtiqueta(ByVal celda As Range, ByVal texto As String, ByVal color As Long)
    celda.Value2 = texto
    celda.Interior.Color = color
    celda.Font.Color = COLOR_BLANCO
    celda.Font.Bold = True
    celda.Font.Size = 8
    celda.HorizontalAlignment = xlCenter
    celda.VerticalAlignment = xlCenter
End Sub

Public Sub KcmPaginaRenglon(ByVal rango As Range)
    rango.Interior.Color = COLOR_BLANCO
    With rango.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous
        .Weight = xlThin
        .Color = COLOR_LIENZO
    End With
End Sub

Public Sub KcmPaginaEncabezadoDeTabla(ByVal rango As Range)
    KcmPaginaRenglon rango
    rango.Font.Size = 8
    rango.Font.Bold = True
    rango.Font.Color = COLOR_APAGADO
    rango.VerticalAlignment = xlCenter
    rango.IndentLevel = 1
End Sub
