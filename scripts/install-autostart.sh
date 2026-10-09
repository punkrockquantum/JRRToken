#!/bin/bash
# Installs a launchd LaunchAgent so the Token Quest server starts at login and is restarted if it stops.
#
#   ./scripts/install-autostart.sh              install or update (idempotent)
#   ./scripts/install-autostart.sh --uninstall  stop it and remove the LaunchAgent
#
# Optional environment: PORT, DATA_DIR, EXPORT_PATH, STAFF_PIN, LAN=1 (adds --lan: network-visible), NODE (path to node).
# Logs go to DATA_DIR/server.log. The plist is written with mode 600 because it may contain STAFF_PIN.
set -euo pipefail

LABEL="com.tokenquest.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  printf '%s' "$s"
}

stop_agent() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  stop_agent
  rm -f "$PLIST"
  echo "Removed $LABEL. The Token Quest server will no longer start at login."
  exit 0
fi
if [ -n "${1:-}" ]; then
  echo "Usage: $0 [--uninstall]" >&2
  exit 2
fi

NODE="${NODE:-$(command -v node || true)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "node was not found. Install Node.js 18+ from https://nodejs.org or pass NODE=/path/to/node." >&2
  exit 1
fi

PORT="${PORT:-8080}"
LAN="${LAN:-0}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$ROOT/$DATA_DIR" ;; esac
EXPORT_PATH="${EXPORT_PATH:-$HOME/Desktop/Token Quest Leaderboard.xlsx}"
case "$EXPORT_PATH" in "~/"*) EXPORT_PATH="$HOME/${EXPORT_PATH#"~/"}" ;; esac
HOST_ADDR="${HOST:-}"
if [ -z "$HOST_ADDR" ]; then
  if [ "$LAN" = "1" ]; then HOST_ADDR="0.0.0.0"; else HOST_ADDR="127.0.0.1"; fi
fi
LAN_ARG=""
if [ "$LAN" = "1" ]; then LAN_ARG="    <string>--lan</string>"; fi
PIN_ENTRY=""
if [ -n "${STAFF_PIN:-}" ]; then
  PIN_ENTRY="    <key>STAFF_PIN</key><string>$(xml_escape "$STAFF_PIN")</string>"
fi

mkdir -p "$DATA_DIR" "$HOME/Library/LaunchAgents"

umask 077
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE")</string>
    <string>$(xml_escape "$ROOT/scripts/serve.mjs")</string>
$LAN_ARG
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$(dirname "$NODE")"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key><string>$(xml_escape "$PORT")</string>
    <key>HOST</key><string>$(xml_escape "$HOST_ADDR")</string>
    <key>DATA_DIR</key><string>$(xml_escape "$DATA_DIR")</string>
    <key>EXPORT_PATH</key><string>$(xml_escape "$EXPORT_PATH")</string>
$PIN_ENTRY
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$(xml_escape "$DATA_DIR/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$DATA_DIR/server.log")</string>
</dict>
</plist>
EOF
chmod 600 "$PLIST"
plutil -lint "$PLIST" >/dev/null

stop_agent
if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
  launchctl load -w "$PLIST"
fi

echo "Installed $LABEL"
echo "  Server:   http://127.0.0.1:$PORT/  (starts at login, restarts if it stops)"
if [ "$LAN" = "1" ]; then echo "  WARNING:  LAN mode is on; every device on the network can reach the game."; fi
echo "  Data:     $DATA_DIR"
echo "  Excel:    $EXPORT_PATH"
echo "  Log:      $DATA_DIR/server.log"
echo "  Remove:   $0 --uninstall"
