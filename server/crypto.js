/*
  Credential protection. Tokens and API keys are sealed with AES-256-GCM before
  they reach the store, and are opened only at the moment a provider is called.

  The key comes from INTEGRATIONS_ENCRYPTION_KEY. Without one, a random key is
  made for this process: nothing is ever written in plain text, but sealed values
  cannot be opened after a restart, and the connection reports that honestly.
*/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function createVault(secret) {
  const persistent = Boolean(secret)
  const key = persistent ? createHash('sha256').update(`waymark:${secret}`).digest() : randomBytes(32)

  return {
    persistent,
    /** Any JSON value to an opaque string. */
    seal(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
      return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`
    },
    /** Returns null when the value was sealed with another key or has been altered. */
    open(sealed) {
      try {
        const [version, iv, tag, body] = String(sealed).split('.')
        if (version !== 'v1') return null
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
        decipher.setAuthTag(Buffer.from(tag, 'base64url'))
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'))
      } catch {
        return null
      }
    },
  }
}

/**
 * The secret the vault is built from. INTEGRATIONS_ENCRYPTION_KEY wins. Without
 * it, a random key is created once and kept in <dataDir>/vault.key, so saved
 * credentials survive a restart on a single machine. That file must be treated
 * like a password: it is git-ignored with the rest of the data directory, and a
 * hosted deployment should set the environment variable instead.
 */
export function vaultSecret({ encryptionKey, dataDir }) {
  if (encryptionKey) return encryptionKey
  if (!dataDir) return ''
  const file = path.join(dataDir, 'vault.key')
  try {
    const saved = readFileSync(file, 'utf8').trim()
    if (saved.length >= 32) return saved
  } catch {
    // No key yet: one is created below.
  }
  try {
    const fresh = randomBytes(32).toString('hex')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, fresh, { mode: 0o600 })
    return fresh
  } catch (err) {
    console.error('[vault] could not save an encryption key:', err.message)
    return ''
  }
}

export const randomToken =(bytes = 24) => randomBytes(bytes).toString('base64url')

export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex')

/** PKCE challenge for an OAuth code verifier. */
export const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url')

export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export const hmacSha256 = (secret, data, encoding = 'hex') => createHmac('sha256', secret).update(data).digest(encoding)

const SECRET_KEY_RE = /(token|secret|password|api[-_]?key|authorization|webhook)/i
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{8,}|xox[abprs]-[A-Za-z0-9-]{8,}|shp(at|ss|ca)_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g

/** A copy that is safe to log or return: secret-looking keys and values are masked. */
export function redact(value, depth = 0) {
  if (typeof value === 'string') return value.replace(SECRET_VALUE_RE, '[redacted]')
  if (!value || typeof value !== 'object') return value
  if (depth > 12) return '[redacted: nested data]'
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SECRET_KEY_RE.test(k) && v ? '[redacted]' : redact(v, depth + 1)]),
  )
}
