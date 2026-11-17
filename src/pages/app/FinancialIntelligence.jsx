import { financialIntelligence } from '../../../shared/business.js'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Card, Notice, PageHeader, Stat } from '../../components/app/kit.jsx'
import { Evidence, Feedback, Investigate, usePlatform } from '../../components/app/PlatformKit.jsx'
import { MappingForm } from './Inventory.jsx'
import { money } from '../../utils/format.js'

export default function FinancialIntelligence() {
  const { model, ws } = useWorkspace()
  const state = usePlatform(async () => ({ ...await platform.businessData(), ...await platform.integrations() }))
  const data = state.data
  const fin = data && financialIntelligence(data.finance, data.mappings, model)
  const qb = data?.integrations.find(i => i.id === 'quickbooks')
  return <div className="space-y-4"><PageHeader title="Financial Intelligence">Accounting facts, recorded business inputs and disruption estimates retain their own provenance.</PageHeader><Feedback state={state} />
    <div className="grid gap-3 sm:grid-cols-3"><Stat label="Recorded annual import spend" value={money(model.resolved.importSpend)} sub={model.resolved.provenance.importSpend} /><Stat label="Recorded annual freight spend" value={money(model.resolved.freightSpend)} sub={model.resolved.provenance.freightSpend} /><Stat label="Accounting provider" value={qb?.statusLabel ?? 'Unavailable'} sub={`Latest sync: ${qb?.lastSyncAt ?? 'Never'}`} /></div>
    <Card tour="finance-suppliers" title="Supplier cost comparison"><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Supplier</th><th>Annual spend CAD</th><th>Unit purchase cost</th><th>Lead time</th></tr></thead><tbody>{model.suppliers.map(s => <tr className="border-t border-slate-200" key={s.id}><td className="py-3">{s.name}</td><td>{s.spendCad == null ? 'Not recorded' : money(s.spendCad)}</td><td>{s.purchaseCost ?? 'Not recorded'} {s.currency}</td><td>{s.leadTimeDays ?? 'Unknown'} days</td></tr>)}</tbody></table></div><Investigate task="Evaluate the financial impact of a two-week supplier delay and compare supplier costs" /></Card>
    {fin ? <><Card title="Synced accounting facts" subtitle={`${fin.source} · ${fin.demo ? 'Sample data' : 'Provider records'} · ${fin.asOf}`}><div className="grid gap-3 sm:grid-cols-3"><Stat label={`Period spending (${fin.currency})`} value={fin.totalSpend.toLocaleString()} /><Stat label={`Outstanding payables (${fin.currency})`} value={fin.outstandingPayables.toLocaleString()} /><Stat label="Source documents" value={fin.documentCount} /></div>{fin.notes.map(n => <p key={n} className="mt-3 text-sm">{n}</p>)}<Evidence label="Supplier spending and period versus annual comparison" value={fin.vendors} /><Notice>Synced-period spending and annual recorded spending use different time bases. A difference is not a budget overrun.</Notice><Evidence label="Purchasing categories" value={fin.categories} />{fin.trend.length ? <Evidence label="Recorded monthly spending trend" value={fin.trend} /> : <p className="mt-3 text-sm">A spending trend requires at least three months of records.</p>}<Evidence label="Source budgets (where available)" value={fin.budgets} /></Card><Card title="Vendor to supplier mapping"><MappingForm provider="quickbooks" records={fin.vendors.filter(v => v.vendorId).map(v => ({ id: v.vendorId, name: v.name }))} targets={ws.suppliers} mappings={data.mappings} reload={state.reload} /></Card></> : <Notice>Accounting data is unavailable. Connect read-only QuickBooks or load demo records in Integrations. Imported purchasing inputs still contribute to the recorded supplier analysis above.</Notice>}
    <Card tour="finance-scenarios" title="Hypothetical disruption costs">{ws.scenarios.length ? ws.scenarios.map(s => <div key={s.id} className="mb-3 text-sm"><strong>{s.name}</strong><p>{s.result?.description}</p><p>Estimated added cost: {s.result?.totalCost == null ? 'Unavailable' : money(s.result.totalCost)}</p></div>) : <p className="text-sm">Save a Risk Simulator scenario to compare estimated costs. These are planning estimates, never accounting facts.</p>}</Card>
  </div>
}
