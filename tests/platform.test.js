import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../server/app.js'
import { loadConfig } from '../server/config.js'
import { createFileStore } from '../server/store.js'
import { createVault, hmacSha256, redact } from '../server/crypto.js'
import { createIntegrationService } from '../server/integrations/service.js'
import { assertHost, verifyShopifyWebhook } from '../server/integrations/adapters.js'
import { createApprovals } from '../server/approvals.js'
import { createMonitor } from '../server/monitor.js'
import { createNotifier, buildNotification } from '../server/notify.js'
import { verifyProvider, openConversation } from '../server/ai/providers.js'
import { ADAPTERS } from '../server/integrations/adapters.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runAgent } from '../server/agent/orchestrator.js'
import { buildModel } from '../src/engine/model.js'
import { DEMO_COMPANIES } from '../src/data/demoCompanies.js'
import { workspaceSnapshot } from '../src/state/WorkspaceContext.jsx'
import { demoWeatherScenario } from '../server/integrations/fixtures.js'

const ws = DEMO_COMPANIES[0].build()
const payload = {workspace:workspaceSnapshot(ws)}
let server, upstream, base, providerBase, lastRequest, mode = 'ok'
const url = s => `http://127.0.0.1:${s.address().port}`
const listen = handler => new Promise(resolve => { const s = http.createServer(handler).listen(0,'127.0.0.1',()=>resolve(s)) })
const config = extra => ({...loadConfig({}),dataDir:'',encryptionKey:'test-persistent-key',rateLimitPerMinute:5000,...extra})
beforeAll(async () => {
  upstream = await listen((req,res) => {
    let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
      lastRequest={path:req.url,body,auth:req.headers.authorization}
      res.setHeader('Content-Type','application/json')
      if(mode==='fail'){res.statusCode=401;return res.end(JSON.stringify({error:{message:'SECRET-DO-NOT-LEAK'}}))}
      if(req.url==='/models')return res.end(JSON.stringify({data:[{id:'test-model'}]}))
      if(req.url.startsWith('/v1/models'))return res.end(JSON.stringify({data:[{id:'test-model',type:'model',display_name:'Test',created_at:'2026-01-01T00:00:00Z'}],has_more:false,first_id:'test-model',last_id:'test-model'}))
      if(req.url==='/v1/messages') {
        res.setHeader('Content-Type','text/event-stream')
        const events=[['message_start',{type:'message_start',message:{id:'m1',type:'message',role:'assistant',model:'test-model',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}}],['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Mocked response'}}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}}],['message_stop',{type:'message_stop'}]]
        return res.end(events.map(([event,data])=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''))
      }
      if(req.url==='/token')return res.end(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600}))
      if(req.url.includes('/companyinfo/'))return res.end(JSON.stringify({CompanyInfo:{CompanyName:'Mock Books'}}))
      if(req.url.includes('/query?'))return res.end(JSON.stringify({QueryResponse:{Vendor:[{Id:'v1',DisplayName:'Mock vendor'}]}}))
      if(req.url==='/chat/completions') {
        const input=JSON.parse(body)
        const messages=input.messages
        const toolResults=messages.filter(m=>m.role==='tool')
        let tool
        if(!toolResults.length)tool={id:'call1',type:'function',function:{name:'get_shipments',arguments:'{}'}}
        else if(toolResults.length===1)tool={id:'call2',type:'function',function:{name:'get_shipments',arguments:'{}'}}
        else tool={id:'done',type:'function',function:{name:'submit_findings',arguments:JSON.stringify({summary:'Added cost is 999999999999 CAD.',recommendations:[],uncertainties:[]})}}
        res.setHeader('Content-Type','text/event-stream')
        return res.end(`data: ${JSON.stringify({model:'test-model',choices:[{delta:{tool_calls:[{index:0,...tool}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}})}\n\ndata: [DONE]\n\n`)
      }
      return res.end('ok')
    })
  })
  providerBase=url(upstream)
  server=createApp(config()).listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve));base=url(server)
})
afterAll(async()=>{await Promise.all([server,upstream].map(s=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve)})))})
async function req(path, body, tenant='tenant-A-abcdefghijklmnopqrstuvwxyz', method=body?'POST':'GET') {
  const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','X-Waymark-Workspace':tenant,'X-Waymark-Preview-Plan':'pro'},body:body?JSON.stringify(body):undefined})
  return {status:res.status,data:await res.json()}
}
function service(extra={}) {const store=createFileStore();return {store,service:createIntegrationService({config:config({quickbooksClientId:'id',quickbooksClientSecret:'secret',quickbooksTokenUrl:providerBase+'/token',quickbooksApiBaseUrl:providerBase,...extra}),store,vault:createVault('test'),fetchImpl:fetch})}}
describe('credential and provider boundaries',()=>{
  it('encrypts, authenticates and rejects altered ciphertext and changed keys',()=>{
    const v=createVault('one');const sealed=v.seal({apiKey:'super-private'});expect(sealed).not.toContain('super-private');expect(v.open(sealed)).toEqual({apiKey:'super-private'});expect(createVault('two').open(sealed)).toBe(null);expect(v.open(sealed.replace('v1.','v2.'))).toBe(null)
  })
  it('redacts nested secrets and secret-looking values',()=>{expect(JSON.stringify(redact({credentials:{apiKey:'raw',text:'sk-12345678901234567890'},nested:{token:'hidden'}}))).not.toMatch(/raw|hidden|sk-/)})
  it('validates exact provider domains and rejects local, lookalike and credential URLs',()=>{
    expect(assertHost('https://hooks.slack.com/services/a',['hooks.slack.com'],config()).hostname).toBe('hooks.slack.com')
    for(const u of ['http://127.0.0.1/a','https://hooks.slack.com.evil.test/a','https://user:pass@hooks.slack.com/a'])expect(()=>assertHost(u,['hooks.slack.com'],config())).toThrow()
  })
  it('checks Shopify raw-body signatures',()=>{const raw=Buffer.from('{"test":1}');const signature=hmacSha256('secret',raw,'base64');expect(verifyShopifyWebhook('secret',raw,signature)).toBe(true);expect(verifyShopifyWebhook('secret',Buffer.from('altered'),signature)).toBe(false);expect(verifyShopifyWebhook('',raw,signature)).toBe(false)})
  it('rejects unknown workspace and forged bearer tokens',async()=>{const r=await fetch(base+'/api/approvals');expect(r.status).toBe(400);expect((await fetch(base+'/api/approvals',{headers:{Authorization:'Bearer fake'}})).status).toBe(401)})
})
describe('OAuth and verified connection state (local mock, not live)',()=>{
  it('exchanges a valid state, verifies the company, syncs and rejects replay',async()=>{
    const {service:s}=service();const {authorizeUrl}=await s.connect('a','quickbooks');const state=new URL(authorizeUrl).searchParams.get('state')
    expect(await s.oauthCallback({state,code:'code',realmId:'123456'})).toContain('connected=quickbooks')
    expect((await s.get('a','quickbooks')).status).toBe('connected')
    expect((await s.get('b','quickbooks')).status).not.toBe('connected')
    await s.sync('a','quickbooks');expect((await s.datasets('a')).finance).toBeTruthy()
    expect(await s.oauthCallback({state,code:'again',realmId:'123456'})).toContain('error=state')
  })
  it('rejects missing, invalid, expired and denied states',async()=>{
    const {service:s}=service();expect(await s.oauthCallback({})).toContain('error=state');expect(await s.oauthCallback({state:'bogus'})).toContain('error=state')
    const first=await s.connect('a','quickbooks');const state=new URL(first.authorizeUrl).searchParams.get('state')
    const now=Date.now();const spy=vi.spyOn(Date,'now').mockReturnValue(now+11*60000)
    expect(await s.oauthCallback({state,code:'late'})).toContain('error=state');spy.mockRestore()
    const second=await s.connect('a','quickbooks');expect(await s.oauthCallback({state:new URL(second.authorizeUrl).searchParams.get('state'),error:'access_denied'})).toContain('error=denied')
  })
  it('reports exchange failure without echoing upstream secrets',async()=>{
    const {service:s}=service();const a=await s.connect('a','quickbooks');mode='fail'
    try{expect(await s.oauthCallback({state:new URL(a.authorizeUrl).searchParams.get('state'),code:'bad',realmId:'123456'})).toContain('error=exchange');expect(JSON.stringify(await s.events('a','quickbooks'))).not.toContain('SECRET-DO-NOT-LEAK')}finally{mode='ok'}
  })
  it('never considers a saved webhook verified before a successful test send',async()=>{
    const {service:s}=service({extraAllowedHosts:['127.0.0.1']});await s.connect('a','slack',{webhookUrl:providerBase+'/hook'})
    expect((await s.get('a','slack')).status).toBe('configuration_required')
    await s.disconnect('a','slack');expect((await s.get('a','slack')).hasCredentials).toBe(false)
  })
})
describe('actual API and deterministic agent workflow',()=>{
  it('persists sample datasets with honest states and isolates tenants',async()=>{
    for(const id of ['quickbooks','shopify','salesforce','project44'])expect((await req(`/integrations/${id}/demo`,payload)).data.integration.status).toBe('demo')
    expect((await req('/business/data')).data.finance.demo).toBe(true)
    expect((await req('/business/data',undefined,'tenant-B-abcdefghijklmnopqrstuvwxyz')).data.finance).toBe(null)
  })
  it('streams real tool events, saves reports and unsent approvals, and reopens history',async()=>{
    const res=await fetch(base+'/api/agent/run',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream','X-Waymark-Workspace':'tenant-A-abcdefghijklmnopqrstuvwxyz','X-Waymark-Preview-Plan':'pro'},body:JSON.stringify({...payload,provider:'planner',demoScenario:'weather',task:'Investigate weather and prepare a Slack notification'})})
    const stream=await res.text();for(const e of ['run','status','tool_start','tool_end','done'])expect(stream).toContain(`event: ${e}`)
    const run=JSON.parse(/event: done\ndata: (.+)/.exec(stream)[1]);expect(run.status).toBe('completed');expect(run.result.grounded).toBe(true);expect(run.reports.length).toBeGreaterThan(0);expect(run.approvalIds.length).toBe(1)
    expect((await req(`/agent/runs/${run.id}`)).data.run.id).toBe(run.id)
    expect((await req(`/agent/runs/${run.id}`,undefined,'tenant-B-abcdefghijklmnopqrstuvwxyz')).status).toBe(404)
    const id=run.approvalIds[0];const decision=await req(`/approvals/${id}/decision`,{decision:'approve'});expect(decision.data.approval.status).toBe('not_sent')
    expect((await req(`/approvals/${id}/decision`,{decision:'approve'})).status).toBe(409)
  })
  it('persists AI preferences and rejects unconfigured providers',async()=>{
    const updated=await req('/settings',{aiProvider:'openai',sharing:{financial:false,customers:false,inventory:false}},undefined,'PUT');expect(updated.status).toBe(200)
    expect((await req('/ai/providers')).data.sharing.financial).toBe(false)
    expect((await req('/agent/run',{...payload,task:'Analyze risk',provider:'openai'})).status).toBe(409)
  })
  it('suppresses duplicate monitor alerts and throttles browser auto triggers',async()=>{
    await req('/settings',{monitor:{weather:false,news:false}},undefined,'PUT')
    const first=await req('/monitor/run',payload);expect(first.status).toBe(200)
    const second=await req('/monitor/run',payload);expect(second.data.newAlerts).toBe(0)
    const auto=await req('/monitor/run',{...payload,trigger:'auto'});expect(auto.data.skipped).toBe(true)
  })
})
describe('LLM orchestration against mocked SSE provider',()=>{
  const ctx=()=>({model:buildModel(ws),ws,config:config(),data:{},sharing:{financial:true,customers:true,inventory:true},weather:async()=>({alerts:[],days:[]}),track:async()=>({available:false}),news:async()=>({articles:[]}),requestApproval:async()=>{throw Error('not permitted')}})
  const provider={id:'openai',kind:'openai',label:'Mock OpenAI',configured:true,capabilities:{streaming:true},model:'test-model',apiKey:'test',tokenParam:'max_completion_tokens'}
  it('handles repeated calls and flags ungrounded output',async()=>{
    const run=await runAgent({task:'Inspect shipments',ctx:ctx(),provider:{...provider,baseUrl:providerBase},fetchImpl:fetch})
    expect(run.toolCalls.map(c=>c.status)).toEqual(['ok','repeat']);expect(run.result.grounded).toBe(false);expect(run.result.verifiedSummary).toBeTruthy()
  })
  it('withholds financial data from shipment tools when sharing is disabled',async()=>{
    const context=ctx();context.sharing.financial=false
    const run=await runAgent({task:'Inspect shipments',ctx:context,provider:{...provider,baseUrl:providerBase},fetchImpl:fetch})
    expect(run.toolCalls.length).toBeGreaterThan(0);expect(run.toolCalls.every(c=>c.status==='withheld')).toBe(true);expect(lastRequest.body).not.toContain(ws.shipments[0].reference)
  })
  it('enforces tool budgets and authorization allow-lists',async()=>{
    const context=ctx();context.config.agentMaxToolCalls=1
    const limited=await runAgent({task:'Inspect shipments',ctx:context,provider:{...provider,baseUrl:providerBase},fetchImpl:fetch})
    expect(limited.toolCalls.some(c=>c.status==='limit')).toBe(true)
    const denied=await runAgent({task:'Inspect shipments',ctx:ctx(),provider:{...provider,baseUrl:providerBase},fetchImpl:fetch,allowedTools:[]})
    expect(denied.toolCalls.every(c=>c.status==='denied')).toBe(true)
  })
})

describe('provider and reliability checks',()=>{
  it.each(['openai','gemini','xai'])('verifies %s models against a local compatible endpoint',async id=>{
    const {service:s}=service({[`${id}BaseUrl`]:providerBase})
    const result=await s.connect('mock-ai',id,{apiKey:'test-secret-key',model:'test-model'})
    expect(result.integration.status).toBe('connected');expect(JSON.stringify(result)).not.toContain('test-secret-key')
  })
  it('exercises Anthropic SDK model verification and Messages SSE against a local server',async()=>{
    const provider={id:'anthropic',kind:'anthropic',label:'Mock Claude',configured:true,model:'test-model',apiKey:'test',baseUrl:providerBase,capabilities:{streaming:true}}
    expect((await verifyProvider(provider,fetch)).modelOk).toBe(true)
    const chunks=[];const turn=await openConversation(provider,{system:'Test',user:'Test',fetchImpl:fetch}).turn({onText:t=>chunks.push(t)})
    expect(turn.text).toBe('Mocked response');expect(chunks.join('')).toBe('Mocked response')
  })
  it('verifies a webhook with an authorized local test and suppresses duplicate deliveries',async()=>{
    const {service:s,store}=service({extraAllowedHosts:['127.0.0.1']});await s.connect('notify','slack',{webhookUrl:providerBase+'/hook'})
    const notifier=createNotifier({store,integrations:s})
    const test=await notifier.sendTest('notify','slack',{actor:'test owner',appBaseUrl:'http://localhost'})
    expect(test.status).toBe('sent');expect((await s.get('notify','slack')).status).toBe('connected')
    const message=buildNotification({category:'weather_disruption',subject:'S1',demo:true})
    expect((await notifier.deliver('notify',{channel:'slack',message,dedupeKey:'one'})).status).toBe('sent')
    expect((await notifier.deliver('notify',{channel:'slack',message,dedupeKey:'one'})).status).toBe('skipped_duplicate')
  })
  it('refuses viewer approval decisions and concurrent double decisions',async()=>{
    const store=createFileStore();let sends=0
    const notifier={preferences:async()=>({enabled:true,autoSend:false,categories:{}}),deliver:async()=>{sends++;await new Promise(r=>setTimeout(r,5));return {id:'delivery',status:'sent',destination:'mock'}}}
    const approvals=createApprovals({store,notifier,integrations:{statusOf:async()=> 'connected'}})
    const {approval}=await approvals.request('tenant',{type:'slack_message',title:'Test',message:{category:'test'},createdBy:'test'})
    await expect(approvals.decide('tenant',approval.id,{decision:'approve',role:'viewer'})).rejects.toMatchObject({status:403})
    const decisions=await Promise.allSettled([1,2].map(()=>approvals.decide('tenant',approval.id,{decision:'approve',role:'owner',actor:'owner'})))
    expect(decisions.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(sends).toBe(1)
  })
  it('recovers persisted monitoring tenants after store restart and deduplicates runs',async()=>{
    const dir=mkdtempSync(path.join(tmpdir(),'waymark-monitor-'))
    try {
      const first=createFileStore({dataDir:dir});await first.put('tenant','platform_settings',{id:'monitor_snapshot',sealed:createVault('test').seal(payload)})
      const recovered=createFileStore({dataDir:dir});expect(await recovered.tenants()).toEqual(['tenant'])
      const monitor=createMonitor({store:recovered,investigate:async()=>({id:'run',status:'completed',toolCalls:[],approvalIds:[]}),channelsFor:async()=>[]})
      const context={model:buildModel(ws),data:{},config:config()};const settings={enabled:true,delays:true,weather:false,news:false,inventory:false,minLevel:'high',maxInvestigations:1}
      const timer=monitor.start(0.0001,async()=>({ctx:context,settings}))
      try { await vi.waitFor(async()=>expect((await monitor.stateOf('tenant')).runs).toBeGreaterThan(0),{timeout:1000}) } finally {clearInterval(timer)}
      expect((await monitor.run('tenant',context,settings)).newAlerts).toBe(0)
    } finally {if(path.dirname(path.resolve(dir)) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith('waymark-monitor-')) throw Error('Unexpected test directory');rmSync(dir,{recursive:true,force:true})}
  })
})
