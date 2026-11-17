/*
  Delay Assist: one page for deciding what to do about one late shipment.
  Facts first, one question at a time, every number traceable, and the buyer
  makes the call. Nothing is sent and no status is changed automatically.
*/
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatCo2e } from '../../../shared/emissions.js'
import AnalyzeButton from '../../components/app/AnalyzeButton.jsx'
import { Card, DemoTag, Empty, Notice, NumberInput, ProvenanceTag, SelectInput, Tabs, TextArea, TextInput, formatDate, useToast } from '../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { DELAY_DEMO_EMAILS } from '../../data/delayDemoEmails.js'
import { OPTION_NAMES, READINESS_LABELS, delayDecision, planDelayResponse } from '../../engine/delayPlan.js'
import { draftFacts, templateDraft } from '../../engine/draftTemplates.js'
import { extractByRules, mergeExtractions } from '../../engine/emailRules.js'
import { modeLabel } from '../../engine/model.js'
import { api } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money } from '../../utils/format.js'

const STEPS = [
  { id: 'situation', label: 'Confirm situation' },
  { id: 'goods', label: 'Goods status' },
  { id: 'options', label: 'Compare options' },
  { id: 'message', label: 'Message and approval' },
]
const FIELD_LABELS = { delayDays: 'Delay (days)', readiness: 'Goods status', partialQty: 'Can release now (units)', readyDate: 'Ready date' }
const READINESS_OPTIONS = Object.entries(READINESS_LABELS).map(([value, label]) => ({ value, label }))
const toNumber = (v) => (v === '' || v == null ? null : Number(v))
const days = (n) => `${n} day${n === 1 ? '' : 's'}`

function StepBar({ current, done, onGo }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2">
      {STEPS.map((step, i) => {
        const state = step.id === current ? 'current' : done.includes(step.id) ? 'done' : 'later'
        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={state === 'later'}
              aria-current={state === 'current' ? 'step' : undefined}
              onClick={() => onGo(step.id)}
              className={`flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${state === 'current' ? 'border-brand-600 bg-brand-700 text-white' : state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-xs">{state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}</span>
              {step.label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** A side panel that is always open on wide screens and folds away on small ones. */
function Panel({ title, children, defaultOpen = true }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[0.9375rem] font-bold text-navy">
        <h2 className="text-inherit">{title}</h2>
        <Icon name="chevronDown" className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

function FactValue({ fact }) {
  if (fact.value == null) return <span className="text-slate-500">Not provided</span>
  if (fact.key === 'costCad' || fact.key === 'dailyShortfallCost') return money(fact.value)
  if (fact.key === 'mode') return modeLabel(fact.value)
  if (fact.key === 'eta' || fact.key === 'readyDate') return formatDate(fact.value)
  return typeof fact.value === 'number' ? fact.value.toLocaleString('en-CA') : fact.value
}

function Summary({ label, children, onEdit }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <span className="min-w-0"><span className="font-semibold text-navy">{label}:</span> <span className="text-slate-700">{children}</span></span>
      <button type="button" onClick={onEdit} className="shrink-0 font-semibold text-brand-800 hover:underline">Edit</button>
    </div>
  )
}

function OptionCard({ option, recommended, selected, onSelect }) {
  const cost = option.extraCostCad
  return (
    <label className={`flex min-w-0 cursor-pointer flex-col rounded-2xl border p-3.5 ${!option.feasible ? 'cursor-not-allowed border-slate-200 opacity-60' : selected ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-400'}`}>
      <span className="flex items-start gap-2">
        <input type="radio" name="delay-option" className="mt-1 accent-[#7c6cff]" checked={selected} disabled={!option.feasible} onChange={onSelect} />
        <span className="min-w-0 flex-1 text-sm font-bold text-navy">{option.name}</span>
      </span>
      <span className="mt-1 flex flex-wrap gap-1">
        {recommended && <Badge tone="emerald">Recommended</Badge>}
        {!option.feasible && <Badge tone="slate">Not available now</Badge>}
      </span>
      {option.feasible ? (
        <dl className="mt-2 space-y-1 text-sm text-slate-700">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <dt className="text-slate-500">Extra freight</dt>
            <dd className="font-display text-lg font-extrabold text-navy tabular-nums">{cost == null ? 'Not available' : money(cost)}</dd>
          </div>
          {cost != null && cost > 0 && <p className="text-xs text-slate-500">{option.costBasis === 'annual_estimate' ? 'Annual estimate' : 'Per this shipment'} <ProvenanceTag kind="assumption" /></p>}
          <div className="flex justify-between gap-2"><dt className="text-slate-500">Days without stock</dt><dd className="font-semibold tabular-nums">{option.uncoveredDays}</dd></div>
          {option.units != null && <div className="flex justify-between gap-2"><dt className="text-slate-500">Units by air</dt><dd className="tabular-nums">{option.units.toLocaleString('en-CA')} <ProvenanceTag kind="derived" /></dd></div>}
          {option.stockoutCostCad ? <div className="flex flex-wrap justify-between gap-x-2"><dt className="text-slate-500">Cost of running out</dt><dd className="tabular-nums">{money(option.stockoutCostCad)} <ProvenanceTag kind="assumption" /></dd></div> : null}
          {option.co2eChangeKg ? <div className="flex justify-between gap-2"><dt className="text-slate-500">Transport emissions</dt><dd className="tabular-nums">+{formatCo2e(option.co2eChangeKg)}</dd></div> : null}
        </dl>
      ) : null}
      {option.feasibilityNote && <p className="mt-2 text-xs text-slate-600">{option.feasibilityNote}</p>}
    </label>
  )
}

export default function DelayResolve() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { ws, model, isDemo, health, saveRecord } = useWorkspace()
  const shipment = model.shipments.find((s) => s.id === id)
  const aiReady = Boolean(health?.integrations?.assistant)

  const [answers, setAnswers] = useState(() => {
    const p = shipment?.product
    const a = {}
    for (const k of ['delayDays', 'readiness', 'readyDate', 'partialQty', 'delaySource']) if (shipment?.[k] != null) a[k] = shipment[k]
    if (p?.onHandUnits != null) a.onHandUnits = p.onHandUnits
    if (shipment?.usedDefaultInventory) a.useCompanyDefaultInventory = true
    return a
  })
  const [step, setStep] = useState('situation')
  const [done, setDone] = useState([])
  const [email, setEmail] = useState('')
  const [extraction, setExtraction] = useState(null)
  const [reading, setReading] = useState(false)
  const [corrections, setCorrections] = useState([])
  const [chosen, setChosen] = useState(null)
  const [audience, setAudience] = useState('supplier')
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const requested = useRef(new Set())

  const plan = useMemo(() => (shipment ? planDelayResponse(shipment, model, answers) : null), [shipment, model, answers])
  const set = (key) => (value) => setAnswers((a) => ({ ...a, [key]: value }))
  const option = plan?.options.find((o) => o.id === (chosen ?? plan.recommendedId)) ?? null
  const facts = useMemo(() => (plan && option ? draftFacts(plan, option, shipment, model.company) : null), [plan, option, shipment, model.company])

  // Drafts start from the fixed template. When AI is set up, its draft replaces the template unless the buyer has already edited it.
  useEffect(() => {
    if (step !== 'message' || !facts) return
    const key = `${audience}:${JSON.stringify(facts)}`
    if (requested.current.has(key)) return
    requested.current.add(key)
    setDrafts((d) => ({ ...d, [audience]: { text: templateDraft(audience, facts), source: 'template', edited: false, note: null } }))
    if (!aiReady) return
    api
      .agentDelay({ mode: 'draft', audience, facts })
      .then((res) => {
        setDrafts((d) => {
          if (d[audience]?.edited) return d
          if (res.text) return { ...d, [audience]: { ...d[audience], text: res.text, source: 'ai', note: null } }
          return { ...d, [audience]: { ...d[audience], note: 'The AI draft contained numbers we could not verify, so we switched to the template below.' } }
        })
      })
      .catch(() => {}) // The template is already in place.
  }, [step, audience, facts, aiReady])

  if (!shipment) return <Empty icon="ship" title="Shipment not found" action={<Link to="/app/shipments" className="font-semibold text-brand-800 underline">Back to Shipments</Link>}>It may have been deleted.</Empty>

  const header = (
    <div className="mb-4">
      <Link to="/app/shipments" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-800 hover:underline"><Icon name="arrowLeft" className="h-4 w-4" /> Back to Shipments</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 tabIndex={-1} className="text-2xl font-bold text-navy focus:outline-none sm:text-[1.7rem]">Resolve delay · {shipment.reference}</h1>
        <Badge tone="rose">Delayed</Badge>
        {isDemo && <DemoTag />}
        <AnalyzeButton type="shipment" id={shipment.id} className="ml-auto" />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {[shipment.product?.name, shipment.supplier?.name, modeLabel(shipment.mode), `recorded ETA ${formatDate(shipment.eta)}`].filter(Boolean).join(' · ')}
      </p>
    </div>
  )

  if (shipment.status !== 'delayed') {
    return (
      <div>
        {header}
        <Notice tone="info">This shipment is not currently delayed. Delay Assist opens when a shipment's status is set to Delayed.</Notice>
      </div>
    )
  }

  const previous = delayDecision(ws.events, shipment.id)
  const complete = (s) => setDone((d) => (d.includes(s) ? d : [...d, s]))
  const goTo = (next) => {
    setStep(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const readEmail = async (text = email) => {
    if (text.trim().length < 10) return toast('Paste the supplier email first', 'error')
    setReading(true)
    let result = extractByRules(text)
    if (aiReady) {
      try {
        result = mergeExtractions(result, await api.agentDelay({ mode: 'extract', text }))
      } catch {
        // The pattern result stands on its own.
      }
    }
    setExtraction(result)
    setAnswers((a) => ({ ...a, ...Object.fromEntries(Object.entries(result.fields).filter(([, v]) => v != null)), delaySource: 'supplier_email' }))
    setCorrections([])
    setReading(false)
  }

  /** Changing a value that came from the email is logged, so the record shows what the buyer corrected. */
  const edit = (key, value) => {
    const found = extraction?.fields?.[key]
    if (found != null && String(found) !== String(value ?? '')) {
      setCorrections((c) => [...c.filter((x) => x.field !== key), { field: key, from: found, to: value }])
    } else {
      setCorrections((c) => c.filter((x) => x.field !== key))
    }
    set(key)(value)
  }

  const confirmSituation = () => {
    if (plan.inputs.delayDays == null || plan.inputs.delayDays <= 0) return toast('Enter how many days late the shipment is', 'error')
    complete('situation')
    if (answers.readiness) {
      complete('goods')
      goTo('options')
    } else {
      goTo('goods')
    }
  }

  const approve = async () => {
    if (plan.approveBlockedReason || !option) return
    setSaving(true)
    try {
      const raw = ws.shipments.find((s) => s.id === shipment.id)
      await saveRecord('shipments', {
        ...raw,
        delayDays: plan.inputs.delayDays,
        readiness: plan.inputs.readiness,
        readyDate: plan.inputs.readyDate,
        partialQty: plan.inputs.partialQty,
        delaySource: answers.delaySource ?? 'manual',
        usedDefaultInventory: plan.coverage.provenance === 'assumption',
      })
      const product = ws.products.find((p) => p.id === shipment.productId)
      if (product && (answers.onHandUnits != null || answers.weeklyDemand != null)) {
        await saveRecord('products', { ...product, ...(answers.onHandUnits != null ? { onHandUnits: answers.onHandUnits } : {}), ...(answers.weeklyDemand != null ? { weeklyDemand: answers.weeklyDemand } : {}) })
      }
      const at = new Date()
      const recommended = plan.options.find((o) => o.id === plan.recommendedId)
      if (recommended) {
        await saveRecord('events', {
          id: crypto.randomUUID(), shipmentId: shipment.id, at: new Date(at.getTime() - 1000).toISOString(), type: 'agent_suggestion',
          message: `Suggested: ${recommended.name.toLowerCase()}`, source: 'Waymark delay assistant', simulated: false,
          plan: { branch: plan.branch, recommendedId: plan.recommendedId, options: plan.options.map((o) => o.id), assumptions: plan.assumptions.map((a) => a.text) },
        })
      }
      await saveRecord('events', {
        id: crypto.randomUUID(), shipmentId: shipment.id, at: at.toISOString(), type: 'human_decision',
        message: `Approved: ${option.name.toLowerCase()}${option.units ? `, ${option.units.toLocaleString('en-CA')} units by air` : ''}`, source: 'Manual entry', simulated: false,
        decision: {
          optionId: option.id, extraCostCad: option.extraCostCad, overridden: option.id !== plan.recommendedId, corrections,
          draftEdited: Object.values(drafts).some((d) => d.edited), usedDefaultInventory: plan.coverage.provenance === 'assumption',
        },
      })
      toast(`Recorded in ${shipment.reference} events`)
      navigate(`/app/shipments?open=${shipment.id}`)
    } catch (err) {
      toast(err.message || 'The decision could not be saved', 'error')
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(drafts[audience]?.text ?? '')
      toast('Message copied. Send it from your own email.')
    } catch {
      toast('Copy is blocked in this browser. Select the text and copy it by hand.', 'error')
    }
  }

  const gap = plan.uncoveredDays
  const inventoryBlock = (
    <div className="mt-3 rounded-xl border border-slate-200 p-3">
      <p className="text-sm font-semibold text-navy">Stock for this product</p>
      <p className="mt-0.5 text-xs text-slate-500">Why we ask: the gap is the delay minus the days your stock will last. Without it, the cost of each option is only a range.</p>
      <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
        <NumberInput label="Units on hand" optional value={answers.onHandUnits ?? ''} onChange={(v) => set('onHandUnits')(toNumber(v))} />
        <NumberInput label="Weekly demand (units)" optional hint={plan.inputs.weeklyDemand ? `Using ${Math.round(plan.inputs.weeklyDemand).toLocaleString('en-CA')} a week` : undefined} value={answers.weeklyDemand ?? ''} onChange={(v) => set('weeklyDemand')(toNumber(v))} />
      </div>
      {model.resolved.bufferDays != null && (
        <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1 accent-[#7c6cff]" checked={Boolean(answers.useCompanyDefaultInventory)} onChange={(e) => set('useCompanyDefaultInventory')(e.target.checked)} />
          <span>Continue with the company default ({days(model.resolved.bufferDays)} of stock). This choice is saved with the decision.</span>
        </label>
      )}
    </div>
  )

  return (
    <div>
      <div data-tour="delay-assist">{header}</div>
      {previous && <Notice tone="good" className="mb-3">A decision is already on record: {previous.message} ({formatDate(previous.at)}). Approving again adds a new record.</Notice>}
      <StepBar current={step} done={done} onGo={goTo} />

      <div className="grid items-start gap-3 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_17rem]">
        <Panel title="Known facts">
          <dl className="space-y-2 text-sm">
            {plan.facts.filter((f) => f.value != null).map((f) => (
              <div key={f.key}>
                <dt className="text-xs text-slate-500">{f.label}</dt>
                <dd className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-800"><FactValue fact={f} /> <ProvenanceTag kind={f.provenance} /></dd>
              </div>
            ))}
          </dl>
          {plan.missing.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Missing</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-600">{plan.missing.map((m) => <li key={m} className="flex gap-1.5"><ProvenanceTag kind="missing" /> <span>{m}</span></li>)}</ul>
            </>
          )}
        </Panel>

        <div className="min-w-0">
          {step !== 'situation' && done.includes('situation') && <Summary label="Situation" onEdit={() => goTo('situation')}>{days(plan.inputs.delayDays)} late{answers.delaySource === 'supplier_email' ? ', from the supplier email' : ''}</Summary>}
          {['options', 'message'].includes(step) && answers.readiness && <Summary label="Goods status" onEdit={() => goTo('goods')}>{READINESS_LABELS[answers.readiness]}</Summary>}
          {step === 'message' && option && <Summary label="Option" onEdit={() => goTo('options')}>{option.name}{option.extraCostCad ? ` · ${money(option.extraCostCad)} (${option.costBasis === 'annual_estimate' ? 'annual estimate' : 'per this shipment'})` : ''}</Summary>}

          {step === 'situation' && (
            <Card title="Confirm the situation" subtitle="Type the delay, or paste the supplier's email and check what Waymark finds.">
              <TextArea label="Supplier email" optional rows={6} value={email} onChange={setEmail} />
              <p className="mt-1 text-xs text-slate-500">Waymark only fills a field it can quote from the email. {aiReady ? 'Patterns run first, then AI fills gaps.' : 'AI is not set up, so fixed patterns are used. Everything else works the same.'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => readEmail()} disabled={reading}><Icon name="search" className="h-4 w-4" /> {reading ? 'Reading…' : 'Read email'}</Button>
                {isDemo && DELAY_DEMO_EMAILS.map((d) => (
                  <button key={d.id} type="button" onClick={() => { setEmail(d.text); readEmail(d.text) }} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-brand-400">Demo: {d.label}</button>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.keys(FIELD_LABELS).map((key) => {
                  const quote = extraction?.quotes?.[key]
                  const edited = corrections.some((c) => c.field === key)
                  return (
                    <div key={key} className="min-w-0">
                      {key === 'readiness' ? (
                        <SelectInput label={FIELD_LABELS[key]} optional placeholder="Not confirmed yet" value={answers.readiness ?? ''} onChange={(v) => edit(key, v || undefined)} options={READINESS_OPTIONS} />
                      ) : key === 'readyDate' ? (
                        <TextInput label={FIELD_LABELS[key]} optional type="date" value={answers.readyDate ?? ''} onChange={(v) => edit(key, v || null)} />
                      ) : (
                        <NumberInput label={FIELD_LABELS[key]} optional={key !== 'delayDays'} value={answers[key] ?? ''} onChange={(v) => edit(key, toNumber(v))} />
                      )}
                      {extraction && (
                        <p className="mt-1 text-xs text-slate-600">
                          {edited ? <Badge tone="amber">Edited</Badge> : quote ? <Badge tone="emerald">Found</Badge> : <Badge tone="slate">Not in the email</Badge>}{' '}
                          {quote ? <span className="italic">“{quote}”</span> : 'Not mentioned in the email.'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-4"><Button onClick={confirmSituation}>Confirm and continue</Button></div>
            </Card>
          )}

          {step === 'goods' && (
            <Card title="What is the status of the goods right now?" subtitle="Why we ask: if the goods are ready, faster shipping can close the gap. If they are still being made, it cannot.">
              <div className="grid gap-2 sm:grid-cols-3">
                {READINESS_OPTIONS.map((o) => (
                  <label key={o.value} className={`cursor-pointer rounded-xl border p-3 text-sm font-semibold ${answers.readiness === o.value ? 'border-brand-500 bg-brand-50 text-navy' : 'border-slate-200 text-slate-700 hover:border-brand-400'}`}>
                    <input type="radio" name="readiness" className="mr-2 accent-[#7c6cff]" checked={answers.readiness === o.value} onChange={() => set('readiness')(o.value)} />
                    {o.label}
                  </label>
                ))}
              </div>
              <div className="mt-4"><Button disabled={!answers.readiness} onClick={() => { complete('goods'); goTo('options') }}>Continue</Button></div>
            </Card>
          )}

          {step === 'options' && (
            <Card title="Compare options" subtitle="Worked out for this one shipment by fixed rules. You can pick any option.">
              {plan.branch === 'inventory_unknown' ? (
                <Notice tone="warn">We do not know how many units of this product are on hand, so the gap could be anywhere from {gap[0]} to {days(gap[1])}. There is no recommendation until this is filled in.</Notice>
              ) : plan.branch === 'in_production' ? (
                <Notice tone="warn">The goods are {answers.readiness === 'unknown' ? 'not confirmed as finished' : 'still being made'}{plan.inputs.readyDate ? '' : ' and the supplier has not given a finish date'}, so faster shipping will not help yet.</Notice>
              ) : gap > 0 ? (
                <Notice tone="error">Gap: about {days(gap)} without stock cover ({days(plan.effectiveDelay)} late, {days(plan.coverage.days)} of stock).</Notice>
              ) : (
                <Notice tone="good">No gap: {days(plan.coverage.days)} of stock covers the {days(plan.effectiveDelay)} delay.</Notice>
              )}

              {inventoryBlock}

              {plan.nextQuestion === 'partialQty' && (
                <div className="mt-3 rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-navy">Can part of the order ship early?</p>
                  <p className="mt-0.5 text-xs text-slate-500">Why we ask: flying only what covers the gap costs far less than flying everything. Skip this if you do not know.</p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <NumberInput label="Units the supplier can release" optional value={answers.partialQty ?? ''} onChange={(v) => set('partialQty')(toNumber(v))} className="min-w-44 flex-1" />
                    <Button variant="secondary" onClick={() => set('partialQty')(null)}>Skip</Button>
                  </div>
                </div>
              )}

              {plan.branch === 'inventory_unknown' ? (
                <div tabIndex={0} role="region" aria-label="Outcome range by option, scrollable" className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[26rem] text-left text-sm">
                    <caption className="sr-only">Outcome range by option</caption>
                    <thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="py-2 pr-3 font-semibold">Option</th><th className="py-2 pr-3 font-semibold">If {days(plan.coverage.range[1])} of stock</th><th className="py-2 font-semibold">If no stock</th></tr></thead>
                    <tbody>
                      {plan.options.map((o) => {
                        const cell = (x) => (!x ? 'Not needed' : !x.feasible ? 'Not available' : x.id === 'wait' ? `${days(x.uncoveredDays)} without stock` : `${x.extraCostCad == null ? 'Cost not available' : money(x.extraCostCad)}${x.uncoveredDays > 0 ? `, ${days(x.uncoveredDays)} still uncovered` : ''}`)
                        return <tr key={o.id} className="border-b border-slate-100"><td className="py-2 pr-3 font-semibold text-navy">{o.name}</td><td className="py-2 pr-3 tabular-nums">{cell(o.range.best)}</td><td className="py-2 tabular-nums">{cell(o.range.worst)}</td></tr>
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                    {plan.options.map((o) => <OptionCard key={o.id} option={o} recommended={o.id === plan.recommendedId} selected={option?.id === o.id} onSelect={() => setChosen(o.id)} />)}
                  </div>
                  <p className="mt-3 text-sm text-slate-700">
                    {plan.branch === 'in_production'
                      ? 'Recommended: get a firm ready date first. The next step is an email to the supplier, at no extra cost for now.'
                      : gap > 0 ? 'Recommended: the cheapest option that closes the gap. You can choose any option, and your choice is recorded.' : 'Recommended: wait. Your stock covers the delay.'}
                  </p>
                </>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button disabled={Boolean(plan.approveBlockedReason) || !option} onClick={() => { complete('options'); goTo('message') }}>Continue to message</Button>
                {plan.approveBlockedReason && <span className="text-sm text-amber-800">{plan.approveBlockedReason}</span>}
              </div>
            </Card>
          )}

          {step === 'message' && option && (
            <Card title="Message and approval" subtitle="Review and edit the draft, send it from your own email, then record the decision.">
              <Tabs tabs={[{ id: 'supplier', label: 'To supplier' }, { id: 'manager', label: 'To manager' }]} active={audience} onChange={setAudience} />
              <div role="tabpanel" id={`panel-${audience}`} aria-labelledby={`tab-${audience}`}>
              {drafts[audience]?.note && <Notice tone="warn" className="mb-2">{drafts[audience].note}</Notice>}
              <TextArea label={audience === 'supplier' ? 'Email to the supplier' : 'Summary for your manager'} rows={13} value={drafts[audience]?.text ?? ''} onChange={(text) => setDrafts((d) => ({ ...d, [audience]: { ...d[audience], text, edited: true } }))} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Every number in this draft comes from the previous step's calculation. {drafts[audience]?.source === 'ai' ? 'Wording by AI, checked against those numbers.' : 'Written from a fixed template.'} Waymark never sends email: copy the text and send it yourself.
              </p>
              {option.id !== plan.recommendedId && plan.recommendedId && <Notice tone="info" className="mt-2">You chose a different option from the recommendation ({OPTION_NAMES[plan.recommendedId]}). That is recorded with the decision.</Notice>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={copy}><Icon name="file" className="h-4 w-4" /> Copy {audience === 'supplier' ? 'email' : 'summary'}</Button>
                <Button onClick={approve} disabled={saving || Boolean(plan.approveBlockedReason)}><Icon name="check" className="h-4 w-4" /> {saving ? 'Saving…' : 'Mark as sent and approve'}</Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Approving records your decision in the shipment's events. It does not change the shipment's status.</p>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2 xl:col-span-1">
          <Panel title="Evidence">
            {extraction && Object.keys(extraction.quotes).length > 0 && (
              <>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">From the supplier email</p>
                <ul className="mt-1 mb-3 space-y-1.5 text-sm text-slate-700">
                  {Object.entries(extraction.quotes).map(([key, quote]) => <li key={key}><span className="font-semibold">{FIELD_LABELS[key]}:</span> <span className="italic">“{quote}”</span></li>)}
                </ul>
              </>
            )}
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Assumptions behind the result</p>
            <ul className="mt-1 space-y-2 text-sm text-slate-700">
              {plan.assumptions.map((a) => <li key={a.text}>{a.text}<br /><span className="text-xs text-slate-500">{a.source}</span></li>)}
            </ul>
            {plan.engineAssumptions.length > 0 && (
              <details className="mt-3 text-sm text-slate-600">
                <summary className="cursor-pointer font-semibold text-brand-800">Scenario engine assumptions</summary>
                <ul className="mt-1 space-y-1.5">{plan.engineAssumptions.map((a) => <li key={a.text}>{a.text}<br /><span className="text-xs text-slate-500">{a.source}</span></li>)}</ul>
              </details>
            )}
            {isDemo && <p className="mt-3 text-xs text-slate-500">Demo data and scenario estimates. Not advice.</p>}
          </Panel>
        </div>
      </div>
    </div>
  )
}
