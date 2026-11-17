import { describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { autoMapping, importTemplate, parseImport, persistImport, validateImport } from '../src/engine/importer.js'
import { readXlsx } from '../src/utils/xlsx.js'
import { createLocalRepository } from '../src/services/repository.js'
import { buildModel } from '../src/engine/model.js'
import { DEMO_COMPANIES } from '../src/data/demoCompanies.js'
const file = (text, name = 'sample.csv') => ({ name, size: text.length, text: async () => text })
const workbook = cells => zipSync(Object.fromEntries(Object.entries({ 'xl/workbook.xml': '<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${cells}</sheetData></worksheet>` }).map(([k,v]) => [k,strToU8(v)])))
describe('business import', () => {
  it('maps columns, validates values and rejects duplicates inside and outside the upload', async () => {
    const parsed = await parseImport(file('supplier,country,annual spend\nOne,Canada,120\nOne,CA,200\nExisting,CA,100\nBad,XX,-1'))
    const rows = validateImport(parsed,'suppliers',autoMapping(parsed.headers,'suppliers'),{suppliers:[{name:'Existing'}]})
    expect(rows.map(r => r.valid)).toEqual([true,false,false,false]); expect(rows[0].record.country).toBe('CA'); expect(rows[3].errors.length).toBeGreaterThan(1)
  })
  it('rejects invalid types, malformed CSV, empty, oversized and duplicate-header files', async () => {
    for(const f of [file('x','old.xls'),file('name\n"unfinished'),file(''),{...file('name\nx'),size:6*1024*1024},file('name,name\na,b')]) await expect(parseImport(f)).rejects.toThrow()
  })
  it('validates supplier references, dates and numeric types on shipment rows', async () => {
    const p = await parseImport(file('reference,supplier,eta,weight kg\nS1,Missing,2026-02-30,text'))
    const [r] = validateImport(p,'shipments',autoMapping(p.headers,'shipments'),{shipments:[],suppliers:[]})
    expect(r.valid).toBe(false); expect(r.errors.length).toBe(3)
  })
  it('supports manual remapping and sample templates', async () => {
    const p = await parseImport(file('Custom,Place\nWidget,CA'))
    expect(validateImport(p,'suppliers',{name:0,country:1},{suppliers:[]})[0].valid).toBe(true)
    for(const kind of ['suppliers','shipments','products','costs']) expect(importTemplate(kind).split('\r\n')).toHaveLength(2)
  })
  it('persists rows across repository reload and supplies them to the common model', async () => {
    const storage = new Map(); vi.stubGlobal('localStorage', {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)})
    const ws = DEMO_COMPANIES[0].build(); const repo = createLocalRepository('import-test',()=>ws)
    const p = await parseImport(file('name,country,annual spend\nImported vendor,CA,1200'))
    const logImport = vi.fn(); const rows = validateImport(p,'suppliers',autoMapping(p.headers,'suppliers'),ws)
    const result = await persistImport(rows,'suppliers',{saveRecord:(c,r)=>repo.put(c,r),logImport,format:'csv'})
    expect(result.imported).toBe(1); expect(logImport).toHaveBeenCalledOnce()
    const reloaded = await createLocalRepository('import-test',()=>({})).load()
    expect(buildModel(reloaded).suppliers.some(s=>s.name==='Imported vendor')).toBe(true)
    vi.unstubAllGlobals()
  })
  it('reports partial persistence failures and never reports them as saved', async () => {
    const r = await persistImport([{row:2,valid:true,record:{name:'x'}}],'products',{saveRecord:async()=>{throw Error('plan limit')},logImport:async()=>{},format:'csv'})
    expect(r.imported).toBe(0);expect(r.failed).toBe(1)
  })
})
describe('safe XLSX reader', () => {
  it('reads sparse inline-string and numeric cells', () => {
    const data = workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="C1"><v>12</v></c></row>')
    expect(readXlsx(data)).toEqual([['name','','12']])
  })
  it('rejects formulas, error cells, invalid ZIP and dangerous XML', () => {
    for(const data of [new Uint8Array([1,2]),workbook('<row><c r="A1"><f>1+1</f><v>2</v></c></row>'),workbook('<row><c r="A1" t="e"><v>#VALUE!</v></c></row>'),workbook('<!DOCTYPE x><row/>')]) expect(()=>readXlsx(data)).toThrow()
  })
})
