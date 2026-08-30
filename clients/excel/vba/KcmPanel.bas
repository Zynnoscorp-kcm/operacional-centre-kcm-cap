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
'    mano, Recargar lo trae; nada se sincroniza solo, porque un guardado
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
Public Const COLOR_APAGADO As Long = 8743770       ' #5A6B85
Public Const COLOR_LIENZO As Long = 16249326       ' #EEF1F7
Public Const COLOR_BLANCO As Long = 16777215       ' #FFFFFF
Public Const COLOR_OK As Long = 4878354            ' #12704A
Public Const COLOR_AVISO As Long = 22170           ' #9A5600
Public Const COLOR_ALERTA As Long = 1975987        ' #B3261E

Private Const BOTON_PREFIJO As String = "KCMP_"
Private Const FILA_PRIMER_CAMPO As Long = 8

' Cada campo del panel: la clave que lee el cliente, su rotulo y su ayuda.
' El orden de este arreglo es el orden de la hoja.
Private Const CAMPOS As String = _
    "ENDPOINT|Direccion de la plataforma|La URL del puente, con https. Termina en /api/v1/vba-bridge;" & _
    "CLIENT_ID|Identificador de este equipo|El que aparece en la credencial emitida en la pantalla Conexion Excel;" & _
    "MATRIX_PATH|Archivo de la matriz|Ruta completa del .xlsb maestro. Si el libro cambia de carpeta, se corrige aqui;" & _
    "ROSTER_PATH|Archivo del padron semanal|Ruta completa del sem NN CAP.xlsx. Cambia cada lunes: revisela antes de barrer;" & _
    "MATRIX_SHEET|Hoja de la matriz|Nombre de la hoja que contiene el historial. Normalmente HC;" & _
    "EMPLOYEE_COLUMN|Columna del numero de trabajador|Letra de la columna con el numero de cinco digitos;" & _
    "FIRST_COURSE_COLUMN|Primera columna de cursos|Letra donde empieza el bloque de fechas de capacitacion;" & _
    "LAST_COURSE_COLUMN|Ultima columna de cursos|Letra donde termina ese bloque. Recortarlo retira fechas al aplicar;" & _
    "CLOSE_MASTER_AFTER_CYCLE|Cerrar la matriz al terminar|TRUE o FALSE. Con TRUE el ciclo deja el maestro cerrado"

' ---------------------------------------------------------------- entradas

''' Crea o rehace el panel y lo deja cargado con lo que hay en KCM_CONFIG.
'''
''' Es idempotente: borra sus propias formas por prefijo antes de dibujar, de
''' modo que ejecutarlo dos veces no acumula botones ni duplica asignaciones.
Public Sub KcmAbrirPanel()
    Dim hoja As Worksheet

    On Error GoTo PanelError

    Set hoja = KcmPanelHoja()
    KcmPanelLimpiar hoja
    KcmPanelEncabezado hoja
    KcmPanelCampos hoja
    KcmPanelBotones hoja
    KcmPanelCargar
    hoja.Activate
    hoja.Range("A1").Select
    Exit Sub

PanelError:
    MsgBox "No se pudo dibujar el panel: " & Err.Description, vbCritical
End Sub

''' Trae a la vista lo que hoy tiene KCM_CONFIG.
'''
''' Lee la hoja tecnica directamente y no `KcmConfigValue`, por dos razones: una
''' clave vacia es normal en una instalacion nueva y `KcmConfigValue` la trata
''' como error, y el panel debe poder mostrar KCM_CONFIG aunque este a medio
''' llenar, que es justo cuando mas falta hace.
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
    MsgBox "No se pudo leer la configuracion: " & Err.Description, vbExclamation
End Sub

''' Escribe el panel en KCM_CONFIG. Es el unico punto donde el panel manda.
'''
''' Valida antes de escribir y no despues: una ruta con comillas de Windows o una
''' columna que no es una letra se detectan aqui, mientras corregirlas cuesta un
''' campo, y no dentro de un ciclo a medio correr.
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
            MsgBox KcmPanelParte(KcmPanelCampo(indice), 2) & ": " & problema, vbExclamation
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
    MsgBox "Configuracion guardada en " & KCM_CONFIG_SHEET & ".", vbInformation
    Exit Sub

GuardarError:
    MsgBox "No se pudo guardar: " & Err.Description, vbCritical
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
        "Falta la hoja " & KCM_CONFIG_SHEET & ". Pulse Reparar instalacion antes de usar el panel."
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
End Sub

Private Sub KcmPanelEncabezado(ByVal hoja As Worksheet)
    hoja.Columns("A").ColumnWidth = 2
    hoja.Columns("B").ColumnWidth = 34
    hoja.Columns("C").ColumnWidth = 62
    hoja.Columns("D").ColumnWidth = 58
    hoja.Columns("E").ColumnWidth = 2

    ' Banda de marca: el mismo azul del encabezado de la consola.
    hoja.Range("A1:E4").Interior.Color = COLOR_MARCA
    hoja.Range("B2").Value2 = "Plataforma KCM"
    hoja.Range("B2").Font.Size = 20
    hoja.Range("B2").Font.Bold = True
    hoja.Range("B2").Font.Color = COLOR_BLANCO
    hoja.Range("B3").Value2 = "Cliente de Excel - configuracion y cargas"
    hoja.Range("B3").Font.Size = 11
    hoja.Range("B3").Font.Color = COLOR_BLANCO
    hoja.Rows(2).RowHeight = 28
    hoja.Rows(3).RowHeight = 18

    hoja.Range("B6").Value2 = "CONFIGURACION DE ESTE EQUIPO"
    KcmPanelRotuloSeccion hoja.Range("B6")
    hoja.Range("C6").Value2 = "Valor"
    KcmPanelRotuloSeccion hoja.Range("C6")
    hoja.Range("D6").Value2 = "Que es"
    KcmPanelRotuloSeccion hoja.Range("D6")
End Sub

Private Sub KcmPanelRotuloSeccion(ByVal celda As Range)
    celda.Font.Size = 9
    celda.Font.Bold = True
    celda.Font.Color = COLOR_APAGADO
End Sub

Private Sub KcmPanelCampos(ByVal hoja As Worksheet)
    Dim indice As Long
    Dim total As Long
    Dim fila As Long
    Dim definicion As String

    total = KcmPanelTotalCampos()

    For indice = 0 To total - 1
        definicion = KcmPanelCampo(indice)
        fila = FILA_PRIMER_CAMPO + indice

        hoja.Cells(fila, 2).Value2 = KcmPanelParte(definicion, 2)
        hoja.Cells(fila, 2).Font.Bold = True
        hoja.Cells(fila, 2).Font.Color = COLOR_TINTA
        hoja.Cells(fila, 2).Font.Size = 11

        ' La celda de captura se ve como un campo y no como una celda: fondo
        ' blanco sobre el lienzo gris y un filo en el azul de marca.
        With hoja.Cells(fila, 3)
            .Interior.Color = COLOR_BLANCO
            .Font.Color = COLOR_TINTA
            .Font.Size = 11
            .HorizontalAlignment = xlLeft
            .IndentLevel = 1
        End With
        KcmPanelBorde hoja.Cells(fila, 3)

        hoja.Cells(fila, 4).Value2 = KcmPanelParte(definicion, 3)
        hoja.Cells(fila, 4).Font.Color = COLOR_APAGADO
        hoja.Cells(fila, 4).Font.Size = 9
        hoja.Cells(fila, 4).WrapText = True
        hoja.Cells(fila, 4).VerticalAlignment = xlTop

        hoja.Rows(fila).RowHeight = 26
    Next indice

    ' La clave tecnica queda a la vista pero apagada: quien tenga que hablar con
    ' soporte necesita poder nombrarla, y quien no, no la lee.
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
            .Color = COLOR_MARCA
        End With
    Next lado
End Sub

''' Los botones, agrupados por lo que hacen.
'''
''' El orden importa y no es alfabetico: es el de una jornada. Primero se conecta
''' el equipo, luego se revisa, luego se carga y al final se reciben las
''' liberaciones. Los de la fila de cargas van en el mismo tono porque son la
''' misma decision tomada tres veces; el de transmitir va en tono de aviso porque
''' aplica sin que nadie revise nada.
Private Sub KcmPanelBotones(ByVal hoja As Worksheet)
    Dim fila As Long
    Dim tope As Double

    fila = FILA_PRIMER_CAMPO + KcmPanelTotalCampos() + 1

    hoja.Cells(fila, 2).Value2 = "ACCIONES"
    KcmPanelRotuloSeccion hoja.Cells(fila, 2)
    tope = hoja.Cells(fila + 1, 2).Top

    KcmPanelGrupo hoja, tope, 0, "Configuracion", _
        "Guardar cambios|KcmPanelGuardar|" & CStr(COLOR_MARCA) & ";" & _
        "Recargar|KcmPanelCargar|" & CStr(COLOR_APAGADO) & ";" & _
        "Conectar este equipo|KcmAsistenteConexion|" & CStr(COLOR_MARCA_OSCURA)

    KcmPanelGrupo hoja, tope, 1, "Revisar y cargar", _
        "Verificar matriz|KcmVerificarMatriz|" & CStr(COLOR_MARCA_OSCURA) & ";" & _
        "Barrer matriz|KcmBarrerMatriz|" & CStr(COLOR_MARCA) & ";" & _
        "Transmitir y aplicar|KcmTransmitirMatriz|" & CStr(COLOR_AVISO)

    KcmPanelGrupo hoja, tope, 2, "Liberaciones", _
        "Consultar pendientes|KcmCheckPendingReleases|" & CStr(COLOR_MARCA_OSCURA) & ";" & _
        "Recibir lotes de fechas|KcmApplyPendingReleases|" & CStr(COLOR_MARCA)

    KcmPanelGrupo hoja, tope, 3, "Vigilancia y mantenimiento", _
        "Vigilar barridos|KcmIniciarVigilancia|" & CStr(COLOR_MARCA_OSCURA) & ";" & _
        "Detener vigilancia|KcmDetenerVigilancia|" & CStr(COLOR_APAGADO) & ";" & _
        "Probar este equipo|KcmAutoprueba|" & CStr(COLOR_MARCA_OSCURA) & ";" & _
        "Reparar instalacion|KcmInstallBridge|" & CStr(COLOR_APAGADO)
End Sub

Private Sub KcmPanelGrupo(ByVal hoja As Worksheet, ByVal tope As Double, _
    ByVal grupo As Long, ByVal titulo As String, ByVal definicion As String)
    Dim partes As Variant
    Dim indice As Long
    Dim izquierda As Double
    Dim arriba As Double
    Dim campos As Variant
    Dim rotulo As Shape

    arriba = tope + grupo * 62
    izquierda = hoja.Columns("B").Left

    Set rotulo = hoja.Shapes.AddTextbox(msoTextOrientationHorizontal, izquierda, arriba, 260, 14)
    rotulo.Name = BOTON_PREFIJO & "T" & CStr(grupo)
    rotulo.Line.Visible = msoFalse
    rotulo.Fill.Visible = msoFalse
    With rotulo.TextFrame2.TextRange
        .Text = titulo
        .Font.Size = 9
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_APAGADO
    End With

    partes = Split(definicion, ";")
    For indice = LBound(partes) To UBound(partes)
        campos = Split(CStr(partes(indice)), "|")
        KcmPanelBoton hoja, izquierda + indice * 178, arriba + 18, _
            CStr(campos(0)), CStr(campos(1)), CLng(Val(CStr(campos(2)))), grupo, indice
    Next indice
End Sub

Private Sub KcmPanelBoton(ByVal hoja As Worksheet, ByVal izquierda As Double, _
    ByVal arriba As Double, ByVal etiqueta As String, ByVal macro As String, _
    ByVal color As Long, ByVal grupo As Long, ByVal indice As Long)
    Dim forma As Shape

    Set forma = hoja.Shapes.AddShape(msoShapeRoundedRectangle, izquierda, arriba, 168, 32)
    forma.Name = BOTON_PREFIJO & CStr(grupo) & "_" & CStr(indice)
    forma.Fill.ForeColor.RGB = color
    forma.Line.Visible = msoFalse
    ' Sin el nombre del libro delante: una copia renombrada romperia el vinculo.
    forma.OnAction = macro
    With forma.TextFrame2.TextRange
        .Text = etiqueta
        .Font.Size = 10
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_BLANCO
    End With
    forma.TextFrame2.VerticalAnchor = msoAnchorMiddle
    forma.TextFrame2.HorizontalAnchor = msoAnchorCenter
    forma.TextFrame2.WordWrap = msoTrue
End Sub

' ---------------------------------------------------------------- el estado

''' La linea de estado bajo la banda: si el equipo puede operar o que le falta.
'''
''' No consulta al servidor. Preguntar cuesta una llamada por dibujo y el panel se
''' redibuja al cargar y al guardar; lo que se comprueba aqui es lo que se puede
''' comprobar sin salir del equipo, que es donde estan los fallos frecuentes: la
''' direccion vacia, la ruta a un archivo que no existe, el token sin declarar.
Private Sub KcmPanelEstado(ByVal hoja As Worksheet)
    Dim faltan As String
    Dim rutaMatriz As String
    Dim rutaPadron As String
    Dim config As Worksheet

    Set config = KcmPanelConfigHoja()

    If Len(KcmPanelLeerClave(config, "ENDPOINT")) = 0 Then
        faltan = faltan & "la direccion de la plataforma, "
    End If
    If Len(KcmCredencialLeer()) = 0 Then
        faltan = faltan & "la credencial en " & KcmCredencialDonde() & ", "
    End If

    rutaMatriz = KcmPanelLeerClave(config, "MATRIX_PATH")
    If Len(rutaMatriz) = 0 Then
        faltan = faltan & "la ruta de la matriz, "
    ElseIf Not KcmPanelExiste(rutaMatriz) Then
        faltan = faltan & "la matriz no esta en la ruta indicada, "
    End If

    rutaPadron = KcmPanelLeerClave(config, "ROSTER_PATH")
    If Len(rutaPadron) > 0 Then
        If Not KcmPanelExiste(rutaPadron) Then
            faltan = faltan & "el padron no esta en la ruta indicada, "
        End If
    End If

    hoja.Range("B4:D4").Merge
    hoja.Range("B4").Font.Size = 10
    hoja.Range("B4").Font.Bold = True
    hoja.Range("B4").Font.Color = COLOR_BLANCO

    If Len(faltan) = 0 Then
        hoja.Range("B4").Value2 = "Listo para operar. Ultima comprobacion " & _
            Format$(Now, "yyyy-mm-dd hh:nn")
        hoja.Range("A4:E4").Interior.Color = COLOR_OK
    Else
        hoja.Range("B4").Value2 = "Falta: " & Left$(faltan, Len(faltan) - 2)
        hoja.Range("A4:E4").Interior.Color = COLOR_ALERTA
    End If
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
                KcmPanelProblema = "escriba TRUE o FALSE."
            End If
        End If
        Exit Function
    End If

    If clave = "EMPLOYEE_COLUMN" Or clave = "FIRST_COURSE_COLUMN" Or clave = "LAST_COURSE_COLUMN" Then
        If Len(valor) > 0 Then
            If Not KcmPanelEsLetraDeColumna(valor) Then
                KcmPanelProblema = "use la letra de la columna, por ejemplo B o AJ."
            End If
        End If
        Exit Function
    End If

    If clave = "MATRIX_PATH" Or clave = "ROSTER_PATH" Then
        If InStr(1, valor, """") > 0 Then
            KcmPanelProblema = "quite las comillas: el explorador de archivos las agrega al copiar."
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
