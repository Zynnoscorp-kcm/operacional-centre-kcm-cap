# Módulos compartidos

Lo que la plataforma (`app/`) importa y que no vive dentro de ella. La lista es
exactamente la que `infra/docker/Dockerfile` copia archivo por archivo, con
la excepción de `core/`, que sólo consumen las pruebas.

| Módulo | Qué resuelve | Quién lo importa |
|---|---|---|
| `dnc/` | El motor de Detección de Necesidades de Capacitación: catálogo unificado, alias, reglas en dos niveles y el evaluador de los seis estados. | `plataforma/src/domain/sistema-trabajador/` |
| `dc3/` | Constancias DC-3: planificador, extractor del padrón semanal, compositor PDF sin dependencias y ledger idempotente. | `plataforma/src/domain/dc3/` |
| `contracts/` | Los contratos versión `1.0.0` y la máquina de estados. | dominio y pruebas |
| `xlsb/` | Lector ZIP/BIFF12 de la matriz maestra, sin Excel y sin VBA. | `plataforma/src/adapters/extractor-xlsb.ts` |
| `core/` | Implementación de referencia de elegibilidad y liberación. No entra en la imagen. | pruebas de caracterización |

---

## Por qué están fuera de `app/`

Tres razones, en orden de peso:

1. **Los usa más de un consumidor.** El generador DC-3 corre como job de la
   plataforma *y* como guion de línea de comandos (`npm run dc3:generate`). El
   extractor XLSB lo usan el adaptador de la plataforma, `npm run extract:hc` y
   la prueba de paridad del cliente VBA.
2. **Tienen su propio banco de pruebas**, en `packages/tests/`, que no depende
   de levantar un servidor.
3. **Son de JavaScript puro.** `app/` es TypeScript ejecutado sin compilación;
   estos módulos no lo necesitan y arrastrarlos adentro habría obligado a
   tiparlos o a excluirlos del `tsconfig`.

---

## La regla que los mantiene honestos

El `Dockerfile` de producción **enumera cada uno**:

```dockerfile
COPY packages/dnc              ./packages/dnc
COPY packages/dc3              ./packages/dc3
COPY packages/contracts/contracts.js    ./packages/contracts/contracts.js
COPY packages/xlsb/extract-hc-xlsb.js   ./packages/xlsb/extract-hc-xlsb.js
```

`npm run check:imagen` comprueba esa correspondencia en cada verificación, así
que el olvido se detecta antes de construir la imagen.

`COPY packages ./packages` a secas sería más corto y peor: dejaría entrar el
banco de pruebas de DC-3 y escondería la dependencia. Enumerarlos hace que
**agregar un import hacia un módulo nuevo rompa el contenedor en el primer
arranque**, con `ERR_MODULE_NOT_FOUND`, y no en silencio meses después.

Si agregas un módulo aquí y `app/` lo importa, agrégalo también al `Dockerfile`
y al `.dockerignore`.

---

## Lo que NO va aquí

- Nada que sólo use `app/`: eso vive en `plataforma/src/`.
- El cliente VBA: vive en `excel/`, porque no es un módulo de Node y no se
  importa, se copia a mano dentro de un libro de Excel.
