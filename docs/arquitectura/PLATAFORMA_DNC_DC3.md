# Elección de plataforma: Node 24 y PostgreSQL

Documento de decisión que fijó el stack y descartó las alternativas. Se conserva
como antecedente: recoge el análisis, las opciones evaluadas y el motivo de cada
descarte. Las decisiones vigentes están resumidas en
[`DECISIONES.md`](DECISIONES.md); donde este documento y aquél difieran, manda
aquél.

El stack elegido es: **Node 24 + Supabase Hosted**. El sistema
se desarrolla en la Mac y la vertical piloto puede ejecutarse desde ella para
dos laptops Windows. Los clientes sólo necesitan navegador y Excel Desktop; no
instalan runtime, certificado, VPN, macro ni acceso a PostgreSQL. La Mac es
origen de desarrollo/piloto, no servidor productivo permanente.

---

## Dictamen ejecutivo

**Sí conviene construir la plataforma nueva desde ahora en Node + SQL.** No
porque los 1,686 trabajadores o las 11,215 relaciones DNC actuales sean un
volumen grande —no lo son—, sino porque el producto exige transacciones,
concurrencia, roles, jobs recuperables, auditoría, trazabilidad temporal,
integración con Excel y una sola verdad. Apps Script/Sheets introduce límites y
complejidad operativa innecesarios para ese destino.

La resolución propuesta es:

1. **Apps Script, Sheets, Drive, `clasp` y el puente Apps Script/VBA quedan fuera
   de todos los runtimes objetivo.** El código se conserva temporalmente sólo
   como especificación de comportamiento y banco de pruebas para el port.
2. **Construir un monolito modular en Node 24 LTS sobre Supabase Hosted.**
   UI, API y workers comparten contratos, repositorio y release; no se crean
   microservicios por módulo. Supabase aporta PostgreSQL, Auth y Storage; Node
   conserva reglas, API, SSR, jobs, OCR, XLSB y DC-3. Edge Functions no sustituyen
   el runtime Node.
3. **Usar Supabase Auth sin depender de Windows/AD.** Acceso web por cuentas
   nominativas de invitación, contraseña y TOTP obligatorio para roles sensibles.
   Node conserva la sesión en cookie `HttpOnly/Secure`; ningún rol se confía a
   metadata editable por el usuario.
4. **Conservar Excel como cliente diario.** Power Query consulta vistas
   protegidas de la API y refresca al abrir, bajo demanda o por intervalo. Las
   escrituras entran como lote a staging, generan diff y requieren aprobación;
   Excel nunca escribe directamente en Supabase/PostgreSQL.
5. **Hacer de SQL la autoridad después del corte.** El XLSB se recalcula,
   importa y concilia como historia; después queda como referencia de sólo
   lectura. Mantenerlo como segundo maestro invalidaría la unificación.
6. **Mantener OCR en paralelo como ruta crítica.** Se porta el orquestador y sus
   journals a SQL; no se reescribe el pipeline ya probado ni se elimina la
   revisión humana.
7. **Autorizar ahora H0 y reservar capacidad para F1, no iniciar F1 todavía.**
   La secuencia obligatoria es `G0 -> H0 -> G1 -> F1 -> G2`. G1 debe cerrar
   proyecto/organización Supabase, región, DPA/PII, dominio HTTPS, túnel,
   correo de recuperación, respaldo, presupuesto y responsables
   antes de construir la vertical sintética
   `login -> carga -> staging -> diff -> aprobación -> SQL -> Excel`.

### La condición económica real

El objetivo puede ser **MXN 0 durante desarrollo y piloto sintético** usando la
Mac existente y un proyecto Supabase Free, sujeto a sus límites. No puede
prometerse continuidad productiva gratuita: Supabase puede pausar proyectos
Free de baja actividad y recomienda respaldos manuales externos para ese plan.

Directiva debe aceptar una de estas políticas:

- **Desarrollo/piloto sintético:** Node y worker en la Mac; Supabase Free; URL
  HTTPS estable por túnel nombrado; cero datos reales y restore ensayado.
- **Piloto con las dos laptops:** una sola URL en puerto 443, sin instalación;
  las laptops nunca llaman directamente a Supabase. Si el proxy la bloquea, IT
  debe permitir ese hostname o se usa descarga/carga manual gobernada.
- **Producción:** plan Supabase y host Node siempre activo con respaldo, DPA,
  soporte y presupuesto aprobados. Se conserva el mismo código y contratos,
  pero CI construye y prueba una imagen OCI para la arquitectura Linux destino
  (`linux/amd64` o `linux/arm64`); no se presume que un binario nativo de la Mac
  sea portable. El FQDN y los contratos públicos no cambian.

No existe una cuarta opción que combine datos personales, disponibilidad,
respaldo, una Mac que puede dormir, bloqueo corporativo arbitrario y costo
garantizado de cero.

Desarrollar en macOS no vuelve técnicamente incompatible a AD/Entra; se excluye
porque no está disponible/confirmado y porque el cliente debe ser portable. La
identidad final es Supabase Auth por decisión de producto, no por limitación de
la Mac.

---

## 1. Línea base y efecto de la nueva decisión

| Hecho observado | Lectura fría | Decisión v7 |
|---|---|---|
| Directiva informa que Apps Script no está en uso | No hay usuarios ni operación que obliguen a coexistir | No desplegarlo ni agregarle DNC/DC-3 |
| El workspace contiene una implementación Apps Script amplia | Es código legado útil, no una plataforma productiva que deba preservarse | Caracterizar, portar reglas útiles y retirar adaptadores Google |
| `src/` suma 29,262 líneas; existen módulos Node de OCR, extracción y DC-3 | Hay activos reutilizables, pero no una API/SQL terminados | Reutilizar por contrato, no copiar línea por línea |
| Al iniciar la revisión había un commit y 200 entradas locales | Un clon limpio no reproduce el sistema descrito | H0 es bloqueante antes de abrir una segunda rama de desarrollo |
| `npm test` ejecutó 562 pruebas: 561 pasan y una falla por mes fijo | La línea base no está verde | Corregir la prueba y fijar CI antes del primer deployment |
| DNC no existe en código | No hay producto que “migrar” | Construirlo directamente sobre SQL |
| DC-3 sólo existe como proceso Node local y nunca ha emitido datos reales | Su compositor y ledger son candidatos a integración, no operación aprobada | Portar como job después del gate legal |
| OCR tiene pipeline y evidencia local, pero falta banco manuscrito/privacidad remota | Cambiar de stack no completa esos gates | Mantener la ruta crítica paralela y la revisión humana |
| Excel/XLSB conserva fórmulas, vínculos y hábitos de negocio | Eliminar Excel sería inviable | Mantenerlo como superficie, no como base paralela |

### Esto no es una migración productiva

Como Apps Script no está en uso, no se propone dual-write, sincronización entre
Sheets y SQL ni un corte de usuarios entre dos plataformas. El trabajo es una
**replataformización antes del arranque**:

- conservar invariantes, algoritmos y pruebas útiles;
- reemplazar repositorios Sheets, locks, caché, Properties, Drive y auth;
- portar las pantallas y servicios necesarios a la nueva API;
- cargar fuentes mediante lotes gobernados;
- y activar un solo sistema de registro.

No se elimina todavía el código legado: se archiva únicamente cuando cada
comportamiento necesario tenga prueba de paridad en Node/SQL. Eso es control de
riesgo, no coexistencia operativa.

### Matriz de reutilización

| Tratamiento | Componentes |
|---|---|
| Reutilizar tras pruebas de caracterización | `src/shared`, lógica pura de dominio, extractores XLSB, geometría/pipeline OCR, compositor PDF DC-3 y fixtures sintéticos |
| Portar | sesiones, captura, examen, preliberación, liberación, HC, DNC, agenda, interfaces web y journals |
| Reemplazar | repositorios Sheets, `LockService`, `PropertiesService`, caché, Drive, autenticación/PIN administrativos y cualquier ID físico de hoja |
| Retirar al alcanzar paridad | deployment Apps Script, `clasp`, esquema Sheets, puente Apps Script/VBA y write-back al XLSB |

---

## 2. Arquitectura objetivo: una plataforma, fronteras distintas

```text
 Windows 1/2 · navegador/Excel · libro distribuido por SharePoint
                           |
             UNA URL HTTPS · PUERTO 443
                           |
             túnel nombrado · dominio estable
                           |
              MAC DE DESARROLLO/PILOTO
        cloudflared -> 127.0.0.1 -> NODE 24
       UI SSR · API · RBAC · dominio · importaciones
       DNC · sesiones · release · agenda · auditoría
            |               |               |
            v               v               v
      SUPABASE AUTH    SUPABASE POSTGRES  STORAGE PRIVADO
      cuentas + TOTP   RLS · RPC · jobs   objectKey + hash
                            |
                    worker Node/OCR
                    XLSB · DC-3
```

“Una plataforma” significa un repositorio, un contrato canónico, un pipeline de
release, una identidad, una base autoritativa y una auditoría. No significa
exponer el mismo endpoint al administrador, al quiosco y a Excel. Cada
superficie conserva su frontera mínima y su autorización específica.

### Stack concreto propuesto

| Capa | Decisión |
|---|---|
| Runtime | **Node 24 LTS** nativo en macOS para desarrollo/piloto y en imagen OCI Linux para producción. El workspace exige `fs`, `crypto`, `zlib`, `Buffer`, N-API y binarios reales |
| Aplicación | Fastify + TypeScript estricto para código nuevo; JavaScript existente detrás de adaptadores hasta su port; JSON Schema/OpenAPI como contrato |
| Interfaz | HTML renderizado en servidor con mejora progresiva y JavaScript mínimo; no SPA pesada ni segundo frontend |
| Backend administrado | **Supabase Hosted:** PostgreSQL, Auth y Storage. Realtime y Edge Functions no son dependencias del MVP |
| Persistencia | Migraciones Supabase versionadas; RLS en toda tabla expuesta; vistas `security_invoker`; RPC PostgreSQL endurecida para mutaciones atómicas; auditoría append-only |
| Identidad | Supabase Auth, alta sólo por invitación, contraseña, recuperación por OTP numérico y TOTP para roles sensibles; sesión web en cookie `HttpOnly`, `Secure`, `SameSite` |
| Jobs | Node crea `BackgroundJob + OutboxEvent` en la RPC transaccional. Worker Node separado reclama por lease/idempotency key y reconciliador local recupera pendientes |
| Archivos | Supabase Storage en buckets privados; SQL conserva `objectKey`, hash, tipo, retención y propietario. Node transmite los archivos autorizados; Windows no recibe URLs Supabase |
| Acceso piloto | Cloudflare Named Tunnel o equivalente aprobado: hostname estable -> `http://127.0.0.1:<puerto>` en la Mac; `/api/*` y `/auth/*` siempre omiten caché |
| Despliegue | `LaunchAgent` supervisado reinicia Node/worker/túnel tras iniciar sesión en la Mac piloto; imágenes OCI separadas permiten moverlos a un host Node 24 siempre activo |
| Observabilidad | Logs estructurados sin PII, métricas de negocio/capacidad, alertas y trazas por `requestId` |
| Excel | Power Query -> misma API HTTPS, con credencial por usuario nominal + perfil Windows + laptop y sólo lectura; importación web por lote para cambios |

Node 24 es LTS hasta abril de 2028. El workspace declara `node >=22`, pero la
suite todavía no se ejecutó en Node 24 dentro del contenedor objetivo; F1 debe
probar esa compatibilidad. Node 26 es una línea Current y no se fija como runtime
productivo. Las imágenes fijan versión exacta y digest; el Dockerfile OCR actual
todavía usa Node 22, por lo que F1 debe probar explícitamente Tesseract, Poppler
y `@napi-rs/canvas` sobre la nueva base antes de cambiarlo.

Durante F1, Node escucha sólo en `127.0.0.1`; el túnel es el único ingreso. La
Mac permanece conectada a energía, sin suspensión durante la ventana piloto y
con firewall activo. Un usuario local dedicado inicia sesión y su `LaunchAgent`
accede a secretos en Keychain y reinicia API, worker y túnel. Tras un reboot no
hay servicio hasta ese login; G4 lo documenta y prueba. Una URL temporal o
quick tunnel sólo sirve para demo sintética: las dos laptops requieren hostname
estable y certificado público válido.

La matriz de red de G1/G4 es explícita:

| Flujo | Requisito |
|---|---|
| Windows -> aplicación | DNS + TCP 443 al FQDN; proxy/VPN/inspección TLS probados |
| Mac `cloudflared` -> Cloudflare | Egress TCP/UDP 7844; si QUIC falla, HTTP/2 sobre TCP 7844 |
| Mac Node -> Supabase API/Auth/Storage | DNS + TCP 443 |
| Mac/CI -> DB para migración/dump | Conexión directa 5432 o Supavisor session 5432 si la red sólo ofrece IPv4; nunca transaction mode 6543 para administración |

El túnel nombrado requiere dominio/zona y token bajo cuenta corporativa. Las
laptops no requieren esos puertos administrativos: sólo 443.

Windows nunca llama directamente a `*.supabase.co`. Navegador y Power Query usan un solo
hostname de la aplicación; Node concentra Auth, API y acceso a datos. Esto
reduce el allowlist corporativo, pero no vence una política que bloquee ese
dominio: G4 exige prueba real en ambas laptops y, si falla, intervención de IT o
flujo manual.

Las plantillas de invitación/recuperación entregan un OTP numérico que el usuario
captura en el FQDN Node; Node ejecuta `verifyOtp` servidor a servidor. No se usan
`ConfirmationURL` o magic links que obliguen a Windows a visitar el dominio
Supabase. SMTP, expiración, replay y revocación se prueban en G4.

Node usa `@supabase/supabase-js` y RPC por HTTPS para el tráfico rutinario. Las
operaciones de release, aprobación e importación se implementan como funciones
PostgreSQL transaccionales, idempotentes y auditables. CLI, migraciones y
`db dump` usan la conexión administrativa/Supavisor sólo desde la Mac o CI, no
desde Excel.

Las solicitudes web autenticadas usan el JWT personal en un cliente Supabase
acotado a la petición y se evalúan mediante RLS. Node conserva por separado un
cliente de sistema con una llave `sb_secret_*`; esta llave se traduce al rol
PostgreSQL `service_role`, tiene `BYPASSRLS` y acceso amplio al proyecto. Las
llaves JWT heredadas `anon`/`service_role` no forman parte del stack objetivo y
deben deshabilitarse cuando la compatibilidad comprobada permita retirarlas.

Power Query sigue otra frontera: la credencial Basic no es un JWT de Supabase y
por ello las rutas Excel no pueden atribuirse RLS de usuario. Node resuelve el
identificador opaco de la asignación, compara en tiempo constante el digest del
token y llama con su cliente `sb_secret_*` a una RPC exclusiva de exportación.
La RPC no confía en actor, rol o alcance enviados por Excel o Node: vuelve a
cargar la asignación, principal activo, roles, población, periodo,
vencimiento/revocación, `snapshotId` y recurso permitido dentro de la misma
transacción; devuelve sólo el read model autorizado y agrega `AuditEvent`. La
frontera de esa ruta es **autorización Node + RPC explícita**, no RLS basado en
JWT. Ese cliente tiene prohibidas las consultas directas a tablas desde el
código de aplicación.

La llave `sb_secret_*` jamás se entrega al worker, navegador, Excel, código M,
túnel ni logs. El worker se autentica sólo contra un endpoint interno Node con
token de job de un uso; Node media su acceso a Supabase.

Toda RPC `SECURITY DEFINER` fija `search_path`, revoca `EXECUTE` a `PUBLIC/anon`,
concede sólo al rol necesario y revalida actor, rol, snapshot e idempotency key.
RLS aplica a tablas, no a vistas: las vistas expuestas usan
`security_invoker=true` o permanecen en un esquema no expuesto.

Storage y PostgreSQL no comparten una transacción. Cada evidencia sigue
`PENDING -> objeto cargado -> hash/validación -> READY`; un reconciliador marca
faltantes y elimina huérfanos según retención. Los objetos son inmutables, sin
`upsert`, y una liberación sólo puede consumir evidencia `READY`. No se promete
atomicidad inexistente entre archivo y fila SQL. Navegador/Excel descargan por
Node; las URLs firmadas de Supabase no forman parte del contrato cliente F1.

### Lo que se excluye deliberadamente

- Apps Script, Sheets o D1 como persistencia.
- Supabase Edge Functions, Cloudflare Workers o Realtime/WebSockets como runtime
  del núcleo: el código necesita Node 24 real y el cliente corporativo debe
  funcionar por HTTPS convencional y polling.
- exponer `supabase start`, PostgreSQL, Studio o Storage directamente desde la Mac.
- LAN por HTTP, IP cambiante, certificado autofirmado o instalación de una CA en
  las laptops corporativas.
- Cloudflare Access interactivo delante de `/api/excel/*`; su login rompería
  Power Query Basic. Node autentica esas rutas directamente.
- Kubernetes, microservicios, Redis, event bus y un data warehouse en el MVP.
- Next.js/SPA si una pantalla renderizada en servidor resuelve el flujo.
- acceso de Excel o navegador directo a Supabase/PostgreSQL.
- secretos compartidos dentro de libros, código M, VBA, URLs o actas.
- un segundo emisor DC-3 o un segundo ledger de liberaciones.

---

## 3. Costo: Supabase Free sirve para validar, no para garantizar continuidad

### Perfil elegido para F1

F1 usa **Node 24 en la Mac + Supabase Hosted Free + túnel HTTPS nombrado**, con
datos exclusivamente sintéticos. Es una combinación razonable para demostrar
el flujo en las dos laptops sin comprar infraestructura antes de validar el
producto.

Las cuentas y buzones de F1 también son sintéticos. Antes de que las laptops
reales atraviesen Supabase/Cloudflare, G1 debe aprobar al menos el tratamiento de
IP, telemetría y metadata técnica por ambos proveedores; si no, la prueba queda
local y no se invita a operadores reales.

El límite no es el volumen DNC actual. Los riesgos reales son:

- Supabase puede pausar un proyecto Free con baja actividad durante siete días;
- una base Free que supera 500 MB entra en modo de sólo lectura;
- Supabase recomienda a Free realizar `supabase db dump` y conservar copias
  externas;
- el backup de PostgreSQL no restaura los objetos de Storage;
- evidencia OCR puede agotar Storage/egress antes que las tablas;
- la Mac deja el sistema fuera de servicio al dormir, reiniciar, perder internet
  o cerrar el proceso; y
- dominio, SMTP, host Node productivo, soporte y plan Supabase de continuidad
  pueden tener costo.

Al 2026-08-02, Free publica dos proyectos activos, 500 MB de base, 1 GB de
Storage, 5 GB de egress no cacheado + 5 GB cacheado, cómputo Nano compartido de
hasta 0.5 GB RAM y archivos de hasta 50 MB. Son cuotas modificables, no SLA. G1
estima originales/recortes OCR, DC-3 y refreshes por ciclo; al 70% de cualquier
cuota se detienen nuevas cargas hasta aprobar retención o cambio de plan.

Por ello, Free no se usa para datos personales reales ni como SLA. Antes de
producción, G8 exige un plan Supabase que no dependa de pausa por inactividad,
backup diario/restore aprobado, copia externa de Storage y un host Node siempre
activo. No se fija hoy una tarifa: se cotiza con precios vigentes al gate.

### Política financiera operable

1. La organización/proyecto Supabase, dominio y túnel pertenecen a la compañía;
   nunca a una cuenta personal sin relevo. Hay dos administradores y recuperación.
2. Desarrollo local usa mocks y, cuando se necesite, Supabase CLI sólo en
   loopback. La pila local jamás se publica por el túnel.
3. F1 busca MXN 0 con sintéticos, sin habilitar un plan facturable ni cargos de
   sobreconsumo; sus límites y comportamiento de restricción se ensayan.
4. Antes de F1 externo se aprueba metadata técnica/IP de conectividad. Antes de
   datos o identidades reales se aprueban región, DPA/PII, retención, SMTP,
   disponibilidad, plan Supabase, host Node, RPO/RTO y presupuesto mensual.
5. El paquete DR externo incluye migraciones, roles, datos de dominio, usuarios
   y configuración Auth autorizada, RLS/RPC, buckets/políticas/objetos Storage,
   extensiones/jobs e inventario de configuración Node/SMTP/túnel. Se restaura
   en un proyecto nuevo, se rotan URLs/claves y se prueba login, denegación,
   evidencia y replay. `db dump` por sí solo no es restore.
6. Se mide costo/uso por importación, refresh Excel, archivo OCR, egress y lote
   DC-3 durante dos ciclos.

### Presupuesto que falta completar

La v7 define esfuerzo, no una cotización monetaria. H0 no inicia si requiere un
gasto externo no aprobado en G0. F1 **no está financieramente autorizable**
hasta que IT/Finanzas complete y firme:

| Campo de decisión | Valor | Momento límite |
|---|---|---|
| Costo interno/externo de H0 (1–2 persona-semanas) | `[POR DEFINIR] MXN` | G0 |
| Costo interno/externo de F1 (8–12 persona-semanas + IT) | `[POR DEFINIR] MXN` | G1 |
| Cuenta organizacional Supabase, región y responsables | `[POR CONFIRMAR]` | G1 |
| Dominio/túnel, SMTP y allowlist de las dos laptops | `[POR CONFIRMAR]` | G1 |
| Techo del piloto sintético | `objetivo MXN 0; techo [POR DEFINIR] MXN` | G1 |
| Plan Supabase + host Node para datos reales | `[POR COTIZAR] MXN/mes` | G8 |
| Dueño presupuestal y responsable de backup/restore | `[POR NOMBRAR]` | G1 |

### Alternativas honestas

| Opción | Dictamen |
|---|---|
| Mac + Supabase Free + túnel nombrado | **Elegida para F1 sintética.** Permite validar dos laptops sin instalar software; no es producción |
| Mac + Supabase pagado | Mejora Supabase, no elimina suspensión, reinicio, internet ni punto único de falla de la Mac |
| Host Node siempre activo + Supabase aprobado | **Destino de producción.** Misma imagen y dominio; requiere costo, soporte, DPA y restore |
| LAN `http://IP:puerto` o certificado propio | Sólo diagnóstico sintético; frágil ante VLAN, firewall, IP, TLS y permisos corporativos |
| Clientes directos a Supabase | Rechazada: multiplica dominios, expone superficie y complica RLS/allowlist |
| Excel/SharePoint gobernado | Contingencia si la URL está bloqueada o la Mac no está disponible |

No se autohospeda la pila completa de Supabase en la Mac. La CLI local es para
desarrollo; publicar Studio, Postgres, Auth o Storage locales sería inseguro y
haría más pesada la operación que se intenta simplificar.

---

## 4. SQL como única verdad

El esquema no debe replicar hojas. Debe representar hechos, vigencias,
decisiones y reintentos.

### Agregados mínimos

| Área | Entidades mínimas |
|---|---|
| Integración | `ImportBatch`, `ImportRow`, `MappingProfile`, `SourceAssertion`, `ExportGeneration` |
| Personas | `Employee`, `EmploymentPeriod`, atributos laborales con `sourceAsOf` y vigencia |
| Capacitación | `Training`, alias/equivalencias, `Session`, `Attendance`, `ExamReconciliation`, `Evidence` |
| Liberación | `PreReleaseReview`, `ReleaseBatch`, `ReleaseEffect`, journal y marcador idempotente |
| Historial | `CompletionEvent`, corrección/retiro/reactivación enlazados; nunca una sola fecha mutable |
| DNC | `DncRuleVersion`, población, recurrencia, excepción, resultado explicable y `ConflictCase` |
| DC-3 | `Dc3MetadataVersion`, `Dc3Job`, `Dc3DocumentJournal`, revocación/reemisión |
| Plataforma | `RoomReservation`, `RoleAssignment`, `AuditEvent`, `OutboxEvent`, `BackgroundJob` |

### Reglas no negociables

- `employeeId` sigue siendo texto de cinco dígitos; nunca número de Excel.
- Una liberación exige identidad validada, asistencia comprobada, examen
  confirmado, sesión autorizada y ausencia de liberación previa.
- La liberación es atómica, idempotente, auditable y no sobrescribe una fecha
  existente por defecto.
- `requestId` identifica transporte; la clave de negocio impide un segundo
  efecto aunque cambie la solicitud.
- Los lotes pasan por `RECEIVED -> STAGED -> VALIDATED -> APPROVED -> COMMITTED`
  o un estado terminal de rechazo/conflicto.
- Ausencia en un extracto no equivale a baja. Un lote `FULL` o `DELTA`, su corte
  y sus umbrales se declaran antes de aplicarlo.
- Toda regla DNC tiene población, curso, recurrencia, vigencia, versión y
  aprobador. No existe una recurrencia global inventada.
- Una corrección agrega una decisión; no borra el hecho original ni oculta una
  liberación efectiva.
- DNC no almacena ni entrega CURP. DC-3 accede sólo dentro de su frontera
  aprobada.
- Auditoría y journals son append-only; los archivos crudos viven fuera de SQL
  y se referencian por hash/URI autorizada.

### Autoridad por dato

| Dato | Autoridad después del corte |
|---|---|
| Identidad y situación laboral | Último extracto corporativo aceptado; si vence, se marca, no se sustituye silenciosamente |
| Catálogo, alias y reglas DNC | Capacitación + responsables de área, versionados y aprobados |
| Historia anterior al corte | Importación conciliada del XLSB con procedencia y hash |
| Nuevas capacitaciones | `CompletionEvent` derivado de liberación efectiva en SQL |
| Excepciones/conflictos | Resolución formal con actor, motivo, evidencia, aprobador y vigencia |
| Metadatos DC-3 | Versión aprobada por Capacitación/Legal |
| Reservas | Plataforma SQL, con cancelación como transición y no borrado |

---

## 5. Excel conserva una conexión viva, pero no una segunda verdad

### Definición que sí puede cumplirse

En esta propuesta, **conexión viva** significa:

- Excel consulta la API sin exportar manualmente un archivo intermedio;
- refresca al abrir o con `Actualizar todo`; el intervalo de 15–30 minutos sólo
  se activa después de medir carga y latencia mientras el libro está abierto;
- cada tabla muestra `schemaVersion`, `snapshotId`, `serverRevision`,
  `sourceAsOf` y `lastSuccessfulRefreshAt`;
- si un refresh falla, la tabla anterior puede permanecer cacheada: conserva su
  última marca exitosa y Excel muestra el error en Queries & Connections;
- y el libro nunca necesita una contraseña SQL ni un token incrustado.

No significa push en tiempo real, actualización con Excel cerrado ni edición
bidireccional instantánea. Power Query es un mecanismo de importación/refresco y
caché local. Prometer más sería falso.

### Canal de lectura

```text
Excel -> Power Query Web + CSV -> GET /api/excel/v1/* -> snapshot SQL
```

Endpoints iniciales:

- `/api/excel/v1/dnc-avance`;
- `/api/excel/v1/dnc-faltantes`;
- `/api/excel/v1/capacitaciones`;
- `/api/excel/v1/calidad-datos`;
- `/api/excel/v1/liberaciones`.

Devuelven `Content-Type: text/csv; charset=utf-8` sin extensión `.csv`, además
de las cabeceras `no-store`. Quitar la extensión reduce el riesgo de caché por
tipo, pero no sustituye la regla Bypass.

El libro obtiene primero un `snapshotId` inmutable y lo envía en las cinco
consultas. Todas deben devolver la misma `serverRevision`; si una difiere, el
libro marca el ciclo `INCONSISTENTE` y no puede usarse como base de una carga.
`snapshotId` no es una capability: cada endpoint reautoriza actor, población y
periodo. ETag incorpora revisión + alcance autorizado; por sí solo no ofrece una
transacción entre consultas de Power Query.

La API filtra por rol, población y periodo y nunca expone un `SELECT *`. F1 usa
explícitamente **Power Query Web + CSV**, no promete OData. Excel no puede
reutilizar de forma confiable la cookie de Supabase Auth del navegador; por eso
cada combinación **usuario nominal + perfil Windows + laptop** recibe una
credencial Basic propia, revocable, caducable y de sólo lectura:

- usuario: identificador opaco de esa asignación;
- contraseña: token aleatorio de al menos 128 bits, mostrado una sola vez;
- servidor: sólo conserva hash, scopes, vencimiento, estado y último uso;
- Power Query: la credencial se configura en el origen de datos de cada laptop,
  nunca en celdas, código M o SharePoint; y
- pérdida/reasignación: revocación individual sin afectar la otra laptop; y
- validación: comparación constante, rate limit, `401` Basic sin HTML para
  credencial ausente/inválida y `403` para alcance insuficiente.

Basic sólo es aceptable sobre HTTPS público válido. Proxy, túnel, aplicación y
telemetría omiten de sus logs `Authorization`, cookies, secretos y parámetros.
Esas credenciales sí atraviesan el túnel cifrado. El token no
es una contraseña Supabase ni una llave `sb_secret_*`.

Excel no se conecta directamente a Supabase/PostgreSQL. Entregar cuentas de
base o claves Supabase acoplaría el libro al esquema y saltaría RBAC,
minimización y auditoría de Node.

### Windows, SharePoint y bloqueos corporativos

- La aplicación web funciona en Edge/Chrome moderno en Windows, macOS o Linux;
  no instala Node, extensión, VPN, macro ni certificado.
- Las dos laptops sólo requieren `https://<dominio-aprobado>` por 443. Si proxy,
  VPN o filtro bloquea ese FQDN, no existe un bypass técnico legítimo: IT debe
  permitirlo o se activa contingencia manual.
- Una biblioteca SharePoint aprobada, con ACL/retención corporativas,
  distribuye/versiona la plantilla `.xlsx` y el último snapshot aprobado. No es
  la base, no guarda tokens y no vuelve accesible la Mac.
- Cada laptop abre el libro en Excel Desktop y configura su propia credencial.
  No se promete refresh en Excel Online ni persistencia de credenciales entre
  usuarios.
- La plantilla maestra está vacía/de sólo lectura; cada alcance usa su propia
  copia o snapshot. Copiar el `.xlsx` a otra laptop no debe copiar la credencial.
- Automatizar SharePoint requeriría Microsoft Graph y permisos corporativos;
  queda fuera de F1. La carga inicial usa el selector web sobre un archivo
  descargado/sincronizado por el usuario.
- Si la API está bloqueada, el libro conserva el último snapshot con marca
  `DESACTUALIZADO`; nunca lo presenta como conexión viva. Una carga pendiente se
  deposita en una carpeta SharePoint gobernada y el steward la procesa al
  recuperarse el servicio; no hay sincronización automática.

### Canal de escritura

```text
Libro/CSV -> carga web -> STAGING -> validación -> diff -> aprobación
          -> una transacción SQL -> nueva serverRevision -> refresh Excel
```

1. Las hojas/tablas `CONSULTA_*` son protegidas, de sólo lectura y reemplazables
   por refresh; las `CAPTURA_*` son independientes y nunca se refrescan encima.
2. La plantilla contiene `_KCM_META` con versión, `workbookId`, generación,
   corte y `baseSnapshotId` emitido por servidor. Es ayuda de concurrencia/UX,
   no evidencia confiable aportada por el cliente.
3. El ingestor vuelve a resolver actor/rol y valida `baseSnapshotId`, extensión,
   tamaño, encabezados, fórmulas cacheadas,
   duplicados, IDs, fechas y generación.
4. El ensayo presenta altas, bajas, cambios, fechas nuevas, retiros, conflictos
   y filas inválidas.
5. Un aprobador distinto confirma cambios masivos o sensibles.
6. SQL aplica todo o nada, agrega auditoría/outbox y devuelve una revisión nueva.
7. Una copia vieja produce conflicto y diff; nunca merge ni overwrite silencioso.

Power Query no se usa para escritura autenticada: Microsoft documenta que
`Web.Contents` sólo permite POST anónimo. La carga web es la ruta base segura.

### VBA y Office Add-in

El puente VBA actual depende de Apps Script y no forma parte del target. Si el
negocio exige write-back cercano a tiempo real desde celdas:

- se cotiza un cliente nuevo contra la API Node;
- usa identidad delegada o una sesión corta, jamás secreto compartido;
- mantiene cola local, idempotency key, ACK y conflicto `409`;
- requiere firma/política de macros en Windows; o
- se reemplaza por Office Add-in con despliegue central de Microsoft 365.

Ambas alternativas requieren IT, pruebas y soporte y quedan fuera del MVP. No
son necesarias para mantener Excel como herramienta diaria.

### Corte del XLSB

1. Abrir y recalcular el XLSB en Excel con sus vínculos autorizados.
2. Registrar hash, corte, estructura, conteos y diagnósticos.
3. Importar historia a staging y conciliar trabajadores, cursos y fechas.
4. Resolver diferencias y aprobar el lote.
5. Declarar fecha de corte; SQL se vuelve autoridad.
6. Conservar el XLSB histórico en sólo lectura.

Si Directiva exige que el XLSB siga recibiendo escrituras, está eligiendo dos
verdades. Eso requiere otro adaptador, prolonga el proyecto y contradice esta
propuesta de unificación.

---

## 6. Procesos que la plataforma debe corregir

### Ingesta laboral y matrices

1. Recepción manual o canal corporativo autorizado.
2. Cuarentena; hash, `sourceAsOf`, tipo `FULL/DELTA` y esquema.
3. Perfil de mapeo versionado; nunca adivinanza silenciosa.
4. Staging y validación de tipos, duplicados y conteos.
5. Diff contra la última revisión aceptada.
6. Aprobación humana; segundo aprobador si rebasa umbrales.
7. Commit transaccional, outbox y reconciliación.
8. Panel de errores con dueño, antigüedad y resolución.

Si el extracto semanal falta, se conserva el último aceptado y se marca
`FUENTE_VENCIDA`; no se sustituye por una fuente de menor autoridad.

### DNC

El primer producto funcional es DNC explicable y de lectura:

- avance por persona, curso, área y población;
- pendientes, por vencer, vencidos, exentos y conflictos;
- motivo de aplicabilidad y regla/versiones usadas;
- estados `DATOS_INSUFICIENTES` y `EN_CONFLICTO` separados del porcentaje;
- corte/frescura visibles;
- y las mismas vistas consumibles desde Excel.

No se publican porcentajes hasta aprobar reglas, alias, departamentos y muestra
de paridad humana.

### Sesiones, OCR y liberación

El port conserva el orden de gates actual:

```text
sesión -> captura/OCR -> revisión -> examen -> preliberación
       -> autorización -> liberación SQL -> completion -> DNC/outbox
```

OCR sigue en paralelo. La transacción crea `BackgroundJob + OutboxEvent`; tras
el commit, la API notifica al worker y un reconciliador programado recupera
pendientes o leases vencidos. El worker reclama la clave en SQL antes de
procesar. Así, una falla entre commit y señalización no pierde el trabajo ni
crea dos efectos.

El job conserva evidencia completa: 40 filas × 5 casillas × 2 variantes, con
asociación y hash. SQL guarda un `objectKey` opaco, nunca una ruta física o URL
firmada reutilizable.
Originales y recortes sólo los consulta `REVISOR_EVIDENCIA` por caso y con
auditoría; `AUDITOR` ve metadata/hash por defecto, no imágenes.

Se portan las guardas existentes de MIME real, una página, PDF cifrado/activo,
límites de bytes/píxeles/descompresión, timeout/memoria, cuarentena, limpieza de
temporales y logs sin cuerpo/PII. El worker usa token interno de job de un uso
contra Node y egress restringido; no conserva claves Supabase. Hasta aprobar
banco anonimizado, holdout independiente,
métricas/umbrales y una decisión formal de riesgo, **el 100% de filas —incluidos
blancos y alta confianza— requiere revisión humana**. OCR nunca valida por sí
solo identidad, asistencia, examen o autorización.

### DC-3

El compositor Node existente se integra como un job único sólo después de
aprobar duración, área temática, agente, firmantes, muestra, canal y retención.
El rezago potencial no autoriza emisión masiva.

Cada documento conserva metadata/plantilla versionadas, hash, estado y journal.
Una corrección revoca o versiona; nunca sobrescribe un PDF previo. CURP queda
fuera de DNC y entra sólo a la frontera DC-3 autorizada.

---

## 7. Rapidez y ligereza medibles

La rapidez no se obtiene cambiando de proveedor; se obtiene reduciendo capas y
midiendo el camino crítico.

### Decisiones de diseño

- monolito modular y una base; no llamadas de red entre módulos;
- HTML SSR y JavaScript mínimo; sin bundle de SPA para formularios/tablas;
- operaciones SQL por lote, índices por claves de negocio y paginación;
- staging con cargas masivas, no `INSERT` fila por fila desde Excel;
- snapshots/read models coherentes y ETag por alcance; caché compartida prohibida
  para DNC/Excel autenticado;
- jobs asíncronos para XLSB, OCR, exportes y PDF;
- cliente HTTP/RPC con timeouts, keep-alive y concurrencia acotada; conexiones
  administrativas sólo durante migración/backup;
- cero polling permanente en el perfil gratuito;
- archivos binarios fuera de la base y respuestas Excel en streaming.

### Presupuestos de aceptación para F1/F2

| Medición | Objetivo inicial |
|---|---:|
| UI administrativa, JavaScript propio comprimido | <= 250 KB por ruta inicial |
| GET común, servicio/base calientes | p95 <= 400 ms |
| Cálculo DNC de una persona | p95 <= 1 s |
| Refresco Excel de 12,000 filas | <= 30 s desde dos equipos/redes corporativos, con proxy/VPN y respuesta medida, en frío y caliente |
| Ensayo de lote de 50,000 filas | <= 2 min sin bloquear la UI |
| Reintento del mismo comando/lote | mismo efecto, 0 duplicados |
| Prueba de carga | 50 usuarios concurrentes y 10x el volumen actual sin error P0/P1 |

Arranque en frío de aplicación y base se mide por separado y se muestra a
Directiva. Si el requisito es respuesta inmediata durante toda la jornada,
habrá que mantener capacidad caliente y aceptar costo; no se manipula el p95
excluyendo ese dato.

---

## 8. Seguridad, privacidad y operación

Roles mínimos:

| Rol | Alcance |
|---|---|
| `CAPACITADOR` | Sus sesiones y seguimiento permitido |
| `CAPACITACION` | Operación, evidencia, DNC y DC-3 |
| `DATA_STEWARD` | Lotes, mapeos, calidad y conflictos; no libera solo |
| `APROBADOR` | Cambios masivos, excepciones y emisiones según segregación |
| `REVISOR_EVIDENCIA` | Originales/recortes de casos asignados; acceso temporal y auditado |
| `ADMINISTRADOR` | Configuración, grupos, despliegue y recuperación |
| `AUDITOR` | Metadata, hashes, eventos, versiones y constancias; evidencia visual sólo por autorización de caso |

Controles no negociables:

- Supabase Auth por invitación; contraseña robusta, recuperación con OTP
  numérico y TOTP obligatorio para
  `ADMINISTRADOR`, `APROBADOR`, `DATA_STEWARD` y `REVISOR_EVIDENCIA`;
- Node y RLS/RPC exigen claim `aal2` para acciones sensibles; una sesión `aal1`
  se deniega y pérdida/desenrolamiento del factor tiene recuperación auditada;
- alta/baja administrada, recuperación ensayada y SMTP productivo aprobado;
- RLS habilitado en toda tabla expuesta y en `storage.objects`; las vistas usan
  `security_invoker` o quedan en esquema no expuesto;
- clientes Supabase separados: `sb_publishable_*` + JWT personal para
  solicitudes web normales y `sb_secret_*` sólo en el proceso Node custodio;
  esta última opera como rol PostgreSQL `service_role`, omite RLS y su
  compromiso afecta todo el proyecto;
- rutas Excel autorizadas por asignación Basic en Node y por RPC de exportación
  que revalida principal, rol, alcance, vigencia, snapshot y recurso en la misma
  transacción; no se presentan como RLS de usuario;
- cookie `__Host-kcm_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
  rotación de refresh y revocación servidor; CORS sólo para el FQDN exacto;
- CSRF token y validación estricta de `Origin/Host` en mutaciones con cookie;
  rate limits en login, recuperación y credenciales Excel;
- `Cache-Control: private, no-store, max-age=0` y
  `Cloudflare-CDN-Cache-Control: no-store` en toda respuesta autenticada;
  reglas Bypass Cache para `/api/*`, `/auth/*` y `/files/*`, nunca `Cache Everything`;
- buckets privados; Node autoriza y transmite archivos al cliente por el FQDN;
- worker sin clave Supabase: token interno por `jobId`, de un uso y alcance
  mínimo; Node media RPC/Storage;
- autorización en servidor en cada mutación; un login no equivale a permiso;
- ambientes separados y datos sintéticos hasta aprobar PII;
- credenciales backend (`sb_secret_*`, DB, SMTP y token del túnel) en
  Keychain/almacén autorizado y fuera de Git; nunca se entregan a Excel,
  navegador o SharePoint;
- logs sin nombres, nóminas, CURP, OCR, tokens o cuerpos de archivos;
- `cloudflared` en nivel `info` o superior; `debug` queda prohibido con
  credenciales/datos y cualquier token de diagnóstico se rota al cerrar;
- HTTPS forzado, HSTS, WAF/límites en túnel y Node, y confianza de proxy sólo
  para el túnel configurado;
- cifrado en tránsito y reposo, retención por tipo, exportes con alcance;
- recuperación de proyecto nuevo ensayada: migraciones, roles, datos, Auth,
  RLS/RPC, buckets/políticas/objetos Storage y configuración externa;
- revisión periódica de accesos y baja de usuarios;
- una organización Supabase corporativa, dos administradores y recuperación;
- Node escucha en loopback; la pila Supabase CLI local nunca cruza el túnel;
- Cloudflare y Supabase incluidos en DPA/PII, región, subprocesadores y retención;
- cambios productivos sólo por CI/migración aprobada; si se exige auditar el
  control plane, se cotizan Platform Audit Logs o control equivalente;
- RPO/RTO, dueño de negocio, custodio de datos y soporte técnico nombrados.

La operación rutinaria puede quedar sin terminal. La administración técnica no:
alguien debe actualizar Node/dependencias, revisar Supabase/túnel, rotar secretos,
restaurar y atender incidentes. La suspensión o apagado de la Mac interrumpe F1;
producción requiere mover Node/worker a un host siempre activo.

---

## 9. Plan de ejecución y costo de ingeniería

Estimación ROM de baja confianza: el límite inferior representa un escenario
P50 con decisiones/datos oportunos y el superior un P80 con retrabajo razonable.
Supone dos desarrolladores, QA/DevOps parcial, Product Owner de Capacitación y
data steward disponibles. No es una cotización ni agrega otro ±50% al rango.

Secuencia de autorización:

```text
 G0 Directiva -> H0 -> G1 Supabase/Red -> F1 -> G2 Fundación
                                              |
                                              v
                                  decisión sobre F2–F5
```

### H0 — línea base y decisión, 3 a 5 días hábiles

- suite verde y CI sobre Node 24;
- clasificar los 200 cambios iniciales, crear commits revisables y tag legado;
- congelar Apps Script/VBA sin desplegarlos;
- inventario `reutilizar / portar / reemplazar / retirar`;
- contrato canónico e invariantes confirmados;
- ADR de Node 24 + Supabase Hosted, Auth, Storage, RPC/RLS y costos;
- inventario vinculante de Mac, energía/suspensión, red/proxy/VPN, dominio/túnel,
  Supabase, SMTP, Power Query, backup/restore y responsables;
- propietario organizacional y equipo nombrados.

**Salida:** repositorio reproducible y expediente G1 con proyecto Supabase,
región/DPA, FQDN/túnel, Mac, costo, SMTP, Storage, restore y responsables. Sólo
G1 autoriza F1.

### F1 — aprovisionamiento y vertical slice, 4 a 5 semanas; sólo después de G1

- Supabase Hosted Free corporativo con migraciones, RLS, Auth y buckets privados;
- Node 24 + worker/OCR en la Mac, `LaunchAgent` supervisado, Keychain, loopback
  y túnel nombrado;
- CI/CD, bootstrap de roles, secretos y clientes Supabase separados;
- login Supabase Auth con identidades/buzones sintéticos; `aal1/aal2`, pérdida
  de TOTP y roles permitidos/denegados;
- flujo sintético `upload -> staging -> diff -> aprobación -> commit`;
- Power Query Web + CSV con una credencial por combinación usuario nominal +
  perfil Windows + laptop, snapshot coherente y libro maestro en SharePoint;
- prueba en ambas laptops con proxy/VPN, Edge, Excel Desktop, bloqueo y allowlist;
- job recuperable con worker, reconciliador y exclusión SQL/RPC;
- restauración extremo a extremo en proyecto Supabase nuevo: schema/datos,
  Auth, RLS/RPC, buckets/objetos, configuración y rotación de claves;
- reinicio/suspensión de la Mac, reconexión del túnel y contingencia SharePoint;
- medición de arranque, refreshes/libro/día, DB, Storage, egress, OCR y costo.

**Salida:** Directiva ve la conexión Excel y una transacción completa antes de
autorizar datos reales o alcance mayor.

### F2 — maestros, DNC y Excel, 8 a 12 semanas

- modelo laboral/histórico y procedencia;
- ingesta XLSB/extracto, perfiles, vigencias y conflictos;
- reglas DNC versionadas y motor explicable;
- API/read models de Excel y exportes controlados;
- muestra aprobada y migración histórica conciliada.

### F3 — núcleo operativo y agenda, 10 a 14 semanas

- sesiones, quiosco/captura, exámenes, preliberación y release;
- lotes SQL atómicos, idempotencia, replay, no-overwrite y auditoría;
- reservación de salas;
- port OCR en paralelo, estimado dentro de una pista de 6 a 10 semanas;
- pruebas de seguridad, carga y fallos parciales.

### F4 — DC-3, 4 a 6 semanas

- metadatos legales aprobados;
- job/compositor único y ledger SQL;
- muestra privada, lotes recuperables, revocación/reemisión;
- almacenamiento, entrega y retención aprobados.

### F5 — UAT, relevo y corte, 4 a 6 semanas

- dos ciclos conciliados contra la operación Excel;
- DR/restore, carga, seguridad y runbooks;
- construir y probar para la arquitectura destino la imagen OCI Node/worker,
  desplegarla en un host siempre activo y conservar dominio y contratos;
- capacitación de titulares/suplentes;
- rollback técnico antes del corte; después, recuperación SQL y cola controlada
  de contingencia. El XLSB queda congelado y nunca se reactiva como escritor.

### Orden de magnitud

| Alcance | Esfuerzo ROM |
|---|---:|
| H0 | 1–2 persona-semanas |
| F1 aprovisionamiento/vertical | 8–12 persona-semanas |
| Datos + DNC + Excel | 15–22 persona-semanas |
| Núcleo operativo + agenda | 14–22 persona-semanas |
| OCR productivo | 6–10 persona-semanas |
| DC-3 | 4–7 persona-semanas |
| QA, migración, UAT y corte | 6–10 persona-semanas |
| **Total** | **54–85 persona-semanas** |

Con el equipo supuesto, el calendario completo es de **7 a 11 meses** gracias a
trabajo paralelo. Con un solo desarrollador es razonable esperar **14 a 21
meses**; QA, aprobador, steward, IT y segregación de funciones siguen siendo
obligatorios. Prometer la plataforma completa en días o pocas semanas no es
defendible.

---

## 10. Gates de no avance

| Gate | Evidencia requerida | Si falla |
|---|---|---|
| G0 — Decisión | Apps Script fuera, SQL autoridad, papel de Excel, equipo y costo H0 aprobados; H0 autorizado y F1 sólo reservado | Excel gobernado; no web productiva |
| G1 — Supabase/red/finanzas | Organización/proyecto, región/DPA, metadata técnica/IP de Supabase/Cloudflare, Mac, dominio/túnel, SMTP de prueba, Storage, backup, responsables y costos aprobados | No iniciar F1 externo |
| G2 — Fundación | Clon limpio despliega Node 24; migraciones, RLS/RPC, Auth con denegación `aal1` y exigencia `aal2`, buckets/objetos, worker, secretos y restore de proyecto nuevo funcionan extremo a extremo | Sin datos reales |
| G3 — Datos | `FULL/DELTA`, `sourceAsOf`, reglas, alias, excepciones y muestra aprobada; cero bajas silenciosas | No publicar KPI DNC |
| G4 — Windows/Excel | Matriz de red y FQDN funcionan; dos credenciales/alcances consultan la misma URL sin cruce, `CF-Cache-Status` es `BYPASS/DYNAMIC`, nunca `HIT`; ambas laptops pasan Edge, Excel, copia sin credencial, snapshots, suspensión/reinicio y allowlist | Purgar caché; snapshot SharePoint y carga manual; no conexión viva |
| G5 — Dominio | Cinco gates de elegibilidad, transacción, idempotencia, replay y auditoría | DNC sólo lectura |
| G6 — OCR | Privacidad, object keys, permisos por caso, 40x5x2, guardas de archivo, banco anonimizado, holdout independiente y decisión explícita de umbrales | 100% revisión humana; cero autoaceptación |
| G7 — DC-3 | Metadatos, firmantes, muestra, canal, retención y ledger | No emitir |
| G8 — Producción | Plan Supabase, SMTP, DPA/PII de Supabase/Cloudflare, backup DB+Storage, auditoría de control plane, host Node estable, carga, RPO/RTO, soporte, costos y UAT aprobados | No go-live; la Mac sigue sólo como piloto |
| G9 — Corte | XLSB conciliado/congelado, rollback técnico previo, recuperación SQL/cola posterior y cero P0/P1 | No cortar; jamás reactivar escritura libre al XLSB |

---

## 11. Indicadores de aceptación

- 100% de lotes con hash, fuente, corte, actor, diff y estado terminal.
- 0 filas descartadas, bajas o sobrescrituras silenciosas.
- 100% de liberaciones efectivas atómicas, idempotentes y auditadas.
- 0 fechas existentes reemplazadas por defecto.
- 100% de reglas DNC con versión, vigencia y aprobador.
- `DATOS_INSUFICIENTES` y conflictos separados de cumplimiento.
- 0 DC-3 duplicados y 100% ligados a metadata/plantilla versionadas.
- conexión Excel visible: al terminar un refresh exitoso,
  `now - lastSuccessfulRefreshAt <= 2 min`; si el intervalo se aprueba, el
  objetivo pasa a <=30 min con libro abierto, red y credencial funcional.
  `sourceAsOf` se mide aparte contra el SLA de cada fuente y genera
  `FUENTE_VENCIDA`.
- 100% de reintentos con el mismo efecto; conflictos obsoletos devuelven diff.
- suite verde, CI reproducible y cero P0/P1 antes de deployment.
- DB, Storage, egress, Auth, OCR, túnel, disponibilidad de la Mac y costo visibles;
  alertas y capacidad por ciclo medidas.
- 100% de accesos cliente usan un solo FQDN HTTPS; cero llamadas directas desde
  Windows a Supabase y cero secretos en Excel/SharePoint.
- ambas laptops pasan login, refresh, carga, reconexión y contingencia con sus
  perfiles corporativos reales.
- restore ejecutado dentro del RPO/RTO aprobado antes de producción.
- dos operadores y un suplente completan tareas críticas sin el desarrollador.

---

## 12. Resoluciones solicitadas a Directiva

1. Ratificar que Apps Script/Sheets/Drive y el puente Apps Script/VBA quedan
   excluidos del stack y se conservan sólo como legado temporal.
2. Aprobar H0 y reservar 8–12 persona-semanas para F1; F1 no inicia hasta que G1
   cierre costos, capacidad y operación de la infraestructura objetivo.
3. Ratificar **Node 24 + Supabase Hosted** como stack núcleo: PostgreSQL, Auth y
   Storage en Supabase; SSR/API/jobs/OCR en Node externo. La Mac aloja F1, no la
   producción permanente.
4. Aprobar un FQDN HTTPS/túnel para F1, probarlo en las dos laptops y aceptar que
   un bloqueo corporativo sólo se resuelve por allowlist o contingencia manual.
5. Aceptar Supabase Free únicamente para sintéticos; antes de PII, cotizar y
   aprobar plan, región/DPA, SMTP, host Node, backup DB+Storage y RPO/RTO.
6. Declarar SQL como autoridad después del corte y XLSB como histórico de sólo
   lectura.
7. Aceptar la definición de conexión viva: lectura Power Query actualizable;
   escrituras por staging/diff/aprobación, no edición directa de SQL.
8. Asignar dos desarrolladores, QA/DevOps parcial, dueño de proceso, data
   steward, aprobador, custodio técnico y suplentes, o aceptar el calendario de
   un solo desarrollador sin eliminar los demás roles.
9. Mantener los gates independientes de OCR y aprobar metadatos/firmantes DC-3
   antes de cualquier emisión.

Si no se aprueban 2, 3, 4, 5, 6 y 8, la alternativa responsable es Excel gobernado
con importaciones/exportaciones controladas. No se debe convertir una laptop ni
un free tier personal en infraestructura corporativa por omisión.

---

## 13. Fuentes y límites

Fuentes internas principales:

- `docs/arquitectura/MODELO_DATOS.md`;
- `packages/contracts/`, `packages/core/`, `packages/dc3/` y `clients/excel/vba/`;
- arquitectura, seguridad, operación, HC, VBA, DC-3 y pruebas;
- referencias privadas consultadas sólo en lectura y sin reproducir PII.

Fuentes oficiales vigentes al 2026-08-02:

- [Node 24 está en LTS y tiene soporte hasta abril de 2028](https://nodejs.org/en/blog/migrations/v22-to-v24);
- [Supabase local es sólo desarrollo y nunca debe exponerse públicamente](https://supabase.com/docs/guides/local-development/cli-workflows);
- [Supabase ofrece PostgreSQL completo y métodos de conexión/pooling](https://supabase.com/docs/guides/database/connecting-to-postgres);
- [RLS es obligatorio en tablas expuestas y el rol `service_role` puede omitirlo](https://supabase.com/docs/guides/database/postgres/row-level-security);
- [Supabase recomienda `sb_publishable_*`/`sb_secret_*`; la llave secreta es sólo backend, usa `service_role` y omite RLS](https://supabase.com/docs/guides/getting-started/api-keys);
- [Supabase Auth admite contraseña y MFA TOTP](https://supabase.com/docs/guides/auth/auth-mfa);
- [SMTP personalizado es requisito operativo para correo productivo](https://supabase.com/docs/guides/auth/auth-smtp);
- [Storage privado aplica acceso y RLS a cada descarga](https://supabase.com/docs/guides/storage/buckets/fundamentals);
- [backups PostgreSQL no incluyen objetos Storage y Free requiere dumps externos](https://supabase.com/docs/guides/platform/backups);
- [proyectos Free pueden pausarse por baja actividad](https://supabase.com/docs/guides/platform/free-project-pausing);
- [una base Free entra en sólo lectura al superar 500 MB](https://supabase.com/docs/guides/platform/database-size);
- [precios y cuotas publicadas de Supabase](https://supabase.com/pricing);
- [cómputo y disco por plan](https://supabase.com/docs/guides/platform/compute-and-disk);
- [límites de archivo de Supabase Storage](https://supabase.com/docs/guides/storage/uploads/file-limits);
- [Supabase Edge Functions no son el proceso Node 24 del producto](https://supabase.com/docs/guides/functions);
- [Cloudflare Tunnel publica un servicio local mediante conexión saliente](https://developers.cloudflare.com/tunnel/);
- [Cloudflare Tunnel requiere egress 7844](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/);
- [Cloudflare define comportamiento de caché por extensión y cabeceras](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/);
- [el nivel de log de `cloudflared` debe evitar exponer headers](https://developers.cloudflare.com/tunnel/advanced/run-parameters/);
- [Power Query Web: métodos admitidos y POST sólo anónimo](https://learn.microsoft.com/en-us/power-query/connectors/web/web);
- [Excel puede refrescar al abrir o cada intervalo configurado](https://support.microsoft.com/en-us/excel/refresh-an-external-data-connection-in-excel);
- [Power Query puede leer una carpeta SharePoint, pero eso es otra conexión](https://learn.microsoft.com/en-us/power-query/connectors/sharepoint-folder).

No se ejecutó todavía una prueba con Supabase, Auth/RLS/Storage, túnel, SMTP,
restore, SharePoint o Power Query en las dos laptops. Esta versión define el
stack y sus gates; no declara la plataforma implementada ni autoriza procesar
datos personales.

## Historia de la decisión

- **v1:** conservar Apps Script/Sheets y no migrar a SQL.
- **v2:** proponer D1 para reconciliación y DNC.
- **v3:** agregar viaje redondo con Excel, Power Query y Office.js.
- **v4:** rechazar una segunda verdad y recomendar estabilizar antes de SQL.
- **v5:** Directiva confirma que Apps Script aún no se usa y lo excluye. La
  plataforma nace en Node real + Azure SQL; Excel conserva lectura refrescable y
  carga gobernada. Se busca costo cercano a cero con franquicias Azure, sin
  prometer disponibilidad, almacenamiento, soporte ni TCO gratuitos.
- **v6:** Azure deja de ser prerrequisito porque no hay suscripción/licencias
  confirmadas y el free tier no sustenta continuidad. Se adopta Node 24 +
  PostgreSQL portable, host corporativo condicionado y Excel sobre la misma API;
  el objetivo es cero licencia incremental, no TCO cero.
- **v7:** Directiva fija Node 24 + Supabase Hosted y descarta Windows/AD. La Mac
  aloja desarrollo/F1 sintética, las dos laptops entran por un único FQDN HTTPS
  y producción mueve Node/worker a un host siempre activo. Supabase Free no
  autoriza PII ni continuidad productiva.
