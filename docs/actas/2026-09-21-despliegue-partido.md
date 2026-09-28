# Acta · Despliegue partido entre la nube y el equipo del departamento

**20 y 21 de septiembre de 2026.** Rama `despliegue-nube-local`.

Esta acta recoge lo decidido, por qué, y lo que quedó pendiente. Es un registro
de decisiones, no un manual: el manual es
[`PROTOCOLO_NUBE_Y_EQUIPO.md`](../operacion/PROTOCOLO_NUBE_Y_EQUIPO.md).

---

## 1. La decisión de fondo

La plataforma se parte en dos procesos que hablan con **la misma base**: uno
publicado en la nube y otro corriendo en la computadora del departamento. No
divergen porque los ledgers son de sólo agregar e idempotentes, que es el mismo
motivo por el que ya convivían dos escritores.

El reparto no es una preferencia sino una medida. El alojamiento publicado corta
cualquier petición en **4.5 MB** y no conserva disco entre una y otra, y hay tres
operaciones que no caben ahí:

| Operación | Por qué no cabe en la nube |
|---|---|
| Snapshot completo de la matriz | El libro entero; el puente declara 24 MiB |
| Padrón semanal | El `sem NN CAP.xlsx` supera el techo |
| Lote DC-3 | Escribe archivos y sigue trabajando tras responder |

Todo lo demás —quiosco, agenda, preliberación, liberación, consultas y las unas
quince actualizaciones de fechas del día— vive en la nube sin cambio alguno.

## 2. Destinos evaluados y descartados

| Destino | Dictamen |
|---|---|
| **Vercel** | Viable **sólo** con el reparto. Sus dos techos —4.5 MB y sin estado ni disco— son iguales en todos los planes: no se compran, se rodean. El plan gratuito además prohíbe uso comercial |
| **Cloudflare Containers** | Sustituto directo de Render y sin ninguno de esos techos: admite 100 MB por petición y disco real. Descartado sólo por presupuesto: exige Workers Paid, 5 USD al mes |
| **Cloudflare Workers** | Imposible sin reescribir: no hay proceso que escuche |
| **Google Cloud Run** | Técnicamente holgado, pero exige facturación directa |
| **Render** | Ya no se usa; alojaba el OCR de listas, función retirada |

## 3. Decisiones de implementación

**`KCM_ROLE`**, con valor `local` por omisión. `local` conserva el comportamiento
histórico; `nube` cierra las tres operaciones pesadas con explicación en vez de
dejar que se trunquen a media carga. El valor por omisión conserva lo existente y
publicar en un alojamiento con techos es lo que hay que declarar.

**El papel es propiedad del proceso, no de sus conexiones.** El aviso se dibuja
aunque no haya base conectada. Costó dos defectos encontrarlo: en la ruta del
padrón y luego en las vistas del padrón y del barrido, el mensaje vivía detrás de
la condición «hay base», de modo que quien abriera la pantalla sin base creería
que el problema era la conexión estando además en la máquina equivocada.

**Dos direcciones en `KCM_CONFIG`, y elige el cliente.** `ENDPOINT` para lo
ligero y `ENDPOINT_LOCAL` para las tres cargas grandes; `KcmEndpointParaAccion`
decide por el nombre de la acción. La versión anterior pedía cambiar `ENDPOINT` a
mano antes del barrido y devolverlo al terminar, y ese segundo paso es justo el
que se olvida. `ENDPOINT_LOCAL` es opcional: sin ella todo sale por `ENDPOINT` y
la plataforma rechaza la carga grande explicando por qué.

**El avance del lote DC-3 sale del proceso y va a la base** (`kcm.tarea_dc3`,
migración `0043`). Sin esto, `/dc3` en la nube contestaría «sin configuración»
con el lote ya terminado: una pantalla que miente, no un error visible.

**Encender no puede ser un botón.** Con la plataforma apagada no hay nada
escuchando y ninguna página puede dibujarse; la nube tampoco puede arrancar un
proceso ajeno. El encendido vive en `deploy/local/` —`encender-kcm.command` y
`encender-kcm.bat`— y el apagado sí es un botón, con sesión y confirmación, que
responde 404 con `KCM_ROLE=nube`: un proceso publicado que exponga su propio
apagado es un botón de denegación de servicio.

## 4. Interfaz

Se aplicó la skill `apple-design` **sólo en CSS**. La consola declara
`default-src 'none'` sin `script-src`, así que tres cuartas partes de la skill
—springs, gestos, velocidad al soltar, proyección de momento— no pueden correr.
Se descartó también su §12 de materiales: el rediseño retiró el vidrio esmerilado
porque competía con las tablas, y reintroducirlo sería deshacer una decisión
tomada con motivo.

Lo aplicado: el botón de apagar se transforma en su pantalla de confirmación
mediante transiciones de vista ya existentes, sin JavaScript; se atendieron
`prefers-reduced-transparency` y `prefers-contrast`, que nadie cubría; las cifras
de tablero pasaron de monoespaciada a la familia de texto con `tabular-nums`, que
era lo que sostenía la alineación; y el texto secundario ganó peso, tracking y
contraste. El rótulo diminuto de los mosaicos estaba en **3.1:1 y no cumplía
AA**; ahora está en 4.9:1.

## 5. Volúmenes reales declarados por el departamento

Quince subidas parciales al día, del orden de quinientas fechas, que son
kilobytes y van a la nube. Un barrido completo diario, unos 3.2 MB. Un padrón
semanal. Con estos volúmenes ninguna cuota de tránsito se acerca a su techo: lo
que se agota es la única que no se renueva, los 500 MB de la base.

## 6. Pendiente

- **Supabase está pausado** desde hace semanas. La ventana de rescate es de
  noventa días desde la pausa; después sólo queda el respaldo lógico. Es
  bloqueante: sin base no hay nada que desplegar.
- **La migración `0043` está escrita y sin aplicar**, conforme a la regla de no
  aplicar migraciones sin confirmación del departamento. La plataforma tolera que
  la tabla no exista.
- **No se ha hecho `push`.** Todo vive en `despliegue-nube-local`.
- Queda por decidir el alojamiento y, con él, el plan de pago.

## 7. Estado de la verificación al cierre

586 pruebas de plataforma, 127 unitarias y de integración, analizador VBA sin
hallazgos en 18 módulos, guardas del proyecto, typecheck, Prettier y ESLint: todo
en verde. Se regeneró además la carpeta de importación `KCM-VBA-CRLF`, que estaba
desfasada tres semanas —catorce módulos viejos, dos ausentes y uno retirado—, con
respaldo en `KCM-VBA-CRLF.bak-2026-09-20`.
