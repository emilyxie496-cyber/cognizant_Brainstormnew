import { describe, expect, it } from 'vitest'
import { financialIntelligence, inventoryRisk, customerImpact } from '../shared/business.js'
import { normalizeShopify, normalizeQuickBooks, normalizeSalesforce, normalizeMarineTraffic, normalizeProject44 } from '../server/integrations/normalize.js'
import { buildModel } from '../src/engine/model.js'
import { buildReport } from '../src/engine/reports.js'
import { DEMO_COMPANIES } from '../src/data/demoCompanies.js'
import { demoCommerce, demoCrm } from '../server/integrations/fixtures.js'

describe('business sources and computed exposure',()=>{
  const ws=DEMO_COMPANIES[0].build();const model=buildModel(ws)
  it('keeps foreign currencies out of accounting totals',()=>{
    const finance=normalizeQuickBooks({company:{currency:'CAD'},bills:[{Id:'1',TotalAmt:100,Balance:50,CurrencyRef:{value:'CAD'}},{Id:'2',TotalAmt:200,Balance:200,CurrencyRef:{value:'USD'}}]})
    const f=financialIntelligence(finance,[],model)
    expect(f.totalSpend).toBe(100);expect(f.outstandingPayables).toBe(50);expect(f.notes.join(' ')).toContain('excluded')
  })
  it('requires mappings for CRM exposure rather than guessing customer dependencies',()=>{
    const crm=normalizeSalesforce({accounts:[{Id:'c1',Name:'Customer'}],orders:[{Id:'o1',AccountId:'c1',Status:'Draft',TotalAmount:10}]})
    expect(customerImpact(crm,[],model).commitments[0].status).toBe('unlinked')
  })
  it('normalizes Shopify stock/orders without storing customer identities',()=>{
    const normalized=normalizeShopify({products:[{id:'gid://shopify/Product/1',title:'Widget',variants:{nodes:[{id:'gid://shopify/ProductVariant/2',sku:'SKU',inventoryQuantity:3}]}}],orders:[{id:'gid://shopify/Order/3',name:'#3',customer:{email:'private@example.com'},displayFulfillmentStatus:'UNFULFILLED',lineItems:{nodes:[{quantity:5,variant:{id:'gid://shopify/ProductVariant/2'}}]}}]})
    expect(JSON.stringify(normalized)).not.toContain('private@example.com');const stock=inventoryRisk(normalized,[],model)
    expect(stock.rows[0].level).toBe('short');expect(stock.rows[0].supplyRisk).toBe('unlinked');expect(stock.affectedOrders[0].status).toBe('short_stock')
  })
  it('normalizes logistics positions and milestone timelines',()=>{
    expect(normalizeMarineTraffic([{LAT:'40',LON:'-70',SHIPNAME:'Example',SPEED:120}],'S1').vessel.speedKnots).toBe(12)
    const p=normalizeProject44({shipment:{status:'IN_TRANSIT',positions:[{latitude:42,longitude:-71,dateTime:'2026-11-16T00:00:00Z'}],events:[{type:'ARRIVAL',estimateDateTime:'2026-11-20T00:00:00Z'}]}},'S2')
    expect(p.lastLocation.lat).toBe(42);expect(p.eta).toBe('2026-11-20T00:00:00Z')
  })
  it('includes imported inventory in the existing report builder',()=>{
    const updated={...ws,products:[...ws.products,{id:'imported',name:'Imported stock',onHand:12,sku:'I1',dataSource:'file_import'}]}
    const report=buildReport('risk',{ws:updated,model:buildModel(updated)})
    expect(report.sections.find(s=>s.heading==='Recorded product inventory').table.rows[0]).toContain('Imported stock')
  })
})
