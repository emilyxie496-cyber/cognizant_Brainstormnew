// Approvals: a list/detail review workspace. Decisions are authorized and executed only by the server.
import { useEffect, useState } from 'react'
import { platform } from '../../services/api.js'
import { BoundedList, Card, CollapsiblePanel, CompactPageHeader, Empty, Metric, MetricGrid, Notice, Segmented, StatusPill } from '../../components/app/kit.jsx'
import { Badge, Button } from '../../components/ui.jsx'
import { Evidence, Feedback, usePlatform } from '../../components/app/PlatformKit.jsx'
import { formatDateTime } from '../../i18n/index.js'

const TONE = { pending: 'amber', executed: 'emerald', approved: 'emerald', rejected: 'slate', failed: 'rose', not_sent: 'rose', expired: 'slate' }
const levelOf = (a) => a.action?.message?.facts?.find?.(([k]) => k === 'Risk')?.[1] ?? null

export default function Approvals() {
  const state = usePlatform(platform.approvals)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [selectedId, setSelectedId] = useState(null)
  const all = state.data?.approvals ?? []
  const rows = all.filter((a) => filter === 'all' || (filter === 'pending' ? a.status === 'pending' : a.status !== 'pending'))
  const selected = all.find((a) => a.id === selectedId) ?? rows[0] ?? null
  useEffect(() => setNote(''), [selected?.id])

  async function decide(decision) {
    setBusy(true); setMessage(null)
    try {
      const { approval } = await platform.decide(selected.id, decision, note)
      setMessage({ tone: approval.status === 'failed' || approval.status === 'not_sent' ? 'warn' : 'good', text: approval.result?.detail ?? `Request ${approval.status}.` })
      await state.reload()
    } catch (e) { setMessage({ tone: 'error', text: e.message }) } finally { setBusy(false) }
  }
  const count = (s) => all.filter((a) => a.status === s).length

  return (
    <div className="space-y-3">
      <CompactPageHeader title="Approvals" description="Review proposed external actions. Only owners and admins can decide; approving may send a message to the configured destination." />
      <Feedback state={state} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {state.data && !state.data.canDecide && <Notice tone="info">Your role can review requests but cannot approve or reject them.</Notice>}
      {state.data && <>
        <MetricGrid max={4}>
          <Metric label="Pending" value={count('pending')} tone={count('pending') ? 'warn' : 'good'} />
          <Metric label="Sent" value={count('executed')} />
          <Metric label="Rejected" value={count('rejected')} />
          <Metric label="Not sent or failed" value={count('not_sent') + count('failed')} tone={count('not_sent') + count('failed') ? 'bad' : 'default'} />
        </MetricGrid>
        {!all.length ? <Empty title="No approval requests">An investigation can prepare a message for your review.</Empty> : (
          <div className="grid gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <Card padded>
              <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'pending', label: 'Pending' }, { value: 'history', label: 'History' }, { value: 'all', label: 'All' }]} />
              <BoundedList maxHeight="34rem" label="Approval requests" className="mt-2">
                <ul className="space-y-1.5">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <button type="button" aria-current={selected?.id === a.id ? 'true' : undefined} onClick={() => setSelectedId(a.id)} className={`w-full rounded-xl border p-2.5 text-start ${selected?.id === a.id ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-200'}`}>
                        <span className="flex flex-wrap items-center gap-1.5"><StatusPill tone={TONE[a.status] ?? 'slate'}>{a.status.replace('_', ' ')}</StatusPill>{levelOf(a) && <Badge tone={levelOf(a) === 'High' ? 'rose' : 'amber'}>{levelOf(a)}</Badge>}<span className="text-xs text-slate-500">{a.action.label}</span></span>
                        <span className="mt-1 line-clamp-2 block text-sm font-medium text-navy">{a.title}</span>
                        <span className="block text-xs text-slate-500">{formatDateTime(a.createdAt)}{a.runId ? ' · from an investigation' : ''}</span>
                      </button>
                    </li>
                  ))}
                  {!rows.length && <li className="py-3 text-sm text-slate-500">Nothing here.</li>}
                </ul>
              </BoundedList>
            </Card>

            {selected && (
              <Card title={selected.title} subtitle={`${selected.action.label} · requested ${formatDateTime(selected.createdAt)} by ${selected.createdBy}`} aside={<StatusPill tone={TONE[selected.status] ?? 'slate'}>{selected.status.replace('_', ' ')}</StatusPill>}>
                <div className="space-y-3">
                  {selected.action.preview && <Notice tone="warn">Preview only: the destination is not connected. Approval records your decision but sends nothing.</Notice>}
                  <section aria-label="Proposed action" className="rounded-xl border border-brand-200 bg-brand-50 p-3">
                    <p className="text-xs font-semibold tracking-wide text-brand-800 uppercase">Proposed action</p>
                    <p className="mt-1 text-sm font-medium text-navy">{selected.action.message?.headline}</p>
                    {(selected.action.message?.facts ?? []).map(([k, v]) => <p key={k} className="text-sm text-slate-700"><span className="text-slate-500">{k}:</span> {v}</p>)}
                    <p className="mt-2 text-xs text-slate-600">Consequences: {selected.consequences}</p>
                  </section>
                  <section aria-label="Supporting reasoning">
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Supporting reasoning</p>
                    <p className="text-sm text-slate-700">{selected.reasoning || 'No reasoning was recorded.'}</p>
                  </section>
                  <CollapsiblePanel title="Business evidence" summary="Records the request was based on"><Evidence value={selected.data} label="Supporting records" /></CollapsiblePanel>
                  <CollapsiblePanel title="Message preview" summary="Exactly what would be posted"><pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap">{selected.action.message?.text}</pre></CollapsiblePanel>
                  <CollapsiblePanel title="Audit trail" summary={`${selected.audit?.length ?? 0} event(s)`}>
                    <ol className="space-y-1 text-xs">{(selected.audit ?? []).map((e, i) => <li key={i}><strong className="text-navy">{e.event}</strong> · {e.actor} · {formatDateTime(e.at)}{e.note ? ` · ${e.note}` : ''}</li>)}</ol>
                  </CollapsiblePanel>
                  {selected.result && <Notice tone={selected.status === 'executed' ? 'good' : 'warn'}>{selected.result.detail}</Notice>}
                  {selected.status === 'not_sent' && <p className="text-sm text-rose-700">Nothing was delivered because the destination was unavailable. This is not a successful send.</p>}
                  {selected.status === 'pending' && state.data.canDecide && (
                    <div className="sticky bottom-2 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                      <label className="block text-sm font-semibold text-navy" htmlFor="approval-note">Optional note</label>
                      <input id="approval-note" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => decide('approve')}>Approve</Button><Button variant="secondary" disabled={busy} onClick={() => decide('reject')}>Reject</Button></div>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}
      </>}
    </div>
  )
}
