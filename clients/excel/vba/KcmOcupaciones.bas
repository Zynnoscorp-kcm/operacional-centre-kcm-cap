Attribute VB_Name = "KcmOcupaciones"
Option Explicit

' Clasificar faltantes: la clave de ocupacion de quien no la tiene.
'
' Es un solo boton y todo lo demas ocurre por dentro:
'
'   1. Toma el padron de ROSTER_PATH, o lo pide si no hay uno, y lo manda tal
'      cual con OCCUPATION_PLAN_V1. Igual que en Padron de la semana, la macro no
'      interpreta el libro: la plataforma lo lee con el extractor de siempre y
'      contesta que trabajadores no tienen clave y en que celda va la de cada uno.
'   2. Manda el estado del lote con OCCUPATION_STEP_V1 una y otra vez, hasta que
'      la plataforma dice que termino. Cada vuelta cabe en una peticion de la
'      nube; la plataforma decide por dentro como dividir el trabajo.
'   3. Guarda una copia del padron junto al original, escribe la clave en cada
'      celda faltante con color y nota, y la deja abierta para revisarla. El
'      original no se toca.
'   4. Apunta ROSTER_PATH a la copia: Padron de la semana envia la revisada.
'
' Si el padron elegido ya tiene una copia clasificada, se ofrece seguir sobre la
' copia: clasificar otra vez el original repetiria lo ya consultado. Cada paso se
' puede repetir sin riesgo, asi que ante un corte de red se espera y se reintenta
' hasta casi dos minutos antes de rendirse.
'
' Al modelo solo viajan puesto y centro de costos. Nombres, CURP y numeros de
' trabajador se quedan en el libro; el estado del lote no los lleva.

Private Const OCUP_VUELTAS_MAXIMAS As Long = 40
' Intentos de cada paso: 2, 8, 18, 32 y 50 s de espera entre ellos.
Private Const OCUP_INTENTOS_POR_PASO As Long = 6
Private Const OCUP_SUFIJO As String = " (ocupaciones"
' Rellenos suaves: verde para sugerida, amarillo para revisar, rojo sin respuesta.
Private Const OCUP_COLOR_SUGERIDA As Long = 14348258
Private Const OCUP_COLOR_REVISAR As Long = 13431551
Private Const OCUP_COLOR_SIN_RESPUESTA As Long = 14342136

''' El boton. Deja el panel KCM_ESTADO con cada etapa y un aviso al terminar.
Public Sub KcmClasificarFaltantes()
    Dim rutaPadron As String
    Dim problema As String
    Dim nombre As String
    Dim huella As String
    Dim miembros As New Collection
    Dim respuesta As KcmDiccionario
    Dim filas As Collection
    Dim resultados As Collection
    Dim porCaso As KcmDiccionario
    Dim fila As KcmDiccionario
    Dim lote As String
    Dim vuelta As Long
    Dim terminado As Boolean
    Dim rutaCopia As String
    Dim resumen As String
    Dim sinColumna As String
    Dim pendientes As Long
    Dim detalle As String
    Dim ultimaCopia As String
    Dim omitidos As Long
    Dim escribiendo As Boolean

    On Error GoTo ClasificarError

    KcmResetCaches
    KcmPanelAbrir "Clasificar faltantes"

    ' --- 1. Padron -------------------------------------------------------
    rutaPadron = KcmConfigValue("ROSTER_PATH", False)
    If Len(rutaPadron) = 0 Or Not KcmRutaExiste(rutaPadron) Then
        rutaPadron = KcmElegirArchivo(KcmAcentos("Padr{o}n a clasificar"))
        If Len(rutaPadron) = 0 Then
            KcmPanelCerrar "Sin padron elegido: no se clasifico nada.", False
            GoTo ClasificarFin
        End If
        KcmConcederAcceso rutaPadron, True
    End If
    problema = KcmLocalFileProblem(rutaPadron)
    If Len(problema) > 0 Then
        KcmPanelPaso "1. Padron", KCM_PANEL_FALLO, problema
        KcmPanelCerrar "No se encontro el archivo del padron.", False
        GoTo ClasificarFin
    End If
    ' Si ya hay una copia mas reciente, lo pendiente vive en ella: clasificar el
    ' original repetiria las mismas combinaciones y gastaria el cupo otra vez.
    ultimaCopia = KcmOcupacionesUltimaCopia(rutaPadron)
    If Len(ultimaCopia) > 0 And StrComp(ultimaCopia, rutaPadron, vbTextCompare) <> 0 Then
        If Not KcmAvisoConfirmar("Clasificar faltantes", _
            KcmAcentos("Se clasificar{a} este archivo aunque ya hay una copia clasificada m{a}s reciente: ") & _
            KcmOcupacionesNombre(ultimaCopia) & ".", _
            KcmAcentos("Se repetir{i}an las combinaciones que ya tienen propuesta y se gastar{i}a el cupo " & _
            "del d{i}a. Con No se clasifica la copia.")) Then rutaPadron = ultimaCopia
    End If
    ' Abrirlo otra vez devolveria la misma ventana, y guardarla como copia la
    ' renombraria: se detiene antes de mandar nada y sin gastar consultas.
    If KcmOcupacionesAbierto(rutaPadron) Then
        KcmPanelPaso "1. Padron", KCM_PANEL_FALLO, "El padron esta abierto en este Excel"
        KcmPanelCerrar "El padron esta abierto; no se clasifico nada.", False
        KcmAvisoAtencion "Clasificar faltantes", KcmAcentos("El padr{o}n est{a} abierto en Excel."), _
            KcmAcentos("Clasificar faltantes abre el archivo por su cuenta y escribe en una copia, as{i} que " & _
            "necesita el padr{o}n cerrado; tambi{e}n estorba un libro con el mismo nombre abierto desde " & _
            "otra carpeta. No se hizo ninguna consulta.")
        GoTo ClasificarFin
    End If
    nombre = KcmOcupacionesNombre(rutaPadron)
    Application.StatusBar = "KCM: leyendo el padron..."
    huella = KcmFileSha256(rutaPadron)
    miembros.Add KcmJsonPair("fileName", nombre)
    miembros.Add KcmJsonPair("sha256", huella)
    miembros.Add KcmJsonPair("content", KcmFileBase64(rutaPadron))
    KcmPanelPaso "1. Padron", KCM_PANEL_OK, nombre

    ' --- 2. Faltantes ----------------------------------------------------
    Application.StatusBar = "KCM: buscando trabajadores sin clave de ocupacion..."
    Set respuesta = KcmHttpPost("OCCUPATION_PLAN_V1", KcmJsonObject(miembros), _
        "vba-ocupaciones-plan-" & Left$(huella, 24))
    Set filas = KcmParseTsv(KcmDecodeResponsePayload(respuesta), _
        Array("hoja", "fila", "numero", "columna", "columnaNumero", "caso"))
    lote = KcmPanelCampo(respuesta, "lote")
    KcmPanelPaso "2. Faltantes", KCM_PANEL_OK, _
        CStr(filas.Count) & " trabajadores sin clave, en " & KcmPanelCampo(respuesta, "cases") & _
        " combinaciones de puesto y centro de costos. Ya con clave: " & _
        KcmPanelCampo(respuesta, "withKey")
    sinColumna = KcmPanelCampo(respuesta, "sheetsWithoutColumn")
    If Len(sinColumna) > 0 And sinColumna <> "0" Then
        KcmPanelPaso "2. Faltantes", KCM_PANEL_AVISO, _
            "Sin columna CLAVE DE OCUPACION, quedan fuera: " & Replace(sinColumna, "|", ", ")
    End If
    omitidos = CLng(Val(KcmPanelCampo(respuesta, "skipped")))
    If omitidos > 0 Then
        KcmPanelPaso "2. Faltantes", KCM_PANEL_AVISO, CStr(omitidos) & _
            " sin puesto o centro de costos que se puedan mandar quedan sin clasificar"
    End If
    If Val(KcmPanelCampo(respuesta, "withText")) > 0 Then
        KcmPanelPaso "2. Faltantes", KCM_PANEL_AVISO, KcmPanelCampo(respuesta, "withText") & _
            " celdas de clave traen texto que no es una clave y no se tocan"
    End If
    ' La plataforma toma primero las combinaciones con mas trabajadores; las que
    ' no caben en la corrida no se tocan y la siguiente las vuelve a encontrar.
    pendientes = CLng(Val(KcmPanelCampo(respuesta, "pendingRows")))
    If pendientes > 0 Then
        KcmPanelPaso "2. Faltantes", KCM_PANEL_AVISO, CStr(pendientes) & " trabajadores en " & _
            KcmPanelCampo(respuesta, "pendingCases") & " combinaciones quedan para la siguiente corrida"
    End If
    If filas.Count = 0 And omitidos > 0 Then
        KcmPanelCerrar "Ningun faltante se pudo clasificar.", False
        KcmAvisoAtencion "Clasificar faltantes", _
            KcmAcentos("Ning{u}n trabajador sin clave se pudo clasificar."), _
            KcmAcentos(CStr(omitidos) & " no tienen puesto o centro de costos que se puedan mandar: " & _
            "vac{i}os o con algo que parece un dato personal. El padr{o}n queda como estaba.")
        GoTo ClasificarFin
    End If
    If filas.Count = 0 Then
        KcmPanelCerrar "No hay trabajadores sin clave de ocupacion.", True
        KcmAvisoHecho "Clasificar faltantes", KcmAcentos("No hay trabajadores sin clave de ocupaci{o}n."), _
            KcmAcentos("El padr{o}n queda como estaba.")
        GoTo ClasificarFin
    End If

    ' --- 3. Clasificacion ------------------------------------------------
    For vuelta = 1 To OCUP_VUELTAS_MAXIMAS
        Application.StatusBar = "KCM: clasificando ocupaciones, paso " & CStr(vuelta) & "..."
        ' El estado viaja completo en cada paso: repetirlo tras un corte no pierde nada.
        Set respuesta = KcmHttpPost("OCCUPATION_STEP_V1", lote, _
            KcmNewRequestId("vba-ocupaciones-paso"), OCUP_INTENTOS_POR_PASO)
        lote = KcmPanelCampo(respuesta, "lote")
        KcmPanelPaso "3. Clasificacion", KCM_PANEL_OK, "Paso " & CStr(vuelta) & ": " & _
            KcmPanelCampo(respuesta, "proposed") & " de " & KcmPanelCampo(respuesta, "cases") & _
            " combinaciones con propuesta; " & KcmPanelCampo(respuesta, "queries") & _
            " consultas al modelo"
        If LCase$(KcmPanelCampo(respuesta, "done")) = "true" Then
            terminado = True
            Exit For
        End If
    Next vuelta
    If Not terminado Then Err.Raise vbObjectError + 7301, "KcmClasificarFaltantes", _
        "La clasificacion no termino en " & CStr(OCUP_VUELTAS_MAXIMAS) & " pasos"

    Set resultados = KcmParseTsv(KcmDecodeResponsePayload(respuesta), _
        Array("caso", "estado", "codigo", "descripcion", "subarea", "confianza", _
            "alternativa", "verificador", "razon"))
    Set porCaso = KcmNuevoDiccionario()
    For Each fila In resultados
        porCaso.AgregarObjeto CStr(fila.Item("caso")), fila
    Next fila

    ' --- 4. Escritura en una copia ----------------------------------------
    Application.StatusBar = "KCM: escribiendo las claves en una copia del padron..."
    rutaCopia = KcmOcupacionesRutaCopia(rutaPadron)
    escribiendo = True
    resumen = KcmOcupacionesEscribir(rutaPadron, rutaCopia, filas, porCaso)
    escribiendo = False
    ' La copia es la que se revisa y la que se envia despues.
    KcmJornadaFijar "ROSTER_PATH", rutaCopia
    KcmPanelPaso "4. Escritura", KCM_PANEL_OK, KcmOcupacionesNombre(rutaCopia) & ": " & resumen
    KcmPanelCerrar "Claves escritas en " & KcmOcupacionesNombre(rutaCopia) & ". " & resumen, True
    detalle = KcmAcentos("La copia qued{o} abierta para revisarla: verde es sugerida, amarillo es a " & _
        "revisar y rojo qued{o} sin respuesta; cada celda trae una nota con el motivo. " & _
        "Padr{o}n de la semana env{i}a esta copia tal como est{e} guardada.")
    If pendientes > 0 Then detalle = detalle & vbCrLf & vbCrLf & KcmAcentos(CStr(pendientes) & _
        " trabajadores quedan para la siguiente corrida, que parte de esta copia. El cupo " & _
        "gratuito alcanza para una corrida completa al d{i}a.")
    KcmAvisoHecho "Clasificar faltantes", resumen, detalle

ClasificarFin:
    Application.StatusBar = False
    Exit Sub

ClasificarError:
    Dim descripcion As String
    descripcion = Err.Description
    On Error Resume Next
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    KcmPanelPaso "Interrumpido", KCM_PANEL_FALLO, descripcion
    KcmPanelCerrar "El proceso se detuvo. La etapa anterior indica donde.", False
    Application.StatusBar = False
    On Error GoTo 0
    If escribiendo Then
        ' La copia ya existe y quedo a medias; ROSTER_PATH sigue en el archivo de antes.
        KcmAvisoFallo "Clasificar faltantes", KcmAcentos("La copia ") & KcmOcupacionesNombre(rutaCopia) & _
            KcmAcentos(" qued{o} a medio escribir; el padr{o}n original no cambi{o}."), _
            descripcion & vbCrLf & vbCrLf & KcmAcentos("Padr{o}n de la semana sigue apuntando al archivo " & _
            "de antes, no a esa copia. Detalle por etapa en la hoja ") & KCM_PANEL_SHEET & "."
    Else
        KcmAvisoFallo "Clasificar faltantes", _
            KcmAcentos("Las claves no se escribieron; el padr{o}n qued{o} como estaba."), _
            descripcion & vbCrLf & vbCrLf & "Detalle por etapa en la hoja " & KCM_PANEL_SHEET & "."
    End If
End Sub

''' Verdadero si hay abierto un libro con el nombre del padron. Excel no abre dos
''' libros con el mismo nombre aunque esten en carpetas distintas.
Private Function KcmOcupacionesAbierto(ByVal ruta As String) As Boolean
    Dim libro As Workbook
    Dim nombre As String

    nombre = KcmOcupacionesNombre(ruta)
    For Each libro In Application.Workbooks
        If StrComp(libro.Name, nombre, vbTextCompare) = 0 Then
            KcmOcupacionesAbierto = True
            Exit Function
        End If
    Next libro
End Function

''' El nombre del archivo sin la carpeta. La ruta puede venir de Windows o de macOS.
Private Function KcmOcupacionesNombre(ByVal ruta As String) As String
    Dim corte As Long

    KcmOcupacionesNombre = ruta
    corte = InStrRev(KcmOcupacionesNombre, "\")
    If corte > 0 Then KcmOcupacionesNombre = Mid$(KcmOcupacionesNombre, corte + 1)
    corte = InStrRev(KcmOcupacionesNombre, "/")
    If corte > 0 Then KcmOcupacionesNombre = Mid$(KcmOcupacionesNombre, corte + 1)
End Function

''' La copia numero `numero` de un padron, junto al original: la 1 es
''' "sem 32 CAP (ocupaciones).xlsx" y las siguientes "sem 32 CAP (ocupaciones 2).xlsx".
''' De una copia sale el mismo nombre que de su original: los sufijos no se apilan.
Private Function KcmOcupacionesCandidata(ByVal origen As String, ByVal numero As Long) As String
    Dim carpeta As String
    Dim base As String
    Dim punto As Long
    Dim corte As Long

    base = KcmOcupacionesNombre(origen)
    carpeta = Left$(origen, Len(origen) - Len(base))
    punto = InStrRev(base, ".")
    If punto > 0 Then base = Left$(base, punto - 1)
    corte = InStrRev(base, OCUP_SUFIJO)
    If corte > 0 Then base = Left$(base, corte - 1)
    If numero = 1 Then
        KcmOcupacionesCandidata = carpeta & base & OCUP_SUFIJO & ").xlsx"
    Else
        KcmOcupacionesCandidata = carpeta & base & OCUP_SUFIJO & " " & CStr(numero) & ").xlsx"
    End If
End Function

''' La ruta de la copia nueva. Si ya existe una -una corrida anterior, quiza
''' revisada- no se pisa: se numera.
Private Function KcmOcupacionesRutaCopia(ByVal origen As String) As String
    Dim numero As Long

    numero = 1
    Do While KcmRutaExiste(KcmOcupacionesCandidata(origen, numero))
        numero = numero + 1
    Loop
    KcmOcupacionesRutaCopia = KcmOcupacionesCandidata(origen, numero)
End Function

''' La copia mas reciente que ya existe de este padron, o "" si no hay ninguna.
Private Function KcmOcupacionesUltimaCopia(ByVal origen As String) As String
    Dim numero As Long

    numero = 1
    Do While KcmRutaExiste(KcmOcupacionesCandidata(origen, numero))
        KcmOcupacionesUltimaCopia = KcmOcupacionesCandidata(origen, numero)
        numero = numero + 1
    Loop
End Function

''' Abre el padron sin tocarlo, lo guarda como copia y escribe en ella. Antes de
''' cada celda comprueba que el numero de ese renglon sea el del trabajador, y
''' solo escribe donde la celda sigue vacia. Devuelve el resumen de lo escrito,
''' con todo renglon del plan en alguna de sus cuentas.
Private Function KcmOcupacionesEscribir(ByVal origen As String, ByVal destino As String, _
    ByVal filas As Collection, ByVal porCaso As KcmDiccionario) As String
    Dim libro As Workbook
    Dim hoja As Worksheet
    Dim fila As KcmDiccionario
    Dim resultado As KcmDiccionario
    Dim celda As Range
    Dim numeroEnLibro As String
    Dim estado As String
    Dim sugeridas As Long
    Dim aRevisar As Long
    Dim sinRespuesta As Long
    Dim noCuadran As Long
    Dim conAlgo As Long

    Application.ScreenUpdating = False
    Set libro = Workbooks.Open(Filename:=origen, UpdateLinks:=0, ReadOnly:=True)
    Application.DisplayAlerts = False
    libro.SaveAs Filename:=destino, FileFormat:=51
    Application.DisplayAlerts = True

    For Each fila In filas
        Set hoja = libro.Worksheets(CStr(fila.Item("hoja")))
        numeroEnLibro = KcmNormalizeEmployeeId( _
            hoja.Range(CStr(fila.Item("columnaNumero")) & CStr(fila.Item("fila"))).Value2)
        Set celda = hoja.Range(CStr(fila.Item("columna")) & CStr(fila.Item("fila")))
        If numeroEnLibro <> CStr(fila.Item("numero")) Then
            noCuadran = noCuadran + 1
        ElseIf Not KcmOcupacionesVacia(celda.Value2) Then
            ' Alguien la escribio mientras se clasificaba: se respeta.
            conAlgo = conAlgo + 1
        ElseIf porCaso.Exists(CStr(fila.Item("caso"))) Then
            Set resultado = porCaso.Objeto(CStr(fila.Item("caso")))
            estado = CStr(resultado.Item("estado"))
            KcmOcupacionesCelda celda, resultado
            If estado = "sugerida" Then
                sugeridas = sugeridas + 1
            ElseIf estado = "revisar" Then
                aRevisar = aRevisar + 1
            Else
                sinRespuesta = sinRespuesta + 1
            End If
        End If
    Next fila

    libro.Save
    Application.ScreenUpdating = True
    libro.Activate

    KcmOcupacionesEscribir = CStr(sugeridas) & " sugeridas, " & CStr(aRevisar) & _
        " a revisar y " & CStr(sinRespuesta) & " sin respuesta"
    If noCuadran > 0 Then KcmOcupacionesEscribir = KcmOcupacionesEscribir & "; " & _
        CStr(noCuadran) & " renglones no se tocaron porque el numero no coincidia"
    If conAlgo > 0 Then KcmOcupacionesEscribir = KcmOcupacionesEscribir & "; " & _
        CStr(conAlgo) & " celdas ya traian algo y no se tocaron"
End Function

''' Vacia como la ve la plataforma: sin nada, con error, o solo con espacios,
''' tambien el espacio duro, tabuladores y saltos de linea.
Private Function KcmOcupacionesVacia(ByVal valor As Variant) As Boolean
    Dim texto As String

    texto = KcmCellText(valor)
    texto = Replace(texto, ChrW(160), " ")
    texto = Replace(texto, vbTab, " ")
    texto = Replace(texto, vbCr, " ")
    texto = Replace(texto, vbLf, " ")
    KcmOcupacionesVacia = (Len(Trim$(texto)) = 0)
End Function

''' Una celda: la clave, el color de su estado y una nota con todo lo que decidio.
Private Sub KcmOcupacionesCelda(ByVal celda As Range, ByVal resultado As KcmDiccionario)
    Dim estado As String
    Dim nota As String
    Dim previa As String

    estado = CStr(resultado.Item("estado"))
    If Len(CStr(resultado.Item("codigo"))) > 0 Then celda.Value2 = CStr(resultado.Item("codigo"))

    If estado = "sugerida" Then
        celda.Interior.Color = OCUP_COLOR_SUGERIDA
        nota = "KCM: sugerida, dos modelos coinciden"
    ElseIf estado = "revisar" Then
        celda.Interior.Color = OCUP_COLOR_REVISAR
        nota = "KCM: a revisar"
    Else
        celda.Interior.Color = OCUP_COLOR_SIN_RESPUESTA
        nota = "KCM: sin respuesta"
    End If
    If Len(CStr(resultado.Item("codigo"))) > 0 Then
        nota = nota & vbLf & CStr(resultado.Item("codigo")) & " " & CStr(resultado.Item("descripcion")) & _
            vbLf & KcmAcentos("Sub{a}rea ") & CStr(resultado.Item("subarea")) & _
            ", confianza " & CStr(resultado.Item("confianza"))
        If Len(CStr(resultado.Item("alternativa"))) > 0 Then _
            nota = nota & vbLf & "Alternativa: " & CStr(resultado.Item("alternativa"))
    End If
    nota = nota & vbLf & CStr(resultado.Item("razon"))

    ' La nota de una corrida anterior se sustituye; la de una persona se conserva
    ' arriba. Un comentario moderno no admite nota: ahi bastan la clave y el color.
    On Error Resume Next
    If Not celda.Comment Is Nothing Then
        previa = celda.Comment.Text
        If Left$(previa, 4) = "KCM:" Then previa = ""
        celda.Comment.Delete
    End If
    If Len(previa) > 0 Then nota = previa & vbLf & vbLf & nota
    celda.AddComment nota
    On Error GoTo 0
End Sub
