// Financial Intelligence: accounting facts, recorded inputs and estimated disruption costs, each labelled with its provenance.
import { financialIntelligence } from '../../../shared/business.js'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Card, CollapsiblePanel, CompactPageHeader, DataTable, Metric, MetricGrid, Notice, SectionTabs, StatusPill } from '../../components/app/kit.jsx'
import { Badge } from '../../components/ui.jsx'
import AiLauncher from '../../components/app/AiLauncher.jsx'
import ReportAction from '../../components/app/ReportAction.jsx'
import { Evidence, Feedback, usePlatform } from '../../components/app/PlatformKit.jsx'
import { MappingForm } from './Inventory.jsx'
import { money, percent } from '../../utils/format.js'

const Fact = () => <Badge tone="emerald">Accounting fact</Badge>
const Recorded = () => <Badge tone="sky">Recorded input</Badge>
const Estimate = () => <Badge tone="amber">Estimate</Badge>

export default function FinancialIntelligence() {
  const { model, ws, isDemo } = useWorkspace()
  const state = usePlatform(async () => ({ ...await platform.businessData(), ...await platform.integrations() }))
  const data = state.data
  const fin = data && financialIntelligence(data.finance, data.mappings, model)
  const qb = data?.integrations.find((i) => i.id === 'quickbooks')
  const scenarios = ws.scenarios ?? []
  const exposure = scenarios.reduce((max, s) => Math.max(max, s.result?.totalCost ?? 0), 0)
  const maxTrend = Math.max(1, ...(fin?.trend ?? []).map((t) => t.total ?? 0))

  const buildReport = () => ({
    title: 'Financial intelligence summary',
    typeId: 'finance',
    sections: [
      { heading: 'Executive summary', paragraphs: [`Recorded annual import spend ${money(model.resolved.importSpend)} and freight spend ${money(model.resolved.freightSpend)} (company inputs).`, fin ? `Accounting records (${fin.source}, ${fin.demo ? 'sample data' : 'provider records'}, ${fin.asOf}): period spending ${fin.totalSpend.toLocaleString()} ${fin.currency}, outstanding payables ${fin.outstandingPayables.toLocaleString()} ${fin.currency}.` : 'No accounting provider data is connected.', scenarios.length ? `Largest saved scenario estimate: ${money(exposure)} added cost (planning estimate, not an accounting fact).` : 'No saved disruption scenarios.'] },
      { heading: 'Supplier comparison (recorded inputs)', table: { head: ['Supplier', 'Annual spend CAD', 'Unit purchase cost', 'Lead time'], rows: model.suppliers.map((s) => [s.name, s.spendCad == null ? 'Not recorded' : money(s.spendCad), `${s.purchaseCost ?? 'Not recorded'} ${s.currency ?? ''}`, `${s.leadTimeDays ?? 'Unknown'} days`]) } },
      ...(fin ? [{ heading: 'Spending by vendor (accounting facts)', table: { head: ['Vendor', `Period spend (${fin.currency})`, 'Documents', 'Linked supplier'], rows: fin.vendors.map((v) => [v.name, v.total.toLocaleString(), v.documents, v.supplierName ?? 'Unlinked']) }, paragraphs: fin.notes }] : []),
      ...(scenarios.length ? [{ heading: 'Estimated disruption costs', table: { head: ['Scenario', 'Estimated added cost', 'Description'], rows: scenarios.map((s) => [s.name, s.result?.totalCost == null ? 'Unavailable' : money(s.result.totalCost), s.result?.description ?? '']) } }] : []),
      { heading: 'Assumptions and limitations', bullets: ['Synced-period spending and annual recorded spending use different time bases; a difference is not a budget overrun.', 'Scenario costs are hypothetical planning estimates.', 'Currencies are never combined.'] },
    ],
    sources: [{ label: 'Company records', detail: isDemo ? 'Fictional demo data' : 'Entered by your company' }, ...(fin ? [{ label: fin.source, detail: `${fin.demo ? 'Sample data' : 'Provider records'} · ${fin.asOf}` }] : [])],
  })

  return (
    <div className="space-y-3">
      <CompactPageHeader title="Financial Intelligence" description="Accounting facts, recorded business inputs and disruption estimates, each with its own provenance."
        actions={<>
          <AiLauncher task="Analyze the financial implications of this disruption." context={[`Recorded import spend ${money(model.resolved.importSpend)}`, `${scenarios.length} saved scenario(s)`, fin ? `Accounting data: ${fin.source}` : 'No accounting data connected']} />
          <ReportAction build={buildReport} />
        </>} />
      <Feedback state={state} />

      <MetricGrid max={4}>
        <Metric label="Financial exposure" value={scenarios.length ? money(exposure) : '—'} sub={scenarios.length ? 'Largest saved scenario · estimate' : 'Save a Risk Simulator scenario'} tone={exposure ? 'warn' : 'default'} />
        <Metric label="Supplier spending" value={money(model.resolved.importSpend)} sub={`Recorded annual · ${model.resolved.provenance.importSpend}`} />
        <Metric label="Freight spending" value={money(model.resolved.freightSpend)} sub={`Recorded annual · ${model.resolved.provenance.freightSpend}`} />
        <Metric label="Data freshness" value={qb?.statusLabel ?? 'Unavailable'} sub={`Accounting sync: ${qb?.lastSyncAt ?? 'never'}`} />
      </MetricGrid>

      <Card padded>
        <SectionTabs idPrefix="fin" label="Financial intelligence" tabs={[
          { id: 'suppliers', label: 'Supplier comparison', count: model.suppliers.length, content: (
            <div data-tour="finance-suppliers">
              <p className="mb-2"><Recorded /></p>
              <DataTable caption="Supplier cost comparison" rowKey={(s) => s.id} rows={model.suppliers} columns={[
                { key: 'name', label: 'Supplier', render: (s) => <span className="font-semibold text-navy">{s.name}</span> },
                { key: 'spend', label: 'Annual spend CAD', right: true, render: (s) => (s.spendCad == null ? '—' : money(s.spendCad)) },
                { key: 'share', label: 'Share', right: true, render: (s) => percent(s.share, 0) },
                { key: 'unit', label: 'Unit cost', right: true, render: (s) => (s.purchaseCost == null ? '—' : `${s.purchaseCost} ${s.currency}`) },
                { key: 'lead', label: 'Lead time', right: true, render: (s) => (s.leadTimeDays == null ? '—' : `${s.leadTimeDays} d`) },
              ]} />
            </div>
          ) },
          { id: 'spending', label: 'Spending analysis', content: fin ? (
            <div className="space-y-3">
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Fact /> {fin.source} · {fin.demo ? 'Sample data' : 'Provider records'} · {fin.asOf}</p>
              <MetricGrid max={3}>
                <Metric label={`Period spending (${fin.currency})`} value={fin.totalSpend.toLocaleString()} />
                <Metric label={`Outstanding payables (${fin.currency})`} value={fin.outstandingPayables.toLocaleString()} />
                <Metric label="Source documents" value={fin.documentCount} />
              </MetricGrid>
              <DataTable caption="Spending by vendor" rowKey={(v) => v.vendorId ?? v.name} rows={fin.vendors} columns={[
                { key: 'name', label: 'Vendor', render: (v) => <span className="font-semibold text-navy">{v.name}</span> },
                { key: 'total', label: `Period (${fin.currency})`, right: true, render: (v) => v.total.toLocaleString() },
                { key: 'docs', label: 'Docs', right: true, render: (v) => v.documents },
                { key: 'link', label: 'Supplier', render: (v) => v.supplierName ? <span className="text-xs">{v.supplierName} <StatusPill tone={v.link === 'mapped' ? 'emerald' : 'amber'}>{v.link === 'mapped' ? 'mapped' : 'name match'}</StatusPill></span> : <span className="text-xs text-slate-400">Unlinked</span> },
                { key: 'var', label: 'vs annual', right: true, render: (v) => (v.variancePct == null ? '—' : percent(v.variancePct, 0)) },
              ]} />
              {fin.trend.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Monthly spending trend</p>
                  <ul className="space-y-1">{fin.trend.map((t) => <li key={t.month ?? t.period} className="grid grid-cols-[5rem_minmax(0,1fr)_6rem] items-center gap-2 text-xs"><span>{t.month ?? t.period}</span><span className="h-2 rounded bg-slate-100"><span className="block h-2 rounded bg-brand-600" style={{ width: `${Math.round(((t.total ?? 0) / maxTrend) * 100)}%` }} /></span><span className="text-end tabular-nums">{(t.total ?? 0).toLocaleString()}</span></li>)}</ul>
                </div>
              ) : <p className="text-xs text-slate-500">A spending trend needs at least three months of records.</p>}
              <CollapsiblePanel title="Purchasing categories and budgets" summary={`${fin.categories.length} categories`}>
                <DataTable caption="Purchasing categories" rowKey={(c) => c.name} rows={fin.categories} columns={[{ key: 'n', label: 'Category', render: (c) => c.name }, { key: 't', label: `Total (${fin.currency})`, right: true, render: (c) => c.total.toLocaleString() }]} />
                <Evidence label="Source budgets (where available)" value={fin.budgets} />
              </CollapsiblePanel>
              <Notice>Synced-period spending and annual recorded spending use different time bases. A difference is not a budget overrun.</Notice>
            </div>
          ) : <Notice>Accounting data is unavailable. Connect read-only QuickBooks or load demo records in Integrations.</Notice> },
          { id: 'impact', label: 'Financial impact', count: scenarios.length, content: (
            <div data-tour="finance-scenarios">
              <p className="mb-2"><Estimate /> <span className="text-xs text-slate-500">Planning estimates from saved Risk Simulator scenarios, never accounting facts.</span></p>
              <DataTable caption="Estimated disruption costs" rowKey={(s) => s.id} rows={scenarios} empty={<p className="text-sm text-slate-500">Save a Risk Simulator scenario to compare estimated costs.</p>} columns={[
                { key: 'name', label: 'Scenario', render: (s) => <span className="font-semibold text-navy">{s.name}</span> },
                { key: 'cost', label: 'Est. added cost', right: true, render: (s) => (s.result?.totalCost == null ? 'Unavailable' : money(s.result.totalCost)) },
                { key: 'desc', label: 'Description', render: (s) => <span className="text-xs text-slate-600">{s.result?.description}</span> },
              ]} />
            </div>
          ) },
          { id: 'sources', label: 'Mappings & sources', content: (
            <div className="space-y-3">
              <ul className="text-sm text-slate-700">
                <li><Recorded /> Company profile and supplier records ({model.resolved.provenance.importSpend})</li>
                <li className="mt-1"><Fact /> {fin ? `${fin.source} · ${fin.asOf}` : 'No accounting provider connected'}</li>
                <li className="mt-1"><Estimate /> Risk Simulator scenarios</li>
              </ul>
              {fin ? <CollapsiblePanel title="Vendor to supplier mapping" summary={`${fin.vendors.filter((v) => v.vendorId).length} vendor(s)`} defaultOpen><MappingForm provider="quickbooks" records={fin.vendors.filter((v) => v.vendorId).map((v) => ({ id: v.vendorId, name: v.name }))} targets={ws.suppliers} mappings={data.mappings} reload={state.reload} /></CollapsiblePanel> : null}
            </div>
          ) },
        ]} />
      </Card>
    </div>
  )
}
