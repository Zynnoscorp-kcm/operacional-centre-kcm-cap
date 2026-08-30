Attribute VB_Name = "KcmCoordinator"
Option Explicit

' Punto de entrada recomendado para una corrida desatendida: el Programador de tareas en Windows,
' o `launchd` en macOS abriendo el libro con `open -a Microsoft\ Excel`. En macOS conviene ademas
' que la matriz y el padron tengan su permiso ya concedido antes de programarla: una corrida sin
' nadie delante no puede responder el cuadro de acceso del sistema.
'
' Las dos etapas permanecen separadas: un fallo del snapshot no revierte una liberacion ya guardada.
' La emision de constancias DC-3 no vive aqui: la resuelve el generador Node, que compone el PDF
' de una pagina y lleva su propio ledger.
Public Sub KcmRunFullCycle(Optional ByVal silent As Boolean = False)
    Dim previousEvents As Boolean
    Dim previousScreenUpdating As Boolean
    Dim previousAlerts As Boolean
    Dim stage As String
    On Error GoTo CycleError
    KcmResetCaches
    previousEvents = Application.EnableEvents
    previousScreenUpdating = Application.ScreenUpdating
    previousAlerts = Application.DisplayAlerts
    Application.EnableEvents = False
    Application.ScreenUpdating = False
    ' Un ciclo desatendido no puede quedarse esperando un cuadro de dialogo de Excel.
    If silent Then Application.DisplayAlerts = False

    ' El modo de calculo ya no se fija aqui. Cada etapa lo administra alrededor de su propia
    ' escritura y lo restituye antes de guardar, para que la matriz maestra nunca quede archivada
    ' en calculo manual para quien la abra despues.
    stage = "liberaciones"
    KcmApplyPendingReleases True
    stage = "snapshot HC"
    KcmTransmitMatrixSnapshot True

    stage = "cierre"
    KcmReleaseMaster
    Application.EnableEvents = previousEvents
    Application.ScreenUpdating = previousScreenUpdating
    Application.DisplayAlerts = previousAlerts
    If Not silent Then MsgBox "Ciclo KCM completado: liberaciones y matriz.", vbInformation
    Exit Sub

CycleError:
    Dim message As String
    message = "El ciclo KCM se detuvo en " & stage & ": " & Err.Description
    On Error Resume Next
    KcmReleaseMaster
    On Error GoTo 0
    Application.EnableEvents = previousEvents
    Application.ScreenUpdating = previousScreenUpdating
    Application.DisplayAlerts = previousAlerts
    If silent Then
        Err.Raise vbObjectError + 7600, "KcmRunFullCycle", message
    Else
        MsgBox message, vbCritical
    End If
End Sub
