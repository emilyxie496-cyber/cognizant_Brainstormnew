/*
  Tenant-scoped server state: integration connections, synced datasets, agent
  runs, alerts, approvals and deliveries.

  Every call names a tenant, and no call can reach another tenant's rows. Two
  back ends share one interface:

  - File store (default): kept in memory and written to <dataDir>/store.json.
    Anything sensitive is sealed by the caller before it gets here.
  - Supabase store: used for signed-in companies when SUPABASE_SERVICE_ROLE_KEY
    is set. Rows land in the tables created by migration 0002, which carry
    row-level security for direct reads.

  Anonymous demo and local workspaces always use the file store, because they
  have no company row to hang records on.
*/
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Log-like collections are capped so a busy tenant cannot grow without bound.
const CAPS = { agent_runs: 100, agent_tool_calls: 1500, integration_sync_jobs: 200, integration_events: 300, risk_alerts: 400, notification_deliveries: 400, approval_requests: 300 }

export function createFileStore({ dataDir } = {}) {
  const file = dataDir ? path.join(dataDir, 'store.json') : null
  let data = {}
  if (file) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error('The integration store cannot be read. Restore or repair it before starting Waymark.')
    }
  }
  let timer = null
  const flush = () => {
    timer = null
    if (!file) return
    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify(data))
      renameSync(`${file}.tmp`, file)
    } catch (err) {
      console.error('[store] could not persist state:', err.message)
      throw new Error('Integration state could not be persisted. Check the server data volume.')
    }
  }
  const touch = () => {
    if (file) flush()
  }
  const rows = (tenant, collection) => ((data[tenant] ??= {})[collection] ??= [])

  return {
    kind: 'file',
    async list(tenant, collection) {
      return [...rows(tenant, collection)]
    },
    async get(tenant, collection, id) {
      return rows(tenant, collection).find((r) => r.id === id) ?? null
    },
    async put(tenant, collection, record) {
      const list = rows(tenant, collection)
      const index = list.findIndex((r) => r.id === record.id)
      if (index >= 0) list[index] = record
      else {
        list.push(record)
        const cap = CAPS[collection]
        if (cap && list.length > cap) list.splice(0, list.length - cap)
      }
      touch()
      return record
    },
    async remove(tenant, collection, id) {
      const list = rows(tenant, collection)
      const index = list.findIndex((r) => r.id === id)
      if (index >= 0) list.splice(index, 1)
      touch()
    },
    async tenants() {
      return Object.keys(data)
    },
    flush,
  }
}

// Columns promoted out of `details` so they can be indexed and read under row-level security.
const PROMOTED = {
  integration_connections: { provider: 'id', status: 'status' },
  integration_sync_jobs: { provider: 'provider', status: 'status' },
  integration_datasets: { provider: 'id' },
  external_record_mappings: { provider: 'provider', external_id: 'externalId' },
  integration_events: { provider: 'provider', event_type: 'type' },
  agent_runs: { status: 'status', trigger: 'trigger' },
  agent_tool_calls: { run_id: 'runId', tool: 'name', status: 'status' },
  risk_alerts: { dedupe_key: 'key', category: 'category', level: 'level' },
  notification_preferences: { channel: 'id' },
  notification_deliveries: { channel: 'channel', status: 'status' },
  approval_requests: { status: 'status', action_type: 'type' },
  platform_settings: {},
}

/** Rows for one company. `client` must use the service role: these tables hold sealed credentials. */
export function createSupabaseStore(client) {
  const must = ({ data, error }) => {
    if (error) throw new Error(`Supabase store: ${error.message}`)
    return data
  }
  const toRow = (companyId, collection, record) => {
    const row = { id: String(record.id), company_id: companyId, details: record, updated_at: new Date().toISOString() }
    for (const [column, field] of Object.entries(PROMOTED[collection] ?? {})) row[column] = record[field] ?? null
    return row
  }
  const companyOf = (tenant) => tenant.slice(3)

  return {
    kind: 'supabase',
    async planOf(tenant) {
      const row = must(await client.from('companies').select('plan').eq('id', companyOf(tenant)).maybeSingle())
      return row?.plan ?? 'free'
    },
    async list(tenant, collection) {
      const data = must(await client.from(collection).select('details').eq('company_id', companyOf(tenant)).order('updated_at', { ascending: true }).limit(CAPS[collection] ?? 1000))
      return data.map((r) => r.details)
    },
    async get(tenant, collection, id) {
      const data = must(await client.from(collection).select('details').eq('company_id', companyOf(tenant)).eq('id', String(id)).maybeSingle())
      return data?.details ?? null
    },
    async put(tenant, collection, record) {
      must(await client.from(collection).upsert(toRow(companyOf(tenant), collection, record), { onConflict: 'company_id,id' }))
      return record
    },
    async remove(tenant, collection, id) {
      must(await client.from(collection).delete().eq('company_id', companyOf(tenant)).eq('id', String(id)))
    },
    async tenants() {
      const data = must(await client.from('platform_settings').select('company_id').eq('id', 'monitor_snapshot'))
      return [...new Set(data.map(r => `co:${r.company_id}`))]
    },
    flush() {},
  }
}

/** Company tenants ("co:<uuid>") go to Supabase when it is available; everything else stays local. */
export function createStore(config) {
  const local = config.store ?? createFileStore({ dataDir: config.dataDir })
  const remote =
    config.supabaseUrl && config.supabaseServiceKey
      ? createSupabaseStore(createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } }))
      : null
  const pick = (tenant) => (remote && tenant.startsWith('co:') ? remote : local)
  return {
    kind: remote ? 'supabase+file' : 'file',
    planOf: (tenant, fallback = 'free') => remote && tenant.startsWith('co:') ? remote.planOf(tenant) : Promise.resolve(fallback),
    list: (tenant, collection) => pick(tenant).list(tenant, collection),
    get: (tenant, collection, id) => pick(tenant).get(tenant, collection, id),
    put: (tenant, collection, record) => pick(tenant).put(tenant, collection, record),
    remove: (tenant, collection, id) => pick(tenant).remove(tenant, collection, id),
    tenants: async () => [...new Set([...(await local.tenants()), ...(remote ? await remote.tenants() : [])])],
    flush: () => local.flush(),
  }
}
