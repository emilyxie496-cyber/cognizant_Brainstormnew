/*
  One small client for several AI providers. It uses only `fetch`, so the same
  file runs in Node and in a Supabase Edge Function, with no SDK.

  Two wire formats are supported:
  - "openai": any OpenAI-compatible /chat/completions endpoint (Groq, Gemini's
    compatibility endpoint, OpenRouter, Ollama and others).
  - "anthropic": the Anthropic Messages API.

  Model names always come from configuration. None are hard-coded here, because
  provider line-ups and free allowances change.
*/

export class LlmError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

/** The configured providers, in the order they are tried. A provider needs a key and a model. */
export function providersFrom(config) {
  const list = [
    { name: 'primary', kind: 'openai', baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel },
    { name: 'fallback', kind: 'openai', baseUrl: config.llmFallbackBaseUrl, apiKey: config.llmFallbackApiKey, model: config.llmFallbackModel },
    { name: 'anthropic', kind: 'anthropic', baseUrl: config.anthropicBaseUrl || 'https://api.anthropic.com', apiKey: config.anthropicKey, model: config.anthropicModel },
  ]
  return list.filter((p) => p.apiKey && p.model && p.baseUrl)
}

const trimSlash = (url) => url.replace(/\/+$/, '')

async function send(url, init, timeoutMs, fetchImpl) {
  let res
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new LlmError(err?.name === 'TimeoutError' ? 'The AI provider timed out.' : 'The AI provider could not be reached.', { retryable: true })
  }
  if (!res.ok) {
    // 429 (quota) and 5xx are worth trying on the next provider. 4xx config errors are too: another provider may be set up correctly.
    throw new LlmError(`The AI provider responded ${res.status}.`, { status: res.status, retryable: true })
  }
  try {
    return await res.json()
  } catch {
    throw new LlmError('The AI provider returned an unreadable reply.', { retryable: true })
  }
}

/** One completion from one provider. Resolves to { text, model, provider }. */
export async function chat(provider, { system, user, json = false, maxTokens = 700, timeoutMs = 30_000 }, fetchImpl = fetch) {
  if (provider.kind === 'anthropic') {
    const data = await send(
      `${trimSlash(provider.baseUrl)}/v1/messages`,
      {
        method: 'POST',
        headers: { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: maxTokens,
          system: json ? `${system}\nReply with one JSON object and nothing else.` : system,
          messages: [{ role: 'user', content: user }],
        }),
      },
      timeoutMs,
      fetchImpl,
    )
    if (data?.stop_reason === 'refusal') throw new LlmError('The AI provider declined the request.')
    const text = (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    return { text, model: data?.model ?? provider.model, provider: provider.name }
  }

  const data = await send(
    `${trimSlash(provider.baseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    },
    timeoutMs,
    fetchImpl,
  )
  return { text: String(data?.choices?.[0]?.message?.content ?? '').trim(), model: data?.model ?? provider.model, provider: provider.name }
}

/** Tries each provider once, in order. Throws the last error when all fail. */
export async function chatWithFallback(providers, request, fetchImpl = fetch) {
  let last = new LlmError('No AI provider is configured.')
  for (const provider of providers) {
    try {
      const reply = await chat(provider, request, fetchImpl)
      if (reply.text) return reply
      last = new LlmError('The AI provider returned an empty reply.', { retryable: true })
    } catch (err) {
      last = err instanceof LlmError ? err : new LlmError('The AI provider failed.', { retryable: true })
    }
  }
  throw last
}

/** Reads a JSON object out of a model reply, tolerating a code fence around it. */
export function parseJsonReply(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}
