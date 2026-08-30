VERSION 1.0 CLASS
BEGIN
  MultiUse = -1  'True
END
Attribute VB_Name = "KcmDiccionario"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = False
Attribute VB_Exposed = False
Option Explicit

' Mapa de clave de texto a valor, escrito en VBA puro.
'
' Sustituye a `Scripting.Dictionary`, que el cliente usaba en once lugares y que
' no existe en Excel para Mac: el runtime de scripting es parte de Windows.
' Podria haberse resuelto con una directiva `#If Mac`, pero eso habria partido en
' dos el camino de datos mas transitado del cliente --el indice de trabajadores,
' el catalogo de cursos, cada respuesta del puente-- y entonces probar en la Mac
' no diria nada sobre Windows. Aqui hay una sola implementacion y los dos
' sistemas corren exactamente la misma.
'
' Tres decisiones que vale la pena explicar:
'
' 1. La busqueda se apoya en la tabla hash interna de `Collection`, no en un
'    recorrido. El indice de trabajadores tiene mil setecientas entradas y se
'    consulta otras tantas veces: un recorrido lineal serian tres millones de
'    comparaciones de cadena y minutos de espera.
' 2. Las claves se comparan distinguiendo mayusculas, como pedia
'    `vbBinaryCompare` en el codigo anterior. `Collection` las compara sin
'    distinguirlas, asi que la clave se guarda codificada a cuatro digitos
'    hexadecimales por caracter: dos claves que solo difieren en la caja
'    producen codificaciones distintas y la comparacion insensible de
'    `Collection` vuelve a ser exacta.
' 3. El orden de insercion se conserva en arreglos paralelos, porque `Keys` lo
'    devuelve y el lote de liberaciones depende de el.
'
' Lo unico que NO se reproduce de `Scripting.Dictionary` es su rareza mas
' peligrosa: leer una clave inexistente la creaba con valor vacio. Aqui una
' lectura no escribe nunca.

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

''' Se conserva por compatibilidad con el codigo que la fijaba. Solo admite
''' `vbBinaryCompare`: aceptar en silencio una comparacion que no se implementa
''' dejaria al cliente creyendo que dos claves distintas son la misma.
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

''' Agrega una clave nueva. Una clave repetida es un error, igual que en
''' `Scripting.Dictionary`: el cliente lo aprovecha para detectar numeros de
''' trabajador duplicados en la matriz.
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

''' Agrega una clave cuyo valor es un objeto.
'''
''' Existe aparte de `Add` para no depender de como VBA decide envolver un objeto en un `Variant`.
''' Con un parametro `Variant`, un objeto que expone miembro por omision --y `Collection` lo
''' hace-- deja abierta la duda de si se guarda la referencia o el resultado de ese miembro.
''' Declarando `As Object` no hay duda posible, y el sitio de uso dice lo que guarda.
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

''' Valor de una clave. Una clave ausente devuelve `Empty` y no se crea.
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

''' Valor de una clave cuando se sabe que es un objeto. Existe aparte de `Item`
''' para que el sitio de uso diga `Set x = d.Objeto(k)` sin ambiguedad, y para
''' que una clave ausente falle aqui en vez de propagar un `Nothing` silencioso.
Public Function Objeto(ByVal clave As String) As Object
    Dim posicion As Long
    posicion = KcmDicPosicion(KcmDicCodificar(clave))
    If posicion = 0 Then Err.Raise vbObjectError + 7150, "KcmDiccionario.Objeto", _
        "La clave " & clave & " no existe en el diccionario"
    Set Objeto = mValores(posicion)
End Function

''' Escribe una clave, exista o no. Es la semantica que el codigo anterior
''' obtenia asignando sobre el miembro por omision del diccionario de Windows.
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

''' Las claves en orden de insercion, como arreglo de base cero.
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

' -------------------------------------------------------------- internas

''' Posicion de una clave codificada, o cero si no esta.
'''
''' `Collection` no ofrece ninguna forma de preguntar sin lanzar, asi que la
''' ausencia se detecta atrapando el error. Solo cuesta en los fallos, que son
''' las inserciones; las consultas aciertan y no pagan nada.
Private Function KcmDicPosicion(ByVal codificada As String) As Long
    On Error Resume Next
    KcmDicPosicion = CLng(mIndice.Item(codificada))
    If Err.Number <> 0 Then
        Err.Clear
        KcmDicPosicion = 0
    End If
    On Error GoTo 0
End Function

''' Cuatro digitos hexadecimales en minusculas por caracter. El resultado solo
''' contiene digitos y letras minusculas, de modo que la comparacion insensible
''' a mayusculas de `Collection` equivale a comparar las claves originales
''' distinguiendolas. La clave vacia se codifica como un guion, que ninguna
''' codificacion hexadecimal puede producir, porque `Collection` rechaza la
''' cadena vacia como clave.
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
