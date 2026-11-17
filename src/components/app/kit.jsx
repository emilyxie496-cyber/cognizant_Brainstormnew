/*
  Application UI kit: surfaces, form controls, data labels, feedback states.
  Data labels matter here: anything shown to a user carries its provenance.
*/
import { Component, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FEATURE_LABELS, PLANS, requiredPlan } from '../../../shared/entitlements.js'
import { PROVENANCE } from '../../engine/finance.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Badge, Button, Icon } from '../ui.jsx'

export function Card({ title, aside, children, className = '', padded = true, subtitle, tour }) {
  return (
    <section data-tour={tour} className={`min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 ${padded ? 'p-4 sm:p-5' : ''} ${className}`}>
      {(title || aside) && (
        <div className={`flex flex-wrap items-start justify-between gap-2 ${padded ? 'mb-3' : 'px-4 pt-4 pb-3 sm:px-5'}`}>
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-bold text-navy">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, children, actions, badge }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 tabIndex={-1} className="text-2xl font-bold text-navy focus:outline-none sm:text-[1.7rem]">{title}</h1>
          {badge}
        </div>
        {children && <p className="mt-1 max-w-3xl text-sm text-slate-600">{children}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, icon, tone = 'default', tag }) {
  const toneClass = { default: 'bg-slate-100 text-slate-600', good: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-700', bad: 'bg-rose-50 text-rose-700' }[tone]
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm shadow-slate-900/5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs leading-tight font-medium text-slate-500">{label}</p>
        {icon && (
          <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="font-display mt-1 truncate text-xl font-bold text-navy tabular-nums" title={typeof value === 'string' ? value : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      {tag && <div className="mt-1.5">{tag}</div>}
    </div>
  )
}

/** Where a number came from. */
export function ProvenanceTag({ kind }) {
  const p = PROVENANCE[kind] ?? PROVENANCE.missing
  return <Badge tone={p.tone}>{p.label}</Badge>
}

export function DemoTag({ children = 'Demo Data' }) {
  return <Badge tone="amber">{children}</Badge>
}

const METHOD_TAGS = {
  climatiq: { tone: 'emerald', label: 'Climatiq' },
  mixed: { tone: 'sky', label: 'Climatiq and Waymark estimate' },
  'waymark-estimate': { tone: 'amber', label: 'Waymark estimate, not Climatiq' },
}

export function MethodTag({ method }) {
  const tag = METHOD_TAGS[method]
  return tag ? <Badge tone={tag.tone}>{tag.label}</Badge> : null
}

/** External reference with its retrieval time. */
export function SourceLine({ source, at }) {
  return (
    <span className="text-[0.6875rem] text-slate-500">
      Source: {source}
      {at ? ` · ${new Date(at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
    </span>
  )
}

export function Notice({ tone = 'info', children, className = '' }) {
  const style = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${style} ${className}`}>
      <Icon name={tone === 'good' ? 'check' : tone === 'info' ? 'info' : 'alert'} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Empty({ icon = 'box', title, children, action }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-4 py-9 text-center">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Icon name={icon} />
      </span>
      <p className="mt-3 font-semibold text-navy">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-slate-600">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = 'h-24' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-slate-200/70 ${className}`} />
}

export function Spinner({ label = 'Loading' }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-700" />
      {label}
    </span>
  )
}

/** size: 'sm' for a single short form, 'md' (default), or 'lg' for tables and wizards. `wide` is the older name for 'lg'. */
export function Modal({ open, onClose, title, children, footer, wide = false, size = wide ? 'lg' : 'md' }) {
  const small = size === 'sm'
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const previous = document.activeElement
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
    // Removing a dialog closes it natively. Calling close() in cleanup would
    // also fire onClose during StrictMode's development effect replay.
    return () => { if (previous?.isConnected) previous.focus() }
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-slate-700 shadow-2xl`}
      style={{ '--wm-dialog-max': { sm: '24rem', md: '32rem', lg: '48rem' }[size] }}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className={`flex items-center justify-between gap-3 border-b border-slate-200 ${small ? 'px-4 py-2.5' : 'px-5 py-3.5'}`}>
            <h2 className={`font-bold text-navy ${small ? 'text-base' : 'text-lg'}`}>{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
              <Icon name="close" className={small ? 'h-4 w-4' : 'h-5 w-5'} />
            </button>
          </div>
          <div className={`overflow-y-auto ${small ? 'px-4 py-3.5' : 'px-5 py-4'}`}>{children}</div>
          {footer && <div className={`flex flex-wrap justify-end gap-2 border-t border-slate-200 ${small ? 'px-4 py-2.5' : 'px-5 py-3'}`}>{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

/** In-page confirmation for destructive actions. */
export function ConfirmModal({ open, title, children, confirmLabel = 'Delete', onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button className="bg-rose-700 hover:bg-rose-800" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{children}</p>
    </Modal>
  )
}

const control = 'h-10 w-full min-w-0 rounded-lg border bg-white px-3 text-sm text-slate-900 transition-shadow placeholder:text-slate-400 focus:ring-2 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500'
const controlState = (error) => (error ? 'border-rose-400 focus:ring-rose-200' : 'border-slate-300 focus:border-brand-700 focus:ring-brand-200')

export function Field({ label, hint, error, optional, children, className = '' }) {
  const id = useId()
  return (
    // The text above the control grows to fill the row, so controls that sit side by side line up
    // along their bottom edge even when one has a hint, an error or a label that wraps.
    <div className={`flex min-w-0 flex-col ${className}`}>
      <div className="flex-1">
        <label htmlFor={id} className="text-sm font-semibold text-navy">
          {label} {optional && <span className="font-normal text-slate-500">(optional)</span>}
        </label>
        {hint && <p id={`${id}-hint`} className="text-xs text-slate-500">{hint}</p>}
        {error && <p id={`${id}-error`} role="alert" className="mt-0.5 text-xs font-medium text-rose-700">{error}</p>}
      </div>
      <div className="mt-1">{children(id, error, [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined)}</div>
    </div>
  )
}

export function TextInput({ label, hint, error, optional, value, onChange, className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {(id, err, description) => <input id={id} aria-describedby={description} value={value ?? ''} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} className={`${control} ${controlState(error)}`} {...rest} />}
    </Field>
  )
}

/** Accepts any valid non-negative amount, including decimals. Keeps the typed text. */
export function NumberInput({ label, hint, error, optional, value, onChange, className, min = 0, max, step = 'any', ...rest }) {
  const invalid = value !== '' && value != null && (!Number.isFinite(Number(value)) || Number(value) < min || (max != null && Number(value) > max))
  return (
    <Field label={label} hint={hint} optional={optional} className={className} error={error ?? (invalid ? `Enter a number${max != null ? ` from ${min} to ${max}` : ` of ${min} or more`}.` : undefined)}>
      {(id, err, description) => (
        <input
          aria-describedby={description}
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          aria-invalid={Boolean(err)}
          onChange={(e) => onChange(e.target.value)}
          className={`${control} ${controlState(err)} tabular-nums`}
          {...rest}
        />
      )}
    </Field>
  )
}

export function SelectInput({ label, hint, error, optional, value, onChange, options, placeholder = 'Select…', className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional} className={className}>
      {(id, err, description) => (
        <select id={id} aria-describedby={description} value={value ?? ''} aria-invalid={Boolean(error)} onChange={(e) => onChange(e.target.value)} className={`${control} ${controlState(error)}`} {...rest}>
          {placeholder !== null && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function TextArea({ label, hint, optional, value, onChange, className, rows = 2, ...rest }) {
  return (
    <Field label={label} hint={hint} optional={optional} className={className}>
      {(id, err, description) => <textarea id={id} aria-describedby={description} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-700 focus:ring-2 focus:ring-brand-200 focus:outline-none" {...rest} />}
    </Field>
  )
}

export function Slider({ label, value, onChange, min, max, step, unit = '', prefix = '' }) {
  const id = useId()
  const text = `${prefix}${value}${unit}`
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
        <output htmlFor={id} className="text-sm font-bold text-brand-700 tabular-nums">{text}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full cursor-pointer" />
    </div>
  )
}

export function Segmented({ label, value, onChange, options }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${value === o.value ? 'bg-white text-navy shadow-sm' : 'text-slate-600 hover:text-navy'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" aria-label="Page sections" className="mb-4 flex max-w-full gap-1 overflow-x-auto border-b border-slate-200" onKeyDown={(e) => {
      const index = tabs.findIndex((t) => t.id === active)
      const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
      if (next !== null) { e.preventDefault(); onChange(tabs[next].id); e.currentTarget.querySelectorAll('[role="tab"]')[next].focus() }
    }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          tabIndex={active === t.id ? 0 : -1}
          aria-controls={`panel-${t.id}`}
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${active === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-navy'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function DataTable({ columns, rows, rowKey, caption, onRowClick, empty }) {
  if (!rows.length) return empty ?? null
  return (
    <div role="region" aria-label={caption ?? 'Data table'} tabIndex={0} className="relative max-w-full overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200 text-start text-xs tracking-wide text-slate-500 uppercase">
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={c.sort} className={`px-3 py-2 font-semibold whitespace-nowrap ${c.right ? 'text-end' : ''}`}>{c.header ?? c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} tabIndex={onRowClick ? 0 : undefined} aria-description={onRowClick ? 'Press Enter to open details' : undefined} onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(row) } } : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`border-b border-slate-100 align-top ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 ${c.right ? 'text-end tabular-nums' : ''}`}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Explains a locked feature and what unlocks it. */
export function LockedPanel({ feature, children }) {
  const { isDemo, setDemoTier } = useWorkspace()
  const needed = requiredPlan(feature)
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center" data-locked={feature}>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm">
        <Icon name="lock" />
      </span>
      <p className="mt-2 font-semibold text-navy">{FEATURE_LABELS[feature]}</p>
      <p className="mt-1 text-sm text-slate-600">Included in {PLANS[needed].name}. {children}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {isDemo && <Button size="sm" onClick={() => setDemoTier(needed)}>Preview {PLANS[needed].name} tier</Button>}
        <Link to="/pricing" className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50">Compare plans</Link>
      </div>
    </div>
  )
}

export function Gate({ feature, children, fallback }) {
  const { can } = useWorkspace()
  if (can(feature)) return children
  return fallback ?? <LockedPanel feature={feature} />
}

const ToastContext = createContext(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((message, tone = 'good') => {
    const id = crypto.randomUUID()
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  const value = useMemo(() => push, [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed end-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 print:hidden">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-fade-up rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-lg ${t.tone === 'error' ? 'bg-rose-700' : 'bg-[#2a3768]'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[waymark]', error)
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-lg p-6">
        <Notice tone="error">
          <p className="font-semibold">This section could not be displayed.</p>
          <p className="mt-1">Your saved data is unaffected. Try again, or use another section.</p>
          <button type="button" className="mt-2 font-semibold underline" onClick={() => this.setState({ error: null })}>Try again</button>
        </Notice>
      </div>
    )
  }
}

export function formatDate(value) {
  if (!value) return 'Unknown'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Trigger a browser download. Real files only: reports and CSV. */
export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ------------------------------------------------------------------------------------------
   Layout primitives shared by every workspace page (Waymark 3.0 refinement).
   They replace page-specific one-offs: drawers for detail, bounded lists for long histories,
   compact metric rows and collapsible panels. Use these before writing new page CSS.
------------------------------------------------------------------------------------------- */

/**
 * A side panel for details. Opens from the inline-end edge (right in LTR, left in RTL) on wide
 * screens and as a full-height sheet on phones. Built on <dialog>, so focus is trapped and
 * Escape closes it.
 */
export function Drawer({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const previous = document.activeElement
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title} className="wm-drawer bg-white p-0 text-slate-700 shadow-2xl" style={{ '--wm-drawer-w': { sm: '24rem', md: '32rem', lg: '44rem' }[size] }}>
      {open && (
        <div className="flex h-full max-h-[100dvh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-navy">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
          <div className="wm-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

/** A compact page header: title, one line of description, actions on the same row on wide screens. */
export function CompactPageHeader({ title, description, actions, badge, children }) {
  return (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 tabIndex={-1} className="text-xl font-bold text-navy focus:outline-none sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {(description || children) && <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{description ?? children}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A row of compact metrics. Columns adapt: 2 on phones, up to `max` on desktops. */
export function MetricGrid({ children, max = 4, className = '' }) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-3 lg:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' }[max] ?? 'sm:grid-cols-2 lg:grid-cols-4'
  return <div className={`wm-metrics grid grid-cols-2 gap-2.5 ${cols} ${className}`}>{children}</div>
}

/** A single compact metric: smaller than Stat, for summary rows. */
export function Metric({ label, value, sub, tone = 'default', icon }) {
  const toneClass = { default: 'text-navy', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700' }[tone] ?? 'text-navy'
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm shadow-slate-900/5">
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide text-slate-500 uppercase">
        {icon && <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />}<span className="truncate">{label}</span>
      </p>
      <p className={`font-display mt-0.5 text-lg leading-tight font-bold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-slate-500" title={typeof sub === 'string' ? sub : undefined}>{sub}</p>}
    </div>
  )
}

/** A panel that starts collapsed (or open) and keeps its header compact. Native <details>, so it works without script. */
export function CollapsiblePanel({ title, summary, defaultOpen = false, children, className = '', aside }) {
  return (
    <details open={defaultOpen} className={`group min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[0.9375rem] font-bold text-navy">{title}</span>
          {summary && <span className="block truncate text-xs text-slate-500">{summary}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {aside}
          <Icon name="chevronDown" className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-slate-200 px-4 py-3">{children}</div>
    </details>
  )
}

/** A search box with a label for assistive technology. */
export function SearchInput({ label, value, onChange, placeholder, className = '' }) {
  const id = useId()
  return (
    <div className={`relative min-w-0 ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? label} className={`${control} ${controlState(false)} ps-8`} />
    </div>
  )
}

/** Paging state for a list. Returns to the first page when `resetKey` changes (for example a new search). */
export function usePaged(rows, pageSize = 10, resetKey = '') {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [resetKey])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages - 1)
  return { page: current, pages, setPage, rows: rows.slice(current * pageSize, current * pageSize + pageSize), total: rows.length, from: rows.length ? current * pageSize + 1 : 0, to: Math.min(rows.length, (current + 1) * pageSize) }
}

export function Pager({ paged, label = 'Pages' }) {
  if (paged.total <= 0 || paged.pages <= 1) return null
  return (
    <nav aria-label={label} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span className="tabular-nums">{paged.from}–{paged.to} / {paged.total}</span>
      <span className="flex items-center gap-1">
        <button type="button" aria-label="Previous page" disabled={paged.page === 0} onClick={() => paged.setPage(paged.page - 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40"><Icon name="chevronLeft" className="h-4 w-4 rtl:rotate-180" /></button>
        <span className="px-1 tabular-nums">{paged.page + 1} / {paged.pages}</span>
        <button type="button" aria-label="Next page" disabled={paged.page >= paged.pages - 1} onClick={() => paged.setPage(paged.page + 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40"><Icon name="chevronRight" className="h-4 w-4 rtl:rotate-180" /></button>
      </span>
    </nav>
  )
}

/** A bounded, scrollable list area. Long histories scroll inside it rather than stretching the page. */
export function BoundedList({ children, maxHeight = '24rem', label, className = '' }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={`wm-scroll overflow-y-auto ${className}`} style={{ maxHeight }}>
      {children}
    </div>
  )
}

/**
 * Tabs with their panel. `tabs` are { id, label, count?, content }. Only the active panel renders.
 * Controlled with `active`/`onChange`, or uncontrolled. `idPrefix` keeps ids unique on pages with several tab sets.
 */
export function SectionTabs({ tabs, active, onChange, idPrefix = 'sec', label = 'Sections', className = '' }) {
  const [own, setOwn] = useState(tabs[0]?.id)
  const wanted = active ?? own
  const current = tabs.some((t) => t.id === wanted) ? wanted : tabs[0]?.id
  const set = (id) => { setOwn(id); onChange?.(id) }
  const tab = tabs.find((t) => t.id === current)
  return (
    <div className={`min-w-0 ${className}`}>
      <div role="tablist" aria-label={label} className="wm-strip mb-3 flex max-w-full gap-1 overflow-x-auto border-b border-slate-200" onKeyDown={(e) => {
        const index = tabs.findIndex((t) => t.id === current)
        const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
        const backward = forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'
        const next = e.key === forward ? (index + 1) % tabs.length : e.key === backward ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
        if (next !== null) { e.preventDefault(); set(tabs[next].id); e.currentTarget.querySelectorAll('[role="tab"]')[next].focus() }
      }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${idPrefix}-tab-${t.id}`} aria-controls={`${idPrefix}-panel-${t.id}`} aria-selected={current === t.id} tabIndex={current === t.id ? 0 : -1} onClick={() => set(t.id)}
            className={`-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${current === t.id ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-navy'}`}>
            {t.label}
            {t.count != null && <span className="rounded-full bg-slate-100 px-1.5 text-[0.6875rem] font-semibold tabular-nums text-slate-600">{t.count}</span>}
          </button>
        ))}
      </div>
      {tab && <div role="tabpanel" id={`${idPrefix}-panel-${tab.id}`} aria-labelledby={`${idPrefix}-tab-${tab.id}`} className="min-w-0">{tab.content}</div>}
    </div>
  )
}

/** A small dot-and-label status indicator. */
export function StatusPill({ tone = 'slate', children }) {
  const dot = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', sky: 'bg-sky-500', brand: 'bg-brand-500', slate: 'bg-slate-400' }[tone] ?? 'bg-slate-400'
  return <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700"><span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />{children}</span>
}

/** Main content plus a secondary panel. The panel drops below the main content on narrow screens. */
export function WorkspaceLayout({ main, aside, asideWidth = '22rem', className = '' }) {
  return (
    <div className={`grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_var(--wm-aside)] ${className}`} style={{ '--wm-aside': asideWidth }}>
      <div className="min-w-0 space-y-4">{main}</div>
      {aside && <div className="min-w-0 space-y-4">{aside}</div>}
    </div>
  )
}
