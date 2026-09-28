Attribute VB_Name = "KcmEntradas"
Option Explicit

' Subpanel de sesiones entrantes.
'
' Aditivo, como KcmPanel y KcmMatrixPanel: no modifica ninguna rutina existente
' y quitarlo entero deja el ciclo como estaba. Tampoco implementa logica de
' matriz; encadena KcmHttpPost y KcmApplyPendingReleases.
'
' El problema que resuelve es de ceguera. "Consultar pendientes" contesta con un
' numero -"12 liberaciones listas para aplicar"- y "Recibir lotes de fechas"
' aplica las doce. Entre esas dos cosas no habia nada: no se podia ver de que
' sesiones eran, ni escoger. Quien libera en la consola tampoco tenia forma de
' confirmar desde el libro que su sesion habia llegado, salvo aplicarlas todas y
' mirar el resultado.
'
' Aqui cada sesion es un renglon con su codigo, su curso, su fecha y cuantas
' fechas le faltan por escribir. Se marca con una equis la que se quiera recibir
' y el boton escribe solo esas. Sin marcar nada no se escribe nada.
'
' El boton que aplicaba todo lo pendiente de golpe se retiro del panel: lo mismo
' se consigue con "Marcar todas" y "Recibir marcadas", que ensena que se va a
' escribir y pregunta antes. La entrada publica sigue existiendo para el ciclo
' programado, que corre sin nadie delante.
'
' Dos decisiones que no son de estilo:
'
' 1. SE ACTUALIZA PULSANDO. No hay reloj. La vigilancia de barridos existe
'    porque atiende una orden que alguien encargo en la consola y que espera; una
'    liberacion no espera nada del libro hasta que una persona decide escribirla,
'    y consultar cada pocos minutos serian cientos de lecturas al dia contra el
'    presupuesto de la base para contestar casi siempre lo mismo.
' 2. LA LISTA SE ACUMULA. Actualizar no borra lo que ya estaba: mezcla. Una
'    sesion que la plataforma ya no reporta pendiente se marca "Escrita" y se
'    queda a la vista, porque desaparecer en silencio es indistinguible de no
'    haber llegado nunca. Se limpian con el boton de limpiar, no solas.

Public Const KCM_ENTRADAS_SHEET As String = "KCM_ENTRADAS"

Private Const KCM_ENTRADAS_PREFIJO As String = "KCME_"
Private Const KCM_ENTRADAS_FILA_PRIMERA As Long = 8

' Las columnas del renglon. El identificador de sesion va a la derecha y apagado:
' es lo que viaja al filtrar y no lo lee nadie.
Private Const COL_MARCA As Long = 2
Private Const COL_CODIGO As Long = 3
Private Const COL_CURSO As Long = 4
Private Const COL_FECHA As Long = 5
Private Const COL_PENDIENTES As Long = 6
Private Const COL_ESTADO As Long = 7
Private Const COL_SESION As Long = 8

Private Const ESTADO_PENDIENTE As String = "Pendiente"
Private Const ESTADO_ESCRITA As String = "Escrita"

' Geometria de la zona superior, en puntos. Titulo, fichas, botones y tabla van
' a doce puntos uno de otro: las seis filas suman justo lo que ocupan.
Private Const ENTRADAS_ALTO_FILA As Double = 37.5
Private Const ENTRADAS_FICHAS_ARRIBA As Double = 120
Private Const ENTRADAS_ACCIONES_ARRIBA As Double = 178

' ---------------------------------------------------------------- entradas

''' Abre el subpanel, lo redibuja y lo deja recien consultado.
'''
''' Es idempotente: borra sus formas por prefijo antes de dibujar, de modo que
''' abrirlo dos veces no acumula botones. Los renglones si se conservan, que es
''' justo lo que se quiere: la lista es la memoria de lo que ha llegado.
Public Sub KcmEntradasAbrir()
    Dim hoja As Worksheet

    On Error GoTo AbrirError

    ' Actualizar dibuja encabezado y botones; aqui solo se trae la hoja al frente.
    Set hoja = KcmEntradasHoja()
    KcmPaginaVentana hoja
    hoja.Range("A1").Select
    KcmEntradasActualizar
    Exit Sub

AbrirError:
    KcmAvisoFallo "Ver liberaciones", "No se pudo abrir la lista de liberaciones.", Err.Description
End Sub

''' Pregunta a la plataforma que sesiones tienen fechas por escribir y mezcla la
''' respuesta con lo que ya estaba en la hoja.
'''
''' Mezclar y no repintar es lo que hace que la lista sirva de memoria: una
''' sesion que ya se escribio deja de venir en la respuesta, y si el panel se
''' repintara desapareceria sin dejar rastro de que llego alguna vez.
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
    ' Las fichas se dibujan ya, con lo que hay en la hoja: si la consulta falla,
    ' la pagina no se queda con un hueco donde iban.
    KcmEntradasResumen hoja, KcmEntradasContarPendientes(hoja), 0, "Consultando..."
    KcmEntradasBotones hoja

    KcmResetCaches
    Set respuesta = KcmHttpPost("RELEASE_SESSIONS_V1", "")
    Set filas = KcmParseTsv(KcmDecodeResponsePayload(respuesta), _
        Array("sessionId", "sessionCode", "trainingId", "completionDate", "pending"))

    ' Primero se indexa lo que llego, para poder recorrer la hoja una sola vez.
    Set pendientes = KcmNuevoDiccionario()
    For Each fila In filas
        pendientes.AgregarObjeto CStr(fila.Item("sessionId")), fila
    Next fila

    ' Los renglones que ya estaban: los que siguen pendientes se actualizan y los
    ' que la plataforma ya no reporta pasan a Escrita y pierden su marca, para que
    ' un segundo pulso del boton no intente escribirlos otra vez.
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
                hoja.Cells(renglon, COL_MARCA).Value2 = ""
                KcmEntradasPintarEstado hoja, renglon, ESTADO_ESCRITA
            End If
        End If
    Next renglon

    ' Y al final las que no estaban, en el orden en que las devolvio el servidor.
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
    Application.ScreenUpdating = True
    Exit Sub

ActualizarError:
    Dim causa As String
    causa = Err.Description
    Application.ScreenUpdating = True
    On Error Resume Next
    KcmEntradasResumen hoja, KcmEntradasContarPendientes(hoja), 0, "Sin respuesta"
    On Error GoTo 0
    KcmAvisoFallo "Ver liberaciones", "No se pudo actualizar la lista.", causa
End Sub

''' Escribe en la matriz solo las sesiones marcadas con una equis.
'''
''' El filtro se aplica sobre lo que ya se descargo y no sobre lo que se pide: la
''' carga de RELEASE_PULL_V1 llega entera y KcmApplyPendingReleases descarta las
''' filas de las sesiones que nadie marco. Pedir por sesion habria significado una
''' llamada por sesion escogida, y el lote sigue siendo la unidad que se aplica
''' todo o nada.
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
            "Las sesiones se marcan en la primera columna."
        Exit Sub
    End If

    If Not KcmAvisoConfirmar("Escribir en la matriz", _
        "Se escribiran en la matriz las fechas de " & _
        KcmPlural(cuantas, "sesion", "sesiones") & ".") Then Exit Sub

    KcmApplyPendingReleases False, escogidas
    ' Volver a preguntar deja los renglones recien escritos en Escrita sin que
    ' nadie tenga que pulsar dos botones para ver el resultado de uno.
    KcmEntradasActualizar
    Exit Sub

RecibirError:
    KcmAvisoFallo "Escribir en la matriz", _
        "Las sesiones seleccionadas no se escribieron.", Err.Description
End Sub

''' Marca todas las que siguen pendientes. Las escritas no se remarcan.
Public Sub KcmEntradasMarcarTodas()
    Dim hoja As Worksheet
    Dim renglon As Long
    Dim ultima As Long

    On Error GoTo MarcarError

    Set hoja = KcmEntradasHoja()
    ultima = KcmEntradasUltimaFila(hoja)
    For renglon = KCM_ENTRADAS_FILA_PRIMERA To ultima
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_PENDIENTE Then
            hoja.Cells(renglon, COL_MARCA).Value2 = "X"
        End If
    Next renglon
    Exit Sub

MarcarError:
    KcmAvisoFallo "Ver liberaciones", _
        "No se pudieron seleccionar las sesiones pendientes.", Err.Description
End Sub

''' Retira de la lista las sesiones ya escritas. Las pendientes se quedan.
'''
''' Es el equivalente de la equis del tablero de la consola: cuando la lista se
''' llena de escritas deja de servir para ver lo que falta. No se pierde nada:
''' la evidencia de lo que entro a la matriz vive en la plataforma, no aqui.
Public Sub KcmEntradasLimpiar()
    Dim hoja As Worksheet
    Dim renglon As Long
    Dim ultima As Long

    On Error GoTo LimpiarError

    Set hoja = KcmEntradasHoja()
    ultima = KcmEntradasUltimaFila(hoja)
    ' Descendente: borrar un renglon recorre hacia arriba los que faltan.
    For renglon = ultima To KCM_ENTRADAS_FILA_PRIMERA Step -1
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_ESCRITA Then
            hoja.Rows(renglon).Delete
        End If
    Next renglon
    Exit Sub

LimpiarError:
    KcmAvisoFallo "Ver liberaciones", _
        "No se pudieron retirar las sesiones escritas.", Err.Description
End Sub

' ---------------------------------------------------------------- el dibujo

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

' ---------------------------------------------------------------- el dibujo
'
' La hoja es una pagina de la consola: barra de marca, titulo, tres fichas, la
' barra de acciones y la tabla. Las filas 1 a 6 solo dan el alto de la zona de
' arriba; la tabla empieza en la fila 7 y los renglones en la 8, como siempre, para
' que la lista que ya exista en el libro se siga leyendo igual.

Private Sub KcmEntradasEncabezado(ByVal hoja As Worksheet)
    Dim fila As Long
    Dim izquierda As Double
    Dim anchoTotal As Double
    Dim subtitulo As String

    ' La version anterior combinaba celdas y pintaba de azul estas filas.
    hoja.Range("A1:I7").UnMerge
    hoja.Range("A1:I7").Clear
    hoja.Range("A1:I6").Interior.Color = COLOR_LIENZO
    hoja.Cells.Font.Name = KcmPanelFuente()

    hoja.Columns("A").ColumnWidth = 3
    hoja.Columns("B").ColumnWidth = 8
    hoja.Columns("C").ColumnWidth = 22
    hoja.Columns("D").ColumnWidth = 40
    hoja.Columns("E").ColumnWidth = 13
    hoja.Columns("F").ColumnWidth = 13
    hoja.Columns("G").ColumnWidth = 14
    hoja.Columns("H").ColumnWidth = 30
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
    hoja.Cells(7, COL_SESION).Value2 = "IDENTIFICADOR"
    KcmPaginaEncabezadoDeTabla hoja.Range(hoja.Cells(7, COL_MARCA), hoja.Cells(7, COL_SESION))
    hoja.Cells(7, COL_MARCA).HorizontalAlignment = xlCenter
    hoja.Cells(7, COL_PENDIENTES).HorizontalAlignment = xlCenter
    hoja.Cells(7, COL_ESTADO).HorizontalAlignment = xlCenter
End Sub

''' Las tres fichas: cuantas esperan, cuantas llegaron en esta consulta y cuando.
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

''' La barra de acciones. La principal es escribir; lo demas prepara la lista.
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

''' Da forma al renglon completo y pone la etiqueta del estado.
'''
''' Se llama para todo renglon en cada actualizacion, pendiente o escrito, asi que
''' aqui vive el estilo de la fila y no en la escritura de los datos.
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

    ' La marca es la unica celda donde se escribe: se ve como un campo de captura.
    With hoja.Cells(renglon, COL_MARCA)
        .HorizontalAlignment = xlCenter
        .Font.Bold = True
        .Font.Color = COLOR_MARCA
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

' ---------------------------------------------------------------- utilidades

''' La ultima fila con identificador. Se mide por la columna del identificador y
''' no por la del codigo: la marca y el codigo los puede borrar una persona, y el
''' identificador solo lo escribe este modulo.
Private Function KcmEntradasUltimaFila(ByVal hoja As Worksheet) As Long
    Dim ultima As Long

    ultima = hoja.Cells(hoja.Rows.Count, COL_SESION).End(xlUp).Row
    If ultima < KCM_ENTRADAS_FILA_PRIMERA - 1 Then ultima = KCM_ENTRADAS_FILA_PRIMERA - 1
    KcmEntradasUltimaFila = ultima
End Function

''' Cuantos renglones siguen pendientes, contados en la hoja y sin preguntar a nadie.
Private Function KcmEntradasContarPendientes(ByVal hoja As Worksheet) As Long
    Dim renglon As Long

    For renglon = KCM_ENTRADAS_FILA_PRIMERA To KcmEntradasUltimaFila(hoja)
        If KcmEntradasTexto(hoja.Cells(renglon, COL_ESTADO).Value2) = ESTADO_PENDIENTE Then
            KcmEntradasContarPendientes = KcmEntradasContarPendientes + 1
        End If
    Next renglon
End Function

''' Marcada es cualquier cosa escrita en la celda de la marca. Se admite lo que
''' sea -equis, palomita, un uno- porque quien la escribe no tiene por que
''' adivinar el caracter exacto que espera la macro.
Private Function KcmEntradasMarcada(ByVal hoja As Worksheet, ByVal renglon As Long) As Boolean
    KcmEntradasMarcada = Len(KcmEntradasTexto(hoja.Cells(renglon, COL_MARCA).Value2)) > 0
End Function

Private Function KcmEntradasTexto(ByVal valor As Variant) As String
    If IsError(valor) Then Exit Function
    If IsEmpty(valor) Then Exit Function
    KcmEntradasTexto = Trim$(CStr(valor))
End Function
