Attribute VB_Name = "KcmCodec"
Option Explicit
Option Private Module

Private Const KCM_B64_ESTANDAR As String = _
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
Private Const KCM_B64_WEB As String = _
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
Private Const KCM_HEX As String = "0123456789abcdef"
Private Const KCM_HEX_MAYUSCULA As String = "0123456789ABCDEF"

Private Const KCM_REEMPLAZO As Long = &HFFFD&

Public Sub KcmUtf8Codificar(ByVal value As String, ByRef salida() As Byte, ByRef usados As Long)
    Dim origen() As Byte
    Dim indice As Long
    Dim tope As Long
    Dim punto As Long
    Dim siguiente As Long

    usados = 0
    ReDim salida(0 To 7)
    If Len(value) = 0 Then Exit Sub

    origen = value
    tope = UBound(origen)
    ReDim salida(0 To (Len(value) * 3) - 1)

    indice = 0
    Do While indice < tope
        punto = origen(indice + 1) * 256& + origen(indice)
        indice = indice + 2
        If punto >= &HD800& And punto <= &HDBFF& And indice < tope Then
            siguiente = origen(indice + 1) * 256& + origen(indice)
            If siguiente >= &HDC00& And siguiente <= &HDFFF& Then
                punto = &H10000 + ((punto - &HD800&) * &H400&) + (siguiente - &HDC00&)
                indice = indice + 2
            End If
        End If

        If punto < &H80& Then
            salida(usados) = punto
            usados = usados + 1
        ElseIf punto < &H800& Then
            salida(usados) = &HC0& Or (punto \ &H40&)
            salida(usados + 1) = &H80& Or (punto And &H3F&)
            usados = usados + 2
        ElseIf punto < &H10000 Then
            salida(usados) = &HE0& Or (punto \ &H1000&)
            salida(usados + 1) = &H80& Or ((punto \ &H40&) And &H3F&)
            salida(usados + 2) = &H80& Or (punto And &H3F&)
            usados = usados + 3
        Else
            salida(usados) = &HF0& Or (punto \ &H40000)
            salida(usados + 1) = &H80& Or ((punto \ &H1000&) And &H3F&)
            salida(usados + 2) = &H80& Or ((punto \ &H40&) And &H3F&)
            salida(usados + 3) = &H80& Or (punto And &H3F&)
            usados = usados + 4
        End If
    Loop
End Sub

Public Sub KcmUtf8Emitir(ByRef salida() As Byte, ByRef usados As Long, ByVal punto As Long)
    If punto < &H80& Then
        salida(usados) = punto
        usados = usados + 1
    ElseIf punto < &H800& Then
        salida(usados) = &HC0& Or (punto \ &H40&)
        salida(usados + 1) = &H80& Or (punto And &H3F&)
        usados = usados + 2
    ElseIf punto < &H10000 Then
        salida(usados) = &HE0& Or (punto \ &H1000&)
        salida(usados + 1) = &H80& Or ((punto \ &H40&) And &H3F&)
        salida(usados + 2) = &H80& Or (punto And &H3F&)
        usados = usados + 3
    Else
        salida(usados) = &HF0& Or (punto \ &H40000)
        salida(usados + 1) = &H80& Or ((punto \ &H1000&) And &H3F&)
        salida(usados + 2) = &H80& Or ((punto \ &H40&) And &H3F&)
        salida(usados + 3) = &H80& Or (punto And &H3F&)
        usados = usados + 4
    End If
End Sub

Public Function KcmUtf8Texto(ByRef bytes() As Byte, ByVal usados As Long) As String
    Dim destino() As Byte
    Dim indice As Long
    Dim escritos As Long
    Dim primero As Long
    Dim punto As Long
    Dim unidad As Long

    If usados <= 0 Then Exit Function
    ReDim destino(0 To (usados * 2) - 1)

    indice = 0
    escritos = 0
    Do While indice < usados
        primero = bytes(indice)
        If primero < &H80& Then
            punto = primero
            indice = indice + 1
        ElseIf (primero And &HE0&) = &HC0& And indice + 1 < usados Then
            punto = ((primero And &H1F&) * &H40&) Or (bytes(indice + 1) And &H3F&)
            indice = indice + 2
        ElseIf (primero And &HF0&) = &HE0& And indice + 2 < usados Then
            punto = ((primero And &HF&) * &H1000&) Or ((bytes(indice + 1) And &H3F&) * &H40&) _
                Or (bytes(indice + 2) And &H3F&)
            indice = indice + 3
        ElseIf (primero And &HF8&) = &HF0& And indice + 3 < usados Then
            punto = ((primero And &H7&) * &H40000) Or ((bytes(indice + 1) And &H3F&) * &H1000&) _
                Or ((bytes(indice + 2) And &H3F&) * &H40&) Or (bytes(indice + 3) And &H3F&)
            indice = indice + 4
        Else
            punto = KCM_REEMPLAZO
            indice = indice + 1
        End If

        If punto >= &H10000 Then
            punto = punto - &H10000
            unidad = &HD800& Or (punto \ &H400&)
            destino(escritos) = unidad And &HFF&
            destino(escritos + 1) = unidad \ &H100&
            unidad = &HDC00& Or (punto And &H3FF&)
            destino(escritos + 2) = unidad And &HFF&
            destino(escritos + 3) = unidad \ &H100&
            escritos = escritos + 4
        Else
            destino(escritos) = punto And &HFF&
            destino(escritos + 1) = punto \ &H100&
            escritos = escritos + 2
        End If
    Loop

    If escritos = 0 Then Exit Function
    If escritos < UBound(destino) + 1 Then ReDim Preserve destino(0 To escritos - 1)
    KcmUtf8Texto = destino
End Function

Private Function KcmBase64Con(ByRef bytes() As Byte, ByVal usados As Long, _
    ByVal alfabeto As String, ByVal conRelleno As Boolean) As String
    Dim tabla() As Byte
    Dim destino() As Byte
    Dim grupos As Long
    Dim sobrantes As Long
    Dim caracteres As Long
    Dim indice As Long
    Dim origen As Long
    Dim destinoIndice As Long
    Dim valor As Long

    If usados <= 0 Then Exit Function
    tabla = alfabeto
    grupos = usados \ 3
    sobrantes = usados - grupos * 3
    caracteres = grupos * 4
    If sobrantes > 0 Then
        If conRelleno Then
            caracteres = caracteres + 4
        Else
            caracteres = caracteres + sobrantes + 1
        End If
    End If
    ReDim destino(0 To (caracteres * 2) - 1)

    destinoIndice = 0
    For indice = 0 To grupos - 1
        origen = indice * 3
        valor = bytes(origen) * &H10000 + bytes(origen + 1) * &H100& + bytes(origen + 2)
        destino(destinoIndice) = tabla(((valor \ &H40000) And &H3F&) * 2)
        destino(destinoIndice + 2) = tabla(((valor \ &H1000&) And &H3F&) * 2)
        destino(destinoIndice + 4) = tabla(((valor \ &H40&) And &H3F&) * 2)
        destino(destinoIndice + 6) = tabla((valor And &H3F&) * 2)
        destinoIndice = destinoIndice + 8
    Next indice

    If sobrantes = 1 Then
        origen = grupos * 3
        valor = bytes(origen) * &H10000
        destino(destinoIndice) = tabla(((valor \ &H40000) And &H3F&) * 2)
        destino(destinoIndice + 2) = tabla(((valor \ &H1000&) And &H3F&) * 2)
        destinoIndice = destinoIndice + 4
        If conRelleno Then
            destino(destinoIndice) = 61
            destino(destinoIndice + 2) = 61
            destinoIndice = destinoIndice + 4
        End If
    ElseIf sobrantes = 2 Then
        origen = grupos * 3
        valor = bytes(origen) * &H10000 + bytes(origen + 1) * &H100&
        destino(destinoIndice) = tabla(((valor \ &H40000) And &H3F&) * 2)
        destino(destinoIndice + 2) = tabla(((valor \ &H1000&) And &H3F&) * 2)
        destino(destinoIndice + 4) = tabla(((valor \ &H40&) And &H3F&) * 2)
        destinoIndice = destinoIndice + 6
        If conRelleno Then
            destino(destinoIndice) = 61
            destinoIndice = destinoIndice + 2
        End If
    End If

    KcmBase64Con = destino
End Function

Public Function KcmBytesBase64(ByRef bytes() As Byte, ByVal usados As Long) As String
    KcmBytesBase64 = KcmBase64Con(bytes, usados, KCM_B64_ESTANDAR, True)
End Function

Public Function KcmBase64WebEncode(ByVal value As String) As String
    Dim bytes() As Byte
    Dim usados As Long
    If Len(value) = 0 Then Exit Function
    KcmUtf8Codificar value, bytes, usados
    KcmBase64WebEncode = KcmBase64Con(bytes, usados, KCM_B64_WEB, False)
End Function

Public Function KcmBase64WebDecode(ByVal value As String) As String
    Dim inversa(0 To 255) As Byte
    Dim origen() As Byte
    Dim salida() As Byte
    Dim indice As Long
    Dim tope As Long
    Dim codigo As Long
    Dim valor As Long
    Dim acumulados As Long
    Dim usados As Long

    If Len(value) = 0 Then Exit Function
    KcmBase64Inversa inversa
    origen = value
    tope = UBound(origen)
    ReDim salida(0 To ((Len(value) \ 4) + 1) * 3)

    valor = 0
    acumulados = 0
    usados = 0
    For indice = 0 To tope Step 2
        If origen(indice + 1) = 0 Then
            codigo = inversa(origen(indice))
            If codigo < 64 Then
                valor = valor * 64 + codigo
                acumulados = acumulados + 1
                If acumulados = 4 Then
                    salida(usados) = (valor \ &H10000) And &HFF&
                    salida(usados + 1) = (valor \ &H100&) And &HFF&
                    salida(usados + 2) = valor And &HFF&
                    usados = usados + 3
                    valor = 0
                    acumulados = 0
                End If
            End If
        End If
    Next indice

    If acumulados = 2 Then
        valor = valor * 4096
        salida(usados) = (valor \ &H10000) And &HFF&
        usados = usados + 1
    ElseIf acumulados = 3 Then
        valor = valor * 64
        salida(usados) = (valor \ &H10000) And &HFF&
        salida(usados + 1) = (valor \ &H100&) And &HFF&
        usados = usados + 2
    End If

    KcmBase64WebDecode = KcmUtf8Texto(salida, usados)
End Function

Private Sub KcmBase64Inversa(ByRef inversa() As Byte)
    Dim tabla() As Byte
    Dim indice As Long
    For indice = 0 To 255
        inversa(indice) = 255
    Next indice
    tabla = KCM_B64_ESTANDAR
    For indice = 0 To 63
        inversa(tabla(indice * 2)) = indice
    Next indice
    tabla = KCM_B64_WEB
    For indice = 0 To 63
        inversa(tabla(indice * 2)) = indice
    Next indice
End Sub

Public Function KcmUrlEncode(ByVal value As String) As String
    Dim bytes() As Byte
    Dim usados As Long
    Dim destino() As Byte
    Dim digitos() As Byte
    Dim indice As Long
    Dim escritos As Long
    Dim byteValue As Long

    If Len(value) = 0 Then Exit Function
    KcmUtf8Codificar value, bytes, usados
    If usados = 0 Then Exit Function
    digitos = KCM_HEX_MAYUSCULA
    ReDim destino(0 To (usados * 6) - 1)

    escritos = 0
    For indice = 0 To usados - 1
        byteValue = bytes(indice)
        If (byteValue >= 65 And byteValue <= 90) Or (byteValue >= 97 And byteValue <= 122) Or _
            (byteValue >= 48 And byteValue <= 57) Or byteValue = 45 Or byteValue = 46 Or _
            byteValue = 95 Or byteValue = 126 Then
            destino(escritos) = byteValue
            escritos = escritos + 2
        Else
            destino(escritos) = 37
            destino(escritos + 2) = digitos((byteValue \ 16) * 2)
            destino(escritos + 4) = digitos((byteValue And 15) * 2)
            escritos = escritos + 6
        End If
    Next indice

    If escritos < UBound(destino) + 1 Then ReDim Preserve destino(0 To escritos - 1)
    KcmUrlEncode = destino
End Function

Public Function KcmUrlDecode(ByVal value As String) As String
    Dim origen() As Byte
    Dim salida() As Byte
    Dim indice As Long
    Dim tope As Long
    Dim usados As Long
    Dim punto As Long
    Dim alto As Long
    Dim bajo As Long

    If Len(value) = 0 Then Exit Function
    origen = value
    tope = UBound(origen)
    ReDim salida(0 To (Len(value) * 3) - 1)

    indice = 0
    usados = 0
    Do While indice < tope
        punto = origen(indice + 1) * 256& + origen(indice)
        If punto = 37 Then
            If indice + 5 > tope Then Err.Raise vbObjectError + 7210, "KcmUrlDecode", _
                "Texto URL invalido"
            alto = KcmValorHex(origen(indice + 3) * 256& + origen(indice + 2))
            bajo = KcmValorHex(origen(indice + 5) * 256& + origen(indice + 4))
            If alto < 0 Or bajo < 0 Then Err.Raise vbObjectError + 7210, "KcmUrlDecode", _
                "Texto URL invalido"
            salida(usados) = alto * 16 + bajo
            usados = usados + 1
            indice = indice + 6
        ElseIf punto = 43 Then
            salida(usados) = 32
            usados = usados + 1
            indice = indice + 2
        ElseIf punto < &H80& Then
            salida(usados) = punto
            usados = usados + 1
            indice = indice + 2
        Else
            KcmUtf8Emitir salida, usados, punto
            indice = indice + 2
        End If
    Loop

    KcmUrlDecode = KcmUtf8Texto(salida, usados)
End Function

Private Function KcmValorHex(ByVal codigo As Long) As Long
    If codigo >= 48 And codigo <= 57 Then
        KcmValorHex = codigo - 48
    ElseIf codigo >= 65 And codigo <= 70 Then
        KcmValorHex = codigo - 55
    ElseIf codigo >= 97 And codigo <= 102 Then
        KcmValorHex = codigo - 87
    Else
        KcmValorHex = -1
    End If
End Function

Public Function KcmHexadecimal(ByRef bytes() As Byte, ByVal usados As Long) As String
    Dim digitos() As Byte
    Dim destino() As Byte
    Dim indice As Long
    Dim valor As Long

    If usados <= 0 Then Exit Function
    digitos = KCM_HEX
    ReDim destino(0 To (usados * 4) - 1)
    For indice = 0 To usados - 1
        valor = bytes(indice)
        destino(indice * 4) = digitos((valor \ 16) * 2)
        destino(indice * 4 + 2) = digitos((valor And 15) * 2)
    Next indice
    KcmHexadecimal = destino
End Function
