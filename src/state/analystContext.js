/*
  What the user has picked for the AI Trade Analyst, and the conversation so
  far. It follows them from page to page and survives a reload.

  Storage is keyed by company id, so one workspace never sees another's
  context. Only ids are stored for company records: the cards are rebuilt from
  the live model each time, so they cannot go stale or outlive a deleted record.
*/
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { contextItem, resolveItems } from '../engine/analyst.js'
import { useWorkspace } from './WorkspaceContext.jsx'

const PREFIX = 'waymark.analyst.v1.'
export const MAX_ITEMS = 12
const MAX_MESSAGES = 30
const EMPTY = { items: [], messages: [] }

const cache = new Map()
const listeners = new Set()

function read(companyId) {
  if (!cache.has(companyId)) {
    let value = EMPTY
    try {
      const stored = JSON.parse(localStorage.getItem(PREFIX + companyId))
      if (stored && Array.isArray(stored.items)) value = { items: stored.items, messages: Array.isArray(stored.messages) ? stored.messages : [] }
    } catch {
      // Unreadable storage starts empty.
    }
    cache.set(companyId, value)
  }
  return cache.get(companyId)
}

function write(companyId, value) {
  cache.set(companyId, value)
  try {
    localStorage.setItem(PREFIX + companyId, JSON.stringify(value))
  } catch {
    // Storage can be full or blocked. The context still works for this visit.
  }
  listeners.forEach((fn) => fn())
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useAnalyst() {
  const { ws, model } = useWorkspace()
  const companyId = ws?.company?.id ?? 'none'
  const state = useSyncExternalStore(subscribe, () => read(companyId), () => EMPTY)
  const items = useMemo(() => (model ? resolveItems(state.items, model) : []), [state.items, model])

  /** Adds a record by type and id, or a news headline via `extra`. Returns 'added', 'exists', 'full' or 'missing'. */
  const add = useCallback(
    (type, id, extra) => {
      const item = model ? contextItem(type, id, model, extra) : null
      if (!item) return 'missing'
      const current = read(companyId)
      if (current.items.some((i) => i.key === item.key)) return 'exists'
      if (current.items.length >= MAX_ITEMS) return 'full'
      // Company records are stored as a pointer only. A headline has no record to point at, so it is stored whole.
      const stored = type === 'news' ? item : { key: item.key, type, id }
      write(companyId, { ...current, items: [...current.items, stored] })
      return 'added'
    },
    [companyId, model],
  )
  const remove = useCallback((key) => write(companyId, { ...read(companyId), items: read(companyId).items.filter((i) => i.key !== key) }), [companyId])
  const clear = useCallback(() => write(companyId, EMPTY), [companyId])
  const say = useCallback(
    (message) => {
      const current = read(companyId)
      write(companyId, { ...current, messages: [...current.messages, { ...message, id: crypto.randomUUID(), at: new Date().toISOString() }].slice(-MAX_MESSAGES) })
    },
    [companyId],
  )
  const clearChat = useCallback(() => write(companyId, { ...read(companyId), messages: [] }), [companyId])

  return { items, messages: state.messages, add, remove, clear, say, clearChat }
}

/** The payload a draggable card carries, and how a drop target reads it back. */
export const DRAG_TYPE = 'application/x-waymark-item'
export const dragPayload = (type, id, extra) => JSON.stringify({ type, id, extra })
export function readDrop(event) {
  try {
    const data = JSON.parse(event.dataTransfer.getData(DRAG_TYPE))
    return data && typeof data.type === 'string' ? data : null
  } catch {
    return null
  }
}
