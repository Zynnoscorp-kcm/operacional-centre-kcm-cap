# Documentación

Tres carpetas, por lo que necesitas hacer.

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

- [`DESARROLLO_DOCKER.md`](operacion/DESARROLLO_DOCKER.md) — entorno completo en
  contenedores, sin instalar Node ni PostgreSQL.
- [`MIGRACION_SERVIDORES_INTERNOS.md`](operacion/MIGRACION_SERVIDORES_INTERNOS.md)
  — qué exige la plataforma para correr dentro de la red de la planta.
- [`PUESTA_EN_MARCHA_TRES_EQUIPOS.md`](operacion/PUESTA_EN_MARCHA_TRES_EQUIPOS.md)
  — los tres equipos y el único escritor.
- [`VALIDACION_EXCEL_WINDOWS.md`](operacion/VALIDACION_EXCEL_WINDOWS.md) — la
  validación que sólo puede hacerse con Excel para Windows delante.

## `referencia/` — el detalle de cada pieza

- [`FUENTES_DE_VERDAD.md`](referencia/FUENTES_DE_VERDAD.md) — las cuatro
  fuentes: qué aporta cada una y quién manda cuando dos se contradicen.
- [`DICCIONARIO_MATRIZ.md`](referencia/DICCIONARIO_MATRIZ.md) — columnas y
  significados del libro maestro.
- [`DC3_AUTOMATIZACION.md`](referencia/DC3_AUTOMATIZACION.md) — emisión de
  constancias oficiales.
- [`VBA_BRIDGE.md`](referencia/VBA_BRIDGE.md) — el cliente de Excel y su
  protocolo.
- [`SISTEMA_DE_DISENO.md`](referencia/SISTEMA_DE_DISENO.md) — la capa web.
- [`SISTEMAS_DE_USO_COMUN.md`](referencia/SISTEMAS_DE_USO_COMUN.md) — separación
  respecto de los sistemas compartidos de planta.
