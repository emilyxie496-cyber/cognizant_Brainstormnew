/*
  Connecting an AI provider with nothing but an API key: the server verifies the
  key, picks a model from the provider's own list, and keeps the key readable
  across a restart.
*/
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pickModel } from '../server/ai/providers.js'
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'
import { createVault, vaultSecret } from '../server/crypto.js'

const WORKSPACE = { 'X-Waymark-Workspace': 'k'.repeat(32), 'Content-Type': 'application/json' }
const GOOD_KEY = 'test-gemini-key-000000'
let upstream
let base
let dataDir

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'waymark-ai-'))
  upstream = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
      res.statusCode = 401
      return res.end(JSON.stringify({ error: { message: 'API key not valid' } }))
    }
    res.end(JSON.stringify({ data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/gemini-3-flash' }, { id: 'models/gemini-3-pro' }, { id: 'models/text-embedding-004' }, { id: 'models/gemini-3-flash-image' }] }))
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${upstream.address().port}`
})

afterAll(() => {
  upstream.close()
  rmSync(dataDir, { recursive: true, force: true })
})

/** Starts the API on the shared data directory, as a restart would. */
async function withServer(fn) {
  const offline = 'http://127.0.0.1:9'
  const config = { ...loadConfig({}), dataDir, geminiBaseUrl: base, openMeteoBaseUrl: offline, newsBaseUrl: offline, gdeltBaseUrl: offline, upstreamTimeoutMs: 500 }
  const server = await new Promise((resolve) => {
    const s = createApp(config).listen(0, '127.0.0.1', () => resolve(s))
  })
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({
      connect: async (body) => (await fetch(`${url}/api/integrations/gemini/connect`, { method: 'POST', headers: WORKSPACE, body: JSON.stringify(body) })).json(),
      providers: async () => (await (await fetch(`${url}/api/ai/providers`, { headers: WORKSPACE })).json()).providers,
    })
  } finally {
    // Let the debounced store write land before the next "restart" reads it.
    await new Promise((r) => setTimeout(r, 400))
    server.close()
  }
}

describe('pickModel', () => {
  it('takes the newest general-purpose model and skips special-purpose ones', () => {
    expect(pickModel('gemini', ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3-pro', 'text-embedding-004', 'gemini-3-flash-image'])).toBe('gemini-3-flash')
    expect(pickModel('openai', ['gpt-4o', 'gpt-5.2', 'gpt-5.2-mini', 'text-embedding-3-large', 'whisper-1'])).toBe('gpt-5.2')
    expect(pickModel('xai', ['grok-4', 'grok-5', 'grok-imagine-image'])).toBe('grok-5')
  })

  it('returns nothing when the list has no chat model', () => {
    expect(pickModel('gemini', ['text-embedding-004'])).toBe('')
    expect(pickModel('gemini', [])).toBe('')
  })
})

describe('vault key', () => {
  it('is created once per data directory and reused', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'waymark-vault-'))
    try {
      const first = vaultSecret({ encryptionKey: '', dataDir: dir })
      expect(first.length).toBeGreaterThanOrEqual(32)
      expect(vaultSecret({ encryptionKey: '', dataDir: dir })).toBe(first)
      const sealed = createVault(first).seal({ apiKey: 'abc' })
      expect(createVault(vaultSecret({ encryptionKey: '', dataDir: dir })).open(sealed)).toEqual({ apiKey: 'abc' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prefers the configured key, and stays temporary without a data directory', () => {
    expect(vaultSecret({ encryptionKey: 'configured', dataDir: 'unused' })).toBe('configured')
    expect(vaultSecret({ encryptionKey: '', dataDir: '' })).toBe('')
  })
})

describe('connecting Gemini with only an API key', () => {
  it('rejects a bad key without claiming a connection', async () => {
    await withServer(async ({ connect }) => {
      const { integration } = await connect({ apiKey: 'wrong-key-000000' })
      expect(integration.status).toBe('error')
      expect(JSON.stringify(integration)).not.toContain('wrong-key-000000')
    })
  })

  it('connects, chooses a model, and is still connected after a restart', async () => {
    await withServer(async ({ connect }) => {
      const { integration } = await connect({ apiKey: GOOD_KEY })
      expect(integration.status).toBe('connected')
      expect(integration.model).toBe('gemini-3-flash')
      expect(integration.autoModel).toBe(true)
      expect(JSON.stringify(integration)).not.toContain(GOOD_KEY)
    })
    await withServer(async ({ providers, connect }) => {
      const gemini = (await providers()).find((p) => p.id === 'gemini')
      expect(gemini.ready).toBe(true)
      expect(gemini.model).toBe('gemini-3-flash')
      // Choosing another model keeps the saved key.
      const { integration } = await connect({ model: 'gemini-3-pro' })
      expect(integration.status).toBe('connected')
      expect(integration.model).toBe('gemini-3-pro')
    })
  })
})
