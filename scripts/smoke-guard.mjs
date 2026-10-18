/**
 * The smokes play fixture games (ada@example.com) and press the staff reset. A kiosk server with
 * UPSTREAM_URL set forwards every game to the team's live database (the Worker's D1), so a smoke
 * refuses such a server outright and says how to start a throwaway one (ENV_FILE=off turns the
 * .env file off in scripts/serve.mjs). Shared by scripts/smoke.mjs and scripts/smoke-mobile.mjs;
 * tests/smoke-guard.test.js pins it.
 */
export const THROWAWAY = "ENV_FILE=off DATA_DIR=/tmp/tq-smoke-data EXPORT_PATH=/tmp/tq-smoke-board.xlsx PORT=8091 node scripts/serve.mjs"

/**
 * Resolves true when a booth server answered /api/health without a live upstream, false when no
 * booth server answers (static hosting: nothing can be forwarded), and throws when the server
 * reports upstream.configured === true.
 */
export async function refuseLiveUpstream(url, fetchImpl = fetch) {
  let health = null
  try {
    const res = await fetchImpl(new URL("api/health", url), { cache: "no-store" })
    if (res.ok) health = await res.json()
  } catch {
    return false
  }
  if (health?.upstream?.configured === true) {
    throw new Error(`${url} forwards games to a live team server (/api/health reports upstream.configured = true): the smoke would write fixture games into the real league. Start a throwaway server instead: ${THROWAWAY}`)
  }
  return Boolean(health)
}
