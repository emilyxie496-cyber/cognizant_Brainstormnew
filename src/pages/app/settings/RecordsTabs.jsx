// Settings → Products and Suppliers: a compact searchable list, with editing in a drawer.
import { useState } from 'react'
import { ProductEditor, SupplierCsvImport, SupplierEditor, locateSupplier } from '../../../components/app/companyForms.jsx'
import { ConfirmModal, DataTable, Drawer, Empty, Notice, Pager, SearchInput, usePaged, useToast } from '../../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../../components/ui.jsx'
import { supabase } from '../../../services/supabase.js'
import { useWorkspace } from '../../../state/WorkspaceContext.jsx'

const rowActions = (onEdit, onDelete, name) => (
  <span className="flex justify-end gap-1">
    <button type="button" aria-label={`Edit ${name}`} onClick={(e) => { e.stopPropagation(); onEdit() }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy"><Icon name="edit" className="h-4 w-4" /></button>
    <button type="button" aria-label={`Delete ${name}`} onClick={(e) => { e.stopPropagation(); onDelete() }} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-700"><Icon name="trash" className="h-4 w-4" /></button>
  </span>
)

export function ProductsTab() {
  const { ws, saveRecord, deleteRecord } = useWorkspace()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)
  const q = query.trim().toLowerCase()
  const rows = ws.products.filter((p) => !q || `${p.name} ${p.category} ${p.hsCode} ${p.sku ?? ''}`.toLowerCase().includes(q))
  const paged = usePaged(rows, 12, q)
  const suppliersOf = (p) => ws.suppliers.filter((s) => (s.productIds ?? []).includes(p.id)).length

  const open = (p) => { setError(''); setEditing({ ...p }) }
  const save = async () => {
    if (!editing.name?.trim()) return setError('A product needs a name.')
    if (editing.hsCode && !/^[0-9.]{4,13}$/.test(String(editing.hsCode).trim())) return setError('An HS code has 4 to 10 digits, with optional dots.')
    setBusy(true)
    try {
      const { isNew, ...record } = editing
      await saveRecord('products', { ...record, name: record.name.trim(), hsCode: String(record.hsCode ?? '').trim() })
      toast('Product saved')
      setEditing(null)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput label="Search products" value={query} onChange={setQuery} className="sm:w-80" />
        <Button size="sm" onClick={() => open({ id: crypto.randomUUID(), name: '', category: '', hsCode: '', hsStatus: 'unverified', isNew: true })}><Icon name="plus" className="h-4 w-4" /> Add product</Button>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-900/5">
        <DataTable caption="Products" rowKey={(p) => p.id} rows={paged.rows} onRowClick={open}
          empty={<Empty icon="box" title={q ? 'No matching products' : 'No products yet'}>{q ? 'Clear the search to see all products.' : 'Add the products you buy or sell.'}</Empty>}
          columns={[
            { key: 'name', label: 'Product', render: (p) => <span className="font-semibold text-navy">{p.name || 'Untitled product'}</span> },
            { key: 'category', label: 'Category', render: (p) => p.category || <span className="text-slate-400">—</span> },
            { key: 'hs', label: 'HS code', render: (p) => p.hsCode ? <span className="tabular-nums">{p.hsCode} {p.hsStatus !== 'verified' && <Badge tone="amber">unverified</Badge>}</span> : <span className="text-slate-400">—</span> },
            { key: 'sku', label: 'SKU / stock', render: (p) => <span className="text-xs text-slate-600">{p.sku ?? '—'}{p.onHand != null && p.onHand !== '' ? ` · ${p.onHand} on hand` : ''}</span> },
            { key: 'suppliers', label: 'Suppliers', right: true, render: (p) => suppliersOf(p) },
            { key: 'actions', label: '', render: (p) => rowActions(() => open(p), () => setDeleting(p), p.name) },
          ]} />
        <Pager paged={paged} label="Product pages" />
      </div>

      <Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.isNew ? 'Add product' : 'Edit product'} subtitle="Used by the simulator, inventory and recommendation engines." size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save product'}</Button></>}>
        {editing && (
          <div className="space-y-3">
            <ProductEditor product={editing} index={Math.max(0, ws.products.findIndex((p) => p.id === editing.id))} industry={ws.company.industry} onChange={(next) => setEditing((p) => ({ ...p, ...next }))} />
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
      </Drawer>
      <ConfirmModal open={Boolean(deleting)} title="Delete product" onClose={() => setDeleting(null)} onConfirm={async () => { await deleteRecord('products', deleting.id); setDeleting(null); toast('Product deleted') }}>
        Delete {deleting?.name || 'this product'}? Suppliers linked to it keep their records.
      </ConfirmModal>
    </div>
  )
}

export function SuppliersTab() {
  const { ws, saveRecord, deleteRecord, counts, limit, session } = useWorkspace()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)
  const atLimit = counts.suppliers >= limit('suppliers')
  const q = query.trim().toLowerCase()
  const rows = ws.suppliers.filter((s) => !q || `${s.name} ${s.country} ${s.city ?? ''}`.toLowerCase().includes(q))
  const paged = usePaged(rows, 12, q)

  const blank = (row = {}) => ({ id: crypto.randomUUID(), name: '', country: '', currency: 'CAD', mode: 'sea', productIds: [], certifications: [], compliance: {}, ...row })
  const open = (s) => { setError(''); setEditing({ ...s }) }
  const save = async () => {
    if (!editing.name?.trim() || !editing.country) return setError('A supplier needs a name and a country.')
    setBusy(true)
    try {
      const { isNew, ...record } = editing
      await saveRecord('suppliers', await locateSupplier(record))
      toast('Supplier saved')
      setEditing(null)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const upload = async (file) => {
    if (!file || !editing) return
    const { error: e } = await supabase.storage.from('compliance-documents').upload(`${ws.company.id}/${editing.id}/${file.name}`, file, { upsert: true })
    toast(e ? `Upload failed: ${e.message}` : 'Document uploaded', e ? 'error' : 'good')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput label="Search suppliers" value={query} onChange={setQuery} className="sm:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">{counts.suppliers} of {limit('suppliers').toLocaleString()} used</span>
          <SupplierCsvImport onImport={async (list) => { for (const row of list) { try { await saveRecord('suppliers', blank(row)) } catch (err) { toast(err.message, 'error'); break } } }} />
          <Button size="sm" disabled={atLimit} onClick={() => open({ ...blank(), isNew: true })}><Icon name="plus" className="h-4 w-4" /> Add supplier</Button>
        </div>
      </div>
      {atLimit && <Notice tone="warn">You have reached this plan’s supplier limit. Existing suppliers stay available and editable.</Notice>}
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm shadow-slate-900/5">
        <DataTable caption="Suppliers" rowKey={(s) => s.id} rows={paged.rows} onRowClick={open}
          empty={<Empty icon="building" title={q ? 'No matching suppliers' : 'No suppliers yet'}>Add a supplier or import a CSV.</Empty>}
          columns={[
            { key: 'name', label: 'Supplier', render: (s) => <span className="font-semibold text-navy">{s.name || 'Untitled supplier'}</span> },
            { key: 'country', label: 'Country', render: (s) => [s.city, s.country].filter(Boolean).join(', ') || '—' },
            { key: 'mode', label: 'Mode', render: (s) => <Badge tone="slate">{s.mode}</Badge> },
            { key: 'products', label: 'Products', right: true, render: (s) => (s.productIds ?? []).length },
            { key: 'actions', label: '', render: (s) => rowActions(() => open(s), () => setDeleting(s), s.name) },
          ]} />
        <Pager paged={paged} label="Supplier pages" />
      </div>

      <Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.isNew ? 'Add supplier' : 'Edit supplier'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</Button></>}>
        {editing && (
          <div className="space-y-3">
            <SupplierEditor supplier={editing} index={Math.max(0, ws.suppliers.findIndex((s) => s.id === editing.id))} products={ws.products} warehouses={ws.warehouses} onChange={(next) => setEditing((s) => ({ ...s, ...next }))} showCompliance />
            {session?.mode === 'supabase' && !editing.isNew
              ? <label className="inline-block cursor-pointer text-sm font-semibold text-brand-800 underline">Upload compliance document<input type="file" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} /></label>
              : <p className="text-xs text-slate-500">Document uploads need secure storage, which requires a configured account backend and a saved supplier.</p>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
      </Drawer>
      <ConfirmModal open={Boolean(deleting)} title="Delete supplier" onClose={() => setDeleting(null)} onConfirm={async () => { await deleteRecord('suppliers', deleting.id); setDeleting(null) }}>
        Delete {deleting?.name || 'this supplier'}? Linked shipments keep their records but lose the supplier link.
      </ConfirmModal>
    </div>
  )
}
