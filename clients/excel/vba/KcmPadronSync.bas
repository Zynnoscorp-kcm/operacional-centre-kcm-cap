Attribute VB_Name = "KcmPadronSync"
Option Explicit
Option Private Module

' Modulo interno: sus rutinas las llaman otros modulos del cliente y no aparecen
' en Herramientas > Macros, donde solo quedan las que se usan a mano.

' Barrido del padron semanal.
'
' Aditivo, como KcmMatrixPanel: no modifica ninguna rutina
' existente y quitarlo no afecta al ciclo. Escribe en el mismo panel KCM_ESTADO
' que el barrido de matriz, etapa por etapa.
'
' La diferencia con el barrido de matriz es deliberada y vale la pena decirla:
' aqui el archivo viaja tal cual. La macro no abre el libro, no busca
' encabezados y no interpreta una sola celda; lee los bytes del
' `sem NN CAP.xlsx`, calcula su huella y los entrega. El servidor lo lee con el
' mismo extractor que usa la subida manual de la pantalla y el guion de linea de
' comandos, de modo que no existen dos lecturas del padron que puedan diferir.
'
' La matriz no puede hacer eso y por eso hace lo otro: es un XLSB de decenas de
' megas cuyos valores calculados solo Excel entrega con fidelidad, asi que ahi
' si conviene que la macro lo recorra y mande un snapshot. El padron es un XLSX
' de medio mega y no hay nada que ganar interpretandolo aqui; lo que si habria
' es una segunda forma de equivocarse, con su propio problema de paridad.
'
' Una entrada:
'
'   KcmBarrerPadron   lee ROSTER_PATH y lo entrega para revision. No aplica nada.

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

    ' --- 1. Configuracion ------------------------------------------------
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

    ' --- 2. Credencial ---------------------------------------------------
    ' Igual que el panel de matriz: por el puerto de plataforma y no por
    ' Environ$, y solo se reporta la longitud, nunca el valor.
    token = KcmCredencialLeer()
    If Len(token) = 0 Then
        KcmPanelPaso "2. Credencial", KCM_PANEL_FALLO, _
            "Sin credencial. Se registra con Conectar este equipo"
        KcmPanelCerrar "Falta la credencial.", False
        GoTo PadronFin
    End If
    KcmPanelPaso "2. Credencial", KCM_PANEL_OK, "Credencial registrada"

    ' --- 3. Archivo ------------------------------------------------------
    problema = KcmLocalFileProblem(rutaPadron)
    If Len(problema) > 0 Then
        KcmPanelPaso "3. Archivo", KCM_PANEL_FALLO, problema
        KcmPanelCerrar "No se encontro el archivo del padron.", False
        GoTo PadronFin
    End If

    ' El nombre identifica la semana y viaja con el archivo: la pantalla titula
    ' la revision con el, y un acuse sin semana no dice de que padron habla. Se
    ' recorta por los dos separadores a proposito: la ruta puede venir de
    ' Windows o de macOS y el libro se comparte entre equipos.
    nombre = rutaPadron
    corte = InStrRev(nombre, "\")
    If corte > 0 Then nombre = Mid$(nombre, corte + 1)
    corte = InStrRev(nombre, "/")
    If corte > 0 Then nombre = Mid$(nombre, corte + 1)

    Application.StatusBar = "KCM: verificando el padron..."
    huella = KcmFileSha256(rutaPadron)
    KcmPanelPaso "3. Archivo", KCM_PANEL_OK, _
        nombre & ", " & Format$(FileLen(rutaPadron) / 1048576, "0.00") & " MB"

    ' --- 4. Lectura ------------------------------------------------------
    ' No se abre el libro: se leen sus bytes. Abrirlo en Excel dispararia sus
    ' formulas y sus vinculos, y el archivo que se entregaria dejaria de ser el
    ' que el departamento guardo.
    Application.StatusBar = "KCM: leyendo el padron..."
    contenido = KcmFileBase64(rutaPadron)
    KcmPanelPaso "4. Lectura", KCM_PANEL_OK, "Padron leido"

    ' --- 5. Entrega ------------------------------------------------------
    ' La huella viaja con el archivo para que el servidor distinga "el libro
    ' cambio" de "el traslado lo corrompio", que desde el extractor se ven igual.
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

    ' Un padron cuyos numeros la matriz no conoce suele significar que la matriz
    ' esta mas atrasada que el padron. Se dice aparte porque esos trabajadores
    ' quedan fuera de la carga sin que nada falle.
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
    ' Dice si el padron salio entero o en partes; solo cuando se envio.
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
    ' Lo dispara una persona desde KCM_CONFIG, asi que siempre hay alguien para
    ' cerrar el cuadro.
    KcmAvisoFallo "Padron de la semana", "El padron no se envio.", _
        descripcion & vbCrLf & vbCrLf & "Detalle por etapa en la hoja " & KCM_PANEL_SHEET & "."
End Sub
