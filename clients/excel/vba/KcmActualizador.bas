Attribute VB_Name = "KcmActualizador"
Option Explicit

' Actualizacion de los modulos del cliente en un solo paso.
'
' Quitar e importar a mano, modulo por modulo, es lento y facil de equivocar: un
' modulo importado sin quitar el viejo entra como KcmPanel1 y el libro deja de
' compilar. KcmActualizarModulos lo hace de una vez con todos los .bas y .cls de
' la carpeta de modulos (KCM-VBA-CRLF en el escritorio): quita el que tenga el
' mismo nombre e importa el nuevo, y quita los modulos retirados del cliente.
'
' Tres cosas que no son obvias:
'
' - No se actualiza a si mismo: un modulo no puede quitarse mientras corre. Si
'   este cambia, se reimporta a mano, una vez.
' - El viejo se renombra antes de quitarlo. Excel difiere la baja hasta que
'   termina la macro, y sin el cambio de nombre el nuevo entraria como KcmPanel1.
' - Todo lo que se necesita de otros modulos -la carpeta, el permiso de macOS
'   para leer cada archivo, la lista y la confirmacion- se pide ANTES de quitar
'   nada, y si falta un permiso no se toca ningun modulo. Quitar el viejo e
'   importar el nuevo que no se deja leer dejaba el libro sin ese modulo. El
'   aviso final sale cuando la macro ya termino, con los modulos nuevos en su
'   sitio; mientras tanto el resultado viaja en la barra de estado.
'
' Requiere, una sola vez en cada equipo, confiar en el acceso al modelo de
' objetos de proyectos de VBA.

Private Const ESTE_MODULO As String = "KcmActualizador"
Private Const ACCION As String = "Actualizar modulos"
Private Const PREFIJO_BIEN As String = "KCM modulos: "
Private Const PREFIJO_MAL As String = "KCM modulos, detenido: "

' No se toca: el diccionario es la clase de la que depende todo el cliente,
' incluido este modulo. Si se quedara sin el, nada compilaria, ni esta macro
' para repararlo. Casi nunca cambia; cuando cambie, se importa a mano.
Private Const NO_SE_IMPORTAN As String = "|KcmDiccionario|"

' Retirados del cliente. Si siguen en el libro, se quitan: KcmOrdenBarrido desde el
' 2026-09-05; KcmEnvioLocal desde que los envios grandes salen en partes;
' KcmCoordinator, la corrida programada que nunca se habilito, y KcmDiagHash, el
' diagnostico temporal de la huella, que cubre la autoprueba.
Private Const RETIRADOS As String = "|KcmOrdenBarrido|KcmEnvioLocal|KcmCoordinator|KcmDiagHash|"

''' Reemplaza de una vez los modulos del libro por los de la carpeta nueva.
Public Sub KcmActualizarModulos()
    Dim proyecto As Object
    Dim componente As Object
    Dim carpeta As String
    Dim archivos As Collection
    Dim porImportar As Collection
    Dim archivo As Variant
    Dim ilegible As String
    Dim retirado As Variant
    Dim nombre As String
    Dim sufijo As String
    Dim cuantos As Long
    Dim actualizados As Long
    Dim nuevos As Long
    Dim quitados As Long

    On Error Resume Next
    Set proyecto = ThisWorkbook.VBProject
    cuantos = proyecto.VBComponents.Count
    If Err.Number <> 0 Or cuantos = 0 Then
        Err.Clear
        On Error GoTo 0
        KcmAvisoAtencion ACCION, "Excel no deja cambiar los modulos de este libro.", _
            "Se habilita una sola vez: confiar en el acceso al modelo de objetos de proyectos " & _
            "de VBA. En Windows esta en Archivo, Opciones, Centro de confianza, Configuracion " & _
            "de macros; en macOS, en Excel, Preferencias, Seguridad."
        Exit Sub
    End If
    On Error GoTo 0

    carpeta = KcmCarpetaDeModulos()
    If Len(carpeta) = 0 Then Exit Sub
    Set archivos = KcmArchivosDeModulos(carpeta)
    Set porImportar = New Collection
    For Each archivo In archivos
        nombre = KcmNombreDeModulo(CStr(archivo))
        If StrComp(nombre, ESTE_MODULO, vbTextCompare) <> 0 And _
            InStr(1, NO_SE_IMPORTAN, "|" & nombre & "|", vbTextCompare) = 0 Then
            porImportar.Add CStr(archivo)
        End If
    Next archivo
    If porImportar.Count = 0 Then
        KcmAvisoAtencion ACCION, "La carpeta no trae modulos.", carpeta
        Exit Sub
    End If

    ' Todos los permisos de una vez y antes de tocar nada. Sin permiso para leer
    ' un archivo, su modulo quedaria quitado y sin reponer.
    ilegible = KcmConcederAccesoArchivos(porImportar)
    If Len(ilegible) > 0 Then
        KcmAvisoAtencion ACCION, "No se cambio ningun modulo: falta permiso para leer " & _
            KcmNombreDeModulo(ilegible) & ".", _
            "Al repetir la macro, el sistema pide el permiso para los archivos de la carpeta; " & _
            "con Conceder acceso se actualizan todos."
        Exit Sub
    End If

    If Not KcmAvisoConfirmar(ACCION, _
        "Se reemplazaran " & CStr(porImportar.Count) & " modulos del libro por los de la carpeta.", _
        carpeta & vbCrLf & "Al terminar falta Depuracion, Compilar, y guardar el libro.") Then Exit Sub

    ' Desde aqui no se llama a ningun otro modulo del cliente: se estan reemplazando.
    On Error GoTo Fallo
    sufijo = "_v" & Format$(Now, "hhnnss")
    For Each archivo In porImportar
        nombre = KcmNombreDeModulo(CStr(archivo))
        Set componente = KcmComponente(proyecto, nombre)
        If componente Is Nothing Then
            nuevos = nuevos + 1
        Else
            componente.Name = nombre & sufijo
            proyecto.VBComponents.Remove componente
            actualizados = actualizados + 1
        End If
        proyecto.VBComponents.Import CStr(archivo)
    Next archivo

    nombre = ""
    For Each retirado In Split(RETIRADOS, "|")
        If Len(retirado) > 0 Then
            Set componente = KcmComponente(proyecto, CStr(retirado))
            If Not componente Is Nothing Then
                componente.Name = CStr(retirado) & sufijo
                proyecto.VBComponents.Remove componente
                quitados = quitados + 1
            End If
        End If
    Next retirado

    Application.StatusBar = PREFIJO_BIEN & CStr(actualizados) & " actualizados, " & _
        CStr(nuevos) & " nuevos, " & CStr(quitados) & " retirados."
    Application.OnTime Now, "KcmAvisarModulosActualizados"
    Exit Sub

Fallo:
    Application.StatusBar = PREFIJO_MAL & nombre & ": " & Err.Description
    Application.OnTime Now, "KcmAvisarModulosActualizados"
End Sub

''' El aviso final, cuando la macro ya termino y los modulos nuevos estan en su sitio.
Public Sub KcmAvisarModulosActualizados()
    Dim texto As String

    texto = CStr(Application.StatusBar)
    Application.StatusBar = False
    If Left$(texto, Len(PREFIJO_BIEN)) = PREFIJO_BIEN Then
        KcmAvisoHecho ACCION, "Modulos reemplazados: " & Mid$(texto, Len(PREFIJO_BIEN) + 1), _
            "Falta Depuracion, Compilar, y guardar el libro."
    ElseIf Left$(texto, Len(PREFIJO_MAL)) = PREFIJO_MAL Then
        KcmAvisoFallo ACCION, "La actualizacion se detuvo a la mitad. Si el libro compila, " & _
            "se repite con la misma macro; si no, el modulo del detalle se importa a mano.", _
            Mid$(texto, Len(PREFIJO_MAL) + 1)
    End If
End Sub

''' El nombre del modulo a partir de la ruta de su archivo: sin carpeta ni extension.
Private Function KcmNombreDeModulo(ByVal ruta As String) As String
    Dim nombre As String

    nombre = Mid$(ruta, InStrRev(Replace(ruta, "\", "/"), "/") + 1)
    If InStrRev(nombre, ".") > 0 Then nombre = Left$(nombre, InStrRev(nombre, ".") - 1)
    KcmNombreDeModulo = nombre
End Function

Private Function KcmComponente(ByVal proyecto As Object, ByVal nombre As String) As Object
    Dim componente As Object

    For Each componente In proyecto.VBComponents
        If StrComp(componente.Name, nombre, vbTextCompare) = 0 Then
            Set KcmComponente = componente
            Exit Function
        End If
    Next componente
End Function
