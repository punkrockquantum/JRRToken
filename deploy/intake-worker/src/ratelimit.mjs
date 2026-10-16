/**
 * Per-key token bucket kept in memory. In a Cloudflare Worker that memory is per isolate, so the
 * limit is "per IP, per isolate": a burst spread over several data centres or a recycled isolate
 * is not counted together. Good enough to blunt a careless script; for a hard limit add a
 * Cloudflare WAF rate-limiting rule in front of the Worker (see README.md).
 */
export function createRateLimiter({ perMinute, capacity = perMinute, now = Date.now, maxKeys = 5000 }) {
  const buckets = new Map()
  const refillPerMs = perMinute / 60000

  function prune(at) {
    if (buckets.size < maxKeys) return
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + (at - bucket.at) * refillPerMs >= capacity) buckets.delete(key)
    }
    if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value)
  }

  return {
    /** Resolves { ok: true } or { ok: false, retryAfter } (seconds until one token is back). */
    take(key) {
      const at = now()
      let bucket = buckets.get(key)
      if (!bucket) {
        prune(at)
        bucket = { tokens: capacity, at }
        buckets.set(key, bucket)
      } else {
        bucket.tokens = Math.min(capacity, bucket.tokens + (at - bucket.at) * refillPerMs)
        bucket.at = at
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        return { ok: true }
      }
      return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) }
    },
    get size() {
      return buckets.size
    },
  }
}
