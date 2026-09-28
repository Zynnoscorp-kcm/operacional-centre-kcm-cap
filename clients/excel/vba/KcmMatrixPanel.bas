Attribute VB_Name = "KcmMatrixPanel"
Option Explicit

' Panel visual de la matriz.
'
' Aditivo a proposito, como KcmConfigButtons: no modifica ninguna rutina
' existente y puede quitarse sin afectar el ciclo. No implementa logica propia
' de matriz; encadena las entradas ya depuradas de KcmBridgeCore, KcmBridgeHttp
' y KcmMatrixSync, y deja constancia de cada etapa en una hoja visible.
'
' El motivo es que la transmision de una sola pieza hacia seis cosas seguidas y
' solo hablaba al final. Cuando falla, el operador ve un mensaje y no sabe en cual de
' las seis se detuvo: si falto el token, si la ruta apunta a OneDrive, si la
' hoja tiene celdas combinadas o si el servidor rechazo la credencial. Aqui cada
' etapa deja su renglon con hora, estado y detalle, de modo que el diagnostico
' se lee en la hoja en lugar de reconstruirse por telefono.
'
' Tres entradas, separadas a proposito:
'
'   KcmVerificarMatriz   etapas 1 a 5. No sale nada del equipo salvo STATUS_V1.
'   KcmBarrerMatriz      las cinco, y entrega el snapshot SIN aplicarlo.
'   KcmTransmitirMatriz  las cinco, y transmite y aplica en la misma llamada.
'
' La separacion no es cosmetica. MATRIX_IMPORT_V1 entra al servidor con alcance
' FULL y se aplica en la misma peticion: lo que no venga en el snapshot se
' retira. Poder comprobar la conexion y la forma del libro sin escribir nada es
' justamente lo que faltaba para transmitir con confianza.
'
' El barrido va un paso mas alla. MATRIX_SCAN_V1 entrega exactamente el mismo
' snapshot, pero el servidor lo compara contra SQL y deja la revision en la
' pantalla Barrido de matriz en lugar de aplicarla: que columnas trae el libro,
' cuantos trabajadores, y que fechas se darian de alta, se corregirian o se
' retirarian. Nadie escribe nada hasta que alguien lo aprueba alli. Es la unica
' forma de ver que retira un alcance completo antes de que lo retire.

Public Const KCM_PANEL_SHEET As String = "KCM_ESTADO"

' Publicos porque KcmPadronSync escribe en el mismo panel. El barrido del padron
' tiene las mismas etapas de comprobacion y merece el mismo renglon por etapa;
' duplicar aqui ochenta lineas de formato habria dado dos paneles que se ven
' distintos sin que nadie lo decidiera.
Public Const KCM_PANEL_OK As String = "CORRECTO"
Public Const KCM_PANEL_AVISO As String = "AVISO"
Public Const KCM_PANEL_FALLO As String = "FALLO"

' Pagina de estado: prefijo de sus formas, fila de titulos de la tabla y geometria
' de la zona de arriba, en puntos. Las filas 1 a 5 solo dan el alto; lo visible
' son formas.
Private Const ESTADO_PREFIJO As String = "KCMS_"
Private Const ESTADO_FILA_TITULOS As Long = 6
Private Const ESTADO_ALTO_FILA As Double = 56.4
Private Const ESTADO_RESULTADO_ARRIBA As Double = 122
Private Const ESTADO_CUENTAS_ARRIBA As Double = 180
Private Const ESTADO_ACCIONES_ARRIBA As Double = 238
Private Const ESTADO_HUECO As Double = 12

' Columna oculta donde la hoja guarda su titulo, subtitulo y resultado, para
' poder redibujarse sin correr nada. Filas 1 a 4.
Private Const ESTADO_COL_DATOS As Long = 8
Private Const ESTADO_EN_CURSO As String = "CURSO"
Private Const ESTADO_TERMINO_BIEN As String = "BIEN"
Private Const ESTADO_TERMINO_MAL As String = "MAL"

Private Const MODO_VERIFICAR As Long = 0
Private Const MODO_BARRIDO As Long = 1
Private Const MODO_TRANSMITIR As Long = 2

''' Etapas 1 a 5: configuracion, credencial, archivo maestro, forma de la hoja y
''' conexion. Solo lee. Es la que conviene pulsar cuando algo se ve raro.
Public Sub KcmVerificarMatriz()
    KcmPanelCorrer MODO_VERIFICAR
End Sub

''' Las cinco comprobaciones y la entrega del snapshot para revision. No aplica
''' nada: la revision queda esperando aprobacion en la pantalla Barrido de matriz.
Public Sub KcmBarrerMatriz()
    KcmPanelCorrer MODO_BARRIDO
End Sub

''' Las cinco comprobaciones y, si todas pasan, la transmision del snapshot.
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

    ' --- 1. Configuracion ------------------------------------------------
    ' Se piden todas con required=False para poder nombrar juntas las que
    ' falten. Pedirlas en modo estricto aborta en la primera y obliga a
    ' descubrir el resto de una en una.
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

    ' --- 2. Credencial ---------------------------------------------------
    ' Se lee igual que KcmHttpPost, por el puerto de plataforma y no por
    ' Environ$: en Windows vive en las variables del usuario, que una variable
    ' creada despues de abrir Excel no refleja en el bloque del proceso, y en
    ' macOS vive en el llavero, donde Environ$ no llega. Nunca se escribe el
    ' valor: solo su longitud.
    token = KcmCredencialLeer()
    If Len(token) = 0 Then
        KcmPanelPaso "2. Credencial", KCM_PANEL_FALLO, _
            "Sin credencial. Se registra con Conectar este equipo"
        KcmPanelCerrar "Falta la credencial.", False
        GoTo PanelFin
    End If
    KcmPanelPaso "2. Credencial", KCM_PANEL_OK, "Credencial registrada"

    ' --- 3. Archivo maestro ----------------------------------------------
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

    ' La huella recorre el archivo completo por bloques de un megabyte: en una
    ' matriz grande es la etapa mas lenta y conviene anunciarla antes.
    Application.StatusBar = "KCM: verificando la matriz..."
    huella = KcmFileSha256(master.FullName)
    KcmPanelPaso "3. Archivo", KCM_PANEL_OK, _
        master.Name & ", " & Format$(FileLen(master.FullName) / 1048576, "0.0") & " MB"

    ' --- 4. Forma de la hoja ---------------------------------------------
    ' Armar el snapshot ES la comprobacion: KcmBuildHcSnapshot valida celdas
    ' combinadas, cursos fuera del rango declarado, celdas de error, numeros de
    ' trabajador duplicados o invalidos y fechas ilegibles, y nombra la celda
    ' exacta cuando algo no cuadra. Nada de esto sale de la maquina.
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

    ' --- 5. Conexion ------------------------------------------------------
    ' STATUS_V1 es la accion de estado del protocolo y comprueba de una vez el
    ' endpoint, el TLS, la credencial y que el servidor responda. Cuesta tres
    ' lecturas en la base, asi que es para pulsar cuando hace falta, no en bucle.
    Application.StatusBar = "KCM: conectando con la plataforma..."
    Set respuesta = KcmHttpPost("STATUS_V1", "")
    KcmPanelPaso "5. Conexion", KCM_PANEL_OK, "Conexion correcta con " & KcmConfigValue("CLIENT_ID")

    If modo = MODO_VERIFICAR Then
        KcmPanelCerrar "Verificacion correcta. No se envio nada.", True
        GoTo PanelFin
    End If

    If modo = MODO_BARRIDO Then
        ' --- 6. Barrido ---------------------------------------------------
        ' Mismo snapshot, otra accion. El servidor no aplica: compara contra SQL
        ' y deja la revision en /matriz. El requestId deriva de la huella, de
        ' modo que barrer dos veces el mismo libro produce una sola importacion
        ' si despues se aprueba.
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

        ' El servidor ya decidio si la revision puede aplicarse. Se repite aqui
        ' porque quien barre desde Excel no siempre es quien mira la pantalla.
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

    ' --- 6. Transmision ---------------------------------------------------
    ' El requestId deriva de la huella del libro, de modo que retransmitir la
    ' misma matriz es un no-op del lado del servidor y no duplica nada.
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

    ' Un barrido completo puede retirar fechas que el maestro ya no trae. Cuando
    ' ocurre se dice aparte y en amarillo: es el unico efecto de esta operacion
    ' que quita informacion, y merece una segunda mirada antes de darse por bueno.
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
    ' El aviso va al final, con la matriz ya cerrada: dice si el envio salio entero o en partes.
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
    ' Los tres modos los dispara una persona desde KCM_CONFIG, asi que siempre
    ' hay alguien para cerrar el cuadro. El detalle por etapa queda ademas
    ' escrito en la hoja, que es donde se consulta despues.
    KcmAvisoFallo "Actualizacion completa", "La actualizacion completa no termino.", _
        descripcion & vbCrLf & vbCrLf & "Detalle por etapa en la hoja " & KCM_PANEL_SHEET & "."
End Sub

''' Abre KCM_ESTADO tal como quedo la ultima vez, sin correr nada.
'''
''' Antes la hoja solo se dibujaba al empezar una verificacion, un barrido o una
''' autoprueba, asi que para ver el aspecto nuevo o volver a leer la ultima
''' ejecucion habia que correr otra. Aqui se redibuja la pagina encima de los
''' renglones que ya estaban: el registro no se toca.
Public Sub KcmAbrirEstado()
    Dim sheet As Worksheet

    On Error GoTo EstadoError
    Application.ScreenUpdating = False
    Set sheet = KcmEstadoHoja()

    ' Una hoja sin datos de pagina es nueva o viene de la version anterior. Esa
    ' version escribia desde la fila 1 y en las columnas A a D: sus renglones no
    ' caben en esta pagina y se quedaban debajo de las formas, encimados con el
    ' titulo y la tabla. No se intenta traducirlos; se empieza en limpio.
    If Not KcmEstadoEsDeEstaVersion(sheet) Then KcmEstadoVaciar sheet

    KcmEstadoDibujar sheet
    Application.ScreenUpdating = True
    sheet.Range("A1").Select
    Exit Sub

EstadoError:
    Application.ScreenUpdating = True
    KcmAvisoFallo "Estado", "No se pudo abrir la hoja de estado.", Err.Description
End Sub

''' Borra el registro y deja la hoja como recien instalada. Pregunta antes.
''' Vacia la hoja de estado sin preguntar; la confirmacion la hizo quien llama.
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

''' Crea o vacia la hoja del panel y escribe su encabezado. Es idempotente: la
''' hoja se reutiliza y cada corrida empieza en limpio, de modo que lo que se ve
''' siempre corresponde a la ejecucion en curso y no a una mezcla de dos.
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

    ' Las cuentas de arriba avanzan con cada etapa: se ve el progreso sin bajar.
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

' ---------------------------------------------------------------- la pagina

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

''' Deja la hoja sin renglones ni formas, con los datos de pagina de "nada corrido".
Private Sub KcmEstadoVaciar(ByVal sheet As Worksheet)
    KcmPaginaBorrar sheet, ESTADO_PREFIJO
    sheet.Cells.UnMerge
    sheet.Cells.Clear
    sheet.Cells.Interior.Color = COLOR_LIENZO
    KcmEstadoGuardar sheet, "Estado de las ejecuciones", _
        KcmAcentos("Aqu{i} queda, etapa por etapa, la {u}ltima verificaci{o}n, barrido o autoprueba."), _
        KcmAcentos("Sin ejecuciones todav{i}a"), ""
End Sub

''' Los datos de la pagina viven en una columna oculta de la propia hoja: asi la
''' pagina se puede redibujar despues sin volver a correr nada.
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

''' Si la hoja la escribio esta version. No basta con mirar la columna oculta: una
''' version intermedia la llenaba y conservaba encima el registro viejo. Esta
''' version nunca escribe en la columna A y siempre pone ETAPA en B6; el formato
''' anterior escribia su titulo en A1 y sus etapas en la columna A.
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

''' Todo lo que no son renglones: columnas, barra, titulo, fichas y botones.
'''
''' Cada cosa tiene su propia franja y ninguna comparte renglon con otra: el ancho
''' de una columna en puntos cambia entre Windows y macOS y con la fuente, asi que
''' dos piezas en la misma franja, una anclada a la izquierda y otra a la derecha,
''' se enciman en cuanto la hoja sale mas angosta de lo que se calculo.
'''
'''   barra de marca         0 a 58, con los botones de navegacion a la derecha
'''   titulo y subtitulo    72 a 112
'''   resultado            122 a 168, de orilla a orilla
'''   cuentas              180 a 226, tres fichas iguales
'''   acciones             238 a 270
'''   tabla                desde 282
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

    ' Navegacion dentro de la barra, a la derecha: no compite con el titulo.
    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "N0", anchoTotal - 16 - 130, 13, 130, 32, _
        "Volver al panel", "KcmAbrirPanel"
    KcmPintarBotonSecundario sheet, ESTADO_PREFIJO & "N1", anchoTotal - 16 - 270, 13, 130, 32, _
        "Ver liberaciones", "KcmEntradasAbrir"

    KcmEstadoFichas sheet
    KcmEstadoAcciones sheet
    KcmPaginaVentana sheet
End Sub

''' Resultado y cuentas por estado. Se redibujan con cada etapa y al cerrar.
'''
''' El resultado va solo en su franja y de orilla a orilla: es la frase mas larga
''' de la pagina y en una ficha angosta se partia en dos renglones y se salia.
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

''' Una cuenta en cero no llama la atencion: va en gris y no en su color.
Private Function KcmEstadoColorCuenta(ByVal cuenta As Long, ByVal color As Long) As Long
    If cuenta > 0 Then
        KcmEstadoColorCuenta = color
    Else
        KcmEstadoColorCuenta = COLOR_APAGADO
    End If
End Function

''' La barra de acciones: las comprobaciones que no envian nada, y limpiar.
'''
''' Los cuatro botones van seguidos de izquierda a derecha y se reparten el ancho
''' que haya. Si la hoja sale angosta se encogen juntos; nunca se montan.
'''
''' La transmision completa no esta aqui a proposito. Retira lo que la matriz no
''' traiga, y su lugar es la tarjeta del panel, que pregunta antes.
Private Sub KcmEstadoAcciones(ByVal sheet As Worksheet)
    Dim izquierda As Double
    Dim anchoUtil As Double
    Dim escala As Double
    Dim x As Double

    izquierda = sheet.Columns("B").Left
    anchoUtil = sheet.Columns("F").Left - izquierda
    ' 150 + 170 + 170 + 140 de botones y tres huecos de 10.
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

''' Los tres colores del sistema de diseno de la plataforma, para que el panel se
''' lea igual que las pantallas: verde correcto, ambar aviso, rojo fallo.
Private Function KcmPanelColor(ByVal estado As String) As Long
    If estado = KCM_PANEL_OK Then
        KcmPanelColor = COLOR_OK
    ElseIf estado = KCM_PANEL_AVISO Then
        KcmPanelColor = COLOR_AVISO
    Else
        KcmPanelColor = COLOR_ALERTA
    End If
End Function

''' Campo de una respuesta del puente, o "0" si no vino.
Public Function KcmPanelCampo(ByVal respuesta As KcmDiccionario, ByVal clave As String) As String
    If respuesta.Exists(clave) Then
        KcmPanelCampo = CStr(respuesta.Item(clave))
    Else
        KcmPanelCampo = "0"
    End If
End Function

''' Lee un numero del snapshot recien armado. No es un analizador de JSON: sirve
''' porque el productor es KcmJsonNumber, del propio cliente, que siempre escribe
''' la clave entre comillas, dos puntos y el numero sin espacio ni notacion
''' cientifica. Se usa solo para mostrar conteos en el panel; ninguna decision
''' depende de este valor.
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
