import { useEffect } from 'react'
import { platform } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'

/** Browser fallback only. The backend owns the throttle and per-tenant run lock. */
export default function MonitorTrigger() {
  const { agentPayload } = useWorkspace()
  useEffect(() => {
    let live = true
    const check = async () => {
      try { const d = await platform.monitor(); if(live && d.settings.enabled && (!d.state.lastRunAt || Date.now() - Date.parse(d.state.lastRunAt) >= 30 * 60_000)) await platform.runMonitor({ ...agentPayload(), trigger: 'auto' }) } catch { /* Errors remain visible in Agent Activity; the existing app continues working. */ }
    }
    const timer = setInterval(check, 30 * 60_000)
    return () => { live = false; clearInterval(timer) }
  }, [agentPayload])
  return null
}
