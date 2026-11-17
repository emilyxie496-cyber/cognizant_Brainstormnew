import { useMemo, useState } from 'react'
import { IMPORT_FIELDS, autoMapping, importTemplate, parseImport, persistImport, validateImport } from '../../engine/importer.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { platform } from '../../services/api.js'
import { Button } from '../ui.jsx'
import { Notice } from './kit.jsx'
import { Evidence } from './PlatformKit.jsx'

export default function ImportWizard({ onComplete }) {
  const { ws, saveRecord } = useWorkspace()
  const [kind, setKind] = useState('suppliers')
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => parsed ? validateImport(parsed, kind, mapping, ws) : [], [parsed, kind, mapping, ws])
  function template() { const url = URL.createObjectURL(new Blob([importTemplate(kind)], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = `waymark-${kind}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  return <div className="space-y-3 text-sm"><p>Upload → map columns → review validation → confirm valid records. Files are read in your browser. Maximum 5 MB; formulas and legacy XLS files are unsupported.</p>
    <label className="block">Record type<select disabled={busy} className="ml-2 rounded border p-2" value={kind} onChange={e => { setKind(e.target.value); setParsed(null); setResult(null) }}><option value="suppliers">Suppliers</option><option value="shipments">Shipments</option><option value="products">Inventory/products</option><option value="costs">Costs and purchasing (new vendors)</option></select></label>
    <Button variant="secondary" onClick={template}>Download sample template</Button>
    <label className="block">CSV or XLSX file<input disabled={busy} type="file" accept=".csv,.xlsx" className="mt-2 block w-full" onChange={async e => { const file = e.target.files[0]; setError(''); setResult(null); setParsed(null); if (!file) return; try { const data = await parseImport(file); setParsed(data); setMapping(autoMapping(data.headers, kind)) } catch(e) { setError(e.message) } }} /></label>
    {error && <Notice tone="error">{error}</Notice>}
    {parsed && !result && <><div className="grid gap-2 sm:grid-cols-2">{IMPORT_FIELDS[kind].map(k => <label key={k}>{k}<select className="ml-2 max-w-full rounded border p-2" value={mapping[k] ?? -1} onChange={e => setMapping({ ...mapping, [k]: Number(e.target.value) })}><option value={-1}>Not mapped</option>{parsed.headers.map((h,i) => <option key={i} value={i}>{h}</option>)}</select></label>)}</div>
      <p>Unmapped columns will not be imported: {parsed.headers.filter((_,i) => !Object.values(mapping).includes(i)).join(', ') || 'none'}.</p>
      <Evidence label={`Preview (${parsed.rows.length} rows; first 10 shown)`} value={parsed.rows.slice(0,10)} />
      <p>{rows.filter(r => r.valid).length} valid · {rows.filter(r => !r.valid).length} rejected. Existing records will not be overwritten.</p><ul className="max-h-40 overflow-auto">{rows.filter(r => !r.valid).slice(0,100).map(r => <li key={r.row}>Row {r.row}: {r.errors.join('; ')}</li>)}</ul>
      <Button disabled={busy || !rows.some(r => r.valid)} onClick={async () => { setBusy(true); try { setResult(await persistImport(rows, kind, { saveRecord, logImport: platform.logImport, format: parsed.format })); onComplete?.() } catch(e) { setError(e.message) } finally { setBusy(false) } }}>{busy ? 'Importing…' : 'Confirm and import valid records'}</Button>
    </>}
    {result && <Notice><p>Import finished: {result.imported} saved, {result.rejected} rejected, {result.failed} failed.</p>{result.failures.map((f,i) => <p key={i}>{f}</p>)}<p>Saved records are available in this workspace after reload.</p></Notice>}
  </div>
}
