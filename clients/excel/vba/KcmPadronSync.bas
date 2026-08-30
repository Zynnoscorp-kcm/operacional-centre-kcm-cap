Attribute VB_Name = "KcmPadronSync"
Option Explicit

' Barrido del padron semanal.
'
' Aditivo, como KcmMatrixPanel y KcmOrdenBarrido: no modifica ninguna rutina
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

Public Sub KcmBarrerPadron(Optional ByVal silencioso As Boolean = False)
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

    On Error GoTo PadronError

    KcmResetCaches
    KcmPanelAbrir "Barrido del padron semanal (entrega para revision, no aplica)"

    ' --- 1. Configuracion ------------------------------------------------
    endpoint = KcmConfigValue("ENDPOINT", False)
    rutaPadron = KcmConfigValue("ROSTER_PATH", False)
    faltantes = ""
    If Len(endpoint) = 0 Then faltantes = faltantes & " ENDPOINT"
    If Len(KcmConfigValue("CLIENT_ID", False)) = 0 Then faltantes = faltantes & " CLIENT_ID"
    If Len(rutaPadron) = 0 Then faltantes = faltantes & " ROSTER_PATH"

    If Len(faltantes) > 0 Then
        KcmPanelPaso "1. Configuracion", KCM_PANEL_FALLO, _
            "Faltan claves en " & KCM_CONFIG_SHEET & ":" & faltantes & _
            ". ROSTER_PATH es la ruta completa del sem NN CAP.xlsx de esta semana"
        KcmPanelCerrar "Complete " & KCM_CONFIG_SHEET & " y vuelva a ejecutar.", False
        GoTo PadronFin
    End If
    KcmPanelPaso "1. Configuracion", KCM_PANEL_OK, _
        "Padron en " & rutaPadron & ". Endpoint " & endpoint

    ' --- 2. Credencial ---------------------------------------------------
    ' Igual que el panel de matriz: por el puerto de plataforma y no por
    ' Environ$, y solo se reporta la longitud, nunca el valor.
    token = KcmCredencialLeer()
    If Len(token) = 0 Then
        KcmPanelPaso "2. Credencial", KCM_PANEL_FALLO, _
            "No hay credencial guardada en " & KcmCredencialDonde() & _
            ". Emitala en /excel y guardela con el boton Conectar este equipo"
        KcmPanelCerrar "Configure la credencial y vuelva a ejecutar.", False
        GoTo PadronFin
    End If
    KcmPanelPaso "2. Credencial", KCM_PANEL_OK, _
        "Credencial presente en " & KcmCredencialDonde() & ", " & CStr(Len(token)) & _
        " caracteres. El valor no se muestra"

    ' --- 3. Archivo ------------------------------------------------------
    problema = KcmLocalFileProblem(rutaPadron)
    If Len(problema) > 0 Then
        KcmPanelPaso "3. Archivo", KCM_PANEL_FALLO, "ROSTER_PATH: " & problema
        KcmPanelCerrar "Corrija ROSTER_PATH en " & KCM_CONFIG_SHEET & ".", False
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

    Application.StatusBar = "KCM: calculando la huella SHA-256 del padron"
    huella = KcmFileSha256(rutaPadron)
    KcmPanelPaso "3. Archivo", KCM_PANEL_OK, _
        nombre & ", " & Format$(FileLen(rutaPadron) / 1048576, "0.00") & _
        " MB, huella " & Left$(huella, 16)

    ' --- 4. Lectura ------------------------------------------------------
    ' No se abre el libro: se leen sus bytes. Abrirlo en Excel dispararia sus
    ' formulas y sus vinculos, y el archivo que se entregaria dejaria de ser el
    ' que el departamento guardo.
    Application.StatusBar = "KCM: leyendo el padron"
    contenido = KcmFileBase64(rutaPadron)
    KcmPanelPaso "4. Lectura", KCM_PANEL_OK, _
        "Archivo leido sin abrirlo en Excel. Sobre de " & _
        Format$(Len(contenido) / 1048576, "0.00") & " MB"

    ' --- 5. Entrega ------------------------------------------------------
    ' La huella viaja con el archivo para que el servidor distinga "el libro
    ' cambio" de "el traslado lo corrompio", que desde el extractor se ven igual.
    miembros.Add KcmJsonPair("fileName", nombre)
    miembros.Add KcmJsonPair("sha256", huella)
    miembros.Add KcmJsonPair("content", contenido)
    sobre = KcmJsonObject(miembros)

    Application.StatusBar = "KCM: entregando el padron a la plataforma"
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
        KcmPanelPaso "5. Entrega", KCM_PANEL_AVISO, _
            "El archivo trae " & KcmPanelCampo(respuesta, "unknownWorkers") & " numeros que la " & _
            "base no conoce. Suele significar que la matriz esta mas atrasada que el padron: " & _
            "barra la matriz antes de aplicar este padron"
    End If

    If LCase$(KcmPanelCampo(respuesta, "hasCnoColumn")) <> "true" Then
        KcmPanelPaso "5. Entrega", KCM_PANEL_AVISO, _
            "Este libro no trae la columna CLAVE CNO. No es un error, pero mientras no exista " & _
            "la ocupacion especifica del DC-3 sigue en blanco"
    End If

    KcmPanelCerrar "Padron entregado. Nada se escribio: la revision espera aprobacion en " & _
        "la pantalla Padron semanal de la plataforma.", True

PadronFin:
    Application.StatusBar = False
    Exit Sub

PadronError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    KcmPanelPaso "Interrumpido", KCM_PANEL_FALLO, descripcion
    KcmPanelCerrar "El proceso se detuvo. El renglon anterior dice donde.", False
    Application.StatusBar = False
    On Error GoTo 0
    ' Un barrido desatendido no abre cuadros de dialogo: nadie los cerraria.
    If Not silencioso Then
        MsgBox "El padron no se entrego: " & descripcion & vbCrLf & vbCrLf & _
            "El detalle por etapa quedo en la hoja " & KCM_PANEL_SHEET & ".", vbCritical
    End If
End Sub
