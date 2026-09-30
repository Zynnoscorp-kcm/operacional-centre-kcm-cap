Attribute VB_Name = "KcmPlataforma"
Option Explicit
Option Private Module

Private Const KCM_MAC_GUION As String = "KcmPuente.applescript"
Private Const KCM_MAC_CUENTA As String = "KCM_PUENTE_VBA"
Private Const KCM_MAX_UPLOAD_BYTES As Long = 8388608

Private mTareaDisponible As Long
Private mDesfaseMinutos As Long
Private mDesfaseMedidoEn As Date
Private mAleatorio As String
Private mAleatorioUsado As Long
Private mContador As Long
Private mSemillaPuesta As Boolean
Private mConcedidas As KcmDiccionario

#If Mac Then

    #If VBA7 Then
        Private Declare PtrSafe Function KcmPopen Lib "/usr/lib/libSystem.dylib" _
            Alias "popen" (ByVal comando As String, ByVal modo As String) As LongPtr
        Private Declare PtrSafe Function KcmPclose Lib "/usr/lib/libSystem.dylib" _
            Alias "pclose" (ByVal flujo As LongPtr) As Long
        Private Declare PtrSafe Function KcmFread Lib "/usr/lib/libSystem.dylib" _
            Alias "fread" (ByVal destino As String, ByVal tamano As LongPtr, _
            ByVal elementos As LongPtr, ByVal flujo As LongPtr) As LongPtr
    #Else
        Private Declare Function KcmPopen Lib "libc.dylib" _
            Alias "popen" (ByVal comando As String, ByVal modo As String) As Long
        Private Declare Function KcmPclose Lib "libc.dylib" _
            Alias "pclose" (ByVal flujo As Long) As Long
        Private Declare Function KcmFread Lib "libc.dylib" _
            Alias "fread" (ByVal destino As String, ByVal tamano As Long, _
            ByVal elementos As Long, ByVal flujo As Long) As Long
    #End If

Private Function KcmMacCorrer(ByVal argv As String, ByRef salida As String) As Boolean
    Dim piezas As Variant
    Dim indice As Long
    Dim orden As String
    Dim codigo As Long

    salida = ""
    If mTareaDisponible <> 2 Then
        If KcmMacTarea(argv, salida) Then
            KcmMacCorrer = True
            Exit Function
        End If
        If mTareaDisponible = 1 Then Exit Function
    End If

    piezas = Split(argv, vbTab)
    For indice = LBound(piezas) To UBound(piezas)
        orden = orden & KcmCitarShell(CStr(piezas(indice))) & " "
    Next indice
    salida = KcmMacPopen(orden & "2>&1", codigo)
    Do While Len(salida) > 0
        If Right$(salida, 1) <> vbLf And Right$(salida, 1) <> vbCr Then Exit Do
        salida = Left$(salida, Len(salida) - 1)
    Loop
    KcmMacCorrer = (codigo = 0)
End Function

Private Function KcmMacTarea(ByVal argv As String, ByRef salida As String) As Boolean
    Dim crudo As String

    On Error GoTo SinGuion
    crudo = CStr(AppleScriptTask(KCM_MAC_GUION, "kcmComando", argv))
    On Error GoTo 0
    mTareaDisponible = 1
    If Left$(crudo, 3) = "OK:" Then
        salida = Mid$(crudo, 4)
        KcmMacTarea = True
    Else
        salida = Mid$(crudo, 5)
    End If
    Exit Function

SinGuion:
    mTareaDisponible = 2
    salida = "el guion " & KCM_MAC_GUION & " no respondio: " & Err.Description
End Function

Private Function KcmMacPopen(ByVal orden As String, ByRef codigo As Long) As String
    #If VBA7 Then
        Dim flujo As LongPtr
        Dim leidos As LongPtr
    #Else
        Dim flujo As Long
        Dim leidos As Long
    #End If
    Dim trozo As String
    Dim salida As String

    codigo = -1
    flujo = KcmPopen(orden, "r")
    If flujo = 0 Then Exit Function
    Do
        trozo = Space$(4096)
        leidos = KcmFread(trozo, 1, Len(trozo) - 1, flujo)
        If leidos > 0 Then salida = salida & Left$(trozo, CLng(leidos))
    Loop While leidos > 0
    codigo = KcmPclose(flujo) \ 256
    KcmMacPopen = salida
End Function

Private Function KcmCitarShell(ByVal valor As String) As String
    KcmCitarShell = "'" & Replace$(valor, "'", "'\''") & "'"
End Function

Private Function KcmPostMac(ByVal endpoint As String, ByVal cuerpo As String, _
    ByRef estado As Long, ByRef respuesta As String, ByRef fallo As String) As Boolean
    Dim marca As String
    Dim rutaCuerpo As String
    Dim rutaRespuesta As String
    Dim argv As String
    Dim salida As String

    marca = KcmNewGuidHex()
    rutaCuerpo = KcmCarpetaTemporal() & "kcm-envio-" & marca & ".txt"
    rutaRespuesta = KcmCarpetaTemporal() & "kcm-respuesta-" & marca & ".txt"

    On Error GoTo FalloMac
    KcmEscribirTexto rutaCuerpo, cuerpo
    argv = "/usr/bin/curl" & vbTab & "--silent" & vbTab & "--show-error" & vbTab & _
        "--request" & vbTab & "POST" & vbTab & _
        "--header" & vbTab & _
        "Content-Type: application/x-www-form-urlencoded; charset=utf-8" & vbTab & _
        "--header" & vbTab & "Accept: text/plain" & vbTab & _
        "--connect-timeout" & vbTab & "15" & vbTab & _
        "--max-time" & vbTab & "300" & vbTab & _
        "--data-binary" & vbTab & "@" & rutaCuerpo & vbTab & _
        "--output" & vbTab & rutaRespuesta & vbTab & _
        "--write-out" & vbTab & "%{http_code}" & vbTab & endpoint

    If Not KcmMacCorrer(argv, salida) Then
        fallo = "curl no pudo enviar la peticion: " & salida
        KcmBorrarArchivo rutaCuerpo
        KcmBorrarArchivo rutaRespuesta
        Exit Function
    End If
    estado = CLng(Val(KcmUltimaLinea(salida)))
    respuesta = KcmLeerTexto(rutaRespuesta)
    KcmBorrarArchivo rutaCuerpo
    KcmBorrarArchivo rutaRespuesta
    KcmPostMac = True
    Exit Function

FalloMac:
    fallo = Err.Description
    On Error Resume Next
    KcmBorrarArchivo rutaCuerpo
    KcmBorrarArchivo rutaRespuesta
    Err.Clear
    On Error GoTo 0
End Function

Private Function KcmUltimaLinea(ByVal texto As String) As String
    Dim lineas As Variant
    Dim indice As Long
    lineas = Split(Replace$(Replace$(texto, vbCrLf, vbLf), vbCr, vbLf), vbLf)
    For indice = UBound(lineas) To LBound(lineas) Step -1
        If Len(Trim$(CStr(lineas(indice)))) > 0 Then
            KcmUltimaLinea = Trim$(CStr(lineas(indice)))
            Exit Function
        End If
    Next indice
End Function

Private Sub KcmEscribirTexto(ByVal ruta As String, ByVal contenido As String)
    Dim bytes() As Byte
    Dim usados As Long
    Dim numero As Integer

    KcmBorrarArchivo ruta
    KcmUtf8Codificar contenido, bytes, usados
    If usados = 0 Then
        numero = FreeFile
        Open ruta For Output As #numero
        Close #numero
        Exit Sub
    End If
    ReDim Preserve bytes(0 To usados - 1)
    numero = FreeFile
    Open ruta For Binary Access Write As #numero
    Put #numero, 1, bytes
    Close #numero
    If FileLen(ruta) <> usados Then Err.Raise vbObjectError + 7233, "KcmEscribirTexto", _
        "El cuerpo de la peticion no se escribio completo en " & ruta
End Sub

Private Function KcmLeerTexto(ByVal ruta As String) As String
    Dim bytes() As Byte
    Dim numero As Integer
    Dim tamano As Long

    numero = FreeFile
    Open ruta For Binary Access Read Shared As #numero
    tamano = LOF(numero)
    If tamano <= 0 Then
        Close #numero
        Exit Function
    End If
    ReDim bytes(0 To tamano - 1)
    Get #numero, 1, bytes
    Close #numero
    KcmLeerTexto = KcmUtf8Texto(bytes, tamano)
End Function

Private Function KcmDesfaseUtcMinutos() As Long
    Dim salida As String
    Dim signo As Long

    If mDesfaseMedidoEn > 0 Then
        If Abs(Now - mDesfaseMedidoEn) < (10# / 1440#) Then
            KcmDesfaseUtcMinutos = mDesfaseMinutos
            Exit Function
        End If
    End If
    If Not KcmMacCorrer("/bin/date" & vbTab & "+%z", salida) Then
        Err.Raise vbObjectError + 7230, "KcmDesfaseUtcMinutos", _
            "No fue posible leer la zona horaria del sistema: " & salida
    End If
    salida = Trim$(salida)
    If Len(salida) < 5 Then Err.Raise vbObjectError + 7230, "KcmDesfaseUtcMinutos", _
        "La zona horaria del sistema no se pudo interpretar: " & salida
    signo = 1
    If Left$(salida, 1) = "-" Then signo = -1
    mDesfaseMinutos = signo * (CLng(Val(Mid$(salida, 2, 2))) * 60 + CLng(Val(Mid$(salida, 4, 2))))
    mDesfaseMedidoEn = Now
    KcmDesfaseUtcMinutos = mDesfaseMinutos
End Function

Private Function KcmUtcMac() As String
    Dim utc As Date
    Dim milesimas As Long

    utc = Now - (KcmDesfaseUtcMinutos() / 1440#)
    milesimas = Int((Timer - Int(Timer)) * 1000)
    If milesimas < 0 Then milesimas = 0
    If milesimas > 999 Then milesimas = 999
    KcmUtcMac = Format$(utc, "yyyy-mm-dd") & "T" & Format$(utc, "hh:nn:ss") & _
        "." & Format$(milesimas, "000") & "Z"
End Function

Private Function KcmGuidMac() As String
    Dim salida As String
    Dim limpio As String
    Dim indice As Long
    Dim caracter As String

    If mAleatorioUsado + 32 > Len(mAleatorio) Then
        If KcmMacCorrer("/usr/bin/od" & vbTab & "-An" & vbTab & "-tx1" & vbTab & _
            "-N512" & vbTab & "/dev/urandom", salida) Then
            For indice = 1 To Len(salida)
                caracter = Mid$(salida, indice, 1)
                If InStr(1, "0123456789abcdefABCDEF", caracter, vbBinaryCompare) > 0 Then
                    limpio = limpio & LCase$(caracter)
                End If
            Next indice
        End If
        If Len(limpio) < 32 Then
            KcmGuidMac = KcmGuidDeRespaldo()
            Exit Function
        End If
        mAleatorio = limpio
        mAleatorioUsado = 0
    End If
    KcmGuidMac = Mid$(mAleatorio, mAleatorioUsado + 1, 32)
    mAleatorioUsado = mAleatorioUsado + 32
End Function

Private Function KcmGuidDeRespaldo() As String
    Dim salida As String
    Dim indice As Long

    If Not mSemillaPuesta Then
        Randomize
        mSemillaPuesta = True
    End If
    mContador = mContador + 1
    salida = Right$("00000000" & Hex$(mContador), 8) & _
        Right$("00000000" & Hex$(CLng(Timer * 1000)), 8)
    For indice = 1 To 4
        salida = salida & Right$("0000" & Hex$(Int(Rnd() * 65536)), 4)
    Next indice
    KcmGuidDeRespaldo = LCase$(Left$(salida, 32))
End Function

Private Function KcmSha256Mac(ByVal filePath As String) As String
    Dim salida As String
    Dim huella As String
    Dim copia As String

    If KcmMacCorrer("/usr/bin/shasum" & vbTab & "-a" & vbTab & "256" & vbTab & filePath, _
        salida) Then
        huella = KcmHuellaDeSalida(salida)
        If Len(huella) = 64 Then
            KcmSha256Mac = huella
            Exit Function
        End If
    End If

    copia = KcmCarpetaTemporal() & "kcm-huella-" & KcmNewGuidHex() & ".bin"
    On Error GoTo FalloCopia
    FileCopy filePath, copia
    On Error GoTo 0
    If KcmMacCorrer("/usr/bin/shasum" & vbTab & "-a" & vbTab & "256" & vbTab & copia, _
        salida) Then
        huella = KcmHuellaDeSalida(salida)
    End If
    KcmBorrarArchivo copia
    If Len(huella) <> 64 Then Err.Raise vbObjectError + 7211, "KcmFileSha256", _
        "No fue posible calcular la huella SHA-256 en macOS: " & salida
    KcmSha256Mac = huella
    Exit Function

FalloCopia:
    Err.Raise vbObjectError + 7211, "KcmFileSha256", _
        "No fue posible calcular la huella SHA-256 en macOS: " & Err.Description
End Function

Private Function KcmHuellaDeSalida(ByVal salida As String) As String
    Dim recortado As String
    recortado = LCase$(Trim$(salida))
    If Len(recortado) < 64 Then Exit Function
    recortado = Left$(recortado, 64)
    If recortado Like "*[!0-9a-f]*" Then Exit Function
    KcmHuellaDeSalida = recortado
End Function

#Else

Private Type KcmSystemTime
    Year As Integer
    Month As Integer
    DayOfWeek As Integer
    Day As Integer
    Hour As Integer
    Minute As Integer
    Second As Integer
    Milliseconds As Integer
End Type

Private Type KcmGuidValue
    Data1 As Long
    Data2 As Integer
    Data3 As Integer
    Data4(0 To 7) As Byte
End Type

Private Const KCM_PROV_RSA_AES As Long = 24
Private Const KCM_CRYPT_VERIFYCONTEXT As Long = &HF0000000
Private Const KCM_CALG_SHA_256 As Long = &H800C
Private Const KCM_HP_HASHVAL As Long = 2
Private Const KCM_HASH_CHUNK As Long = 1048576
Private Const KCM_PROV_AES_NAME As String = _
    "Microsoft Enhanced RSA and AES Cryptographic Provider"
Private Const KCM_PROV_AES_NAME_XP As String = _
    "Microsoft Enhanced RSA and AES Cryptographic Provider (Prototype)"

    #If VBA7 Then
        Private Declare PtrSafe Sub GetSystemTime Lib "kernel32" (ByRef value As KcmSystemTime)
        Private Declare PtrSafe Function CoCreateGuid Lib "ole32" (ByRef value As KcmGuidValue) As Long
        Private Declare PtrSafe Function CryptAcquireContext Lib "advapi32.dll" _
            Alias "CryptAcquireContextW" (ByRef phProv As LongPtr, ByVal pszContainer As LongPtr, _
            ByVal pszProvider As LongPtr, ByVal dwProvType As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function CryptReleaseContext Lib "advapi32.dll" ( _
            ByVal hProv As LongPtr, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function CryptCreateHash Lib "advapi32.dll" (ByVal hProv As LongPtr, _
            ByVal algId As Long, ByVal hKey As LongPtr, ByVal dwFlags As Long, _
            ByRef phHash As LongPtr) As Long
        Private Declare PtrSafe Function CryptHashData Lib "advapi32.dll" (ByVal hHash As LongPtr, _
            ByRef pbData As Byte, ByVal dwDataLen As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function CryptGetHashParam Lib "advapi32.dll" (ByVal hHash As LongPtr, _
            ByVal dwParam As Long, ByRef pbData As Byte, ByRef pdwDataLen As Long, _
            ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function CryptDestroyHash Lib "advapi32.dll" ( _
            ByVal hHash As LongPtr) As Long
        Private Declare PtrSafe Function BCryptOpenAlgorithmProvider Lib "bcrypt.dll" ( _
            ByRef phAlgorithm As LongPtr, ByVal pszAlgId As LongPtr, _
            ByVal pszImplementation As LongPtr, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function BCryptCloseAlgorithmProvider Lib "bcrypt.dll" ( _
            ByVal hAlgorithm As LongPtr, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function BCryptCreateHash Lib "bcrypt.dll" ( _
            ByVal hAlgorithm As LongPtr, ByRef phHash As LongPtr, ByVal pbHashObject As LongPtr, _
            ByVal cbHashObject As Long, ByVal pbSecret As LongPtr, ByVal cbSecret As Long, _
            ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function BCryptHashData Lib "bcrypt.dll" (ByVal hHash As LongPtr, _
            ByRef pbInput As Byte, ByVal cbInput As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function BCryptFinishHash Lib "bcrypt.dll" (ByVal hHash As LongPtr, _
            ByRef pbOutput As Byte, ByVal cbOutput As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function BCryptDestroyHash Lib "bcrypt.dll" ( _
            ByVal hHash As LongPtr) As Long
    #Else
        Private Declare Sub GetSystemTime Lib "kernel32" (ByRef value As KcmSystemTime)
        Private Declare Function CoCreateGuid Lib "ole32" (ByRef value As KcmGuidValue) As Long
        Private Declare Function CryptAcquireContext Lib "advapi32.dll" _
            Alias "CryptAcquireContextW" (ByRef phProv As Long, ByVal pszContainer As Long, _
            ByVal pszProvider As Long, ByVal dwProvType As Long, ByVal dwFlags As Long) As Long
        Private Declare Function CryptReleaseContext Lib "advapi32.dll" ( _
            ByVal hProv As Long, ByVal dwFlags As Long) As Long
        Private Declare Function CryptCreateHash Lib "advapi32.dll" (ByVal hProv As Long, _
            ByVal algId As Long, ByVal hKey As Long, ByVal dwFlags As Long, _
            ByRef phHash As Long) As Long
        Private Declare Function CryptHashData Lib "advapi32.dll" (ByVal hHash As Long, _
            ByRef pbData As Byte, ByVal dwDataLen As Long, ByVal dwFlags As Long) As Long
        Private Declare Function CryptGetHashParam Lib "advapi32.dll" (ByVal hHash As Long, _
            ByVal dwParam As Long, ByRef pbData As Byte, ByRef pdwDataLen As Long, _
            ByVal dwFlags As Long) As Long
        Private Declare Function CryptDestroyHash Lib "advapi32.dll" (ByVal hHash As Long) As Long
        Private Declare Function BCryptOpenAlgorithmProvider Lib "bcrypt.dll" ( _
            ByRef phAlgorithm As Long, ByVal pszAlgId As Long, _
            ByVal pszImplementation As Long, ByVal dwFlags As Long) As Long
        Private Declare Function BCryptCloseAlgorithmProvider Lib "bcrypt.dll" ( _
            ByVal hAlgorithm As Long, ByVal dwFlags As Long) As Long
        Private Declare Function BCryptCreateHash Lib "bcrypt.dll" (ByVal hAlgorithm As Long, _
            ByRef phHash As Long, ByVal pbHashObject As Long, ByVal cbHashObject As Long, _
            ByVal pbSecret As Long, ByVal cbSecret As Long, ByVal dwFlags As Long) As Long
        Private Declare Function BCryptHashData Lib "bcrypt.dll" (ByVal hHash As Long, _
            ByRef pbInput As Byte, ByVal cbInput As Long, ByVal dwFlags As Long) As Long
        Private Declare Function BCryptFinishHash Lib "bcrypt.dll" (ByVal hHash As Long, _
            ByRef pbOutput As Byte, ByVal cbOutput As Long, ByVal dwFlags As Long) As Long
        Private Declare Function BCryptDestroyHash Lib "bcrypt.dll" (ByVal hHash As Long) As Long
    #End If

Private Function KcmPostWindows(ByVal endpoint As String, ByVal cuerpo As String, _
    ByRef estado As Long, ByRef respuesta As String, ByRef fallo As String) As Boolean
    Dim peticion As Object

    On Error GoTo FalloTransporte
    Set peticion = CreateObject("WinHttp.WinHttpRequest.5.1")
    peticion.SetTimeouts 15000, 15000, 120000, 300000
    peticion.Open "POST", endpoint, False
    peticion.SetRequestHeader "Content-Type", "application/x-www-form-urlencoded; charset=utf-8"
    peticion.SetRequestHeader "Accept", "text/plain"
    peticion.Send cuerpo
    estado = CLng(peticion.status)
    respuesta = CStr(peticion.ResponseText)
    On Error GoTo 0
    KcmPostWindows = True
    Exit Function

FalloTransporte:
    fallo = Err.Description
End Function

Private Function KcmUtcWindows() As String
    Dim valor As KcmSystemTime
    GetSystemTime valor
    KcmUtcWindows = Format$(valor.Year, "0000") & "-" & Format$(valor.Month, "00") & "-" & _
        Format$(valor.Day, "00") & "T" & Format$(valor.Hour, "00") & ":" & _
        Format$(valor.Minute, "00") & ":" & Format$(valor.Second, "00") & "." & _
        Format$(valor.Milliseconds, "000") & "Z"
End Function

Private Function KcmGuidWindows() As String
    Dim valor As KcmGuidValue
    Dim salida As String
    Dim indice As Long
    If CoCreateGuid(valor) <> 0 Then Err.Raise vbObjectError + 7212, "KcmNewGuidHex", _
        "No fue posible generar un identificador unico"
    salida = Right$("00000000" & Hex$(valor.Data1), 8) & _
        Right$("0000" & Hex$(valor.Data2), 4) & _
        Right$("0000" & Hex$(valor.Data3), 4)
    For indice = 0 To 7
        salida = salida & Right$("0" & Hex$(valor.Data4(indice)), 2)
    Next indice
    KcmGuidWindows = LCase$(salida)
End Function

Private Function KcmSha256Cng(ByVal filePath As String, ByRef detalle As String) As String
    #If VBA7 Then
        Dim hAlg As LongPtr
        Dim hHash As LongPtr
    #Else
        Dim hAlg As Long
        Dim hHash As Long
    #End If
    Dim algId As String
    Dim buffer() As Byte
    Dim digest(0 To 31) As Byte
    Dim fileNumber As Integer
    Dim fileSize As Long
    Dim position As Long
    Dim take As Long
    Dim status As Long

    algId = "SHA256"
    On Error GoTo CngError
    status = BCryptOpenAlgorithmProvider(hAlg, StrPtr(algId), 0, 0)
    If status <> 0 Then
        detalle = detalle & " (CNG no abrio el algoritmo, estado " & CStr(status) & ")"
        Exit Function
    End If
    status = BCryptCreateHash(hAlg, hHash, 0, 0, 0, 0, 0)
    If status <> 0 Then
        detalle = detalle & " (CNG no creo el hash, estado " & CStr(status) & ")"
        BCryptCloseAlgorithmProvider hAlg, 0
        Exit Function
    End If

    fileNumber = FreeFile
    Open filePath For Binary Access Read Shared As #fileNumber
    fileSize = LOF(fileNumber)
    position = 1
    Do While position <= fileSize
        take = KCM_HASH_CHUNK
        If position + take - 1 > fileSize Then take = fileSize - position + 1
        ReDim buffer(0 To take - 1)
        Get #fileNumber, position, buffer
        status = BCryptHashData(hHash, buffer(0), take, 0)
        If status <> 0 Then
            detalle = detalle & " (CNG rechazo un bloque, estado " & CStr(status) & ")"
            Close #fileNumber
            BCryptDestroyHash hHash
            BCryptCloseAlgorithmProvider hAlg, 0
            Exit Function
        End If
        position = position + take
    Loop
    Close #fileNumber
    fileNumber = 0

    status = BCryptFinishHash(hHash, digest(0), 32, 0)
    BCryptDestroyHash hHash
    BCryptCloseAlgorithmProvider hAlg, 0
    If status <> 0 Then
        detalle = detalle & " (CNG no entrego el resultado, estado " & CStr(status) & ")"
        Exit Function
    End If
    KcmSha256Cng = KcmHexadecimal(digest, 32)
    Exit Function

CngError:
    detalle = detalle & " (CNG no disponible: " & Err.Description & ")"
    On Error Resume Next
    If fileNumber <> 0 Then Close #fileNumber
    If hHash <> 0 Then BCryptDestroyHash hHash
    If hAlg <> 0 Then BCryptCloseAlgorithmProvider hAlg, 0
    Err.Clear
    On Error GoTo 0
End Function

Private Function KcmSha256Windows(ByVal filePath As String) As String
    #If VBA7 Then
        Dim hProv As LongPtr
        Dim hHash As LongPtr
        Dim nombre As LongPtr
    #Else
        Dim hProv As Long
        Dim hHash As Long
        Dim nombre As Long
    #End If
    Dim intento As Long
    Dim codigo As Long
    Dim detalle As String
    Dim provName As String
    Dim buffer() As Byte
    Dim digest(0 To 31) As Byte
    Dim digestLength As Long
    Dim fileNumber As Integer
    Dim fileSize As Long
    Dim position As Long
    Dim take As Long
    Dim salida As String
    Dim failure As String

    salida = KcmSha256Cng(filePath, detalle)
    If Len(salida) = 64 Then
        KcmSha256Windows = salida
        Exit Function
    End If
    salida = ""

    On Error GoTo HashError
    For intento = 1 To 3
        Select Case intento
            Case 1: provName = KCM_PROV_AES_NAME
            Case 2: provName = KCM_PROV_AES_NAME_XP
            Case Else: provName = ""
        End Select
        If Len(provName) > 0 Then nombre = StrPtr(provName) Else nombre = 0
        hProv = 0
        hHash = 0
        If CryptAcquireContext(hProv, 0, nombre, KCM_PROV_RSA_AES, KCM_CRYPT_VERIFYCONTEXT) = 0 Then
            codigo = Err.LastDllError
            detalle = detalle & " (" & CStr(intento) & " sin proveedor, error " & CStr(codigo) & ")"
        Else
            If CryptCreateHash(hProv, KCM_CALG_SHA_256, 0, 0, hHash) <> 0 Then Exit For
            codigo = Err.LastDllError
            detalle = detalle & " (" & CStr(intento) & " sin SHA-256, error " & CStr(codigo) & ")"
            CryptReleaseContext hProv, 0
            hProv = 0
        End If
    Next intento
    If hHash = 0 Then
        failure = "ningun proveedor ofrece SHA-256:" & detalle
        GoTo HashError
    End If

    fileNumber = FreeFile
    Open filePath For Binary Access Read Shared As #fileNumber
    fileSize = LOF(fileNumber)
    position = 1
    Do While position <= fileSize
        take = KCM_HASH_CHUNK
        If position + take - 1 > fileSize Then take = fileSize - position + 1
        ReDim buffer(0 To take - 1)
        Get #fileNumber, position, buffer
        If CryptHashData(hHash, buffer(0), take, 0) = 0 Then
            Close #fileNumber
            failure = "el proveedor rechazo un bloque del archivo"
            GoTo HashError
        End If
        position = position + take
    Loop
    Close #fileNumber

    digestLength = 32
    If CryptGetHashParam(hHash, KCM_HP_HASHVAL, digest(0), digestLength, 0) = 0 Or _
        digestLength <> 32 Then
        failure = "no se pudo leer el resultado"
        GoTo HashError
    End If
    CryptDestroyHash hHash
    CryptReleaseContext hProv, 0
    On Error GoTo 0

    salida = KcmHexadecimal(digest, 32)
    If Len(salida) <> 64 Or salida Like "*[!0-9a-f]*" Then
        Err.Raise vbObjectError + 7211, "KcmFileSha256", "No fue posible calcular la huella SHA-256"
    End If
    KcmSha256Windows = salida
    Exit Function

HashError:
    If Len(failure) = 0 Then failure = Err.Description
    On Error Resume Next
    If fileNumber <> 0 Then Close #fileNumber
    If hHash <> 0 Then CryptDestroyHash hHash
    If hProv <> 0 Then CryptReleaseContext hProv, 0
    Err.Clear
    On Error GoTo 0
    Err.Raise vbObjectError + 7211, "KcmFileSha256", _
        "No fue posible calcular la huella SHA-256: " & failure
End Function

#End If

Private Function KcmCarpetaPersonal() As String
    Dim casa As String
    #If Mac Then
        Dim corte As Long
        casa = Environ$("HOME")
        corte = InStr(1, casa, "/Library/Containers/", vbTextCompare)
        If corte > 0 Then casa = Left$(casa, corte - 1)
    #Else
        casa = Environ$("USERPROFILE")
    #End If
    KcmCarpetaPersonal = casa
End Function

Public Function KcmCarpetaDeModulos() As String
    Dim carpeta As String
    Dim elegido As String
    Dim separador As String

    #If Mac Then
        separador = "/"
        carpeta = KcmCarpetaPersonal() & "/Library/Group Containers/UBF8T346G9.Office/KCM-VBA-CRLF"
        If KcmCarpetaExiste(carpeta) Then
            KcmCarpetaDeModulos = carpeta
            Exit Function
        End If
    #Else
        separador = "\"
    #End If
    carpeta = KcmCarpetaPersonal() & separador & "Desktop" & separador & "KCM-VBA-CRLF"
    If Not KcmCarpetaExiste(carpeta) Then
        elegido = KcmElegirArchivo("Cualquier modulo de la carpeta con los modulos nuevos", _
            "Modulos de VBA (*.bas; *.cls),*.bas;*.cls")
        If Len(elegido) = 0 Then Exit Function
        carpeta = Left$(elegido, InStrRev(elegido, separador) - 1)
    End If
    #If Mac Then
        Dim concedido As Boolean
        On Error Resume Next
        concedido = GrantAccessToMultipleFiles(Array(carpeta))
        Err.Clear
        On Error GoTo 0
    #End If
    KcmCarpetaDeModulos = carpeta
End Function

Public Function KcmArchivosDeModulos(ByVal carpeta As String) As Collection
    Dim archivos As Collection
    Dim nombre As String

    Set archivos = New Collection
    #If Mac Then
        Dim salida As String
        Dim renglon As Variant
        If KcmMacCorrer("/bin/ls" & vbTab & "-1" & vbTab & carpeta, salida) Then
            For Each renglon In Split(Replace(salida, vbCr, vbLf), vbLf)
                nombre = Trim$(CStr(renglon))
                If LCase$(Right$(nombre, 4)) = ".bas" Or LCase$(Right$(nombre, 4)) = ".cls" Then
                    archivos.Add carpeta & "/" & nombre
                End If
            Next renglon
        End If
    #Else
        nombre = Dir$(carpeta & "\*.bas")
        Do While Len(nombre) > 0
            archivos.Add carpeta & "\" & nombre
            nombre = Dir$()
        Loop
        nombre = Dir$(carpeta & "\*.cls")
        Do While Len(nombre) > 0
            archivos.Add carpeta & "\" & nombre
            nombre = Dir$()
        Loop
    #End If
    Set KcmArchivosDeModulos = archivos
End Function

Public Function KcmConcederAccesoArchivos(ByVal archivos As Collection) As String
    Dim archivo As Variant
    Dim atributos As Long

    If archivos.Count = 0 Then Exit Function
    If Len(KcmPrimerIlegible(archivos)) = 0 Then Exit Function
    #If Mac Then
        Dim rutas() As Variant
        Dim indice As Long
        Dim concedido As Boolean
        ReDim rutas(0 To archivos.Count - 1)
        For Each archivo In archivos
            rutas(indice) = CStr(archivo)
            indice = indice + 1
        Next archivo
        On Error Resume Next
        concedido = GrantAccessToMultipleFiles(rutas)
        Err.Clear
        On Error GoTo 0
    #End If
    For Each archivo In archivos
        On Error Resume Next
        atributos = GetAttr(CStr(archivo))
        If Err.Number <> 0 Then
            Err.Clear
            On Error GoTo 0
            KcmConcederAccesoArchivos = CStr(archivo)
            Exit Function
        End If
        On Error GoTo 0
    Next archivo
End Function

Private Function KcmPrimerIlegible(ByVal archivos As Collection) As String
    Dim archivo As Variant
    Dim atributos As Long

    For Each archivo In archivos
        On Error Resume Next
        atributos = GetAttr(CStr(archivo))
        If Err.Number <> 0 Then
            Err.Clear
            On Error GoTo 0
            KcmPrimerIlegible = CStr(archivo)
            Exit Function
        End If
        On Error GoTo 0
    Next archivo
End Function

Private Function KcmCarpetaExiste(ByVal carpeta As String) As Boolean
    #If Mac Then
        Dim salida As String
        KcmCarpetaExiste = KcmMacCorrer("/bin/test" & vbTab & "-d" & vbTab & carpeta, salida)
    #Else
        On Error Resume Next
        KcmCarpetaExiste = (Len(Dir$(carpeta, vbDirectory)) > 0)
        Err.Clear
        On Error GoTo 0
    #End If
End Function

Public Function KcmSistemaOperativo() As String
    #If Mac Then
        KcmSistemaOperativo = "macOS"
    #Else
        KcmSistemaOperativo = "Windows"
    #End If
End Function

Public Function KcmEsMac() As Boolean
    #If Mac Then
        KcmEsMac = True
    #End If
End Function

Public Function KcmEntorno() As String
    Dim arquitectura As String
    arquitectura = "VBA6 de 32 bits"
    #If VBA7 Then
        arquitectura = "VBA7 de 32 bits"
    #End If
    #If Win64 Then
        arquitectura = "VBA7 de 64 bits"
    #End If
    KcmEntorno = KcmSistemaOperativo() & ", Excel " & Application.Version & ", " & arquitectura
End Function

Public Function KcmTransporteNombre() As String
    #If Mac Then
        If mTareaDisponible = 1 Then
            KcmTransporteNombre = "curl por AppleScriptTask"
        ElseIf mTareaDisponible = 2 Then
            KcmTransporteNombre = "curl por popen de libSystem, sin el guion instalado"
        Else
            KcmTransporteNombre = "curl, via aun sin determinar"
        End If
    #Else
        KcmTransporteNombre = "WinHTTP 5.1"
    #End If
End Function

Public Function KcmCarpetaTemporal() As String
    Dim carpeta As String
    #If Mac Then
        carpeta = Environ$("TMPDIR")
        If Len(carpeta) = 0 Then
            carpeta = Environ$("HOME") & "/Library/Containers/com.microsoft.Excel/Data/tmp"
        End If
    #Else
        carpeta = Environ$("TEMP")
        If Len(carpeta) = 0 Then carpeta = Environ$("TMP")
    #End If
    If Len(carpeta) = 0 Then carpeta = Application.DefaultFilePath
    If Right$(carpeta, 1) <> Application.PathSeparator Then
        carpeta = carpeta & Application.PathSeparator
    End If
    KcmCarpetaTemporal = carpeta
End Function

Public Sub KcmBorrarArchivo(ByVal ruta As String)
    If Len(ruta) = 0 Then Exit Sub
    On Error Resume Next
    Kill ruta
    Err.Clear
    On Error GoTo 0
End Sub

Public Function KcmTransportePost(ByVal endpoint As String, ByVal cuerpo As String, _
    ByRef estado As Long, ByRef respuesta As String, ByRef fallo As String) As Boolean
    estado = 0
    respuesta = ""
    fallo = ""
    #If Mac Then
        KcmTransportePost = KcmPostMac(endpoint, cuerpo, estado, respuesta, fallo)
    #Else
        KcmTransportePost = KcmPostWindows(endpoint, cuerpo, estado, respuesta, fallo)
    #End If
End Function

Public Function KcmUtcIsoNow() As String
    #If Mac Then
        KcmUtcIsoNow = KcmUtcMac()
    #Else
        KcmUtcIsoNow = KcmUtcWindows()
    #End If
End Function

Public Function KcmNewGuidHex() As String
    #If Mac Then
        KcmNewGuidHex = KcmGuidMac()
    #Else
        KcmNewGuidHex = KcmGuidWindows()
    #End If
End Function

Public Sub KcmConcederAcceso(ByVal ruta As String, Optional ByVal persistir As Boolean = False)
    #If Mac Then
        Dim atributos As Long
        Dim concedido As Boolean

        If Len(ruta) = 0 Then Exit Sub
        If mConcedidas Is Nothing Then Set mConcedidas = KcmNuevoDiccionario()
        If mConcedidas.Exists(ruta) And Not persistir Then Exit Sub
        If Not mConcedidas.Exists(ruta) Then mConcedidas.Add ruta, True

        On Error Resume Next
        If Not persistir Then
            atributos = GetAttr(ruta)
            If Err.Number = 0 Then
                On Error GoTo 0
                Exit Sub
            End If
            Err.Clear
        End If
        concedido = GrantAccessToMultipleFiles(Array(ruta, KcmCarpetaPersonal(), "/Volumes"))
        Err.Clear
        On Error GoTo 0
    #End If
End Sub

Public Function KcmConcederPermisosEquipo(ByVal rutaMatriz As String, ByVal rutaPadron As String) As String
    Dim casa As String
    Dim carpetas As Variant
    Dim carpeta As Variant
    Dim atributos As Long
    Dim pendientes As String
    Dim separador As String

    casa = KcmCarpetaPersonal()
    #If Mac Then
        separador = "/"
        Dim concedido As Boolean
        On Error Resume Next
        concedido = GrantAccessToMultipleFiles(Array("/", casa, "/Volumes", _
            casa & "/Desktop", casa & "/Documents", casa & "/Downloads"))
        If Len(rutaMatriz) > 0 Then concedido = GrantAccessToMultipleFiles(Array(rutaMatriz))
        If Len(rutaPadron) > 0 Then concedido = GrantAccessToMultipleFiles(Array(rutaPadron))
        Err.Clear
        On Error GoTo 0
    #Else
        separador = "\"
    #End If

    carpetas = Array(casa & separador & "Desktop", casa & separador & "Documents", _
        casa & separador & "Downloads", rutaMatriz, rutaPadron)
    For Each carpeta In carpetas
        If Len(CStr(carpeta)) > 0 Then
            On Error Resume Next
            atributos = GetAttr(CStr(carpeta))
            If Err.Number <> 0 Then pendientes = pendientes & CStr(carpeta) & vbCrLf
            Err.Clear
            On Error GoTo 0
        End If
    Next carpeta
    KcmConcederPermisosEquipo = pendientes
End Function

Public Sub KcmCredencialBorrar()
    #If Mac Then
        Dim salida As String
        KcmMacCorrer "/usr/bin/security" & vbTab & "delete-generic-password" & vbTab & _
            "-a" & vbTab & KCM_MAC_CUENTA & vbTab & "-s" & vbTab & KCM_TOKEN_ENV, salida
    #Else
        On Error Resume Next
        CreateObject("WScript.Shell").Environment("USER").Remove KCM_TOKEN_ENV
        Err.Clear
        On Error GoTo 0
    #End If
End Sub

Public Function KcmLocalFileProblem(ByVal filePath As String) As String
    Dim atributos As Long

    If Len(filePath) = 0 Then
        KcmLocalFileProblem = "la ruta esta vacia"
        Exit Function
    End If
    If LCase$(Left$(filePath, 5)) = "http:" Or LCase$(Left$(filePath, 6)) = "https:" Then
        KcmLocalFileProblem = "la ruta es una direccion web de OneDrive o SharePoint, no una " & _
            "ruta de disco; sincronice el archivo en local y use su ruta de disco"
        Exit Function
    End If
    KcmConcederAcceso filePath
    On Error Resume Next
    atributos = GetAttr(filePath)
    #If Mac Then
        If Err.Number <> 0 Then
            Dim salida As String
            Err.Clear
            If KcmMacCorrer("/bin/test" & vbTab & "-f" & vbTab & filePath, salida) Then
                On Error GoTo 0
                Exit Function
            End If
            Err.Raise 53
        End If
    #End If
    If Err.Number <> 0 Then
        KcmLocalFileProblem = KcmSistemaOperativo() & " no reconoce la ruta, error " & _
            CStr(Err.Number) & " " & Err.Description
        Err.Clear
        Exit Function
    End If
    On Error GoTo 0
    If (atributos And vbDirectory) <> 0 Then KcmLocalFileProblem = "la ruta es una carpeta"
End Function

Public Function KcmRutaExiste(ByVal ruta As String) As Boolean
    KcmRutaExiste = (Len(ruta) > 0 And Len(KcmLocalFileProblem(ruta)) = 0)
End Function

Public Function KcmFileSha256(ByVal filePath As String) As String
    Dim problema As String

    problema = KcmLocalFileProblem(filePath)
    If Len(problema) > 0 Then Err.Raise vbObjectError + 7211, "KcmFileSha256", _
        "No fue posible calcular la huella SHA-256: " & problema
    #If Mac Then
        KcmFileSha256 = KcmSha256Mac(filePath)
    #Else
        KcmFileSha256 = KcmSha256Windows(filePath)
    #End If
End Function

Public Function KcmFileBase64(ByVal filePath As String) As String
    Dim bytes() As Byte
    Dim numero As Integer
    Dim tamano As Long

    KcmConcederAcceso filePath
    numero = FreeFile
    Open filePath For Binary Access Read Shared As #numero
    tamano = LOF(numero)
    If tamano <= 0 Then
        Close #numero
        Err.Raise vbObjectError + 7220, "KcmFileBase64", "El archivo esta vacio: " & filePath
    End If
    If tamano > KCM_MAX_UPLOAD_BYTES Then
        Close #numero
        Err.Raise vbObjectError + 7221, "KcmFileBase64", _
            "El archivo pesa " & Format$(tamano / 1048576, "0.0") & " MB y el limite del " & _
            "puente son " & CStr(KCM_MAX_UPLOAD_BYTES \ 1048576) & " MB"
    End If
    ReDim bytes(0 To tamano - 1)
    Get #numero, 1, bytes
    Close #numero
    KcmFileBase64 = KcmBytesBase64(bytes, tamano)
End Function

Public Function KcmCredencialDonde() As String
    #If Mac Then
        KcmCredencialDonde = "el llavero de macOS, servicio " & KCM_TOKEN_ENV
    #Else
        KcmCredencialDonde = "la variable de usuario de Windows " & KCM_TOKEN_ENV
    #End If
End Function

Public Function KcmCredencialLeer() As String
    Dim valor As String

    #If Mac Then
        Dim salida As String
        On Error Resume Next
        If KcmMacCorrer("/usr/bin/security" & vbTab & "find-generic-password" & vbTab & _
            "-a" & vbTab & KCM_MAC_CUENTA & vbTab & "-s" & vbTab & KCM_TOKEN_ENV & vbTab & _
            "-w", salida) Then
            valor = salida
        End If
        Err.Clear
        On Error GoTo 0
    #Else
        On Error Resume Next
        valor = CStr(CreateObject("WScript.Shell").Environment("USER")(KCM_TOKEN_ENV))
        Err.Clear
        On Error GoTo 0
    #End If
    KcmCredencialLeer = Trim$(valor)
End Function

Public Sub KcmCredencialGuardar(ByVal secreto As String)
    #If Mac Then
        Dim salida As String
        If Not KcmMacCorrer("/usr/bin/security" & vbTab & "add-generic-password" & vbTab & _
            "-a" & vbTab & KCM_MAC_CUENTA & vbTab & "-s" & vbTab & KCM_TOKEN_ENV & vbTab & _
            "-w" & vbTab & secreto & vbTab & "-U", salida) Then
            Err.Raise vbObjectError + 7231, "KcmCredencialGuardar", _
                "El llavero de macOS no acepto la credencial: " & salida
        End If
    #Else
        Dim entorno As Object
        Set entorno = CreateObject("WScript.Shell").Environment("USER")
        entorno(KCM_TOKEN_ENV) = secreto
    #End If
End Sub

Public Function KcmElegirArchivo(ByVal titulo As String, Optional ByVal filtro As String = "") As String
    Dim elegido As Variant

    #If Mac Then
        On Error Resume Next
        elegido = Application.GetOpenFilename(, , titulo)
        If Err.Number <> 0 Then
            Err.Clear
            elegido = Application.GetOpenFilename()
        End If
        On Error GoTo 0
    #Else
        If Len(filtro) = 0 Then filtro = "Matriz de capacitacion (*.xlsb),*.xlsb,Todos los archivos (*.*),*.*"
        elegido = Application.GetOpenFilename(FileFilter:=filtro, Title:=titulo)
    #End If
    If VarType(elegido) = vbBoolean Then Exit Function
    KcmElegirArchivo = CStr(elegido)
End Function
