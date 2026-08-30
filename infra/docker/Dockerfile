# Imagen de producción de la plataforma KCM.
#
# La plataforma ejecuta TypeScript nativo con Node 24: no hay paso de
# compilación porque desde la 22.18 Node borra los tipos al cargar el módulo y
# en 24 está activo sin bandera. Por eso no existe una etapa de `build`; la
# primera etapa sólo resuelve dependencias.
#
# Lo que entra a la imagen está enumerado archivo por archivo, y esa es una
# decisión. `COPY plataforma ./plataforma` a secas no basta: la plataforma importa cuatro
# módulos que viven fuera de `plataforma/` —el motor DNC, el generador DC-3, el lector
# XLSB y los contratos compartidos— y sin ellos el proceso muere al arrancar con
# ERR_MODULE_NOT_FOUND, no al usarse. Enumerarlos deja la dependencia a la
# vista: si alguien agrega un import hacia un módulo nuevo, el contenedor falla
# en el primer arranque y no en silencio.

# --- Etapa 1: dependencias de ejecución -------------------------------------
FROM node:24.14.0-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# `--omit=dev` deja fuera el utillaje local; aquí sólo quedan `fastify` y `pg`.
# `--ignore-scripts` evita que un postinstall compile binarios que nadie usa.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# --- Etapa 2: ejecución ------------------------------------------------------
FROM node:24.14.0-bookworm-slim AS runtime

WORKDIR /app

# El alojamiento de referencia da 512 MB. Sin techo explícito, V8 dimensiona el
# heap contra la memoria del host y no la del contenedor, y el OOM llega como un
# reinicio sin explicación en vez de como una excepción legible.
#
# `KCM_STORAGE_DIR` se deja deliberadamente sin definir. Un alojamiento sin
# disco persistente pierde las evidencias de preliberación en cada ciclo; con la
# variable ausente la plataforma las guarda en la propia base
# (`PostgresObjectStore`), donde sobreviven al redespliegue junto al apuntador
# de `kcm.evidencia`.
ENV NODE_ENV=production \
    PORT=8787 \
    KCM_ENV=staging \
    KCM_HOST=0.0.0.0 \
    NODE_OPTIONS=--max-old-space-size=384

COPY --from=deps /app/node_modules ./node_modules

# `"type": "module"` vive aquí. Sin este archivo Node trataría los `.js` de los
# paquetes compartidos como CommonJS y sus `import` fallarían al cargar.
COPY package.json ./

# La plataforma. `plataforma/src` incluye `web/assets/`, que se resuelve con
# `import.meta.dirname` y por eso viaja junto al código y no aparte.
COPY plataforma/src ./plataforma/src

# Los cuatro módulos compartidos que la plataforma importa en ejecución.
# `packages/core` queda fuera a propósito: sólo lo consumen las pruebas.
COPY packages/dnc ./packages/dnc
COPY packages/dc3 ./packages/dc3
COPY packages/contracts/contracts.js ./packages/contracts/contracts.js
COPY packages/xlsb/extract-hc-xlsb.js ./packages/xlsb/extract-hc-xlsb.js

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node arranca como PID 1 y recibe las señales directamente; `main.ts` registra
# SIGINT y SIGTERM para cerrar Fastify y drenar el pool antes de salir, así que
# no hace falta un init intermedio.
CMD ["node", "plataforma/src/main.ts"]
