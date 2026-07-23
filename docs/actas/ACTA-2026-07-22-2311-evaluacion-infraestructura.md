# Acta: Evaluacion de infraestructura y guia de despliegue

Fecha: 2026-07-22 23:11 CST (America/Mexico_City).

## Contexto

La directiva solicito evaluar si el sistema KCM Cap puede completarse
unicamente con Apps Script o si requiere infraestructura adicional como Supabase.
Las areas de preocupacion eran: almacenamiento temporal de fotos del OCR,
persistencia de informacion de sesiones hasta verificacion y liberacion, y el
computo del worker OCR (Tesseract).

## Evaluacion realizada

Se reviso la totalidad del workspace, los 11 documentos en `docs/`, la
estructura de codigo fuente (22 archivos .gs, 14 servicios, worker OCR, 4
modulos), las 9 actas previas y la arquitectura completa.

Se investigaron 7 alternativas para el worker OCR:

| Plataforma | Resultado | Motivo |
|---|---|---|
| Supabase Edge Functions | NO VIABLE | 2s CPU, 256 MB RAM, bloquea sharp/libvips |
| GitHub Actions | NO VIABLE | No expone endpoints HTTP sincronos |
| Fly.io | NO VIABLE | Ya no tiene free tier (2026) |
| Hugging Face Spaces | NO VIABLE | Docker requiere PRO ($9/mes) en 2026 |
| Render | RIESGOSO | 512 MB RAM, 0.1 CPU; podria fallar con Tesseract |
| Oracle Cloud Always Free | VIABLE | 12 GB RAM ARM, pero requiere administrar servidor |
| Google Cloud Run | RECOMENDADO | Free tier cubre 15x el volumen, $0/mes, Dockerfile listo |

## Decision aprobada

**Arquitectura definitiva:**

- Apps Script + Google Sheets + Google Drive: toda la plataforma de negocio.
- Cloud Run (free tier, us-central1): worker OCR con Tesseract.
- Supabase: descartado. No puede ejecutar Tesseract.
- GitHub: descartado. No ofrece endpoints HTTP para workers.

**Costo estimado: ~$0.08 USD/mes** (Artifact Registry + Secret Manager).

## Guia de despliegue

Se produjo y aprobo una guia completa que cubre:

- PARTE 1: Apps Script (22 archivos, 17 hojas, 25+ propiedades, 3 secretos).
- PARTE 2: Cloud Run (proyecto Google Cloud, imagen Docker, servicio, secreto).
- PARTE 3: Checklist de verificacion post-despliegue.

## Documentos actualizados

- `docs/ESTADO_PROYECTO.md`: fecha, entregables de evaluacion y guia, siguiente
  paso actualizado.
- `docs/actas/INDEX.md`: este acta agregada al indice.

## Pendientes derivados

1. Ejecutar la guia de despliegue (crear recursos, subir codigo, configurar).
2. Construir imagen Docker y desplegar Cloud Run.
3. Generar secretos criptograficos y configurar Script Properties.
4. Desplegar Apps Script como `/dev` y ejecutar pruebas iniciales.
5. Obtener banco manuscrito anonimizado para calibracion de Tesseract.
6. QA visual en navegador real.
7. Resolver CAS/`NO_OVERWRITE` para habilitar la matriz real.
