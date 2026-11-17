import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { TEXT_SIZES, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { HELP_TOPICS } from '../../help/topics.js'
import { matchHelp } from '../../help/matcher.js'
import { Button, Icon } from '../ui.jsx'
import { useTranslation } from '../../i18n/index.js'
import { Modal, SelectInput, TextInput } from './kit.jsx'

export const hasSpeech = () => typeof window !== 'undefined' && Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === 'function'

export function TextSizeControl({ target = 'text-size' }) {
  const { prefs, setTextSize } = useViewPrefs()
  const { t } = useTranslation()
  return <label data-tour={target} className="inline-flex flex-wrap items-center gap-2 text-sm font-semibold text-navy">{t('display.textSize')}
    <select aria-label={t('display.textSize')} value={prefs.textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="rounded-lg border border-slate-300 bg-white p-1 text-slate-900">
      {TEXT_SIZES.map((n) => <option key={n} value={n}>{n}%</option>)}
    </select>
  </label>
}

function Switch({ label, help, checked, onChange, tour }) {
  return (
    <label data-tour={tour} className="flex cursor-pointer items-start justify-between gap-3 py-2">
      <span className="min-w-0"><span className="block text-sm font-semibold text-navy">{label}</span>{help && <span className="block text-xs text-slate-500">{help}</span>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand-600)]" />
    </label>
  )
}

/** Settings → Accessibility & Display: text size, read aloud and motion. Everything that used to sit in the top bar. */
export function AccessibilitySettings() {
  const { prefs, setReadAloudButton, setReduceMotion, setSpeechRate } = useViewPrefs()
  const { t } = useTranslation()
  const speech = hasSpeech()
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5" aria-labelledby="a11y-heading">
    <h2 id="a11y-heading" className="text-[0.9375rem] font-bold text-navy">Accessibility</h2>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <TextSizeControl target="text-size-settings" />
        <p className="text-xs text-slate-500">Scales all workspace text: 100%, 115%, 130% or 150%.</p>
        <Switch label={t('display.reduceMotion')} help={t('display.reduceMotionHelp')} checked={prefs.reduceMotion} onChange={setReduceMotion} />
      </div>
      <div data-tour="read-aloud-settings" className="space-y-1">
        <Switch label={`${t('display.readAloud')}: show a Read aloud button on every page`} help={speech ? t('display.readAloudHelp') : 'Read aloud is unavailable because this browser does not support Web Speech. You can still use a screen reader.'} checked={prefs.readAloudButton && speech} onChange={setReadAloudButton} />
        {speech && <SelectInput label="Reading speed" placeholder={null} value={prefs.speechRate} onChange={(v) => setSpeechRate(Number(v))} options={[0.75, 1, 1.25, 1.5].map((n) => ({ value: n, label: `${n}×` }))} />}
        {speech && <ReadAloud inline />}
        <p className="text-xs text-slate-500">Waymark uses only device voices and sends no text to an external API. Browser speech voices may use an online service depending on your browser.</p>
      </div>
    </div>
    <p className="text-xs text-slate-500">Use Help in the top bar for offline guided tours. Keyboard users can use Skip to content, headings, labelled controls and table alternatives.</p>
  </section>
}

// Walk visible semantic content in document order; do not repeat container text.
export function readableText(root) {
  if (!root) return ''
  const selector = 'h1,h2,h3,h4,h5,h6,p,dt,dd,li,[role="alert"],[role="status"],[role="img"][aria-label],figcaption,caption,tr'
  const blocks = [...root.querySelectorAll(selector)]
  return blocks.filter((el) => !el.closest('[aria-hidden="true"],script,style,nav,[hidden]') && el.getClientRects().length && (el.tagName === 'TR' || !el.querySelector(selector)))
    .map((el) => {
      if (el.tagName === 'TR') {
        if (el.closest('thead')) return ''
        const headers = [...(el.closest('table')?.querySelector('thead tr')?.cells ?? [])].map((cell) => cell.textContent.trim())
        return [...el.cells].map((cell, i) => `${headers[i] ? `${headers[i]}: ` : ''}${cell.textContent.trim()}`).join('; ')
      }
      if (el.closest('table')) return el.tagName === 'CAPTION' ? el.textContent.trim() : ''
      return el.getAttribute('aria-label') ?? el.textContent.trim()
    }).filter(Boolean).join('. ').replace(/\s+/g, ' ')
}

function ReadAloud({ inline = false, floating = false }) {
  const { prefs, setSpeechRate } = useViewPrefs()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState('Stopped')
  const [sections, setSections] = useState([])
  const [section, setSection] = useState('page')
  const queue = useRef([])
  const generation = useRef(0)
  const stop = () => { generation.current++; queue.current = []; window.speechSynthesis?.cancel(); setState('Stopped') }
  useEffect(() => { stop(); setOpen(false) }, [location.pathname, location.search]) // route changes cancel narration
  useEffect(() => () => { generation.current++; window.speechSynthesis?.cancel() }, [])
  if (!hasSpeech()) return null
  function play() {
    if (state === 'Paused') { window.speechSynthesis.resume(); setState('Playing'); return }
    stop()
    const voices = window.speechSynthesis.getVoices().filter((v) => v.localService)
    if (!voices.length) { setState('No device voice is available yet. Try again or use your screen reader.'); return }
    const root = section === 'page' ? document.getElementById('app-content') : sections[Number(section)]?.element
    const content = readableText(root)
    if (!content) { setState('No readable content in this section'); return }
    queue.current = content.match(/.{1,220}(?:\s|$)|.{1,220}/g) ?? []
    const token = generation.current
    const next = () => {
      if (token !== generation.current) return
      const chunk = queue.current.shift()
      if (!chunk) { setState('Finished'); return }
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.voice = voices.find((v) => v.lang.startsWith('en')) ?? voices[0]
      utterance.rate = prefs.speechRate
      utterance.onend = next
      utterance.onerror = () => { if (token === generation.current) setState('Speech could not be played. Try again.') }
      window.speechSynthesis.speak(utterance)
    }
    setState('Playing'); next()
  }
  const openPanel = () => {
    setSections([...document.querySelectorAll('#app-content section')].map((element) => ({ element, label: element.querySelector('h2,h3')?.textContent })).filter((s) => s.label))
    setSection('page'); setOpen(true)
  }
  return <>
    {floating
      ? <button type="button" data-tour="read-aloud" onClick={openPanel} aria-label="Read aloud" title="Read aloud" className="fixed end-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-800 shadow-lg print:hidden"><Icon name="newspaper" className="h-5 w-5" /></button>
      : <Button size="sm" variant="secondary" data-tour={inline ? 'read-aloud-preview' : 'read-aloud'} onClick={openPanel}>{inline ? 'Try read aloud on this page' : 'Read aloud'}</Button>}
    <Modal open={open} onClose={() => { stop(); setOpen(false) }} title="Read aloud">
      <div className="space-y-3">
        <SelectInput label="Content to read" placeholder={null} value={section} onChange={(value) => { stop(); setSection(value) }} options={[{ value: 'page', label: 'Current page' }, ...sections.map((s, i) => ({ value: String(i), label: s.label }))]} />
        <SelectInput label="Reading speed" placeholder={null} value={prefs.speechRate} onChange={(v) => { stop(); setSpeechRate(Number(v)) }} options={[0.75, 1, 1.25, 1.5].map((n) => ({ value: n, label: `${n}×` }))} />
        <div className="flex flex-wrap gap-2"><Button onClick={play}>Play</Button><Button variant="secondary" disabled={state !== 'Playing'} onClick={() => { window.speechSynthesis.pause(); setState('Paused') }}>Pause</Button><Button variant="secondary" onClick={stop}>Stop</Button></div>
        <p role="status">{state}</p>
        <p className="text-sm">Uses device voices only. Closing this panel or leaving the page stops reading.</p>
      </div>
    </Modal>
  </>
}

function GuidedHelp() {
  const { t } = useTranslation()
  const { model } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const { prefs } = useViewPrefs()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [tour, setTour] = useState(null)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [missing, setMissing] = useState(false)
  const panel = useRef(null)
  const trigger = useRef(null)
  useEffect(() => {
    if (!tour) return
    const root = document.getElementById('root')
    root.inert = true
    return () => { root.inert = false }
  }, [tour])
  const step = tour?.steps[index]
  const end = () => { setTour(null); setRect(null); requestAnimationFrame(() => trigger.current?.focus()) }
  useEffect(() => {
    if (!step) return
    const expected = step.to
    if (location.pathname + location.search !== expected) { setRect(null); navigate(expected); return }
    let target
    const update = () => {
      target = document.querySelector(`[data-tour="${step.target}"]`)
      if (target?.getClientRects().length) {
        const box = target.getBoundingClientRect()
        setRect({ left: Math.max(4, box.left - 4), top: Math.max(4, box.top - 4), width: Math.min(box.width + 8, innerWidth - 8), height: Math.min(box.height + 8, innerHeight - 8) }); setMissing(false)
      } else { setRect(null); setMissing(true) }
    }
    const timer = setTimeout(() => { target = document.querySelector(`[data-tour="${step.target}"]`); target?.scrollIntoView({ block: 'center', behavior: 'instant' }); update(); panel.current?.focus() }, 200)
    const observer = new MutationObserver(update)
    observer.observe(document.getElementById('app-content'), { childList: true, subtree: true })
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true)
    return () => { clearTimeout(timer); observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [step, location.pathname, location.search, navigate])
  const start = (topic) => {
    const delayed = model.shipments.find((s) => s.status === 'delayed')
    const steps = topic.steps.map((s) => s.to === 'delay-assist' ? { ...s, to: delayed ? `/app/shipments/${delayed.id}/resolve` : '/app/shipments' } : s)
    setOpen(false); setIndex(0); setTour({ ...topic, steps })
  }
  return <>
    <button ref={trigger} type="button" data-tour="help-button" onClick={() => setOpen(true)} aria-label={t('top.help')} title={t('top.help')} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-white/5 hover:text-white"><Icon name="info" className="h-5 w-5" /><span className="hidden xl:inline">{t('top.help')}</span></button>
    <Modal open={open} onClose={() => setOpen(false)} title="Help and guided tours">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const found = matchHelp(query, HELP_TOPICS); setResult(found); if (found.kind === 'confident') start(found.matches[0].topic) }}>
        <TextInput label="What would you like to do?" value={query} onChange={setQuery} maxLength={600} />
        <Button type="submit">Find a guide</Button>
        <p className="text-sm">Private, offline text matching. No AI service or company data is used.</p>
      </form>
      <p role="status" className="my-3">{result?.kind === 'none' ? 'No matching guide found. Browse the topics below.' : result?.kind === 'ambiguous' ? 'A few guides might help. Choose the closest match.' : 'Browse guides'}</p>
      <div className="flex flex-col gap-2">{(result?.matches.length ? result.matches.map((m) => m.topic) : HELP_TOPICS).map((topic) => <Button key={topic.id} variant="secondary" className="h-auto min-h-10 justify-start py-2 text-start" onClick={() => start(topic)}>{topic.title}</Button>)}</div>
    </Modal>
    {tour && createPortal(<div className="wm-app wm-tour-layer">
      <div className="wm-tour-shade" aria-hidden="true" />
      {rect && <div className="wm-tour-spotlight" aria-hidden="true" style={rect} />}
      <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" className="wm-tour-panel rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-2xl" onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); end() }
        if (e.key === 'Tab') { const buttons = [...panel.current.querySelectorAll('button:not(:disabled)')]; const first = buttons[0], last = buttons.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus() } }
      }}>
        <h2 id="tour-title" className="font-bold">{tour.title}</h2>
        <div aria-live="polite" aria-atomic="true"><p>Step {index + 1} of {tour.steps.length}</p><p className="my-2">{step.text}</p>
          {(missing || (tour.feature && !prefs.features[tour.feature])) && <p className="my-2">This section is unavailable or hidden. Enable the feature in Settings → Features or the section in Settings → Accessibility & Display, or check your plan. You can continue or end this guide.</p>}</div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={!index} onClick={() => setIndex(index - 1)}>Back</Button><Button size="sm" onClick={() => index + 1 < tour.steps.length ? setIndex(index + 1) : end()}>{index + 1 < tour.steps.length ? 'Next' : 'Finish'}</Button><Button size="sm" variant="secondary" onClick={end}>End tour</Button></div>
      </section>
    </div>, document.body)}
  </>
}

/** The floating Read aloud button, shown when it is switched on in Settings → Accessibility & Display. */
export function ReadAloudFloating() {
  const { prefs } = useViewPrefs()
  if (!prefs.readAloudButton || !hasSpeech()) return null
  return <ReadAloud floating />
}

export { GuidedHelp }
export default GuidedHelp
