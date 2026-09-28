Attribute VB_Name = "KcmPruebas"
Option Explicit

' La autoprueba del libro.
'
' Existe por una limitacion honesta: este cliente se construye y se prueba en una
' Mac, y probarlo ahi no demuestra nada sobre la rama de Windows, porque el
' compilador de cada sistema compila solo la suya. El analisis estatico
' (`npm run lint:vba`) cubre lo que se puede saber leyendo el texto de las dos
' ramas; lo que no puede saber es si un metodo de WinHTTP existe, si la politica
' del equipo permite macros o si hay un proxy interceptando TLS.
'
' Esta macro cierra esa distancia de la unica forma disponible: alguien del
' departamento la ejecuta una vez en su equipo y devuelve el resultado. Ocho
' etapas, cada una con su renglon en la hoja KCM_ESTADO, que se selecciona y se
' copia de un toque.
'
' Ninguna etapa escribe en la base ni transmite nada, con una sola excepcion
' declarada: la ultima consulta STATUS_V1, que es la accion de estado del
' protocolo y es de solo lectura. Si el equipo no tiene endpoint configurado, esa
' etapa se salta en lugar de fallar.
'
' El modulo no tiene ninguna directiva `#If`: ejerce el puerto de plataforma
' desde fuera, por sus entradas publicas, que es exactamente como lo usa el resto
' del cliente.

' Vectores conocidos. No dependen de este codigo: son valores publicos y fijos, y
' por eso sirven de prueba. El de SHA-256 es el digest de la cadena "abc"; los de
' base64 salen de RFC 4648 aplicado a las mismas cadenas.
Private Const AP_SHA_ABC As String = _
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
Private Const AP_B64_HOLA As String = "SG9sYQ"
Private Const AP_B64_ABC As String = "YWJj"

Private mFallos As Long
Private mAvisos As Long

''' Punto de entrada. Es la macro que se pide ejecutar en un equipo nuevo.
Public Sub KcmAutoprueba()
    mFallos = 0
    mAvisos = 0

    On Error GoTo PruebaError
    KcmResetCaches
    KcmPanelAbrir "Autoprueba del cliente, sin enviar datos"

    KcmPanelPaso "1. Entorno", KCM_PANEL_OK, KcmEntorno() & ". Transporte: " & KcmTransporteNombre()

    KcmApReloj
    KcmApIdentificadores
    KcmApCodificaciones
    KcmApDiccionario
    KcmApHuella
    KcmApCredencial
    KcmApConexion

    If mFallos > 0 Then
        KcmPanelCerrar "La autoprueba encontro " & KcmPlural(mFallos, "fallo", "fallos") & ".", False
    ElseIf mAvisos > 0 Then
        KcmPanelCerrar "El equipo funciona, con " & KcmPlural(mAvisos, "aviso", "avisos") & ".", True
    Else
        KcmPanelCerrar "Autoprueba correcta. El equipo esta listo.", True
    End If
    Application.StatusBar = False
    Exit Sub

PruebaError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    KcmPanelPaso "Interrumpida", KCM_PANEL_FALLO, descripcion
    KcmPanelCerrar "La autoprueba se detuvo. La etapa anterior indica donde.", False
    Application.StatusBar = False
    Err.Clear
    On Error GoTo 0
End Sub

' ------------------------------------------------------------------ etapas

''' El reloj. El servidor rechaza una peticion fechada a mas de cinco minutos de
''' su propia hora, y ese rechazo llega disfrazado de credencial vencida. Verlo
''' aqui ahorra buscar el problema donde no esta.
Private Sub KcmApReloj()
    Dim marca As String
    Dim desfase As Double

    marca = KcmUtcIsoNow()
    If Len(marca) <> 24 Or Right$(marca, 1) <> "Z" Or Mid$(marca, 11, 1) <> "T" Then
        KcmApFallo "2. Reloj UTC", "La marca de tiempo no tiene la forma del contrato: " & marca
        Exit Sub
    End If
    ' Diferencia entre la marca UTC y la hora local del equipo, en horas. La hora
    ' se arma por posicion y no con `TimeValue`, que interpreta segun la
    ' configuracion regional y no en todas el separador es dos puntos.
    desfase = (KcmDateFromIso(Left$(marca, 10)) + _
        TimeSerial(CInt(Mid$(marca, 12, 2)), CInt(Mid$(marca, 15, 2)), _
        CInt(Mid$(marca, 18, 2))) - Now) * 24#
    KcmApBien "2. Reloj UTC", marca & ". La hora local va " & Format$(desfase, "0.0") & _
        " h respecto de UTC"
End Sub

''' Los identificadores. Un nonce repetido lo rechaza el servidor, y el
''' `requestId` tiene que caber en el patron que valida el contrato.
Private Sub KcmApIdentificadores()
    Dim primero As String
    Dim segundo As String
    Dim tercero As String

    primero = KcmNewGuidHex()
    segundo = KcmNewGuidHex()
    tercero = KcmNewGuidHex()
    If Len(primero) <> 32 Or primero Like "*[!0-9a-f]*" Then
        KcmApFallo "3. Identificadores", "No son 32 digitos hexadecimales: " & primero
        Exit Sub
    End If
    If primero = segundo Or segundo = tercero Or primero = tercero Then
        KcmApFallo "3. Identificadores", "Tres sorteos seguidos repitieron valor"
        Exit Sub
    End If
    KcmApBien "3. Identificadores", "Tres distintos y bien formados. Ejemplo de requestId: " & _
        KcmNewRequestId("vba-request")
End Sub

''' Las codificaciones. Son el camino por el que viaja el snapshot entero: si
''' aqui hay un byte de diferencia, el servidor responde que el sobre no es
''' base64 valido y nada mas se puede diagnosticar desde afuera.
Private Sub KcmApCodificaciones()
    Dim conEnie As String
    Dim ida As String
    Dim vuelta As String

    If KcmBase64WebEncode("Hola") <> AP_B64_HOLA Then
        KcmApFallo "4. Codificaciones", "El base64 web-safe de una cadena conocida no coincide: " & _
            KcmBase64WebEncode("Hola") & " en vez de " & AP_B64_HOLA
        Exit Sub
    End If

    ' La enie se construye por codigo: el editor VBA importa el .bas con la
    ' pagina de codigos del sistema y una letra acentuada literal llegaria
    ' corrompida. Es la misma regla que exige el linter.
    conEnie = "MU" & ChrW$(209) & "OZ"
    ida = KcmBase64WebEncode(conEnie)
    If ida <> "TVXDkU9a" Then
        KcmApFallo "4. Codificaciones", "El base64 de un nombre con enie no coincide: " & ida
        Exit Sub
    End If
    vuelta = KcmBase64WebDecode(ida)
    If vuelta <> conEnie Then
        KcmApFallo "4. Codificaciones", "La ida y vuelta por base64 no devuelve el original"
        Exit Sub
    End If
    If KcmUrlEncode(conEnie) <> "MU%C3%91OZ" Then
        KcmApFallo "4. Codificaciones", "La codificacion porcentual UTF-8 no coincide: " & _
            KcmUrlEncode(conEnie)
        Exit Sub
    End If
    If KcmUrlDecode("MU%C3%91OZ") <> conEnie Then
        KcmApFallo "4. Codificaciones", "La decodificacion porcentual no devuelve el original"
        Exit Sub
    End If
    KcmApBien "4. Codificaciones", "UTF-8, base64 web-safe y codificacion porcentual coinciden " & _
        "con sus valores conocidos, con acentos incluidos"
End Sub

''' El diccionario. Sustituye al de Windows, que no existe en macOS, y lo usa
''' todo el cliente: el indice de trabajadores, el catalogo de cursos y cada
''' respuesta del puente. Dos claves que solo difieren en mayusculas tienen que
''' seguir siendo dos.
Private Sub KcmApDiccionario()
    Dim mapa As KcmDiccionario
    Dim claves As Variant

    Set mapa = KcmNuevoDiccionario()
    mapa.Add "hc", 1
    mapa.Add "HC", 2
    If mapa.Count <> 2 Then
        KcmApFallo "5. Diccionario", "Dos claves que difieren en mayusculas se guardaron como una"
        Exit Sub
    End If
    If CLng(mapa.Item("hc")) <> 1 Or CLng(mapa.Item("HC")) <> 2 Then
        KcmApFallo "5. Diccionario", "Una clave devolvio el valor de la otra"
        Exit Sub
    End If
    mapa.Fijar "hc", 9
    If CLng(mapa.Item("hc")) <> 9 Or mapa.Count <> 2 Then
        KcmApFallo "5. Diccionario", "Reescribir una clave existente no funciono"
        Exit Sub
    End If
    If mapa.Exists("Hc") Then
        KcmApFallo "5. Diccionario", "Una clave con otra caja se reconocio como existente"
        Exit Sub
    End If
    claves = mapa.Keys
    If CStr(claves(0)) <> "hc" Or CStr(claves(1)) <> "HC" Then
        KcmApFallo "5. Diccionario", "Las claves no conservan el orden de insercion"
        Exit Sub
    End If
    KcmApBien "5. Diccionario", "Distingue mayusculas, reescribe y conserva el orden de insercion"
End Sub

''' La huella. En Windows recorre la API criptografica; en macOS ejecuta shasum
''' por la via que corresponda. Se prueba sobre un archivo escrito aqui, cuyo
''' digest es publico, de modo que no depende de la matriz ni de ninguna ruta.
Private Sub KcmApHuella()
    Dim ruta As String
    Dim obtenido As String
    Dim contenido As String

    ruta = KcmCarpetaTemporal() & "kcm-autoprueba-" & KcmNewGuidHex() & ".txt"
    On Error GoTo FalloHuella
    KcmApEscribirAbc ruta
    obtenido = KcmFileSha256(ruta)
    contenido = KcmFileBase64(ruta)
    KcmBorrarArchivo ruta
    On Error GoTo 0

    If obtenido <> AP_SHA_ABC Then
        KcmApFallo "6. Huella y lectura", "El SHA-256 de una cadena conocida no coincide: " & obtenido
        Exit Sub
    End If
    If contenido <> AP_B64_ABC Then
        KcmApFallo "6. Huella y lectura", "La lectura del archivo en base64 no coincide: " & contenido
        Exit Sub
    End If
    KcmApBien "6. Huella y lectura", "SHA-256 y lectura binaria correctas sobre un archivo de " & _
        "prueba en " & KcmCarpetaTemporal()
    Exit Sub

FalloHuella:
    KcmApFallo "6. Huella y lectura", Err.Description
    On Error Resume Next
    KcmBorrarArchivo ruta
    Err.Clear
    On Error GoTo 0
End Sub

Private Sub KcmApEscribirAbc(ByVal ruta As String)
    Dim bytes(0 To 2) As Byte
    Dim numero As Integer
    ' Las letras a, b y c por su codigo, para no depender de la pagina de codigos.
    bytes(0) = 97
    bytes(1) = 98
    bytes(2) = 99
    KcmBorrarArchivo ruta
    numero = FreeFile
    Open ruta For Binary Access Write As #numero
    Put #numero, 1, bytes
    Close #numero
End Sub

''' La credencial. Nunca se muestra: solo si esta y cuantos caracteres mide.
Private Sub KcmApCredencial()
    Dim token As String
    token = KcmCredencialLeer()
    If Len(token) = 0 Then
        KcmApAviso "7. Credencial", "No hay credencial guardada en " & KcmCredencialDonde() & _
            ". Emitala en la pantalla /excel y guardela con Conectar este equipo"
        Exit Sub
    End If
    KcmApBien "7. Credencial", "Presente en " & KcmCredencialDonde() & ", " & _
        CStr(Len(token)) & " caracteres. El valor no se muestra"
End Sub

''' La conexion. Es la unica etapa que sale del equipo, y con la accion de estado
''' del protocolo, que es de solo lectura.
Private Sub KcmApConexion()
    Dim endpoint As String
    Dim respuesta As KcmDiccionario

    endpoint = ""
    On Error Resume Next
    endpoint = KcmConfigValue("ENDPOINT", False)
    Err.Clear
    On Error GoTo 0
    If Len(endpoint) = 0 Then
        KcmApAviso "8. Conexion", "Sin ENDPOINT configurado no hay a quien preguntar. Lo deja " & _
            "Conectar este equipo, y la autoprueba se repite despues"
        Exit Sub
    End If
    If Len(KcmCredencialLeer()) = 0 Then
        KcmApAviso "8. Conexion", "Sin credencial no se puede consultar el estado del servidor"
        Exit Sub
    End If

    Application.StatusBar = "KCM: conectando con la plataforma..."
    On Error GoTo FalloConexion
    Set respuesta = KcmHttpPost("STATUS_V1", "")
    On Error GoTo 0
    KcmApBien "8. Conexion", "El servidor respondio a STATUS_V1 por " & KcmTransporteNombre() & _
        ", con la credencial de " & KcmConfigValue("CLIENT_ID") & ". Respuesta " & _
        KcmPanelCampo(respuesta, "requestId")
    Exit Sub

FalloConexion:
    KcmApFallo "8. Conexion", Err.Description
End Sub

' ------------------------------------------------------------- utilidades

Private Sub KcmApBien(ByVal etapa As String, ByVal detalle As String)
    KcmPanelPaso etapa, KCM_PANEL_OK, detalle
End Sub

Private Sub KcmApAviso(ByVal etapa As String, ByVal detalle As String)
    mAvisos = mAvisos + 1
    KcmPanelPaso etapa, KCM_PANEL_AVISO, detalle
End Sub

Private Sub KcmApFallo(ByVal etapa As String, ByVal detalle As String)
    mFallos = mFallos + 1
    KcmPanelPaso etapa, KCM_PANEL_FALLO, detalle
End Sub
