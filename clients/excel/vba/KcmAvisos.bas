Attribute VB_Name = "KcmAvisos"
Option Explicit
Option Private Module

Private Const MARCA As String = "Plataforma KCM"

Public Sub KcmAvisoHecho(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal detalle As String = "")
    MsgBox KcmAvisoCuerpo(mensaje, detalle), vbInformation, KcmAvisoTitulo(accion)
End Sub

Public Sub KcmAvisoAtencion(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal detalle As String = "")
    MsgBox KcmAvisoCuerpo(mensaje, detalle), vbExclamation, KcmAvisoTitulo(accion)
End Sub

Public Sub KcmAvisoFallo(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal causa As String = "")
    Dim cuerpo As String

    cuerpo = mensaje
    If Len(causa) > 0 Then cuerpo = cuerpo & vbCrLf & vbCrLf & "Detalle tecnico: " & causa
    MsgBox cuerpo, vbCritical, KcmAvisoTitulo(accion)
End Sub

Public Function KcmAvisoConfirmar(ByVal accion As String, ByVal mensaje As String, _
    Optional ByVal detalle As String = "") As Boolean
    KcmAvisoConfirmar = (MsgBox(KcmAvisoCuerpo(mensaje, detalle), _
        vbQuestion + vbYesNo + vbDefaultButton2, KcmAvisoTitulo(accion)) = vbYes)
End Function

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
