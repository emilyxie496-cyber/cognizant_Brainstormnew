// Thin client for the Waymark API. All third-party calls go through the server.

export class ApiError extends Error {
  constructor(message, { status, code, detail } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

// Same-origin /api by default. A static host sets VITE_API_BASE to wherever the API runs.
const API_BASE = (import.meta.env?.VITE_API_BASE || '/api').replace(/\/+$/, '')

let sessionHeaders = () => ({})

/** The workspace provider registers how to identify the caller (token or preview plan). */
export const setSessionHeaders = (fn) => {
  sessionHeaders = fn
}

async function request(path, { method = 'GET', body, timeoutMs = 20_000 } = {}) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...sessionHeaders() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new ApiError(err.name === 'TimeoutError' ? 'The request timed out.' : 'The Waymark API is unreachable.', { status: 0, code: 'network' })
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.message ?? `Request failed (${res.status})`, { status: res.status, code: data?.error, detail: data?.detail })
  return data
}

const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()

const send = (method) => (path, body, timeoutMs = 30_000) => request(path, { method, body: body ?? {}, timeoutMs })
const post = send('POST')
const put = send('PUT')
const patch = send('PATCH')
const del = (path) => request(path, { method: 'DELETE' })

/**
 * POST that reads a server-sent event stream. `onEvent(name, payload)` is called
 * for each event as it arrives. Resolves with the payload of the final "done" event.
 */
async function stream(path, body, onEvent, timeoutMs = 180_000) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...sessionHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new ApiError(err.name === 'TimeoutError' ? 'The request timed out.' : 'The Waymark API is unreachable.', { status: 0, code: 'network' })
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(data?.message ?? `Request failed (${res.status})`, { status: res.status, code: data?.error })
    onEvent('done', data?.run)
    return data?.run
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = null
  const flush = (block) => {
    const event = /^event: (.*)$/m.exec(block)?.[1]
    const data = /^data: (.*)$/m.exec(block)?.[1]
    if (!event || !data) return
    let payload
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (event === 'done') done = payload
    onEvent(event, payload)
  }
  try {
    for (;;) {
      const { value, done: finished } = await reader.read()
      if (finished) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop()
      blocks.forEach(flush)
    }
    buffer += decoder.decode()
    if (buffer.trim()) flush(buffer)
  } catch {
    throw new ApiError('The connection was lost before the investigation finished.', { status: 0, code: 'network' })
  }
  if (!done) throw new ApiError('The investigation ended without a result.', { status: 0, code: 'incomplete' })
  return done
}

/** Waymark 3.0: integrations, business data, the agent, monitoring, approvals and notifications. */
export const platform = {
  summary: () => request('/platform/summary', { timeoutMs: 30_000 }),
  integrations: () => request('/integrations', { timeoutMs: 30_000 }),
  connect: (id, input) => post(`/integrations/${id}/connect`, input),
  test: (id) => post(`/integrations/${id}/test`),
  sync: (id, payload) => post(`/integrations/${id}/sync`, payload, 60_000),
  demo: (id, payload) => post(`/integrations/${id}/demo`, payload),
  configure: (id, changes) => patch(`/integrations/${id}`, changes),
  disconnect: (id) => del(`/integrations/${id}`),
  activity: (id) => request(`/integrations/${id}/activity`),
  slackChannels: () => request('/integrations/slack/channels'),
  logImport: (format, summary) => post('/integrations/import-log', { format, summary }),
  businessData: () => request('/business/data'),
  saveMapping: (mapping) => post('/business/mappings', mapping),
  removeMapping: (id) => del(`/business/mappings/${encodeURIComponent(id)}`),
  track: (shipment) => post('/logistics/track', { shipment }),
  aiProviders: () => request('/ai/providers', { timeoutMs: 30_000 }),
  saveSettings: (changes) => put('/settings', changes),
  runAgent: (payload, onEvent) => stream('/agent/run', payload, onEvent),
  runs: () => request('/agent/runs'),
  run: (id) => request(`/agent/runs/${id}`),
  monitor: () => request('/monitor'),
  runMonitor: (payload) => post('/monitor/run', payload, 120_000),
  setAlert: (id, status) => post(`/monitor/alerts/${id}`, { status }),
  approvals: () => request('/approvals'),
  decide: (id, decision, note) => post(`/approvals/${id}/decision`, { decision, note }),
  notifications: () => request('/notifications'),
  saveNotifications: (channel, changes) => put(`/notifications/${channel}`, changes),
  testNotification: (channel) => post(`/notifications/${channel}/test`),
}

export const api = {
  health: () => request('/health', { timeoutMs: 5000 }),
  fx: () => request('/fx'),
  weather: (lat, lon) => request(`/weather?${query({ lat, lon })}`),
  geocode: (q, country) => request(`/geocode?${query({ q, country })}`),
  aircraft: (lat, lon) => request(`/aircraft?${query({ lat, lon })}`),
  searchSuppliers: (q) => request(`/suppliers/search?${query({ q })}`),
  freightEmissions: (legs, weightKg) => {
    const compact = legs.map(({ mode, from, to }) => ({ mode, from, to }))
    return request('/emissions/freight', { method: 'POST', body: { legs: compact, weightKg }, timeoutMs: 25_000 })
  },
  explain: (facts) => request('/explain', { method: 'POST', body: { facts }, timeoutMs: 40_000 }),
  trackingLookup: (reference) => request('/tracking/lookup', { method: 'POST', body: { reference } }),
  agentDelay: (body) => request('/agent/delay', { method: 'POST', body, timeoutMs: 40_000 }),
  analyst: (body) => request('/analyst', { method: 'POST', body, timeoutMs: 45_000 }),
  news: (category) => request(`/news?${query({ category })}`, { timeoutMs: 25_000 }),
}
