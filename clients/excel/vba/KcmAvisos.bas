Attribute VB_Name = "KcmAvisos"
Option Explicit
Option Private Module

' Modulo interno: sus rutinas las llaman otros modulos del cliente y no aparecen
' en Herramientas > Macros, donde solo quedan las que se usan a mano.

' La voz del cliente.
'
' Los cuarenta y ocho avisos de este cliente los escribio quien escribia la
' rutina, uno a uno, y se nota. Unos llevan titulo y la mayoria no. Unos
' terminan en punto y otros en dos puntos con el mensaje crudo del sistema
' pegado detras. Varios hablan de snapshots, subpaneles y caches, que son
' palabras del programa y no del trabajo. Leidos en fila no parecen una
' plataforma: parecen notas que alguien fue dejando en el escritorio.
'
' Este modulo es el unico sitio del cliente donde se abre un cuadro de dialogo.
' No aporta logica; aporta forma. Y la forma es lo que hace que el mismo aviso
' suene a herramienta de la empresa en vez de a recado.
'
' -- Las cinco reglas ------------------------------------------------------
'
' 1. TODO AVISO LLEVA TITULO. Sin el, Excel escribe "Microsoft Excel" en la
'    barra y el mensaje parece venir de la hoja de calculo. Con el, viene de la
'    Plataforma KCM y dice de que accion habla antes de que nadie lea el texto.
' 2. LA PRIMERA LINEA ES EL DESENLACE, y es una oracion completa. Nadie lee el
'    segundo parrafo de un cuadro de dialogo antes de decidir.
' 3. EL DETALLE VA APARTE, tras una linea en blanco. Lo que hay que hacer a
'    continuacion no se mezcla con lo que acaba de pasar.
' 4. NO HAY PARENTESIS NI TERMINACIONES ENTRE PARENTESIS. El plural se resuelve,
'    no se insinua: una liberacion o cuatro liberaciones, nunca "1 sesion(es)".
' 5. NADA DE VOCABULARIO INTERNO. Quien lee tiene una matriz, un padron y un
'    libro. No tiene snapshots, ni caches, ni subpaneles.
'
' Los errores llevan ademas su propia regla: primero lo que NO ocurrio, y solo
' despues la causa tecnica, rotulada y en su renglon. El mensaje del sistema
' pegado detras de dos puntos es justo lo que hace que un aviso parezca escrito
' para quien programo y no para quien opera.

Private Const MARCA As String = "Plataforma KCM"

''' Un hecho consumado. No pregunta nada y no exige nada.
Public Sub KcmAvisoHecho(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal detalle As String = "")
    MsgBox KcmAvisoCuerpo(mensaje, detalle), vbInformation, KcmAvisoTitulo(accion)
End Sub

''' Algo quedo pendiente o falta un paso antes. No es un fallo del programa.
Public Sub KcmAvisoAtencion(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal detalle As String = "")
    MsgBox KcmAvisoCuerpo(mensaje, detalle), vbExclamation, KcmAvisoTitulo(accion)
End Sub

''' La accion no se completo. `causa` es lo que dijo el sistema, y va rotulado.
Public Sub KcmAvisoFallo(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal causa As String = "")
    Dim cuerpo As String

    cuerpo = mensaje
    If Len(causa) > 0 Then cuerpo = cuerpo & vbCrLf & vbCrLf & "Detalle tecnico: " & causa
    MsgBox cuerpo, vbCritical, KcmAvisoTitulo(accion)
End Sub

''' Una decision que se va a ejecutar. Verdadero solo si se contesto que si.
'''
''' El boton predeterminado es No a proposito: la tecla Entrar pulsada por
''' inercia no debe disparar una escritura en la matriz.
Public Function KcmAvisoConfirmar(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal detalle As String = "") As Boolean
    KcmAvisoConfirmar = (MsgBox(KcmAvisoCuerpo(mensaje, detalle), _
        vbQuestion + vbYesNo + vbDefaultButton2, KcmAvisoTitulo(accion)) = vbYes)
End Function

''' Cuenta y sustantivo concordados: "1 liberacion", "4 liberaciones".
Public Function KcmPlural(ByVal cuantos As Long, ByVal singular As String, _
    ByVal plural As String) As String
    If cuantos = 1 Then
        KcmPlural = "1 " & singular
    Else
        KcmPlural = CStr(cuantos) & " " & plural
    End If
End Function

Private Function KcmAvisoTitulo(ByVal accion As String) As String
    If Len(accion) = 0 Then
        KcmAvisoTitulo = MARCA
    Else
        KcmAvisoTitulo = MARCA & " - " & accion
    End If
End Function

Private Function KcmAvisoCuerpo(ByVal mensaje As String, ByVal detalle As String) As String
    If Len(detalle) = 0 Then
        KcmAvisoCuerpo = mensaje
    Else
        KcmAvisoCuerpo = mensaje & vbCrLf & vbCrLf & detalle
    End If
End Function
