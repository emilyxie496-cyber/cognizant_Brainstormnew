/*
  AI Trade Analyst. Three panels: what the user picked, the conversation, and
  the business impact worked out from their own records.

  The impact panel and every figure come from fixed rules in engine/analyst.js.
  AI, when set up, only rewords those findings, and its text is checked so it
  cannot introduce a number. Without AI the same findings are written out by
  the rule-based answer, so the page always works.
*/
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { COUNTRIES } from '../../../shared/countries.js'
import { formatCo2e } from '../../../shared/emissions.js'
import { findPlace } from '../../../shared/places.js'
import { useAddToAnalyst } from '../../components/app/AnalyzeButton.jsx'
import { Card, DemoTag, Notice, PageHeader, ProvenanceTag, SelectInput, Spinner, formatDate } from '../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { ITEM_TYPES, aiFindings, buildFindings, nextSteps, ruleAnswer, suggestedQuestions } from '../../engine/analyst.js'
import { api } from '../../services/api.js'
import { DRAG_TYPE, MAX_ITEMS, readDrop, useAnalyst } from '../../state/analystContext.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money } from '../../utils/format.js'

const PICK_TYPES = [
  { value: 'shipment', label: 'Shipment' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'product', label: 'Product' },
  { value: 'alert', label: 'Risk alert' },
  { value: 'hub', label: 'Port or airport' },
  { value: 'country', label: 'Country' },
  { value: 'warehouse', label: 'Warehouse' },
]

/** Records of one type that can be added, limited to this company's own data and the places it uses. */
function useChoices(type, model) {
  return useMemo(() => {
    if (type === 'shipment') return model.shipments.map((s) => ({ value: s.id, label: `${s.reference} · ${s.supplier?.name ?? 'Export'}` }))
    if (type === 'supplier') return model.suppliers.map((s) => ({ value: s.id, label: `${s.name} · ${s.countryInfo?.name ?? s.country}` }))
    if (type === 'product') return model.products.map((p) => ({ value: p.id, label: p.name }))
    if (type === 'alert') return model.alerts.map((a) => ({ value: a.id, label: a.title }))
    if (type === 'warehouse') return model.warehouses.map((w) => ({ value: w.id, label: w.name }))
    if (type === 'country') {
      const used = new Set(model.suppliers.map((s) => s.country))
      return COUNTRIES.map((c) => ({ value: c.code, label: used.has(c.code) ? `${c.name} (you source here)` : c.name })).sort((a, b) => b.label.includes('(') - a.label.includes('(') || a.label.localeCompare(b.label))
    }
    const hubs = new Set(model.shipments.flatMap((s) => s.legs.flatMap((l) => [l.from?.code, l.to?.code])).filter(Boolean))
    return [...hubs].map(findPlace).filter(Boolean).map((h) => ({ value: h.code, label: h.name }))
  }, [type, model])
}

function AddFromRecords({ disabled }) {
  const { model } = useWorkspace()
  const addTo = useAddToAnalyst()
  const [type, setType] = useState('shipment')
  const [id, setId] = useState('')
  const choices = useChoices(type, model)
  return (
    <form
      className="mt-3 space-y-2 border-t border-slate-100 pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (id) addTo(type, id)
        setId('')
      }}
    >
      <SelectInput label="Add from your records" placeholder={null} value={type} onChange={(v) => { setType(v); setId('') }} options={PICK_TYPES} />
      <SelectInput label={ITEM_TYPES[type].label} placeholder={choices.length ? 'Choose…' : 'None on record'} value={id} onChange={setId} options={choices} />
      <Button type="submit" variant="secondary" size="sm" disabled={!id || disabled}><Icon name="plus" className="h-4 w-4" /> Add to context</Button>
    </form>
  )
}

function ContextPanel() {
  const { items, remove, clear } = useAnalyst()
  const addTo = useAddToAnalyst()
  const [over, setOver] = useState(false)
  return (
    <Card
      tour="feature-analyst"
      title="Context"
      subtitle={`${items.length} of ${MAX_ITEMS} items. Kept as you move around Waymark.`}
      aside={items.length > 0 && <button type="button" onClick={clear} className="text-sm font-semibold text-brand-800 hover:underline">Clear</button>}
    >
      <div
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); const data = readDrop(e); if (data) { e.preventDefault(); addTo(data.type, data.id, data.extra) } }}
        className={`rounded-xl border border-dashed p-2 ${over ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
      >
        {items.length ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-300"><Icon name={ITEM_TYPES[item.type].icon} className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{ITEM_TYPES[item.type].label}</p>
                    <p className="text-sm font-semibold break-words text-navy">{item.title}</p>
                  </div>
                  <button type="button" aria-label={`Remove ${item.title}`} onClick={() => remove(item.key)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-navy"><Icon name="close" className="h-4 w-4" /></button>
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.summary}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                  <span>Source: {item.source}</span>
                  {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
                  {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-800 hover:underline">Open article</a> : item.link ? <Link to={item.link} className="font-semibold text-brand-800 hover:underline">Open record</Link> : null}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 py-4 text-center text-sm text-slate-600">Nothing selected yet. Use “Analyze with AI” on a shipment, alert or headline, drag one here, or add a record below.</p>
        )}
      </div>
      <AddFromRecords disabled={items.length >= MAX_ITEMS} />
    </Card>
  )
}

const KIND = { actual: 'actual', derived: 'derived', assumption: 'assumption', midpoint: 'midpoint', missing: 'missing' }

function ImpactRow({ label, children, kind }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800 tabular-nums">{children}{kind && <ProvenanceTag kind={KIND[kind] ?? 'missing'} />}</dd>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <details open className="group border-b border-slate-100 py-2 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}<Icon name="chevronDown" className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
      <div className="mt-1.5">{children}</div>
    </details>
  )
}

function ImpactPanel({ findings, hasItems }) {
  const navigate = useNavigate()
  const { model } = useWorkspace()
  if (!hasItems) return <Card title="Business impact"><p className="text-sm text-slate-600">Add context to see which of your records are involved. Nothing here is filled with placeholder numbers.</p></Card>
  const f = findings
  const steps = nextSteps(f)
  const go = (step) => {
    if (step.to === 'delay') {
      const s = model.shipments.find((x) => x.reference === step.reference)
      if (s) navigate(`/app/shipments/${s.id}/resolve`)
    } else if (step.to) navigate(step.to)
  }
  return (
    <Card title="Business impact" subtitle="Worked out from your records by fixed rules.">
      <Section title={`Involved shipments (${f.shipments.length})`}>
        {f.shipments.length ? (
          <ul className="space-y-1.5 text-sm">
            {f.shipments.map((s) => <li key={s.id}><span className="font-semibold text-navy">{s.reference}</span> <Badge tone={s.status === 'Delayed' ? 'rose' : 'slate'}>{s.status}</Badge><br /><span className="text-xs text-slate-500">{s.why} · ETA {s.eta ? formatDate(s.eta) : 'unknown'}</span></li>)}
          </ul>
        ) : <p className="text-sm text-slate-600">None identified.</p>}
      </Section>
      <Section title={`Involved suppliers (${f.suppliers.length})`}>
        {f.suppliers.length ? (
          <ul className="space-y-1.5 text-sm">
            {f.suppliers.map((s) => <li key={s.id}><span className="font-semibold text-navy">{s.name}</span> <span className="text-slate-600">· {s.country} · {s.sourcingSharePct}% of sourcing</span><br /><span className="text-xs text-slate-500">{s.why}</span></li>)}
          </ul>
        ) : <p className="text-sm text-slate-600">None identified.</p>}
      </Section>
      {(f.money.activeShipmentFreightCad.value != null || f.money.supplierAnnualSpendCad.value != null) && (
        <Section title="Financial exposure">
          <dl>
            {f.money.activeShipmentFreightCad.value != null && <ImpactRow label="Freight on involved active shipments" kind="actual">{money(f.money.activeShipmentFreightCad.value)}</ImpactRow>}
            {f.money.supplierAnnualSpendCad.value ? <ImpactRow label="Yearly spend with involved suppliers" kind="derived">{money(f.money.supplierAnnualSpendCad.value)}</ImpactRow> : null}
            {f.money.sourcingSharePct.value != null && <ImpactRow label="Share of your sourcing" kind="derived">{f.money.sourcingSharePct.value}%</ImpactRow>}
          </dl>
        </Section>
      )}
      <Section title="Inventory and timing">
        <dl>
          <ImpactRow label="Days of stock (company-wide)" kind={f.inventory.kind}>{f.inventory.daysOfStock ?? 'Not recorded'}</ImpactRow>
          {f.timing.earliestEta && <ImpactRow label="Earliest involved ETA" kind="actual">{formatDate(f.timing.earliestEta)}</ImpactRow>}
          {f.timing.delayedShipments.length > 0 && <ImpactRow label="Already delayed" kind="actual">{f.timing.delayedShipments.join(', ')}</ImpactRow>}
        </dl>
      </Section>
      {f.scenario && (
        <Section title="Scenario estimate">
          <p className="text-sm text-slate-700">A {f.scenario.delayDays}-day delay at {f.scenario.supplier}, from {f.scenario.daysChosenBy}. <ProvenanceTag kind="assumption" /></p>
          <dl className="mt-1">
            <ImpactRow label="Days without stock">{f.scenario.inventoryShortfallDays}</ImpactRow>
            <ImpactRow label="Cost over twelve months">{money(f.scenario.totalCostCad)}</ImpactRow>
          </dl>
          <ul className="mt-1.5 space-y-1 text-sm">
            {f.scenario.options.map((o) => <li key={o.name} className="flex flex-wrap justify-between gap-x-2"><span className="text-slate-700">{o.name}{o.name === f.scenario.lowestCost && <> <Badge tone="emerald">Lowest cost</Badge></>}</span><span className="text-slate-500 tabular-nums">{money(o.totalCad)}{o.co2eChangeKg ? ` · ${o.co2eChangeKg > 0 ? '+' : '−'}${formatCo2e(Math.abs(o.co2eChangeKg))}` : ''}</span></li>)}
          </ul>
          <p className="mt-1 text-xs text-slate-500">Scenario estimates over twelve months, not forecasts. Open the Risk Simulator to change the inputs.</p>
        </Section>
      )}
      {f.carbon.activeShipmentKg ? <Section title="Carbon"><dl><ImpactRow label="Transport emissions of involved shipments" kind="derived">{formatCo2e(f.carbon.activeShipmentKg)}</ImpactRow></dl></Section> : null}
      <Section title="Options to consider">
        <ul className="space-y-1.5">
          {steps.map((s) => (
            <li key={s.label} className="text-sm">
              {s.to ? <button type="button" onClick={() => go(s)} className="inline-flex items-start gap-1 text-left font-semibold text-brand-800 hover:underline">{s.label} <Icon name="arrowRight" className="mt-0.5 h-4 w-4 shrink-0" /></button> : <span className="text-slate-700">{s.label}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-slate-500">These are options, not decisions. Nothing is booked, sent or changed for you.</p>
      </Section>
      {(f.unknowns.length > 0 || f.notes.length > 0) && (
        <Section title="Confidence and missing information">
          <ul className="space-y-1 text-sm text-slate-700">
            {[...f.notes, ...f.unknowns].map((u) => <li key={u} className="flex gap-1.5"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />{u}</li>)}
          </ul>
        </Section>
      )}
    </Card>
  )
}

export default function Analyst() {
  const { model, isDemo, health } = useWorkspace()
  const { items, messages, say, clearChat } = useAnalyst()
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const aiReady = Boolean(health?.integrations?.assistant)
  const lastQuestion = [...messages].reverse().find((m) => m.role === 'user')?.text ?? ''
  const findings = useMemo(() => buildFindings(items, model, question || lastQuestion), [items, model, question, lastQuestion])

  const ask = async (text) => {
    const q = text.trim()
    if (q.length < 3 || busy) return
    setQuestion('')
    say({ role: 'user', text: q })
    const found = buildFindings(items, model, q)
    const rules = ruleAnswer(q, items, found)
    if (!aiReady || !items.length) return say({ role: 'assistant', text: rules, by: 'rules' })

    setBusy(true)
    const mine = ++request.current
    try {
      const res = await api.analyst({ question: q, context: items.map(({ type, title, summary, source, facts }) => ({ type, title, summary, source, facts })), findings: aiFindings(found) })
      if (mine !== request.current) return
      if (res.text) say({ role: 'assistant', text: res.text, by: 'ai', check: rules })
      else say({ role: 'assistant', text: rules, by: 'rules', note: 'The AI answer contained a figure that could not be checked against your records, so the rule-based answer is shown.' })
    } catch (err) {
      if (mine !== request.current) return
      say({ role: 'assistant', text: rules, by: 'rules', note: `The AI service is unavailable (${err.message}). This answer is written from your records by fixed rules.` })
    } finally {
      if (mine === request.current) setBusy(false)
    }
  }

  const cancel = () => {
    request.current += 1
    setBusy(false)
    say({ role: 'assistant', text: 'Stopped. Ask again when you are ready.', by: 'rules' })
  }

  return (
    <div>
      <PageHeader title="AI Trade Analyst" badge={isDemo && <DemoTag />}>
        Pick shipments, suppliers, headlines or places, then ask how they could affect your business. Figures come from your records and Waymark's calculations, never from the AI.
      </PageHeader>
      {health && !aiReady && <Notice tone="info" className="mb-3">No AI provider is set up, so answers are written from your records by fixed rules. Everything on this page still works.</Notice>}

      <div className="grid items-start gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)_22rem]">
        <ContextPanel />

        <Card title="Conversation" aside={messages.length > 0 && <button type="button" onClick={clearChat} className="text-sm font-semibold text-brand-800 hover:underline">Clear chat</button>} className="min-w-0">
          <div className="wm-scroll max-h-[32rem] min-h-40 space-y-3 overflow-y-auto overscroll-contain pr-1" role="log" aria-live="polite" aria-label="Conversation">
            {!messages.length && <p className="text-sm text-slate-600">Ask a question, or start with one of the suggestions below.</p>}
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 px-3.5 py-2.5 text-sm text-white' : 'max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800'}>
                {m.role === 'assistant' && <p className="mb-1 flex flex-wrap gap-1"><Badge tone={m.by === 'ai' ? 'brand' : 'slate'}>{m.by === 'ai' ? 'AI wording, figures checked' : 'Rule-based answer'}</Badge></p>}
                {m.note && <p className="mb-1.5 text-xs text-amber-800">{m.note}</p>}
                {m.text.split('\n\n').map((p, i) => <p key={i} className={i ? 'mt-2' : ''}>{p}</p>)}
                {m.check && (
                  <details className="mt-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-semibold text-brand-800">Show the rule-based answer it was written from</summary>
                    {m.check.split('\n\n').map((p, i) => <p key={i} className="mt-1.5">{p}</p>)}
                  </details>
                )}
              </div>
            ))}
            {busy && <div className="flex items-center gap-3"><Spinner label="Analysing" /><button type="button" onClick={cancel} className="text-sm font-semibold text-brand-800 hover:underline">Stop</button></div>}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestedQuestions(items).map((q) => (
              <button key={q} type="button" disabled={busy} onClick={() => ask(q)} className="rounded-full border border-slate-200 px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:border-brand-400 disabled:opacity-50">{q}</button>
            ))}
          </div>

          <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(question) }}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Your question</span>
              <textarea
                rows={2}
                maxLength={600}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question) } }}
                placeholder="Ask how this could affect your business"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <Button type="submit" disabled={busy || question.trim().length < 3}><Icon name="arrowRight" className="h-4 w-4" /> Send</Button>
          </form>
          <p className="mt-1.5 text-xs text-slate-500">Analysis is not advice and does not approve, book or send anything. Only the items in the context and the figures in the impact panel are shared with the AI provider.</p>
        </Card>

        <div className="lg:col-span-2 2xl:col-span-1"><ImpactPanel findings={findings} hasItems={items.length > 0} /></div>
      </div>
    </div>
  )
}
