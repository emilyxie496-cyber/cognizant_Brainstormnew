/*
  Company branding (display name and logo), loaded once per workspace from the
  server and shared by the top bar, the Command Center, reports and settings.
  The server is the source of truth; nothing here is written to localStorage.
*/
import { useEffect, useSyncExternalStore } from 'react'
import { platform } from '../services/api.js'
import { useWorkspace } from './WorkspaceContext.jsx'

let state = { key: null, status: 'idle', data: null, error: null }
const listeners = new Set()
const set = (next) => {
  state = { ...state, ...next }
  listeners.forEach((fn) => fn())
}
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

async function load(key) {
  set({ key, status: 'loading', error: null })
  try {
    const { branding } = await platform.branding()
    if (state.key === key) set({ status: 'ready', data: branding })
  } catch (err) {
    // Offline API or a static host: the company name from the workspace is used instead.
    if (state.key === key) set({ status: 'error', data: null, error: err.message })
  }
}

/** A branding snapshot for this workspace. `save` and `reload` update every screen that uses it. */
export function useBranding() {
  const { session, ws } = useWorkspace()
  const key = session ? `${session.mode ?? ''}:${ws?.company?.id ?? ''}` : null
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state)
  useEffect(() => {
    if (key && state.key !== key) load(key)
  }, [key])
  return {
    ...snapshot,
    data: snapshot.key === key ? snapshot.data : null,
    reload: () => key && load(key),
    async save(changes) {
      const { branding } = await platform.saveBranding(changes)
      set({ status: 'ready', data: branding, error: null })
      return branding
    },
  }
}

/** The branding values reports and exports should use: saved branding first, then the company record. */
export function reportBranding(branding, company) {
  return { displayName: branding?.displayName || company?.name || '', logo: branding?.logo ?? null, website: branding?.website ?? '', tagline: branding?.tagline ?? '' }
}
