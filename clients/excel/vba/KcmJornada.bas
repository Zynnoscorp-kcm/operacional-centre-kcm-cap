Attribute VB_Name = "KcmJornada"
Option Explicit

Public Const KCM_CLAVE_ULTIMA_COMPLETA As String = "LAST_FULL_AT"

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

Public Sub KcmPadronDeLaSemana()
    Dim ruta As String

    On Error GoTo PadronError

    KcmResetCaches
    ruta = KcmJornadaValor("ROSTER_PATH")
    If Len(ruta) = 0 Or Not KcmRutaExiste(ruta) Then
        ruta = KcmElegirArchivo("Padron de esta semana")
        If Len(ruta) = 0 Then Exit Sub
        KcmConcederAcceso ruta, True
        KcmJornadaFijar "ROSTER_PATH", ruta
    End If

    KcmBarrerPadron
    KcmJornadaFijar "ROSTER_PATH", ""
    Exit Sub

PadronError:
    KcmAvisoFallo "Padron de la semana", "El padron no se envio.", Err.Description
End Sub

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

Public Function KcmEsDeHoy(ByVal marca As String) As Boolean
    If Len(marca) < 16 Then Exit Function
    KcmEsDeHoy = (Left$(marca, 10) = Format$(Date, "yyyy-mm-dd"))
End Function

Private Function KcmJornadaValor(ByVal clave As String) As String
    On Error Resume Next
    KcmJornadaValor = KcmConfigValue(clave, False)
End Function

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
