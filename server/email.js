/*
  Email alerts to a company's own, authorized recipients.

  What this is, and what it is not:
  - These are internal notifications: an owner or admin chooses the recipient
    addresses, the categories and the minimum risk level. Saving that list is
    the authorization. Only owners and admins can change it (server/platform.js).
  - It is not an agent action. No agent tool can reach this module, and email
    to suppliers, customers or anyone outside the authorized list is not
    possible here. Agent-initiated external messages still go through
    server/approvals.js and need a human decision.

  Content is assembled from Waymark records by buildNotification (notify.js),
  so it carries the same limits: no customer names, and no financial figures
  unless the alert is about cost. Every dynamic value is HTML-escaped.

  Transports, chosen by EMAIL_TRANSPORT:
  - mock (default): nothing leaves the server. The rendered message is kept in
    the tenant's outbox so it can be inspected, and the delivery is labelled
    "mock" so no one mistakes it for a real send.
  - resend | sendgrid | postmark: HTTPS APIs, keyed by EMAIL_API_KEY, from
    EMAIL_FROM. Credentials come from the environment only.
  Anonymous demo/local workspaces never use a live transport unless
  EMAIL_ALLOW_ANONYMOUS=true, so a public demo cannot be used to send mail.
*/
import { EMAIL_CATEGORIES, NOTIFICATION_CATEGORIES } from '../shared/integrations.js'
import { randomToken } from './crypto.js'
import { buildNotification } from './notify.js'

const DEDUPE_WINDOW_MS = 24 * 3_600_000
const LEVELS = { low: 1, medium: 2, high: 3 }
const MAX_RECIPIENTS = 10
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export class EmailError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const oneLine = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)

/** Lower-cased, de-duplicated, valid addresses, or an error naming the first bad one. */
export function validateRecipients(list, { allowedDomains = [] } = {}) {
  if (!Array.isArray(list)) throw new EmailError('recipients must be a list of email addresses.')
  const out = []
  for (const raw of list) {
    const email = String(raw ?? '').trim().toLowerCase()
    if (!email) continue
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new EmailError(`“${oneLine(raw, 80)}” is not a valid email address.`)
    const domain = email.split('@')[1]
    if (allowedDomains.length && !allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) throw new EmailError(`${email} is outside the allowed domains (${allowedDomains.join(', ')}).`)
    if (!out.includes(email)) out.push(email)
  }
  if (out.length > MAX_RECIPIENTS) throw new EmailError(`Add at most ${MAX_RECIPIENTS} recipients.`)
  return out
}

const LEVEL_COLOURS = { High: '#be123c', Medium: '#b45309', Low: '#047857' }

/**
 * A branded alert email in HTML and plain text. Table layout and inline styles, because that is
 * what email clients render consistently; max 600px wide and fluid below that.
 */
export function renderAlertEmail({ message, branding = {}, appBaseUrl = '', preferencesUrl, test = false }) {
  const company = oneLine(branding.displayName, 80)
  const subject = oneLine(`${test ? '[Test] ' : ''}Waymark ${message.label ?? 'alert'}: ${message.headline}`, 160)
  const at = new Date().toISOString()
  const when = new Date(at).toUTCString()
  const level = message.facts?.find(([k]) => k === 'Risk')?.[1]
  const facts = (message.facts ?? []).filter(([k]) => k !== 'Risk')
  const link = message.link && /^https?:\/\//.test(message.link) ? message.link : null
  const prefs = preferencesUrl ?? (appBaseUrl ? `${appBaseUrl}/app/settings?tab=email` : null)
  const logo = typeof branding.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(branding.logo) ? branding.logo : null

  const text = [
    `WAYMARK${company ? ` · ${company}` : ''}`,
    `${message.label ?? 'Alert'}${level ? ` · Risk: ${level}` : ''}`,
    '',
    message.headline,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(message.note ? ['', message.note] : []),
    '',
    ...(link ? [`Open in Waymark: ${link}`] : []),
    `Sent ${when}.`,
    message.footer ?? '',
    prefs ? `You receive this because an administrator added you to Waymark email alerts. Change alert settings: ${prefs}` : 'You receive this because an administrator added you to Waymark email alerts.',
  ].join('\n')

  const row = (label, value) => `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;vertical-align:top">${escapeHtml(value)}</td></tr>`
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef0fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(message.headline)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dfe3f5">
<tr><td style="background:#1b1f5e;background-image:linear-gradient(120deg,#1b1f5e,#4c3fd1);padding:18px 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.5px">Waymark</td>
    <td align="right" style="color:#d9d4ff;font-size:13px">${logo ? `<img src="${logo}" alt="" height="28" style="height:28px;max-width:120px;vertical-align:middle;background:#fff;border-radius:4px;padding:2px;margin-right:8px">` : ''}${escapeHtml(company)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:24px">
  <p style="margin:0 0 6px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#4c3fd1;font-weight:700">${escapeHtml(test ? 'Connection test' : message.label ?? 'Alert')}</p>
  ${level ? `<p style="margin:0 0 12px"><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;color:#ffffff;background:${LEVEL_COLOURS[level] ?? '#475569'}">Risk: ${escapeHtml(level)}</span></p>` : ''}
  <h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;color:#0f172a">${escapeHtml(message.headline)}</h1>
  ${facts.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:0 0 14px">${facts.map(([k, v]) => row(k, v)).join('')}</table>` : ''}
  ${message.note ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#334155">${escapeHtml(message.note)}</p>` : ''}
  ${link ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#4c3fd1"><a href="${escapeHtml(link)}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none">Open in Waymark</a></td></tr></table>` : ''}
  <p style="margin:16px 0 0;font-size:12px;color:#64748b">Sent ${escapeHtml(when)}. ${escapeHtml(message.footer ?? '')}</p>
</td></tr>
<tr><td style="background:#f8fafc;padding:14px 24px;font-size:11px;line-height:1.5;color:#64748b">
  You receive this because an administrator added you to Waymark email alerts${company ? ` for ${escapeHtml(company)}` : ''}.${prefs ? ` <a href="${escapeHtml(prefs)}" style="color:#4c3fd1">Change alert settings</a>.` : ''}<br>Waymark · Supply-chain intelligence
</td></tr>
</table></td></tr></table></body></html>`
  return { subject, html, text, at }
}

/** The configured transport. Live transports need EMAIL_TRANSPORT, EMAIL_API_KEY and EMAIL_FROM. */
export function createEmailTransport(config, fetchImpl = fetch) {
  const kind = ['resend', 'sendgrid', 'postmark'].includes(config.emailTransport) && config.emailApiKey && config.emailFrom ? config.emailTransport : 'mock'
  const post = async (url, headers, body) => {
    let res
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(config.upstreamTimeoutMs ?? 10_000) })
    } catch {
      throw new EmailError('The email provider could not be reached.', 502)
    }
    if (!res.ok) throw new EmailError(`The email provider rejected the message (HTTP ${res.status}).`, 502)
    return res.json().catch(() => ({}))
  }
  return {
    kind,
    live: kind !== 'mock',
    async send({ to, subject, html, text }) {
      if (kind === 'resend') {
        const data = await post('https://api.resend.com/emails', { Authorization: `Bearer ${config.emailApiKey}` }, { from: config.emailFrom, to, subject, html, text })
        return { reference: data.id ?? null }
      }
      if (kind === 'sendgrid') {
        await post('https://api.sendgrid.com/v3/mail/send', { Authorization: `Bearer ${config.emailApiKey}` }, { personalizations: [{ to: to.map((email) => ({ email })) }], from: { email: config.emailFrom }, subject, content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }] })
        return { reference: null }
      }
      if (kind === 'postmark') {
        const data = await post('https://api.postmarkapp.com/email', { 'X-Postmark-Server-Token': config.emailApiKey }, { From: config.emailFrom, To: to.join(','), Subject: subject, HtmlBody: html, TextBody: text, MessageStream: 'outbound' })
        return { reference: data.MessageID ?? null }
      }
      return { reference: `mock-${randomToken(6)}` }
    },
  }
}

export const defaultEmailPreferences = () => ({
  id: 'email',
  enabled: false,
  recipients: [],
  categories: Object.fromEntries(EMAIL_CATEGORIES.map((c) => [c.id, true])),
  minLevel: 'medium',
  updatedBy: null,
  updatedAt: null,
})

/**
 * @param store       tenant-scoped store
 * @param transport   from createEmailTransport
 * @param brandingOf  async (tenant) => branding record or null
 */
export function createEmailNotifier({ config, store, transport, brandingOf = async () => null }) {
  const allowedDomains = (config.emailAllowedDomains ?? []).map((d) => d.toLowerCase())
  const hourlyLimit = config.emailHourlyLimit ?? 30

  async function preferences(tenant) {
    const saved = await store.get(tenant, 'notification_preferences', 'email')
    const base = defaultEmailPreferences()
    return { ...base, ...saved, categories: { ...base.categories, ...saved?.categories } }
  }

  async function savePreferences(tenant, patch, actor) {
    const next = { ...(await preferences(tenant)) }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (patch.recipients !== undefined) next.recipients = validateRecipients(patch.recipients, { allowedDomains })
    if (patch.categories && typeof patch.categories === 'object') {
      for (const c of EMAIL_CATEGORIES) if (typeof patch.categories[c.id] === 'boolean') next.categories[c.id] = patch.categories[c.id]
    }
    if (patch.minLevel !== undefined) {
      if (!LEVELS[patch.minLevel]) throw new EmailError('minLevel must be low, medium or high.')
      next.minLevel = patch.minLevel
    }
    if (next.enabled && !next.recipients.length) throw new EmailError('Add at least one recipient before turning email alerts on.')
    next.updatedBy = actor
    next.updatedAt = new Date().toISOString()
    return store.put(tenant, 'notification_preferences', next)
  }

  const liveAllowed = (tenant) => transport.live && (tenant.startsWith('co:') || config.emailAllowAnonymous)

  /** Sends one email to the authorized list and records the outcome under the "email" channel. */
  async function deliver(tenant, { message, dedupeKey = null, actor = 'system', test = false }) {
    const prefs = await preferences(tenant)
    const record = { id: randomToken(9), channel: 'email', category: message.category, headline: message.headline, dedupeKey, actor, at: new Date().toISOString(), transport: transport.kind, recipients: prefs.recipients.length }
    const put = (extra) => store.put(tenant, 'notification_deliveries', { ...record, ...extra })
    if (!prefs.recipients.length) return put({ status: 'failed', detail: 'No recipients are configured.' })
    const history = await store.list(tenant, 'notification_deliveries')
    if (dedupeKey && !test) {
      const since = Date.now() - DEDUPE_WINDOW_MS
      if (history.some((d) => d.channel === 'email' && d.dedupeKey === dedupeKey && d.status === 'sent' && Date.parse(d.at) > since)) {
        return put({ status: 'skipped_duplicate', detail: 'The same alert was already emailed in the last 24 hours.' })
      }
    }
    const hourAgo = Date.now() - 3_600_000
    if (history.filter((d) => d.channel === 'email' && d.status === 'sent' && Date.parse(d.at) > hourAgo).length >= hourlyLimit) {
      return put({ status: 'skipped_rate_limit', detail: `The hourly email limit (${hourlyLimit}) was reached. The alert stays visible in Waymark.` })
    }
    const branding = (await brandingOf(tenant)) ?? {}
    const email = renderAlertEmail({ message, branding, appBaseUrl: config.appBaseUrl, test })
    const live = liveAllowed(tenant)
    try {
      const result = live ? await transport.send({ to: prefs.recipients, ...email }) : { reference: `mock-${randomToken(6)}` }
      if (!live) await store.put(tenant, 'email_outbox', { id: record.id, to: prefs.recipients, subject: email.subject, text: email.text, html: email.html, at: record.at })
      return put({
        status: 'sent', mock: !live, reference: result.reference, destination: `${prefs.recipients.length} recipient(s)`,
        detail: live ? `Delivered to the ${transport.kind} email service.` : 'Mock transport: rendered and stored in the outbox, not delivered to a real inbox. Configure EMAIL_TRANSPORT to send live email.',
      })
    } catch (err) {
      return put({ status: 'failed', detail: err instanceof EmailError ? err.message : 'The email could not be delivered.' })
    }
  }

  /** Called for each newly detected alert. Respects the on switch, categories and minimum level. */
  async function onAlert(tenant, alert, { demo = false } = {}) {
    const prefs = await preferences(tenant)
    if (!prefs.enabled || prefs.categories[alert.category] === false) return null
    if ((LEVELS[alert.level] ?? 0) < LEVELS[prefs.minLevel]) return null
    const message = buildNotification({ category: alert.category, subject: alert.shipmentRefs?.[0] ?? alert.title, level: alert.level, detail: alert.detail, link: `${config.appBaseUrl}/app/activity`, demo: demo || alert.simulated })
    return deliver(tenant, { message, dedupeKey: `alert:${alert.key ?? alert.id}` })
  }

  /** Internal workflow events: pending approvals, monitoring failures, finished automated investigations. */
  async function onEvent(tenant, { category, subject, detail, level = null, link, dedupeKey }) {
    const prefs = await preferences(tenant)
    if (!prefs.enabled || prefs.categories[category] === false) return null
    if (level && (LEVELS[level] ?? 0) < LEVELS[prefs.minLevel]) return null
    const def = EMAIL_CATEGORIES.find((c) => c.id === category)
    const base = buildNotification({ category, subject, level, detail, link: link ?? `${config.appBaseUrl}/app` })
    // Workflow categories (pending approval, monitoring failure) have no shipment headline template.
    const message = NOTIFICATION_CATEGORIES.some((c) => c.id === category) ? base : { ...base, label: def?.label ?? 'Waymark update', headline: oneLine(subject, 160) }
    return deliver(tenant, { message, dedupeKey })
  }

  async function sendTest(tenant, { actor }) {
    const message = { ...buildNotification({ category: 'test', subject: 'your Waymark workspace', detail: `Test requested by ${oneLine(actor, 60)}. If you can read this, email alerts work.`, link: `${config.appBaseUrl}/app/settings?tab=email` }), category: 'test', label: 'Connection test', headline: 'This is a test email from Waymark.' }
    return deliver(tenant, { message, actor, test: true })
  }

  const outbox = async (tenant) => (await store.list(tenant, 'email_outbox')).reverse().slice(0, 20)

  return { preferences, savePreferences, deliver, onAlert, onEvent, sendTest, outbox, transportKind: transport.kind, liveFor: liveAllowed }
}
