/*
  "Analyze with AI": adds a record to the AI Trade Analyst from anywhere in the
  app. The button can also be dragged onto the analyst dock or workspace, but
  dragging is never required: a click or the Enter key does the same thing.
*/
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { DRAG_TYPE, dragPayload, readDrop, useAnalyst } from '../../state/analystContext.js'
import { useViewPrefs } from '../../state/viewPrefs.js'
import { Icon } from '../ui.jsx'
import { useToast } from './kit.jsx'

const MESSAGES = {
  added: 'Added to AI Trade Analyst',
  exists: 'Already in AI Trade Analyst',
  full: 'AI Trade Analyst is full. Remove an item first.',
  missing: 'That record is no longer available.',
}

/** Shared by the button, the dock and the workspace drop area. */
export function useAddToAnalyst() {
  const { add } = useAnalyst()
  const toast = useToast()
  return (type, id, extra) => {
    const result = add(type, id, extra)
    toast(MESSAGES[result], result === 'added' || result === 'exists' ? 'good' : 'error')
    return result
  }
}

/**
 * @param open  true to go straight to the analyst after adding
 * @param extra the headline fields, for news items
 */
export default function AnalyzeButton({ type, id, extra, label = 'Analyze with AI', open = false, compact = false, className = '' }) {
  const { prefs } = useViewPrefs()
  const addTo = useAddToAnalyst()
  const navigate = useNavigate()
  if (!prefs.features.analyst) return null

  const onClick = (e) => {
    e.stopPropagation()
    const result = addTo(type, id, extra)
    if (open && (result === 'added' || result === 'exists')) navigate('/app/analyst')
  }

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, dragPayload(type, id, extra))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onClick}
      aria-label={compact ? label : undefined}
      title={compact ? label : 'Click to add, or drag onto the AI Trade Analyst'}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-brand-500 ${className}`}
    >
      <Icon name="sparkles" className="h-4 w-4 shrink-0" />
      {!compact && label}
    </button>
  )
}

/** Floating shortcut to the analyst, showing how many items are waiting. Accepts dropped cards. */
export function AnalystDock() {
  const { items } = useAnalyst()
  const { prefs } = useViewPrefs()
  const addTo = useAddToAnalyst()
  const { pathname } = useLocation()
  if (!prefs.features.analyst || pathname.startsWith('/app/analyst') || !items.length) return null
  return (
    <Link
      to="/app/analyst"
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        const data = readDrop(e)
        if (!data) return
        e.preventDefault()
        addTo(data.type, data.id, data.extra)
      }}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-30 flex items-center gap-2 rounded-full bg-brand-700 py-2.5 pr-4 pl-3 text-sm font-semibold text-white shadow-lg shadow-black/40 hover:bg-brand-600 print:hidden"
    >
      <Icon name="sparkles" className="h-5 w-5" />
      AI Analyst
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-[#2e1065]">{items.length}</span>
    </Link>
  )
}
