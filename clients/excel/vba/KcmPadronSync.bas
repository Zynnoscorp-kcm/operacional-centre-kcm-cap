Attribute VB_Name = "KcmPadronSync"
Option Explicit
Option Private Module

Public Sub KcmBarrerPadron()
    Dim rutaPadron As String
    Dim problema As String
    Dim huella As String
    Dim contenido As String
    Dim sobre As String
    Dim respuesta As KcmDiccionario
    Dim faltantes As String
    Dim endpoint As String
    Dim token As String
    Dim nombre As String
    Dim corte As Long
    Dim miembros As New Collection
    Dim avisoMensaje As String

    On Error GoTo PadronError

    KcmResetCaches
    KcmPanelAbrir "Padron de la semana, para revision"

    endpoint = KcmConfigValue("ENDPOINT", False)
    rutaPadron = KcmConfigValue("ROSTER_PATH", False)
    faltantes = ""
    If Len(endpoint) = 0 Then faltantes = faltantes & " ENDPOINT"
    If Len(KcmConfigValue("CLIENT_ID", False)) = 0 Then faltantes = faltantes & " CLIENT_ID"
    If Len(rutaPadron) = 0 Then faltantes = faltantes & " ROSTER_PATH"

    If Len(faltantes) > 0 Then
        KcmPanelPaso "1. Configuracion", KCM_PANEL_FALLO, "Faltan datos:" & faltantes
        KcmPanelCerrar "Faltan datos en " & KCM_CONFIG_SHEET & ".", False
        GoTo PadronFin
    End If
    KcmPanelPaso "1. Configuracion", KCM_PANEL_OK, "Padron: " & rutaPadron

    token = KcmCredencialLeer()
    If Len(token) = 0 Then
        KcmPanelPaso "2. Credencial", KCM_PANEL_FALLO, _
            "Sin credencial. Se registra con Conectar este equipo"
        KcmPanelCerrar "Falta la credencial.", False
        GoTo PadronFin
    End If
    KcmPanelPaso "2. Credencial", KCM_PANEL_OK, "Credencial registrada"

    problema = KcmLocalFileProblem(rutaPadron)
    If Len(problema) > 0 Then
        KcmPanelPaso "3. Archivo", KCM_PANEL_FALLO, problema
        KcmPanelCerrar "No se encontro el archivo del padron.", False
        GoTo PadronFin
    End If

    nombre = rutaPadron
    corte = InStrRev(nombre, "\")
    If corte > 0 Then nombre = Mid$(nombre, corte + 1)
    corte = InStrRev(nombre, "/")
    If corte > 0 Then nombre = Mid$(nombre, corte + 1)

    Application.StatusBar = "KCM: verificando el padron..."
    huella = KcmFileSha256(rutaPadron)
    KcmPanelPaso "3. Archivo", KCM_PANEL_OK, _
        nombre & ", " & Format$(FileLen(rutaPadron) / 1048576, "0.00") & " MB"

    Application.StatusBar = "KCM: leyendo el padron..."
    contenido = KcmFileBase64(rutaPadron)
    KcmPanelPaso "4. Lectura", KCM_PANEL_OK, "Padron leido"

    miembros.Add KcmJsonPair("fileName", nombre)
    miembros.Add KcmJsonPair("sha256", huella)
    miembros.Add KcmJsonPair("content", contenido)
    sobre = KcmJsonObject(miembros)

    Application.StatusBar = "KCM: enviando el padron..."
    Set respuesta = KcmHttpPost("ROSTER_SCAN_V1", sobre, "vba-padron-" & Left$(huella, 24))
    KcmPanelPaso "5. Entrega", KCM_PANEL_OK, _
        "Revision " & KcmPanelCampo(respuesta, "planId") & ". Activos en el archivo " & _
        KcmPanelCampo(respuesta, "workers") & ", que la base no conoce " & _
        KcmPanelCampo(respuesta, "unknownWorkers") & ", en la base y no en el archivo " & _
        KcmPanelCampo(respuesta, "missingWorkers") & ", cambios de puesto " & _
        KcmPanelCampo(respuesta, "positionChanges") & ", CURP por escribir " & _
        KcmPanelCampo(respuesta, "curpToWrite") & ", altas por corregir " & _
        KcmPanelCampo(respuesta, "hireDatesToFix") & ", inducciones nuevas " & _
        KcmPanelCampo(respuesta, "newInductions")

    If Val(KcmPanelCampo(respuesta, "unknownWorkers")) > 0 Then
        KcmPanelPaso "5. Envio", KCM_PANEL_AVISO, _
            KcmPanelCampo(respuesta, "unknownWorkers") & _
            " numeros de trabajador no estan en la plataforma. La actualizacion completa de la matriz los agrega"
    End If

    If LCase$(KcmPanelCampo(respuesta, "hasCnoColumn")) <> "true" Then
        KcmPanelPaso "5. Envio", KCM_PANEL_AVISO, _
            "Sin columna CLAVE CNO: la ocupacion especifica del DC-3 queda en blanco"
    End If

    KcmPanelCerrar "Padron enviado (" & KcmDescribirEnvio(respuesta) & _
        "). La revision espera aprobacion en la plataforma.", True
    avisoMensaje = "Padron enviado: " & KcmDescribirEnvio(respuesta) & "."

PadronFin:
    Application.StatusBar = False
    If Len(avisoMensaje) > 0 Then KcmAvisoHecho "Padron de la semana", avisoMensaje, _
        "La revision espera aprobacion en la plataforma."
    Exit Sub

PadronError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    KcmPanelPaso "Interrumpido", KCM_PANEL_FALLO, descripcion
    KcmPanelCerrar "El proceso se detuvo. La etapa anterior indica donde.", False
    Application.StatusBar = False
    On Error GoTo 0
    KcmAvisoFallo "Padron de la semana", "El padron no se envio.", _
        descripcion & vbCrLf & vbCrLf & "Detalle por etapa en la hoja " & KCM_PANEL_SHEET & "."
End Sub
