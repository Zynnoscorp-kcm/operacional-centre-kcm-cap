Attribute VB_Name = "KcmConfigButtons"
Option Explicit

' Botones de la hoja KCM_CONFIG.
'
' Este modulo es aditivo a proposito: no modifica ninguna rutina existente y
' puede quitarse sin afectar el ciclo. Los botones no implementan logica propia,
' solo llaman a las entradas publicas ya depuradas de KcmCoordinator,
' KcmReleaseSync y KcmMatrixSync. Si un boton falla, falla la entrada que ya
' existia y el diagnostico es el mismo de siempre.

Private Const BOTON_PREFIJO As String = "KCM_BTN_"
Private Const BOTON_ANCHO As Double = 190
Private Const BOTON_ALTO As Double = 30
Private Const BOTON_IZQUIERDA As Double = 430

' Ventana de autolimitacion de la consulta de pendientes, en segundos.
Private Const CONSULTA_VENTANA_SEG As Long = 120

Private mUltimaConsulta As Date
Private mUltimoResultado As String

''' Crea o rehace los botones de KCM_CONFIG. Es idempotente: borra los suyos por
''' prefijo antes de dibujar, de modo que ejecutarlo dos veces no acumula formas
''' ni duplica asignaciones de macro.
Public Sub KcmInstallButtons()
    Dim sheet As Worksheet
    Dim forma As Shape
    Dim indice As Long
    Dim fila As Long

    On Error GoTo InstallError
    Set sheet = ThisWorkbook.Worksheets(KCM_CONFIG_SHEET)

    ' Recorrido descendente: borrar dentro de una coleccion reindexa lo que falta.
    For indice = sheet.Shapes.Count To 1 Step -1
        Set forma = sheet.Shapes(indice)
        If Left$(forma.Name, Len(BOTON_PREFIJO)) = BOTON_PREFIJO Then forma.Delete
    Next indice

    fila = 0
    ' Primero el panel: KCM_CONFIG es el formato interno del lector y se sigue
    ' pudiendo editar a mano, pero no es donde debe trabajar una persona. El
    ' boton queda arriba para que quien abra esta hoja por costumbre encuentre
    ' la pantalla antes que la tabla.
    KcmDibujarBoton sheet, fila, "PANEL", "Abrir el panel", _
        "KcmAbrirPanel", COLOR_MARCA
    ' Despues el asistente: es lo que se pulsa cuando algo de la conexion cambio
    ' (endpoint nuevo, credencial rotada, matriz movida de carpeta) y evita
    ' editar KCM_CONFIG a mano.
    KcmDibujarBoton sheet, fila, "CONECTAR", "Conectar este equipo", _
        "KcmAsistenteConexion", COLOR_MARCA_OSCURA
    KcmDibujarBoton sheet, fila, "CICLO", "Ciclo completo", _
        "KcmRunFullCycle", COLOR_MARCA_OSCURA
    KcmDibujarBoton sheet, fila, "PENDIENTES", "Consultar pendientes", _
        "KcmCheckPendingReleases", COLOR_MARCA
    KcmDibujarBoton sheet, fila, "LIBERAR", "Recibir lotes de fechas", _
        "KcmApplyPendingReleases", COLOR_MARCA
    ' Los dos botones de matriz apuntan al panel de KcmMatrixPanel, no a
    ' KcmTransmitMatrixSnapshot. La entrada silenciosa sigue existiendo y sigue
    ' siendo la que usa KcmRunFullCycle para el ciclo programado; lo que cambia
    ' es lo que pulsa una persona, que ahora ve etapa por etapa en KCM_ESTADO en
    ' vez de un unico mensaje al final.
    KcmDibujarBoton sheet, fila, "VERIFICAR", "Verificar matriz", _
        "KcmVerificarMatriz", COLOR_MARCA
    ' El barrido va antes que la transmision porque es lo que conviene pulsar:
    ' entrega el mismo snapshot pero deja la revision en la plataforma en lugar
    ' de aplicarla. Quien mira la pantalla decide si se escribe.
    KcmDibujarBoton sheet, fila, "BARRER", "Barrer matriz", _
        "KcmBarrerMatriz", COLOR_MARCA
    KcmDibujarBoton sheet, fila, "MATRIZ", "Transmitir matriz", _
        "KcmTransmitirMatriz", COLOR_MARCA_OSCURA
    ' El padron no tiene boton, ni de barrer ni de transmitir: entra por una
    ' sola puerta, el formulario de la pantalla /padron, que no necesita Excel
    ' ni credencial del puente y funciona desde cualquier equipo con sesion.
    ' `KcmBarrerPadron` sigue existiendo y sigue atendiendo la orden que deja
    ' esa pantalla; no hay acceso directo desde aqui para que no existan dos
    ' formas de subir el mismo archivo.
    ' La vigilancia es la que hace inmediato el boton de la pantalla: sin ella la
    ' orden espera a que alguien pulse Barrer matriz en este equipo.
    KcmDibujarBoton sheet, fila, "VIGILAR", "Vigilar barridos", _
        "KcmIniciarVigilancia", COLOR_MARCA
    KcmDibujarBoton sheet, fila, "NOVIGILAR", "Detener vigilancia", _
        "KcmDetenerVigilancia", COLOR_APAGADO
    ' La autoprueba va junto a la reparacion porque se usan en el mismo momento:
    ' cuando algo no funciona y hay que decidir si el problema es del equipo.
    KcmDibujarBoton sheet, fila, "PROBAR", "Probar este equipo", _
        "KcmAutoprueba", COLOR_MARCA
    KcmDibujarBoton sheet, fila, "INSTALAR", "Reparar instalacion", _
        "KcmInstallBridge", COLOR_APAGADO

    MsgBox "Botones de KCM_CONFIG instalados.", vbInformation
    Exit Sub

InstallError:
    MsgBox "No se pudieron instalar los botones: " & Err.Description, vbCritical
End Sub

Private Sub KcmDibujarBoton(ByVal sheet As Worksheet, ByRef indice As Long, _
    ByVal clave As String, ByVal etiqueta As String, _
    ByVal macro As String, ByVal color As Long)
    Dim forma As Shape

    Set forma = sheet.Shapes.AddShape(msoShapeRoundedRectangle, _
        BOTON_IZQUIERDA, 10 + indice * (BOTON_ALTO + 8), BOTON_ANCHO, BOTON_ALTO)
    forma.Name = BOTON_PREFIJO & clave
    forma.Fill.ForeColor.RGB = color
    forma.Line.Visible = msoFalse
    ' El nombre del libro no se antepone: una copia renombrada romperia el vinculo.
    forma.OnAction = macro
    With forma.TextFrame2.TextRange
        .Text = etiqueta
        .Font.Size = 11
        .Font.Bold = msoTrue
        .Font.Fill.ForeColor.RGB = COLOR_BLANCO
    End With
    forma.TextFrame2.VerticalAnchor = msoAnchorMiddle
    forma.TextFrame2.HorizontalAnchor = msoAnchorCenter
    indice = indice + 1
End Sub

''' Consulta si hay lotes pendientes sin aplicarlos y sin abrir la matriz.
'''
''' Cuesta exactamente una lectura: RELEASE_PULL_V1 es de solo lectura en el
''' servidor y su envoltura ya trae `count` y `remaining`, asi que no hace falta
''' decodificar ni recorrer el TSV de hasta 500 filas. Es la misma consulta que
''' haria KcmApplyPendingReleases, no una adicional.
'''
''' Se autolimita: dos pulsaciones dentro de la ventana devuelven el resultado ya
''' conocido en lugar de volver a preguntar. Un boton visible en pantalla invita
''' a pulsarlo, y sin freno una tarde de espera se vuelve cientos de lecturas
''' contra un presupuesto que no las tiene.
Public Sub KcmCheckPendingReleases()
    Dim response As KcmDiccionario
    Dim pendientes As Long
    Dim restantes As Long
    Dim mensaje As String

    On Error GoTo ConsultaError

    If Len(mUltimoResultado) > 0 Then
        If DateDiff("s", mUltimaConsulta, Now) < CONSULTA_VENTANA_SEG Then
            MsgBox mUltimoResultado & vbCrLf & vbCrLf & _
                "(consultado hace menos de dos minutos; no se volvio a preguntar)", vbInformation
            Exit Sub
        End If
    End If

    KcmResetCaches
    Set response = KcmHttpPost("RELEASE_PULL_V1", "")

    pendientes = 0
    restantes = 0
    If response.Exists("count") Then pendientes = CLng(Val(CStr(response.Item("count"))))
    If response.Exists("remaining") Then restantes = CLng(Val(CStr(response.Item("remaining"))))

    If pendientes = 0 Then
        mensaje = "No hay lotes pendientes por aplicar."
    ElseIf restantes > 0 Then
        mensaje = pendientes & " liberaciones listas para aplicar, y " & restantes & _
            " mas quedan en cola para el siguiente ciclo."
    Else
        mensaje = pendientes & " liberaciones listas para aplicar."
    End If

    mUltimaConsulta = Now
    mUltimoResultado = mensaje
    MsgBox mensaje, vbInformation
    Exit Sub

ConsultaError:
    ' Un fallo no se memoriza: la siguiente pulsacion debe poder reintentar.
    mUltimoResultado = ""
    MsgBox "No se pudo consultar el estado: " & Err.Description, vbExclamation
End Sub
