# Acta: Seleccion definitiva de Render para Worker OCR

Fecha: 2026-07-22 23:42 CST (America/Mexico_City).

## Contexto

Tras la evaluacion de alternativas (Supabase, GitHub Actions, Oracle Cloud, Google Cloud Run), la directiva confirmo la decision final de desplegar el worker OCR de Tesseract en **Render**.

## Decision Aprobada

**Arquitectura Definitiva:**
- **Plataforma Principal:** Google Apps Script + Google Sheets + Google Drive (Workspace).
- **Worker OCR:** Render Web Service (Docker runtime).
- **Costo estimado:** $0.00 USD/mes (Free Tier).

## Componentes Desplegables

1. **Google Apps Script:**
   - 22 archivos `.gs`
   - 2 archivos HTML (`Index.html` y `Kiosk.html`)
   - 1 Spreadsheet con 17 hojas tabulares
   - 2 carpetas restringidas en Google Drive

2. **Render Web Service:**
   - Entorno: **Docker**
   - Dockerfile: `./deploy/ocr-worker/Dockerfile`
   - Health Check: `/healthz`
   - Configuración automatizada vía `render.yaml` o manual en Dashboard.
   - Autenticación: HMAC-SHA256 con secreto en variable `KCM_OCR_WORKER_SECRET`.

## Documentación y Guías Creadas

- `render.yaml`: Blueprint para provisionar la infraestructura en Render.
- `docs/ESTADO_PROYECTO.md`: Actualizado con la arquitectura final Render.
- `docs/actas/INDEX.md`: Actualizado con este acta de acuerdo.
- `implementation_plan.md`: Guía paso a paso adaptada para Render.

## Pendientes

1. Crear Web Service en Render conectado al repositorio Git.
2. Configurar Script Properties en Apps Script.
3. Probar endpoint de salud `/healthz` y realizar prueba de flujo completo.
