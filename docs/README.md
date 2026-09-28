# Documentación

Cuatro carpetas, por lo que necesitas hacer.

## `actas/` — qué se decidió y por qué

- [`2026-09-24-corte-dc3-dnc-y-presentacion.md`](actas/2026-09-24-corte-dc3-dnc-y-presentacion.md)
  — el corte del DC-3 en 2026 con consulta de años anteriores, una sola
  bitácora, emisión en cualquier instancia y sin lote ni plazo; la ficha DNC con
  la referencia CAPTA; la tipografía propia y los textos de toda la consola.
- [`2026-09-24-dc3-plataforma.md`](actas/2026-09-24-dc3-plataforma.md) — DC-3
  como plataforma dentro de la consola: la emisión que vuelve a la lista, varias
  constancias en un solo PDF y el expediente por persona.
- [`2026-09-24-modulo-dc3-y-voz.md`](actas/2026-09-24-modulo-dc3-y-voz.md) —
  el módulo DC-3 en cuatro pantallas, la voz de la consola y la tipografía.
- [`2026-09-21-despliegue-partido.md`](actas/2026-09-21-despliegue-partido.md) —
  el reparto entre la nube y la computadora del departamento: destinos
  evaluados, decisiones de implementación y lo que quedó pendiente.

## `arquitectura/` — por qué el sistema es así

- [`DECISIONES.md`](arquitectura/DECISIONES.md) — las decisiones que gobiernan
  la plataforma, con su motivo y lo que cuesta cambiarlas. **Empieza aquí.**
- [`ARQUITECTURA.md`](arquitectura/ARQUITECTURA.md) — mapa del sistema: dónde
  vive cada cosa y quién puede escribir qué.
- [`MODELO_DATOS.md`](arquitectura/MODELO_DATOS.md) — el contrato de datos y sus
  invariantes.
- [`CICLO_DE_DATOS.md`](arquitectura/CICLO_DE_DATOS.md) — cómo se opera el día:
  la apertura sobre la copia nueva, las actualizaciones del capacitador y la
  prueba de cierre.
- [`PLATAFORMA_DNC_DC3.md`](arquitectura/PLATAFORMA_DNC_DC3.md) — el documento
  que fijó el stack y descartó las alternativas. Antecedente.

## `operacion/` — cómo se levanta y se mueve

- [`DESPLIEGUE_VERCEL.md`](operacion/DESPLIEGUE_VERCEL.md) — cómo se publica,
  las medidas que lo sostienen y las pruebas finales antes de entregar.
- [`DESARROLLO_DOCKER.md`](operacion/DESARROLLO_DOCKER.md) — entorno completo en
  contenedores, sin instalar Node ni PostgreSQL.
- [`MIGRACION_SERVIDORES_INTERNOS.md`](operacion/MIGRACION_SERVIDORES_INTERNOS.md)
  — qué exige la plataforma para correr dentro de la red de la planta.
- [`PUESTA_EN_MARCHA_TRES_EQUIPOS.md`](operacion/PUESTA_EN_MARCHA_TRES_EQUIPOS.md)
  — los tres equipos y el único escritor.
- [`PROTOCOLO_NUBE_Y_EQUIPO.md`](operacion/PROTOCOLO_NUBE_Y_EQUIPO.md) — el trabajo
  diario desde cualquier equipo y el respaldo en la computadora del
  departamento. **Escrito para el colaborador, no para quien instala.**
- [`VALIDACION_EXCEL_WINDOWS.md`](operacion/VALIDACION_EXCEL_WINDOWS.md) — la
  validación que sólo puede hacerse con Excel para Windows delante.

## `referencia/` — el detalle de cada pieza

- [`FUENTES_DE_VERDAD.md`](referencia/FUENTES_DE_VERDAD.md) — las cuatro
  fuentes: qué aporta cada una y quién manda cuando dos se contradicen.
- [`DICCIONARIO_MATRIZ.md`](referencia/DICCIONARIO_MATRIZ.md) — columnas y
  significados del libro maestro.
- [`DC3_AUTOMATIZACION.md`](referencia/DC3_AUTOMATIZACION.md) — emisión de
  constancias oficiales.
- [`AGENTE_OCUPACIONES.md`](referencia/AGENTE_OCUPACIONES.md) — el agente que
  sugiere la clave del Catálogo Nacional de Ocupaciones para el DC-3.
- [`VBA_BRIDGE.md`](referencia/VBA_BRIDGE.md) — el cliente de Excel y su
  protocolo.
- [`SISTEMA_DE_DISENO.md`](referencia/SISTEMA_DE_DISENO.md) — la capa web.
- [`VOZ_DE_LA_CONSOLA.md`](referencia/VOZ_DE_LA_CONSOLA.md) — cómo se escribe lo
  que se lee en pantalla, en la consola y en el libro de Excel.
- [`SISTEMAS_DE_USO_COMUN.md`](referencia/SISTEMAS_DE_USO_COMUN.md) — separación
  respecto de los sistemas compartidos de planta.
