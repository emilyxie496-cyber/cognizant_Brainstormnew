import { parseCsv } from '../utils/csv.js'
import { readXlsx } from '../utils/xlsx.js'
import { COUNTRIES } from '../../shared/countries.js'

export const IMPORT_LIMIT = 5 * 1024 * 1024
export const IMPORT_FIELDS = {
  suppliers: ['name','country','city','annualSpend','currency','purchaseCost','quantity','sharePct','leadTimeDays','mode'],
  shipments: ['reference','supplierId','productId','mode','status','eta','quantity','weightKg','cost','currency'],
  products: ['name','sku','category','hsCode','unit','onHand','unitCost','currency'],
  costs: ['name','annualSpend','purchaseCost','quantity','currency'],
}
const aliases = { name: ['supplier','supplier name','product','product name','vendor'], reference: ['shipment','shipment reference','tracking number'], annualSpend: ['annual spend','annual spending'], supplierId: ['supplier id','supplier'], productId: ['product id','product'], cost: ['freight cost','shipping cost'], onHand: ['stock','inventory','on hand'], purchaseCost: ['unit price','purchase cost'], unitCost: ['unit cost'], weightKg: ['weight','weight kg'], eta: ['arrival date'] }
const normal = s => String(s ?? '').trim().toLowerCase().replace(/[_-]+/g,' ')
export function autoMapping(headers, kind) {
  return Object.fromEntries(IMPORT_FIELDS[kind].map(k => [k, headers.findIndex(h => normal(h) === normal(k) || normal(h).replace(/ /g,'') === k.toLowerCase() || (aliases[k] ?? []).includes(normal(h)))]))
}
export async function parseImport(file) {
  const format = file.name.toLowerCase().split('.').pop()
  if (!['csv','xlsx'].includes(format)) throw new Error('Choose a .csv or .xlsx file. Legacy .xls is unsupported.')
  if (file.size > IMPORT_LIMIT) throw new Error('Files must be 5 MB or smaller.')
  const rows = format === 'csv' ? parseCsv((await file.text()).replace(/^\uFEFF/,'')) : readXlsx(await file.arrayBuffer())
  if (rows.length < 2) throw new Error('A header and at least one data row are required.')
  if (rows.length > 10001 || rows[0].length > 256) throw new Error('Files support at most 10,000 rows and 256 columns.')
  if (rows[0].some(h => !String(h).trim()) || new Set(rows[0].map(normal)).size !== rows[0].length) throw new Error('Headers must be non-empty and unique.')
  return { format, fileName: file.name, headers: rows[0], rows: rows.slice(1) }
}
const numeric = ['annualSpend','purchaseCost','quantity','sharePct','leadTimeDays','weightKg','cost','onHand','unitCost']
export function validateImport(parsed, kind, mapping, ws) {
  const collection = kind === 'costs' ? 'suppliers' : kind
  const keyField = kind === 'shipments' ? 'reference' : 'name'
  const seen = new Set((ws[collection] ?? []).map(r => normal(r[keyField])))
  const skus = new Set((ws[collection] ?? []).map(r => normal(r.sku)).filter(Boolean))
  return parsed.rows.map((row,i) => {
    const record = Object.fromEntries(Object.entries(mapping).filter(([,n]) => n >= 0).map(([k,n]) => [k, String(row[n] ?? '').trim()]))
    const errors = []
    if (!record[keyField]) errors.push(`${keyField} is required`)
    for (const k of numeric) if (record[k] !== undefined && record[k] !== '') {
      if (!Number.isFinite(Number(record[k])) || Number(record[k]) < 0) errors.push(`${k} must be a non-negative number`)
      else record[k] = Number(record[k])
    }
    if (record.sharePct > 100) errors.push('sharePct must be at most 100')
    if (kind === 'suppliers') {
      const country = COUNTRIES.find(c => normal(c.code) === normal(record.country) || normal(c.name) === normal(record.country))
      if (!country) errors.push('A recognized country is required'); else record.country = country.code
      record.productIds = []
    }
    if (kind === 'costs' && record.annualSpend === undefined && record.purchaseCost === undefined) errors.push('annualSpend or purchaseCost is required')
    if (kind === 'shipments') {
      for (const [key, list] of [['supplierId','suppliers'],['productId','products']]) {
        if (!record[key] && key === 'productId') continue
        const found = (ws[list] ?? []).find(r => r.id === record[key] || normal(r.name) === normal(record[key]))
        if (!found) errors.push(`${key} must reference an existing record`); else record[key] = found.id
      }
      if (record.eta && (!/^\d{4}-\d{2}-\d{2}$/.test(record.eta) || !Number.isFinite(Date.parse(record.eta)) || new Date(record.eta).toISOString().slice(0,10) !== record.eta)) errors.push('eta must be a valid YYYY-MM-DD date')
      record.direction = 'import'; record.status ||= 'booked'
      if (!['booked','dispatched','in_transit','at_port','delayed','arrived'].includes(record.status)) errors.push('Unsupported shipment status')
    }
    if (record.mode && !['sea','air','road','rail'].includes(record.mode)) errors.push('mode must be sea, air, road or rail')
    record.currency ||= 'CAD'
    if (!/^[A-Z]{3}$/.test(record.currency)) errors.push('currency must be a three-letter uppercase code')
    const key = normal(record[keyField])
    if (seen.has(key)) errors.push('Duplicate record; existing records are never overwritten')
    if (kind === 'products' && record.sku && skus.has(normal(record.sku))) errors.push('Duplicate SKU; existing products are never overwritten')
    if (kind === 'products' && record.sku) skus.add(normal(record.sku))
    if (key) seen.add(key)
    return { row: i + 2, record: { ...record, dataSource: 'file_import', importedAt: new Date().toISOString() }, errors, valid: errors.length === 0 }
  })
}
export async function persistImport(rows, kind, { saveRecord, logImport, format }) {
  let saved = 0
  const failures = []
  for (const row of rows.filter(r => r.valid)) {
    try { await saveRecord(kind === 'costs' ? 'suppliers' : kind, { ...row.record, id: crypto.randomUUID() }); saved++ }
    catch(e) { failures.push(`Row ${row.row}: ${e.message}`) }
  }
  const summary = { type: kind, total: rows.length, imported: saved, rejected: rows.filter(r => !r.valid).length, skipped: rows.filter(r => !r.valid).length, duplicates: rows.filter(r => r.errors?.some(e => e.startsWith('Duplicate'))).length, failed: failures.length }
  try { await logImport(format, summary) } catch(e) { failures.push(`Records saved, but import audit failed: ${e.message}`) }
  return { ...summary, failures }
}
export function importTemplate(kind) {
  const examples = { suppliers: ['Example supplier','CA','Toronto','12000','CAD','10','1200','20','14','road'], shipments: ['EXAMPLE-001','Existing supplier name','Existing product name','sea','booked','2027-01-15','100','1000','500','CAD'], products: ['Example product','SKU-001','Materials','', 'units','100','10','CAD'], costs: ['Example purchasing vendor','12000','10','1200','CAD'] }
  return [IMPORT_FIELDS[kind].join(','), examples[kind].join(',')].join('\r\n')
}
