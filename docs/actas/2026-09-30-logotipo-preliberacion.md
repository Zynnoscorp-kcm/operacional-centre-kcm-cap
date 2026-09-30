# Acta · Logotipo en talón y acta de preliberación · 2026-09-30

- Causa: `domain/preliberacion/reporte.ts` leía `referencias/privado/logotipos/empresa.png`; esa carpeta está en `.vercelignore` y fuera de `includeFiles`, así que en la nube caía al nombre en texto.
- Arreglo: el reporte lee `web/pdf/membrete/empresa.png`, el mismo archivo (idéntico byte por byte) que usa la DC-3.
- Evidencia: prueba «lleva el logotipo de la empresa aunque no exista referencias/privado» falla antes del arreglo y pasa después; typecheck limpio.
