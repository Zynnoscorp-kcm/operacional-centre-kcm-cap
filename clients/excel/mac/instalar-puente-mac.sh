#!/bin/bash
set -euo pipefail

origen="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/KcmPuente.applescript"
destino="$HOME/Library/Application Scripts/com.microsoft.Excel"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este guion es de macOS. En Windows el cliente usa WinHTTP y no necesita nada." >&2
  exit 1
fi

if [ ! -f "$origen" ]; then
  echo "No se encontro $origen" >&2
  exit 1
fi

mkdir -p "$destino"
cp "$origen" "$destino/KcmPuente.applescript"
chmod 644 "$destino/KcmPuente.applescript"

echo "Guion instalado en:"
echo "  $destino/KcmPuente.applescript"
echo
echo "Comprobacion de las herramientas que el puente usa:"
for herramienta in /usr/bin/curl /usr/bin/shasum /usr/bin/security /usr/bin/od /bin/date /usr/bin/open; do
  if [ -x "$herramienta" ]; then
    echo "  presente  $herramienta"
  else
    echo "  FALTA     $herramienta" >&2
  fi
done
echo
echo "Ahora, en Excel: ejecute la macro KcmAutoprueba y revise la hoja KCM_ESTADO."
echo "La primera vez macOS puede pedir permiso para que Excel ejecute guiones; concedalo."
