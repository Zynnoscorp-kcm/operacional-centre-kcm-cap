FROM node:24.14.0-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.14.0-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    KCM_ENV=staging \
    KCM_HOST=0.0.0.0 \
    NODE_OPTIONS=--max-old-space-size=384

COPY --from=deps /app/node_modules ./node_modules

COPY package.json ./

COPY plataforma/src ./plataforma/src

COPY packages/dnc ./packages/dnc
COPY packages/dc3 ./packages/dc3
COPY packages/contracts/contracts.js ./packages/contracts/contracts.js
COPY packages/xlsb/extract-hc-xlsb.js ./packages/xlsb/extract-hc-xlsb.js

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "plataforma/src/main.ts"]
