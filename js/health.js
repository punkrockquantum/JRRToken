/**
 * The /api/health probe the title board uses to say why the shared scores are empty: the hosted
 * Worker answers { configured: false } until its GITHUB_TOKEN is set. Same base URL as js/sync.js
 * (same origin, or window.TOKEN_QUEST_INTAKE). Never throws; null when the server cannot be reached.
 */
import { resolveIntakeBase } from "./sync.js"

const TIMEOUT_MS = 4000

export async function fetchHealth(fetchImpl = typeof fetch === "function" ? (...args) => fetch(...args) : null, base = resolveIntakeBase(typeof window !== "undefined" ? window.TOKEN_QUEST_INTAKE : "")) {
  if (!fetchImpl) return null
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null
  try {
    const response = await fetchImpl(`${base}/api/health`, { cache: "no-store", signal: controller?.signal })
    const data = await response.json().catch(() => null)
    return data && typeof data === "object" ? data : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
