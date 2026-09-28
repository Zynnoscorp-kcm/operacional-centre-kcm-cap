#!/bin/bash
# Enciende la plataforma KCM en esta computadora (macOS).
#
# Por qué existe este archivo y no un botón en la pantalla: si la plataforma
# local está apagada, no hay nada escuchando en 127.0.0.1 y ninguna página
# puede dibujarse para encenderla. El encendido tiene que venir de fuera del
# navegador; el apagado sí vive en la consola, que para eso está corriendo.
#
# Cómo se usa: copiar este archivo al Escritorio y darle doble clic. La primera
# vez, macOS puede pedir permiso para ejecutarlo: clic derecho, Abrir.
# La ventana que se abre ES la plataforma. Cerrarla también la apaga.

set -euo pipefail

# La raíz del repositorio. Se calcula desde la ubicación de este archivo para
# que siga funcionando si la carpeta se mueve de sitio, y se puede forzar con
# KCM_RAIZ si el .command vive en el Escritorio y el repositorio en otro lado.
RAIZ="${KCM_RAIZ:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

if [ ! -f "$RAIZ/package.json" ]; then
  echo "No encuentro la plataforma en: $RAIZ"
  echo
  echo "Si copió este archivo al Escritorio, abra la Terminal y ejecute una vez:"
  echo "  echo 'export KCM_RAIZ=\"/ruta/al/repositorio\"' >> ~/.zshrc"
  echo
  read -r -p "Pulse Intro para cerrar."
  exit 1
fi

cd "$RAIZ"

echo "======================================================"
echo "  Plataforma KCM — encendida en esta computadora"
echo "======================================================"
echo
echo "  Esta ventana es la plataforma de esta computadora."
echo "  Se apaga con el botón Apagar de la pantalla de inicio"
echo "  o cerrando esta ventana."
echo
echo "  Consola local:  http://localhost:8787"
echo "======================================================"
echo

npm start
