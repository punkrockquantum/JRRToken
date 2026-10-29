/**
 * Workshop mode: the browser side of the session API (deploy/intake-worker/src/session.mjs), shared by
 * the team iPad (app.js), the facilitator page (host.js) and the projector board (board.js).
 *
 *   const api = createApi()
 *   const { session, pin } = await api.post("/api/session", { name })
 *   api.setTeamToken(token)                       // X-Team-Token on every /api/team call
 *   api.offsetMs                                  // serverNow − Date.now() from the last reply
 *
 * Every reply carries `serverNow`; the offset lets the timers on ten iPads and the projector agree
 * with the Worker's clock to the second. Errors are thrown as ApiError { status, code, message,
 * details } with the Worker's own message (short, friendly, no stack).
 */

export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

/** The Worker's JSON error → ApiError; a network failure → ApiError(0, "offline"). */
export function createApi({ fetch: fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), base = "" } = {}) {
  const state = { teamToken: null, facilitatorPin: null, offsetMs: 0, lastServerNow: null }

  async function call(method, path, body, { headers = {} } = {}) {
    const init = { method, headers: { Accept: "application/json", ...headers }, credentials: "same-origin" }
    if (state.teamToken) init.headers["X-Team-Token"] = state.teamToken
    if (state.facilitatorPin) init.headers["X-Facilitator-Pin"] = state.facilitatorPin
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json"
      init.body = JSON.stringify(body)
    }
    let response
    try {
      response = await fetchImpl(`${base}${path}`, init)
    } catch (error) {
      throw new ApiError(0, "offline", "No connection. Check the Wi-Fi and try again.", error?.message || null)
    }
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    if (payload && typeof payload.serverNow === "string") {
      const serverMs = Date.parse(payload.serverNow)
      if (Number.isFinite(serverMs)) {
        state.offsetMs = serverMs - now()
        state.lastServerNow = payload.serverNow
      }
    }
    if (!response.ok) {
      if (response.status === 401 && !payload?.error) throw new ApiError(401, "unauthorised", "Log in to Token Quest first (team password), then come back here.")
      throw new ApiError(response.status, payload?.error || `http_${response.status}`, payload?.message || `Request failed (${response.status}).`, payload?.details || null)
    }
    if (!payload || typeof payload !== "object") throw new ApiError(response.status, "bad_reply", "The server sent something unexpected. Reload the page.")
    return payload
  }

  return {
    get offsetMs() {
      return state.offsetMs
    },
    get serverNowMs() {
      return now() + state.offsetMs
    },
    setTeamToken(token) {
      state.teamToken = token || null
    },
    setFacilitatorPin(pin) {
      state.facilitatorPin = pin || null
    },
    get: (path) => call("GET", path),
    post: (path, body = {}) => call("POST", path, body),
    put: (path, body = {}) => call("PUT", path, body),
    del: (path, body) => call("DELETE", path, body),
  }
}

/** The 4–6 character session code from a URL (?code=ABCD) or a /board/ABCD path, upper-cased, or "". */
export function codeFromLocation(location = globalThis.location) {
  if (!location) return ""
  const fromQuery = new URLSearchParams(location.search || "").get("code")
  const fromPath = /^\/board\/([A-Za-z0-9]{4,6})\/?$/.exec(location.pathname || "")
  const raw = fromQuery || (fromPath ? fromPath[1] : "")
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6)
}

/** A tiny persistent store (localStorage when available, memory otherwise) for the iPad's team identity. */
export function createStore(key, storage = safeStorage()) {
  return {
    load() {
      try {
        const raw = storage?.getItem(key)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    },
    save(value) {
      try {
        if (value === null) storage?.removeItem(key)
        else storage?.setItem(key, JSON.stringify(value))
      } catch {
        /* private mode: the token lives for the page only */
      }
    },
  }
}

function safeStorage() {
  try {
    const storage = globalThis.localStorage
    const probe = "__tq_probe__"
    storage.setItem(probe, "1")
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}
