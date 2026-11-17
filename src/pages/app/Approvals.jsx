import { useState } from 'react'
import { platform } from '../../services/api.js'
import { Card, Empty, Notice, PageHeader } from '../../components/app/kit.jsx'
import { Badge, Button } from '../../components/ui.jsx'
import { Evidence, Feedback, usePlatform } from '../../components/app/PlatformKit.jsx'

export default function Approvals() {
  const state = usePlatform(platform.approvals)
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState('')
  async function decide(id, decision) {
    setBusy(id); setMessage('')
    try { const { approval } = await platform.decide(id, decision, notes[id]); setMessage(approval.result?.detail ?? `Request ${approval.status}.`); await state.reload() }
    catch (e) { setMessage(e.message) } finally { setBusy(null) }
  }
  const rows = [...(state.data?.approvals ?? [])].sort((a,b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
  return <div className="space-y-3"><PageHeader title="Approvals">Review proposed external actions. Only owners and admins can decide; approval may send a message to the configured destination.</PageHeader><Feedback state={state} />{message && <Notice>{message}</Notice>}{!state.loading && !rows.length && <Empty title="No approval requests">An investigation can prepare a message for your review.</Empty>}
    {rows.map(a => <Card key={a.id} title={a.title} aside={<Badge tone={a.status === 'pending' ? 'amber' : 'slate'}>{a.status}</Badge>} subtitle={`${a.action.label} · ${a.createdAt}`}>
      {a.action.preview && <Notice tone="warn">Preview only: the destination is not connected. Approval records your decision but sends nothing.</Notice>}
      <Evidence label="Message preview" value={a.action.message} /><p className="mt-3 text-sm">Reasoning: {a.reasoning}</p><p className="text-sm">Expected consequences: {a.consequences}</p><Evidence value={a.data} /><Evidence label="Audit history" value={a.audit} />
      {a.result && <Notice>{a.result.detail}</Notice>}
      {a.status === 'not_sent' && <p className="text-sm">Nothing was delivered because the destination was unavailable. This is not a successful send.</p>}
      {a.status === 'pending' && (state.data.canDecide ? <div className="mt-3 flex flex-wrap gap-2"><label>Optional note<input className="ml-2 rounded border p-2" maxLength={300} value={notes[a.id] ?? ''} onChange={e => setNotes({ ...notes, [a.id]: e.target.value })} /></label><Button disabled={busy === a.id} onClick={() => decide(a.id,'approve')}>Approve</Button><Button variant="secondary" disabled={busy === a.id} onClick={() => decide(a.id,'reject')}>Reject</Button></div> : <p className="text-sm">Your role cannot approve or reject this request.</p>)}
    </Card>)}
  </div>
}
