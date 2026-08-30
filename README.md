# Plataforma KCM Cap

Plataforma única de administración de capacitación para Kimberly-Clark de
México, planta Ecatepec. Node 24 con Fastify, TypeScript y render en servidor,
contra PostgreSQL.

Cubre diez funciones: quiosco de registro, creación de sesiones, sesiones
activas, preliberación, liberación a la matriz, reserva de salas, auditoría,
sistema general por trabajador, constancias DC-3 y conexión con Excel.

## Reglas esenciales

Estas cinco reglas gobiernan el sistema. Romperlas produce pérdida de datos o de
trazabilidad, no un error visible. El razonamiento completo está en
[`docs/arquitectura/DECISIONES.md`](docs/arquitectura/DECISIONES.md).

- El número de trabajador es **texto de cinco dígitos** (`^\d{5}$`) y jamás se
  convierte a número.
- Una liberación exige identidad validada, asistencia comprobada, examen
  confirmado, sesión autorizada y ausencia de liberación previa. Es atómica,
  idempotente y auditable.
- **Sobrescribir sí, borrar no.** Toda sobrescritura de fecha conserva el valor
  anterior con actor, motivo, momento y procedencia.
- **El libro maestro sólo lo escribe el cliente VBA**, sobre destinos
  declarados. El proceso de Node nunca toca el archivo.
- Auditoría y journals sólo se agregan; no existe operación de edición.

Los datos personales reales viven fuera del repositorio: el libro maestro,
`referencias/privado/` y las fuentes del padrón están ignorados por Git, se leen
en sitio y nunca se usan como material de prueba.

## Puesta en marcha

Requiere Node.js 24 o superior. No hace falta ninguna credencial: la suite corre
con repositorios en memoria y datos sintéticos.

```bash
npm install
npm test                 # módulos compartidos: contratos, DNC, DC-3 y XLSB
npm run test:plataforma  # la plataforma
npm run verify           # todo lo anterior más tipos, linters y formato
```

Para levantar la plataforma:

```bash
npm start                # o npm run dev, con recarga al guardar
```

Con Docker, sin instalar Node ni PostgreSQL, queda una plataforma navegable en
<http://localhost:8787> con esquema y datos sintéticos:

```bash
npm run docker:up
```

El detalle está en
[`docs/operacion/DESARROLLO_DOCKER.md`](docs/operacion/DESARROLLO_DOCKER.md).

### Base de datos

```bash
npm run db:migrar     # incremental; aplica sólo lo que falte
npm run db:reset      # reconstrucción completa; ver database/RESET.md
npm run db:cuenta     # alta de una cuenta nominal de consola
npm run db:padron     # carga del padrón semanal
```

### Constancias DC-3

```bash
npm run dc3:plan          # sólo conteos y huellas; no genera archivos
npm run dc3:vista-previa  # banco de pruebas en 127.0.0.1:4175, identidad inventada
npm run dc3:generar -- --config referencias/privado/dc3-config.json
```

El planificador es deliberadamente incapaz de inventar duración, área temática o
agente capacitador: esos campos se capturan en configuración privada, y hasta
entonces la emisión falla cerrada.

## Estructura

Cada carpeta de la raíz dice qué es y dónde corre.

```
plataforma/     el servicio que se despliega (Node 24 + Fastify + TypeScript)
packages/       módulos compartidos entre el servicio y las herramientas
clients/        lo que corre en la máquina de otra persona
database/       el esquema: migraciones, semilla y reconstrucción
infra/          cómo se empaqueta y se levanta
tools/          herramientas de línea de comandos
config/         configuración de ejemplo
docs/           arquitectura, operación y referencia
```

| Ruta | Qué es |
|---|---|
| `plataforma/src/` | Dominio, puertos, adaptadores, servidor, rutas y capa web |
| `plataforma/tests/` | Pruebas agrupadas por tipo: dominio, rutas, caracterización, armazón, estilo y regresiones |
| `packages/dnc/` | Catálogo unificado y motor de reglas DNC en dos niveles |
| `packages/dc3/` | Planificador, compositor PDF sin dependencias y ledger idempotente |
| `packages/xlsb/` | Lector ZIP/BIFF12 del libro maestro, sólo lectura |
| `packages/contracts/` | Contratos versionados y máquina de estados |
| `packages/core/` | Núcleo de referencia para las pruebas de caracterización |
| `packages/tests/` | Banco de pruebas de los módulos compartidos |
| `clients/excel/vba/` | Cliente Excel, único escritor del libro. Corre en Windows y en macOS |
| `clients/excel/mac/` | Guion del puente para Excel en macOS y su instalador de un paso |
| `database/migrations/` | 42 migraciones DDL con RLS forzada |
| `database/seed/` | Compatibilidad de roles y semilla sintética para desarrollo |
| `infra/docker/` | Imagen de producción y de desarrollo |
| `infra/compose.yaml` | Pila local completa: PostgreSQL, migraciones y plataforma |
| `tools/db/` | Migraciones, reconstrucción, alta de cuentas y carga del padrón |
| `tools/build/` | Generadores: semilla de catálogo, mapeo de matriz y DC-3 |
| `tools/check/` | Verificaciones que ESLint no cubre: proyecto, VBA e imagen |

## Documentación

**Arquitectura**

- [`DECISIONES.md`](docs/arquitectura/DECISIONES.md) — las decisiones que
  gobiernan el sistema, con su motivo y lo que cuesta cambiarlas. **Empieza
  aquí.**
- [`ARQUITECTURA.md`](docs/arquitectura/ARQUITECTURA.md) — mapa del sistema.
- [`MODELO_DATOS.md`](docs/arquitectura/MODELO_DATOS.md) — el contrato de datos.
- [`CICLO_DE_DATOS.md`](docs/arquitectura/CICLO_DE_DATOS.md) — la apertura del
  día sobre la copia nueva, las actualizaciones que dispara el capacitador, el
  sello que identifica al libro y la prueba de cierre.
- [`PLATAFORMA_DNC_DC3.md`](docs/arquitectura/PLATAFORMA_DNC_DC3.md) — la
  justificación del stack, con sus referencias.

**Operación**

- [`DESARROLLO_DOCKER.md`](docs/operacion/DESARROLLO_DOCKER.md) — entorno
  completo en contenedores.
- [`MIGRACION_SERVIDORES_INTERNOS.md`](docs/operacion/MIGRACION_SERVIDORES_INTERNOS.md)
  — qué exige la plataforma para correr dentro de la red de la planta.
- [`PUESTA_EN_MARCHA_TRES_EQUIPOS.md`](docs/operacion/PUESTA_EN_MARCHA_TRES_EQUIPOS.md)
  — los tres equipos de planta y el único escritor.
- [`VALIDACION_EXCEL_WINDOWS.md`](docs/operacion/VALIDACION_EXCEL_WINDOWS.md) —
  la validación que sólo puede hacerse con Excel para Windows delante.

**Referencia**

- [`FUENTES_DE_VERDAD.md`](docs/referencia/FUENTES_DE_VERDAD.md) — las cuatro
  fuentes: qué aporta cada una, quién manda cuando dos hablan del mismo dato y
  qué no existe por no salir de ninguna.
- [`DICCIONARIO_MATRIZ.md`](docs/referencia/DICCIONARIO_MATRIZ.md) — columnas y
  significados del libro maestro.
- [`DC3_AUTOMATIZACION.md`](docs/referencia/DC3_AUTOMATIZACION.md) — emisión de
  constancias oficiales.
- [`VBA_BRIDGE.md`](docs/referencia/VBA_BRIDGE.md) — el cliente de Excel y su
  protocolo.
- [`SISTEMA_DE_DISENO.md`](docs/referencia/SISTEMA_DE_DISENO.md) — la capa web.
- [`SISTEMAS_DE_USO_COMUN.md`](docs/referencia/SISTEMAS_DE_USO_COMUN.md) —
  separación respecto de los sistemas compartidos de planta.

## Estado

Las diez funciones están construidas y cubiertas por pruebas. Tres condiciones
externas impiden declarar producción verificada:

1. Falta ejecutar `Debug > Compile` y una prueba de humo COM en Excel para
   Windows. El análisis estático del cliente VBA no lo sustituye.
2. Falta capturar la configuración legal privada del DC-3: duración, área
   temática, agente capacitador y firmantes.
3. Falta un host Node siempre encendido. Una estación de trabajo no da
   continuidad productiva.
