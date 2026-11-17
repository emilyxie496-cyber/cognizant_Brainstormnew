// Settings → Email Notifications, Language, and the compact Integrations summary.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { INTEGRATIONS, STATUS } from '../../../../shared/integrations.js'
import { Feedback, usePlatform } from '../../../components/app/PlatformKit.jsx'
import { BoundedList, Card, DataTable, Notice, SelectInput, StatusPill, TextArea, useToast } from '../../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../../components/ui.jsx'
import { LANGUAGES, formatDateTime, useTranslation } from '../../../i18n/index.js'
import { platform } from '../../../services/api.js'
import { useViewPrefs } from '../../../state/viewPrefs.js'
import { Switch } from './FeaturesTab.jsx'

const DELIVERY_TONE = { sent: 'emerald', failed: 'rose', skipped_duplicate: 'slate', skipped_rate_limit: 'amber' }

export function EmailTab() {
  const toast = useToast()
  const state = usePlatform(() => platform.emailSettings())
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const data = state.data
  useEffect(() => {
    if (data) setForm({ enabled: data.preferences.enabled, recipients: data.preferences.recipients.join('\n'), categories: data.preferences.categories, minLevel: data.preferences.minLevel })
  }, [data])
  if (!data || !form) return <Feedback state={state} />
  const canEdit = data.canEdit

  const save = async (e) => {
    e.preventDefault()
    setBusy('save'); setError('')
    try {
      await platform.saveEmailSettings({ ...form, recipients: form.recipients.split(/[\s,;]+/).filter(Boolean) })
      await state.reload()
      toast('Email notification settings saved')
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }
  const test = async () => {
    setBusy('test'); setError('')
    try {
      const { delivery } = await platform.testEmail()
      toast(delivery.mock ? 'Test email rendered to the mock outbox (not delivered)' : 'Test email sent')
    } catch (err) { setError(err.message) } finally { setBusy(''); state.reload() }
  }

  return (
    <div className="space-y-3">
      {!data.transport.live && <Notice tone="warn">Live email delivery is not configured on this server{data.transport.kind !== 'mock' ? ' for this workspace' : ''}. Messages are rendered and stored in a mock outbox, and no real email is sent. An administrator can set EMAIL_TRANSPORT, EMAIL_API_KEY and EMAIL_FROM on the server.</Notice>}
      {!canEdit && <Notice tone="info">Only an owner or admin can change email recipients and preferences.</Notice>}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card title="Email alerts" subtitle="Internal alerts to recipients your administrators authorize. Agents cannot send email.">
          <form onSubmit={save} className="space-y-3">
            <label className="flex items-center justify-between gap-3">
              <span><span className="block text-sm font-semibold text-navy">Send email alerts</span><span className="block text-xs text-slate-500">Turn on after adding at least one recipient.</span></span>
              <Switch label="Send email alerts" checked={form.enabled} disabled={!canEdit} onChange={(enabled) => setForm((f) => ({ ...f, enabled }))} />
            </label>
            <TextArea label="Authorized recipients" hint="One address per line, up to 10." rows={3} value={form.recipients} disabled={!canEdit} onChange={(recipients) => setForm((f) => ({ ...f, recipients }))} />
            <SelectInput label="Minimum risk level" placeholder={null} value={form.minLevel} disabled={!canEdit} onChange={(minLevel) => setForm((f) => ({ ...f, minLevel }))} options={[{ value: 'low', label: 'Low and above' }, { value: 'medium', label: 'Medium and above' }, { value: 'high', label: 'High only' }]} />
            <fieldset>
              <legend className="text-sm font-semibold text-navy">Categories</legend>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {data.categories.map((c) => (
                  <label key={c.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" disabled={!canEdit} checked={form.categories[c.id] !== false} onChange={(e) => setForm((f) => ({ ...f, categories: { ...f.categories, [c.id]: e.target.checked } }))} />{c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!canEdit || Boolean(busy)}>{busy === 'save' ? 'Saving…' : 'Save email settings'}</Button>
              <Button type="button" variant="secondary" disabled={!canEdit || Boolean(busy) || !data.preferences.recipients.length} onClick={test}><Icon name="mail" className="h-4 w-4" /> {busy === 'test' ? 'Sending…' : 'Send test email'}</Button>
            </div>
            <p className="text-xs text-slate-500">Repeated alerts are suppressed for 24 hours, and sending is rate-limited per hour. Emails carry no customer names, and no financial figures unless the alert is about cost.</p>
          </form>
        </Card>
        <Card title="Recent deliveries" subtitle="Email only">
          {data.deliveries.length ? (
            <BoundedList maxHeight="22rem" label="Recent email deliveries">
              <ul className="divide-y divide-slate-100 text-sm">
                {data.deliveries.map((d) => (
                  <li key={d.id} className="py-2">
                    <p className="flex flex-wrap items-center gap-1.5"><StatusPill tone={DELIVERY_TONE[d.status] ?? 'slate'}>{d.status.replace(/_/g, ' ')}</StatusPill>{d.mock && <Badge tone="amber">mock</Badge>}</p>
                    <p className="mt-0.5 text-navy">{d.headline}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(d.at)}{d.detail ? ` · ${d.detail}` : ''}</p>
                  </li>
                ))}
              </ul>
            </BoundedList>
          ) : <p className="text-sm text-slate-500">No emails yet.</p>}
        </Card>
      </div>
    </div>
  )
}

export function LanguageTab() {
  const { t } = useTranslation()
  const { prefs, setLanguage } = useViewPrefs()
  const toast = useToast()
  return (
    <Card title={t('language.title')} subtitle={t('language.help')}>
      <fieldset>
        <legend className="sr-only">{t('language.title')}</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LANGUAGES.map((l) => (
            <label key={l.code} lang={l.code} dir={l.dir} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${prefs.language === l.code ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <input type="radio" name="language" value={l.code} checked={prefs.language === l.code} onChange={() => { setLanguage(l.code); toast(t('language.saved', { lng: l.code, name: l.native })) }} />
              <span><span className="block text-sm font-semibold text-navy">{l.native}</span><span className="block text-xs text-slate-500" lang="en" dir="ltr">{l.label}{l.dir === 'rtl' ? ' · RTL' : ''}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-3 text-xs text-slate-500">{t('language.rtl')} {t('language.dataNote')}</p>
    </Card>
  )
}

const PROVIDERS = INTEGRATIONS.filter((i) => !i.llm)

export function IntegrationsSummary() {
  const state = usePlatform(() => platform.integrations())
  const rows = PROVIDERS.map((def) => ({ def, view: state.data?.integrations.find((i) => i.id === def.id) }))
  const connected = rows.filter((r) => r.view?.status === 'connected' && r.def.auth !== 'builtin').length
  return (
    <Card title="Connection status" subtitle="Verified by the server. Credentials are managed only on the Integrations page." aside={<Link to="/app/integrations" className="inline-flex h-9 items-center gap-1 rounded-xl bg-brand-700 px-3 text-sm font-semibold text-white">Open Integrations <Icon name="arrowRight" className="h-4 w-4 rtl:rotate-180" /></Link>}>
      {!state.data ? <Feedback state={state} /> : (
        <>
          <p className="mb-2 text-sm text-slate-600">{connected} external provider(s) connected.</p>
          <DataTable caption="Integration status" rowKey={(r) => r.def.id} rows={rows} columns={[
            { key: 'name', label: 'Provider', render: (r) => <span className="font-semibold text-navy">{r.def.name}</span> },
            { key: 'cat', label: 'Category', render: (r) => <span className="text-slate-600">{r.def.category}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusPill tone={STATUS[r.view?.status]?.tone ?? 'slate'}>{r.view?.statusLabel ?? STATUS[r.view?.status]?.label ?? 'Not connected'}</StatusPill> },
            { key: 'sync', label: 'Last sync', render: (r) => <span className="text-xs text-slate-500">{r.view?.lastSyncAt ? formatDateTime(r.view.lastSyncAt) : '—'}</span> },
            { key: 'manage', label: '', render: () => <Link to="/app/integrations" className="text-sm font-semibold text-brand-800 hover:underline">Manage</Link> },
          ]} />
        </>
      )}
    </Card>
  )
}
