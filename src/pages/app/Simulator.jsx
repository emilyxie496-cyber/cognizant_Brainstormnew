import { useEffect, useMemo, useState } from 'react'
import WeatherIntelligence, { useWeather } from '../../components/app/WeatherIntelligence.jsx'
import AiLauncher from '../../components/app/AiLauncher.jsx'
import ReportAction from '../../components/app/ReportAction.jsx'
import { Link, useLocation } from 'react-router-dom'
import { COUNTRIES, countryName } from '../../../shared/countries.js'
import { formatCo2e } from '../../../shared/emissions.js'
import { Card, CollapsiblePanel, CompactPageHeader, ConfirmModal, DataTable, DemoTag, Gate, LockedPanel, Metric, MetricGrid, NumberInput, Notice, ProvenanceTag, SectionTabs, SelectInput, Slider, StatusPill, TextInput, useToast } from '../../components/app/kit.jsx'
import SupplyMap from '../../components/map/SupplyMap.jsx'
import { buildMapData } from '../../components/map/mapData.js'
import StrategyChart from '../../components/demo/StrategyChart.jsx'
import SupplyTimeline from '../../components/trade-visuals/SupplyTimeline.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { MODES } from '../../engine/model.js'
import { CONTROLS, SCENARIO_TYPES, defaultParams, runScenario } from '../../engine/simulator.js'
import { comparisonBasis, countryOption, leadOption } from '../../engine/alternatives.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { money, percent } from '../../utils/format.js'

function ScenarioParams({ type, params, set, model }) {
  const supplierOptions = model.suppliers.map((s) => ({ value: s.id, label: s.name }))
  const countryOptions = model.stats.countryShares.map((c) => ({ value: c.code, label: `${countryName(c.code)} (${percent(c.share, 0)})` }))
  const hubs = useMemo(() => {
    const seen = new Map()
    model.suppliers.flatMap((s) => s.legs).forEach((l) => [l.from, l.to].forEach((end) => end?.code && seen.set(end.code, end.name)))
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [model])

  const slider = (key) => params[key] !== undefined && <Slider key={key} {...CONTROLS[key]} value={params[key]} onChange={set(key)} />

  return (
    <div className="space-y-3">
      {params.supplierId !== undefined && <SelectInput label="Supplier" placeholder={null} value={params.supplierId} onChange={set('supplierId')} options={supplierOptions} />}
      {params.countryCode !== undefined && <SelectInput label="Country" placeholder={null} value={params.countryCode} onChange={set('countryCode')} options={countryOptions} />}
      {params.hub !== undefined && <SelectInput label="Port or hub" placeholder={null} value={params.hub} onChange={set('hub')} options={hubs} />}
      {params.mode !== undefined && <SelectInput label="Transport mode" placeholder={null} value={params.mode} onChange={set('mode')} options={MODES} />}
      {type === 'alternative_transport' && (
        <SelectInput
          label="Change"
          placeholder={null}
          value={params.to}
          onChange={(to) => set('to')(to) || set('from')(to === 'air' ? 'sea' : 'air')}
          options={[{ value: 'air', label: 'Ocean to air (faster)' }, { value: 'sea', label: 'Air to ocean (lower emissions)' }]}
        />
      )}
      {['ratePct', 'freightPct', 'weeks', 'delayDays', 'reroutePct', 'stockLossDays', 'shiftPct', 'blockedPct', 'months'].map(slider)}
    </div>
  )
}

const signedCo2e = (kg) => (kg == null ? 'Not assessed' : `${kg > 0 ? '+' : kg < 0 ? '−' : ''}${formatCo2e(Math.abs(kg))}`)

// Which inputs come from company records (prefilled by defaultParams) and which are planning defaults.
const FROM_RECORDS = { supplierId: 'Largest-share supplier in your records', countryCode: 'Top sourcing country in your records', hub: 'Main port on your largest supplier’s lane', mode: 'Main transport mode in your records' }

/**
 * A summary band for display only. It does not change any calculation: it reads the engine's
 * added-cost share and uncovered shortfall days.
 */
function riskBand(result) {
  if (result.inventoryShortfallDays > 0 || result.totalPct >= 0.1) return { label: 'High', tone: 'rose' }
  if (result.totalPct >= 0.03 || result.deliveryImpactDays > 0) return { label: 'Medium', tone: 'amber' }
  return { label: 'Low', tone: 'emerald' }
}

function StepHeader({ n, title, active, done, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'step' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start ${active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? 'bg-emerald-600 text-white' : active ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'}`}>{done ? <Icon name="check" className="h-4 w-4" /> : n}</span>
      <span className={`text-sm font-semibold ${active ? 'text-navy' : 'text-slate-600'}`}>{title}</span>
    </button>
  )
}

export default function Simulator() {
  const { model, ws, fx, isDemo, can, saveRecord, deleteRecord, counts, limit, updateCompany } = useWorkspace()
  const location = useLocation()
  const toast = useToast()
  const [step, setStep] = useState(1)
  const [type, setType] = useState('supplier_delay')
  const [custom, setCustom] = useState(false)
  const [params, setParams] = useState(() => defaultParams('supplier_delay', model))
  const [touched, setTouched] = useState({})
  const [altChoice, setAltChoice] = useState(location.state?.alternative ?? '')
  const [altShare, setAltShare] = useState(40)
  const [premiumPct, setPremiumPct] = useState(8)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [ran, setRan] = useState(null) // { type, params, name } committed by Run Simulation
  const weather = useWeather(null)

  useEffect(() => {
    if (location.state?.alternative) setAltChoice(location.state.alternative)
  }, [location.state])

  const choose = (id, isCustom = false) => {
    setType(id)
    setCustom(isCustom)
    setParams(defaultParams(id, model))
    setTouched({})
  }
  const set = (key) => (value) => { setParams((p) => ({ ...p, [key]: value })); setTouched((t) => ({ ...t, [key]: true })) }

  const dailyCost = model.company.operations?.dailyShortfallCost ?? ''
  const topSupplier = useMemo(() => [...model.suppliers].sort((a, b) => b.share - a.share)[0] ?? null, [model])

  const alternatives = useMemo(() => {
    if (!topSupplier) return []
    const product = ws.products.find((p) => (topSupplier.productIds ?? []).includes(p.id))
    const basis = comparisonBasis(model, product, topSupplier)
    const leads = (ws.alternatives ?? []).map((lead) => leadOption(model, ws, lead, topSupplier, product, basis, fx))
    const markets = COUNTRIES.filter((c) => !model.suppliers.some((s) => s.country === c.code) && !['CA', 'HK'].includes(c.code)).map((c) => countryOption(model, ws, c.code, topSupplier, product, basis, fx))
    return [...leads, ...markets]
  }, [model, ws, fx, topSupplier])

  const alternative = useMemo(() => {
    const option = alternatives.find((a) => a.id === altChoice)
    if (!option) return { premiumPct, name: 'Alternative source', leadTimeDays: 21, source: 'Planning assumption' }
    return { name: option.name, leadTimeDays: option.leadDays ?? 21, premiumPct, intensityKgPerKg: option.emissions && option.weightKg ? option.emissions.co2eKg / option.weightKg : null, source: option.trustLabel }
  }, [alternatives, altChoice, premiumPct])

  // The engine runs only for a committed scenario. Its inputs and calculation are unchanged.
  const result = useMemo(() => {
    if (!ran || !model.suppliers.length) return null
    return runScenario({ type: ran.type, params: ran.params }, model, { alternative, altShare })
  }, [ran, model, alternative, altShare])

  const highlight = useMemo(() => (result ? { supplierIds: result.affected.supplierIds, shipmentIds: result.affected.shipmentIds, hub: result.affected.hub } : null), [result])
  const data = useMemo(() => buildMapData(model, { highlight }), [model, highlight])

  if (!model.suppliers.length) {
    return (
      <div>
        <CompactPageHeader title="Risk Simulator" />
        <Notice tone="info">Add at least one supplier in <Link to="/app/settings?tab=suppliers" className="font-semibold underline">Settings → Suppliers</Link> to run a scenario.</Notice>
      </div>
    )
  }

  const def = SCENARIO_TYPES.find((t) => t.id === type)
  const locked = !def.basic && !can('scenario.advanced')
  const scenarioName = name.trim() || (custom ? `Custom: ${def.label}` : def.label)

  // Validation and missing information for the review step.
  const errors = []
  if (params.supplierId !== undefined && !model.suppliers.some((s) => s.id === params.supplierId)) errors.push('Choose a supplier.')
  if (params.countryCode !== undefined && !params.countryCode) errors.push('Choose a country.')
  if (params.hub !== undefined && !params.hub) errors.push('Choose a port or hub.')
  if (dailyCost !== '' && (!Number.isFinite(Number(dailyCost)) || Number(dailyCost) < 0)) errors.push('The daily shortfall cost must be zero or more.')
  if (custom && !name.trim()) errors.push('Give your custom scenario a name.')
  if (locked) errors.push('This scenario type needs the Pro plan.')
  const missing = []
  if (!Number(dailyCost)) missing.push('No cost per shortfall day is set, so stock shortfalls will not be costed.')
  if (model.company.operations?.inventoryDays == null || model.company.operations?.inventoryDays === '') missing.push('Inventory coverage is not recorded in Settings → Profile; the buffer is treated as 0 days.')

  const run = () => {
    if (errors.length) return
    setRan({ type, params: { ...params }, name: scenarioName, custom })
    setTimeout(() => document.getElementById('sim-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const canSave = counts.scenarios < limit('scenarios')
  const save = async () => {
    try {
      await saveRecord('scenarios', { id: crypto.randomUUID(), name: ran.name, type: ran.type, params: ran.params, result, savedAt: new Date().toISOString() })
      toast('Scenario saved')
    } catch (err) {
      toast(err.message, 'error')
    }
  }
  const prov = model.resolved.provenance
  const band = result && riskBand(result)
  const supplierName = (id) => model.supplierById.get(id)?.name ?? id
  const summaryRows = [
    ['Scenario', `${scenarioName}${custom ? ' (custom)' : ''}`],
    ...(params.supplierId !== undefined ? [['Supplier', supplierName(params.supplierId)]] : []),
    ...(params.countryCode !== undefined ? [['Country', countryName(params.countryCode)]] : []),
    ...(params.hub !== undefined ? [['Port or hub', params.hub]] : []),
    ...(params.mode !== undefined ? [['Transport mode', params.mode]] : []),
    ...Object.entries(params).filter(([k]) => CONTROLS[k]).map(([k, v]) => [CONTROLS[k].label, `${CONTROLS[k].prefix ?? ''}${v}${CONTROLS[k].unit ?? ''}`]),
    ['Cost per shortfall day', Number(dailyCost) ? money(Number(dailyCost)) : 'Not set'],
  ]

  const buildReport = () => ({
    title: `Risk simulation: ${ran.name}`,
    typeId: 'simulation',
    context: { heading: 'Scenario', lines: summaryRows.map(([k, v]) => `${k}: ${v}`) },
    sections: [
      { heading: 'Executive summary', paragraphs: [result.description, `Summary band: ${band.label} (from added-cost share and uncovered shortfall days).`] },
      { heading: 'Key findings', table: { head: ['Measure', 'Value'], rows: [
        ['Baseline cost (12 months)', money(result.baseline)], ['Additional freight cost', money(result.additionalFreight)], ['Tariff exposure', money(result.tariffExposure)],
        ['Total added cost', `${money(result.totalCost)} (${percent(result.totalPct)} of baseline)`], ['Inventory shortfall', `${result.inventoryShortfallDays} days`],
        ['Potential shortage cost', result.delayCosted ? money(result.shortageCost) : 'Not costed'], ['Delivery impact', `+${result.deliveryImpactDays} days`], ['Carbon emissions change', signedCo2e(result.co2eChangeKg)],
      ] } },
      { heading: 'Affected suppliers', bullets: result.affected.supplierIds.map(supplierName), paragraphs: [`${percent(result.affected.share, 0)} of sourcing is affected.`] },
      { heading: 'Compared responses', table: { head: ['Response', 'Added cost', 'Lead time', 'CO2e change', 'Feasibility'], rows: result.strategies.map((s) => [s.name + (s.id === result.lowestCostId ? ' (lowest est. cost)' : ''), money(s.total), s.leadTime, signedCo2e(s.co2eChangeKg), `${s.feasibility.level}. ${s.feasibility.text}`]) } },
      { heading: 'Assumptions and limitations', bullets: result.assumptions.map((a) => `${a.text} (${a.source})`) },
    ],
    sources: [{ label: 'Company records', detail: isDemo ? 'Fictional demo data' : 'Entered by your company' }, { label: 'Simulation engine', detail: 'Waymark deterministic scenario model; hypothetical, not a forecast' }, { label: 'Exchange rates', detail: `${fx?.source ?? 'Unavailable'}${fx?.asOf ? `, as of ${fx.asOf}` : ''}` }],
  })

  const steps = [
    { n: 1, title: 'Select scenario' },
    { n: 2, title: 'Configure details' },
    { n: 3, title: 'Review and run' },
  ]

  return (
    <div className="space-y-3">
      <CompactPageHeader title="Risk Simulator" badge={isDemo && <DemoTag />} description="Test hypothetical disruptions on your own suppliers and costs. Planning scenarios, not forecasts." />

      <WeatherIntelligence weather={weather} onScenario={(a) => { choose('severe_weather'); setParams({ ...defaultParams('severe_weather', model), hub: a.hubCode, delayDays: 10 }); setStep(2) }} />

      <section data-tour="feature-simulator" aria-label="Simulation workflow" className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
        <ol className="grid gap-1 border-b border-slate-200 p-2 md:grid-cols-3">
          {steps.map((s) => <li key={s.n}><StepHeader n={s.n} title={s.title} active={step === s.n} done={step > s.n} onClick={() => setStep(s.n)} /></li>)}
        </ol>

        <div className="p-4">
          {step === 1 && (
            <div>
              <p className="mb-3 text-sm text-slate-600">Choose a disruption to test, or build a custom scenario on any supported model.</p>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {SCENARIO_TYPES.map((t) => {
                  const available = t.basic || can('scenario.advanced')
                  const on = type === t.id && !custom
                  return (
                    <li key={t.id}>
                      <button type="button" aria-pressed={on} onClick={() => { choose(t.id); setStep(2) }} className={`flex h-full w-full items-start gap-2.5 rounded-xl border p-3 text-start ${on ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-brand-200'}`}>
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon name={available ? t.icon : 'lock'} className="h-4 w-4" /></span>
                        <span><span className="block text-sm font-semibold text-navy">{t.label}</span><span className="block text-xs text-slate-500">{available ? (t.basic ? 'All plans' : 'Pro') : 'Needs Pro'}</span></span>
                      </button>
                    </li>
                  )
                })}
                <li>
                  <button type="button" aria-pressed={custom} onClick={() => { choose(type, true); setStep(2) }} className={`flex h-full w-full items-start gap-2.5 rounded-xl border border-dashed p-3 text-start ${custom ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-200'}`}>
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon name="plus" className="h-4 w-4" /></span>
                    <span><span className="block text-sm font-semibold text-navy">Custom scenario</span><span className="block text-xs text-slate-500">Name it and set every parameter</span></span>
                  </button>
                </li>
              </ul>
              {ws.scenarios?.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Saved scenarios</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {ws.scenarios.map((s) => (
                      <li key={s.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 ps-2.5">
                        <button type="button" className="py-1 text-sm font-medium text-brand-800 hover:underline" onClick={() => { setType(s.type); setCustom(false); setParams(s.params); setName(s.name); setStep(3) }}>{s.name}</button>
                        <button type="button" aria-label={`Delete ${s.name}`} onClick={() => setDeleting(s)} className="rounded p-1.5 text-slate-500 hover:text-rose-700"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2"><Icon name={def.icon} className="h-5 w-5 text-brand-800" /><h2 className="font-bold text-navy">{custom ? 'Custom scenario' : def.label}</h2><Badge tone="amber">Hypothetical</Badge></div>
                {locked ? <LockedPanel feature="scenario.advanced">The Free tier covers tariff, shipping-price and supplier-delay scenarios.</LockedPanel> : (
                  <>
                    {custom && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextInput label="Scenario name" value={name} onChange={setName} maxLength={80} />
                        <SelectInput label="Disruption model" placeholder={null} value={type} onChange={(id) => choose(id, true)} options={SCENARIO_TYPES.filter((t) => t.basic || can('scenario.advanced')).map((t) => ({ value: t.id, label: t.label }))} hint="Custom scenarios use one of the supported engine models." />
                      </div>
                    )}
                    <ScenarioParams type={type} params={params} set={set} model={model} />
                  </>
                )}
                <NumberInput label="Cost per day of stock shortfall (CAD)" hint="Your company assumption; saved to your profile. Leave at 0 and delays are not costed." value={dailyCost} onChange={(value) => updateCompany({ operations: { ...model.company.operations, dailyShortfallCost: value } })} />
              </div>
              <aside className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold text-navy">Where the values come from</p>
                <ul className="space-y-1">
                  {Object.keys(params).filter((k) => FROM_RECORDS[k]).map((k) => <li key={k}><StatusPill tone={touched[k] ? 'amber' : 'emerald'}>{touched[k] ? 'Manual override' : 'From your records'}</StatusPill> <span className="block pt-0.5">{FROM_RECORDS[k]}</span></li>)}
                  {Object.keys(params).filter((k) => CONTROLS[k]).map((k) => <li key={k}><StatusPill tone={touched[k] ? 'amber' : 'slate'}>{touched[k] ? 'Manual override' : 'Planning default'}</StatusPill> <span className="block pt-0.5">{CONTROLS[k].label}</span></li>)}
                </ul>
              </aside>
              <div className="flex justify-between gap-2 lg:col-span-2">
                <Button variant="secondary" onClick={() => setStep(1)}><Icon name="arrowLeft" className="h-4 w-4 rtl:rotate-180" /> Back</Button>
                <Button onClick={() => setStep(3)}>Review <Icon name="arrowRight" className="h-4 w-4 rtl:rotate-180" /></Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {summaryRows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-500">{k}</dt><dd className="text-end font-medium text-navy">{v}</dd></div>)}
              </dl>
              {errors.length > 0 && <Notice tone="error"><ul className="list-disc ps-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
              {missing.length > 0 && <Notice tone="warn"><ul className="list-disc ps-4">{missing.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="secondary" onClick={() => setStep(2)}><Icon name="arrowLeft" className="h-4 w-4 rtl:rotate-180" /> Back</Button>
                <Button size="lg" disabled={errors.length > 0} onClick={run}><Icon name="activity" className="h-4 w-4" /> Run Simulation</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {result && (
        <section id="sim-results" aria-live="polite" aria-label="Simulation results" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-navy">{ran.name} <StatusPill tone={band.tone}>Risk: {band.label}</StatusPill></p>
              <p className="text-sm text-slate-700">{result.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AiLauncher label="Explain with AI" task="Explain these simulation findings and possible alternatives." context={[ran.name, `Total added cost ${money(result.totalCost)} (${percent(result.totalPct)} of baseline)`, `Delivery impact +${result.deliveryImpactDays} days`, `Shortfall ${result.inventoryShortfallDays} days`]} />
              <ReportAction build={buildReport} />
            </div>
          </div>

          <SectionTabs idPrefix="sim" label="Simulation results" tabs={[
            { id: 'summary', label: 'Risk summary', content: (
              <div className="space-y-3">
                <MetricGrid max={4}>
                  <Metric label="Total added cost" value={money(result.totalCost)} sub={`${percent(result.totalPct)} of baseline`} tone="bad" />
                  <Metric label="Delivery impact" value={`+${result.deliveryImpactDays} days`} sub={`${result.leadTimeWithDelay}-day lead time`} />
                  <Metric label="Inventory shortfall" value={`${result.inventoryShortfallDays} days`} sub={`Buffer ${result.bufferDays} days${result.bufferUnknown ? ' (unknown)' : ''}`} tone={result.inventoryShortfallDays ? 'warn' : 'good'} />
                  <Metric label="Potential shortage cost" value={result.delayCosted ? money(result.shortageCost) : 'Not costed'} />
                </MetricGrid>
                <p className="text-xs text-slate-500">Deterministic planning model: there is no statistical confidence interval. Uncertainty comes from the assumptions listed under Detailed evidence.</p>
              </div>
            ) },
            { id: 'impact', label: 'Impact analysis', content: (
              <div className="space-y-3">
                <MetricGrid max={4}>
                  <Metric label="Baseline cost (12 mo)" value={money(result.baseline)} sub={<ProvenanceTag kind={prov.importSpend} />} />
                  <Metric label="Additional freight" value={money(result.additionalFreight)} />
                  <Metric label="Tariff exposure" value={money(result.tariffExposure)} />
                  <Metric label="Carbon change" value={signedCo2e(result.co2eChangeKg)} sub="Transport only, estimate" />
                </MetricGrid>
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <Card padded={false} className="p-1.5"><SupplyMap data={data} textList={false} className="h-[22rem]" label="Scenario impact map" /></Card>
                  <Card title="Affected" subtitle={`${percent(result.affected.share, 0)} of sourcing`}>
                    <ul className="space-y-1 text-sm">{result.affected.supplierIds.map((id) => <li key={id} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-500" />{supplierName(id)}</li>)}</ul>
                    <p className="mt-2 text-xs text-slate-500">{result.affected.shipmentIds.length} shipment(s) on affected routes.</p>
                  </Card>
                </div>
                {result.deliveryImpactDays > 0 && <Card title="Supply timeline" aside={<Badge tone="amber">Hypothetical delay</Badge>}><SupplyTimeline leadTimeDays={model.resolved.leadTimeDays} delayDays={result.deliveryImpactDays} bufferDays={result.bufferDays} uncoveredDays={result.inventoryShortfallDays} /></Card>}
              </div>
            ) },
            { id: 'alternatives', label: 'Alternatives', count: result.strategies.length, content: (
              <Gate feature="scenario.compare">
                <div className="mb-3 grid gap-3 md:grid-cols-3">
                  <SelectInput label="Alternative source" placeholder="Generic alternative (assumption)" value={altChoice} onChange={setAltChoice} options={alternatives.map((a) => ({ value: a.id, label: `${a.name} · ${a.trustLabel}` }))} />
                  <Slider label="Volume moved" min={10} max={100} step={10} unit="%" value={altShare} onChange={setAltShare} />
                  <Slider label="Price difference" min={-20} max={40} step={1} unit="%" prefix={premiumPct > 0 ? '+' : ''} value={premiumPct} onChange={setPremiumPct} />
                </div>
                <StrategyChart strategies={result.strategies} lowestCostId={result.lowestCostId} />
                <DataTable caption="Response comparison" rowKey={(s) => s.id} rows={result.strategies} columns={[
                  { key: 'name', label: 'Response', render: (s) => <span><span className="font-semibold text-navy">{s.name}</span>{s.supplierName && <span className="block text-xs text-slate-500">{s.supplierName}</span>}{s.id === result.lowestCostId && <span className="block text-xs font-medium text-emerald-700">Lowest est. cost</span>}</span> },
                  { key: 'total', label: 'Added cost', right: true, render: (s) => money(s.total) },
                  { key: 'lead', label: 'Lead time', render: (s) => s.leadTime },
                  { key: 'co2', label: 'CO₂e change', right: true, render: (s) => signedCo2e(s.co2eChangeKg) },
                  { key: 'feas', label: 'Feasibility', render: (s) => <span className="text-slate-600">{s.feasibility.level}. {s.feasibility.text}</span> },
                ]} />
                <p className="mt-2 text-xs text-slate-500">Lowest cost is one lens. Weigh timing, feasibility and emissions before choosing.</p>
              </Gate>
            ) },
            { id: 'evidence', label: 'Detailed evidence', content: (
              <div className="space-y-3">
                <Card title="Assumptions and their sources">
                  <ul className="space-y-1 text-sm text-slate-700">{result.assumptions.map((a) => <li key={a.text} className="flex flex-wrap items-baseline justify-between gap-x-3"><span>{a.text}</span><span className="text-xs text-slate-500">{a.source}</span></li>)}</ul>
                </Card>
                <CollapsiblePanel title="Scenario inputs used" summary={ran.name}>
                  <pre className="overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify({ type: ran.type, params: ran.params, alternative, altShare }, null, 2)}</pre>
                </CollapsiblePanel>
              </div>
            ) },
            { id: 'next', label: 'Next steps', content: (
              <div className="grid gap-3 md:grid-cols-2">
                <Card title="Save scenario" subtitle={`${counts.scenarios} of ${limit('scenarios').toLocaleString()} saved`}>
                  <Button disabled={!canSave} onClick={save}>Save “{ran.name}”</Button>
                  {!canSave && <p className="mt-1 text-xs text-amber-700">This plan’s saved-scenario limit is reached.</p>}
                </Card>
                <Card title="Investigate and report">
                  <div className="flex flex-wrap gap-2">
                    <AiLauncher label="AI analysis" task="Explain these simulation findings and possible alternatives." context={[ran.name, `Total added cost ${money(result.totalCost)}`, `Delivery impact +${result.deliveryImpactDays} days`]} />
                    <ReportAction build={buildReport} />
                    <Link to="/app/canadian" className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">Compare suppliers</Link>
                  </div>
                </Card>
              </div>
            ) },
          ]} />
        </section>
      )}

      <ConfirmModal open={Boolean(deleting)} title="Delete scenario" onClose={() => setDeleting(null)} onConfirm={async () => { await deleteRecord('scenarios', deleting.id); setDeleting(null) }}>
        Delete “{deleting?.name}”?
      </ConfirmModal>
    </div>
  )
}
