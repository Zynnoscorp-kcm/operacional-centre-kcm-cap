Attribute VB_Name = "KcmConfigButtons"
Option Explicit

' La hoja KCM_CONFIG como pagina de la consola.
'
' KCM_CONFIG es lo que leen todos los modulos: clave en la columna A desde la
' fila 2, valor en la B. Eso no cambia y no puede cambiar: `KcmConfigMap` toma
' como clave cualquier texto de la columna A y falla cerrado ante una repetida.
' Por eso toda la pagina vive en dos lugares que el lector no mira:
'
' 1. LA FILA 1, MUY ALTA. Barra de marca, titulo, fichas y tarjetas son formas
'    que flotan sobre ella; los rotulos de la tabla quedan abajo, pegados a la
'    primera clave. La columna A no recibe ni un titulo de seccion.
' 2. LAS COLUMNAS C Y D. Estado y descripcion de cada clave. Se reescriben en
'    cada dibujo; lo que alguien escriba ahi a mano se pierde al redibujar.
'
' Lo que agrega sobre la tabla cruda es revision: cada clave dice si esta bien,
' con las mismas reglas con que el panel valida al guardar, y las repetidas --lo
' unico que impide leer la configuracion entera-- salen en rojo. Ademas un
' respaldo de un paso antes de cambiar muchas claves a la vez.
'
' Editar sigue siendo cosa del panel: aqui se ve, se revisa y se respalda.

Private Const BOTON_PREFIJO As String = "KCM_BTN_"
Private Const KCM_CONFIG_RESPALDO_SHEET As String = "KCM_CONFIG_RESPALDO"

' Geometria, en puntos. Todo lo de arriba cabe en la fila 1.
Private Const CONFIG_IZQ As Double = 14
Private Const CONFIG_FICHAS_ARRIBA As Double = 124
Private Const CONFIG_TARJETAS_ARRIBA As Double = 184
Private Const CONFIG_TARJETA_ALTO As Double = 112
Private Const CONFIG_HUECO As Double = 12
Private Const CONFIG_HUECO_TARJETAS As Double = 16
Private Const CONFIG_ALTO_CABECERA As Double = 330

' Las que la verificacion de la matriz exige llenas. Entre barras para buscar
' una clave entera y no un pedazo de otra.
Private Const CONFIG_OBLIGATORIAS As String = _
    "|ENDPOINT|CLIENT_ID|MATRIX_SHEET|EMPLOYEE_COLUMN|FIRST_COURSE_COLUMN|LAST_COURSE_COLUMN|"

' Lo que encontro la ultima revision. Lo llenan los renglones y lo leen las fichas.
Private mClaves As Long
Private mFallos As Long
Private mAvisos As Long
Private mPrimerProblema As Long

' ---------------------------------------------------------------- entradas

''' Redibuja KCM_CONFIG y revisa cada clave.
'''
''' Conserva su nombre de siempre porque la instalacion y el asistente lo llaman.
''' Es idempotente: borra sus formas por prefijo y rehace las columnas C y D.
Public Sub KcmInstallButtons()
    On Error GoTo InstallError
    Application.ScreenUpdating = False
    KcmConfigDibujar
    KcmPanelRefrescar
    Application.ScreenUpdating = True
    Exit Sub

InstallError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Instalacion", "No se pudo preparar la hoja " & KCM_CONFIG_SHEET & ".", Err.Description
End Sub

''' Lo mismo que redibujar, y deja el cursor en la primera clave con problema.
Public Sub KcmConfigRevisar()
    Dim sheet As Worksheet

    On Error GoTo RevisarError
    Application.ScreenUpdating = False
    KcmConfigDibujar
    KcmPanelRefrescar
    Application.ScreenUpdating = True

    Set sheet = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    If mPrimerProblema > 0 Then
        sheet.Cells(mPrimerProblema, 2).Select
    Else
        sheet.Range("A1").Select
    End If
    Exit Sub

RevisarError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Revisar configuracion", "No se pudo revisar la configuracion.", Err.Description
End Sub

''' Agrega al final, vacias, las claves que el panel conoce y la hoja no tiene.
'''
''' Una instalacion vieja no trae las claves que se agregaron despues, y el panel
''' las escribe solo al guardar. Aqui se ven de una vez, en su renglon, para que
''' quien revisa sepa que existen antes de que algo las pida.
Public Sub KcmConfigCompletar()
    Dim sheet As Worksheet
    Dim claves As Variant
    Dim indice As Long
    Dim ultima As Long
    Dim agregadas As String
    Dim cuantas As Long

    On Error GoTo CompletarError

    Set sheet = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    ultima = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row
    claves = KcmPanelClaves()
    For indice = LBound(claves) To UBound(claves)
        If KcmConfigVeces(sheet, CStr(claves(indice)), ultima) = 0 Then
            ultima = ultima + 1
            sheet.Cells(ultima, 1).Value2 = CStr(claves(indice))
            sheet.Cells(ultima, 2).Value2 = ""
            If cuantas > 0 Then agregadas = agregadas & ", "
            agregadas = agregadas & CStr(claves(indice))
            cuantas = cuantas + 1
        End If
    Next indice

    If cuantas = 0 Then
        KcmAvisoHecho "Completar claves", "No falta ninguna clave."
        Exit Sub
    End If

    KcmResetCaches
    KcmInstallButtons
    KcmAvisoHecho "Completar claves", _
        "Se agregaron " & KcmPlural(cuantas, "clave vacia", "claves vacias") & ".", _
        agregadas & vbCrLf & vbCrLf & "Sus valores se capturan en el panel."
    Exit Sub

CompletarError:
    KcmAvisoFallo "Completar claves", "No se agregaron las claves que faltan.", Err.Description
End Sub

''' Copia las claves a una hoja oculta. Hay un solo respaldo: el nuevo reemplaza al anterior.
Public Sub KcmConfigRespaldar()
    Dim config As Worksheet
    Dim respaldo As Worksheet
    Dim ultima As Long
    Dim fecha As String

    On Error GoTo RespaldarError

    Set config = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    ultima = config.Cells(config.Rows.Count, 1).End(xlUp).Row
    If ultima < 2 Then
        KcmAvisoAtencion "Respaldo", "La configuracion esta vacia; no hay nada que respaldar."
        Exit Sub
    End If

    Set respaldo = KcmConfigRespaldoHoja(False)
    If Not respaldo Is Nothing Then
        fecha = KcmConfigRespaldoFecha(respaldo)
        If Len(fecha) > 0 Then
            If Not KcmAvisoConfirmar("Respaldo", _
                "Se reemplazara el respaldo del " & fecha & ".") Then Exit Sub
        End If
    Else
        Set respaldo = KcmConfigRespaldoHoja(True)
    End If

    respaldo.Cells.Clear
    ' Copiar el rango y no sus valores: una clave como 0001 guardada como texto
    ' volveria como numero si pasara por Value2.
    config.Range(config.Cells(1, 1), config.Cells(ultima, 2)).Copy Destination:=respaldo.Range("A1")
    respaldo.Range("D1").Value2 = Format$(Now, "dd/mm/yyyy hh:nn")

    KcmInstallButtons
    KcmAvisoHecho "Respaldo", "Se respaldaron " & KcmPlural(ultima - 1, "clave", "claves") & "."
    Exit Sub

RespaldarError:
    KcmAvisoFallo "Respaldo", "No se hizo el respaldo de la configuracion.", Err.Description
End Sub

''' Devuelve la configuracion al respaldo. Pregunta antes: lo de ahora se pierde.
Public Sub KcmConfigRestaurar()
    Dim config As Worksheet
    Dim respaldo As Worksheet
    Dim fecha As String
    Dim ultimaRespaldo As Long
    Dim ultimaActual As Long

    On Error GoTo RestaurarError

    Set respaldo = KcmConfigRespaldoHoja(False)
    If Not respaldo Is Nothing Then fecha = KcmConfigRespaldoFecha(respaldo)
    If Len(fecha) = 0 Then
        KcmAvisoAtencion "Restaurar", "No hay respaldo de la configuracion.", _
            "Se crea con el boton Respaldar."
        Exit Sub
    End If

    ultimaRespaldo = respaldo.Cells(respaldo.Rows.Count, 1).End(xlUp).Row
    If Not KcmAvisoConfirmar("Restaurar", _
        "Las claves de ahora se reemplazaran por las " & _
        KcmPlural(ultimaRespaldo - 1, "clave", "claves") & " del respaldo del " & fecha & ".", _
        "Los valores actuales se pierden. La credencial no cambia: no vive en esta hoja.") Then Exit Sub

    Set config = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    ultimaActual = config.Cells(config.Rows.Count, 1).End(xlUp).Row
    If ultimaActual < ultimaRespaldo Then ultimaActual = ultimaRespaldo
    If ultimaActual >= 2 Then config.Range(config.Cells(2, 1), config.Cells(ultimaActual, 2)).Clear
    If ultimaRespaldo >= 2 Then
        respaldo.Range(respaldo.Cells(2, 1), respaldo.Cells(ultimaRespaldo, 2)).Copy _
            Destination:=config.Range("A2")
    End If

    KcmResetCaches
    KcmInstallButtons
    KcmAvisoHecho "Restaurar", "Configuracion restaurada al respaldo del " & fecha & "."
    Exit Sub

RestaurarError:
    KcmAvisoFallo "Restaurar", "La configuracion no se restauro.", Err.Description
End Sub

' ---------------------------------------------------------------- el dibujo

Private Sub KcmConfigDibujar()
    Dim sheet As Worksheet
    Dim ultima As Long
    Dim fila As Long
    Dim anchoTotal As Double

    Set sheet = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    KcmPaginaBorrar sheet, BOTON_PREFIJO
    ultima = KcmConfigUltimaFila(sheet)

    ' C y D son de la pagina: se limpian enteras antes de reescribirlas.
    sheet.Range(sheet.Cells(1, 3), sheet.Cells(ultima + 200, 4)).Clear
    sheet.Cells.Interior.Color = COLOR_LIENZO
    sheet.Cells.Font.Name = KcmPanelFuente()
    sheet.Columns("A").ColumnWidth = 30
    sheet.Columns("B").ColumnWidth = 58
    sheet.Columns("C").ColumnWidth = 13
    sheet.Columns("D").ColumnWidth = 64
    sheet.Columns("E").ColumnWidth = 3

    ' Los rotulos de la tabla, al pie de la fila 1. A1 conserva CLAVE: la
    ' instalacion lo usa para saber que la hoja ya existe.
    sheet.Rows(1).RowHeight = CONFIG_ALTO_CABECERA
    sheet.Cells(1, 1).Value2 = "CLAVE"
    sheet.Cells(1, 2).Value2 = "VALOR"
    sheet.Cells(1, 3).Value2 = "ESTADO"
    sheet.Cells(1, 4).Value2 = KcmAcentos("DESCRIPCI{O}N")
    With sheet.Range("A1:D1")
        .Font.Size = 8
        .Font.Bold = True
        .Font.Color = COLOR_APAGADO
        .VerticalAlignment = xlBottom
        With .Borders(xlEdgeBottom)
            .LineStyle = xlContinuous
            .Weight = xlThin
            .Color = COLOR_MARCA_SUAVE
        End With
    End With
    sheet.Range("A1:B1").IndentLevel = 1
    sheet.Cells(1, 4).IndentLevel = 1
    sheet.Cells(1, 3).HorizontalAlignment = xlCenter

    mClaves = 0
    mFallos = 0
    mAvisos = 0
    mPrimerProblema = 0
    For fila = 2 To ultima
        KcmConfigRenglon sheet, fila, ultima
    Next fila

    anchoTotal = sheet.Columns("E").Left + sheet.Columns("E").Width
    KcmPaginaEncabezado sheet, BOTON_PREFIJO, CONFIG_IZQ, anchoTotal, _
        KcmAcentos("Configuraci{o}n t{e}cnica"), _
        KcmAcentos("Revisada el " & Format$(Now, "dd/mm/yyyy") & " a las " & Format$(Now, "hh:nn") & _
        ". Los valores se editan desde el panel.")
    KcmConfigNavegacion sheet, anchoTotal
    KcmConfigFichas sheet, anchoTotal, ultima
    KcmConfigTarjetas sheet, anchoTotal
    KcmPaginaVentana sheet
End Sub

''' Da forma a un renglon y dice si la clave esta bien.
'''
''' El orden de las preguntas es el de la gravedad: una repetida impide leer toda
''' la configuracion, un valor invalido rompe la accion que lo usa, y una clave
''' vacia solo estorba cuando algo la pide.
Private Sub KcmConfigRenglon(ByVal sheet As Worksheet, ByVal fila As Long, ByVal ultima As Long)
    Dim clave As String
    Dim valor As String
    Dim descripcion As String
    Dim problema As String
    Dim estado As String
    Dim color As Long
    Dim detalle As String
    Dim resaltar As Long

    clave = Trim$(KcmCellText(sheet.Cells(fila, 1).Value2))
    valor = Trim$(KcmCellText(sheet.Cells(fila, 2).Value2))

    KcmPaginaRenglon sheet.Range(sheet.Cells(fila, 1), sheet.Cells(fila, 4))
    sheet.Range(sheet.Cells(fila, 1), sheet.Cells(fila, 4)).VerticalAlignment = xlCenter
    sheet.Range(sheet.Cells(fila, 1), sheet.Cells(fila, 2)).IndentLevel = 1
    sheet.Cells(fila, 4).IndentLevel = 1
    With sheet.Cells(fila, 1).Font
        .Bold = True
        .Size = 10
        .Color = COLOR_TINTA
    End With
    With sheet.Cells(fila, 2).Font
        .Size = 10
        .Color = COLOR_TINTA
    End With
    With sheet.Cells(fila, 4)
        .Font.Size = 9
        .Font.Color = COLOR_APAGADO
        .WrapText = True
    End With
    sheet.Rows(fila).RowHeight = 24

    If Len(clave) = 0 Then
        If Len(valor) = 0 Then Exit Sub
        estado = "SIN CLAVE"
        color = COLOR_AVISO
        detalle = "Valor sin clave: el libro no lo lee."
        mAvisos = mAvisos + 1
    Else
        mClaves = mClaves + 1
        descripcion = KcmPanelDescripcion(clave)
        If KcmConfigVeces(sheet, clave, ultima) > 1 Then
            estado = "REPETIDA"
            color = COLOR_ALERTA
            detalle = KcmAcentos("Repetida: mientras aparezca dos veces el libro no lee " & _
                "ninguna configuraci{o}n. Borre uno de los renglones.")
            resaltar = Len(detalle)
            mFallos = mFallos + 1
        ElseIf Len(descripcion) = 0 Then
            estado = "INTERNA"
            color = COLOR_APAGADO
            If clave = KCM_CLAVE_ULTIMA_COMPLETA Then
                detalle = KcmAcentos("Hora de la {u}ltima actualizaci{o}n completa. La escribe el libro.")
            Else
                detalle = "Clave que el panel no conoce. No estorba la lectura."
            End If
        Else
            problema = KcmPanelRevisarValor(clave, valor)
            If Len(problema) > 0 Then
                estado = "REVISAR"
                color = COLOR_ALERTA
                detalle = "Revisar: " & problema
                resaltar = Len(detalle)
                detalle = detalle & " " & descripcion
                mFallos = mFallos + 1
            ElseIf Len(valor) = 0 Then
                If InStr(1, CONFIG_OBLIGATORIAS, "|" & clave & "|", vbBinaryCompare) > 0 Then
                    estado = KcmAcentos("VAC{I}A")
                    color = COLOR_AVISO
                    detalle = KcmAcentos("Vac{i}a: la actualizaci{o}n la pide.")
                    resaltar = Len(detalle)
                    detalle = detalle & " " & descripcion
                    mAvisos = mAvisos + 1
                Else
                    estado = "OPCIONAL"
                    color = COLOR_APAGADO
                    detalle = descripcion
                End If
            Else
                estado = "CORRECTA"
                color = COLOR_OK
                detalle = descripcion
            End If
        End If
    End If

    KcmPaginaEtiqueta sheet.Cells(fila, 3), estado, color
    sheet.Cells(fila, 4).Value2 = detalle
    ' Lo que hay que hacer va en el color del estado; la ayuda sigue en gris.
    If resaltar > 0 Then
        With sheet.Cells(fila, 4).Characters(1, resaltar).Font
            .Color = color
            .Bold = True
        End With
        If mPrimerProblema = 0 Then mPrimerProblema = fila
    End If

    sheet.Rows(fila).AutoFit
    If sheet.Rows(fila).RowHeight < 24 Then sheet.Rows(fila).RowHeight = 24
End Sub

''' A la derecha del titulo: a donde se va desde aqui.
Private Sub KcmConfigNavegacion(ByVal sheet As Worksheet, ByVal anchoTotal As Double)
    Dim derecha As Double

    derecha = anchoTotal - CONFIG_IZQ
    KcmPintarBoton sheet, BOTON_PREFIJO & "PANEL", derecha - 140, 74, 140, 32, _
        "Abrir el panel", "KcmAbrirPanel", COLOR_MARCA, 10
    KcmPintarBotonSecundario sheet, BOTON_PREFIJO & "ESTADO", derecha - 260, 74, 110, 32, _
        "Ver estado", "KcmAbrirEstado"
    KcmPintarBotonSecundario sheet, BOTON_PREFIJO & "ENTR", derecha - 400, 74, 130, 32, _
        "Ver liberaciones", "KcmEntradasAbrir"
End Sub

''' Cuatro fichas: cuantas claves, que encontro la revision, que falta y la credencial.
Private Sub KcmConfigFichas(ByVal sheet As Worksheet, ByVal anchoTotal As Double, _
    ByVal ultima As Long)
    Dim ancho As Double
    Dim paso As Double
    Dim claves As Variant
    Dim indice As Long
    Dim faltan As Long

    ancho = (anchoTotal - 2 * CONFIG_IZQ - 3 * CONFIG_HUECO) / 4
    paso = ancho + CONFIG_HUECO

    KcmPaginaFicha sheet, BOTON_PREFIJO & "F0", CONFIG_IZQ, CONFIG_FICHAS_ARRIBA, ancho, _
        "CLAVES", KcmPlural(mClaves, "registrada", "registradas"), COLOR_MARCA

    If mFallos > 0 Then
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F1", CONFIG_IZQ + paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "REVISI{O}N", KcmPlural(mFallos, "error", "errores"), COLOR_ALERTA
    ElseIf mAvisos > 0 Then
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F1", CONFIG_IZQ + paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "REVISI{O}N", KcmPlural(mAvisos, "aviso", "avisos"), COLOR_AVISO
    Else
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F1", CONFIG_IZQ + paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "REVISI{O}N", "Todo en orden", COLOR_OK
    End If

    claves = KcmPanelClaves()
    For indice = LBound(claves) To UBound(claves)
        If KcmConfigVeces(sheet, CStr(claves(indice)), ultima) = 0 Then faltan = faltan + 1
    Next indice
    If faltan = 0 Then
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F2", CONFIG_IZQ + 2 * paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "CLAVES FALTANTES", "Ninguna", COLOR_OK
    Else
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F2", CONFIG_IZQ + 2 * paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "CLAVES FALTANTES", KcmPlural(faltan, "clave", "claves"), COLOR_AVISO
    End If

    If Len(KcmCredencialLeer()) > 0 Then
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F3", CONFIG_IZQ + 3 * paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "CREDENCIAL", "Registrada", COLOR_OK
    Else
        KcmPaginaFicha sheet, BOTON_PREFIJO & "F3", CONFIG_IZQ + 3 * paso, CONFIG_FICHAS_ARRIBA, ancho, _
            "CREDENCIAL", "Sin registrar", COLOR_AVISO
    End If
End Sub

''' Tres tarjetas, una por tarea: revisar, respaldar y conectar.
Private Sub KcmConfigTarjetas(ByVal sheet As Worksheet, ByVal anchoTotal As Double)
    Dim ancho As Double
    Dim x As Double
    Dim y As Double
    Dim yBoton As Double
    Dim primero As Double
    Dim segundo As Double
    Dim respaldo As Worksheet
    Dim fecha As String
    Dim nota As String

    ancho = (anchoTotal - 2 * CONFIG_IZQ - 2 * CONFIG_HUECO_TARJETAS) / 3
    ' Los dos botones de cada tarjeta se reparten su ancho: el de la derecha lleva
    ' el rotulo mas largo.
    primero = Int((ancho - 46) * 0.44)
    segundo = Int(ancho - 46 - primero)
    y = CONFIG_TARJETAS_ARRIBA
    yBoton = y + CONFIG_TARJETA_ALTO - 48

    x = CONFIG_IZQ
    KcmPaginaTarjeta sheet, BOTON_PREFIJO & "C1", x, y, ancho, CONFIG_TARJETA_ALTO, _
        "Revisi{o}n", "Valida cada clave con las reglas del panel y marca lo que impide leerla."
    KcmPintarBoton sheet, BOTON_PREFIJO & "REV", x + 18, yBoton, primero, 32, _
        "Revisar", "KcmConfigRevisar", COLOR_MARCA, 10
    KcmPintarBotonSecundario sheet, BOTON_PREFIJO & "COMP", x + 28 + primero, yBoton, segundo, 32, _
        "Completar claves", "KcmConfigCompletar"

    Set respaldo = KcmConfigRespaldoHoja(False)
    If Not respaldo Is Nothing Then fecha = KcmConfigRespaldoFecha(respaldo)
    If Len(fecha) > 0 Then
        nota = "{U}ltimo respaldo: " & fecha & "."
    Else
        nota = "Sin respaldo todav{i}a. Conviene uno antes de un cambio grande."
    End If
    x = x + ancho + CONFIG_HUECO_TARJETAS
    KcmPaginaTarjeta sheet, BOTON_PREFIJO & "C2", x, y, ancho, CONFIG_TARJETA_ALTO, "Respaldo", nota
    KcmPintarBoton sheet, BOTON_PREFIJO & "RESP", x + 18, yBoton, primero, 32, _
        "Respaldar", "KcmConfigRespaldar", COLOR_MARCA, 10
    KcmPintarBotonSecundario sheet, BOTON_PREFIJO & "REST", x + 28 + primero, yBoton, segundo, 32, _
        "Restaurar", "KcmConfigRestaurar"

    x = x + ancho + CONFIG_HUECO_TARJETAS
    KcmPaginaTarjeta sheet, BOTON_PREFIJO & "C3", x, y, ancho, CONFIG_TARJETA_ALTO, _
        "Conexi{o}n", "Registra la credencial de este equipo o prueba que la plataforma responda."
    KcmPintarBoton sheet, BOTON_PREFIJO & "CON", x + 18, yBoton, primero, 32, _
        "Conectar", "KcmAsistenteConexion", COLOR_MARCA, 10
    KcmPintarBotonSecundario sheet, BOTON_PREFIJO & "VERIF", x + 28 + primero, yBoton, segundo, 32, _
        KcmAcentos("Verificar conexi{o}n"), "KcmVerificarConexion"
End Sub

' ---------------------------------------------------------------- utilidades

''' Ultimo renglon con algo en la clave o en el valor.
Private Function KcmConfigUltimaFila(ByVal sheet As Worksheet) As Long
    Dim ultima As Long
    Dim ultimaValor As Long

    ultima = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row
    ultimaValor = sheet.Cells(sheet.Rows.Count, 2).End(xlUp).Row
    If ultimaValor > ultima Then ultima = ultimaValor
    If ultima < 1 Then ultima = 1
    KcmConfigUltimaFila = ultima
End Function

''' Cuantas veces aparece una clave. Distingue mayusculas, como el lector.
Private Function KcmConfigVeces(ByVal sheet As Worksheet, ByVal clave As String, _
    ByVal ultima As Long) As Long
    Dim fila As Long

    For fila = 2 To ultima
        If StrComp(Trim$(KcmCellText(sheet.Cells(fila, 1).Value2)), clave, vbBinaryCompare) = 0 Then
            KcmConfigVeces = KcmConfigVeces + 1
        End If
    Next fila
End Function

''' La hoja del respaldo, muy oculta. Con `crear` la agrega si falta.
Private Function KcmConfigRespaldoHoja(ByVal crear As Boolean) As Worksheet
    Dim candidata As Worksheet

    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_CONFIG_RESPALDO_SHEET, vbTextCompare) = 0 Then
            Set KcmConfigRespaldoHoja = candidata
            Exit Function
        End If
    Next candidata

    If Not crear Then Exit Function
    Set candidata = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
    candidata.Name = KCM_CONFIG_RESPALDO_SHEET
    candidata.Visible = xlSheetVeryHidden
    Set KcmConfigRespaldoHoja = candidata
End Function

Private Function KcmConfigRespaldoFecha(ByVal respaldo As Worksheet) As String
    KcmConfigRespaldoFecha = Trim$(KcmCellText(respaldo.Range("D1").Value2))
End Function
