Attribute VB_Name = "KcmJornada"
Option Explicit

' La jornada, en los gestos que de verdad se hacen.
'
' Este modulo no implementa logica de matriz ni de padron: encadena las entradas
' publicas que ya existen y depuradas -KcmApplyPendingReleases, KcmTransmitirMatriz,
' KcmBarrerPadron- y les pone delante la unica cosa que faltaba, que es decidir
' CUANDO se manda cada una.
'
' -- El problema que resuelve -----------------------------------------------
'
' La corrida completa de antes hacia dos cosas de costo muy distinto en la misma pulsacion:
' bajar las liberaciones pendientes, que son unas decenas de filas, y transmitir
' el snapshot completo de la matriz. Lo segundo obliga al servidor a leer el
' padron entero, el catalogo de cursos y los mas de once mil registros de fechas
' para reconciliarlos, cada vez. Pulsarlo ocho veces al dia son ocho
' reconciliaciones completas para mover un punado de fechas.
'
' Aqui se separan, y la separacion es la optimizacion:
'
'   KcmActualizar            ' se pulsa a voluntad. NO manda la matriz.
'   KcmActualizacionDiaria   ' una vez al dia. Es la unica que manda el snapshot.
'
' `KcmActualizar` sube y baja unas decenas de filas: pide las liberaciones
' pendientes, las escribe en el libro y las acusa. Ni un byte de snapshot y
' ninguna reconciliacion del lado del servidor.
'
' -- Por que la ruta del libro se pide y no se configura --------------------
'
' La matriz es un archivo distinto cada dia y el padron uno distinto cada semana.
' Heredar en silencio el apuntador de ayer es como se termina transmitiendo el
' libro equivocado. Asi que la ruta deja de ser configuracion y pasa a ser parte
' del acto: cuando esta vacia se pide con el cuadro de Abrir, y al cerrar el
' libro del dia se suelta. Nadie tiene que editar KCM_CONFIG a mano.

' Marca local de la ultima actualizacion completa. Vive en KCM_CONFIG y no en el
' servidor a proposito: es un hecho de este equipo -"yo ya la mande hoy"- y
' preguntarselo al servidor costaria una llamada para saber algo que la maquina
' que lo hizo ya sabe.
Public Const KCM_CLAVE_ULTIMA_COMPLETA As String = "LAST_FULL_AT"

' ---------------------------------------------------------------- la jornada

''' El gesto de todos los dias. Se pulsa cuantas veces haga falta.
'''
''' Baja las liberaciones que la plataforma tiene listas, las escribe en la
''' matriz y las acusa. No transmite el snapshot: por eso es barata y por eso
''' puede pulsarse cada media hora sin saturar nada.
Public Sub KcmActualizar()
    Dim ruta As String

    On Error GoTo JornadaError

    ruta = KcmJornadaExigirMatriz()
    If Len(ruta) = 0 Then Exit Sub

    KcmApplyPendingReleases
    Exit Sub

JornadaError:
    KcmAvisoFallo "Actualizar", "No se escribieron las liberaciones pendientes.", Err.Description
End Sub

''' La unica que manda la matriz completa. Una vez al dia basta.
'''
''' Es la que reconcilia de verdad: sube el libro entero para que el servidor vea
''' altas, bajas, cambios de puesto y las fechas capturadas a mano. Va como
''' barrido: la plataforma arma la revision, la anuncia en Control de cambios y
''' no escribe nada hasta que alguien la aplica. Si ya se hizo hoy, lo dice y
''' pregunta antes de repetirla.
Public Sub KcmActualizacionDiaria()
    Dim ruta As String
    Dim ultima As String

    On Error GoTo DiariaError

    ultima = KcmJornadaValor(KCM_CLAVE_ULTIMA_COMPLETA)
    If KcmEsDeHoy(ultima) Then
        If Not KcmAvisoConfirmar("Actualizacion completa", _
            "La actualizacion completa de hoy ya se hizo a las " & Mid$(ultima, 12, 5) & ".", _
            "Repetirla vuelve a enviar la matriz completa.") Then Exit Sub
    End If

    ruta = KcmJornadaExigirMatriz()
    If Len(ruta) = 0 Then Exit Sub

    KcmBarrerMatriz
    KcmJornadaFijar KCM_CLAVE_ULTIMA_COMPLETA, Format$(Now, "yyyy-mm-dd hh:nn")
    Exit Sub

DiariaError:
    KcmAvisoFallo "Actualizacion completa", "La matriz no se envio.", Err.Description
End Sub

''' Suelta el libro del dia. Solo se pulsa cuando manana se trabaja otra copia.
'''
''' No suelta a ciegas: con liberaciones sin bajar, borrar el apuntador pierde la
''' referencia al archivo que todavia las necesita.
Public Sub KcmCerrarLibroDelDia()
    Dim respuesta As KcmDiccionario
    Dim pendientes As Long

    On Error GoTo CierreError

    KcmResetCaches
    Set respuesta = KcmHttpPost("RELEASE_PULL_V1", "")
    If respuesta.Exists("count") Then pendientes = CLng(Val(CStr(respuesta.Item("count"))))

    If pendientes > 0 Then
        KcmAvisoAtencion "Cerrar el libro del dia", _
            "El libro no se cerro: quedan " & _
            KcmPlural(pendientes, "liberacion sin escribir", "liberaciones sin escribir") & ".", _
            "Actualizar las escribe."
        Exit Sub
    End If

    KcmJornadaFijar "MATRIX_PATH", ""
    KcmJornadaFijar KCM_CLAVE_ULTIMA_COMPLETA, ""
    KcmAvisoHecho "Cerrar el libro del dia", "Libro del dia cerrado.", _
        "La siguiente actualizacion pide el archivo nuevo."
    Exit Sub

CierreError:
    KcmAvisoFallo "Cerrar el libro del dia", "El libro no se cerro.", Err.Description
End Sub

' ------------------------------------------------------------------ el padron

''' El padron de la semana. Mismo trato que la matriz, con otro calendario.
'''
''' El archivo cambia cada semana, asi que la ruta se pide cada semana y se
''' suelta al terminar: no hay forma de mandar sin querer el de la semana pasada.
Public Sub KcmPadronDeLaSemana()
    Dim ruta As String

    On Error GoTo PadronError

    ' Clasificar faltantes pudo apuntar ROSTER_PATH a su copia en esta misma sesion.
    KcmResetCaches
    ruta = KcmJornadaValor("ROSTER_PATH")
    If Len(ruta) = 0 Or Not KcmRutaExiste(ruta) Then
        ruta = KcmElegirArchivo("Padron de esta semana")
        If Len(ruta) = 0 Then Exit Sub
        KcmConcederAcceso ruta, True
        KcmJornadaFijar "ROSTER_PATH", ruta
    End If

    KcmBarrerPadron
    ' Se suelta en cuanto se entrego: la semana que entra es otro archivo y
    ' heredarlo seria mandar el viejo sin darse cuenta.
    KcmJornadaFijar "ROSTER_PATH", ""
    Exit Sub

PadronError:
    KcmAvisoFallo "Padron de la semana", "El padron no se envio.", Err.Description
End Sub

' ----------------------------------------------------------------- la conexion

''' Contesta las dos preguntas que importan: si el equipo conecta y si la
''' actualizacion completa de hoy ya se hizo.
Public Sub KcmVerificarConexion()
    Dim respuesta As KcmDiccionario
    Dim ultima As String
    Dim mensaje As String

    On Error GoTo ConexionError

    KcmResetCaches
    Set respuesta = KcmHttpPost("STATUS_V1", "")

    ultima = KcmJornadaValor(KCM_CLAVE_ULTIMA_COMPLETA)
    If KcmEsDeHoy(ultima) Then
        mensaje = "Actualizacion completa de hoy: " & Mid$(ultima, 12, 5) & "."
    Else
        mensaje = "Actualizacion completa de hoy: pendiente."
    End If

    KcmAvisoHecho "Verificar conexion", "Conexion correcta.", mensaje
    Exit Sub

ConexionError:
    KcmAvisoFallo "Verificar conexion", "Sin conexion con la plataforma.", Err.Description
End Sub

''' Abre la consola de la plataforma en el navegador: la misma direccion de ENDPOINT
''' sin la ruta del puente.
Public Sub KcmAbrirPlataforma()
    Dim direccion As String
    Dim corte As Long

    On Error GoTo AbrirError
    direccion = Trim$(KcmJornadaValor("ENDPOINT"))
    If Len(direccion) = 0 Then
        KcmAvisoAtencion "Abrir la plataforma", "Falta la direccion de la plataforma.", _
            "Conectar este equipo la registra."
        Exit Sub
    End If
    corte = InStr(1, direccion, "/api/", vbTextCompare)
    If corte > 0 Then direccion = Left$(direccion, corte - 1)
    ThisWorkbook.FollowHyperlink direccion
    Exit Sub

AbrirError:
    KcmAvisoFallo "Abrir la plataforma", "No se pudo abrir el navegador.", Err.Description
End Sub

' -------------------------------------------------------------------- apoyos

''' La ruta de la matriz, pidiendola si no hay. Cadena vacia si se cancelo.
Private Function KcmJornadaExigirMatriz() As String
    Dim ruta As String

    ruta = KcmJornadaValor("MATRIX_PATH")
    If Len(ruta) > 0 And KcmRutaExiste(ruta) Then
        KcmJornadaExigirMatriz = ruta
        Exit Function
    End If

    ruta = KcmElegirArchivo("Matriz de hoy")
    If Len(ruta) = 0 Then Exit Function

    KcmConcederAcceso ruta, True
    KcmJornadaFijar "MATRIX_PATH", ruta
    KcmJornadaExigirMatriz = ruta
End Function

''' Verdadero si la marca corresponde al dia de hoy. Formato `yyyy-mm-dd hh:nn`.
'''
''' Publica porque el panel la necesita para decir, sin preguntarle a nadie, si
''' la actualizacion completa de hoy ya se hizo.
Public Function KcmEsDeHoy(ByVal marca As String) As Boolean
    If Len(marca) < 16 Then Exit Function
    KcmEsDeHoy = (Left$(marca, 10) = Format$(Date, "yyyy-mm-dd"))
End Function

Private Function KcmJornadaValor(ByVal clave As String) As String
    On Error Resume Next
    KcmJornadaValor = KcmConfigValue(clave, False)
End Function

''' Fija una clave en KCM_CONFIG; la agrega al final si no existe. Publica porque
''' Clasificar faltantes apunta ROSTER_PATH a la copia que escribe.
'''
''' Vacia la cache de configuracion: sin eso, quien lea despues en la misma sesion
''' veria el valor anterior y, por ejemplo, Padron de la semana mandaria otro archivo.
Public Sub KcmJornadaFijar(ByVal clave As String, ByVal valor As String)
    Dim hoja As Worksheet
    Dim fila As Long
    Dim ultima As Long

    Set hoja = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)
    ultima = hoja.Cells(hoja.Rows.Count, 1).End(xlUp).Row
    For fila = 1 To ultima
        If StrComp(Trim$(KcmCellText(hoja.Cells(fila, 1).Value2)), clave, vbTextCompare) = 0 Then
            hoja.Cells(fila, 2).Value2 = valor
            KcmResetCaches
            Exit Sub
        End If
    Next fila
    hoja.Cells(ultima + 1, 1).Value2 = clave
    hoja.Cells(ultima + 1, 2).Value2 = valor
    KcmResetCaches
End Sub
