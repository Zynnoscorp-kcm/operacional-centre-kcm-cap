# Acta · La nube hace todo; el equipo del departamento queda de respaldo

**24 de septiembre de 2026.** Rama `despliegue-nube-local`.

Revisa la decisión del [acta del 21 de septiembre](2026-09-21-despliegue-partido.md),
que partía el trabajo entre la nube y la computadora del departamento porque el
barrido completo y el padrón «no cabían» en los 4.5 MB de Vercel. Esa premisa
no se había medido.

## 1. Lo medido

Con la matriz real (1 684 trabajadores, 27 cursos) el barrido completo viaja en
~2.0 MB ya codificado; el padrón `sem 29 CAP.xlsx`, en ~0.7 MB. Los 3.2 MB que
se citaban eran el tamaño del archivo `.xlsb`, no del envío, y los 24 MiB eran
el tope declarado del puente, no un volumen. Contra Supabase, leer y comparar
el barrido tarda 0.7–1.5 s y aplicarlo 3.8 s; la plataforma arranca en ~1.1 s.
El detalle está en [`DESPLIEGUE_VERCEL.md`](../operacion/DESPLIEGUE_VERCEL.md).

## 2. Lo decidido

- **La nube acepta las cargas del ciclo.** El puente y `/padron` ya no rechazan
  por nombre de acción sino por tamaño: arriba de 4 MB contestan con una
  explicación y mandan al respaldo (`ENDPOINT_LOCAL`), que sigue funcionando
  igual que antes.
- **El estado por proceso se retiró de lo que la nube necesita.** Llave de
  sesión declarada (`KCM_SESSION_SECRET`), revisión del barrido y plan del
  padrón en `sistema.revision_pendiente` (migración `0044`) y asientos de la
  bitácora de cargas esperados antes de responder.
- **La agenda pública exige clave en la nube** (`KCM_ROOM_PASSWORD`). Sin ella,
  publicada, cualquiera podía reservar o cancelar.
- **Región `pdx1`**, junto a Supabase en `us-west-2`.

## 3. Lo que queda abierto

- El plan Hobby de Vercel prohíbe el uso comercial: la publicación real exige
  Pro en una cuenta del departamento.
- La migración `0044` está escrita y sin aplicar.
- Ningún `push`.
- En la cuenta personal de Vercel quedó un proyecto vacío, `vbuild`, creado por
  accidente al probar el empaquetado en local. No tiene publicaciones y debe
  borrarse.
