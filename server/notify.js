/*
  Notifications to Slack and Microsoft Teams.

  Message content is assembled here from Waymark records: the shipment
  reference, the risk level worked out by the model, and a next step. A model
  may add one short summary sentence, and nothing else. Messages carry no
  customer names and no financial figures unless the alert is about cost.

  Nothing in this file decides whether a message may be sent. `deliver` is only
  ever called for an approved request (server/approvals.js) or for a test
  message the user asked for themselves.
*/
import { NOTIFICATION_CATEGORIES } from '../shared/integrations.js'
import { ConfigError, ProviderError } from './integrations/adapters.js'
import { randomToken } from './crypto.js'

export const CHANNELS = { slack: 'Slack', teams: 'Microsoft Teams' }
const DEDUPE_WINDOW_MS = 24 * 3_600_000
const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }
const clean = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, '').trim().slice(0, max)

const HEADLINES = {
  high_risk_shipment: (ref) => `Shipment ${ref} is flagged for review.`,
  weather_disruption: (ref) => `Shipment ${ref} may be exposed to a weather disruption.`,
  supplier_alternative: (ref) => `An alternative supplier is worth reviewing for ${ref}.`,
  cost_impact: (ref) => `A disruption scenario for ${ref} shows a significant cost impact.`,
  inventory_risk: (ref) => `Inventory linked to ${ref} is at risk.`,
  investigation_complete: (ref) => `A Waymark investigation of ${ref} is ready to review.`,
}

/**
 * One message in every format a channel needs.
 * `subject` is a shipment reference or, when there is none, a short description of what the alert is about.
 */
export function buildNotification({ category, subject, level, detail, nextStep, summary, link, demo = false }) {
  const label = NOTIFICATION_CATEGORIES.find((c) => c.id === category)?.label ?? 'Waymark update'
  const headline = (HEADLINES[category] ?? ((ref) => `Update on ${ref}.`))(clean(subject, 80) || 'your supply chain')
  const facts = [
    ...(level ? [['Risk', LEVEL_LABEL[level] ?? clean(level, 20)]] : []),
    ...(detail ? [['What was found', clean(detail, 280)]] : []),
    ...(nextStep ? [['Recommended next step', clean(nextStep, 200)]] : []),
  ]
  const note = clean(summary, 300)
  const footer = demo ? 'Sample data from a Waymark demo workspace. Not a real shipment.' : 'A forecast or report is a prompt to review, not a confirmed delay.'
  const title = 'Waymark Risk Alert'
  const text = [`${title}: ${label}`, headline, ...facts.map(([k, v]) => `${k}: ${v}`), ...(note ? [note] : []), ...(link ? [`Open in Waymark: ${link}`] : []), footer].join('\n')

  return {
    category,
    title,
    label,
    headline,
    facts,
    note,
    link: link ?? null,
    footer,
    text,
    slackBlocks: [
      { type: 'header', text: { type: 'plain_text', text: title } },
      { type: 'section', text: { type: 'mrkdwn', text: `*${label}*\n${headline}` } },
      ...(facts.length ? [{ type: 'section', fields: facts.map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${v}` })) }] : []),
      ...(note ? [{ type: 'section', text: { type: 'mrkdwn', text: note } }] : []),
      ...(link ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Waymark' }, url: link }] }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] },
    ],
    teamsCard: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium' },
        { type: 'TextBlock', text: label, isSubtle: true, spacing: 'None' },
        { type: 'TextBlock', text: headline, wrap: true },
        ...(facts.length ? [{ type: 'FactSet', facts: facts.map(([k, v]) => ({ title: k, value: v })) }] : []),
        ...(note ? [{ type: 'TextBlock', text: note, wrap: true }] : []),
        { type: 'TextBlock', text: footer, wrap: true, isSubtle: true, size: 'Small' },
      ],
      ...(link ? { actions: [{ type: 'Action.OpenUrl', title: 'Open in Waymark', url: link }] } : {}),
    },
  }
}

const defaultPreferences = (channel) => ({
  id: channel,
  enabled: true,
  categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, true])),
  // A standing authorisation to send without a per-message approval. Off unless an owner or admin turns it on.
  autoSend: false,
  authorizedBy: null,
  authorizedAt: null,
})

export function createNotifier({ store, integrations }) {
  async function preferences(tenant, channel) {
    const saved = await store.get(tenant, 'notification_preferences', channel)
    const base = defaultPreferences(channel)
    return { ...base, ...saved, categories: { ...base.categories, ...saved?.categories } }
  }

  async function savePreferences(tenant, channel, patch, actor) {
    if (!CHANNELS[channel]) throw new ConfigError('Unknown notification channel.')
    const current = await preferences(tenant, channel)
    const next = { ...current }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (patch.categories && typeof patch.categories === 'object') {
      for (const c of NOTIFICATION_CATEGORIES) if (typeof patch.categories[c.id] === 'boolean') next.categories[c.id] = patch.categories[c.id]
    }
    if (typeof patch.autoSend === 'boolean' && patch.autoSend !== current.autoSend) {
      next.autoSend = patch.autoSend
      next.authorizedBy = patch.autoSend ? actor : null
      next.authorizedAt = patch.autoSend ? new Date().toISOString() : null
    }
    return store.put(tenant, 'notification_preferences', next)
  }

  const deliveries = async (tenant) => (await store.list(tenant, 'notification_deliveries')).reverse()

  /** Sends one message and records the outcome. A repeat of the same alert on the same channel within a day is skipped. */
  async function deliver(tenant, { channel, message, dedupeKey = null, approvalId = null, actor }) {
    const record = { id: randomToken(9), channel, category: message.category, headline: message.headline, dedupeKey, approvalId, actor, at: new Date().toISOString() }
    if (dedupeKey) {
      const since = Date.now() - DEDUPE_WINDOW_MS
      const repeat = (await store.list(tenant, 'notification_deliveries')).find((d) => d.channel === channel && d.dedupeKey === dedupeKey && d.status === 'sent' && Date.parse(d.at) > since)
      if (repeat) return store.put(tenant, 'notification_deliveries', { ...record, status: 'skipped_duplicate', detail: 'The same alert was already sent on this channel in the last 24 hours.' })
    }
    try {
      const result = await integrations.send(tenant, channel, message)
      return store.put(tenant, 'notification_deliveries', { ...record, status: 'sent', destination: result.destination, reference: result.reference })
    } catch (err) {
      const detail = err instanceof ProviderError || err instanceof ConfigError ? err.message : 'The message could not be delivered.'
      return store.put(tenant, 'notification_deliveries', { ...record, status: 'failed', detail })
    }
  }

  /** A test message the user asked for. It names itself as a test and carries no business data. */
  function sendTest(tenant, channel, { actor, appBaseUrl }) {
    if (!CHANNELS[channel]) throw new ConfigError('Unknown notification channel.')
    const message = buildNotification({ category: 'test', subject: 'your Waymark workspace', detail: `Test message requested by ${clean(actor, 60)}. If you can read this, ${CHANNELS[channel]} delivery works.`, link: `${appBaseUrl}/app/integrations` })
    return deliver(tenant, { channel, message: { ...message, category: 'test', label: 'Connection test', headline: 'This is a test from Waymark.' }, actor })
  }

  return { preferences, savePreferences, deliveries, deliver, sendTest }
}
