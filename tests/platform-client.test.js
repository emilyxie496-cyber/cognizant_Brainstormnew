import { afterEach, describe, expect, it, vi } from 'vitest'
import { platform } from '../src/services/api.js'
import { sessionApiHeaders } from '../src/state/WorkspaceContext.jsx'
afterEach(()=>vi.unstubAllGlobals())
describe('platform client boundaries',()=>{
  it('does not attach an existing account token to demo or local workspaces',()=>{
    for(const mode of ['demo','local']) expect(sessionApiHeaders({mode},'private-account-token','pro','workspace-key')).toEqual({'X-Waymark-Preview-Plan':'pro','X-Waymark-Workspace':'workspace-key'})
    expect(sessionApiHeaders({mode:'supabase'},'private-account-token','free',null)).toEqual({Authorization:'Bearer private-account-token'})
  })
  it('decodes split CRLF SSE and a final result without a trailing delimiter',async()=>{
    const chunks=['event: run\r','\ndata: {"id":"r"}\r\n\r\nevent: tool_end\r\ndata: {"name":"get_shipments","status":"ok"}\r\n\r\n','event: done\ndata: {"id":"r","status":"completed"}']
    vi.stubGlobal('fetch',async()=>new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close()}}),{headers:{'Content-Type':'text/event-stream'}}))
    const events=[];const run=await platform.runAgent({task:'test'},(name,data)=>events.push({name,data}))
    expect(run.status).toBe('completed');expect(events.map(e=>e.name)).toEqual(['run','tool_end','done'])
  })
  it('reports an interrupted stream instead of returning a fabricated result',async()=>{
    vi.stubGlobal('fetch',async()=>new Response('event: run\ndata: {"id":"r"}\n\n',{headers:{'Content-Type':'text/event-stream'}}))
    await expect(platform.runAgent({task:'test'},()=>{})).rejects.toMatchObject({code:'incomplete'})
  })
})
