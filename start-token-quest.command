#!/bin/bash
# Token Quest kiosk launcher for macOS. Double-click to start the local server and open the game.
# This window shows the server log; press Ctrl+C here to stop the server. See HOSTING.md.
set -u
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8080}"
URL="http://127.0.0.1:${PORT}/"
KIOSK_PROFILE="$HOME/Library/Application Support/Token Quest Kiosk"

pause_and_exit() {
  printf '\n%s\n' "$1" >&2
  read -r -p "Press Return to close this window." _
  exit "${2:-1}"
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  local candidate
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

NODE="$(find_node)" || pause_and_exit "Node.js was not found on this Mac.
Install the LTS version from https://nodejs.org then double-click this file again."

NODE_MAJOR="$("$NODE" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  pause_and_exit "Token Quest needs Node.js 18 or newer (found $("$NODE" -v 2>/dev/null)).
Install the LTS version from https://nodejs.org then try again."
fi

port_open() {
  "$NODE" -e '
    const socket = require("net").connect({ host: "127.0.0.1", port: Number(process.argv[1]) })
    socket.on("connect", () => { socket.destroy(); process.exit(0) })
    socket.on("error", () => process.exit(1))
    setTimeout(() => process.exit(1), 800)
  ' "$PORT"
}

open_game() {
  local chrome=""
  for candidate in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app"; do
    if [ -d "$candidate" ]; then
      chrome="$candidate"
      break
    fi
  done
  if [ -n "$chrome" ]; then
    echo "Opening Chrome in kiosk mode (Cmd+Q quits the browser)."
    open -na "$chrome" --args --kiosk --app="$URL" --user-data-dir="$KIOSK_PROFILE" \
      --no-first-run --no-default-browser-check --disable-session-crashed-bubble \
      --autoplay-policy=no-user-gesture-required
  else
    echo "Google Chrome not found; opening the default browser (press the FULLSCREEN button in the game)."
    open "$URL"
  fi
}

SERVER_PID=""
if port_open; then
  echo "Something is already listening on port $PORT (probably Token Quest). Opening the game."
else
  echo "Starting the Token Quest server on $URL"
  "$NODE" scripts/serve.mjs --port "$PORT" &
  SERVER_PID=$!
  for _ in $(seq 1 100); do
    if port_open; then break; fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      pause_and_exit "The server stopped before it was ready. Read the messages above for the reason."
    fi
    sleep 0.1
  done
  if ! port_open; then
    kill "$SERVER_PID" 2>/dev/null
    pause_and_exit "The server did not start listening on port $PORT."
  fi
fi

open_game

if [ -n "$SERVER_PID" ]; then
  stop_server() {
    echo
    echo "Stopping the Token Quest server..."
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
    exit 0
  }
  trap stop_server INT TERM
  echo
  echo "Server log follows. Keep this window open while the kiosk runs; press Ctrl+C to stop."
  echo
  wait "$SERVER_PID"
  echo
  echo "The server has stopped."
  read -r -p "Press Return to close this window." _
fi
