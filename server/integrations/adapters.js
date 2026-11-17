/*
  Provider adapters. Each one owns a single provider's authentication, request
  shapes and error handling, and returns records already normalised.

  An adapter never decides that a connection is healthy: `test` either returns
  proof (an account name, a model list) or throws. The service turns that into a
  status. Error messages are written for the user and never contain a secret.

  ctx: { config, secret, settings, fetchImpl, saveSecret(next), since }
*/
import { shopifyApiVersion } from '../../shared/integrations.js'
import { NEWS_CATEGORIES, fetchWorldNews } from '../../supabase/functions/_shared/news.js'
import { hmacSha256, pkceChallenge, safeEqual } from '../crypto.js'
import { normalizeMarineTraffic, normalizeProject44, normalizeQuickBooks, normalizeSalesforce, normalizeShopify } from './normalize.js'

export class ProviderError extends Error {
  constructor(message, { status = 0, code = 'provider_error', retryable = false } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}
export class ConfigError extends Error {}

const SAFE_DETAIL = (body) => {
  const raw = body?.error_description ?? body?.error?.message ?? body?.Fault?.Error?.[0]?.Detail ?? body?.Fault?.Error?.[0]?.Message ?? body?.[0]?.message ?? body?.errors?.[0]?.message ?? body?.message ?? (typeof body?.error === 'string' ? body.error : null)
  return raw ? String(raw).slice(0, 200) : null
}

/** One provider request: timeout, one retry on network errors and 5xx, JSON or text out. */
export async function call(ctx, url, { method = 'GET', headers = {}, body, form, name = 'The provider', retries = method === 'GET' ? 1 : 0, raw = false } = {}) {
  const init = { method, redirect: 'error', headers: { Accept: 'application/json', ...headers } }
  if (form) {
    init.body = new URLSearchParams(form).toString()
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    init.headers['Content-Type'] ??= 'application/json'
  }
  let last
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res
    try {
      res = await (ctx.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(ctx.config.upstreamTimeoutMs ?? 10_000) })
    } catch (err) {
      last = new ProviderError(err?.name === 'TimeoutError' ? `${name} timed out.` : `${name} could not be reached.`, { code: 'unreachable', retryable: true })
      continue
    }
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    if (res.ok) return raw ? { status: res.status, text, data } : data ?? text
    // Provider error bodies may echo request credentials. Keep raw details server-side.
    const detail = null
    last = new ProviderError(
      res.status === 401 || res.status === 403 ? `${name} rejected the credentials${detail ? `: ${detail}` : '.'}` : res.status === 429 ? `${name} is rate limiting requests. Try again shortly.` : `${name} responded ${res.status}${detail ? `: ${detail}` : '.'}`,
      { status: res.status, code: res.status === 401 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : `http_${res.status}`, retryable: res.status >= 500 },
    )
    last.body = data
    if (res.status < 500) throw last
  }
  throw last
}

/** Rejects any URL whose host is not on the provider's own domain. Stops a pasted URL from reaching internal services. */
export function assertHost(value, suffixes, config, label = 'URL') {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError(`${label} is not a valid URL.`)
  }
  const host = url.hostname.toLowerCase()
  if (url.username || url.password) throw new ConfigError(`${label} must not contain embedded credentials.`)
  const extra = config.extraAllowedHosts ?? []
  if (extra.includes(host) || extra.includes(url.host)) return url
  if (url.protocol !== 'https:') throw new ConfigError(`${label} must start with https://.`)
  if (!suffixes.some((s) => host === s.replace(/^\./, '') || host.endsWith(s.startsWith('.') ? s : `.${s}`))) {
    throw new ConfigError(`${label} must be on ${suffixes.map((s) => s.replace(/^\./, '')).join(' or ')}.`)
  }
  return url
}

const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
const required = (value, label) => {
  const v = String(value ?? '').trim()
  if (!v) throw new ConfigError(`${label} is required.`)
  if (v.length > 2000) throw new ConfigError(`${label} is too long.`)
  return v
}

/** Runs a request with the stored token, refreshing it once if it has expired or is rejected. */
async function withToken(ctx, adapter, run) {
  if (ctx.secret.expiresAt && ctx.secret.expiresAt < Date.now() + 60_000 && ctx.secret.refreshToken) await refresh(ctx, adapter)
  try {
    return await run(ctx.secret.accessToken)
  } catch (err) {
    if (!(err instanceof ProviderError) || err.status !== 401 || !ctx.secret.refreshToken) throw err
    await refresh(ctx, adapter)
    return run(ctx.secret.accessToken)
  }
}

async function refresh(ctx, adapter) {
  const next = await adapter.oauth.refresh(ctx)
  ctx.secret = { ...ctx.secret, ...next }
  await ctx.saveSecret?.(ctx.secret)
}

/* ---------- QuickBooks Online ---------- */

const qbBase = (config) => config.quickbooksApiBaseUrl || (config.quickbooksEnvironment === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com')
const qbTokens = (body) => ({ accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 })

const quickbooks = {
  id: 'quickbooks',
  prerequisite: (config) => (config.quickbooksClientId && config.quickbooksClientSecret ? null : 'Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET on the server to enable the QuickBooks sign-in.'),
  oauth: {
    authorizeUrl: (config, { state, redirectUri }) =>
      `${config.quickbooksAuthUrl}?${new URLSearchParams({ client_id: config.quickbooksClientId, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: redirectUri, state })}`,
    async exchange(ctx, { code, redirectUri, query }) {
      const realmId = String(query.realmId ?? '')
      if (!/^\d{5,25}$/.test(realmId)) throw new ProviderError('QuickBooks did not return a company id.', { code: 'bad_callback' })
      const body = await call(ctx, ctx.config.quickbooksTokenUrl, { method: 'POST', name: 'QuickBooks', headers: { Authorization: basic(ctx.config.quickbooksClientId, ctx.config.quickbooksClientSecret) }, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri } })
      return { secret: qbTokens(body), settings: { realmId, environment: ctx.config.quickbooksEnvironment } }
    },
    async refresh(ctx) {
      const body = await call(ctx, ctx.config.quickbooksTokenUrl, { method: 'POST', name: 'QuickBooks', headers: { Authorization: basic(ctx.config.quickbooksClientId, ctx.config.quickbooksClientSecret) }, form: { grant_type: 'refresh_token', refresh_token: ctx.secret.refreshToken } })
      return qbTokens(body)
    },
    revoke: (ctx) => call(ctx, ctx.config.quickbooksRevokeUrl, { method: 'POST', name: 'QuickBooks', retries: 0, headers: { Authorization: basic(ctx.config.quickbooksClientId, ctx.config.quickbooksClientSecret) }, body: { token: ctx.secret.refreshToken ?? ctx.secret.accessToken } }),
  },
  get(ctx, path) {
    const sep = path.includes('?') ? '&' : '?'
    return withToken(ctx, quickbooks, (token) => call(ctx, `${qbBase(ctx.config)}/v3/company/${ctx.settings.realmId}/${path}${sep}minorversion=${ctx.config.quickbooksMinorVersion}`, { name: 'QuickBooks', headers: { Authorization: `Bearer ${token}` } }))
  },
  async query(ctx, entity, where = '') {
    const body = await quickbooks.get(ctx, `query?query=${encodeURIComponent(`select * from ${entity}${where ? ` where ${where}` : ''} maxresults 500`)}`)
    return body?.QueryResponse?.[entity] ?? []
  },
  async test(ctx) {
    const body = await quickbooks.get(ctx, `companyinfo/${ctx.settings.realmId}`)
    const name = body?.CompanyInfo?.CompanyName
    if (!name) throw new ProviderError('QuickBooks returned no company information.', { code: 'bad_response' })
    return { account: name, detail: `Read access to ${name} confirmed (${ctx.config.quickbooksEnvironment}).` }
  },
  async sync(ctx) {
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
    const changed = ctx.since ? `MetaData.LastUpdatedTime > '${new Date(ctx.since).toISOString()}'` : null
    const optional = (promise) => promise.catch((err) => (err instanceof ProviderError && err.status !== 401 ? [] : Promise.reject(err)))
    const [vendors, bills, purchases, accounts, budgets, prefs, info] = await Promise.all([
      quickbooks.query(ctx, 'Vendor', changed ?? ''),
      quickbooks.query(ctx, 'Bill', changed ?? `TxnDate >= '${yearAgo}'`),
      quickbooks.query(ctx, 'Purchase', changed ?? `TxnDate >= '${yearAgo}'`),
      ctx.since ? [] : quickbooks.query(ctx, 'Account', "Classification = 'Expense'"),
      ctx.since ? [] : optional(quickbooks.query(ctx, 'Budget')),
      optional(quickbooks.query(ctx, 'Preferences')),
      optional(quickbooks.get(ctx, `companyinfo/${ctx.settings.realmId}`).then((b) => [b?.CompanyInfo])),
    ])
    return normalizeQuickBooks({ vendors, bills, purchases, accounts, budgets, company: { name: info[0]?.CompanyName, currency: prefs[0]?.CurrencyPrefs?.HomeCurrency?.value } })
  },
  incremental: ['vendors', 'bills', 'purchases'],
}

/* ---------- Salesforce ---------- */

const SF_HOSTS = ['.salesforce.com', '.force.com', '.cloudforce.com', '.salesforce.mil', '.sfcrmproducts.cn']

const salesforce = {
  id: 'salesforce',
  prerequisite: (config) => (config.salesforceClientId && config.salesforceClientSecret ? null : 'Set SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET on the server to enable the Salesforce sign-in.'),
  oauth: {
    pkce: true,
    authorizeUrl: (config, { state, redirectUri, verifier }) =>
      `${config.salesforceLoginUrl}/services/oauth2/authorize?${new URLSearchParams({ response_type: 'code', client_id: config.salesforceClientId, redirect_uri: redirectUri, state, scope: 'api refresh_token', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' })}`,
    async exchange(ctx, { code, redirectUri, verifier }) {
      const body = await call(ctx, `${ctx.config.salesforceLoginUrl}/services/oauth2/token`, { method: 'POST', name: 'Salesforce', form: { grant_type: 'authorization_code', code, client_id: ctx.config.salesforceClientId, client_secret: ctx.config.salesforceClientSecret, redirect_uri: redirectUri, code_verifier: verifier } })
      const instance = assertHost(body.instance_url, SF_HOSTS, ctx.config, 'The Salesforce instance URL')
      return { secret: { accessToken: body.access_token, refreshToken: body.refresh_token ?? null }, settings: { instanceUrl: instance.origin } }
    },
    async refresh(ctx) {
      const body = await call(ctx, `${ctx.config.salesforceLoginUrl}/services/oauth2/token`, { method: 'POST', name: 'Salesforce', form: { grant_type: 'refresh_token', refresh_token: ctx.secret.refreshToken, client_id: ctx.config.salesforceClientId, client_secret: ctx.config.salesforceClientSecret } })
      return { accessToken: body.access_token }
    },
    revoke: (ctx) => call(ctx, `${ctx.config.salesforceLoginUrl}/services/oauth2/revoke`, { method: 'POST', name: 'Salesforce', retries: 0, form: { token: ctx.secret.refreshToken ?? ctx.secret.accessToken } }),
  },
  get: (ctx, path) => withToken(ctx, salesforce, (token) => call(ctx, `${ctx.settings.instanceUrl}${path}`, { name: 'Salesforce', headers: { Authorization: `Bearer ${token}` } })),
  /** The org's newest API version, unless one is pinned in configuration. */
  async version(ctx) {
    if (ctx.config.salesforceApiVersion) return ctx.config.salesforceApiVersion
    if (ctx.settings.apiVersion) return ctx.settings.apiVersion
    const versions = await salesforce.get(ctx, '/services/data/')
    const latest = Array.isArray(versions) ? versions[versions.length - 1]?.version : null
    if (!latest) throw new ProviderError('Salesforce did not list its API versions.', { code: 'bad_response' })
    ctx.settings.apiVersion = latest
    return latest
  },
  async soql(ctx, q) {
    const body = await salesforce.get(ctx, `/services/data/v${await salesforce.version(ctx)}/query?q=${encodeURIComponent(q)}`)
    return body?.records ?? []
  },
  /**
   * Reads one object, tolerating orgs that differ from the standard schema: a
   * missing field falls back to Id and Name, and a missing object is reported
   * as unavailable instead of failing the whole sync.
   */
  async readObject(ctx, object, fields, tail, unavailable) {
    try {
      return await salesforce.soql(ctx, `SELECT ${fields} FROM ${object} ${tail}`)
    } catch (err) {
      const code = err.body?.[0]?.errorCode
      if (code === 'INVALID_FIELD') {
        try {
          const rows = await salesforce.soql(ctx, `SELECT Id, Name FROM ${object} ORDER BY LastModifiedDate DESC LIMIT 200`)
          unavailable.push(`some standard ${object} fields`)
          return rows
        } catch (inner) {
          if (inner.status === 401) throw inner
        }
      }
      if (code === 'INVALID_TYPE' || code === 'INSUFFICIENT_ACCESS' || code === 'INVALID_FIELD' || err.status === 403 || err.status === 404) {
        unavailable.push(object)
        return []
      }
      throw err
    }
  },
  async test(ctx) {
    const rows = await salesforce.soql(ctx, 'SELECT Id, Name FROM Organization LIMIT 1')
    if (!rows[0]?.Name) throw new ProviderError('Salesforce returned no organization.', { code: 'bad_response' })
    return { account: rows[0].Name, detail: `Read access to ${rows[0].Name} confirmed (API v${await salesforce.version(ctx)}).` }
  },
  async sync(ctx) {
    const unavailable = []
    const since = ctx.since ? ` AND LastModifiedDate > ${new Date(ctx.since).toISOString()}` : ''
    const [accounts, opportunities, orders] = await Promise.all([
      salesforce.readObject(ctx, 'Account', 'Id, Name, Industry, BillingCountry', `WHERE IsDeleted = false${since} ORDER BY LastModifiedDate DESC LIMIT 200`, unavailable),
      salesforce.readObject(ctx, 'Opportunity', 'Id, Name, AccountId, Account.Name, Amount, StageName, CloseDate, Probability', `WHERE ${ctx.since ? 'IsDeleted = false' : 'IsClosed = false'}${since} ORDER BY CloseDate ASC LIMIT 200`, unavailable),
      salesforce.readObject(ctx, 'Order', 'Id, OrderNumber, AccountId, Account.Name, Status, EffectiveDate, TotalAmount', `WHERE IsDeleted = false${since} ORDER BY EffectiveDate DESC LIMIT 200`, unavailable),
    ])
    return normalizeSalesforce({ accounts, opportunities, orders, unavailable: [...new Set(unavailable)] })
  },
  incremental: ['accounts', 'opportunities', 'orders'],
}

/* ---------- Shopify ---------- */

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/
const SHOPIFY_SCOPES = 'read_products,read_inventory,read_orders,read_locations'
const shopOrigin = (ctx, shop) => ctx.config.providerBaseUrls?.shopify ?? `https://${shop}`
const cleanShop = (value) => {
  const shop = String(value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!SHOP_RE.test(shop)) throw new ConfigError('Enter the shop domain in the form your-store.myshopify.com.')
  return shop
}

const SHOPIFY_QUERIES = {
  products: '{ products(first: 100) { nodes { id title status variants(first: 20) { nodes { id title sku inventoryQuantity } } } } }',
  orders: '{ orders(first: 100, sortKey: CREATED_AT, reverse: true, query: "status:open") { nodes { id name createdAt cancelledAt displayFulfillmentStatus displayFinancialStatus lineItems(first: 20) { nodes { title sku quantity unfulfilledQuantity variant { id product { id } } } } } } }',
  locations: '{ locations(first: 20) { nodes { id name isActive address { city countryCode } } } }',
}

const shopify = {
  id: 'shopify',
  validate(input) {
    return { secret: { accessToken: required(input.accessToken, 'The Admin API access token') }, settings: { shop: cleanShop(input.shop) } }
  },
  oauth: {
    available: (config) => Boolean(config.shopifyClientId && config.shopifyClientSecret),
    authorizeUrl: (config, { state, redirectUri, input }) =>
      `https://${cleanShop(input?.shop)}/admin/oauth/authorize?${new URLSearchParams({ client_id: config.shopifyClientId, scope: SHOPIFY_SCOPES, redirect_uri: redirectUri, state })}`,
    stateExtra: (input) => ({ shop: cleanShop(input?.shop) }),
    async exchange(ctx, { code, query, stateData }) {
      const shop = cleanShop(query.shop)
      if (shop !== stateData.shop) throw new ProviderError('The shop in the callback does not match the one you started with.', { code: 'bad_callback' })
      // Shopify signs the callback: every parameter except hmac, sorted, with the app secret.
      const message = Object.keys(query).filter((k) => k !== 'hmac' && k !== 'signature').sort().map((k) => `${k}=${query[k]}`).join('&')
      if (!safeEqual(hmacSha256(ctx.config.shopifyClientSecret, message), String(query.hmac ?? ''))) throw new ProviderError('The Shopify callback signature is not valid.', { code: 'bad_signature' })
      const body = await call(ctx, `${shopOrigin(ctx, shop)}/admin/oauth/access_token`, { method: 'POST', name: 'Shopify', body: { client_id: ctx.config.shopifyClientId, client_secret: ctx.config.shopifyClientSecret, code } })
      return { secret: { accessToken: body.access_token }, settings: { shop, scopes: body.scope ?? SHOPIFY_SCOPES } }
    },
    revoke: (ctx) => call(ctx, `${shopOrigin(ctx, ctx.settings.shop)}/admin/api_permissions/current.json`, { method: 'DELETE', name: 'Shopify', retries: 0, headers: { 'X-Shopify-Access-Token': ctx.secret.accessToken } }),
  },
  async graphql(ctx, query) {
    const version = ctx.config.shopifyApiVersion || shopifyApiVersion()
    const body = await call(ctx, `${shopOrigin(ctx, ctx.settings.shop)}/admin/api/${version}/graphql.json`, { method: 'POST', name: 'Shopify', headers: { 'X-Shopify-Access-Token': ctx.secret.accessToken }, body: { query } })
    if (body?.errors?.length && !body.data) throw new ProviderError(`Shopify refused the query: ${String(body.errors[0].message).slice(0, 160)}`, { code: body.errors[0].extensions?.code === 'ACCESS_DENIED' ? 'access_denied' : 'graphql_error' })
    return body?.data ?? {}
  },
  async test(ctx) {
    const data = await shopify.graphql(ctx, '{ shop { name myshopifyDomain currencyCode } }')
    if (!data.shop?.name) throw new ProviderError('Shopify returned no shop.', { code: 'bad_response' })
    return { account: data.shop.name, detail: `Read access to ${data.shop.name} confirmed.` }
  },
  async sync(ctx) {
    const warnings = []
    const read = async (key) => {
      try {
        return (await shopify.graphql(ctx, SHOPIFY_QUERIES[key]))[key]?.nodes ?? []
      } catch (err) {
        // A missing scope loses one section, not the whole sync.
        if (err.code !== 'access_denied' && err.code !== 'graphql_error') throw err
        warnings.push(`${key}: ${err.message}`)
        return []
      }
    }
    const [products, orders, locations, shop] = await Promise.all([read('products'), read('orders'), read('locations'), shopify.graphql(ctx, '{ shop { currencyCode } }').catch(() => ({}))])
    if (warnings.length === 3) throw new ProviderError(`Shopify granted no readable data. ${warnings[0]}`, { code: 'access_denied' })
    return { ...normalizeShopify({ products, orders, locations, shop: ctx.settings.shop, currency: shop.shop?.currencyCode }), warnings }
  },
}

/** Verifies a Shopify webhook body against its X-Shopify-Hmac-Sha256 header. */
export const verifyShopifyWebhook = (secret, rawBody, header) => Boolean(secret && header) && safeEqual(hmacSha256(secret, rawBody, 'base64'), header)

/* ---------- Slack ---------- */

const slackApi = async (ctx, method, { token, form, body } = {}) => {
  const res = await call(ctx, `${ctx.config.slackApiBaseUrl}/${method}`, { method: 'POST', name: 'Slack', headers: token ? { Authorization: `Bearer ${token}` } : {}, form, body })
  if (!res?.ok) {
    const hints = { not_in_channel: 'Invite the Waymark app to that channel first, then try again.', channel_not_found: 'That channel could not be found.', invalid_auth: 'Slack rejected the stored token. Reconnect Slack.', token_revoked: 'The Slack token was revoked. Reconnect Slack.', missing_scope: 'The Slack app is missing a required permission.' }
    throw new ProviderError(hints[res?.error] ?? `Slack reported an error: ${String(res?.error ?? 'unknown').slice(0, 80)}`, { code: res?.error ?? 'slack_error', status: ['invalid_auth', 'token_revoked'].includes(res?.error) ? 401 : 0 })
  }
  return res
}

const slack = {
  id: 'slack',
  validate(input, config) {
    const url = assertHost(required(input.webhookUrl, 'The webhook URL'), ['hooks.slack.com'], config, 'The webhook URL')
    return { secret: { webhookUrl: url.toString() }, settings: { mode: 'webhook' }, verified: false }
  },
  oauth: {
    available: (config) => Boolean(config.slackClientId && config.slackClientSecret),
    authorizeUrl: (config, { state, redirectUri }) => `${config.slackAuthUrl}?${new URLSearchParams({ client_id: config.slackClientId, scope: 'chat:write,channels:read', redirect_uri: redirectUri, state })}`,
    async exchange(ctx, { code, redirectUri }) {
      const body = await slackApi(ctx, 'oauth.v2.access', { form: { client_id: ctx.config.slackClientId, client_secret: ctx.config.slackClientSecret, code, redirect_uri: redirectUri } })
      return { secret: { botToken: body.access_token }, settings: { mode: 'oauth', team: body.team?.name ?? null, teamId: body.team?.id ?? null } }
    },
    revoke: (ctx) => (ctx.secret.botToken ? slackApi(ctx, 'auth.revoke', { token: ctx.secret.botToken }) : null),
  },
  async test(ctx) {
    if (!ctx.secret.botToken) return { unverified: true, detail: 'A webhook can only be verified by posting. Send a test message to confirm it.' }
    const body = await slackApi(ctx, 'auth.test', { token: ctx.secret.botToken })
    return { account: body.team, detail: `Signed in to the ${body.team} workspace as ${body.user}.` }
  },
  async channels(ctx) {
    if (!ctx.secret.botToken) return []
    const body = await slackApi(ctx, 'conversations.list', { token: ctx.secret.botToken, form: { types: 'public_channel', exclude_archived: 'true', limit: '200' } })
    return (body.channels ?? []).map((c) => ({ id: c.id, name: c.name, member: Boolean(c.is_member) }))
  },
  async send(ctx, message) {
    const payload = { text: message.text, blocks: message.slackBlocks }
    if (ctx.secret.botToken) {
      if (!ctx.settings.channel) throw new ConfigError('Choose a Slack channel first.')
      const body = await slackApi(ctx, 'chat.postMessage', { token: ctx.secret.botToken, body: { channel: ctx.settings.channel, ...payload, unfurl_links: false } })
      return { reference: body.ts ?? null, destination: ctx.settings.channelName ? `#${ctx.settings.channelName}` : ctx.settings.channel }
    }
    assertHost(ctx.secret.webhookUrl, ['hooks.slack.com'], ctx.config, 'The webhook URL')
    await call(ctx, ctx.secret.webhookUrl, { method: 'POST', name: 'Slack', body: payload, retries: 0 })
    return { reference: null, destination: 'Webhook channel' }
  },
}

/* ---------- Microsoft Teams ---------- */

const TEAMS_HOSTS = ['.logic.azure.com', '.webhook.office.com', '.powerplatform.com', '.azure-api.net']

const teams = {
  id: 'teams',
  validate(input, config) {
    const url = assertHost(required(input.webhookUrl, 'The workflow webhook URL'), TEAMS_HOSTS, config, 'The webhook URL')
    return { secret: { webhookUrl: url.toString() }, settings: { mode: 'workflow', host: url.hostname }, verified: false }
  },
  test: async () => ({ unverified: true, detail: 'A workflow webhook can only be verified by posting. Send a test notification to confirm it.' }),
  async send(ctx, message) {
    assertHost(ctx.secret.webhookUrl, TEAMS_HOSTS, ctx.config, 'The webhook URL')
    await call(ctx, ctx.secret.webhookUrl, {
      method: 'POST', name: 'Microsoft Teams', retries: 0,
      body: { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: message.teamsCard }] },
    })
    return { reference: null, destination: 'Teams workflow destination' }
  },
}

/* ---------- Key-less services ---------- */

const openmeteo = {
  id: 'openmeteo',
  async test(ctx) {
    const base = ctx.config.openMeteoApiKey ? ctx.config.openMeteoBaseUrl.replace('//api.', '//customer-api.') : ctx.config.openMeteoBaseUrl
    const params = new URLSearchParams({ latitude: '43.65', longitude: '-79.38', daily: 'weather_code', forecast_days: '1', timezone: 'UTC', ...(ctx.config.openMeteoApiKey ? { apikey: ctx.config.openMeteoApiKey } : {}) })
    const body = await call(ctx, `${base}/v1/forecast?${params}`, { name: 'Open-Meteo' })
    if (!body?.daily?.time?.length) throw new ProviderError('Open-Meteo returned no forecast.', { code: 'bad_response' })
    return { detail: ctx.config.openMeteoApiKey ? 'Forecast service reachable with a commercial API key.' : 'Forecast service reachable (key-less, non-commercial endpoint).' }
  },
}

const news = {
  id: 'news',
  async test(ctx) {
    try {
      const feed = await fetchWorldNews(ctx.config, NEWS_CATEGORIES[1].id, ctx.fetchImpl ?? fetch)
      return { detail: `${feed.articles.length} current headlines read from ${feed.source}.` }
    } catch (err) {
      throw new ProviderError(err.message, { code: 'unreachable' })
    }
  },
}

/* ---------- Logistics ---------- */

/*
  The tracking contract. A tracking adapter needs:
    validate(input)        -> { secret, settings }
    test(ctx)              -> proof of access, or throws
    identifiers(shipment)  -> what it can look the shipment up by, or null
    track(ctx, shipment)   -> trackingResult(), or null when the provider has no record
  Both adapters below follow the providers' published request shapes. Neither
  has been run against a live subscription, and the endpoint paths are kept
  together here so they are easy to correct against your contract's documentation.
*/
const marinetraffic = {
  id: 'marinetraffic',
  validate: (input) => ({ secret: { apiKey: required(input.apiKey, 'The API key') }, settings: {}, verified: false }),
  identifiers: (s) => (s.vesselImo ? { imo: String(s.vesselImo) } : s.vesselMmsi ? { mmsi: String(s.vesselMmsi) } : null),
  position: (ctx, ids) => call(ctx, `${ctx.config.marineTrafficBaseUrl}/exportvessel/${encodeURIComponent(ctx.secret.apiKey)}?${new URLSearchParams({ v: '6', protocol: 'jsono', msgtype: 'extended', ...ids })}`, { name: 'MarineTraffic' }),
  async test(ctx) {
    const body = await marinetraffic.position(ctx, { mmsi: ctx.settings.testMmsi ?? '316001234' })
    if (body?.errors?.length) throw new ProviderError(`MarineTraffic reported: ${String(body.errors[0].detail ?? body.errors[0].code).slice(0, 120)}`, { code: 'unauthorized', status: 401 })
    return { detail: 'MarineTraffic accepted the API key.' }
  },
  async track(ctx, shipment) {
    const ids = marinetraffic.identifiers(shipment)
    if (!ids) return null
    return normalizeMarineTraffic(await marinetraffic.position(ctx, ids), shipment.reference)
  },
}

const project44 = {
  id: 'project44',
  validate: (input) => ({ secret: { clientId: required(input.clientId, 'The client ID'), clientSecret: required(input.clientSecret, 'The client secret') }, settings: {}, verified: false }),
  identifiers: (s) => (s.containerNo ? { type: 'CONTAINER_ID', value: s.containerNo } : s.awb ? { type: 'AIR_WAYBILL', value: s.awb } : s.billOfLading ? { type: 'BILL_OF_LADING', value: s.billOfLading } : null),
  async token(ctx) {
    if (ctx.secret.accessToken && ctx.secret.expiresAt > Date.now() + 60_000) return ctx.secret.accessToken
    const body = await call(ctx, `${ctx.config.project44BaseUrl}/api/v4/oauth2/token`, { method: 'POST', name: 'project44', form: { grant_type: 'client_credentials', client_id: ctx.secret.clientId, client_secret: ctx.secret.clientSecret } })
    if (!body?.access_token) throw new ProviderError('project44 returned no access token.', { code: 'bad_response' })
    ctx.secret = { ...ctx.secret, accessToken: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 }
    await ctx.saveSecret?.(ctx.secret)
    return ctx.secret.accessToken
  },
  async test(ctx) {
    await project44.token(ctx)
    return { detail: 'project44 issued an access token for these credentials.' }
  },
  async track(ctx, shipment) {
    const id = project44.identifiers(shipment)
    if (!id) return null
    const token = await project44.token(ctx)
    const body = await call(ctx, `${ctx.config.project44BaseUrl}/api/v4/shipments/tracking?${new URLSearchParams({ 'shipmentIdentifier.type': id.type, 'shipmentIdentifier.value': id.value })}`, { name: 'project44', headers: { Authorization: `Bearer ${token}` } })
    return normalizeProject44(body, shipment.reference)
  },
}

export const ADAPTERS = { quickbooks, salesforce, shopify, slack, teams, openmeteo, news, marinetraffic, project44 }
export const TRACKING_PROVIDERS = ['project44', 'marinetraffic']
