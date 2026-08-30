Attribute VB_Name = "KcmMatrixPanel"
Option Explicit

' Panel visual de la matriz.
'
' Aditivo a proposito, como KcmConfigButtons: no modifica ninguna rutina
' existente y puede quitarse sin afectar el ciclo. No implementa logica propia
' de matriz; encadena las entradas ya depuradas de KcmBridgeCore, KcmBridgeHttp
' y KcmMatrixSync, y deja constancia de cada etapa en una hoja visible.
'
' El motivo es que KcmTransmitMatrixSnapshot hace seis cosas seguidas y solo
' habla al final. Cuando falla, el operador ve un mensaje y no sabe en cual de
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

Private Const MODO_VERIFICAR As Long = 0
Private Const MODO_BARRIDO As Long = 1
Private Const MODO_TRANSMITIR As Long = 2

''' Etapas 1 a 5: configuracion, credencial, archivo maestro, forma de la hoja y
''' conexion. Solo lee. Es la que conviene pulsar cuando algo se ve raro.
Public Sub KcmVerificarMatriz()
    KcmPanelCorrer MODO_VERIFICAR, False
End Sub

''' Las cinco comprobaciones y la entrega del snapshot para revision. No aplica
''' nada. `silencioso` lo usa el vigilante de ordenes, que corre sin nadie
''' delante y no puede quedarse esperando un cuadro de dialogo.
Public Sub KcmBarrerMatriz(Optional ByVal silencioso As Boolean = False)
    KcmPanelCorrer MODO_BARRIDO, silencioso
End Sub

''' Las cinco comprobaciones y, si todas pasan, la transmision del snapshot.
Public Sub KcmTransmitirMatriz()
    KcmPanelCorrer MODO_TRANSMITIR, False
End Sub

Private Sub KcmPanelCorrer(ByVal modo As Long, ByVal silencioso As Boolean)
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

    On Error GoTo PanelError
    abierto = False

    KcmResetCaches
    If modo = MODO_TRANSMITIR Then
        KcmPanelAbrir "Verificacion y transmision de la matriz"
    ElseIf modo = MODO_BARRIDO Then
        KcmPanelAbrir "Barrido de la matriz (entrega para revision, no aplica)"
    Else
        KcmPanelAbrir "Verificacion de la matriz (no transmite nada)"
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
        KcmPanelPaso "1. Configuracion", KCM_PANEL_FALLO, _
            "Faltan claves en " & KCM_CONFIG_SHEET & ":" & faltantes
        KcmPanelCerrar "Complete " & KCM_CONFIG_SHEET & " y vuelva a ejecutar.", False
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
            "No hay credencial guardada en " & KcmCredencialDonde() & _
            ". Emitala en /excel y guardela con el boton Conectar este equipo"
        KcmPanelCerrar "Configure la credencial y vuelva a ejecutar.", False
        GoTo PanelFin
    End If
    KcmPanelPaso "2. Credencial", KCM_PANEL_OK, _
        "Credencial presente en " & KcmCredencialDonde() & ", " & CStr(Len(token)) & _
        " caracteres. El valor no se muestra"

    ' --- 3. Archivo maestro ----------------------------------------------
    problema = KcmLocalFileProblem(rutaMatriz)
    If Len(problema) > 0 Then
        KcmPanelPaso "3. Archivo maestro", KCM_PANEL_FALLO, "MATRIX_PATH: " & problema
        KcmPanelCerrar "Corrija MATRIX_PATH en " & KCM_CONFIG_SHEET & ".", False
        GoTo PanelFin
    End If

    Application.StatusBar = "KCM: abriendo la matriz en solo lectura"
    Set master = KcmOpenMaster(True)
    abierto = True
    If Not master.Saved Then
        KcmPanelPaso "3. Archivo maestro", KCM_PANEL_FALLO, _
            "El libro tiene cambios sin guardar; la huella no describiria lo que se transmite"
        KcmPanelCerrar "Guarde la matriz y vuelva a ejecutar.", False
        GoTo PanelFin
    End If

    ' La huella recorre el archivo completo por bloques de un megabyte: en una
    ' matriz grande es la etapa mas lenta y conviene anunciarla antes.
    Application.StatusBar = "KCM: calculando la huella SHA-256 del libro"
    huella = KcmFileSha256(master.FullName)
    KcmPanelPaso "3. Archivo maestro", KCM_PANEL_OK, _
        master.Name & ", " & Format$(FileLen(master.FullName) / 1048576, "0.0") & _
        " MB, huella " & Left$(huella, 16)

    ' --- 4. Forma de la hoja ---------------------------------------------
    ' Armar el snapshot ES la comprobacion: KcmBuildHcSnapshot valida celdas
    ' combinadas, cursos fuera del rango declarado, celdas de error, numeros de
    ' trabajador duplicados o invalidos y fechas ilegibles, y nombra la celda
    ' exacta cuando algo no cuadra. Nada de esto sale de la maquina.
    Application.StatusBar = "KCM: leyendo la hoja y armando el snapshot"
    snapshot = KcmBuildHcSnapshot(master, huella)
    trabajadores = KcmPanelNumeroJson(snapshot, "employeeCount")
    cursos = KcmPanelNumeroJson(snapshot, "courseCount")
    fechas = KcmPanelNumeroJson(snapshot, "completionCount")
    KcmPanelPaso "4. Forma de la hoja", KCM_PANEL_OK, _
        Format$(trabajadores, "#,##0") & " trabajadores, " & Format$(cursos, "#,##0") & _
        " cursos y " & Format$(fechas, "#,##0") & " fechas de capacitacion. Snapshot de " & _
        Format$(Len(snapshot) / 1048576, "0.00") & " MB"

    If trabajadores = 0 Or fechas = 0 Then
        KcmPanelPaso "4. Forma de la hoja", KCM_PANEL_AVISO, _
            "El libro se leyo sin error pero viene practicamente vacio. Revise que la hoja " & _
            "no tenga un filtro puesto ni el rango de cursos recortado antes de transmitir"
    End If

    ' --- 5. Conexion ------------------------------------------------------
    ' STATUS_V1 es la accion de estado del protocolo y comprueba de una vez el
    ' endpoint, el TLS, la credencial y que el servidor responda. Cuesta tres
    ' lecturas en la base, asi que es para pulsar cuando hace falta, no en bucle.
    Application.StatusBar = "KCM: consultando el estado del servidor"
    Set respuesta = KcmHttpPost("STATUS_V1", "")
    KcmPanelPaso "5. Conexion", KCM_PANEL_OK, _
        "El servidor respondio a STATUS_V1 con la credencial de " & KcmConfigValue("CLIENT_ID")

    If modo = MODO_VERIFICAR Then
        KcmPanelCerrar "Verificacion completa. Nada se escribio: para enviar la matriz use " & _
            "el boton Transmitir matriz.", True
        GoTo PanelFin
    End If

    If modo = MODO_BARRIDO Then
        ' --- 6. Barrido ---------------------------------------------------
        ' Mismo snapshot, otra accion. El servidor no aplica: compara contra SQL
        ' y deja la revision en /matriz. El requestId deriva de la huella, de
        ' modo que barrer dos veces el mismo libro produce una sola importacion
        ' si despues se aprueba.
        Application.StatusBar = "KCM: entregando el barrido a la plataforma"
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
                "El barrido contradice " & KcmPanelCampo(respuesta, "conflicts") & " fechas que " & _
                "la plataforma libero en sesion. No podra aplicarse hasta corregir esas celdas"
        End If

        KcmPanelCerrar "Barrido entregado. Nada se escribio: la revision espera aprobacion en " & _
            "la pantalla Barrido de matriz de la plataforma.", True
        GoTo PanelFin
    End If

    ' --- 6. Transmision ---------------------------------------------------
    ' El requestId deriva de la huella del libro, de modo que retransmitir la
    ' misma matriz es un no-op del lado del servidor y no duplica nada.
    Application.StatusBar = "KCM: transmitiendo el snapshot"
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
        KcmPanelPaso "6. Transmision", KCM_PANEL_AVISO, _
            "El barrido retiro " & Format$(retiradas, "#,##0") & " fechas que el maestro ya no " & _
            "trae. Si no esperaba retiros, revise que el libro estuviera completo al transmitir"
    End If

    KcmPanelCerrar "Matriz transmitida y aplicada.", True

PanelFin:
    If abierto Then KcmReleaseMaster
    Application.StatusBar = False
    Exit Sub

PanelError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    KcmPanelPaso "Interrumpido", KCM_PANEL_FALLO, descripcion
    KcmPanelCerrar "El proceso se detuvo. El renglon anterior dice donde.", False
    If abierto Then KcmReleaseMaster
    Application.StatusBar = False
    On Error GoTo 0
    ' Un barrido desatendido no puede abrir un cuadro de dialogo: nadie lo
    ' cerraria y Excel quedaria bloqueado hasta que alguien pasara por el equipo.
    ' El detalle ya quedo escrito en la hoja, que es donde se consulta despues.
    If Not silencioso Then
        MsgBox "La matriz no se completo: " & descripcion & vbCrLf & vbCrLf & _
            "El detalle por etapa quedo en la hoja " & KCM_PANEL_SHEET & ".", vbCritical
    End If
End Sub

''' Crea o vacia la hoja del panel y escribe su encabezado. Es idempotente: la
''' hoja se reutiliza y cada corrida empieza en limpio, de modo que lo que se ve
''' siempre corresponde a la ejecucion en curso y no a una mezcla de dos.
Public Sub KcmPanelAbrir(ByVal titulo As String)
    Dim sheet As Worksheet
    Dim existe As Boolean
    Dim candidata As Worksheet

    For Each candidata In ThisWorkbook.Worksheets
        If StrComp(candidata.Name, KCM_PANEL_SHEET, vbTextCompare) = 0 Then
            Set sheet = candidata
            existe = True
            Exit For
        End If
    Next candidata

    If Not existe Then
        Set sheet = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        sheet.Name = KCM_PANEL_SHEET
    End If

    sheet.Visible = xlSheetVisible
    ' El resumen de la corrida anterior dejo celdas combinadas; sin deshacerlas
    ' primero, el encabezado nuevo cae dentro de una combinacion vieja.
    sheet.Cells.UnMerge
    sheet.Cells.Clear

    sheet.Range("A1").Value2 = titulo
    sheet.Range("A1").Font.Size = 14
    sheet.Range("A1").Font.Bold = True
    sheet.Range("A2").Value2 = "Iniciado " & Format$(Now, "yyyy-mm-dd hh:nn:ss")
    sheet.Range("A2").Font.Color = COLOR_APAGADO

    sheet.Range("A4").Value2 = "ETAPA"
    sheet.Range("B4").Value2 = "ESTADO"
    sheet.Range("C4").Value2 = "DETALLE"
    sheet.Range("D4").Value2 = "HORA"
    sheet.Range("A4:D4").Font.Bold = True
    sheet.Range("A4:D4").Font.Color = COLOR_BLANCO
    sheet.Range("A4:D4").Interior.Color = COLOR_MARCA

    sheet.Columns("A").ColumnWidth = 24
    sheet.Columns("B").ColumnWidth = 12
    sheet.Columns("C").ColumnWidth = 96
    sheet.Columns("D").ColumnWidth = 11
    sheet.Columns("C").WrapText = True

    sheet.Activate
End Sub

''' Escribe una etapa y la deja visible antes de seguir. `DoEvents` es lo que
''' hace que el panel se vea avanzar: sin el, Excel no repinta hasta el final y
''' las seis etapas aparecerian de golpe, que es exactamente lo que se queria
''' evitar.
Public Sub KcmPanelPaso(ByVal etapa As String, ByVal estado As String, ByVal detalle As String)
    Dim sheet As Worksheet
    Dim fila As Long

    Set sheet = ThisWorkbook.Worksheets(KCM_PANEL_SHEET)
    fila = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row + 1
    If fila < 5 Then fila = 5

    sheet.Cells(fila, 1).Value2 = etapa
    sheet.Cells(fila, 2).Value2 = estado
    sheet.Cells(fila, 3).Value2 = detalle
    sheet.Cells(fila, 4).Value2 = Format$(Now, "hh:nn:ss")
    sheet.Cells(fila, 2).Font.Bold = True
    sheet.Cells(fila, 2).Font.Color = KcmPanelColor(estado)
    sheet.Cells(fila, 4).Font.Color = COLOR_APAGADO
    sheet.Rows(fila).VerticalAlignment = xlTop

    Application.StatusBar = "KCM: " & etapa & " " & estado
    DoEvents
End Sub

''' Cierra el panel con una linea de resumen.
Public Sub KcmPanelCerrar(ByVal resumen As String, ByVal correcto As Boolean)
    Dim sheet As Worksheet
    Dim fila As Long

    Set sheet = ThisWorkbook.Worksheets(KCM_PANEL_SHEET)
    fila = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row + 2
    sheet.Cells(fila, 1).Value2 = resumen
    sheet.Range(sheet.Cells(fila, 1), sheet.Cells(fila, 4)).Merge
    sheet.Cells(fila, 1).Font.Bold = True
    If correcto Then
        sheet.Cells(fila, 1).Font.Color = COLOR_OK
    Else
        sheet.Cells(fila, 1).Font.Color = COLOR_ALERTA
    End If
    DoEvents
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
