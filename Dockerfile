FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && mkdir -p /data/uploads && chown -R node:node /app /data
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["pnpm","start"]

FROM app AS worker
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara fonts-noto-core && python3 -m venv /opt/extract && /opt/extract/bin/pip install --no-cache-dir -r scripts/requirements.txt
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm exec playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
ENV PYTHON_BIN=/opt/extract/bin/python
USER node
CMD ["pnpm","worker"]

FROM postgres:17-bookworm AS backup
COPY --from=app /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=app /app/node_modules ./node_modules
COPY --from=app /app/package.json ./package.json
COPY --from=app /app/backend ./backend
COPY --from=app /app/scripts ./scripts
RUN mkdir -p /data/backups && chown -R 1000:1000 /data /app
USER 1000:1000
ENTRYPOINT []
CMD ["node","node_modules/tsx/dist/cli.mjs","scripts/backup-service.ts"]
