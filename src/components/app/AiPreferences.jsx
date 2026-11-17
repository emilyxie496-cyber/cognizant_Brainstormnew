/*
  Settings → AI. Everything about AI models lives here: connecting a provider,
  choosing which one the Agent Hub uses, and deciding what data it may see.

  Connecting takes only an API key. The server checks the key with the provider
  and picks a current model from the list that key offers; the model can be
  changed afterwards from the dropdown on the provider's row.
*/
import { useState } from 'react'
import { INTEGRATIONS, STATUS } from '../../../shared/integrations.js'
import { platform } from '../../services/api.js'
import { Badge, Button, Icon } from '../ui.jsx'
import { Card, Modal, Notice, TextInput, useToast } from './kit.jsx'
import { Feedback, usePlatform } from './PlatformKit.jsx'

const PROVIDERS = INTEGRATIONS.filter((i) => i.llm)
const SHARING = [
  { id: 'financial', label: 'Financial data', blurb: 'Spend, costs and accounting records.' },
  { id: 'customers', label: 'Customer data', blurb: 'CRM commitments and store orders.' },
  { id: 'inventory', label: 'Inventory data', blurb: 'Stock levels and open-order demand.' },
]

/** A small dialog that asks for one thing: the key. */
function KeyDialog({ provider, onClose, onConnected }) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!apiKey.trim()) return setError('Paste the API key first.')
    setBusy(true)
    setError('')
    try {
      const { integration } = await platform.connect(provider.id, { apiKey: apiKey.trim() })
      if (integration.status === 'connected') onConnected(integration)
      else setError(integration.health)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="sm" title={`Connect ${provider.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="API key" type="password" autoComplete="off" autoFocus placeholder={`Paste your ${provider.vendor} key`} value={apiKey} onChange={setApiKey} error={error || undefined} />
        <p className="text-xs text-slate-500">Waymark checks the key with {provider.vendor} and picks a model for you. The key is encrypted on the server and is never shown again.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Checking…' : 'Save and connect'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function ProviderRow({ def, view, busy, onKey, onModel, onRemove, onTest }) {
  const status = STATUS[view?.status] ?? STATUS.not_connected
  const hasKey = Boolean(view?.keySource)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-300"><Icon name={def.icon} className="h-[18px] w-[18px]" /></span>
      <div className="min-w-40 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-navy">{def.name}</h3>
          <Badge tone={status.tone}>{view?.statusLabel ?? 'Checking…'}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {view?.health ?? def.vendor}
          {view?.keySource === 'server' && ' Key set on the server.'}
          {view?.keySource === 'workspace' && view.secretHint && ` Key ${view.secretHint}.`}
        </p>
      </div>
      {view?.models?.length > 0 && (
        <select aria-label={`${def.name} model`} value={view.model ?? ''} disabled={busy} onChange={(e) => onModel(e.target.value)} className="w-full max-w-56 text-sm sm:w-auto">
          {!view.models.includes(view.model) && <option value={view.model ?? ''}>{view.model ?? 'Choose a model'}</option>}
          {view.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" variant={hasKey ? 'secondary' : 'primary'} disabled={busy} onClick={onKey}><Icon name="key" className="h-4 w-4" /> {view?.keySource === 'workspace' ? 'Replace key' : hasKey ? 'Use my own key' : 'Add key'}</Button>
        {hasKey && <Button size="sm" variant="ghost" disabled={busy} onClick={onTest} aria-label={`Test ${def.name}`}>Test</Button>}
        {view?.hasCredentials && <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} aria-label={`Remove ${def.name} key`}><Icon name="trash" className="h-4 w-4" /></Button>}
      </div>
    </li>
  )
}

export default function AiPreferences({ onSaved }) {
  const toast = useToast()
  const state = usePlatform(async () => ({ ...(await platform.aiProviders()), integrations: (await platform.integrations()).integrations }))
  const [adding, setAdding] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const data = state.data
  const viewOf = (id) => data?.integrations.find((i) => i.id === id)

  const run = async (action, done) => {
    setBusy(true)
    try {
      const result = await action()
      await state.reload()
      onSaved?.()
      if (done) toast(typeof done === 'function' ? done(result) : done)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const connected = async (integration) => {
    const def = adding
    setAdding(null)
    // The first provider you connect becomes the one the Agent Hub uses.
    if (!data.preferred) await platform.saveSettings({ aiProvider: def.id }).catch(() => {})
    await state.reload()
    onSaved?.()
    toast(`${def.name} connected. Using ${integration.model}.`)
  }

  const savePreferences = async (e) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setSaved('')
    await run(() => platform.saveSettings({ aiProvider: form.get('provider') || null, sharing: Object.fromEntries(SHARING.map((s) => [s.id, form.get(s.id) === 'on'])) }))
    setSaved('AI preferences saved.')
  }

  return (
    <div className="space-y-3">
      {!data && <Feedback state={state} />}
      <Card title="AI models" subtitle="Add a key to connect a provider. Waymark picks a model automatically; change it here if you prefer another.">
        <section aria-label="AI models">
          <ul className="divide-y divide-slate-100">
            {PROVIDERS.map((def) => (
              <ProviderRow
                key={def.id} def={def} view={viewOf(def.id)} busy={busy || state.loading}
                onKey={() => setAdding(def)}
                onModel={(model) => run(() => platform.connect(def.id, { model }), `${def.name} now uses ${model}.`)}
                onTest={() => run(() => platform.test(def.id), (r) => r.detail)}
                onRemove={() => run(() => platform.disconnect(def.id), `${def.name} key removed.`)}
              />
            ))}
          </ul>
        </section>
        {data?.integrations && !PROVIDERS.some((p) => viewOf(p.id)?.status === 'connected') && (
          <p className="mt-2 text-xs text-slate-500">No provider is connected. The Agent Hub still works with the built-in planner, which runs inside Waymark.</p>
        )}
      </Card>

      <Card tour="ai-preferences" title="AI preferences" subtitle="Which model the Agent Hub uses, and what it may see.">
        {saved && <Notice tone="good" className="mb-3">{saved}</Notice>}
        {data && (
          <form key={`${JSON.stringify(data.sharing)}${data.preferred}`} onSubmit={savePreferences} className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div>
              <label htmlFor="ai-preferred-provider" className="text-sm font-semibold text-navy">Preferred provider</label>
              <select id="ai-preferred-provider" name="provider" defaultValue={data.preferred ?? ''} className="mt-1 w-full text-sm">
                <option value="">Built-in planner (no AI provider)</option>
                {data.providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.ready ? (p.model ? ` · ${p.model}` : '') : ` · ${p.statusLabel}`}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">The provider you choose receives your task and the tool results needed to answer it. The built-in planner sends nothing outside Waymark.</p>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-navy">Data the AI provider may receive</legend>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-3">
                {SHARING.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-start gap-2 py-1.5 text-sm">
                    <input type="checkbox" name={s.id} defaultChecked={data.sharing[s.id]} className="mt-0.5" />
                    <span><span className="font-medium text-navy">{s.label}</span><span className="block text-xs text-slate-500">{s.blurb}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="lg:col-span-2"><Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save AI preferences'}</Button></div>
          </form>
        )}
      </Card>

      {adding && <KeyDialog provider={adding} onClose={() => setAdding(null)} onConnected={connected} />}
    </div>
  )
}
