/*
  Supabase Edge Function that serves Waymark's AI and news routes when the app
  is hosted without the Node API (for example on Lovable).

  It reuses the same handlers as server/app.js, from ../_shared. Point the
  front end at it with:
    VITE_API_BASE=https://<project-ref>.supabase.co/functions/v1/waymark-api

  Routes: GET /health, GET /news?category=, POST /agent/delay, POST /analyst.
  Any other route returns 404, and the app falls back to its built-in data.

  Secrets are read from the function's environment (supabase secrets set ...):
    LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_FALLBACK_*, ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL, ALLOWED_ORIGINS.

  NOTE: this file has not been run by the Waymark test suite, which uses Node.
  Deploy with `supabase functions deploy waymark-api --no-verify-jwt` and check
  /health before relying on it.
*/
// @ts-nocheck: the shared handlers are plain JavaScript.
import { handleAnalyst, handleDelayAgent } from '../_shared/agent.js'
import { memoryCache } from '../_shared/grounding.js'
import { providersFrom } from '../_shared/llm.js'
import { NEWS_CATEGORIES, fetchWorldNews } from '../_shared/news.js'

const env = (name: string) => Deno.env.get(name) ?? ''
const config = {
  llmBaseUrl: env('LLM_BASE_URL'),
  llmApiKey: env('LLM_API_KEY'),
  llmModel: env('LLM_MODEL'),
  llmFallbackBaseUrl: env('LLM_FALLBACK_BASE_URL'),
  llmFallbackApiKey: env('LLM_FALLBACK_API_KEY'),
  llmFallbackModel: env('LLM_FALLBACK_MODEL'),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  anthropicBaseUrl: env('ANTHROPIC_BASE_URL'),
  anthropicModel: env('ANTHROPIC_MODEL'),
  newsBaseUrl: env('NEWS_BASE_URL') || 'https://news.google.com',
  gdeltBaseUrl: env('GDELT_BASE_URL') || 'https://api.gdeltproject.org',
  upstreamTimeoutMs: 10_000,
}
const allowedOrigins = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean)
const providers = providersFrom(config)
const aiCache = memoryCache(24 * 3_600_000)
const newsCache = memoryCache(15 * 60_000, 50)

function cors(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  // With no list configured, any origin may call. Set ALLOWED_ORIGINS to your site in production.
  const allow = !allowedOrigins.length ? '*' : allowedOrigins.includes(origin) ? origin : ''
  return {
    ...(allow ? { 'Access-Control-Allow-Origin': allow, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-waymark-preview-plan',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

/** The caller's user id from a Supabase JWT, used only to keep cached answers separate. Not an authorization check. */
function scopeOf(req: Request) {
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.sub === 'string' ? payload.sub : 'anon'
  } catch {
    return 'anon'
  }
}

Deno.serve(async (req: Request) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  const url = new URL(req.url)
  const route = url.pathname.replace(/^.*\/waymark-api/, '') || '/'
  try {
    if (req.method === 'GET' && route === '/health') {
      return json(200, { ok: true, integrations: { ai: providers.length > 0, news: true, climatiq: false, supabase: true, tracking: false } })
    }
    if (req.method === 'GET' && route === '/news') {
      const id = NEWS_CATEGORIES.some((c) => c.id === url.searchParams.get('category')) ? url.searchParams.get('category') : 'trade'
      const cached = newsCache.get(id)
      if (cached) return json(200, cached)
      try {
        const news = await fetchWorldNews(config, id)
        newsCache.set(id, news)
        return json(200, news)
      } catch (err) {
        return json(502, { error: 'news_unavailable', message: err.message })
      }
    }
    if (req.method === 'POST' && (route === '/agent/delay' || route === '/analyst')) {
      const body = await req.json().catch(() => null)
      const deps = { providers, cache: aiCache, fetchImpl: fetch, scope: scopeOf(req) }
      const result = route === '/analyst' ? await handleAnalyst(body, deps) : await handleDelayAgent(body, deps)
      return json(result.status, result.body)
    }
    return json(404, { error: 'not_found', message: 'Unknown API route.' })
  } catch (err) {
    console.error('[waymark-api]', err)
    return json(500, { error: 'internal_error', message: 'Something went wrong on the server.' })
  }
})
