Attribute VB_Name = "KcmPanel"
Option Explicit

' Panel del cliente: la cara visible del libro controlador.
'
' KCM_CONFIG es una tabla de dos columnas con claves en mayusculas y sin
' acentos: ENDPOINT, MATRIX_PATH, FIRST_COURSE_COLUMN. Funciona, pero es el
' formato interno de un lector, no una pantalla: nada dice que FIRST_COURSE_COLUMN
' es la primera columna de cursos de la hoja HC, ni que ROSTER_PATH cambia cada
' lunes, ni si la conexion esta puesta. Quien instala el cliente en un equipo
' nuevo lee nueve claves crudas y adivina.
'
' Este modulo agrega KCM_PANEL, una hoja con el mismo lenguaje visual que la
' consola web: banda de marca azul, bloques en tarjeta, rotulo legible con su
' ayuda al lado del campo, y los botones agrupados por lo que hacen en vez de en
' una columna de once rectangulos iguales.
'
' Tres reglas que gobiernan el diseno, y las tres vienen del lector:
'
' 1. KCM_CONFIG NO SE TOCA. `KcmConfigMap` recorre la columna A desde la fila 2
'    y falla cerrado ante una clave repetida. Poner titulos de seccion o texto
'    decorativo en esa columna los convertiria en claves, y dos secciones con el
'    mismo nombre reventarian la lectura entera. El panel es una hoja aparte que
'    escribe en KCM_CONFIG, no un formato encima de ella.
' 2. EL PANEL NO ES LA VERDAD. Se carga desde KCM_CONFIG y se guarda hacia
'    KCM_CONFIG con dos botones explicitos. Si alguien edita la hoja tecnica a
'    mano, se trae al abrir el panel; nada se sincroniza solo, porque un guardado
'    automatico al vuelo escribiria una ruta a medio teclear.
' 3. NO HAY LOGICA NUEVA. Los botones llaman a las mismas entradas publicas ya
'    depuradas. Un fallo aqui es el fallo de siempre, con el mismo diagnostico.
'
' El modulo es aditivo: se puede quitar entero y el ciclo sigue corriendo desde
' KCM_CONFIG como antes.

Public Const KCM_PANEL_CONFIG_SHEET As String = "KCM_PANEL"

' Paleta de `app/src/web/assets/tokens.css`, para que el libro y la consola se
' vean del mismo sistema. Los nombres son los de alli.
'
' Publicas porque KcmConfigButtons y KcmMatrixPanel pintan las mismas cosas. Antes
' cada uno llevaba sus propios `RGB(...)` sueltos, heredados de una paleta anterior,
' y por eso los botones de la hoja de configuracion y los del panel salian de
' azules distintos. Ahora hay un solo lugar donde cambiarlos.
'
' El numero es lo que Excel guarda y el hexadecimal lo que declara la hoja de
' estilos; VBA los ordena al reves --azul, verde, rojo-- y por eso no se parecen.
' Cuatro de ellos habian quedado desviados de su propio comentario. `tests/unit`
' los recalcula desde `tokens.css` y falla si vuelven a separarse.
Public Const COLOR_MARCA As Long = 10439714        ' #224C9F
Public Const COLOR_MARCA_OSCURA As Long = 7288087  ' #17356F
Public Const COLOR_TINTA As Long = 4005391         ' #0F1E3D
Public Const COLOR_APAGADO As Long = 7887434       ' #4A5A78
Public Const COLOR_LIENZO As Long = 16249326       ' #EEF1F7
Public Const COLOR_BLANCO As Long = 16777215       ' #FFFFFF
Public Const COLOR_OK As Long = 4878354            ' #12704A
Public Const COLOR_AVISO As Long = 22170           ' #9A5600
Public Const COLOR_ALERTA As Long = 1975987        ' #B3261E
' El azul claro de la casa. Sirve para el unico texto que va sobre el propio azul
' de marca: el subtitulo de la banda, que tiene que leerse como secundario sin
' dejar de leerse. Un blanco al 100 % ahi compite con el rotulo de arriba.
Public Const COLOR_MARCA_SUAVE As Long = 14530191  ' #8FB6DD

Private Const BOTON_PREFIJO As String = "KCMP_"
Private Const FILA_PRIMER_CAMPO As Long = 50

' Geometria de la pagina, en puntos. La zona superior son formas sobre filas de
' alto fijo; la configuracion empieza en FILA_PRIMER_CAMPO, debajo de todo.
Private Const ALTO_FILA_LIENZO As Double = 13.5
Private Const BARRA_ALTO As Double = 58
Private Const FICHAS_ARRIBA As Double = 128
Private Const HUECO As Double = 12
Private Const TARJETAS_ARRIBA As Double = 192
Private Const TARJETA_ALTO As Double = 128
Private Const TARJETA_EQUIPO_ALTO As Double = 104
Private Const HUECO_TARJETAS As Double = 16

' Cada campo del panel: la clave que lee el cliente, su rotulo y su ayuda.
' El orden de este arreglo es el orden de la hoja.
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

' ---------------------------------------------------------------- entradas

''' Crea o rehace el panel y lo deja cargado con lo que hay en KCM_CONFIG.
'''
''' Es idempotente: borra sus propias formas por prefijo antes de dibujar, de
''' modo que ejecutarlo dos veces no acumula botones ni duplica asignaciones.
Public Sub KcmAbrirPanel()
    Dim hoja As Worksheet

    On Error GoTo PanelError

    ' El panel son decenas de formas y celdas: dibujarlas con la pantalla quieta
    ' es mucho mas rapido y no parpadea. Excel la reactiva al terminar la macro.
    Application.ScreenUpdating = False
    Set hoja = KcmPanelHoja()
    KcmPanelLimpiar hoja
    KcmPanelEncabezado hoja
    ' La tira de estado no se dibuja aqui: la dibuja `KcmPanelCargar`, que corre
    ' al final de esta rutina y ademas cada vez que se recarga o se guarda.
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

''' Trae a la vista lo que hoy tiene KCM_CONFIG.
'''
''' Lee la hoja tecnica directamente y no `KcmConfigValue`, por dos razones: una
''' clave vacia es normal en una instalacion nueva y `KcmConfigValue` la trata
''' como error, y el panel debe poder mostrar KCM_CONFIG aunque este a medio
''' llenar, que es justo cuando mas falta hace.
''' Vuelve a leer KCM_CONFIG en el panel, si el panel existe. La llama todo lo que
''' cambia la configuracion por fuera del panel --el asistente, Completar,
''' Restaurar, Revisar--, para que el panel nunca ensene valores viejos. No crea
''' el panel ni avisa si algo falla: es un reflejo, no una accion.
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

''' Escribe el panel en KCM_CONFIG. Es el unico punto donde el panel manda.
'''
''' Valida antes de escribir y no despues: una ruta con comillas de Windows o una
''' columna que no es una letra se detectan aqui, mientras corregirlas cuesta un
''' campo, y no dentro de un ciclo a medio correr.
''' Deja el libro como recien instalado para otra persona o para conectar desde
''' cero. Se conserva solo como leer la matriz --hoja, columnas y si se cierra al
''' terminar--, que es del libro y no del equipo. Todo lo demas se borra: las
''' demas claves de KCM_CONFIG (la fila entera, no solo el valor), el respaldo
''' oculto de la configuracion, la credencial del llavero o de la variable de
''' usuario, la hoja de estado y las bitacoras locales de acuses y sobrescrituras.
''' Lo que ya se envio a la plataforma no cambia.
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
    ' Descendente: borrar filas reindexa las de abajo.
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

''' Boton Permisos: pide de una vez acceso a las carpetas del equipo y dice cuales
''' siguen sin poder leerse.
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

    ' Los caches se vacian para que el siguiente ciclo lea lo recien guardado sin
    ' reabrir Excel. Es la misma razon por la que toda entrada publica los vacia.
    KcmResetCaches
    KcmPanelEstado hoja
    KcmAvisoHecho "Panel", "Configuracion guardada."
    Exit Sub

GuardarError:
    KcmAvisoFallo "Panel", "La configuracion no se guardo.", Err.Description
End Sub

' ---------------------------------------------------------------- el dibujo

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

''' La hoja tecnica. Si no existe, la instalacion no se ha corrido todavia.
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

    ' Descendente: borrar dentro de una coleccion reindexa lo que falta.
    For indice = hoja.Shapes.Count To 1 Step -1
        Set forma = hoja.Shapes(indice)
        If Left$(forma.Name, Len(BOTON_PREFIJO)) = BOTON_PREFIJO Then forma.Delete
    Next indice

    hoja.Cells.UnMerge
    hoja.Cells.Clear
    hoja.Cells.Interior.Color = COLOR_LIENZO
    ' Sin la reticula, el fondo se lee como una superficie y no como una hoja de
    ' calculo. Es lo que mas acerca el panel a la consola con menos trabajo.
    hoja.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.DisplayHeadings = False
End Sub

' ---------------------------------------------------------------- la pagina
'
' El panel se dibuja como una pagina de la consola: barra de marca, titulo,
' fichas de estado, tarjetas con sus botones y, al final, la configuracion.
' Lo que se hace a diario queda arriba; lo que casi nunca se toca, abajo.
'
' Las filas de la zona superior solo dan el alto: todo lo visible son formas.
' La configuracion si vive en celdas, porque son los campos que se capturan.

''' Texto con acentos a partir de marcas ASCII: {a} {e} {i} {o} {u} {n}, sus
''' mayusculas {A} {E} {I} {O} {U}, y {-} para el punto medio.
'''
''' Los modulos se guardan en ASCII para importarse igual en Windows y en macOS;
''' los acentos se arman al dibujar con ChrW, que no depende de la pagina de codigos.
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

''' Tipografia del panel: la del sistema en cada plataforma.
Public Function KcmPanelFuente() As String
    If KcmEsMac() Then
        KcmPanelFuente = "Helvetica Neue"
    Else
        KcmPanelFuente = "Segoe UI"
    End If
End Function

''' Ancho util de la pagina: de la columna B al final de la D.
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

    ' Barra de marca, de orilla a orilla, como el encabezado de la consola.
    Set barra = hoja.Shapes.AddShape(msoShapeRectangle, 0, 0, _
        hoja.Columns("E").Left + hoja.Columns("E").Width, BARRA_ALTO)
    barra.Name = BOTON_PREFIJO & "BARRA"
    barra.Fill.ForeColor.RGB = COLOR_MARCA
    barra.Line.Visible = msoFalse
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TMARCA", izq, 12, 300, 22, _
        "Plataforma KCM", 16, COLOR_BLANCO, True
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TSUB", izq, 34, 400, 14, _
        KcmAcentos("Cliente de Excel {-} Planta Ecatepec"), 9, COLOR_MARCA_SUAVE, False

    ' Titulo de la pagina.
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TPAG", izq, 76, 400, 26, "Inicio", 18, COLOR_TINTA, True
    KcmPanelRotulo hoja, BOTON_PREFIJO & "TPAGSUB", izq, 102, 500, 14, _
        KcmAcentos("Operaci{o}n del d{i}a desde este libro."), 10, COLOR_APAGADO, False

    ' Encabezado de la configuracion, en celdas: es donde empiezan los campos.
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

''' Las fichas de estado y la pildora de conexion. Se redibujan al cargar y al guardar.
'''
''' No consultan al servidor: todo lo que comprueban esta en este equipo, que es
''' donde estan los fallos frecuentes (direccion vacia, credencial sin registrar,
''' matriz que cambio de carpeta).
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

    ' Pildora de la barra: lo primero que se ve al abrir.
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

''' Retira fichas y pildora antes de volver a dibujarlas (prefijos E y F).
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

''' Una ficha: tarjeta blanca con franja de color. El texto repite el estado:
''' el color nunca va solo.
Private Sub KcmPanelFicha(ByVal hoja As Worksheet, ByVal indice As Long, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal rotulo As String, ByVal valor As String, ByVal color As Long)
    KcmPaginaFicha hoja, BOTON_PREFIJO & "E" & CStr(indice), izquierda, arriba, ancho, _
        rotulo, valor, color
End Sub

''' Pildora de estado en la barra de marca.
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

''' Solo el nombre del archivo. La ruta completa no cabe y no dice mas.
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

''' Los campos de la configuracion: una tabla blanca con un campo de captura por fila.
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

    ' La clave tecnica, apagada y fuera de la tabla: sirve para hablar con soporte.
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

''' Las tarjetas de acciones y los botones de la configuracion.
'''
''' Cada tarjeta es una tarea: titulo, una linea de que hace y sus botones. El
''' boton principal va relleno y los secundarios con contorno, como en la consola.
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

    ' --- Fila 1: lo del dia --------------------------------------------------
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

    ' --- Fila 2: lo de la semana ------------------------------------------------
    ' Un padron o una matriz de mas de 3 MB salen solos en partes: no hay nada que
    ' encender aqui, y el aviso al terminar dice como salio cada envio.
    y = y + TARJETA_ALTO + HUECO_TARJETAS
    KcmPanelTarjeta hoja, "3", izq, y, ancho, TARJETA_ALTO, "Padr{o}n de la semana", _
        "Env{i}a el archivo sem NN CAP.xlsx para su revisi{o}n."
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_PAD", izq + 18, y + TARJETA_ALTO - 52, 190, 34, _
        KcmAcentos("Padr{o}n de la semana"), "KcmPadronDeLaSemana", COLOR_MARCA, 11

    ' --- Fila 3: el equipo ------------------------------------------------------
    y = y + TARJETA_ALTO + HUECO_TARJETAS
    KcmPanelTarjeta hoja, "5", izq, y, ancho, TARJETA_EQUIPO_ALTO, "Este equipo", _
        "Conexi{o}n del libro con la plataforma."
    ' Cinco botones en una fila: los cuatro del equipo a la izquierda y la
    ' plataforma a la derecha, con 8 puntos entre cada uno.
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

    ' --- Configuracion: guardar y vaciar, a la derecha del titulo ---------------
    y = hoja.Rows(FILA_PRIMER_CAMPO - 4).Top + 2
    KcmPintarBoton hoja, BOTON_PREFIJO & "B_GUAR", izq + ancho - 120, y, 120, 30, _
        "Guardar", "KcmPanelGuardar", COLOR_MARCA, 10
    KcmPintarBotonSecundario hoja, BOTON_PREFIJO & "B_REC", izq + ancho - 250, y, 120, 30, _
        "Vaciar", "KcmPanelVaciar"
End Sub

''' Tarjeta blanca con titulo y una linea de descripcion. Los botones van encima.
Private Sub KcmPanelTarjeta(ByVal hoja As Worksheet, ByVal clave As String, _
    ByVal izquierda As Double, ByVal arriba As Double, ByVal ancho As Double, _
    ByVal alto As Double, ByVal titulo As String, ByVal descripcion As String)
    KcmPaginaTarjeta hoja, BOTON_PREFIJO & "C" & clave, izquierda, arriba, ancho, alto, _
        titulo, descripcion
End Sub

''' Tarjeta blanca con titulo y una linea de descripcion. Los botones van encima.
'''
''' Publica porque KCM_CONFIG y KCM_ESTADO se arman con las mismas tarjetas que el
''' panel. Titulo y descripcion llegan con marcas de acento y se resuelven aqui.
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

' Dos renglones con formato distinto en una misma forma. Se formatea por rango de
' caracteres y no por parrafo: un salto de linea no siempre abre un parrafo nuevo en
' Office, y pedir el segundo parrafo cuando no existe detiene el dibujo.
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

''' Texto suelto sobre la pagina, sin fondo ni borde.
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

''' Esquinas redondeadas. Algunas versiones de Excel no exponen el ajuste: sin el,
''' la forma queda con su radio de omision y el dibujo sigue.
Public Sub KcmPanelRedondeo(ByVal forma As Shape, ByVal radio As Single)
    On Error Resume Next
    forma.Adjustments.Item(1) = radio
    On Error GoTo 0
End Sub

''' El pintor de botones del cliente. Lo usan las dos superficies.
'''
''' Antes cada hoja dibujaba el suyo, y de ahi salieron dos botones distintos
''' para la misma accion. Aqui vive la unica definicion de que es un boton en
''' este libro: rectangulo redondeado, degradado vertical del color hacia una
''' version mas oscura de si mismo, sombra baja, y el rotulo en blanco centrado.
'''
''' El degradado y la sombra van bajo `On Error Resume Next` a proposito. Son lo
''' unico decorativo de la rutina y no todas las compilaciones de Excel para Mac
''' aceptan las mismas propiedades de sombra; si alguna falta, el boton se queda
''' en relleno plano, que es exactamente lo que habia antes, y sigue funcionando.
''' Un adorno nunca debe poder impedir que se dibuje el boton.
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
    ' Sin el nombre del libro delante: una copia renombrada romperia el vinculo.
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

' Boton secundario: fondo blanco, contorno y texto en el azul de marca, como los
' botones de contorno de la consola.
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

''' La sombra baja y difusa de la consola, traida a las formas de Excel.
'''
''' Es lo que separa una tarjeta blanca de un fondo casi blanco y lo que hace que
''' un boton parezca pulsable en vez de pintado. Toda la rutina va bajo
''' `On Error Resume Next`: es adorno, y ninguna de sus propiedades vale un fallo.
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

''' Existencia sin abrir el archivo.
'''
''' Delega en el puerto de plataforma en vez de llamar a `GetAttr` aqui, porque
''' en macOS mirar un archivo fuera de la caja de arena de Excel exige antes una
''' concesion del sistema: sin ella `GetAttr` falla y el panel diria que la
''' matriz no esta donde si esta. El puerto concede una sola vez por ruta y por
''' sesion, y solo cuando de verdad hace falta.
Private Function KcmPanelExiste(ByVal ruta As String) As Boolean
    KcmPanelExiste = KcmRutaExiste(ruta)
End Function

' ---------------------------------------------------------------- utilidades

Private Function KcmPanelTotalCampos() As Long
    KcmPanelTotalCampos = UBound(Split(CAMPOS, ";")) + 1
End Function

Private Function KcmPanelCampo(ByVal indice As Long) As String
    Dim partes As Variant
    partes = Split(CAMPOS, ";")
    KcmPanelCampo = CStr(partes(indice))
End Function

''' Parte n de una definicion separada por barras. `numero` empieza en 1.
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

''' Escribe la clave en su fila, o la agrega al final si el libro es de una
''' instalacion anterior que no la tenia. Nunca duplica: una clave repetida hace
''' fallar `KcmConfigMap` entero.
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

''' Que esta mal en un valor, o cadena vacia si esta bien.
'''
''' Solo se valida lo que se puede afirmar sin salir del equipo y lo que se ha
''' visto fallar de verdad: la ruta pegada con comillas desde el explorador de
''' Windows, la columna escrita como numero en vez de letra, y la bandera con un
''' valor que no es TRUE ni FALSE, que `KcmConfigFlag` rechaza cerrado.
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

' ------------------------------------------------- lo que KCM_CONFIG consulta
'
' La hoja tecnica rotula y revisa sus claves con las mismas definiciones y las
' mismas reglas que el panel. Viven una sola vez, aqui; estas tres funciones son
' la unica puerta hacia ellas.

''' Las claves que el panel conoce, en el orden del panel.
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

''' Rotulo y ayuda de una clave, ya con acentos, o cadena vacia si el panel no la conoce.
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

''' Que esta mal en un valor, con las mismas reglas con que el panel valida al guardar.
Public Function KcmPanelRevisarValor(ByVal clave As String, ByVal valor As String) As String
    KcmPanelRevisarValor = KcmPanelProblema(clave, valor)
End Function

' ------------------------------------------------ piezas de pagina compartidas
'
' Las hojas que se leen (el panel, las liberaciones y el estado) se dibujan con las
' mismas piezas: barra de marca, titulo, fichas y botones. Viven aqui para que las
' tres digan lo mismo con el mismo aspecto.

''' Barra de marca de orilla a orilla y titulo de la pagina debajo.
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

''' Ficha de estado: tarjeta blanca con franja de color, rotulo pequeno y valor.
''' La franja se llama como la ficha con "_F" al final.
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

''' Trae la hoja al frente con aspecto de pagina: sin cuadricula ni encabezados.
Public Sub KcmPaginaVentana(ByVal hoja As Worksheet)
    hoja.Activate
    ActiveWindow.DisplayGridlines = False
    ActiveWindow.DisplayHeadings = False
End Sub

''' Borra las formas de una hoja cuyo nombre empieza con `prefijo`.
Public Sub KcmPaginaBorrar(ByVal hoja As Worksheet, ByVal prefijo As String)
    Dim indice As Long

    For indice = hoja.Shapes.Count To 1 Step -1
        If Left$(hoja.Shapes(indice).Name, Len(prefijo)) = prefijo Then hoja.Shapes(indice).Delete
    Next indice
End Sub

''' Estado como etiqueta: texto blanco en negrita sobre el color del estado.
Public Sub KcmPaginaEtiqueta(ByVal celda As Range, ByVal texto As String, ByVal color As Long)
    celda.Value2 = texto
    celda.Interior.Color = color
    celda.Font.Color = COLOR_BLANCO
    celda.Font.Bold = True
    celda.Font.Size = 8
    celda.HorizontalAlignment = xlCenter
    celda.VerticalAlignment = xlCenter
End Sub

''' Renglon de tabla: fondo blanco y una linea fina abajo, como las tablas de la consola.
Public Sub KcmPaginaRenglon(ByVal rango As Range)
    rango.Interior.Color = COLOR_BLANCO
    With rango.Borders(xlEdgeBottom)
        .LineStyle = xlContinuous
        .Weight = xlThin
        .Color = COLOR_LIENZO
    End With
End Sub

''' Encabezado de tabla: rotulos pequenos en gris sobre blanco.
Public Sub KcmPaginaEncabezadoDeTabla(ByVal rango As Range)
    KcmPaginaRenglon rango
    rango.Font.Size = 8
    rango.Font.Bold = True
    rango.Font.Color = COLOR_APAGADO
    rango.VerticalAlignment = xlCenter
    rango.IndentLevel = 1
End Sub
