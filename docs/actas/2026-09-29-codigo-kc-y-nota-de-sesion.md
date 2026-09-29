# Acta · Código de sesión `KC-0001` y la nota de cada fecha

**29 de septiembre de 2026.** Rama `main`.

## El código de sesión

Pedido del departamento: las sesiones dejan de llamarse `KCM-AAMMDD-XXXXXX` y
pasan a `KC-` con cuatro cifras, como `KC-0001`. Es un consecutivo: cada sesión
nueva lleva el siguiente al mayor en uso.

- La base no fija el formato, sólo que el código sea único, así que no hizo
  falta migración.
- Dos sesiones creadas a la vez pueden pedir el mismo número. La unicidad lo
  impide, y la segunda pide el siguiente, hasta cinco veces. No se usa un
  candado: el del repositorio del quiosco en Postgres no toma uno real, porque
  sus consultas salen por conexiones sueltas del pool.
- Después de `KC-9999` no hay código: crear una sesión responde 409 con el
  motivo.
- Se busca con o sin ceros: «kc-7», «KC7» y «KC-0007» encuentran la misma
  sesión, en el quiosco y en la liberación. El formato anterior se sigue
  reconociendo.
- La base de Supabase tenía 0 sesiones al hacer el cambio: la primera será
  `KC-0001`.

## La nota de cada fecha

La macro escribía en la nota de cada fecha una clave técnica
(`KCM_VBA_V1|idempotencyKey|mappingVersion|completionDate`). Ahora escribe el
código de la sesión de donde viene la fecha.

- La macro consulta los códigos en `RELEASE_SESSIONS_V1`, la misma consulta del
  subpanel de entradas, antes de abrir la matriz. Si esa consulta falla, no se
  escribe nada.
- `RELEASE_PULL_V1` no cambia: su lector exige columnas exactas, y agregarle
  una rompería a los libros que sigan con los módulos anteriores.
- El apunte que ya tuviera la celda se conserva. Al liberar de nuevo, la línea
  anterior de la plataforma se reemplaza, sea un código o la clave técnica de
  las notas viejas.
- Si una sesión no trae código, su celda recibe la clave técnica de antes.
- La carpeta `KCM-VBA-CRLF` se regeneró, con respaldo en `.bak-2026-09-29`.
  Además de `KcmReleaseSync`, ahora trae el `KcmPanel` del 28, que faltaba, y ya
  no trae `KcmOcupaciones`, retirado ese mismo día.

## Verificación

- `npm run test:plataforma`: 775 de 775. `npm test`: 118 de 118. El analizador
  de VBA no tiene hallazgos, `tsc` no da errores, Prettier está limpio y ESLint
  no suma errores nuevos.
- Consulta de sólo lectura en Supabase:
  - la restricción se llama `sesion_codigo_sesion_key`, que es la que el
    adaptador reconoce;
  - el patrón del consecutivo da 12 con `KC-0007`, `KC-0012` y un código
    anterior.
- Sin probar: la macro en un Excel real, porque aquí no hay Excel, y la
  plataforma publicada.

## Pendiente

- Importar los módulos con `KcmActualizarModulos` y hacer una liberación de
  prueba.
- Publicar la plataforma: el código `KC-` existe desde que se publique.
