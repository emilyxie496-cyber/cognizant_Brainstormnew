/*
  Integration management: connections, credentials, verification, sync jobs,
  synced datasets and record mappings, for one tenant at a time.

  Status is derived, never stored as a claim. A connection is "Connected" only
  after a provider call has succeeded with its credentials; sample data is
  "Demo Mode"; anything unverified is "Configuration Required".
*/
import { INTEGRATIONS, STATUS, integrationById } from '../../shared/integrations.js'
import { LLM_PROVIDERS, LlmError, pickModel, resolveProvider, verifyProvider } from '../ai/providers.js'
import { randomToken, sha256 } from '../crypto.js'
import { ADAPTERS, ConfigError, ProviderError, TRACKING_PROVIDERS } from './adapters.js'
import { DEMO_DATASETS, demoTracking } from './fixtures.js'

export { ConfigError, ProviderError }

const STATE_TTL_MS = 10 * 60_000
const HEALTH_TTL_MS = 10 * 60_000
const now = () => new Date().toISOString()
const hint = (secret) => (secret && secret.length >= 8 ? `••••${secret.slice(-4)}` : '••••')
const countsOf = (dataset) => Object.fromEntries(Object.entries(dataset).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]))

function mergeById(previous, incoming) {
  const map = new Map((previous ?? []).map((r) => [r.externalId, r]))
  for (const row of incoming ?? []) map.set(row.externalId, row)
  return [...map.values()]
}

export function createIntegrationService({ config, store, vault, fetchImpl }) {
  const oauthStates = new Map()
  const health = new Map() // key-less services and AI keys: { at, ok, detail, models, code }
  const running = new Set()
  const redirectUri = `${config.publicApiUrl}/api/integrations/oauth/callback`

  const connection = (tenant, id) => store.get(tenant, 'integration_connections', id)
  const saveConnection = (tenant, conn) => store.put(tenant, 'integration_connections', { ...conn, updatedAt: now() })

  async function logEvent(tenant, provider, type, detail, actor = 'system') {
    await store.put(tenant, 'integration_events', { id: randomToken(9), provider, type, detail: String(detail ?? '').slice(0, 300), actor, at: now() })
  }

  /** Everything an adapter needs for one call. Throws ConfigError if the stored credentials cannot be opened. */
  async function context(tenant, conn) {
    const secret = conn.sealed ? vault.open(conn.sealed) : {}
    if (conn.sealed && !secret) throw new ConfigError('The saved credentials can no longer be read. Connect again.')
    return {
      config, fetchImpl, secret, settings: { ...(conn.settings ?? {}) },
      async saveSecret(next) {
        const fresh = (await connection(tenant, conn.id)) ?? conn
        await saveConnection(tenant, { ...fresh, sealed: vault.seal(next) })
      },
    }
  }

  /* ---------- AI providers ---------- */

  async function llmWorkspace(tenant, id) {
    const conn = await connection(tenant, id)
    const secret = conn?.sealed ? vault.open(conn.sealed) : null
    return { apiKey: secret?.apiKey ?? '', model: conn?.settings?.model ?? '', unreadable: Boolean(conn?.sealed && !secret) }
  }

  /** Lists the models a key can use. Cached per key, so choosing or changing a model costs no extra call. */
  async function llmHealth(provider, force = false) {
    const key = `llm:${provider.id}:${sha256(provider.apiKey).slice(0, 16)}`
    const hit = health.get(key)
    if (!force && hit && Date.now() - hit.at < HEALTH_TTL_MS) return hit
    let entry
    try {
      const { models } = await verifyProvider(provider, fetchImpl)
      entry = { at: Date.now(), ok: true, models }
    } catch (err) {
      entry = { at: Date.now(), ok: false, models: [], code: err instanceof LlmError ? err.code : 'llm_error', detail: err instanceof LlmError ? err.message : 'The provider could not be verified.' }
    }
    health.set(key, entry)
    return entry
  }

  /** A provider with a key but no model gets one chosen from the models that key offers. */
  async function withModel(provider, force = false) {
    if (provider.model || !provider.apiKey) return provider
    const check = await llmHealth(provider, force)
    const model = check.ok ? pickModel(provider.id, check.models) : ''
    return model ? { ...provider, model, autoModel: true, configured: true, missing: [] } : provider
  }

  async function llmProvider(tenant, id) {
    return withModel(resolveProvider(config, id, await llmWorkspace(tenant, id)))
  }

  async function llmView(tenant, def, conn, force) {
    const workspace = await llmWorkspace(tenant, def.id)
    const provider = await withModel(resolveProvider(config, def.id, workspace), force)
    const base = { keySource: provider.keySource, model: provider.model || null, autoModel: Boolean(provider.autoModel), models: [], capabilities: LLM_PROVIDERS[def.id].capabilities, secretHint: conn?.settings?.hint ?? null }
    if (workspace.unreadable) return { ...base, status: 'configuration_required', health: 'The saved API key can no longer be read. Enter it again.' }
    if (!provider.apiKey) return { ...base, status: 'not_connected', health: 'No API key yet.' }
    const check = await llmHealth(provider, force)
    if (!check.ok) return { ...base, status: check.code === 'not_configured' ? 'configuration_required' : 'error', health: check.detail }
    const view = { ...base, models: check.models, verifiedAt: new Date(check.at).toISOString() }
    if (!provider.model) return { ...view, status: 'configuration_required', health: 'The key works, but it lists no chat model Waymark can use. Enter a model id.' }
    if (check.models.length && !check.models.includes(provider.model)) return { ...view, status: 'configuration_required', health: `The key works, but it does not offer the model "${provider.model}". Choose another.` }
    return { ...view, status: 'connected', health: `Key verified with ${def.vendor}. Using ${provider.model}${provider.autoModel ? ' (chosen automatically)' : ''}.` }
  }

  /* ---------- Status ---------- */

  async function keylessView(def, force) {
    const hit = health.get(def.id)
    let entry = hit
    if (force || !hit || Date.now() - hit.at > HEALTH_TTL_MS) {
      try {
        const result = await ADAPTERS[def.id].test({ config: { ...config, upstreamTimeoutMs: Math.min(config.upstreamTimeoutMs ?? 10_000, 6000) }, fetchImpl, secret: {}, settings: {} })
        entry = { at: Date.now(), ok: true, detail: result.detail }
      } catch (err) {
        entry = { at: Date.now(), ok: false, detail: err.message }
      }
      health.set(def.id, entry)
    }
    return { status: entry.ok ? 'connected' : 'error', health: entry.detail, verifiedAt: entry.ok ? new Date(entry.at).toISOString() : null }
  }

  function credentialView(def, conn) {
    const adapter = ADAPTERS[def.id]
    const requirement = def.auth === 'oauth' ? adapter.prerequisite?.(config) ?? null : null
    const oauthReady = def.auth === 'oauth' ? !requirement : Boolean(adapter.oauth?.available?.(config))
    const base = { requirement, oauthReady, redirectUri: adapter.oauth ? redirectUri : null }
    if (!conn) {
      if (requirement && !def.demo) return { ...base, status: 'configuration_required', health: requirement }
      return { ...base, status: requirement ? 'configuration_required' : 'not_connected', health: requirement ?? 'Not connected.' }
    }
    if (conn.demo) return { ...base, status: 'demo', health: 'Sample data is loaded. No live account is connected.' }
    if (conn.syncing) return { ...base, status: 'syncing', health: 'Synchronisation in progress.' }
    if (!conn.sealed) {
      if (conn.accessRequested) return { ...base, status: 'access_pending', health: `Marked as waiting for ${def.vendor} to grant API access. Add the credentials here when they arrive.` }
      return { ...base, status: requirement ? 'configuration_required' : 'not_connected', health: requirement ?? 'Not connected.' }
    }
    if (!vault.open(conn.sealed)) return { ...base, status: 'configuration_required', health: 'The saved credentials can no longer be read (the server encryption key changed). Connect again.' }
    if (conn.lastError) return { ...base, status: 'error', health: conn.lastError }
    if (!conn.verifiedAt) return { ...base, status: 'configuration_required', health: conn.pendingNote ?? 'Credentials are saved but not yet verified. Run a test to confirm them.' }
    return { ...base, status: 'connected', health: conn.account ? `Verified with ${conn.account}.` : 'Verified.' }
  }

  async function view(tenant, def, { force = false } = {}) {
    const conn = await connection(tenant, def.id)
    let state
    if (def.llm) state = await llmView(tenant, def, conn, force)
    else if (def.auth === 'builtin') state = { status: 'connected', health: 'Built into Waymark. Nothing to connect.' }
    else if (def.auth === 'none') state = await keylessView(def, force)
    else state = credentialView(def, conn)
    const settings = { ...(conn?.settings ?? {}) }
    delete settings.hint
    return {
      id: def.id,
      ...state,
      statusLabel: STATUS[state.status].label,
      account: conn?.account ?? null,
      authMode: conn?.authMode ?? null,
      settings,
      secretHint: state.secretHint ?? conn?.settings?.hint ?? null,
      syncEnabled: conn?.syncEnabled !== false,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastSyncSummary: conn?.lastSyncSummary ?? null,
      verifiedAt: state.verifiedAt ?? conn?.verifiedAt ?? null,
      connectedAt: conn?.connectedAt ?? null,
      connectedBy: conn?.connectedBy ?? null,
      accessRequested: Boolean(conn?.accessRequested),
      demo: Boolean(conn?.demo),
      hasCredentials: Boolean(conn?.sealed),
    }
  }

  const defOrThrow = (id) => {
    const def = integrationById(id)
    if (!def) throw new ConfigError('Unknown integration.')
    return def
  }

  /* ---------- Connect, test, disconnect ---------- */

  async function verifyAndSave(tenant, def, conn, actor) {
    const adapter = ADAPTERS[def.id]
    const ctx = await context(tenant, conn)
    try {
      const proof = await adapter.test(ctx)
      const fresh = (await connection(tenant, def.id)) ?? conn
      const next = { ...fresh, settings: { ...fresh.settings, ...ctx.settings }, lastTestAt: now(), lastError: null }
      if (proof.unverified) next.pendingNote = proof.detail
      else Object.assign(next, { verifiedAt: now(), account: proof.account ?? fresh.account ?? null, pendingNote: null })
      await saveConnection(tenant, next)
      await logEvent(tenant, def.id, proof.unverified ? 'saved_unverified' : 'test_ok', proof.detail, actor)
      return { ok: !proof.unverified, unverified: Boolean(proof.unverified), detail: proof.detail }
    } catch (err) {
      const message = err instanceof ProviderError || err instanceof ConfigError ? err.message : 'The connection test failed.'
      const fresh = (await connection(tenant, def.id)) ?? conn
      await saveConnection(tenant, { ...fresh, lastTestAt: now(), lastError: message, verifiedAt: null })
      await logEvent(tenant, def.id, 'test_failed', message, actor)
      return { ok: false, detail: message }
    }
  }

  async function connect(tenant, id, input = {}, actor = 'user') {
    const def = defOrThrow(id)
    const adapter = ADAPTERS[id]

    if (def.llm) {
      const existing = await connection(tenant, id)
      const previous = existing?.sealed ? vault.open(existing.sealed) : null
      const apiKey = String(input.apiKey ?? '').trim() || previous?.apiKey || ''
      const model = input.model === undefined ? existing?.settings?.model ?? '' : String(input.model ?? '').trim().slice(0, 120)
      if (apiKey.length > 400) throw new ConfigError('The API key is too long.')
      if (model && !/^[\w.:\-/]+$/.test(model)) throw new ConfigError('The model id contains characters that are not allowed.')
      await saveConnection(tenant, {
        id, authMode: 'apikey', sealed: apiKey ? vault.seal({ apiKey }) : null,
        settings: { model, ...(apiKey ? { hint: hint(apiKey) } : {}) }, connectedAt: existing?.connectedAt ?? now(), connectedBy: actor,
      })
      await logEvent(tenant, id, 'configured', model ? `Model set to ${model}` : 'API key saved', actor)
      return { integration: await view(tenant, def, { force: true }) }
    }

    if (def.auth === 'builtin' || def.auth === 'none') throw new ConfigError(`${def.name} needs no connection.`)

    const wantsOAuth = def.auth === 'oauth' || (input.mode === 'oauth' && adapter.oauth)
    if (wantsOAuth) {
      const requirement = adapter.prerequisite?.(config) ?? (adapter.oauth.available && !adapter.oauth.available(config) ? `The ${def.name} sign-in is not set up on this server.` : null)
      if (requirement) throw new ConfigError(requirement)
      const state = randomToken(32)
      const verifier = randomToken(48)
      if (oauthStates.size > 1000) oauthStates.clear()
      oauthStates.set(state, { tenant, id, verifier, actor, at: Date.now(), ...(adapter.oauth.stateExtra?.(input) ?? {}) })
      return { authorizeUrl: adapter.oauth.authorizeUrl(config, { state, redirectUri, verifier, input }) }
    }

    const { secret, settings } = adapter.validate(input, config)
    const existing = await connection(tenant, id)
    const conn = {
      id, authMode: def.auth, sealed: vault.seal(secret), settings: { ...settings, hint: hint(Object.values(secret)[0]) },
      syncEnabled: existing?.syncEnabled ?? true, connectedAt: now(), connectedBy: actor, verifiedAt: null, lastError: null, demo: false, accessRequested: false,
    }
    await saveConnection(tenant, conn)
    const result = await verifyAndSave(tenant, def, conn, actor)
    return { integration: await view(tenant, def), test: result }
  }

  /** Completes an OAuth sign-in. Returns the app URL to send the browser back to. */
  async function oauthCallback(query) {
    const back = (params) => `${config.appBaseUrl}/app/integrations?${new URLSearchParams(params)}`
    const state = String(query.state ?? '')
    const entry = oauthStates.get(state)
    oauthStates.delete(state) // single use, whatever happens next
    if (!entry || Date.now() - entry.at > STATE_TTL_MS) return back({ error: 'state' })
    const { tenant, id, verifier, actor } = entry
    if (query.error) {
      await logEvent(tenant, id, 'oauth_denied', 'The sign-in was cancelled or refused.', actor)
      return back({ error: 'denied', provider: id })
    }
    if (!query.code) return back({ error: 'exchange', provider: id })
    const def = integrationById(id)
    const adapter = ADAPTERS[id]
    try {
      const ctx = { config, fetchImpl, secret: {}, settings: {} }
      const { secret, settings } = await adapter.oauth.exchange(ctx, { code: String(query.code), redirectUri, verifier, query, stateData: entry })
      const existing = await connection(tenant, id)
      const conn = { id, authMode: 'oauth', sealed: vault.seal(secret), settings: { ...existing?.settings, ...settings }, syncEnabled: existing?.syncEnabled ?? true, connectedAt: now(), connectedBy: actor, verifiedAt: null, lastError: null, demo: false, accessRequested: false }
      await saveConnection(tenant, conn)
      await logEvent(tenant, id, 'oauth_connected', `${def.name} authorised.`, actor)
      const result = await verifyAndSave(tenant, def, conn, actor)
      return back(result.ok ? { connected: id } : { error: 'verify', provider: id })
    } catch (err) {
      await logEvent(tenant, id, 'oauth_failed', err instanceof ProviderError || err instanceof ConfigError ? err.message : 'The sign-in could not be completed.', actor)
      return back({ error: err.code === 'bad_signature' || err.code === 'bad_callback' ? 'callback' : 'exchange', provider: id })
    }
  }

  async function test(tenant, id, actor = 'user') {
    const def = defOrThrow(id)
    if (def.llm || def.auth === 'none') {
      const integration = await view(tenant, def, { force: true })
      const ok = integration.status === 'connected'
      await logEvent(tenant, id, ok ? 'test_ok' : 'test_failed', integration.health, actor)
      return { ok, detail: integration.health, integration }
    }
    if (def.auth === 'builtin') return { ok: true, detail: 'Built into Waymark.', integration: await view(tenant, def) }
    const conn = await connection(tenant, id)
    if (conn?.demo) return { ok: false, detail: 'Sample data is loaded, so there is no live connection to test.', integration: await view(tenant, def) }
    if (!conn?.sealed) throw new ConfigError(`${def.name} is not connected.`)
    const result = await verifyAndSave(tenant, def, conn, actor)
    return { ...result, integration: await view(tenant, def) }
  }

  async function configure(tenant, id, patch = {}, actor = 'user') {
    const def = defOrThrow(id)
    const conn = (await connection(tenant, id)) ?? { id, settings: {} }
    const next = { ...conn, settings: { ...conn.settings } }
    if (typeof patch.syncEnabled === 'boolean') next.syncEnabled = patch.syncEnabled
    if (typeof patch.accessRequested === 'boolean' && def.commercial) next.accessRequested = patch.accessRequested
    if (id === 'slack' && patch.channel !== undefined) {
      if (patch.channel && !/^[A-Z0-9]{6,20}$/.test(patch.channel)) throw new ConfigError('That is not a Slack channel id.')
      next.settings.channel = patch.channel || null
      next.settings.channelName = String(patch.channelName ?? '').replace(/[^\w-]/g, '').slice(0, 80) || null
    }
    if (def.dataset === 'tracking' && patch.testMmsi !== undefined) next.settings.testMmsi = String(patch.testMmsi).replace(/\D/g, '').slice(0, 9) || undefined
    await saveConnection(tenant, next)
    await logEvent(tenant, id, 'settings_changed', Object.keys(patch).join(', '), actor)
    return view(tenant, def)
  }

  async function disconnect(tenant, id, actor = 'user') {
    const def = defOrThrow(id)
    const conn = await connection(tenant, id)
    if (!conn) return view(tenant, def)
    let revoked = false
    if (conn.sealed && !conn.demo && ADAPTERS[id]?.oauth?.revoke) {
      try {
        await ADAPTERS[id].oauth.revoke(await context(tenant, conn))
        revoked = true
      } catch {
        revoked = false // the local credentials are removed regardless
      }
    }
    await store.remove(tenant, 'integration_connections', id)
    if (def.dataset && def.dataset !== 'tracking') await store.remove(tenant, 'integration_datasets', def.dataset)
    for (const m of await store.list(tenant, 'external_record_mappings')) if (m.provider === id && (conn.demo ? m.demo : true)) await store.remove(tenant, 'external_record_mappings', m.id)
    await logEvent(tenant, id, 'disconnected', conn.demo ? 'Sample data removed.' : revoked ? 'Credentials deleted and the token revoked with the provider.' : 'Credentials deleted from Waymark.', actor)
    return view(tenant, def)
  }

  /* ---------- Demo Mode ---------- */

  async function enableDemo(tenant, id, ws, actor = 'user') {
    const def = defOrThrow(id)
    if (!def.demo) throw new ConfigError(`${def.name} has no sample data.`)
    const existing = await connection(tenant, id)
    if (existing?.sealed && !existing.demo) throw new ConfigError(`Disconnect the live ${def.name} account before loading sample data.`)
    const conn = { id, authMode: 'demo', demo: true, sealed: null, settings: {}, syncEnabled: true, connectedAt: now(), connectedBy: actor }
    const fixture = DEMO_DATASETS[id]
    if (fixture) {
      const dataset = fixture.build(ws)
      await store.put(tenant, 'integration_datasets', { id: fixture.dataset, provider: id, sealed: vault.seal(dataset), asOf: dataset.asOf, demo: true })
      for (const m of fixture.mappings(ws)) await store.put(tenant, 'external_record_mappings', m)
      Object.assign(conn, { lastSyncAt: dataset.asOf, lastSyncSummary: { demo: true, counts: countsOf(dataset) } })
    }
    await saveConnection(tenant, conn)
    await logEvent(tenant, id, 'demo_enabled', 'Sample data loaded.', actor)
    return view(tenant, def)
  }

  /* ---------- Synchronisation ---------- */

  async function sync(tenant, id, { actor = 'user', ws = null } = {}) {
    const def = defOrThrow(id)
    if (!def.sync) throw new ConfigError(`${def.name} has nothing to synchronise.`)
    const conn = await connection(tenant, id)
    if (!conn) throw new ConfigError(`${def.name} is not connected.`)
    if (conn.demo) return { job: { status: 'ok', demo: true }, integration: await enableDemo(tenant, id, ws, actor) }
    if (conn.syncEnabled === false) throw new ConfigError(`Synchronisation is turned off for ${def.name}.`)
    const lock = `${tenant}:${id}`
    if (running.has(lock)) throw new ConfigError(`${def.name} is already synchronising.`)
    running.add(lock)

    const job = { id: randomToken(9), provider: id, status: 'running', startedAt: now(), actor }
    await store.put(tenant, 'integration_sync_jobs', job)
    await saveConnection(tenant, { ...conn, syncing: true })
    const adapter = ADAPTERS[id]
    try {
      const ctx = await context(tenant, conn)
      const stored = await store.get(tenant, 'integration_datasets', def.dataset)
      const previous = stored?.sealed && !stored.demo ? vault.open(stored.sealed) : null
      const incremental = Boolean(previous && adapter.incremental && conn.lastSyncAt)
      const fetched = await adapter.sync({ ...ctx, since: incremental ? conn.lastSyncAt : null })
      // An incremental pull returns only changed rows. Lists the provider was not asked for again keep their last value.
      const dataset = incremental
        ? { ...previous, ...fetched, accounts: fetched.accounts?.length ? fetched.accounts : previous.accounts, budgets: fetched.budgets?.length ? fetched.budgets : previous.budgets, ...Object.fromEntries(adapter.incremental.map((k) => [k, mergeById(previous[k], fetched[k])])) }
        : fetched
      await store.put(tenant, 'integration_datasets', { id: def.dataset, provider: id, sealed: vault.seal(dataset), asOf: dataset.asOf, demo: false })
      const summary = { counts: countsOf(dataset), changed: incremental ? countsOf(fetched) : null, incremental, warnings: dataset.warnings ?? [], unavailable: dataset.unavailable ?? [] }
      Object.assign(job, { status: 'ok', finishedAt: now(), summary })
      const fresh = (await connection(tenant, id)) ?? conn
      await saveConnection(tenant, { ...fresh, settings: { ...fresh.settings, ...ctx.settings, hint: fresh.settings?.hint }, syncing: false, lastSyncAt: dataset.asOf, lastSyncSummary: summary, lastError: null, verifiedAt: now() })
      await logEvent(tenant, id, 'sync_ok', Object.entries(summary.counts).map(([k, n]) => `${n} ${k}`).join(', '), actor)
    } catch (err) {
      const message = err instanceof ProviderError || err instanceof ConfigError ? err.message : 'Synchronisation failed.'
      if (!(err instanceof ProviderError) && !(err instanceof ConfigError)) console.error('[sync]', id, err.message)
      Object.assign(job, { status: 'error', finishedAt: now(), error: message })
      const fresh = (await connection(tenant, id)) ?? conn
      await saveConnection(tenant, { ...fresh, syncing: false, lastError: message })
      await logEvent(tenant, id, 'sync_failed', message, actor)
    } finally {
      running.delete(lock)
    }
    await store.put(tenant, 'integration_sync_jobs', job)
    return { job, integration: await view(tenant, def) }
  }

  /** Records a file import that ran in the browser, so it appears in the import history. */
  async function recordImport(tenant, { format, summary }, actor = 'user') {
    const id = format === 'xlsx' ? 'excel' : 'csv'
    const clean = { type: String(summary?.type ?? '').slice(0, 30), imported: Number(summary?.imported) || 0, skipped: Number(summary?.skipped) || 0, duplicates: Number(summary?.duplicates) || 0, fileName: String(summary?.fileName ?? '').replace(/[^\w.\- ]/g, '').slice(0, 80) }
    const job = { id: randomToken(9), provider: id, status: 'ok', startedAt: now(), finishedAt: now(), actor, summary: { counts: { [clean.type || 'records']: clean.imported }, ...clean } }
    await store.put(tenant, 'integration_sync_jobs', job)
    await saveConnection(tenant, { ...((await connection(tenant, id)) ?? { id, settings: {} }), lastSyncAt: job.finishedAt, lastSyncSummary: job.summary })
    await logEvent(tenant, id, 'import', `${clean.imported} ${clean.type} rows imported from ${clean.fileName || 'a file'}.`, actor)
    return job
  }

  /* ---------- Data for pages and agent tools ---------- */

  async function datasets(tenant) {
    const out = { finance: null, commerce: null, crm: null }
    for (const row of await store.list(tenant, 'integration_datasets')) {
      if (row.id in out) out[row.id] = row.sealed ? vault.open(row.sealed) : null
    }
    return { ...out, mappings: await store.list(tenant, 'external_record_mappings') }
  }

  async function saveMapping(tenant, input, actor = 'user') {
    const provider = ['shopify', 'salesforce', 'quickbooks'].includes(input?.provider) ? input.provider : null
    const kind = { shopify: 'product', salesforce: 'account', quickbooks: 'vendor' }[provider]
    const externalId = String(input?.externalId ?? '').slice(0, 80)
    const waymarkId = String(input?.waymarkId ?? '').slice(0, 80)
    if (!provider || !externalId || !waymarkId) throw new ConfigError('A mapping needs a provider, an external record and a Waymark record.')
    const record = {
      id: `${provider}:${kind}:${externalId}`, provider, kind, externalId, externalLabel: String(input.externalLabel ?? '').slice(0, 160),
      waymarkType: provider === 'quickbooks' ? 'supplier' : 'product', waymarkId, createdBy: actor, createdAt: now(),
    }
    for (const m of await store.list(tenant, 'external_record_mappings')) if (m.provider === provider && m.kind === kind && m.externalId === externalId) await store.remove(tenant, 'external_record_mappings', m.id)
    return store.put(tenant, 'external_record_mappings', record)
  }

  const removeMapping = (tenant, id) => store.remove(tenant, 'external_record_mappings', String(id))

  /* ---------- Channels and tracking ---------- */

  async function withAdapter(tenant, id, run) {
    const conn = await connection(tenant, id)
    if (!conn?.sealed || conn.demo) throw new ConfigError(`${integrationById(id).name} is not connected.`)
    return run(ADAPTERS[id], await context(tenant, conn), conn)
  }

  const slackChannels = (tenant) => withAdapter(tenant, 'slack', (adapter, ctx) => adapter.channels(ctx))

  /** Posts through a connected channel. A first successful post is what verifies a webhook. */
  async function send(tenant, id, message) {
    return withAdapter(tenant, id, async (adapter, ctx, conn) => {
      try {
        const result = await adapter.send(ctx, message)
        if (!conn.verifiedAt || conn.lastError) await saveConnection(tenant, { ...((await connection(tenant, id)) ?? conn), verifiedAt: now(), lastError: null, pendingNote: null })
        return result
      } catch (err) {
        if (err instanceof ProviderError) await saveConnection(tenant, { ...((await connection(tenant, id)) ?? conn), lastError: err.message })
        throw err
      }
    })
  }

  /**
   * Tracking for one shipment from the first connected logistics provider.
   * Sample tracking is returned only from a provider in Demo Mode, flagged as such.
   */
  async function track(tenant, shipment) {
    const tried = []
    for (const id of TRACKING_PROVIDERS) {
      const conn = await connection(tenant, id)
      if (!conn) continue
      if (conn.demo) return { available: true, tracking: demoTracking(id, shipment) }
      if (!conn.sealed || !conn.verifiedAt) continue
      const adapter = ADAPTERS[id]
      if (!adapter.identifiers(shipment)) {
        tried.push(`${integrationById(id).name}: this shipment has no identifier it can look up`)
        continue
      }
      try {
        const tracking = await adapter.track(await context(tenant, conn), shipment)
        if (tracking) return { available: true, tracking }
        tried.push(`${integrationById(id).name}: no record found`)
      } catch (err) {
        tried.push(`${integrationById(id).name}: ${err instanceof ProviderError ? err.message : 'lookup failed'}`)
      }
    }
    return { available: false, reason: tried.length ? tried.join('; ') : 'No tracking provider is connected. Shipment status comes from your own records.' }
  }

  /** Maps an incoming Shopify webhook to the workspace that owns the shop, and marks its data stale. */
  async function shopifyWebhook(shop, topic) {
    for (const tenant of await store.tenants()) {
      const conn = await connection(tenant, 'shopify')
      if (conn?.settings?.shop === shop && !conn.demo) {
        await saveConnection(tenant, { ...conn, stale: true })
        await logEvent(tenant, 'shopify', 'webhook', `Shopify reported "${String(topic).slice(0, 60)}". Data marked for refresh.`, 'shopify')
        return true
      }
    }
    return false
  }

  return {
    redirectUri,
    list: async (tenant) => Promise.all(INTEGRATIONS.map((def) => view(tenant, def))),
    get: (tenant, id) => view(tenant, defOrThrow(id)),
    connect, oauthCallback, test, configure, disconnect, enableDemo, sync, recordImport,
    datasets, saveMapping, removeMapping,
    llmProvider, slackChannels, send, track, shopifyWebhook,
    isConnected: async (tenant, id) => ['connected', 'demo'].includes((await view(tenant, defOrThrow(id))).status),
    statusOf: async (tenant, id) => (await view(tenant, defOrThrow(id))).status,
    events: async (tenant, id) => (await store.list(tenant, 'integration_events')).filter((e) => !id || e.provider === id).reverse().slice(0, 50),
    jobs: async (tenant, id) => (await store.list(tenant, 'integration_sync_jobs')).filter((j) => !id || j.provider === id).reverse().slice(0, 30),
  }
}
