#!/bin/sh
# Container entrypoint for the Token Quest booth server.
# Platform volumes (Render disks, Fly volumes, docker -v) are often mounted owned by root, so when the
# container starts as root this makes DATA_DIR and the workbook folder writable by "node" and then runs
# the command as that unprivileged user. When the container already runs as a non-root user it just execs.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
EXPORT_DIR="$(dirname "${EXPORT_PATH:-/data/Token Quest Leaderboard.xlsx}")"

mkdir -p "$DATA_DIR" "$EXPORT_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" "$EXPORT_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"
