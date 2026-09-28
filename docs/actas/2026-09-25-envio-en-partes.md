# Acta · Código privado en la nube y envío en partes

**25 de septiembre de 2026.** Rama `despliegue-nube-local`.

## Vercel dejó de servir el código

Sin carpeta de salida, Vercel servía como archivo suelto todo lo que se subía:
cualquiera, sin sesión, descargaba el código de la plataforma en los tres
dominios. Ahora la salida es `public/` (sólo `robots.txt`), hay `.vercelignore`
versionado y una prueba que falla si se revierte. El proyecto pasó a protección
estándar: la dirección propia de cada publicación pide cuenta de Vercel y los
tres dominios siguen públicos. No se promueve ninguna publicación anterior a
esta fecha.

## Los envíos grandes salen en partes

El envío local —encender la plataforma en una computadora del departamento
desde Excel— se retiró. En macOS no podía funcionar con la plataforma en el
Escritorio (el sistema niega esa carpeta a lo que Excel ejecuta, sin
preguntar) y obligaba a instalar la plataforma en cada equipo que mandara
archivos grandes.

En su lugar, Excel manda entero lo que cabe (hasta 3 MB codificados) y parte
lo demás con `UPLOAD_PART_V1`; la plataforma junta las partes en
`sistema.envio_parte` (migración `0045`) y procesa el envío con la acción
original. Al terminar, Excel avisa «envío normal» o «envío en N partes». Se
retiraron el módulo `KcmEnvioLocal`, sus botones, su ficha y las claves
`ENDPOINT_LOCAL`, `CARPETA_PLATAFORMA` y `ENVIO_LOCAL`.

## Actualizar el cliente es una macro

`KcmActualizador` agrega `KcmActualizarModulos`: quita e importa todos los
módulos de `KCM-VBA-CRLF`, pide los permisos de macOS antes de tocar nada, no
toca el diccionario y retira `KcmOrdenBarrido` y `KcmEnvioLocal` si siguen en
el libro.

## Módulos que se importan: sólo los necesarios

Un mapa de llamadas desde los botones y las macros de uso dejó fuera lo que
nada usaba. Se retiraron `KcmCoordinator` y su guion `.vbs` (la corrida
programada, que nunca se habilitó y aplicaba la matriz completa sin
revisión), `KcmDiagHash` (el diagnóstico temporal de la huella; lo cubre la
autoprueba) y cuatro rutinas sin llamadas: la consulta de pendientes sin botón,
la transmisión desatendida, un cálculo de color y la apertura del navegador.
Quedan diecisiete módulos, todos en uso. Los ocho que nadie ejecuta a mano
llevan `Option Private Module`: la lista de Macros bajó de 36 a 28 y sólo
muestra botones y macros de uso.

## Aplicado y publicado

`0045` quedó aplicada en Supabase —idéntica byte a byte al archivo, con RLS
forzada y sin advertencias— con columnas al estilo de `0043` (`cliente_id`,
`solicitud_id`, `total_caracteres`, `numero_parte`, `total_partes`). Se probó
con el rol de la plataforma contra la tabla real y se publicó en Vercel.

## Pendiente

- Nada de lo anterior se ha probado todavía dentro de Excel.
