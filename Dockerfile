# Token Quest booth server: the game plus /api (shared league, Excel workbook, staff export).
# Zero npm dependencies, so there is no install step.
#
#   docker build -t token-quest .
#   STAFF_PIN=<choose-a-pin> docker run --rm -p 8080:8080 -e STAFF_PIN -v token-quest-data:/data token-quest
#
# Attempts (names + emails) and the workbook live in /data: mount a volume there or they vanish
# with the container. PORT is honoured (Render injects its own). STAFF_PIN is required on any
# public host, otherwise /api/export.xlsx and /api/reset refuse every request that is not loopback.
FROM node:22-alpine

# su-exec lets the entrypoint make the mounted /data volume writable, then drop to the unprivileged
# "node" user (the same pattern the official postgres/redis images use).
RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    EXPORT_PATH="/data/Token Quest Leaderboard.xlsx"

WORKDIR /app
COPY --chown=node:node package.json index.html ./
COPY --chown=node:node css/ ./css/
COPY --chown=node:node js/ ./js/
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node server/ ./server/
COPY --chown=node:node scripts/serve.mjs ./scripts/serve.mjs
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
# --lan is what allows HOST=0.0.0.0 (scripts/serve.mjs refuses a non-loopback host without it).
CMD ["node", "scripts/serve.mjs", "--lan"]
