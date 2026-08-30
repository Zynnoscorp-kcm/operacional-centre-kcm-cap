Attribute VB_Name = "KcmAsistente"
Option Explicit

' Asistente de conexion.
'
' Aditivo, como KcmConfigButtons y KcmMatrixPanel: no modifica ninguna rutina
' existente. Su unico proposito es que la puesta en marcha de un equipo la pueda
' hacer alguien que no conoce Excel ni VBA, sin nadie al lado.
'
' Lo que el procedimiento manual pedia, y que aqui desaparece:
'
'   - Escribir siete claves a mano en KCM_CONFIG, sabiendo que EMPLOYEE_COLUMN
'     es una letra de columna y no un nombre. Ahora cuatro se detectan solas
'     leyendo el libro y se muestran para confirmar.
'   - Teclear la ruta del XLSB. Ahora es un cuadro de Abrir.
'   - Ejecutar `setx KCM_VBA_BRIDGE_TOKEN` en una consola y REABRIR Excel. El
'     asistente guarda la credencial por el puerto de plataforma y queda
'     disponible en el acto, sin reabrir nada: en Windows va a las variables de
'     usuario, que se leen y escriben en vivo en el registro y no en el bloque
'     de entorno del proceso, y en macOS al llavero del sistema. En los dos
'     casos es exactamente de donde KcmHttpPost la toma al enviar.
'
' Corre igual en Windows y en macOS. Lo unico que cambia entre los dos es donde
' queda guardada la credencial, y el asistente lo dice en pantalla en vez de
' suponerlo.
'
' Al final llama a KcmVerificarMatriz, de modo que la instalacion termina con la
' prueba hecha y a la vista en KCM_ESTADO, no con un "deberia funcionar".

' Hasta donde se busca la columna del numero de trabajador y cuantas filas se
' miran para decidir. Sobra: el bloque de identificacion vive al principio.
Private Const ASIS_COLUMNAS As Long = 40
Private Const ASIS_FILAS As Long = 400
' Un numero de trabajador son de uno a cinco digitos. Con menos de estos aciertos
' en una columna no se afirma que sea la del numero: se pregunta.
Private Const ASIS_MINIMO As Long = 8
' Los ocho atributos laborales viven entre el numero de trabajador y los cursos.
Private Const ASIS_ATRIBUTOS As Long = 8

' Cuantas columnas a la derecha del numero de nomina vive la fecha de ingreso. Es el mismo
' desplazamiento que usa el lector de la matriz; aqui sirve para reconocer cual de las columnas
' con numeros es de verdad la del trabajador.
Private Const ASIS_OFFSET_FECHA As Long = 2

''' Puesta en marcha completa de un equipo. Es la unica macro que necesita
''' ejecutar quien instala.
Public Sub KcmAsistenteConexion()
    Dim endpoint As String
    Dim secreto As String
    Dim clienteId As String
    Dim ruta As String
    Dim libro As Workbook
    Dim hoja As String
    Dim colTrabajador As String
    Dim colPrimerCurso As String
    Dim colUltimoCurso As String
    Dim problema As String
    Dim abierto As Boolean
    Dim resumen As String

    On Error GoTo AsistenteError
    abierto = False

    If MsgBox("Este asistente deja el equipo listo para transmitir la matriz." & vbCrLf & _
        "Equipo detectado: " & KcmSistemaOperativo() & "." & vbCrLf & vbCrLf & _
        "Le va a pedir tres cosas de la pantalla /excel de la plataforma:" & vbCrLf & _
        "  1. La direccion del servidor (ENDPOINT)." & vbCrLf & _
        "  2. El identificador del equipo (Client ID)." & vbCrLf & _
        "  3. La credencial, que la plataforma muestra UNA sola vez." & vbCrLf & vbCrLf & _
        "Despues le pedira el archivo de la matriz y el resto lo averigua solo." & vbCrLf & _
        "No escribe nada en la base de datos: al terminar solo comprueba." & vbCrLf & vbCrLf & _
        "Continuar?", vbQuestion + vbOKCancel, "Asistente de conexion KCM") <> vbOK Then Exit Sub

    ' --- Hoja de configuracion -------------------------------------------
    If Not KcmAsistenteHojaConfig() Then
        MsgBox "Falta la hoja " & KCM_CONFIG_SHEET & ". Se va a crear ahora." & vbCrLf & vbCrLf & _
            "Si Excel pide guardar el libro, guardelo como KCM_Bridge.xlsm en el " & _
            "escritorio y vuelva a ejecutar el asistente.", vbInformation, "Asistente KCM"
        KcmInstallBridge
        If Not KcmAsistenteHojaConfig() Then Err.Raise vbObjectError + 7400, "KcmAsistenteConexion", _
            "No se pudo crear la hoja " & KCM_CONFIG_SHEET
    End If

    ' --- 1. Endpoint ------------------------------------------------------
    endpoint = Trim$(InputBox( _
        "Pegue la direccion que muestra la pantalla /excel, en el renglon " & _
        """Endpoint VBA""." & vbCrLf & vbCrLf & _
        "Termina en /api/v1/vba-bridge y empieza con https://", _
        "1 de 4: direccion del servidor", KcmAsistenteValor("ENDPOINT")))
    If Len(endpoint) = 0 Then GoTo AsistenteCancelado
    If Not KcmAsistenteEndpointValido(endpoint) Then
        MsgBox "Esa direccion no sirve." & vbCrLf & vbCrLf & _
            "Debe empezar con https:// (o con http:// solo si es 127.0.0.1 o " & _
            "localhost) y terminar en /api/v1/vba-bridge." & vbCrLf & vbCrLf & _
            "Copiela tal cual de la pantalla /excel y vuelva a ejecutar el asistente.", _
            vbExclamation, "Asistente KCM"
        Exit Sub
    End If

    ' --- 2. Client ID -----------------------------------------------------
    clienteId = Trim$(InputBox( _
        "Escriba el mismo Client ID con el que se emitio la credencial en /excel." & vbCrLf & _
        vbCrLf & "Si no lo cambiaron, es KCM-OFFICE-01.", _
        "2 de 4: identificador del equipo", KcmAsistenteValor("CLIENT_ID")))
    If Len(clienteId) = 0 Then GoTo AsistenteCancelado

    ' --- 3. Credencial ----------------------------------------------------
    ' Se escribe en la variable de usuario y no se guarda en el libro. El cuadro
    ' de entrada la muestra mientras se pega: conviene decirlo antes.
    secreto = Trim$(InputBox( _
        "Pegue la credencial que la plataforma mostro al emitirla." & vbCrLf & vbCrLf & _
        "Se guarda en " & KcmCredencialDonde() & ", no en este libro." & vbCrLf & _
        "Mientras la pega queda a la vista: hagalo sin nadie mirando la pantalla." & vbCrLf & _
        vbCrLf & "Si ya la configuro antes y no la tiene a mano, deje esto vacio " & _
        "y se conservara la que ya estaba.", _
        "3 de 4: credencial"))
    If Len(secreto) > 0 Then
        KcmCredencialGuardar secreto
        secreto = ""
    ElseIf Len(KcmCredencialLeer()) = 0 Then
        MsgBox "No hay ninguna credencial guardada en este equipo y no se pego una." & vbCrLf & _
            vbCrLf & "Emitala en la pantalla /excel y vuelva a ejecutar el asistente.", _
            vbExclamation, "Asistente KCM"
        Exit Sub
    End If

    ' --- 4. Archivo de la matriz ------------------------------------------
    MsgBox "Ahora elija el archivo de la matriz." & vbCrLf & vbCrLf & _
        "Tiene que ser el archivo .xlsb y estar en una carpeta del equipo o de " & _
        "la red. Una direccion web de OneDrive o SharePoint no sirve: si la " & _
        "matriz vive ahi, sincronicela primero y elija la copia local." & vbCrLf & vbCrLf & _
        "En macOS puede aparecer despues un cuadro del sistema pidiendo permiso " & _
        "para ese archivo: concedalo, y no se volvera a preguntar.", _
        vbInformation, "4 de 4: archivo de la matriz"
    ruta = KcmAsistenteElegirArchivo()
    If Len(ruta) = 0 Then GoTo AsistenteCancelado

    problema = KcmLocalFileProblem(ruta)
    If Len(problema) > 0 Then
        MsgBox "Ese archivo no se puede usar: " & problema, vbExclamation, "Asistente KCM"
        Exit Sub
    End If
    If LCase$(Right$(ruta, 5)) <> ".xlsb" Then
        MsgBox "La matriz tiene que ser un archivo .xlsb." & vbCrLf & vbCrLf & _
            "El que eligio es " & Mid$(ruta, InStrRev(ruta, ".")) & _
            ". Si la matriz esta en .xlsx o .xlsm, guardela como .xlsb " & _
            "(Archivo, Guardar como, Libro binario de Excel) y elija esa copia.", _
            vbExclamation, "Asistente KCM"
        Exit Sub
    End If

    ' La ruta se fija antes de detectar para poder abrir el libro con la misma
    ' rutina que usa el ciclo, incluida su forma de reconocer que ya esta abierto.
    KcmAsistenteFijar "ENDPOINT", endpoint
    KcmAsistenteFijar "CLIENT_ID", clienteId
    KcmAsistenteFijar "MATRIX_PATH", ruta
    KcmResetCaches

    ' --- Deteccion --------------------------------------------------------
    Application.StatusBar = "KCM: leyendo la matriz para reconocer su forma"
    Set libro = KcmOpenMaster(True)
    abierto = True
    problema = KcmAsistenteDetectar(libro, hoja, colTrabajador, colPrimerCurso, colUltimoCurso)
    KcmReleaseMaster
    abierto = False
    Application.StatusBar = False

    If Len(problema) > 0 Then
        MsgBox "El asistente no pudo reconocer la forma de la matriz." & vbCrLf & vbCrLf & _
            problema & vbCrLf & vbCrLf & _
            "La conexion quedo configurada; falta decir donde estan las columnas. " & _
            "Pida a quien conoce la matriz que complete MATRIX_SHEET, " & _
            "EMPLOYEE_COLUMN, FIRST_COURSE_COLUMN y LAST_COURSE_COLUMN en la hoja " & _
            KCM_CONFIG_SHEET & ", y ejecute despues Verificar matriz.", _
            vbExclamation, "Asistente KCM"
        KcmInstallButtons
        Exit Sub
    End If

    resumen = "Esto es lo que el asistente encontro en la matriz:" & vbCrLf & vbCrLf & _
        "  Hoja: " & hoja & vbCrLf & _
        "  Numero de trabajador en la columna " & colTrabajador & vbCrLf & _
        "  Cursos de la columna " & colPrimerCurso & " a la " & colUltimoCurso & vbCrLf & vbCrLf & _
        "Si le parece correcto, acepte y se comprobara todo." & vbCrLf & _
        "Si no, cancele: nada se ha transmitido."
    If MsgBox(resumen, vbQuestion + vbOKCancel, "Confirme la forma de la matriz") <> vbOK Then
        GoTo AsistenteCancelado
    End If

    KcmAsistenteFijar "MATRIX_SHEET", hoja
    KcmAsistenteFijar "EMPLOYEE_COLUMN", colTrabajador
    KcmAsistenteFijar "FIRST_COURSE_COLUMN", colPrimerCurso
    KcmAsistenteFijar "LAST_COURSE_COLUMN", colUltimoCurso
    KcmResetCaches

    KcmInstallButtons
    MsgBox "Configuracion lista." & vbCrLf & vbCrLf & _
        "Ahora se va a comprobar la conexion y la matriz, sin transmitir nada. " & _
        "El resultado queda en la hoja " & KCM_PANEL_SHEET & ", una linea por etapa." & _
        vbCrLf & vbCrLf & _
        "Si las cinco etapas salen en CORRECTO, el equipo esta listo.", _
        vbInformation, "Asistente KCM"
    KcmVerificarMatriz
    Exit Sub

AsistenteCancelado:
    If abierto Then KcmReleaseMaster
    Application.StatusBar = False
    MsgBox "Asistente cancelado. No se transmitio nada." & vbCrLf & vbCrLf & _
        "Puede volver a ejecutarlo cuando tenga los datos.", vbInformation, "Asistente KCM"
    Exit Sub

AsistenteError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    If abierto Then KcmReleaseMaster
    Application.StatusBar = False
    On Error GoTo 0
    MsgBox "El asistente se detuvo: " & descripcion, vbCritical, "Asistente KCM"
End Sub

''' Reconoce hoja y columnas leyendo el libro. Devuelve la cadena vacia si lo
''' logro, o la explicacion de lo que no pudo decidir.
'''
''' La deteccion se apoya en dos hechos del formato, no en adivinanzas: un numero
''' de trabajador son de uno a cinco digitos y nada mas, que es la regla que
''' aplica KcmNormalizeEmployeeId, y los ocho atributos laborales viven entre esa
''' columna y la primera de cursos, que es la comprobacion que ya hace
''' KcmBuildHcSnapshot. Con eso, basta encontrar la columna del numero.
Private Function KcmAsistenteDetectar(ByVal libro As Workbook, ByRef hoja As String, _
    ByRef colTrabajador As String, ByRef colPrimerCurso As String, _
    ByRef colUltimoCurso As String) As String
    Dim sheet As Worksheet
    Dim columna As Long
    Dim fila As Long
    Dim aciertos As Long
    Dim conFecha As Long
    Dim columnaConFecha As Long
    Dim mejorConFecha As Long
    Dim mejorColumna As Long
    Dim mejorAciertos As Long
    Dim primeraFila As Long
    Dim ultimaColumna As Long
    Dim vacias As Long
    Dim valores As Variant
    Dim ultimaFilaHoja As Long

    hoja = KcmAsistenteElegirHoja(libro)
    If Len(hoja) = 0 Then
        KcmAsistenteDetectar = "No se eligio ninguna hoja."
        Exit Function
    End If
    Set sheet = libro.Worksheets(hoja)

    ultimaFilaHoja = sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
    If ultimaFilaHoja > ASIS_FILAS Then ultimaFilaHoja = ASIS_FILAS
    If ultimaFilaHoja < 2 Then
        KcmAsistenteDetectar = "La hoja " & hoja & " esta vacia."
        Exit Function
    End If

    ' Una sola lectura en bloque. Celda por celda serian decenas de miles de
    ' llamadas COM para una pregunta que se responde con la region inicial.
    valores = sheet.Range(sheet.Cells(1, 1), sheet.Cells(ultimaFilaHoja, ASIS_COLUMNAS)).Value2

    ' No basta con contar numeros: el consecutivo de la primera columna tambien son numeros de
    ' hasta cinco digitos y le gana al numero de nomina en cualquier matriz que lo tenga. Eso
    ' dejaba EMPLOYEE_COLUMN una columna a la izquierda de donde va, y el ciclo se detenia en la
    ' primera fila leyendo el nombre donde esperaba la fecha de ingreso.
    '
    ' Lo que distingue a la columna correcta es lo que tiene al lado: dos columnas a su derecha
    ' vive la fecha de ingreso. Se cuenta cuantas filas cumplen las dos cosas a la vez y esa
    ' cuenta decide. Si ninguna columna la cumple (una matriz sin fechas de ingreso) se vuelve a
    ' la cuenta simple, que es como se comportaba antes.
    mejorAciertos = 0
    mejorColumna = 0
    mejorConFecha = 0
    columnaConFecha = 0
    For columna = 1 To ASIS_COLUMNAS
        aciertos = 0
        conFecha = 0
        For fila = 1 To ultimaFilaHoja
            If Len(KcmNormalizeEmployeeId(valores(fila, columna))) > 0 Then
                aciertos = aciertos + 1
                If columna + ASIS_OFFSET_FECHA <= ASIS_COLUMNAS Then
                    If Len(KcmIsoDate(valores(fila, columna + ASIS_OFFSET_FECHA))) > 0 Then
                        conFecha = conFecha + 1
                    End If
                End If
            End If
        Next fila
        If aciertos > mejorAciertos Then
            mejorAciertos = aciertos
            mejorColumna = columna
        End If
        If conFecha > mejorConFecha Then
            mejorConFecha = conFecha
            columnaConFecha = columna
        End If
    Next columna
    If mejorConFecha >= ASIS_MINIMO Then
        mejorColumna = columnaConFecha
        mejorAciertos = mejorConFecha
    End If

    If mejorAciertos < ASIS_MINIMO Then
        KcmAsistenteDetectar = "No se encontro ninguna columna con numeros de trabajador " & _
            "en las primeras " & CStr(ASIS_COLUMNAS) & " columnas de la hoja " & hoja & "."
        Exit Function
    End If

    primeraFila = 0
    For fila = 1 To ultimaFilaHoja
        If Len(KcmNormalizeEmployeeId(valores(fila, mejorColumna))) > 0 Then
            primeraFila = fila
            Exit For
        End If
    Next fila
    If primeraFila < 2 Then
        KcmAsistenteDetectar = "La hoja " & hoja & " no reserva filas de encabezado sobre los " & _
            "datos: el primer numero de trabajador aparece en la fila " & CStr(primeraFila) & "."
        Exit Function
    End If

    ' Los cursos empiezan pasados los ocho atributos. Su ultima columna es la
    ' ultima que trae encabezado; se toleran huecos de hasta tres columnas para
    ' no cortar la lista en una separacion visual.
    ultimaColumna = 0
    vacias = 0
    columna = mejorColumna + ASIS_ATRIBUTOS
    Do While columna <= sheet.Columns.Count
        If Len(KcmAsistenteEncabezado(sheet, columna, primeraFila)) > 0 Then
            ultimaColumna = columna
            vacias = 0
        Else
            vacias = vacias + 1
            If vacias > 3 Then Exit Do
        End If
        columna = columna + 1
    Loop

    If ultimaColumna = 0 Then
        KcmAsistenteDetectar = "No se encontro ninguna columna de curso a la derecha de la " & _
            "columna " & KcmColumnLetters(mejorColumna) & " en la hoja " & hoja & "."
        Exit Function
    End If

    colTrabajador = KcmColumnLetters(mejorColumna)
    colPrimerCurso = KcmColumnLetters(mejorColumna + ASIS_ATRIBUTOS)
    colUltimoCurso = KcmColumnLetters(ultimaColumna)
End Function

''' Texto de encabezado de una columna: cualquier fila sobre el primer dato.
Private Function KcmAsistenteEncabezado(ByVal sheet As Worksheet, ByVal columna As Long, _
    ByVal primeraFila As Long) As String
    Dim fila As Long
    Dim texto As String
    For fila = 1 To primeraFila - 1
        texto = Trim$(KcmCellText(sheet.Cells(fila, columna).Value2))
        If Len(texto) > 0 Then
            KcmAsistenteEncabezado = texto
            Exit Function
        End If
    Next fila
End Function

''' Hoja de la matriz. Si existe una llamada HC se toma sin preguntar, porque es
''' el nombre que el formato usa; si no, se ofrece la lista numerada.
Private Function KcmAsistenteElegirHoja(ByVal libro As Workbook) As String
    Dim sheet As Worksheet
    Dim lista As String
    Dim indice As Long
    Dim respuesta As String
    Dim elegida As Long

    For Each sheet In libro.Worksheets
        If StrComp(sheet.Name, "HC", vbTextCompare) = 0 Then
            KcmAsistenteElegirHoja = sheet.Name
            Exit Function
        End If
    Next sheet

    If libro.Worksheets.Count = 1 Then
        KcmAsistenteElegirHoja = libro.Worksheets(1).Name
        Exit Function
    End If

    indice = 0
    For Each sheet In libro.Worksheets
        indice = indice + 1
        lista = lista & CStr(indice) & ". " & sheet.Name & vbCrLf
    Next sheet

    respuesta = Trim$(InputBox("Este libro no tiene una hoja llamada HC." & vbCrLf & vbCrLf & _
        "Escriba el numero de la hoja que contiene la matriz:" & vbCrLf & vbCrLf & lista, _
        "Hoja de la matriz"))
    If Len(respuesta) = 0 Then Exit Function
    elegida = CLng(Val(respuesta))
    If elegida < 1 Or elegida > libro.Worksheets.Count Then Exit Function
    KcmAsistenteElegirHoja = libro.Worksheets(elegida).Name
End Function

''' Cuadro de Abrir del puerto de plataforma. Devuelve la cadena vacia si se cancela.
'''
''' La concesion de acceso se pide aqui y en modo persistente. Elegir el archivo
''' en el cuadro ya lo vuelve legible para esta sesion en macOS, de modo que
''' la comprobacion normal del puerto lo veria accesible y no anotaria nada; sin
''' esa anotacion, la ruta dejaria de leerse al reabrir Excel y el ciclo fallaria
''' un lunes cualquiera sin que nadie hubiera tocado nada. En Windows la llamada
''' no hace nada.
Private Function KcmAsistenteElegirArchivo() As String
    KcmAsistenteElegirArchivo = KcmElegirArchivo("Elija el archivo de la matriz")
    If Len(KcmAsistenteElegirArchivo) = 0 Then Exit Function
    KcmConcederAcceso KcmAsistenteElegirArchivo, True
End Function

''' Endpoint aceptable para el cliente: la misma regla que aplica KcmHttpPost,
''' comprobada aqui para poder explicarla antes de que falle una transmision.
Private Function KcmAsistenteEndpointValido(ByVal endpoint As String) As Boolean
    Dim minuscula As String
    Dim host As String
    Dim corte As Long

    minuscula = LCase$(Trim$(endpoint))
    If Right$(minuscula, 18) <> "/api/v1/vba-bridge" Then Exit Function
    If Left$(minuscula, 8) = "https://" Then
        KcmAsistenteEndpointValido = True
        Exit Function
    End If
    If Left$(minuscula, 7) <> "http://" Then Exit Function
    host = Mid$(minuscula, 8)
    corte = InStr(1, host, "/", vbBinaryCompare)
    If corte > 0 Then host = Left$(host, corte - 1)
    corte = InStr(1, host, ":", vbBinaryCompare)
    If corte > 0 Then host = Left$(host, corte - 1)
    KcmAsistenteEndpointValido = (host = "127.0.0.1" Or host = "localhost")
End Function

''' La hoja KCM_CONFIG existe.
Private Function KcmAsistenteHojaConfig() As Boolean
    Dim sheet As Worksheet
    For Each sheet In ThisWorkbook.Worksheets
        If StrComp(sheet.Name, KCM_CONFIG_SHEET, vbTextCompare) = 0 Then
            KcmAsistenteHojaConfig = True
            Exit Function
        End If
    Next sheet
End Function

''' Valor actual de una clave de KCM_CONFIG, para proponerlo como respuesta.
Private Function KcmAsistenteValor(ByVal clave As String) As String
    On Error Resume Next
    KcmAsistenteValor = KcmConfigValue(clave, False)
End Function

''' Fija una clave en KCM_CONFIG. Si no existe la agrega al final, de modo que
''' una instalacion vieja sin alguna clave se completa sola.
Private Sub KcmAsistenteFijar(ByVal clave As String, ByVal valor As String)
    Dim sheet As Worksheet
    Dim fila As Long
    Dim ultima As Long

    Set sheet = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    ultima = sheet.Cells(sheet.Rows.Count, 1).End(xlUp).Row
    For fila = 1 To ultima
        If StrComp(Trim$(KcmCellText(sheet.Cells(fila, 1).Value2)), clave, vbTextCompare) = 0 Then
            sheet.Cells(fila, 2).Value2 = valor
            Exit Sub
        End If
    Next fila
    sheet.Cells(ultima + 1, 1).Value2 = clave
    sheet.Cells(ultima + 1, 2).Value2 = valor
End Sub
