#!/bin/bash
# Token Quest kiosk launcher for macOS. Double-click to start the local server and open the game.
# This window shows the server log; press Ctrl+C here to stop the server. See HOSTING.md.
#
# Several laptops at the show, one league (HOSTING.md, "Many laptops, one league"). Put the
# settings in a file called .env next to this script (git-ignored: never commit it):
#
#   KIOSK_URL=https://tokenquest.tokenquest.workers.dev     simplest: no local server, Chrome opens the
#                                                           team URL in kiosk mode; everything is central
#   UPSTREAM_URL=https://tokenquest.tokenquest.workers.dev  offline-tolerant: the local server runs as
#   UPSTREAM_KEY=<the Worker's INTAKE_KEY>                  usual and also sends every game to the team
#                                                           server (queued while the Wi-Fi is down)
#
# KIOSK_URL is read here; UPSTREAM_URL / UPSTREAM_KEY (and STAFF_PIN, PORT...) by the server itself.
set -u
cd "$(dirname "$0")" || exit 1

# A value from the environment wins over the .env file.
env_value() {
  local line
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env 2>/dev/null | tail -1 | cut -d= -f2-)"
  printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//" | tr -d '\r'
}
KIOSK_URL="${KIOSK_URL:-$(env_value KIOSK_URL)}"

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

case "$KIOSK_URL" in
  https://*)
    # Central mode: the game, the scores and the team password all live on the team server.
    URL="$KIOSK_URL"
    echo "Central mode: opening the team server $URL (no local server on this laptop)."
    echo "Type the team password once; every game played here is kept with the other laptops' games."
    open_game
    exit 0
    ;;
  "")
    ;;
  *)
    pause_and_exit "KIOSK_URL must start with https:// (got: $KIOSK_URL). Fix it in .env or leave it out."
    ;;
esac

if [ -f .env ]; then
  echo "Reading .env: $(grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*' .env | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//' | tr '\n' ' ')(values are not shown)"
fi

# Every laptop feeds the one scoreboard. Without the team settings the games would stay on this machine,
# so the launcher refuses to run a silent, offline kiosk (set KIOSK_URL for the all-central mode instead).
UPSTREAM_URL_SET="${UPSTREAM_URL:-$(env_value UPSTREAM_URL)}"
UPSTREAM_KEY_SET="${UPSTREAM_KEY:-$(env_value UPSTREAM_KEY)}"
if [ -z "$UPSTREAM_URL_SET" ] || [ -z "$UPSTREAM_KEY_SET" ]; then
  pause_and_exit "This laptop is not connected to the team scoreboard.
Create a file named .env next to this script with:
  UPSTREAM_URL=https://tokenquest.tokenquest.workers.dev
  UPSTREAM_KEY=<the team server's intake key: copy it from a laptop that already has it>
(or KIOSK_URL=https://tokenquest.tokenquest.workers.dev to run everything on the team server), then try again."
fi

# Always run the latest game: pull when this is a git checkout with a reachable remote (a failed pull is
# not fatal: an offline laptop plays what it has and syncs later).
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
  if git pull --ff-only --quiet origin "$BRANCH" 2>/dev/null; then
    echo "Game code is up to date ($(git rev-parse --short HEAD))."
  else
    echo "Could not pull the latest game (offline, or local changes): playing this laptop's copy ($(git rev-parse --short HEAD 2>/dev/null))."
  fi
fi

# A server left running from an earlier day may predate the sync code. Restart it so it reads .env and
# pushes everything this laptop holds before the first player arrives.
SERVER_PID=""
if port_open; then
  OLD_PID="$(lsof -tnP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)"
  if [ -n "$OLD_PID" ] && ps -o command= -p "$OLD_PID" 2>/dev/null | grep -q "scripts/serve.mjs"; then
    echo "Restarting the Token Quest server already on port $PORT so it runs the latest code with the team settings."
    kill "$OLD_PID" 2>/dev/null
    for _ in $(seq 1 50); do
      if ! port_open; then break; fi
      sleep 0.1
    done
  fi
fi

if port_open; then
  echo "Something else is listening on port $PORT. Opening the game there."
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

# Push anything this laptop still holds (earlier days, offline play) to the team scoreboard before the
# first game. The server queues on start-up by itself; this just waits a moment and reports the result.
"$NODE" -e '
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const url = "http://127.0.0.1:" + process.argv[1] + "/api/health"
  ;(async () => {
    let last = null
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(url)
        const data = await res.json()
        const up = data.upstream || {}
        last = up
        if (!up.configured) { console.log("Scoreboard sync: not configured (check .env)."); return }
        if (up.queued === 0) { console.log("Scoreboard sync: every game on this laptop is on the team board (" + (up.sent || 0) + " sent)."); return }
      } catch {}
      await wait(500)
    }
    if (last) console.log("Scoreboard sync: " + last.queued + " game(s) still queued; they are sent automatically as soon as the network allows" + (last.lastError ? " (" + last.lastError + ")" : "") + ".")
  })()
' "$PORT"

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
