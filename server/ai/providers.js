/*
  One interface over four AI providers, for the Agent Hub's tool-calling loop.

    Claude (Anthropic)  the official SDK, Messages API
    OpenAI GPT          Chat Completions
    Google Gemini       Gemini's OpenAI-compatible endpoint
    Grok (xAI)          xAI's OpenAI-compatible endpoint

  The orchestrator only sees a conversation object:
    const chat = openConversation(provider, { system, user, fetchImpl })
    const turn = await chat.turn({ tools, maxTokens, onText })   // { text, toolCalls, stopReason, usage, model }
    chat.addToolResults([{ id, name, content, isError }])

  Each conversation keeps the provider's own message format, so anything the
  provider needs echoed back (Claude's thinking blocks, Gemini's signatures on
  tool calls) is returned untouched.

  Keys live in server configuration or, sealed, in the workspace's connection.
  They are never sent to the browser. Model ids always come from configuration
  or from the provider's own model list: only Claude has a default.
*/
import Anthropic from '@anthropic-ai/sdk'

export class LlmError extends Error {
  constructor(message, { code = 'llm_error', status = 0, retryable = false } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

export const LLM_PROVIDERS = {
  anthropic: { id: 'anthropic', label: 'Claude', vendor: 'Anthropic', kind: 'anthropic', key: 'anthropicKey', model: 'anthropicModel', base: 'anthropicBaseUrl', capabilities: { tools: true, streaming: true, json: true, usage: true } },
  openai: { id: 'openai', label: 'OpenAI GPT', vendor: 'OpenAI', kind: 'openai', key: 'openaiKey', model: 'openaiModel', base: 'openaiBaseUrl', tokenParam: 'max_completion_tokens', capabilities: { tools: true, streaming: true, json: true, usage: true } },
  gemini: { id: 'gemini', label: 'Google Gemini', vendor: 'Google', kind: 'openai', key: 'geminiKey', model: 'geminiModel', base: 'geminiBaseUrl', tokenParam: 'max_tokens', capabilities: { tools: true, streaming: true, json: true, usage: true } },
  xai: { id: 'xai', label: 'Grok', vendor: 'xAI', kind: 'openai', key: 'xaiKey', model: 'xaiModel', base: 'xaiBaseUrl', tokenParam: 'max_tokens', capabilities: { tools: true, streaming: true, json: true, usage: true } },
}

/**
 * The effective settings for one provider. A key or model saved in the
 * workspace wins over the server's. `missing` lists what still has to be set.
 */
export function resolveProvider(config, id, workspace = null) {
  const def = LLM_PROVIDERS[id]
  if (!def) return null
  const apiKey = workspace?.apiKey || config[def.key] || ''
  const model = workspace?.model || config[def.model] || ''
  const missing = [...(apiKey ? [] : ['API key']), ...(model ? [] : ['model'])]
  return {
    ...def,
    apiKey,
    model,
    baseUrl: (config[def.base] || '').replace(/\/+$/, ''),
    keySource: workspace?.apiKey ? 'workspace' : config[def.key] ? 'server' : null,
    configured: missing.length === 0,
    missing,
  }
}

const trim = (text, max = 200) => String(text ?? '').replace(/\s+/g, ' ').slice(0, max)

/* ---------- Claude ---------- */

const anthropicClient = (provider, fetchImpl) =>
  new Anthropic({ apiKey: provider.apiKey, baseURL: provider.baseUrl || undefined, timeout: 90_000, maxRetries: 1, ...(fetchImpl ? { fetch: fetchImpl } : {}) })

// The models that accept the server-side refusal fallback and the effort control.
const FALLBACK_MODELS = /^claude-(fable-5|mythos-5|opus-5|sonnet-5-5)/
const EFFORT_MODELS = /^claude-(fable|mythos|opus|sonnet|haiku)-5|^claude-(opus|sonnet)-4-[678]/

function anthropicError(err) {
  if (err instanceof LlmError) return err
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new LlmError('Claude rejected the API key.', { code: 'unauthorized', status: err.status })
  if (err instanceof Anthropic.NotFoundError) return new LlmError('Claude does not recognise the configured model.', { code: 'model_not_found', status: 404 })
  if (err instanceof Anthropic.RateLimitError) return new LlmError('Claude is rate limiting requests. Try again shortly.', { code: 'rate_limited', status: 429, retryable: true })
  if (err instanceof Anthropic.BadRequestError) return new LlmError(`Claude rejected the request: ${trim(err.message)}`, { code: 'bad_request', status: 400 })
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('Claude could not be reached.', { code: 'unreachable', retryable: true })
  if (err instanceof Anthropic.APIError) return new LlmError(`Claude responded ${err.status ?? 'with an error'}.`, { code: 'provider_error', status: err.status ?? 0, retryable: (err.status ?? 0) >= 500 })
  return new LlmError('Claude returned an unreadable reply.', { code: 'bad_response', retryable: true })
}

function anthropicConversation(provider, { system, user, fetchImpl, effort }) {
  const client = anthropicClient(provider, fetchImpl)
  const messages = [{ role: 'user', content: user }]
  const withFallback = FALLBACK_MODELS.test(provider.model)
  // Eager input streaming is skipped behind a custom base URL, where a proxy may reject the field.
  const eager = !provider.baseUrl

  return {
    async turn({ tools = [], maxTokens = 4096, onText }) {
      const params = {
        model: provider.model,
        max_tokens: maxTokens,
        system,
        messages,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, ...(eager ? { eager_input_streaming: true } : {}) })),
        ...(effort && EFFORT_MODELS.test(provider.model) ? { output_config: { effort } } : {}),
        // A safety decline is re-run by the API on a fallback model, inside the same call.
        ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      }
      let message
      try {
        const stream = (withFallback ? client.beta.messages : client.messages).stream(params)
        if (onText) stream.on('text', onText)
        message = await stream.finalMessage()
      } catch (err) {
        throw anthropicError(err)
      }
      messages.push({ role: 'assistant', content: message.content })
      const usage = { inputTokens: message.usage?.input_tokens ?? 0, outputTokens: message.usage?.output_tokens ?? 0 }
      const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      if (message.stop_reason === 'refusal') return { text, toolCalls: [], stopReason: 'refusal', usage, model: message.model }
      const toolCalls = message.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
      // A tool input cut off at the token limit can still parse, so it is never run.
      if (message.stop_reason === 'max_tokens' && toolCalls.length) throw new LlmError('The reply was cut off while a tool call was being written.', { code: 'truncated' })
      return { text, toolCalls, stopReason: toolCalls.length ? 'tool_use' : message.stop_reason === 'max_tokens' ? 'max_tokens' : 'end', usage, model: message.model }
    },
    addToolResults(results) {
      // Every result of a turn goes back in one user message.
      messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })) })
    },
  }
}

async function verifyAnthropic(provider, fetchImpl) {
  const client = anthropicClient(provider, fetchImpl)
  try {
    const models = []
    for await (const m of client.models.list({ limit: 100 })) {
      models.push(m.id)
      if (models.length >= 100) break
    }
    return models
  } catch (err) {
    throw anthropicError(err)
  }
}

/* ---------- OpenAI-compatible (OpenAI, Gemini, Grok) ---------- */

async function openaiFetch(provider, path, init, fetchImpl, timeoutMs = 90_000) {
  let res
  try {
    res = await (fetchImpl ?? fetch)(`${provider.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json', ...init?.headers }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new LlmError(err?.name === 'TimeoutError' ? `${provider.label} timed out.` : `${provider.label} could not be reached.`, { code: 'unreachable', retryable: true })
  }
  if (res.ok) return res
  let detail = ''
  try {
    const body = await res.json()
    detail = '' // Error bodies may echo credentials or business inputs.
  } catch {
    detail = ''
  }
  if (res.status === 401 || res.status === 403) throw new LlmError(`${provider.label} rejected the API key.`, { code: 'unauthorized', status: res.status })
  if (res.status === 404) throw new LlmError(`${provider.label} does not recognise the configured model.`, { code: 'model_not_found', status: 404 })
  if (res.status === 429) throw new LlmError(`${provider.label} is rate limiting requests or the quota is used up.`, { code: 'rate_limited', status: 429, retryable: true })
  throw new LlmError(`${provider.label} responded ${res.status}${detail ? `: ${detail}` : '.'}`, { code: res.status === 400 ? 'bad_request' : 'provider_error', status: res.status, retryable: res.status >= 500 })
}

/** Reads a streamed chat completion into one message, calling onText for each text delta. */
async function readOpenAiStream(res, onText) {
  const decoder = new TextDecoder()
  const calls = []
  let buffer = ''
  let content = ''
  let usage = null
  let model = null
  let finish = null
  const handle = (line) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    let chunk
    try {
      chunk = JSON.parse(data)
    } catch {
      return
    }
    if (chunk.usage) usage = chunk.usage
    model ??= chunk.model ?? null
    const choice = chunk.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) finish = choice.finish_reason
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      onText?.(delta.content)
    }
    for (const part of delta.tool_calls ?? []) {
      const slot = (calls[part.index ?? calls.length] ??= { id: '', type: 'function', function: { name: '', arguments: '' } })
      if (part.id) slot.id = part.id
      if (part.function?.name) slot.function.name += part.function.name
      if (part.function?.arguments) slot.function.arguments += part.function.arguments
      // Anything else a provider attaches to a tool call is kept and sent back as it came.
      if (part.extra_content) slot.extra_content = part.extra_content
    }
  }
  for await (const piece of res.body) {
    buffer += decoder.decode(piece, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop()
    lines.forEach(handle)
  }
  if (buffer) handle(buffer)
  return { message: { role: 'assistant', content: content || null, ...(calls.filter(Boolean).length ? { tool_calls: calls.filter(Boolean) } : {}) }, usage, model, finish }
}

function openaiConversation(provider, { system, user, fetchImpl }) {
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
  let streaming = provider.capabilities.streaming

  return {
    async turn({ tools = [], maxTokens = 4096, onText, json = false }) {
      const base = {
        model: provider.model,
        messages,
        [provider.tokenParam]: maxTokens,
        ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }
      let out
      if (streaming) {
        try {
          const res = await openaiFetch(provider, '/chat/completions', { method: 'POST', body: JSON.stringify({ ...base, stream: true, stream_options: { include_usage: true } }) }, fetchImpl)
          out = await readOpenAiStream(res, onText)
        } catch (err) {
          // Some compatible endpoints reject streaming options. Fall back to a plain request, once.
          if (!(err instanceof LlmError) || err.code !== 'bad_request') throw err
          streaming = false
        }
      }
      if (!out) {
        const res = await openaiFetch(provider, '/chat/completions', { method: 'POST', body: JSON.stringify(base) }, fetchImpl)
        const body = await res.json().catch(() => null)
        const choice = body?.choices?.[0]
        if (!choice?.message) throw new LlmError(`${provider.label} returned an unreadable reply.`, { code: 'bad_response', retryable: true })
        out = { message: { role: 'assistant', content: choice.message.content ?? null, ...(choice.message.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : {}) }, usage: body.usage, model: body.model, finish: choice.finish_reason }
        if (out.message.content) onText?.(out.message.content)
      }
      messages.push(out.message)
      const toolCalls = []
      for (const c of out.message.tool_calls ?? []) {
        let input = null
        try {
          input = c.function.arguments ? JSON.parse(c.function.arguments) : {}
        } catch {
          input = null // reported to the model as an invalid call by the orchestrator
        }
        toolCalls.push({ id: c.id, name: c.function.name, input })
      }
      if (out.finish === 'length' && toolCalls.length) throw new LlmError('The reply was cut off while a tool call was being written.', { code: 'truncated' })
      return {
        text: String(out.message.content ?? '').trim(),
        toolCalls,
        stopReason: toolCalls.length ? 'tool_use' : out.finish === 'content_filter' ? 'refusal' : out.finish === 'length' ? 'max_tokens' : 'end',
        usage: { inputTokens: out.usage?.prompt_tokens ?? 0, outputTokens: out.usage?.completion_tokens ?? 0 },
        model: out.model ?? provider.model,
      }
    },
    addToolResults(results) {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content })
    },
  }
}

async function verifyOpenAi(provider, fetchImpl) {
  const res = await openaiFetch(provider, '/models', { method: 'GET' }, fetchImpl, 15_000)
  const body = await res.json().catch(() => null)
  return (body?.data ?? []).map((m) => String(m.id ?? '').replace(/^models\//, '')).filter(Boolean)
}

/* ---------- Public surface ---------- */

export function openConversation(provider, options) {
  if (!provider?.configured) throw new LlmError(`${provider?.label ?? 'The AI provider'} needs ${provider?.missing?.join(' and ') ?? 'configuration'}.`, { code: 'not_configured' })
  return provider.kind === 'anthropic' ? anthropicConversation(provider, options) : openaiConversation(provider, options)
}

/**
 * Proves a key works by listing the provider's models, and checks the chosen
 * model is among them. Resolves to { models, modelOk }. Throws LlmError when
 * the key is rejected or the provider cannot be reached.
 */
export async function verifyProvider(provider, fetchImpl) {
  if (!provider.apiKey) throw new LlmError(`${provider.label} has no API key.`, { code: 'not_configured' })
  const models = provider.kind === 'anthropic' ? await verifyAnthropic(provider, fetchImpl) : await verifyOpenAi(provider, fetchImpl)
  return { models: models.sort(), modelOk: provider.model ? (models.length ? models.includes(provider.model) : null) : false }
}

// Ids that are not general chat models: embeddings, speech, images and other special-purpose endpoints.
const NOT_CHAT = /embed|whisper|tts|speech|audio|dall|image|imagen|veo|video|realtime|live|moderation|transcri|search|instruct|codex|davinci|babbage|aqa|gemma|learnlm|robotics|computer-use|vision|guard|rerank/i
// What to prefer for each provider, best first. Only the shape of an id is assumed, never a version.
const PREFERRED = {
  anthropic: [/^claude-opus-[\d-]+$/, /^claude-sonnet-[\d-]+$/, /^claude-/],
  openai: [/^gpt-[\d.]+$/, /^gpt-[\d.]+-mini$/, /^gpt-[\d.]+o$/, /^gpt-/, /^o\d/],
  gemini: [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-pro$/, /^gemini-flash-latest$/, /^gemini-[\d.]+-flash/, /^gemini-[\d.]+-pro/, /^gemini-/],
  xai: [/^grok-[\d.]+$/, /^grok-[\d.]+-fast/, /^grok-[\d.]+/, /^grok-/],
}

/**
 * Chooses a model from the list a provider's own key returned, so a user only
 * has to enter a key. Takes the newest id of the most general-purpose family.
 * Returns '' when the list holds nothing usable.
 */
export function pickModel(providerId, models) {
  const usable = (models ?? []).filter((m) => !NOT_CHAT.test(m))
  const newestFirst = (list) => [...list].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  for (const pattern of PREFERRED[providerId] ?? []) {
    const match = newestFirst(usable.filter((m) => pattern.test(m)))
    if (match.length) return match[0]
  }
  return newestFirst(usable)[0] ?? ''
}
