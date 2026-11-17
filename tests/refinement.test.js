// Waymark 3.0 refinement: navigation registry, translations, branding and email alerts.
import { describe, expect, it } from 'vitest'
import { EMAIL_CATEGORIES } from '../shared/integrations.js'
import { createBranding, validateLogo } from '../server/branding.js'
import { createEmailNotifier, createEmailTransport, escapeHtml, renderAlertEmail, validateRecipients } from '../server/email.js'
import { createFileStore } from '../server/store.js'
import { buildNotification } from '../server/notify.js'
import { FEATURES, FEATURE_GROUPS, featureForPath } from '../src/state/viewPrefs.js'
import common from '../src/i18n/resources/common.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('navigation registry', () => {
  it('puts every feature in a known category and resolves deep links', () => {
    const groups = FEATURE_GROUPS.map((g) => g.id)
    expect(groups).toEqual(['main', 'intelligence', 'solutions', 'business'])
    for (const f of FEATURES) expect(groups).toContain(f.group)
    expect(featureForPath('/app').id).toBe('home')
    expect(featureForPath('/app/shipments/abc/resolve').id).toBe('shipments')
    expect(featureForPath('/app/simulator/').group).toBe('solutions')
    expect(featureForPath('/app/agent').group).toBe('intelligence')
    expect(featureForPath('/app/finance').group).toBe('business')
    expect(featureForPath('/app/settings')).toBeNull()
  })
})

describe('translations', () => {
  const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]))
  it('covers every common key in all six languages', () => {
    const en = keys(common.en).sort()
    expect(Object.keys(common).sort()).toEqual(['ar', 'en', 'es', 'fr', 'hi', 'zh-CN'])
    for (const lang of Object.keys(common)) expect(keys(common[lang]).sort()).toEqual(en)
  })
  it('keeps interpolation placeholders in every translation', () => {
    const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]))
    const en = Object.fromEntries(flat(common.en))
    for (const lang of Object.keys(common)) {
      for (const [k, v] of flat(common[lang])) {
        const want = (en[k].match(/{{\w+}}/g) ?? []).sort()
        expect([k, (v.match(/{{\w+}}/g) ?? []).sort()]).toEqual([k, want])
      }
    }
  })
  it('names every feature in every language', () => {
    for (const lang of Object.keys(common)) for (const f of FEATURES) expect(common[lang].feature[f.id]).toBeTruthy()
  })
})

describe('company branding', () => {
  it('accepts real PNG logos and refuses SVG, mismatched or oversized files', () => {
    expect(validateLogo(PNG)).toBe(PNG)
    expect(() => validateLogo('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toThrow(/PNG, JPEG or WebP/)
    expect(() => validateLogo(PNG.replace('image/png', 'image/jpeg'))).toThrow(/damaged|claims/)
    expect(() => validateLogo(`data:image/png;base64,${Buffer.alloc(600 * 1024).toString('base64')}`)).toThrow(/larger/)
  })
  it('stores branding per tenant', async () => {
    const store = createFileStore()
    const branding = createBranding({ store })
    await branding.save('ws:a', { displayName: '  Acme <b>Imports</b> ', logo: PNG, website: 'https://acme.example' }, 'owner')
    expect((await branding.get('ws:a')).displayName).toBe('Acme b Imports /b')
    expect(await branding.get('ws:b')).toBeNull()
    await expect(branding.save('ws:a', { website: 'javascript:alert(1)' }, 'owner')).rejects.toThrow(/web address/)
    await branding.save('ws:a', { logo: null }, 'owner')
    expect((await branding.get('ws:a')).logo).toBeNull()
  })
})

describe('email alerts', () => {
  const config = { appBaseUrl: 'https://app.example', emailAllowedDomains: [], emailHourlyLimit: 2 }
  const notifier = (store = createFileStore(), transport = createEmailTransport({})) => createEmailNotifier({ config, store, transport, brandingOf: async () => ({ displayName: 'Acme' }) })

  it('validates recipients', () => {
    expect(validateRecipients([' Ops@Acme.ca ', 'ops@acme.ca', ''])).toEqual(['ops@acme.ca'])
    expect(() => validateRecipients(['not-an-email'])).toThrow(/not a valid/)
    expect(() => validateRecipients(['a@other.com'], { allowedDomains: ['acme.ca'] })).toThrow(/outside/)
    expect(() => validateRecipients(Array.from({ length: 11 }, (_, i) => `u${i}@acme.ca`))).toThrow(/at most/)
  })

  it('renders a branded, escaped template with a plain-text fallback', () => {
    const message = buildNotification({ category: 'high_risk_shipment', subject: 'SH-1 <script>', level: 'high', detail: 'Delay "x" & <b>', link: 'https://app.example/app' })
    const email = renderAlertEmail({ message, branding: { displayName: 'Acme <Co>' }, appBaseUrl: 'https://app.example' })
    expect(email.html).toContain('Waymark')
    expect(email.html).toContain(escapeHtml('Acme <Co>'))
    expect(email.html).not.toMatch(/<script>|<b>/)
    expect(email.text).toContain('Risk: High')
    expect(email.text).toContain('Open in Waymark: https://app.example/app')
    expect(email.subject).toMatch(/^Waymark/)
  })

  it('needs recipients, respects categories and level, suppresses duplicates and rate-limits', async () => {
    const store = createFileStore()
    const email = notifier(store)
    await expect(email.savePreferences('ws:t', { enabled: true }, 'owner')).rejects.toThrow(/at least one recipient/)
    await email.savePreferences('ws:t', { enabled: true, recipients: ['ops@acme.ca'], minLevel: 'high', categories: { weather_disruption: false } }, 'owner')
    const alert = (key, extra = {}) => ({ key, category: 'high_risk_shipment', level: 'high', title: 'SH-1 is delayed', detail: 'ETA unknown', shipmentRefs: ['SH-1'], ...extra })
    expect(await email.onAlert('ws:t', alert('a', { level: 'medium' }))).toBeNull()
    expect(await email.onAlert('ws:t', alert('b', { category: 'weather_disruption' }))).toBeNull()
    const first = await email.onAlert('ws:t', alert('c'))
    expect(first.status).toBe('sent')
    expect(first.mock).toBe(true)
    expect((await email.onAlert('ws:t', alert('c'))).status).toBe('skipped_duplicate')
    expect((await email.onAlert('ws:t', alert('d'))).status).toBe('sent')
    expect((await email.onAlert('ws:t', alert('e'))).status).toBe('skipped_rate_limit')
    expect((await email.outbox('ws:t')).length).toBe(2)
    expect(await email.outbox('ws:other')).toEqual([])
  })

  it('keeps anonymous workspaces on the mock outbox even with a live transport', async () => {
    const calls = []
    const transport = createEmailTransport({ emailTransport: 'resend', emailApiKey: 'k', emailFrom: 'alerts@acme.ca' }, async (url) => { calls.push(url); return new Response('{"id":"1"}', { status: 200 }) })
    expect(transport.live).toBe(true)
    const store = createFileStore()
    const email = notifier(store, transport)
    await email.savePreferences('ws:anon', { enabled: true, recipients: ['ops@acme.ca'] }, 'owner')
    expect((await email.sendTest('ws:anon', { actor: 'owner' })).mock).toBe(true)
    await email.savePreferences('co:1', { enabled: true, recipients: ['ops@acme.ca'] }, 'owner')
    expect((await email.sendTest('co:1', { actor: 'owner' })).mock).toBe(false)
    expect(calls).toEqual(['https://api.resend.com/emails'])
  })

  it('offers the workflow categories alongside the shared notification taxonomy', () => {
    expect(EMAIL_CATEGORIES.map((c) => c.id)).toEqual(expect.arrayContaining(['high_risk_shipment', 'inventory_risk', 'pending_approval', 'monitoring_failure']))
  })
})
