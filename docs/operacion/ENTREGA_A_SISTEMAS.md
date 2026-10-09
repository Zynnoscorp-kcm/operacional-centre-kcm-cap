# Entrega del proyecto al equipo de Sistemas

Este documento lista todo lo que el equipo de Sistemas necesita recibir para
operar y mantener la plataforma KCM Cap. **No contiene ningún secreto**: dice
qué existe, dónde vive y cómo se transfiere. Los valores viajan por un canal
seguro, nunca por Git.

## 1. Código (GitHub)

- Repositorio: `Zynnoscorp-kcm/operacional-centre-kcm-cap`, rama `main`.
- **Hoy es público.** Antes de cualquier otra cosa: Settings → General →
  Danger Zone → *Change visibility* → **Private**, y después *Transfer
  ownership* a la organización de Sistemas, o bien agregar a su equipo como
  administradores (Settings → Collaborators and teams).
- No se versionan, a propósito (ver `.gitignore`): `.env`, `referencias/`
  (padrón con CURP, matriz real, respaldos de la base) y `referencias 2/`.
  Se entregan aparte (sección 5).
- Punto de entrada para leer el proyecto: `README.md`, `docs/README.md`,
  `docs/ARQUITECTURA.md`, `docs/MODELO_DATOS.md`, `docs/OPERACION.md` y
  `docs/ESTADO_PROYECTO.md`. Las decisiones y su porqué están en `docs/actas/`.

## 2. Publicación (Vercel)

- Equipo «KCM Sistema de Capacitacion» (`team_8tbPuQ8q7mBIYhYrnUESPjfw`),
  proyecto `kcm-cap` (`prj_yhVHiWB5CKxPooehVTKhDJg4Wwa5`).
- Dominios: `kcm-cap.vercel.app` (consola), `kcm-quiosco.vercel.app`,
  `kcm-agenda.vercel.app`.
- Transferir: Team Settings → Members → invitar a Sistemas como **Owner**.
  El plan actual es Hobby; para uso comercial hace falta Pro en una cuenta de
  la empresa (Settings → Billing), o transferir el proyecto a un equipo Pro
  de la empresa (Project Settings → Advanced → Transfer).
- El proyecto **no** está enlazado a GitHub: un `push` no publica. Se publica
  con la CLI desde un clon limpio; el procedimiento está en
  `docs/operacion/DESPLIEGUE_VERCEL.md`. Enlazarlo a GitHub (Project Settings
  → Git) es una mejora recomendable.
- Las variables de producción viven en Project Settings → Environment
  Variables: `KCM_DATABASE_URL`, `KCM_KIOSK_TOKEN_SECRET`,
  `KCM_RELEASE_INTEGRITY_SECRET`, `KCM_SESSION_SECRET`, `KCM_ROOM_PASSWORD`,
  `KCM_IA_OPENROUTER_LLAVE`, `KCM_DOMINIO_QUIOSCO`, `KCM_DOMINIO_AGENDA`,
  `NODEJS_HELPERS`. Están marcadas como *sensitive*: Vercel no deja volver a
  leer su valor, ni a un Owner; sólo reemplazarlo. Las tres primeras y la de
  OpenRouter también están en el `.env` local; `KCM_SESSION_SECRET` y `KCM_ROOM_PASSWORD` no están en
  ningún archivo, así que Sistemas las genera nuevas (sección 6).
- El token personal de la CLI (`~/.kcm-vercel-token` en la Mac del
  desarrollador) **no** se entrega: Sistemas genera el suyo en
  Account Settings → Tokens.

## 3. Base de datos (Supabase)

- Proyecto de Supabase con los esquemas `organizacion`, `catalogo`,
  `operacion`, `matriz`, `dnc`, `dc3`, `seguridad`, `sistema`, `comun` y
  `lectura`. Las migraciones están en `database/migrations/` en orden.
- Transferir: Organization Settings → Team → invitar a Sistemas como
  **Owner**, o *Transfer project* a la organización de Sistemas.
- La plataforma conecta con el rol `kcm_app` (sin BYPASSRLS) mediante
  `KCM_DATABASE_URL`. Para tareas de administración (`scripts/` y
  `database/RESET.md`) se usa una cadena de un rol administrador
  (`KCM_ADMIN_DATABASE_URL`), que Sistemas obtiene del panel de Supabase.
- Dejar la plataforma en blanco para pruebas sin perder configuración:
  `database/limpieza-demostracion.sql` (instrucciones en `database/RESET.md`).

## 4. Otros servicios

- **OpenRouter** (agente de ocupaciones, opcional): la llave
  `KCM_IA_OPENROUTER_LLAVE`. Lo recomendable es que Sistemas cree su propia
  cuenta y llave y la sustituya en Vercel; sin llave el agente sólo se apaga.
- **Excel / VBA**: módulos en `clients/excel/vba/`. Cada equipo con Excel
  necesita una credencial del puente emitida por la plataforma; en macOS se
  guarda en el llavero (servicio `KCM_VBA_BRIDGE_TOKEN`), en Windows en la
  variable de usuario del mismo nombre.

## 5. Secretos y datos fuera de Git

Se entregan **en persona o por un gestor de contraseñas de la empresa**
(1Password, Bitwarden, Keeper o el que use Sistemas), nunca por correo, chat
ni Git:

- El archivo `.env` local completo (nombres documentados en `.env.example`).
- Las contraseñas de las cuentas de consola y los PIN de quiosco y apertura.
- La carpeta `referencias/privado/` (padrón, matriz real, respaldos de la
  base): contiene datos personales, así que se entrega cifrada y sólo a quien
  la necesite.

## 6. Después de entregar

Quien deja el proyecto conoció todos los secretos, así que Sistemas debe
rotarlos una vez que tenga el control:

1. Contraseña del rol `kcm_app` en Supabase y `KCM_DATABASE_URL` en Vercel.
2. `KCM_SESSION_SECRET`, `KCM_KIOSK_TOKEN_SECRET`,
   `KCM_RELEASE_INTEGRITY_SECRET` y `KCM_ROOM_PASSWORD` en Vercel (cambiar
   `KCM_SESSION_SECRET` cierra todas las sesiones de consola abiertas).
3. Llave de OpenRouter.
4. Contraseñas de consola y PIN.
5. Revocar el token de Vercel del desarrollador y retirarle el acceso a
   GitHub, Vercel y Supabase.
6. Volver a publicar y comprobar `/healthz` en los tres dominios.
