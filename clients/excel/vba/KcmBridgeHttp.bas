Attribute VB_Name = "KcmBridgeHttp"
Option Explicit

' El protocolo del puente, y solo el protocolo.
'
' Este modulo no sabe como se envia un POST, ni como se calcula una huella, ni
' donde guarda cada sistema la credencial: todo eso lo resuelve KcmPlataforma
' detras de un puerto con dos ramas. Aqui vive lo que es igual en Windows y en
' macOS, que es casi todo: la forma del cuerpo, el reintento idempotente, la
' regla de HTTPS, la lectura de la respuesta y los dos formatos que el contrato
' usa para los lotes.
'
' Separarlo asi no es prolijidad. El compilador de cada plataforma compila solo
' su rama de un `#If`, de modo que un error dentro de `#If Mac` no aparece al
' compilar en Windows ni al reves. Cuanto menos codigo viva detras de esa
' directiva, mas demuestra la prueba hecha en un sistema sobre el otro. De este
' modulo, cero lineas.
'
' Antes vivian aqui las declaraciones de `advapi32`, `bcrypt` y `ole32`, la
' conversion UTF-8 por `ADODB.Stream` y el base64 por `Msxml2.DOMDocument`.
' Ninguno de esos objetos existe en Excel para Mac; los dos ultimos ademas son
' dependencias COM que las politicas corporativas pueden bloquear en Windows.
' Las codificaciones se reescribieron en VBA puro en KcmCodec y corren igual en
' los dos sistemas; lo nativo se fue al puerto.

Private Const KCM_HTTP_ATTEMPTS As Long = 3

Public Function KcmNewRequestId(ByVal prefix As String) As String
    KcmNewRequestId = prefix & "-" & KcmNewGuidHex()
End Function

''' POST idempotente al puente. `stableRequestId` permite que un reintento sea un no-op del lado
''' del servidor; el nonce y `sentAt` se renuevan en cada intento porque el servidor rechaza un
''' nonce repetido y una marca de tiempo vencida.
Public Function KcmHttpPost(ByVal action As String, ByVal payload As String, _
    Optional ByVal stableRequestId As String = "") As KcmDiccionario
    Dim endpoint As String
    Dim clientId As String
    Dim token As String
    Dim requestId As String
    Dim encodedPayload As String
    Dim attempt As Long
    Dim response As KcmDiccionario
    Dim lastMessage As String
    Dim retryable As Boolean

    endpoint = KcmConfigValue("ENDPOINT")
    If Not KcmEndpointPermitido(endpoint) Then Err.Raise vbObjectError + 7213, "KcmHttpPost", _
        "El endpoint del puente debe usar HTTPS, salvo loopback (127.0.0.1 o localhost)"
    clientId = KcmConfigValue("CLIENT_ID")
    token = KcmCredencialLeer()
    If Len(token) = 0 Then Err.Raise vbObjectError + 7200, "KcmHttpPost", _
        "Falta la credencial del puente en " & KcmCredencialDonde()
    requestId = stableRequestId
    If Len(requestId) = 0 Then requestId = KcmNewRequestId("vba-request")
    ' El cuerpo base64 web-safe ya usa solo caracteres no reservados: se transmite sin recodificar.
    encodedPayload = KcmBase64WebEncode(payload)

    For attempt = 1 To KCM_HTTP_ATTEMPTS
        Set response = KcmHttpAttempt(endpoint, action, clientId, requestId, token, encodedPayload, _
            lastMessage, retryable)
        If Not response Is Nothing Then
            Set KcmHttpPost = response
            Exit Function
        End If
        If Not retryable Or attempt = KCM_HTTP_ATTEMPTS Then Exit For
        Application.Wait Now + TimeSerial(0, 0, attempt * 2)
    Next attempt
    Err.Raise vbObjectError + 7202, "KcmHttpPost", lastMessage
End Function

''' HTTPS siempre, con una sola excepcion: loopback. El token viaja en el cuerpo del POST, asi que
''' en HTTP plano quedaria expuesto a cualquiera en la red. Contra `127.0.0.1` o `localhost` el
''' trafico no sale de la maquina y la excepcion no expone nada; cualquier otro host en claro se
''' rechaza. Un nombre de equipo o una IP de la red local NO son loopback y siguen exigiendo TLS.
Private Function KcmEndpointPermitido(ByVal endpoint As String) As Boolean
    Dim lower As String
    Dim host As String
    Dim cut As Long
    lower = LCase$(Trim$(endpoint))
    If Left$(lower, 8) = "https://" Then
        KcmEndpointPermitido = True
        Exit Function
    End If
    If Left$(lower, 7) <> "http://" Then Exit Function
    host = Mid$(lower, 8)
    cut = InStr(1, host, "/", vbBinaryCompare)
    If cut > 0 Then host = Left$(host, cut - 1)
    cut = InStr(1, host, ":", vbBinaryCompare)
    If cut > 0 Then host = Left$(host, cut - 1)
    KcmEndpointPermitido = (host = "127.0.0.1" Or host = "localhost")
End Function

''' Un intento. Devuelve `Nothing` y describe el fallo en `message`/`retryable` en lugar de lanzar,
''' para que el reintento no dependa de capturar errores de red.
'''
''' El envio lo hace el puerto de plataforma: WinHTTP en Windows, `curl` en macOS. Lo que decide
''' aqui es identico en los dos, porque un 429 y un 503 significan lo mismo se hayan recibido por
''' donde se hayan recibido.
Private Function KcmHttpAttempt(ByVal endpoint As String, ByVal action As String, _
    ByVal clientId As String, ByVal requestId As String, ByVal token As String, _
    ByVal encodedPayload As String, ByRef message As String, ByRef retryable As Boolean) As KcmDiccionario
    Dim body As String
    Dim response As KcmDiccionario
    Dim status As Long
    Dim texto As String
    Dim fallo As String

    retryable = False
    body = "action=" & KcmUrlEncode(action) & _
        "&clientId=" & KcmUrlEncode(clientId) & _
        "&requestId=" & KcmUrlEncode(requestId) & _
        "&sentAt=" & KcmUrlEncode(KcmUtcIsoNow()) & _
        "&nonce=" & KcmUrlEncode(KcmNewRequestId("nonce")) & _
        "&token=" & KcmUrlEncode(token) & _
        "&payload=" & encodedPayload

    If Not KcmTransportePost(endpoint, body, status, texto, fallo) Then
        message = "No fue posible contactar el puente: " & fallo
        retryable = True
        Exit Function
    End If

    If status < 200 Or status >= 300 Then
        message = "El endpoint respondio HTTP " & CStr(status)
        retryable = (status = 408 Or status = 429 Or status >= 500)
        Exit Function
    End If
    Set response = KcmParseProtocolResponse(texto)
    If UCase$(CStr(response.Item("status"))) = "OK" Then
        Set KcmHttpAttempt = response
        Exit Function
    End If
    message = KcmResponseField(response, "code") & ": " & KcmResponseField(response, "message")
    retryable = (UCase$(KcmResponseField(response, "retryable")) = "TRUE")
End Function

Private Function KcmResponseField(ByVal response As KcmDiccionario, ByVal key As String) As String
    If response.Exists(key) Then KcmResponseField = CStr(response.Item(key))
End Function

Private Function KcmParseProtocolResponse(ByVal raw As String) As KcmDiccionario
    Dim normalized As String
    Dim lines As Variant
    Dim result As KcmDiccionario
    Dim index As Long
    Dim separator As Long
    Dim key As String
    Dim value As String
    normalized = Replace$(Replace$(raw, vbCrLf, vbLf), vbCr, vbLf)
    lines = Split(normalized, vbLf)
    If UBound(lines) < 1 Or CStr(lines(0)) <> KCM_PROTOCOL_VERSION Then
        Err.Raise vbObjectError + 7203, "KcmParseProtocolResponse", _
            "El endpoint no devolvio el protocolo VBA esperado"
    End If
    Set result = KcmNuevoDiccionario()
    result.Add "status", CStr(lines(1))
    For index = 2 To UBound(lines)
        If Len(CStr(lines(index))) > 0 Then
            separator = InStr(1, CStr(lines(index)), "=", vbBinaryCompare)
            If separator < 2 Then Err.Raise vbObjectError + 7204, "KcmParseProtocolResponse", _
                "Respuesta VBA invalida"
            key = Left$(CStr(lines(index)), separator - 1)
            value = KcmUrlDecode(Mid$(CStr(lines(index)), separator + 1))
            If result.Exists(key) Then Err.Raise vbObjectError + 7205, "KcmParseProtocolResponse", _
                "Respuesta VBA duplicada"
            result.Add key, value
        End If
    Next index
    Set KcmParseProtocolResponse = result
End Function

Public Function KcmDecodeResponsePayload(ByVal response As KcmDiccionario) As String
    If Not response.Exists("payload") Then Exit Function
    KcmDecodeResponsePayload = KcmBase64WebDecode(CStr(response.Item("payload")))
End Function

Public Function KcmParseTsv(ByVal text As String, ByVal expectedHeaders As Variant) As Collection
    Dim normalized As String
    Dim lines As Variant
    Dim headers As Variant
    Dim values As Variant
    Dim rows As New Collection
    Dim row As KcmDiccionario
    Dim rowIndex As Long
    Dim columnIndex As Long
    normalized = Replace$(Replace$(text, vbCrLf, vbLf), vbCr, vbLf)
    lines = Split(normalized, vbLf)
    If UBound(lines) < 0 Then Err.Raise vbObjectError + 7206, "KcmParseTsv", "El TSV esta vacio"
    headers = Split(CStr(lines(0)), vbTab)
    If UBound(headers) <> UBound(expectedHeaders) Then Err.Raise vbObjectError + 7207, _
        "KcmParseTsv", "Encabezados TSV incompatibles"
    For columnIndex = LBound(headers) To UBound(headers)
        If KcmUrlDecode(CStr(headers(columnIndex))) <> CStr(expectedHeaders(columnIndex)) Then
            Err.Raise vbObjectError + 7208, "KcmParseTsv", "Encabezados TSV incompatibles"
        End If
    Next columnIndex
    For rowIndex = 1 To UBound(lines)
        If Len(CStr(lines(rowIndex))) > 0 Then
            values = Split(CStr(lines(rowIndex)), vbTab)
            If UBound(values) <> UBound(headers) Then Err.Raise vbObjectError + 7209, _
                "KcmParseTsv", "Fila TSV incompatible"
            Set row = KcmNuevoDiccionario()
            For columnIndex = LBound(headers) To UBound(headers)
                row.Add CStr(expectedHeaders(columnIndex)), KcmUrlDecode(CStr(values(columnIndex)))
            Next columnIndex
            rows.Add row
        End If
    Next rowIndex
    Set KcmParseTsv = rows
End Function

Public Function KcmBuildTsv(ByVal headers As Variant, ByVal rows As Collection) As String
    Dim lines() As String
    Dim row As Variant
    Dim values() As String
    Dim rowIndex As Long
    Dim columnIndex As Long
    ReDim lines(0 To rows.Count)
    ReDim values(LBound(headers) To UBound(headers))
    For columnIndex = LBound(headers) To UBound(headers)
        values(columnIndex) = KcmUrlEncode(CStr(headers(columnIndex)))
    Next columnIndex
    lines(0) = Join(values, vbTab)
    For rowIndex = 1 To rows.Count
        row = rows(rowIndex)
        ReDim values(LBound(headers) To UBound(headers))
        For columnIndex = LBound(headers) To UBound(headers)
            values(columnIndex) = KcmUrlEncode(CStr(row(LBound(row) + columnIndex - LBound(headers))))
        Next columnIndex
        lines(rowIndex) = Join(values, vbTab)
    Next rowIndex
    KcmBuildTsv = Join(lines, vbLf)
End Function
