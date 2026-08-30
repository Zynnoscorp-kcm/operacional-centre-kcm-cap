Attribute VB_Name = "KcmDiagHash"
Option Explicit

' Modulo TEMPORAL de diagnostico del despliegue. No pertenece a los modulos del cliente:
' se importa, se ejecuta `KcmDiagSha256`, se copia la salida y se quita del proyecto.
'
' `KcmFileSha256` resume en un solo mensaje dos causas que no se parecen: que el sistema no
' entregue SHA-256, o que el archivo no se pueda leer. Este modulo las separa. Primero calcula la
' huella de la cadena "abc", cuyo resultado es publico y fijo, de modo que la criptografia del
' equipo queda probada sin depender de ninguna ruta; despues examina el archivo.
'
' Es, junto con KcmPlataforma, el unico modulo autorizado a llevar una rama por sistema, y el
' linter lo comprueba. La razon es que aqui se interroga precisamente a lo que cada sistema hace
' distinto: en Windows la cadena de proveedores de CryptoAPI, en macOS la via de ejecucion y la
' caja de arena. Las etapas de archivo, en cambio, son comunes.
'
' En Windows el codigo de error se lee con `Err.LastDllError`, nunca con `GetLastError` declarado:
' el motor de VBA puede invocar APIs propias entre la llamada fallida y la lectura, y entonces el
' valor devuelto no corresponde al fallo observado.

Private Const KCM_DIAG_ABC As String = _
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

#If Mac Then

''' Etapa de plataforma en macOS: por donde se ejecuta y si la huella sale bien.
'''
''' No hay proveedores criptograficos que interrogar; lo que puede fallar es otra cosa: que el
''' guion del puente no este instalado, que la caja de arena impida a `shasum` leer el archivo, o
''' que no haya forma de ejecutar nada. Las tres se ven aqui.
Private Sub KcmDiagReportPlataforma()
    Dim ruta As String
    Dim obtenido As String

    ruta = KcmCarpetaTemporal() & "kcm-diag-" & KcmNewGuidHex() & ".txt"
    On Error GoTo FalloDiag
    KcmDiagEscribirAbc ruta
    obtenido = KcmFileSha256(ruta)
    KcmBorrarArchivo ruta
    On Error GoTo 0

    Debug.Print "  Via de ejecucion: " & KcmTransporteNombre()
    Debug.Print "  SHA-256 de abc: " & obtenido
    If obtenido = KCM_DIAG_ABC Then
        Debug.Print "  VEREDICTO: la huella del equipo esta sana."
        If InStr(1, KcmTransporteNombre(), "popen", vbTextCompare) > 0 Then
            Debug.Print "  AVISO: el guion KcmPuente.applescript no esta instalado. Todo funciona,"
            Debug.Print "  pero curl y shasum heredan la caja de arena de Excel y un archivo fuera"
            Debug.Print "  del contenedor se tiene que copiar antes de poder resumirlo."
        End If
    Else
        Debug.Print "  VEREDICTO: valor inesperado; se esperaba " & KCM_DIAG_ABC
    End If
    Exit Sub

FalloDiag:
    Debug.Print "  Via de ejecucion: " & KcmTransporteNombre()
    Debug.Print "  La huella de una cadena conocida fallo: " & Err.Description
    Debug.Print "  VEREDICTO: no hay forma de ejecutar shasum. El fallo NO es del archivo."
    On Error Resume Next
    KcmBorrarArchivo ruta
    Err.Clear
    On Error GoTo 0
End Sub

''' Las letras a, b y c por su codigo, para no depender de como el editor interpreto este archivo.
Private Sub KcmDiagEscribirAbc(ByVal ruta As String)
    Dim bytes(0 To 2) As Byte
    Dim numero As Integer
    bytes(0) = 97
    bytes(1) = 98
    bytes(2) = 99
    numero = FreeFile
    Open ruta For Binary Access Write As #numero
    Put #numero, 1, bytes
    Close #numero
End Sub

#Else

Private Const KCM_DIAG_PROV_RSA_AES As Long = 24
Private Const KCM_DIAG_VERIFYCONTEXT As Long = &HF0000000
Private Const KCM_DIAG_CALG_SHA_256 As Long = &H800C
Private Const KCM_DIAG_HP_HASHVAL As Long = 2
Private Const KCM_DIAG_PROV_AES As String = _
    "Microsoft Enhanced RSA and AES Cryptographic Provider"
Private Const KCM_DIAG_PROV_XP As String = _
    "Microsoft Enhanced RSA and AES Cryptographic Provider (Prototype)"

    #If VBA7 Then
        Private Declare PtrSafe Function KcmDiagAcquire Lib "advapi32.dll" _
            Alias "CryptAcquireContextW" (ByRef phProv As LongPtr, ByVal pszContainer As LongPtr, _
            ByVal pszProvider As LongPtr, ByVal dwProvType As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function KcmDiagRelease Lib "advapi32.dll" _
            Alias "CryptReleaseContext" (ByVal hProv As LongPtr, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function KcmDiagCreateHash Lib "advapi32.dll" _
            Alias "CryptCreateHash" (ByVal hProv As LongPtr, ByVal algId As Long, _
            ByVal hKey As LongPtr, ByVal dwFlags As Long, ByRef phHash As LongPtr) As Long
        Private Declare PtrSafe Function KcmDiagHashData Lib "advapi32.dll" _
            Alias "CryptHashData" (ByVal hHash As LongPtr, ByRef pbData As Byte, _
            ByVal dwDataLen As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function KcmDiagGetParam Lib "advapi32.dll" _
            Alias "CryptGetHashParam" (ByVal hHash As LongPtr, ByVal dwParam As Long, _
            ByRef pbData As Byte, ByRef pdwDataLen As Long, ByVal dwFlags As Long) As Long
        Private Declare PtrSafe Function KcmDiagDestroyHash Lib "advapi32.dll" _
            Alias "CryptDestroyHash" (ByVal hHash As LongPtr) As Long
    #Else
        Private Declare Function KcmDiagAcquire Lib "advapi32.dll" _
            Alias "CryptAcquireContextW" (ByRef phProv As Long, ByVal pszContainer As Long, _
            ByVal pszProvider As Long, ByVal dwProvType As Long, ByVal dwFlags As Long) As Long
        Private Declare Function KcmDiagRelease Lib "advapi32.dll" _
            Alias "CryptReleaseContext" (ByVal hProv As Long, ByVal dwFlags As Long) As Long
        Private Declare Function KcmDiagCreateHash Lib "advapi32.dll" _
            Alias "CryptCreateHash" (ByVal hProv As Long, ByVal algId As Long, _
            ByVal hKey As Long, ByVal dwFlags As Long, ByRef phHash As Long) As Long
        Private Declare Function KcmDiagHashData Lib "advapi32.dll" _
            Alias "CryptHashData" (ByVal hHash As Long, ByRef pbData As Byte, _
            ByVal dwDataLen As Long, ByVal dwFlags As Long) As Long
        Private Declare Function KcmDiagGetParam Lib "advapi32.dll" _
            Alias "CryptGetHashParam" (ByVal hHash As Long, ByVal dwParam As Long, _
            ByRef pbData As Byte, ByRef pdwDataLen As Long, ByVal dwFlags As Long) As Long
        Private Declare Function KcmDiagDestroyHash Lib "advapi32.dll" _
            Alias "CryptDestroyHash" (ByVal hHash As Long) As Long
    #End If

''' Recorre la misma cadena de proveedores que el cliente e informa el codigo real de cada fallo.
''' Si la huella de "abc" coincide con su valor conocido, la criptografia del equipo esta sana y
''' el problema esta en el archivo, no en Windows.
Private Sub KcmDiagReportPlataforma()
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
    Dim provName As String
    Dim codigo As Long
    Dim bytes(0 To 2) As Byte
    Dim digest(0 To 31) As Byte
    Dim digestLength As Long
    Dim obtenido As String

    For intento = 1 To 3
        Select Case intento
            Case 1: provName = KCM_DIAG_PROV_AES
            Case 2: provName = KCM_DIAG_PROV_XP
            Case Else: provName = ""
        End Select
        If Len(provName) > 0 Then nombre = StrPtr(provName) Else nombre = 0
        hProv = 0
        hHash = 0
        If KcmDiagAcquire(hProv, 0, nombre, KCM_DIAG_PROV_RSA_AES, KCM_DIAG_VERIFYCONTEXT) = 0 Then
            codigo = Err.LastDllError
            Debug.Print "  " & intento & ") CryptAcquireContext fallo, error " & codigo & " " & _
                KcmDiagMeaning(codigo)
        Else
            If KcmDiagCreateHash(hProv, KCM_DIAG_CALG_SHA_256, 0, 0, hHash) <> 0 Then
                Debug.Print "  " & intento & ") proveedor con SHA-256 disponible"
                Exit For
            End If
            codigo = Err.LastDllError
            Debug.Print "  " & intento & ") contexto OK pero CryptCreateHash fallo, error " & _
                codigo & " " & KcmDiagMeaning(codigo)
            KcmDiagRelease hProv, 0
            hProv = 0
        End If
    Next intento

    If hHash = 0 Then
        Debug.Print "  VEREDICTO: ningun proveedor entrega SHA-256. El fallo NO es del archivo."
        Exit Sub
    End If

    ' La letra a es 97, la b 98 y la c 99: se escriben por codigo para no depender de la pagina
    ' de codigos con la que el editor VBA interpreto este archivo al importarlo.
    bytes(0) = 97
    bytes(1) = 98
    bytes(2) = 99
    If KcmDiagHashData(hHash, bytes(0), 3, 0) = 0 Then
        codigo = Err.LastDllError
        Debug.Print "  CryptHashData rechazo 3 bytes en memoria, error " & codigo & " " & _
            KcmDiagMeaning(codigo)
    Else
        digestLength = 32
        If KcmDiagGetParam(hHash, KCM_DIAG_HP_HASHVAL, digest(0), digestLength, 0) = 0 Then
            codigo = Err.LastDllError
            Debug.Print "  CryptGetHashParam fallo, error " & codigo & " " & KcmDiagMeaning(codigo)
        Else
            obtenido = KcmHexadecimal(digest, digestLength)
            Debug.Print "  SHA-256 de abc: " & obtenido
            If obtenido = KCM_DIAG_ABC Then
                Debug.Print "  VEREDICTO: la criptografia del equipo esta sana."
            Else
                Debug.Print "  VEREDICTO: valor inesperado; se esperaba " & KCM_DIAG_ABC
            End If
        End If
    End If
    KcmDiagDestroyHash hHash
    KcmDiagRelease hProv, 0
End Sub

''' Traduce los codigos que de verdad aparecen en esta ruta de fallo.
Private Function KcmDiagMeaning(ByVal codigo As Long) As String
    Select Case codigo
        Case 0: KcmDiagMeaning = "(sin codigo asociado)"
        Case 5: KcmDiagMeaning = "(ERROR_ACCESS_DENIED: politica del equipo)"
        Case 87: KcmDiagMeaning = "(ERROR_INVALID_PARAMETER)"
        Case &H80090008: KcmDiagMeaning = "(NTE_BAD_ALGID: el proveedor no ofrece SHA-256)"
        Case &H80090014: KcmDiagMeaning = "(NTE_BAD_PROV_TYPE)"
        Case &H80090016: KcmDiagMeaning = "(NTE_BAD_KEYSET)"
        Case &H80090017: KcmDiagMeaning = "(NTE_PROV_TYPE_NOT_DEF)"
        Case &H80090019: KcmDiagMeaning = "(NTE_KEYSET_NOT_DEF)"
        Case &H8009001A: KcmDiagMeaning = "(NTE_KEYSET_ENTRY_BAD)"
        Case &H8009000F: KcmDiagMeaning = "(NTE_EXISTS)"
        Case Else: KcmDiagMeaning = ""
    End Select
End Function

#End If

''' Punto de entrada. En la ventana Inmediato, sin signo de interrogacion y con la ruta real:
'''     KcmDiagSha256 "C:\ruta\completa\Matriz.xlsb"
''' o, en macOS:
'''     KcmDiagSha256 "/Users/quien/Documentos/Matriz.xlsb"
Public Sub KcmDiagSha256(ByVal filePath As String)
    Debug.Print "===== KCM diagnostico SHA-256 ====="
    Debug.Print "Entorno: " & KcmSistemaOperativo() & ", " & KcmDiagBitness()
    Debug.Print "--- 1) Como resuelve la huella este sistema ---"
    KcmDiagReportPlataforma
    Debug.Print "--- 2) Acceso al archivo ---"
    KcmDiagReportFile filePath
    Debug.Print "--- 3) Llamada real a KcmFileSha256 ---"
    KcmDiagReportReal filePath
    Debug.Print "===== fin ====="
End Sub

Private Function KcmDiagBitness() As String
    Dim texto As String
    texto = "VBA6 de 32 bits"
    #If VBA7 Then
        texto = "VBA7 de 32 bits"
    #End If
    #If Win64 Then
        texto = "VBA7 de 64 bits"
    #End If
    KcmDiagBitness = texto
End Function

''' Etapa de archivo: informa la ruta tal como llega y cada comprobacion por separado, para que se
''' vea cual de ellas es la que rechaza el archivo. Es comun a los dos sistemas: `GetAttr`, `Dir$`
''' y `Open` son de VBA, no de Windows.
Private Sub KcmDiagReportFile(ByVal filePath As String)
    Dim attributes As Long
    Dim fileNumber As Integer
    Dim fileSize As Long

    Debug.Print "  Ruta recibida: " & filePath
    Debug.Print "  Longitud de la ruta: " & Len(filePath)
    If LCase$(Left$(filePath, 5)) = "http:" Or LCase$(Left$(filePath, 6)) = "https:" Then
        Debug.Print "  VEREDICTO: es una direccion web de OneDrive o SharePoint, no una ruta de"
        Debug.Print "  disco. Ninguna lectura local puede abrirla; use la ruta de la unidad."
        Exit Sub
    End If

    ' En macOS hay que pedir el permiso antes de mirar: sin el, `GetAttr` falla sobre un archivo
    ' que si existe y el diagnostico culparia a la ruta. En Windows no hace nada.
    KcmConcederAcceso filePath
    On Error Resume Next
    attributes = GetAttr(filePath)
    If Err.Number <> 0 Then
        Debug.Print "  GetAttr fallo: error " & Err.Number & " " & Err.Description
        Err.Clear
        Debug.Print "  VEREDICTO: el sistema no reconoce la ruta. Revise ortografia, unidad de red"
        Debug.Print "  no conectada en esta sesion, o permiso no concedido a Excel."
        Exit Sub
    End If
    On Error GoTo 0
    Debug.Print "  Atributos: " & attributes & KcmDiagAttrNotes(attributes)
    Debug.Print "  Dir$ con vbNormal devuelve: " & KcmDiagDirProbe(filePath)

    fileNumber = FreeFile
    On Error Resume Next
    Open filePath For Binary Access Read Shared As #fileNumber
    If Err.Number <> 0 Then
        Debug.Print "  Open fallo: error " & Err.Number & " " & Err.Description
        Err.Clear
        Debug.Print "  VEREDICTO: el archivo existe pero no se deja leer."
        Exit Sub
    End If
    fileSize = LOF(fileNumber)
    Close #fileNumber
    On Error GoTo 0
    Debug.Print "  Open OK, tamano en bytes: " & fileSize
    Debug.Print "  VEREDICTO: el archivo es legible."
End Sub

''' Repite la llamada que esta fallando y muestra su numero y su texto completos.
Private Sub KcmDiagReportReal(ByVal filePath As String)
    Dim resultado As String
    On Error Resume Next
    resultado = KcmFileSha256(filePath)
    If Err.Number <> 0 Then
        Debug.Print "  KcmFileSha256 fallo con error " & Err.Number
        Debug.Print "  " & Err.Description
        Err.Clear
        Exit Sub
    End If
    On Error GoTo 0
    Debug.Print "  KcmFileSha256 devolvio: " & resultado
End Sub

Private Function KcmDiagDirProbe(ByVal filePath As String) As String
    Dim encontrado As String
    On Error Resume Next
    encontrado = Dir$(filePath, vbNormal)
    If Err.Number <> 0 Then
        KcmDiagDirProbe = "error " & Err.Number & " " & Err.Description
        Err.Clear
        Exit Function
    End If
    On Error GoTo 0
    If Len(encontrado) = 0 Then
        KcmDiagDirProbe = "cadena vacia, que es lo que la version anterior rechazaba"
    Else
        KcmDiagDirProbe = encontrado
    End If
End Function

Private Function KcmDiagAttrNotes(ByVal attributes As Long) As String
    Dim notas As String
    If (attributes And vbDirectory) <> 0 Then notas = notas & " es una carpeta, no un archivo;"
    If (attributes And vbHidden) <> 0 Then notas = notas & " oculto, y Dir$ con vbNormal lo omite;"
    If (attributes And vbSystem) <> 0 Then notas = notas & " de sistema, y Dir$ lo omite;"
    If (attributes And vbReadOnly) <> 0 Then notas = notas & " de solo lectura;"
    If Len(notas) > 0 Then KcmDiagAttrNotes = " ->" & notas
End Function
