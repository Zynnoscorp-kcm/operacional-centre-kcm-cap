# Despliegue en Vercel

Cómo se publica la plataforma, con qué medidas se decidió y qué hay que probar
antes de entregarla. El manual para el departamento es
[`PROTOCOLO_NUBE_Y_EQUIPO.md`](PROTOCOLO_NUBE_Y_EQUIPO.md).

---

## 1. La decisión y las medidas que la sostienen

Hasta el 2026-09-21 se suponía que el barrido diario de la matriz y el padrón
semanal no cabían en Vercel. Se midió el 2026-09-24 con los archivos reales y
contra la base de Supabase:

| Medida | Valor | Techo en Vercel |
|---|---|---|
| Barrido completo (1 684 trabajadores, 27 cursos), ya codificado | ~2.0 MB | 4.5 MB por petición |
| Padrón semanal (`sem 29 CAP.xlsx`) | 0.5 MB (0.7 MB codificado) | 4.5 MB por petición |
| Leer el barrido y compararlo con la base | 0.7–1.5 s | 300 s (Hobby) / 800 s (Pro) |
| Aplicar un barrido completo | 3.8 s | ídem |
| Memoria del proceso durante el barrido | ~190 MB | 2 GB |
| Arranque en frío de la plataforma | ~1.1 s | — |

**La hipótesis era falsa:** las dos cargas caben con holgura. El techo de
4.5 MB sólo se alcanzaría si la matriz duplicara su tamaño, y para ese día
Excel manda el envío en partes (`UPLOAD_PART_V1`) y la plataforma las junta; no
hay nada que encender en ninguna computadora.

Lo que sí impedía publicar en Vercel era el **estado en memoria**. Vercel
reparte las peticiones entre varias instancias, y tres cosas vivían en un solo
proceso. Las tres se corrigieron:

| Qué | Qué pasaba con varias instancias | Corrección |
|---|---|---|
| Llave de las cookies de la consola | Cada instancia sorteaba la suya: la sesión se perdía al cambiar de instancia | `KCM_SESSION_SECRET`, obligatoria en la nube |
| Revisión del barrido y plan del padrón | El «Aplicar» caía en una instancia que no los tenía | `sistema.revision_pendiente` (migración `0044`), con retiro atómico |
| Asientos de la bitácora de cargas | Se escribían después de responder y podían congelarse con la instancia | Ahora se esperan antes de responder |

Y una brecha que sólo existe al publicar: `/agenda` es pública, y en producción
sin clave cualquiera podía reservar o cancelar. En la nube
`KCM_ROOM_PASSWORD` es obligatoria.

### Por qué Vercel y no otro alojamiento

- **Render** y servicios parecidos con plan gratuito **duermen** el proceso y
  tardan de 30 a 60 s en despertar. En Vercel la plataforma arranca en ~1 s, y
  el quiosco la mantiene despierta con su latido a `/healthz`.
- **Cloudflare Containers** también cabría (100 MB por petición), pero exige
  Workers Paid y otro empaquetado. **Cloudflare Workers** no sirve sin
  reescribir la plataforma.
- **Alternativa sin cómputo por petición:** una máquina virtual siempre
  encendida con la imagen Docker que ya existe (`infra/docker/Dockerfile`),
  por ejemplo el nivel gratuito de Oracle Cloud. No tiene arranque en frío ni
  techo de 4.5 MB, pero alguien tiene que mantener el servidor y su TLS. Queda
  como plan B.

### Costo: el plan Hobby no sirve para esto

Las condiciones de Vercel limitan el plan Hobby a **uso personal no
comercial**, y un sistema de una empresa hecho por personal pagado es uso
comercial. La publicación real va en un plan **Pro** (20 USD al mes por
integrante) y en una cuenta del departamento o de la empresa, no en una cuenta
personal. Supabase sigue en su plan actual.

---

## Estado al 2026-09-24: publicación preliminar de pruebas

Publicada en **https://kcm-cap.vercel.app**, proyecto `kcm-cap` del equipo
«KCM Sistema de Capacitacion», plan Hobby (sólo para pruebas), región `pdx1`,
contra la base piloto. Se publica desde la CLI con un token del equipo y un
`HOME` aislado; no hay integración con Git.

Comprobado sobre la dirección publicada: `/healthz` en ~0.3 s; 44 de 49 rutas
de lectura con sesión (las otras cinco piden parámetros o secreto propio, y
`/apagar` no existe en la nube); cookie `Secure`, `HttpOnly`, `SameSite=Lax`;
padrón real subido, visible en cuatro recargas y descartado sin aplicar;
envío de 4.3 MB al puente rechazado con `CARGA_EXCEDE_NUBE`; reserva sin
clave rechazada; quiosco validando el PIN contra `seguridad.secreto`.

Dos defectos que sólo aparecieron al publicar, ya corregidos: Vercel no define
`PORT`, y una función de `api/` no captura un `listen()`: hay que exportar el
manejador.

Un tercero, corregido el 2026-09-25: sin carpeta de salida, Vercel servía como
archivo suelto todo lo que se subía, y cualquiera sin sesión descargaba el
código de la plataforma en los tres dominios (`/plataforma/src/main.ts` y el
resto). No había contraseñas ni datos personales en esos archivos, pero era el
sistema completo. Ahora la salida es `public/`, que sólo trae `robots.txt`, y
todo lo demás pasa por la plataforma, que exige sesión. Las publicaciones
anteriores seguían sirviendo el código en su dirección propia: el proyecto pasó
a protección estándar, que pide cuenta de Vercel en esas direcciones y deja
públicos `kcm-cap`, `kcm-quiosco` y `kcm-agenda`.

## 2. Qué hay en el repositorio para publicar

| Archivo | Para qué |
|---|---|
| `api/index.js` | Punto de entrada de la nube. Exporta el manejador que Vercel invoca en cada petición (construye la plataforma con `construir()` de `main.ts`, sin escuchar en ningún puerto). Impone `KCM_ROLE=nube` y fija `KCM_ENV=production`, `KCM_TRUST_PROXY=1` y `KCM_DB_POOL_MAX=3` |
| `vercel.json` | Región `pdx1` (Oregón, junto a Supabase `us-west-2`), duración máxima 120 s, los archivos que viajan con la función y la salida `public/` |
| `public/robots.txt` | Lo único que Vercel sirve como archivo. Sin esta salida, Vercel sirve la raíz entera y el código queda descargable sin sesión |
| `.vercelignore` | Lo que no sube: datos personales, credenciales locales y lo que sólo sirve en esta máquina. Una prueba falla si falta lo privado o si `public/` trae algo más |
| `database/migrations/0044_…` | La tabla de revisiones compartidas |

Se comprobó en local, sin publicar nada, que `vercel build` empaqueta la
función, y que esa función, armada sólo con los archivos que Vercel subiría,
arranca en producción contra Supabase. También se comprobó que dos instancias
con la misma llave aceptan la misma sesión.

---

## 3. Pasos para publicar

1. **Cuenta.** Crear o elegir la cuenta de Vercel del departamento, en plan Pro.
2. **Código.** Vercel publica desde Git: subir la rama `despliegue-nube-local`
   al remoto de la organización. Es decisión del departamento.
3. **Proyecto.** Importar el repositorio. Sin *framework* y sin comando de
   construcción: `vercel.json` ya declara todo, incluida la salida `public/`.
   Activar la protección estándar (*Settings → Deployment Protection*), que
   pide cuenta de Vercel en la dirección propia de cada publicación y deja
   públicos los dominios de producción.
4. **Variables de entorno** (Settings → Environment Variables, entorno
   *Production*):

   | Variable | Valor |
   |---|---|
   | `KCM_DATABASE_URL` | La cadena del rol `kcm_app` por el *session pooler* de Supabase (puerto 5432), la misma que usa el equipo local |
   | `KCM_KIOSK_TOKEN_SECRET` | Igual que en el equipo local |
   | `KCM_RELEASE_INTEGRITY_SECRET` | Igual que en el equipo local: firma los lotes de liberación |
   | `KCM_SESSION_SECRET` | Nueva, 32 bytes al azar (ver `.env.example`) |
   | `KCM_ROOM_PASSWORD` | La clave de la agenda que usará el departamento |
   | `NODEJS_HELPERS` | `0`: evita que Vercel lea el cuerpo de la petición antes que Fastify |

   No se declara ninguna `KCM_PILOT_*`: con `KCM_ENV=production` el arranque
   las rechaza. Los PIN del quiosco ya viven en `seguridad.secreto`.
5. **Base.** Aplicar la migración `0044` (`npm run db:migrar`), con
   confirmación del departamento como toda migración.
6. **Dominio.** Asignar el dominio del departamento o usar el `*.vercel.app`
   durante las pruebas.
7. **Excel.** En cada libro puente, `KCM_CONFIG.ENDPOINT` apunta a
   `https://<dominio>/api/v1/vba-bridge`; es la única dirección. Actualizar
   los módulos (macro `KcmActualizarModulos`): `KcmBridgeHttp.bas` manda en
   partes lo que pase de 3 MB.
8. **Quioscos y agenda.** Cada quiosco abre `https://<dominio>/quiosco` en
   pantalla completa; la agenda pública es `https://<dominio>/agenda`.

---

## 4. Pruebas finales

Hacerlas en este orden, sobre la dirección publicada. Si una falla, se detiene
ahí.

**Arranque**
- [ ] `https://<dominio>/healthz` responde `"status":"ok"` y `"environment":"production"`.
- [ ] En los registros de Vercel no aparece «Falta el secreto».
- [ ] `https://<dominio>/plataforma/src/main.ts` no descarga nada: sin sesión
      lleva a `/acceso`.

**Consola**
- [ ] Entrar por `/acceso` con una cuenta nominal.
- [ ] Recorrer Inicio, Trabajadores, DC-3, Salas, Sesiones y Auditoría
      recargando varias veces: la sesión no se pierde.
- [ ] La etiqueta de arriba dice **En la nube** y no hay botón de apagar.

**Quiosco** (en el equipo de la sala)
- [ ] Abrir `/quiosco`, desbloquear con el PIN y registrar a un trabajador de
      prueba en una sesión abierta.
- [ ] La asistencia aparece en la sesión desde otra computadora.

**Agenda**
- [ ] `/agenda` se ve sin cuenta y no enseña quién reservó.
- [ ] Reservar sin clave se rechaza; con `KCM_ROOM_PASSWORD` se acepta.
- [ ] Una reserva que se traslapa se rechaza.

**Excel**
- [ ] **Estado del puente** responde desde el libro.
- [ ] Una liberación pequeña llega al libro y su acuse vuelve a la plataforma.
- [ ] **Barrer matriz** con el libro real: la revisión aparece en `/matriz`.
- [ ] Pulsar **Aplicar** desde **otra computadora**: se aplica una sola vez.
      Esto prueba la revisión compartida entre instancias.

**Padrón**
- [ ] Subir `sem NN CAP.xlsx` en `/padron`, revisar y aplicar desde otra
      pestaña.

**DC-3**
- [ ] Emitir una constancia y un lote de 400 en PDF; los dos aparecen en la
      bitácora.

**Envío en partes**
- [ ] Tras un barrido o una actualización completa, el aviso final de Excel dice
      «envío normal» (con los archivos de hoy no hace falta partir). El envío
      en partes lo cubren las pruebas automáticas; si alguna vez se activa, el
      aviso dice «envío en N partes» y el resultado es el mismo.

---

## 5. Antes de operar con datos reales

- Cerrar la corrida piloto según [`database/RESET.md`](../../database/RESET.md):
  la base de hoy es de prueba.
- Rotar las contraseñas de las cuentas de consola y los PIN, que hoy son
  ceros, y reemitir las credenciales de equipo del puente.
- Borrar los datos de prueba del `.env` de cada equipo.

## 6. Cómo volver atrás

Vercel conserva cada publicación: *Promote* sobre la anterior la restituye al
instante. La migración `0044` sólo agrega una tabla; dejarla no afecta a una
versión anterior del código.

Las publicaciones anteriores al 25 de septiembre no tienen la salida `public/`:
promover una de ellas vuelve a dejar el código descargable en los dominios de
producción. Para volver atrás desde entonces, se promueve una publicación
posterior o se vuelve a publicar el código anterior.
