# Acta · DC-3: emitir o imprimir con relación · 2026-09-29

- Relación de constancias (`plataforma/src/web/pdf/relacion-dc3.ts`) sin la columna «Recibí: nombre y firma»; el ancho pasa a nombre y área.
- La casilla «Hoja de entrega» se sustituye por dos botones: «Emitir» (sólo constancias) e «Imprimir con relación» (`entrega=1`, relación delante). En bandeja, confirmación de lista, expediente e historial.
- Palomita verde (`marcaDeEmitida`) junto al nombre de quien ya tiene constancia emitida: bandeja, búsqueda, expediente (cabecera y tarjeta de curso) e historial.
- «Para repartir» es el orden de la bandeja por tipo de personal (NQ, NS, resto) y nómina ascendente, pensado para entregar por grupos.
- Evidencia: `npm run typecheck` limpio; `npm run test:plataforma` 775/775.
