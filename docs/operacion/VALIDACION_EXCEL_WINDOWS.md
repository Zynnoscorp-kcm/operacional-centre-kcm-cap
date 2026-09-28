# Validación departamental del puente Excel en Windows

Estado: **PENDIENTE DE EJECUCIÓN POR EL DEPARTAMENTO**. Este guion no equivale
a una validación realizada: el entorno de desarrollo no dispone de Excel para
Windows ni de automatización COM.

## Preparación segura

1. Trabajar con un `KCM_Bridge.xlsm` de prueba y una copia sintética del XLSB;
   nunca con la matriz real durante la validación.
2. Emitir en `/excel` una credencial exclusiva para la combinación de principal,
   perfil de Windows y equipo, con alcance `PUENTE_VBA` y caducidad corta.
3. Guardar el secreto devuelto una sola vez en la variable de usuario
   `KCM_VBA_BRIDGE_TOKEN`. No pegarlo en el libro ni en capturas de pantalla.
4. En `KCM_CONFIG` cambiar una sola coordenada:

   `ENDPOINT = https://<FQDN>/api/v1/vba-bridge`

5. Importar los diecisiete módulos de `clients/excel/vba/`: dieciséis `.bas` y la clase
   `KcmDiccionario.cls`.
6. Ejecutar `KcmInstallButtons` y después `KcmVerificarMatriz`. El humo de la
   instalación se lee entero en la hoja `KCM_ESTADO`: configuración, credencial,
   archivo maestro, forma de la hoja y conexión, cada una con su estado. No
   escribe nada en la base, así que puede repetirse mientras se corrige.

## Compilación y humo COM

1. Abrir el editor con `Alt+F11` y ejecutar `Debug > Compile VBAProject`. Registrar
   versión de Excel, Windows y resultado, sin datos personales.
2. Ejecutar `KcmAsistenteConexion`, que crea las hojas técnicas, y revisar que
   queden ocultas.
3. Pulsar **Actualizar** con una liberación sintética `NO_OVERWRITE`; repetirlo
   y comprobar que no aparece un segundo efecto.
4. Ejecutar un caso sintético `OVERWRITE_WITH_HISTORY`. Comprobar que
   `KCM_SOBRESCRITURAS` contiene valor anterior, actor, referencia del motivo y
   fecha antes de confirmar el nuevo valor.
5. Forzar un conflicto y comprobar que el lote completo falla sin escritura
   parcial. Forzar después un error antes de guardar y comprobar el rollback de
   valor, comentario y formato.
6. Pulsar **Actualización completa** dos veces sobre la misma copia y confirmar
   idempotencia en `MATRIX_IMPORT_V1`: la segunda no cambia nada.
7. Revocar la credencial desde `/excel` y comprobar que la siguiente consulta
   falla cerrada. Repetir con credencial vencida y con equipo distinto.

## Criterio de cierre

El puente sólo puede declararse **VERIFICADO EN WINDOWS** cuando exista
constancia de la compilación sin errores y evidencia de los siete pasos
anteriores. Hasta entonces el estado correcto es «implementado y verificado
localmente por análisis estático y simulación; validación Excel/COM
pendiente».
