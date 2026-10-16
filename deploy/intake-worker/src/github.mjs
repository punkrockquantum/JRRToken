/**
 * Minimal GitHub Contents API client (read one file, write one file with compare-and-swap on its
 * blob sha). Web APIs only (fetch, btoa/atob, TextEncoder) so it runs unchanged in a Cloudflare
 * Worker and in Node for the tests. Error messages carry status codes and paths, never file
 * contents or the token.
 */

const API = "https://api.github.com"
const API_VERSION = "2022-11-28"
const USER_AGENT = "tokenquest-worker"

export class GitHubError extends Error {
  constructor(status, operation, path) {
    super(`GitHub ${operation} ${path} failed with HTTP ${status}`)
    this.name = "GitHubError"
    this.status = status
    this.operation = operation
    this.path = path
  }
}

/** The file changed under us (409) or the sha was missing/stale (422): re-read and try again. */
export class ConflictError extends GitHubError {
  constructor(status, path) {
    super(status, "write", path)
    this.name = "ConflictError"
  }
}

export function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(String(text))
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export function base64ToUtf8(encoded) {
  const binary = atob(String(encoded).replace(/\s+/g, ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** "owner/repo" -> { owner, repo } or null. */
export function parseRepo(value) {
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(String(value || "").trim())
  return match ? { owner: match[1], repo: match[2] } : null
}

/**
 * @param {object} options
 * @param {string} options.token      fine-grained PAT with Contents: read/write on this one repo
 * @param {string} options.repo       "owner/repo"
 * @param {string} [options.branch]   default "main"
 * @param {Function} [options.fetch]  injectable for tests
 */
export function createContentsClient({ token, repo, branch = "main", fetch: fetchImpl = globalThis.fetch }) {
  const parsed = parseRepo(repo)
  if (!parsed) throw new Error("PLAYERS_REPO must look like owner/repo")
  if (typeof token !== "string" || !token.trim()) throw new Error("GITHUB_TOKEN is not configured")
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available")
  const base = `${API}/repos/${parsed.owner}/${parsed.repo}`
  const headers = (accept = "application/vnd.github+json") => ({
    Accept: accept,
    Authorization: `Bearer ${token.trim()}`,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  })
  const contentsUrl = (path) => `${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}`

  async function call(url, init, operation, path) {
    try {
      return await fetchImpl(url, init)
    } catch {
      throw new GitHubError(0, operation, path)
    }
  }

  return {
    repo: `${parsed.owner}/${parsed.repo}`,
    branch,

    /** Repo metadata; resolves { ok: true } or throws GitHubError (404 = wrong repo or token without access). */
    async ping() {
      const response = await call(base, { headers: headers() }, "read", "(repo)")
      if (!response.ok) throw new GitHubError(response.status, "read", "(repo)")
      return { ok: true }
    },

    /** Resolves { text, sha } or null when the file does not exist yet. */
    async read(path) {
      const url = `${contentsUrl(path)}?ref=${encodeURIComponent(branch)}`
      const response = await call(url, { headers: headers() }, "read", path)
      if (response.status === 404) return null
      if (!response.ok) throw new GitHubError(response.status, "read", path)
      const body = await response.json().catch(() => null)
      if (!body || body.type !== "file" || typeof body.sha !== "string") throw new GitHubError(response.status, "read", path)
      if (body.encoding === "base64" && typeof body.content === "string") return { text: base64ToUtf8(body.content), sha: body.sha }
      // Files over 1 MB come back without inline content: fetch the raw bytes separately.
      const raw = await call(url, { headers: headers("application/vnd.github.raw+json") }, "read", path)
      if (!raw.ok) throw new GitHubError(raw.status, "read", path)
      return { text: await raw.text(), sha: body.sha }
    },

    /**
     * Creates (sha null) or updates (sha of the version we read) one file in a single commit.
     * Resolves { sha, commit }. Throws ConflictError on 409/422 so the caller can re-read and retry.
     */
    async write(path, text, { sha = null, message }) {
      const payload = {
        message,
        content: utf8ToBase64(text),
        branch,
        committer: { name: "Token Quest intake", email: "token-quest-intake@users.noreply.github.com" },
      }
      if (sha) payload.sha = sha
      const response = await call(
        contentsUrl(path),
        { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(payload) },
        "write",
        path,
      )
      if (response.status === 409 || response.status === 422) throw new ConflictError(response.status, path)
      if (!response.ok) throw new GitHubError(response.status, "write", path)
      const body = await response.json().catch(() => null)
      const newSha = body?.content?.sha
      if (typeof newSha !== "string") throw new GitHubError(response.status, "write", path)
      return { sha: newSha, commit: body?.commit?.sha || null }
    },
  }
}
