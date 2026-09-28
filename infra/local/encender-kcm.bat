@echo off
rem Enciende la plataforma KCM en esta computadora (Windows).
rem
rem Por que existe este archivo y no un boton en la pantalla: si la plataforma
rem local esta apagada, no hay nada escuchando en 127.0.0.1 y ninguna pagina
rem puede dibujarse para encenderla. El encendido tiene que venir de fuera del
rem navegador; el apagado si vive en la consola, que para eso esta corriendo.
rem
rem Como se usa: copiar este archivo al Escritorio y darle doble clic.
rem La ventana que se abre ES la plataforma. Cerrarla tambien la apaga.

setlocal

rem La raiz del repositorio. Se calcula desde la ubicacion de este archivo para
rem que siga funcionando si la carpeta se mueve, y se puede forzar con KCM_RAIZ
rem si el .bat vive en el Escritorio y el repositorio en otro lado.
if defined KCM_RAIZ (
  set "RAIZ=%KCM_RAIZ%"
) else (
  set "RAIZ=%~dp0..\.."
)

if not exist "%RAIZ%\package.json" (
  echo No encuentro la plataforma en: %RAIZ%
  echo.
  echo Si copio este archivo al Escritorio, defina la variable de usuario
  echo KCM_RAIZ con la ruta del repositorio y vuelva a intentarlo.
  echo.
  pause
  exit /b 1
)

cd /d "%RAIZ%"

echo ======================================================
echo   Plataforma KCM - encendida en esta computadora
echo ======================================================
echo.
echo   Esta ventana es la plataforma de esta computadora.
echo   Se apaga con el boton Apagar de la pantalla de inicio
echo   o cerrando esta ventana.
echo.
echo   Consola local:  http://localhost:8787
echo ======================================================
echo.

call npm start
