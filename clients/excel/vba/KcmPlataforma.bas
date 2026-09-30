Attribute VB_Name = "KcmPlataforma"
Option Explicit
Option Private Module

' Modulo interno: sus rutinas las llaman otros modulos del cliente y no aparecen
' en Herramientas > Macros, donde solo quedan las que se usan a mano.

' EL PUERTO DE PLATAFORMA. Aqui vive todo lo que Windows y macOS no hacen igual,
' y en ningun otro modulo del cliente hay una sola directiva `#If Mac`. El
' analisis estatico lo comprueba: `npm run lint:vba` falla si aparece una fuera
' de aqui.
'
' La regla que gobierna el diseno es el tamano de esta superficie. Cuanto menos
' dependa de la plataforma, mas dice la prueba hecha en la Mac sobre lo que
' ocurrira en Windows, porque el compilador de cada sistema compila solo su
' rama: un error escrito dentro de `#If Mac` no se manifiesta en Windows ni al
' compilar, y al reves tampoco. Todo lo demas del cliente --el contrato, el
' preflight, la busqueda por nomina, la escritura con historial, el rollback, la
' idempotencia, las codificaciones-- corre por el mismo codigo en los dos.
'
' Cinco funciones cruzan la frontera:
'
'   1. Enviar un POST                KcmTransportePost
'   2. Calcular SHA-256 de un archivo KcmFileSha256
'   3. Sortear un identificador      KcmNewGuidHex
'   4. Fechar en UTC                 KcmUtcIsoNow
'   5. Guardar y leer la credencial  KcmCredencialGuardar / KcmCredencialLeer
'
' Y dos servicios que solo macOS necesita: conceder acceso a un archivo fuera de
' la caja de arena de Excel, y ejecutar un programa del sistema.
'
' POR QUE CADA SISTEMA USA UN TRANSPORTE DISTINTO. En Windows se conserva WinHTTP
' a proposito: las politicas corporativas bloquean con frecuencia que Office cree
' procesos hijo, y ahi un `curl` por shell fallaria sin alternativa. En macOS no
' existe WinHTTP --ni `WinHttp.WinHttpRequest`, ni `MSXML2.XMLHTTP`, ni ningun COM
' de Windows-- y la via sancionada por Microsoft para salir de la caja de arena es
' `AppleScriptTask`. Cada plataforma usa el transporte que su politica permite.
'
' LAS DOS VIAS DE macOS. La principal es `AppleScriptTask`, que ejecuta un guion
' instalado en `~/Library/Application Scripts/com.microsoft.Excel/`; corre FUERA
' de la caja de arena, de modo que `curl` alcanza la red y `shasum` puede leer una
' matriz que viva en cualquier carpeta. Si ese guion no esta instalado se recurre
' a `popen` de `libSystem`, que no exige instalar nada pero hereda la caja de
' arena de Excel. Las dos ejecutan exactamente el mismo vector de argumentos y
' ninguna de las dos arma una linea de shell concatenando texto: `AppleScriptTask`
' cita cada argumento con `quoted form of` y la otra con comillas simples, de modo
' que una ruta con espacios o un endpoint con caracteres raros no pueden inyectar
' nada. La autoprueba dice cual de las dos esta en uso.
'
' EL CUERPO VIAJA POR ARCHIVO. El snapshot de la matriz pesa megabytes y ninguna
' linea de comandos admite un argumento asi. `curl` lo lee con `--data-binary` de
' un archivo temporal y escribe la respuesta en otro; los dos viven en el
' temporal del contenedor de Excel, que las dos vias saben leer, y se borran al
' terminar hasta cuando el envio falla.

' Nombre del guion que el cliente busca en la carpeta de guiones de Excel.
Private Const KCM_MAC_GUION As String = "KcmPuente.applescript"
' Cuenta con la que la credencial se guarda en el llavero de macOS. El servicio
' es KCM_TOKEN_ENV, el mismo nombre que la variable de usuario de Windows, para
' que las dos plataformas nombren el secreto igual en los mensajes.
Private Const KCM_MAC_CUENTA As String = "KCM_PUENTE_VBA"
' Techo del archivo que el puente acepta subir. El padron semanal pesa medio
' mega; el margen existe para que nadie lo ajuste al hueso, y esta muy por
' debajo del limite del servidor incluso despues del crecimiento de base64.
Private Const KCM_MAX_UPLOAD_BYTES As Long = 8388608

' Estado por sesion. 0 = sin averiguar, 1 = AppleScriptTask disponible,
' 2 = ausente y se usa popen.
Private mTareaDisponible As Long
Private mDesfaseMinutos As Long
Private mDesfaseMedidoEn As Date
Private mAleatorio As String
Private mAleatorioUsado As Long
Private mContador As Long
Private mSemillaPuesta As Boolean
Private mConcedidas As KcmDiccionario

' ===================================================================== macOS

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

''' Ejecuta un programa y devuelve su salida. `argv` son los argumentos
''' separados por tabulador, nunca una linea de shell ya armada: asi ninguna
''' ruta con espacios ni ningun valor de configuracion puede inyectar un
''' comando. Devuelve False si el programa termino con codigo distinto de cero,
''' y entonces `salida` trae lo que dijo.
Private Function KcmMacCorrer(ByVal argv As String, ByRef salida As String) As Boolean
    Dim piezas As Variant
    Dim indice As Long
    Dim orden As String
    Dim codigo As Long

    salida = ""
    ' Se intenta la via sancionada mientras no conste que falta el guion. Si el
    ' guion esta y el comando fallo, el fallo es del comando y no hay por que
    ' repetirlo por la otra via: repetirlo solo duplicaria el efecto.
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

''' Via principal: el guion instalado en la carpeta de guiones de Excel. Corre
''' fuera de la caja de arena, que es lo que permite alcanzar la red y leer una
''' matriz guardada en cualquier carpeta del equipo.
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
    ' El guion no esta instalado, o el sistema no dejo invocarlo. Se anota para
    ' no volver a intentarlo en esta sesion y se cae a `popen`.
    mTareaDisponible = 2
    salida = "el guion " & KCM_MAC_GUION & " no respondio: " & Err.Description
End Function

''' Via de respaldo: `popen` de `libSystem`. No exige instalar nada, pero el
''' proceso hijo hereda la caja de arena de Excel.
'''
''' Tiene ademas un limite que la via principal no tiene: `ByVal ... As String` en
''' una declaracion externa entrega el texto en la pagina de codigos del sistema,
''' no en Unicode, asi que una ruta con acentos puede llegar deformada. En la
''' practica no estorba, porque las rutas que este modulo construye son
''' hexadecimales y el endpoint es ASCII; y cuando la ruta ajena si trae acentos,
''' la huella cae sola a la via de la copia, cuyo destino tambien es ASCII.
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
    ' `pclose` devuelve el estado de espera de POSIX: el codigo de salida son sus
    ' ocho bits altos.
    codigo = KcmPclose(flujo) \ 256
    KcmMacPopen = salida
End Function

''' Un argumento entrecomillado para el shell. Las comillas simples protegen
''' todo salvo la comilla simple misma, que se cierra, se escapa y se reabre.
Private Function KcmCitarShell(ByVal valor As String) As String
    KcmCitarShell = "'" & Replace$(valor, "'", "'\''") & "'"
End Function

''' POST por `curl`. El cuerpo entra por archivo y la respuesta sale por archivo:
''' el snapshot de la matriz pesa megabytes y no cabe en una linea de comandos.
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
    ' No se pide `--fail`: un 4xx o 5xx tambien trae cuerpo del protocolo, y el
    ' cliente decide con el estado si reintenta. `--write-out` deja el codigo en
    ' la ultima linea de la salida estandar.
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

''' Escribe una cadena como UTF-8 sin marca de orden de bytes, y comprueba el
''' tamano resultante: si el archivo no mide lo que se codifico, algo se
''' interpuso y conviene saberlo aqui y no en el servidor.
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

''' Diferencia entre la hora local y UTC, en minutos. Se consulta una vez y se
''' conserva diez minutos: preguntarla en cada intento costaria un proceso mas
''' por peticion, y volver a preguntarla de vez en cuando evita que un cambio de
''' horario de verano deje al cliente fuera de la ventana de cinco minutos que
''' el servidor acepta.
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

''' Identificadores aleatorios de macOS. Se piden 512 bytes de `/dev/urandom` de
''' una vez y se reparten de treinta y dos en treinta y dos: un proceso por cada
''' identificador habria costado dos procesos mas en cada peticion del puente.
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

''' Ultimo recurso cuando no hay forma de ejecutar nada. No pretende ser
''' criptografico: basta con que dos peticiones del mismo equipo no repitan el
''' nonce dentro de la ventana de diez minutos del servidor, y el contador de
''' sesion lo garantiza por si solo.
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

''' Huella por `shasum`, que macOS trae de fabrica.
'''
''' Si el guion no esta instalado, `curl` y `shasum` corren dentro de la caja de
''' arena de Excel y no pueden leer un archivo que viva fuera del contenedor.
''' Excel si puede --la matriz se eligio desde aqui y el sistema concedio el
''' acceso--, asi que en ese caso se copia al temporal del contenedor y se calcula
''' la huella de la copia. Es el mismo archivo byte por byte y la huella es la
''' misma; lo unico que cuesta es una copia.
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

' =================================================================== Windows

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

' La huella se calcula con la API criptografica de Windows, no lanzando PowerShell: las politicas
' corporativas bloquean con frecuencia la creacion de procesos hijo desde Office, y ahi un
' `WScript.Shell.Exec` falla sin alternativa. Estas llamadas nativas son las mismas que ya usan
' `GetSystemTime` y `CoCreateGuid`, van dentro del proceso de Excel y ademas son mas rapidas.
Private Const KCM_PROV_RSA_AES As Long = 24
Private Const KCM_CRYPT_VERIFYCONTEXT As Long = &HF0000000
Private Const KCM_CALG_SHA_256 As Long = &H800C
Private Const KCM_HP_HASHVAL As Long = 2
Private Const KCM_HASH_CHUNK As Long = 1048576
' Con nombre de proveedor nulo, Windows puede entregar el proveedor AES antiguo, que no expone
' SHA-256 y hace fallar `CryptCreateHash`. Por eso se nombran los proveedores explicitamente.
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

''' Identidad aleatoria via `CoCreateGuid`. No se usa `Scriptlet.TypeLib`: depende de `scrobj.dll`,
''' que las politicas corporativas bloquean con frecuencia, y devuelve la cadena con un terminador
''' nulo que contaminaria el identificador enviado al servidor.
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

''' Huella por CNG (`bcrypt.dll`), la API vigente de Windows. Se intenta primero porque no depende
''' de los proveedores heredados de CryptoAPI: hay equipos cuyo proveedor no expone SHA-256 y
''' devuelven NTE_BAD_ALGID en `CryptCreateHash` aunque el contexto se haya adquirido. Devuelve la
''' cadena vacia si CNG no esta disponible, y entonces `KcmSha256Windows` cae a la ruta heredada en
''' lugar de fallar: las dos escriben el mismo digest.
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
    ' `StrPtr` sobre una variable, no sobre un literal: el puntero de un temporal no es fiable.
    status = BCryptOpenAlgorithmProvider(hAlg, StrPtr(algId), 0, 0)
    If status <> 0 Then
        detalle = detalle & " (CNG no abrio el algoritmo, estado " & CStr(status) & ")"
        Exit Function
    End If
    ' Con `pbHashObject` nulo el propio proveedor reserva y libera la memoria del objeto.
    status = BCryptCreateHash(hAlg, hHash, 0, 0, 0, 0, 0)
    If status <> 0 Then
        detalle = detalle & " (CNG no creo el hash, estado " & CStr(status) & ")"
        BCryptCloseAlgorithmProvider hAlg, 0
        Exit Function
    End If

    fileNumber = FreeFile
    ' `Shared` es obligatorio: sin el, `Open` pide bloqueo exclusivo y falla sobre un archivo que
    ' Excel ya tenga abierto, que es justo el caso de la matriz recien guardada.
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

''' SHA-256 del archivo con la API criptografica de Windows. El archivo se lee por bloques de un
''' megabyte, de modo que una matriz de decenas de megabytes nunca se carga entera en memoria.
''' No se lanza ningun proceso externo: `WScript.Shell.Exec` esta bloqueado por politica en los
''' equipos corporativos que impiden a Office crear procesos hijo.
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

    ' CNG primero; CryptoAPI queda como respaldo para equipos donde `bcrypt.dll` no responda.
    salida = KcmSha256Cng(filePath, detalle)
    If Len(salida) = 64 Then
        KcmSha256Windows = salida
        Exit Function
    End If
    salida = ""

    On Error GoTo HashError
    ' Cadena de proveedores: nombrado, variante antigua y por omision. `CryptCreateHash` es la
    ' prueba real de que el proveedor expone SHA-256; obtener el contexto no lo garantiza.
    For intento = 1 To 3
        Select Case intento
            Case 1: provName = KCM_PROV_AES_NAME
            Case 2: provName = KCM_PROV_AES_NAME_XP
            Case Else: provName = ""
        End Select
        ' `StrPtr` sobre una variable, no sobre la constante: el puntero de un temporal no es fiable.
        If Len(provName) > 0 Then nombre = StrPtr(provName) Else nombre = 0
        hProv = 0
        hHash = 0
        If CryptAcquireContext(hProv, 0, nombre, KCM_PROV_RSA_AES, KCM_CRYPT_VERIFYCONTEXT) = 0 Then
            ' `Err.LastDllError` se lee en la instruccion inmediatamente posterior a la llamada:
            ' cualquier otra llamada `Declare` intermedia lo sobrescribe. VBA no admite declarar
            ' `GetLastError`, porque el motor puede invocar APIs propias entre la llamada fallida y
            ' la lectura, y entonces el codigo devuelto no corresponde al fallo observado.
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
    ' `Shared` es obligatorio: sin el, `Open` pide bloqueo exclusivo y falla con permiso denegado
    ' sobre cualquier archivo que Excel ya tenga abierto, que es justo el caso de la matriz recien
    ' guardada y del propio libro controlador.
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
    ' El archivo puede haber quedado abierto si el fallo ocurrio durante la lectura.
    If fileNumber <> 0 Then Close #fileNumber
    If hHash <> 0 Then CryptDestroyHash hHash
    If hProv <> 0 Then CryptReleaseContext hProv, 0
    Err.Clear
    On Error GoTo 0
    Err.Raise vbObjectError + 7211, "KcmFileSha256", _
        "No fue posible calcular la huella SHA-256: " & failure
End Function

#End If

' ============================================== entradas comunes del puerto

''' La carpeta personal de quien tiene la sesion abierta.
'''
''' En macOS, dentro de la caja de arena, HOME apunta al contenedor de Excel
''' (~/Library/Containers/com.microsoft.Excel/Data): lo que va antes de
''' /Library/Containers/ es la carpeta del usuario.
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

''' La carpeta con los modulos nuevos del cliente: KCM-VBA-CRLF en el escritorio.
'''
''' En macOS se prefiere la copia dentro del contenedor compartido de Office
''' (~/Library/Group Containers/UBF8T346G9.Office/KCM-VBA-CRLF): Excel lee ahi sin
''' pedir permiso, y el cuadro de permisos del escritorio solo dejaba conceder un
''' archivo a la vez. Si no esta ni ahi ni en el escritorio, se elige cualquier
''' modulo de la carpeta que los traiga. Fuera del contenedor se concede ademas el
''' permiso de leerla, que el editor de VBA necesita; el sistema lo pide una vez y
''' lo recuerda. Cadena vacia si se cancela.
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

''' Los modulos .bas y .cls de `carpeta`, con su ruta completa.
Public Function KcmArchivosDeModulos(ByVal carpeta As String) As Collection
    Dim archivos As Collection
    Dim nombre As String

    Set archivos = New Collection
    #If Mac Then
        Dim salida As String
        Dim renglon As Variant
        ' Se lista fuera de la caja de arena: en macOS, Dir no admite comodines.
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

''' Pide de una vez permiso para leer todos los `archivos` y devuelve el primero
''' que siga sin poder leerse; cadena vacia si se leen todos. En macOS el sistema
''' muestra un solo cuadro con la lista; en Windows no hay nada que pedir.
Public Function KcmConcederAccesoArchivos(ByVal archivos As Collection) As String
    Dim archivo As Variant
    Dim atributos As Long

    If archivos.Count = 0 Then Exit Function
    ' Si todos se leen ya -la carpeta del contenedor de Office-, no se abre
    ' ningun cuadro de permisos.
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

''' El primero de `archivos` que no se deja leer; cadena vacia si se leen todos.
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

''' Sistema, version de Excel y arquitectura del interprete, en una linea.
'''
''' La arquitectura importa mas de lo que parece: las declaraciones de API tienen
''' dos formas segun el interprete sea de 32 o de 64 bits, y confundirlas produce
''' un cierre de Excel sin mensaje. Que la autoprueba lo diga permite reconocer
''' de inmediato un equipo distinto al que se probo.
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

''' Nombre de la via de transporte en uso, para la autoprueba y el diagnostico.
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

''' Carpeta temporal escribible, terminada en separador. En macOS es la del
''' contenedor de Excel, que es la unica que la caja de arena permite y que el
''' guion tambien sabe leer desde fuera.
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

''' Envio HTTP del puente. Devuelve True cuando hubo respuesta del servidor, sea
''' cual sea su codigo, y deja el estado y el cuerpo; devuelve False solo cuando
''' el transporte no llego a hablar con nadie, y entonces `fallo` lo explica.
''' Quien decide si reintentar es KcmHttpPost, no este puerto.
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

''' Marca de tiempo UTC en el formato que el servidor acepta. La ventana que
''' admite son cinco minutos, de modo que un reloj mal puesto se manifiesta como
''' credencial vencida y conviene que la autoprueba lo muestre.
Public Function KcmUtcIsoNow() As String
    #If Mac Then
        KcmUtcIsoNow = KcmUtcMac()
    #Else
        KcmUtcIsoNow = KcmUtcWindows()
    #End If
End Function

''' Treinta y dos digitos hexadecimales aleatorios. Sirven de `requestId` y de
''' nonce; el servidor rechaza un nonce repetido dentro de diez minutos.
Public Function KcmNewGuidHex() As String
    #If Mac Then
        KcmNewGuidHex = KcmGuidMac()
    #Else
        KcmNewGuidHex = KcmGuidWindows()
    #End If
End Function

''' Concede a Excel acceso a un archivo fuera de su caja de arena.
'''
''' En Windows no existe la restriccion y la llamada no hace nada. En macOS,
''' Excel solo puede leer lo que el usuario eligio o lo que se le concedio antes;
''' `GrantAccessToMultipleFiles` abre el cuadro del sistema y la concesion
''' persiste. Se comprueba primero si la ruta ya se deja leer, porque pedir un
''' permiso que ya se tiene abriria un cuadro de dialogo sin motivo.
'''
''' `persistir` omite esa comprobacion. Se usa justo despues del cuadro de Abrir,
''' donde el archivo ya es legible para esta sesion pero la concesion aun no
''' esta anotada: sin pedirla ahi, la ruta dejaria de leerse la proxima vez que
''' se abra Excel. Con el archivo ya accesible el sistema no muestra nada, de
''' modo que la peticion no le cuesta nada a quien instala.
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
        ' Con la ruta se pide la carpeta personal completa (Escritorio, Documentos,
        ' Descargas, OneDrive) y /Volumes, donde macOS monta las carpetas
        ' compartidas de la red. El sistema pregunta una vez y lo recuerda: despues
        ' cualquier matriz o padron local o de red se abre sin volver a pedir nada.
        concedido = GrantAccessToMultipleFiles(Array(ruta, KcmCarpetaPersonal(), "/Volumes"))
        Err.Clear
        On Error GoTo 0
    #End If
End Sub

''' Pide acceso a las carpetas del equipo y devuelve las que siguen sin leerse,
''' una por renglon; cadena vacia si se leen todas.
'''
''' En macOS Excel vive en una caja de arena: se pide de una vez la raiz del
''' disco, la carpeta personal y /Volumes (carpetas compartidas montadas), mas
''' las rutas configuradas. El sistema pregunta una sola vez y lo recuerda; al
''' tocar Escritorio, Documentos y Descargas pregunta ademas por cada una, y
''' conviene que sea aqui y no a media corrida. En Windows no hay caja de arena:
''' lo que decide son los permisos de la carpeta, que Excel no puede darse a si
''' mismo, asi que solo se comprueba y se informa.
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

''' Borra la credencial de este equipo del llavero de macOS o de la variable de
''' usuario de Windows. No falla si no habia ninguna.
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

''' Describe por que una ruta no es un archivo local legible; cadena vacia si si lo es.
''' No se usa `Dir$` para esta comprobacion: omite los archivos ocultos y de sistema, comparte
''' estado global con cualquier enumeracion en curso y no distingue una carpeta de un archivo.
''' Sobre todo, `Workbook.FullName` devuelve una direccion web cuando el libro vive en OneDrive o
''' SharePoint; ninguna lectura local es posible entonces y conviene nombrar esa causa, porque
''' "el archivo no existe" manda a buscar un problema de ruta que no existe.
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
        ' La caja de arena de Excel no ve Descargas ni Escritorio sin permiso, y el
        ' permiso se pide una sola vez por sesion. El guion corre fuera de ella:
        ' si ahi el archivo existe, la ruta es buena y Excel pedira acceso al abrirlo.
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

''' Existencia sin abrir el archivo, para las comprobaciones de pantalla.
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

''' Contenido de un archivo local en base64 estandar, con relleno.
'''
''' Es lo que permite que el padron semanal viaje tal cual: el servidor lo lee
''' con el mismo extractor que usa la subida manual y la linea de comandos, en
''' vez de recibir filas que esta macro hubiera interpretado por su cuenta. Una
''' segunda interpretacion del libro seria una segunda forma de equivocarse.
'''
''' No se recodifica a base64 web-safe porque el resultado viaja dentro de un
''' JSON, no en la URL; el sobre completo si se codifica web-safe al enviarse.
Public Function KcmFileBase64(ByVal filePath As String) As String
    Dim bytes() As Byte
    Dim numero As Integer
    Dim tamano As Long

    KcmConcederAcceso filePath
    numero = FreeFile
    ' `Shared` por lo mismo que en la huella: el archivo puede estar abierto.
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

''' Donde vive la credencial en este sistema. Se usa en los mensajes, para que la
''' instruccion que lee el operador corresponda a su equipo.
Public Function KcmCredencialDonde() As String
    #If Mac Then
        KcmCredencialDonde = "el llavero de macOS, servicio " & KCM_TOKEN_ENV
    #Else
        KcmCredencialDonde = "la variable de usuario de Windows " & KCM_TOKEN_ENV
    #End If
End Function

''' La credencial guardada, o cadena vacia. Nunca se registra ni se muestra: los
''' paneles informan solo su longitud.
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

''' Guarda la credencial fuera del libro.
'''
''' En Windows va a la coleccion de variables del usuario, que lee y escribe el
''' registro en vivo: queda disponible en el acto y no hace falta cerrar Excel,
''' que es lo que exigia el `setx` del procedimiento anterior. En macOS va al
''' llavero, que es donde el sistema guarda secretos. Ninguno de los dos la
''' escribe en el libro.
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

''' Cuadro de Abrir del sistema. Devuelve la ruta elegida, o la cadena vacia si
''' se cancelo.
'''
''' El filtro de archivos es lo unico que separa a los dos sistemas, y separarlo
''' no fue una preferencia. Excel para Mac rechaza la cadena de filtros de
''' Windows: en cuanto se le pasa `FileFilter` con los pares
''' "descripcion,patron", `GetOpenFilename` falla con "Method 'GetOpenFilename'
''' of object '_Application' failed" y el asistente se detiene en su ultimo paso.
''' Alli el filtro se declara con codigos de tipo de cuatro letras, y para `.xlsb`
''' no hay ninguno. Asi que en macOS el cuadro se abre sin filtro y la extension
''' la comprueba quien llama, que en este cliente ya lo hacia de todos modos.
Public Function KcmElegirArchivo(ByVal titulo As String, Optional ByVal filtro As String = "") As String
    Dim elegido As Variant

    #If Mac Then
        ' `Title` es opcional en la version de macOS y no todas las compilaciones
        ' lo aceptan; si estorba, el cuadro se abre sin titulo antes que no abrirse.
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
