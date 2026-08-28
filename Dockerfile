FROM docker.io/library/node:24-bookworm-slim AS app
ARG AMT_VERIFY_BUILD_LIMIT=0
RUN if [ "$AMT_VERIFY_BUILD_LIMIT" = 1 ]; then limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes); case "$limit" in ''|*[!0-9]*) exit 1;; esac; test "$limit" -gt 0 && test "$limit" -le 2147483648; fi
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN set -eu; \
    tries=0; \
    until [ "$tries" -ge 5 ]; do \
      npm install -g pnpm@11.19.0 \
        --fetch-retries=5 \
        --fetch-retry-factor=2 \
        --fetch-retry-mintimeout=20000 \
        --fetch-retry-maxtimeout=120000 \
      && exit 0; \
      tries=$((tries + 1)); \
      echo "Retrying pnpm bootstrap ($tries/5) after npm registry failure..." >&2; \
      sleep 5; \
    done; \
    exit 1
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

FROM docker.io/library/postgres:17-bookworm AS backup
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
