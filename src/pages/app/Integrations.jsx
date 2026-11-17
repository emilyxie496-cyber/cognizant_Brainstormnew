/*
  Settings → Integrations: business systems, data import, risk feeds, logistics
  and chat. AI models are managed under Settings → AI.

  Each provider is one compact row. Everything else (credentials, actions,
  permissions, notification choices, history) opens in a dialog, so the list
  stays short enough to scan.

  A status shown here is always the server's: "Connected" means a provider call
  succeeded with the stored credentials.
*/
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { INTEGRATIONS, INTEGRATION_CATEGORIES, NOTIFICATION_CATEGORIES, STATUS } from '../../../shared/integrations.js'
import ImportWizard from '../../components/app/ImportWizard.jsx'
import { Modal, Notice, PageHeader, SelectInput, TextInput, useToast } from '../../components/app/kit.jsx'
import { Feedback, usePlatform } from '../../components/app/PlatformKit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'

const PROVIDERS = INTEGRATIONS.filter((i) => !i.llm)
const CATEGORIES = INTEGRATION_CATEGORIES.filter((c) => c.id !== 'ai')
const OAUTH_ERRORS = {
  state: 'The sign-in link expired or was already used. Start again.',
  denied: 'Access was refused on the provider\'s consent screen.',
  exchange: 'The provider did not complete the sign-in. Check the server configuration.',
  verify: 'The sign-in finished, but the connection could not be verified.',
  callback: 'The provider\'s response was not valid.',
}
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : null)
const LIVE = ['connected', 'demo', 'syncing']

function Row({ def, view, onOpen }) {
  const status = STATUS[view?.status] ?? STATUS.not_connected
  const live = LIVE.includes(view?.status)
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${live ? 'bg-brand-100 text-brand-300' : 'bg-slate-100 text-slate-500'}`}><Icon name={def.icon} className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="text-sm font-bold text-navy">{def.name}</h3>
          <Badge tone={status.tone} className="px-2 py-0 text-[0.6875rem]">{view?.statusLabel ?? 'Checking…'}</Badge>
        </div>
        <p className="truncate text-xs text-slate-500" title={def.description}>{view?.lastSyncAt && live ? `Last sync ${when(view.lastSyncAt)}` : def.description}</p>
      </div>
      <Button size="sm" variant={live || def.auth === 'none' ? 'secondary' : 'soft'} className="h-8 shrink-0 px-2.5" onClick={onOpen} aria-label={`${def.importer ? 'Import with' : live ? 'Manage' : def.auth === 'none' ? 'View' : 'Connect'} ${def.name}`}>
        {def.importer ? 'Import' : live ? 'Manage' : def.auth === 'none' ? 'Details' : 'Connect'}
      </Button>
    </li>
  )
}

/** Notification choices for Slack and Teams. */
function ChannelSettings({ def, view, prefs, deliveries, busy, act }) {
  const [channel, setChannel] = useState(view?.settings?.channel ?? '')
  const save = (e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    act(() => platform.saveNotifications(def.id, { enabled: f.get('enabled') === 'on', autoSend: f.get('autoSend') === 'on', categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c.id, f.get(c.id) === 'on'])) }), 'Notification choices saved.')
  }
  return (
    <section className="border-t border-slate-200 pt-3">
      <h3 className="text-sm font-bold text-navy">Notifications</h3>
      {def.id === 'slack' && view?.settings?.mode === 'oauth' && (
        <form className="mt-2 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); act(() => platform.configure('slack', { channel }), 'Slack channel saved.') }}>
          <TextInput label="Channel ID" placeholder="C0123456789" value={channel} onChange={setChannel} className="flex-1" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy}>Save</Button>
        </form>
      )}
      <form key={JSON.stringify(prefs)} onSubmit={save} className="mt-2 space-y-2 text-sm">
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <label className="flex items-center gap-2 font-medium text-navy sm:col-span-2"><input type="checkbox" name="enabled" defaultChecked={prefs.enabled} /> Send alerts to {def.name}</label>
          {NOTIFICATION_CATEGORIES.map((c) => <label key={c.id} className="flex items-center gap-2 text-slate-700"><input type="checkbox" name={c.id} defaultChecked={prefs.categories[c.id]} /> {c.label}</label>)}
        </div>
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">
          <input type="checkbox" name="autoSend" defaultChecked={prefs.autoSend} className="mt-0.5" />
          <span><span className="font-semibold">Send without asking each time</span><span className="block text-xs">Off by default. When on, alerts are posted without a per-message approval. Owners and admins only.</span></span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>Save choices</Button>
          <Button size="sm" variant="secondary" disabled={busy || !view?.hasCredentials} onClick={() => act(() => platform.testNotification(def.id), (r) => (r.delivery.status === 'sent' ? `Test message sent to ${r.delivery.destination}.` : r.delivery.detail))}>Send test message</Button>
        </div>
        <p className="text-xs text-slate-500">A test posts a real message. A webhook counts as verified only after one is delivered.</p>
      </form>
      {deliveries.length > 0 && (
        <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-slate-600">
          {deliveries.slice(0, 8).map((d) => <li key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.headline}</span><span className="shrink-0">{d.status.replace('_', ' ')} · {when(d.at)}</span></li>)}
        </ul>
      )}
    </section>
  )
}

function ManageDialog({ def, view, data, onClose, reload, openImport }) {
  const { agentPayload, isDemo } = useWorkspace()
  const toast = useToast()
  const [fields, setFields] = useState({ shop: view?.settings?.shop ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activity, setActivity] = useState(null)
  const status = STATUS[view?.status] ?? STATUS.not_connected
  const connected = view?.status === 'connected'

  useEffect(() => {
    let live = true
    platform.activity(def.id).then((a) => live && setActivity(a)).catch(() => live && setActivity({ events: [] }))
    return () => { live = false }
  }, [def.id, view?.status, view?.lastSyncAt])

  /** Runs one action, refreshes the list and reports the outcome. Failures stay in the dialog. */
  const act = async (action, done) => {
    setBusy(true)
    setError('')
    try {
      const result = await action()
      if (result?.authorizeUrl) return window.location.assign(result.authorizeUrl)
      await reload()
      const failed = result?.test?.ok === false || result?.ok === false || result?.job?.status === 'error'
      const detail = result?.test?.detail ?? result?.detail ?? result?.job?.error
      if (failed) setError(detail ?? 'That did not work.')
      else toast(typeof done === 'function' ? done(result) : done ?? detail ?? 'Done.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const hasForm = ['apikey', 'webhook'].includes(def.auth) && def.fields?.length
  const oauth = def.auth === 'oauth' || (def.oauthOptional && view?.oauthReady)

  return (
    <Modal open title={def.name} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={status.tone}>{view?.statusLabel ?? 'Checking…'}</Badge><span className="text-xs text-slate-500">{def.vendor}{view?.lastSyncAt ? ` · last sync ${when(view.lastSyncAt)}` : ''}</span></div>
          <p className="mt-1.5 text-slate-700">{view?.health ?? def.description}</p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {def.notice && <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{def.notice}</p>}

        {def.importer && <Button size="sm" onClick={openImport}><Icon name="upload" className="h-4 w-4" /> Import a file</Button>}

        {hasForm && !view?.demo && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act(() => platform.connect(def.id, fields), (r) => r.test?.detail ?? 'Saved.') }}>
            {def.fields.map((f) => (
              <TextInput key={f.key} label={f.label} hint={f.hint} type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.secret && view?.secretHint ? `Saved (${view.secretHint}). Paste to replace.` : f.placeholder} value={fields[f.key] ?? ''} onChange={(v) => setFields((x) => ({ ...x, [f.key]: v }))} />
            ))}
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Checking…' : view?.hasCredentials ? 'Save and re-check' : 'Save and connect'}</Button>
          </form>
        )}

        {oauth && !view?.demo && (
          <div>
            {def.auth === 'oauth' && view?.requirement
              ? <Notice tone="warn">{view.requirement}</Notice>
              : <Button size="sm" variant={hasForm ? 'secondary' : 'primary'} disabled={busy} onClick={() => act(() => platform.connect(def.id, { ...fields, mode: 'oauth' }))}>{connected ? 'Sign in again' : `Sign in with ${def.vendor}`}</Button>}
            {def.setup && <p className="mt-1.5 text-xs text-slate-500">{def.setup}</p>}
            {view?.redirectUri && def.auth === 'oauth' && <p className="mt-1 text-xs break-all text-slate-500">Redirect URI: <code>{view.redirectUri}</code></p>}
          </div>
        )}

        {!def.importer && (
          <div className="flex flex-wrap gap-1.5">
            {def.auth !== 'none' && view?.hasCredentials && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => platform.test(def.id))}>Test connection</Button>}
            {def.auth === 'none' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => platform.test(def.id))}>Check now</Button>}
            {def.sync && LIVE.includes(view?.status) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => platform.sync(def.id, agentPayload()), (r) => (r.job?.demo ? 'Sample data refreshed.' : `Synchronised: ${Object.entries(r.job?.summary?.counts ?? {}).map(([k, n]) => `${n} ${k}`).join(', ')}.`))}>Sync now</Button>}
            {def.demo && isDemo && !view?.hasCredentials && !view?.demo && <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => platform.demo(def.id, agentPayload()), 'Sample data loaded. This is not a live connection.')}>Use sample data</Button>}
            {def.commercial && !view?.hasCredentials && !view?.demo && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => platform.configure(def.id, { accessRequested: !view?.accessRequested }), view?.accessRequested ? 'Cleared.' : 'Marked as waiting for access.')}>{view?.accessRequested ? 'Clear "access pending"' : 'Mark access requested'}</Button>}
            {(view?.hasCredentials || view?.demo) && <Button size="sm" variant="ghost" className="text-rose-700" disabled={busy} onClick={() => act(() => platform.disconnect(def.id), view?.demo ? 'Sample data removed.' : 'Disconnected. Stored credentials were deleted.')}>{view?.demo ? 'Remove sample data' : 'Disconnect'}</Button>}
          </div>
        )}

        {def.sync && view?.hasCredentials && (
          <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={view.syncEnabled} disabled={busy} onChange={(e) => act(() => platform.configure(def.id, { syncEnabled: e.target.checked }), e.target.checked ? 'Synchronisation on.' : 'Synchronisation paused.')} /> Keep this data synchronised</label>
        )}

        {def.channel && data.preferences?.[def.id] && <ChannelSettings def={def} view={view} prefs={data.preferences[def.id]} deliveries={(data.deliveries ?? []).filter((d) => d.channel === def.id)} busy={busy} act={act} />}

        <details className="border-t border-slate-200 pt-2">
          <summary className="cursor-pointer text-sm font-semibold text-navy">What Waymark accesses</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{def.permissions.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="mt-1.5 text-xs text-slate-500">Used for: {def.features.join(', ')}.</p>
        </details>
        <details className="border-t border-slate-200 pt-2">
          <summary className="cursor-pointer text-sm font-semibold text-navy">Recent activity</summary>
          {!activity ? <p className="mt-1.5 text-xs text-slate-500">Loading…</p> : activity.events.length ? (
            <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto text-xs text-slate-600">{activity.events.slice(0, 12).map((e) => <li key={e.id}><span className="text-slate-500">{when(e.at)}</span> · {e.detail || e.type.replace(/_/g, ' ')}</li>)}</ul>
          ) : <p className="mt-1.5 text-xs text-slate-500">Nothing yet.</p>}
        </details>
      </div>
    </Modal>
  )
}

export default function Integrations({ embedded = false }) {
  const [params] = useSearchParams()
  const state = usePlatform(async () => ({ ...(await platform.integrations()), ...(await platform.notifications()) }))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const [importing, setImporting] = useState(false)
  const data = state.data
  const viewOf = (id) => data?.integrations.find((i) => i.id === id)
  const q = query.trim().toLowerCase()
  const shown = PROVIDERS.filter((d) => (!status || viewOf(d.id)?.status === status) && (!q || `${d.name} ${d.vendor} ${d.description}`.toLowerCase().includes(q)))
  const liveCount = PROVIDERS.filter((d) => d.auth !== 'builtin' && viewOf(d.id)?.status === 'connected').length
  const intro = 'Connect your business systems, risk feeds and chat. A provider shows as Connected only after a successful check.'

  return (
    <div className="space-y-3">
      {embedded
        ? <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-bold text-navy">Integrations</h2><p className="text-sm text-slate-600">{intro}</p></div>{data && <Badge tone={liveCount ? 'emerald' : 'slate'}>{liveCount} connected</Badge>}</div>
        : <PageHeader title="Integrations">{intro}</PageHeader>}
      <p className="text-xs text-slate-500">Looking for Claude, GPT, Gemini or Grok? AI models are under <Link to="/app/settings?tab=ai" className="font-semibold text-brand-800 underline">Settings → AI</Link>.</p>
      {!data && <Feedback state={state} />}
      {data && state.error && <Notice tone="error">{state.error}</Notice>}
      {params.get('error') && <Notice tone="error">{OAUTH_ERRORS[params.get('error')] ?? 'The sign-in did not complete. Start again from the provider\'s row.'}</Notice>}
      {params.get('connected') && <Notice tone="good">Sign-in finished for {INTEGRATIONS.find((i) => i.id === params.get('connected'))?.name ?? 'the provider'}. Its verified status is shown below.</Notice>}
      {data?.credentialStorage === 'temporary' && <Notice tone="warn">The server could not save an encryption key, so stored credentials will need re-entering after a restart.</Notice>}

      <div data-tour="integration-filters" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <TextInput label="Search" placeholder="Provider or what it does" value={query} onChange={setQuery} />
        <SelectInput label="Status" placeholder="All statuses" value={status} onChange={setStatus} options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
      </div>

      <div data-tour="feature-integrations" className="space-y-4">
        {CATEGORIES.filter((c) => shown.some((d) => d.category === c.id)).map((c) => (
          <section key={c.id} aria-labelledby={`integrations-${c.id}`}>
            <h2 id={`integrations-${c.id}`} className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{c.label}</h2>
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {shown.filter((d) => d.category === c.id).map((d) => <Row key={d.id} def={d} view={viewOf(d.id)} onOpen={() => (d.importer ? setImporting(true) : setOpen(d.id))} />)}
            </ul>
          </section>
        ))}
      </div>
      {!shown.length && <Notice>No integrations match. Clear the search or choose another status.</Notice>}

      {open && data && <ManageDialog def={PROVIDERS.find((d) => d.id === open)} view={viewOf(open)} data={data} onClose={() => setOpen(null)} reload={state.reload} openImport={() => { setOpen(null); setImporting(true) }} />}
      {importing && <Modal open title="Import business records" onClose={() => setImporting(false)} wide><ImportWizard onComplete={state.reload} /></Modal>}
    </div>
  )
}
