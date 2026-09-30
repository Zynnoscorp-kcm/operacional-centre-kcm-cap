FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0

ARG KCM_OCR_WORKER_BUILD_ID=local-unversioned
LABEL org.opencontainers.image.revision="${KCM_OCR_WORKER_BUILD_ID}"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src
COPY deploy/ocr-worker ./deploy/ocr-worker

ENV NODE_ENV=production \
    PORT=8080 \
    KCM_OCR_WORKER_BUILD_ID="${KCM_OCR_WORKER_BUILD_ID}"

USER node
EXPOSE 8080

CMD ["node", "deploy/ocr-worker/server.js"]
