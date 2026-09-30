VERSION 1.0 CLASS
BEGIN
  MultiUse = -1
END
Attribute VB_Name = "KcmDiccionario"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = False
Attribute VB_Exposed = False
Option Explicit

Private mIndice As Collection
Private mClaves() As String
Private mValores() As Variant
Private mTotal As Long
Private mCapacidad As Long
Private mComparacion As Long

Private Sub Class_Initialize()
    mCapacidad = 16
    mTotal = 0
    mComparacion = vbBinaryCompare
    Set mIndice = New Collection
    ReDim mClaves(1 To mCapacidad)
    ReDim mValores(1 To mCapacidad)
End Sub

Private Sub Class_Terminate()
    Set mIndice = Nothing
End Sub

Public Property Let CompareMode(ByVal valor As Long)
    If valor <> vbBinaryCompare Then Err.Raise vbObjectError + 7151, "KcmDiccionario", _
        "El diccionario del cliente solo compara claves de forma binaria"
    mComparacion = valor
End Property

Public Property Get CompareMode() As Long
    CompareMode = mComparacion
End Property

Public Property Get Count() As Long
    Count = mTotal
End Property

Public Sub Add(ByVal clave As String, ByRef valor As Variant)
    Dim codificada As String
    codificada = KcmDicCodificar(clave)
    If KcmDicPosicion(codificada) > 0 Then Err.Raise 457, "KcmDiccionario.Add", _
        "La clave ya existe en el diccionario"
    If mTotal = mCapacidad Then KcmDicCrecer
    mTotal = mTotal + 1
    mClaves(mTotal) = clave
    If IsObject(valor) Then
        Set mValores(mTotal) = valor
    Else
        mValores(mTotal) = valor
    End If
    mIndice.Add mTotal, codificada
End Sub

Public Sub AgregarObjeto(ByVal clave As String, ByVal valor As Object)
    Dim codificada As String
    codificada = KcmDicCodificar(clave)
    If KcmDicPosicion(codificada) > 0 Then Err.Raise 457, "KcmDiccionario.AgregarObjeto", _
        "La clave ya existe en el diccionario"
    If mTotal = mCapacidad Then KcmDicCrecer
    mTotal = mTotal + 1
    mClaves(mTotal) = clave
    Set mValores(mTotal) = valor
    mIndice.Add mTotal, codificada
End Sub

Public Function Exists(ByVal clave As String) As Boolean
    Exists = (KcmDicPosicion(KcmDicCodificar(clave)) > 0)
End Function

Public Property Get Item(ByVal clave As String) As Variant
    Dim posicion As Long
    posicion = KcmDicPosicion(KcmDicCodificar(clave))
    If posicion = 0 Then Exit Property
    If IsObject(mValores(posicion)) Then
        Set Item = mValores(posicion)
    Else
        Item = mValores(posicion)
    End If
End Property

Public Function Objeto(ByVal clave As String) As Object
    Dim posicion As Long
    posicion = KcmDicPosicion(KcmDicCodificar(clave))
    If posicion = 0 Then Err.Raise vbObjectError + 7150, "KcmDiccionario.Objeto", _
        "La clave " & clave & " no existe en el diccionario"
    Set Objeto = mValores(posicion)
End Function

Public Sub Fijar(ByVal clave As String, ByRef valor As Variant)
    Dim codificada As String
    Dim posicion As Long
    codificada = KcmDicCodificar(clave)
    posicion = KcmDicPosicion(codificada)
    If posicion = 0 Then
        Add clave, valor
        Exit Sub
    End If
    If IsObject(valor) Then
        Set mValores(posicion) = valor
    Else
        mValores(posicion) = valor
    End If
End Sub

Public Function Keys() As Variant
    Dim salida() As String
    Dim indice As Long
    If mTotal = 0 Then
        Keys = Array()
        Exit Function
    End If
    ReDim salida(0 To mTotal - 1)
    For indice = 1 To mTotal
        salida(indice - 1) = mClaves(indice)
    Next indice
    Keys = salida
End Function

Private Function KcmDicPosicion(ByVal codificada As String) As Long
    On Error Resume Next
    KcmDicPosicion = CLng(mIndice.Item(codificada))
    If Err.Number <> 0 Then
        Err.Clear
        KcmDicPosicion = 0
    End If
    On Error GoTo 0
End Function

Private Function KcmDicCodificar(ByVal clave As String) As String
    Dim origen() As Byte
    Dim destino() As Byte
    Dim digitos() As Byte
    Dim indice As Long
    Dim valor As Long

    If Len(clave) = 0 Then
        KcmDicCodificar = "-"
        Exit Function
    End If
    origen = clave
    digitos = "0123456789abcdef"
    ReDim destino(0 To (Len(clave) * 8) - 1)
    For indice = 0 To Len(clave) - 1
        valor = origen(indice * 2 + 1)
        destino(indice * 8) = digitos((valor \ 16) * 2)
        destino(indice * 8 + 2) = digitos((valor And 15) * 2)
        valor = origen(indice * 2)
        destino(indice * 8 + 4) = digitos((valor \ 16) * 2)
        destino(indice * 8 + 6) = digitos((valor And 15) * 2)
    Next indice
    KcmDicCodificar = destino
End Function

Private Sub KcmDicCrecer()
    mCapacidad = mCapacidad * 2
    ReDim Preserve mClaves(1 To mCapacidad)
    ReDim Preserve mValores(1 To mCapacidad)
End Sub
