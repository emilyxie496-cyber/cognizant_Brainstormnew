/*
  Checks that AI-written text only uses figures it was given. Shared by the
  Node API and the Supabase Edge Function, so it imports nothing.
*/

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g
const toNumbers = (text) => (text.match(NUMBER_RE) ?? []).map((n) => Number(n.replace(/,/g, '')))

/** True when every number in `text` also appears among the supplied facts. Small counts (0 to 3) are allowed. */
export function numbersGrounded(text, facts) {
  const allowed = new Set(toNumbers(JSON.stringify(facts)))
  const allowedList = [...allowed]
  return toNumbers(text).every(
    (n) => n <= 3 || allowed.has(n) || allowedList.some((a) => a !== 0 && Math.abs(a - n) / Math.abs(a) < 0.006),
  )
}

/** Stable short key for caching a request. Not a security hash. */
export function cacheKey(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = (h1 * 33) ^ c
    h2 = (h2 * 33) ^ c
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${text.length.toString(36)}`
}

/** A small in-memory cache with a time limit and a size cap. */
export function memoryCache(ttlMs, max = 500, now = Date.now) {
  const store = new Map()
  return {
    get(key) {
      const hit = store.get(key)
      if (!hit) return undefined
      if (now() - hit.at > ttlMs) {
        store.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value) {
      if (store.size >= max) store.delete(store.keys().next().value)
      store.set(key, { at: now(), value })
    },
  }
}
