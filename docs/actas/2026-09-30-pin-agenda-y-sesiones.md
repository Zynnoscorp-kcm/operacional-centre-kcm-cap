# Acta · PIN 2026, agenda sin nómina y sesiones con hora de fin · 2026-09-30

- PIN `2026` para `REGISTRO_QUIOSCO` y `APERTURA_SESION` (scrypt, filas nuevas en `seguridad.secreto`; las anteriores revocadas con motivo) y `KCM_ROOM_PASSWORD=2026` en Vercel (Production). Las cuentas de consola no se tocaron.
- Agenda (`/agenda`) y salas de la consola sin campo de nómina; `identificarSolicitante` usa el nombre cuando no hay nómina ni contacto.
- `/sesiones`: «Hora de fin» junto a «Hora de inicio»; la duración sale de la diferencia y la reservación de sala va de inicio a fin. Tabla con «Horario» y «Creada por» (la cuenta de consola de la cookie; antes se asentaba `USUARIO_CAPACITACION`).
- DC-3 · Datos del formato: se retiró el recuadro «Datos del trabajador que salen en blanco».
- Orden «Para repartir» renombrado «Confianza y sindicalizados».
- Evidencia: typecheck limpio; pruebas de plataforma por archivo (ver commit).
