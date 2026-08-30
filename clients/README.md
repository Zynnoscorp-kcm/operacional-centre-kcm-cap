# Clientes

Lo que corre en la máquina de otra persona y no en el servidor. Nada de esto es
un módulo de Node: no se importa, se instala.

## `excel/`

El cliente VBA es el **único escritor** del libro maestro. El proceso de Node
calcula el plan de escritura y lo deja en espera de acuse; el cliente aplica y
acusa. Esa separación es una decisión de arquitectura, no un detalle de
implementación: está en
[`docs/arquitectura/DECISIONES.md`](../docs/arquitectura/DECISIONES.md).

```
excel/
├── vba/    los módulos que se importan dentro del libro
└── mac/    el puente para Excel en macOS y su instalador
```

Un solo código corre en Excel para Windows y para macOS. Todo lo que depende del
sistema operativo vive detrás del módulo `KcmPlataforma`, y `npm run check:vba`
rechaza un `#If Mac` fuera de ese puerto.

Aquí no hay Excel para compilar, así que el analizador propio cubre la clase de
fallo que sí es detectable fuera de él: literales que no compilarían, funciones
declaradas y no usadas, y las reglas del puerto. Lo que no sustituye es
`Debug > Compile` en una máquina con Excel; eso está pendiente y documentado en
[`docs/operacion/VALIDACION_EXCEL_WINDOWS.md`](../docs/operacion/VALIDACION_EXCEL_WINDOWS.md).

La instalación paso a paso está en
[`docs/referencia/VBA_BRIDGE.md`](../docs/referencia/VBA_BRIDGE.md).
