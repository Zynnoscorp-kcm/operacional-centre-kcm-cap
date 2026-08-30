Attribute VB_Name = "KcmOrdenBarrido"
Option Explicit

' Ordenes de barrido encargadas desde la plataforma.
'
' Este modulo es aditivo, como KcmConfigButtons y KcmMatrixPanel: no modifica
' ninguna rutina existente y quitarlo no afecta al ciclo. Tampoco implementa
' logica de matriz; encadena KcmHttpPost y KcmBarrerMatriz.
'
' El problema que resuelve es de direccion. La plataforma no puede abrir ni el
' XLSB ni el padron: los dos viven en estas PC y el puente siempre va de aqui
' hacia alla. Asi que los botones de las pantallas no ejecutan nada, dejan una
' orden; y este modulo es el que las recoge.
'
' SCAN_ORDERS_V1 pregunta por las dos de una sola vez y no cuesta mas que la
' credencial y el nonce. Preguntar por cada una en su propia accion habria
' duplicado para siempre el costo de la llamada mas frecuente del puente.
'
' Dos entradas:
'
'   KcmAtenderOrdenDeBarrido  pregunta una vez y atiende lo que haya encargado.
'   KcmIniciarVigilancia      lo anterior cada pocos minutos, hasta detenerlo.
'
' La vigilancia es opcional a proposito. Sin ella todo sigue funcionando: la
' orden espera media hora y el barrido corre cuando alguien pulse Barrer matriz.
' Con ella el boton de la pantalla se siente inmediato, al precio de una consulta
' cada intervalo mientras Excel este abierto.

' Minutos entre consultas cuando no se declara SCAN_POLL_MINUTES en KCM_CONFIG.
Private Const VIGILANCIA_MINUTOS_OMISION As Long = 5
' Piso duro. Una consulta por minuto ya son 1,440 al dia contra el presupuesto
' de lecturas de la base; por debajo de eso no hay caso de uso, solo gasto.
Private Const VIGILANCIA_MINUTOS_MINIMO As Long = 1

Private mProximaCorrida As Date
Private mVigilando As Boolean

''' Pregunta que barridos encargo la consola y ejecuta los que haya.
'''
''' Se puede pulsar a mano en cualquier momento: no depende de la vigilancia.
'''
''' Si hay las dos ordenes se atienden las dos, y la matriz va primero a
''' proposito: un padron cuyos numeros la matriz no conoce se queda fuera de la
''' carga, asi que conviene que la matriz este al dia cuando el padron se revise.
Public Sub KcmAtenderOrdenDeBarrido(Optional ByVal silencioso As Boolean = False)
    Dim respuesta As KcmDiccionario
    Dim matriz As Boolean
    Dim padron As Boolean

    On Error GoTo OrdenError

    KcmResetCaches
    Set respuesta = KcmHttpPost("SCAN_ORDERS_V1", "")

    matriz = KcmOrdenPendiente(respuesta, "matrixPending")
    padron = KcmOrdenPendiente(respuesta, "rosterPending")

    If Not matriz And Not padron Then
        If Not silencioso Then MsgBox "No hay ningun barrido encargado.", vbInformation
        Exit Sub
    End If

    ' Cada barrido escribe su propio detalle por etapa en KCM_ESTADO y no aplica
    ' nada: lo que producen son revisiones que esperan aprobacion en pantalla.
    If matriz Then KcmBarrerMatriz silencioso
    If padron Then KcmBarrerPadron silencioso
    Exit Sub

OrdenError:
    ' Un fallo de consulta no debe detener la vigilancia: la siguiente vuelta
    ' reintenta. Se anuncia solo cuando alguien pulso el boton.
    If Not silencioso Then
        MsgBox "No se pudo consultar si hay barridos encargados: " & Err.Description, vbExclamation
    End If
End Sub

Private Function KcmOrdenPendiente(ByVal respuesta As KcmDiccionario, _
    ByVal clave As String) As Boolean
    If respuesta.Exists(clave) Then
        KcmOrdenPendiente = (LCase$(CStr(respuesta.Item(clave))) = "true")
    End If
End Function

''' Consulta las ordenes cada pocos minutos mientras Excel siga abierto.
'''
''' Es idempotente: iniciar dos veces no programa dos relojes, porque antes de
''' programar cancela lo que hubiera pendiente.
Public Sub KcmIniciarVigilancia()
    KcmDetenerVigilancia
    mVigilando = True
    KcmProgramarSiguiente
    MsgBox "Vigilancia de barridos activa: se consultara cada " & _
        CStr(KcmVigilanciaMinutos()) & " minutos mientras Excel siga abierto." & vbCrLf & vbCrLf & _
        "Se detiene con el boton Detener vigilancia o al cerrar Excel.", vbInformation
End Sub

''' Cancela el reloj. Cerrar Excel tiene el mismo efecto.
Public Sub KcmDetenerVigilancia()
    If mProximaCorrida > 0 Then
        On Error Resume Next
        Application.OnTime EarliestTime:=mProximaCorrida, _
            Procedure:="KcmVigilanciaTick", Schedule:=False
        On Error GoTo 0
    End If
    mProximaCorrida = 0
    mVigilando = False
End Sub

''' Una vuelta de la vigilancia. La llama el reloj de Excel, nunca una persona.
'''
''' Se reprograma al final y no al principio: si la consulta o el barrido tardan
''' mas que el intervalo, las vueltas se espacian solas en lugar de encimarse.
Public Sub KcmVigilanciaTick()
    If Not mVigilando Then Exit Sub
    mProximaCorrida = 0
    KcmAtenderOrdenDeBarrido True
    If mVigilando Then KcmProgramarSiguiente
End Sub

Private Sub KcmProgramarSiguiente()
    mProximaCorrida = Now + TimeSerial(0, KcmVigilanciaMinutos(), 0)
    Application.OnTime EarliestTime:=mProximaCorrida, _
        Procedure:="KcmVigilanciaTick", Schedule:=True
End Sub

''' Intervalo declarado en KCM_CONFIG, con piso. Se lee en cada vuelta para que
''' cambiarlo surta efecto sin reiniciar la vigilancia.
Private Function KcmVigilanciaMinutos() As Long
    Dim declarado As String
    Dim minutos As Long

    declarado = KcmConfigValue("SCAN_POLL_MINUTES", False)
    If Len(declarado) = 0 Then
        minutos = VIGILANCIA_MINUTOS_OMISION
    Else
        minutos = CLng(Val(declarado))
    End If
    If minutos < VIGILANCIA_MINUTOS_MINIMO Then minutos = VIGILANCIA_MINUTOS_MINIMO
    KcmVigilanciaMinutos = minutos
End Function
