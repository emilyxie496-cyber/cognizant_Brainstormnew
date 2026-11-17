/*
  View preferences: which features and Command Center sections are shown, and
  which vehicle the hero scene uses. These are per-browser display choices, so
  they live in localStorage and never touch company records or plan limits.
*/
import { useSyncExternalStore } from 'react'

const KEY = 'waymark.viewPrefs.v1'

/**
 * Feature modules. Each one is a page, a navigation entry and a Command Center tile.
 * `group` is its navigation category. `entitlements` lists plan-gated capabilities inside the page:
 * the page itself is available on every plan, and the server enforces the gated parts.
 */
export const FEATURES = [
  { id: 'agent', group: 'intelligence', to: '/app/agent', label: 'AI Agent Hub', icon: 'sparkles', blurb: 'Ask Waymark to investigate a problem. It runs the tools and shows its work.' },
  { id: 'analyst', group: 'intelligence', to: '/app/analyst', label: 'AI Trade Analyst', icon: 'scale', blurb: 'Pick shipments, suppliers or headlines and ask how they affect you.' },
  { id: 'world', group: 'intelligence', to: '/app/world', label: 'Global Risk Intelligence', icon: 'newspaper', blurb: 'Disruption news and weather signals, matched to your records.' },
  { id: 'activity', group: 'intelligence', to: '/app/activity', label: 'Agent Activity', icon: 'compass', blurb: 'Automated monitoring, detected risks and investigation history.' },
  { id: 'approvals', group: 'intelligence', to: '/app/approvals', label: 'Approvals', icon: 'shield', blurb: 'Approve or reject anything Waymark proposes to send.' },
  { id: 'map', group: 'solutions', to: '/app/map', label: 'Supply Chain Map', icon: 'map', blurb: 'Suppliers, ports, warehouses and routes on one map.', entitlements: ['map.advanced'] },
  { id: 'shipments', group: 'solutions', to: '/app/shipments', label: 'Shipments', icon: 'ship', blurb: 'Track, add and edit shipment records and events.', entitlements: ['tracking.live'] },
  { id: 'simulator', group: 'solutions', to: '/app/simulator', label: 'Risk Simulator', icon: 'activity', blurb: 'Test disruptions and compare responses by cost and timing.', entitlements: ['scenario.advanced', 'scenario.compare'] },
  { id: 'canadian', group: 'solutions', to: '/app/canadian', label: 'Canadian Alternatives', icon: 'flag', blurb: 'Compare domestic suppliers for the same product.', entitlements: ['alternatives.canadian.full', 'alternatives.saved'] },
  { id: 'global', group: 'solutions', to: '/app/global', label: 'Global Alternatives', icon: 'globe', blurb: 'Compare sourcing countries side by side.', entitlements: ['alternatives.global.full', 'alternatives.saved'] },
  { id: 'sustainability', group: 'solutions', to: '/app/sustainability', label: 'Sustainability', icon: 'leaf', blurb: 'Transport emissions and responsible-sourcing records.', entitlements: ['carbon.climatiq', 'sustainability.advanced', 'social.detailed'] },
  { id: 'reports', group: 'solutions', to: '/app/reports', label: 'Reports', icon: 'file', blurb: 'Build reports and export them as PDF or CSV.', entitlements: ['reports.advanced', 'reports.custom'] },
  { id: 'integrations', group: 'business', to: '/app/integrations', label: 'Integrations', icon: 'layers', blurb: 'Connect accounting, commerce, CRM, logistics and chat providers.' },
  { id: 'inventory', group: 'business', to: '/app/inventory', label: 'Inventory & Orders', icon: 'box', blurb: 'Stock, open orders and customers that depend on late supply.' },
  { id: 'finance', group: 'business', to: '/app/finance', label: 'Financial Intelligence', icon: 'card', blurb: 'Supplier spend from your books, beside your sourcing records.' },
]

/** The Command Center. It is always on and is the only page in the Main category. */
export const HOME = { id: 'home', group: 'main', to: '/app', end: true, label: 'Command Center', icon: 'home' }

/** Navigation categories, in display order. */
export const FEATURE_GROUPS = [
  { id: 'main', label: 'Main', icon: 'home' },
  { id: 'intelligence', label: 'Intelligence', icon: 'sparkles' },
  { id: 'solutions', label: 'Solutions', icon: 'layers' },
  { id: 'business', label: 'Business', icon: 'card' },
]

/** The feature whose page is at `pathname`, or the Command Center. Deep links pick their category from this. */
export function featureForPath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/'
  return FEATURES.find((f) => path === f.to || path.startsWith(`${f.to}/`)) ?? (path === '/app' ? HOME : null)
}

/** Blocks on the Command Center itself. */
export const SECTIONS = [
  { id: 'hero', label: 'Hero scene', blurb: 'The animated 3D scene and shipment status card.' },
  { id: 'shipmentStats', label: 'Network overview', blurb: 'Supplier, shipment, delay and alert counts.' },
  { id: 'financeStats', label: 'Spend and footprint', blurb: 'Import spend, freight spend, emissions and sourcing share.' },
  { id: 'alerts', label: 'Risk feed', blurb: 'Rule-based prompts for review, with a Resolve action on delays.' },
  { id: 'activity', label: 'Activity feed', blurb: 'Needs the Shipments feature.' },
  { id: 'featureTiles', label: 'Enabled capabilities', blurb: 'Features turned on, by category, with links. Integration and AI status shown separately.' },
]

export const VEHICLES = [
  { id: 'ship', label: 'Ship', icon: 'ship', mode: 'sea' },
  { id: 'plane', label: 'Airplane', icon: 'plane', mode: 'air' },
  { id: 'train', label: 'Train', icon: 'train', mode: 'rail' },
  { id: 'truck', label: 'Truck', icon: 'truck', mode: 'road' },
]

const allOn = (list) => Object.fromEntries(list.map((x) => [x.id, true]))

export const TEXT_SIZES = [100, 115, 130, 150]
export const LANGUAGE_CODES = ['en', 'hi', 'ar', 'zh-CN', 'es', 'fr']
export const DEFAULT_PREFS = { features: allOn(FEATURES), sections: allOn(SECTIONS), vehicle: 'ship', textSize: 100, speechRate: 1, theme: 'dark', language: 'en', reduceMotion: false, readAloudButton: false }

function merge(stored) {
  return {
    textSize: TEXT_SIZES.includes(stored?.textSize) ? stored.textSize : 100,
    theme: stored?.theme === 'light' ? 'light' : 'dark',
    language: LANGUAGE_CODES.includes(stored?.language) ? stored.language : 'en',
    reduceMotion: stored?.reduceMotion === true,
    readAloudButton: stored?.readAloudButton === true,
    speechRate: [0.75, 1, 1.25, 1.5].includes(stored?.speechRate) ? stored.speechRate : 1,
    features: { ...DEFAULT_PREFS.features, ...stored?.features },
    sections: { ...DEFAULT_PREFS.sections, ...stored?.sections },
    vehicle: VEHICLES.some((v) => v.id === stored?.vehicle) ? stored.vehicle : DEFAULT_PREFS.vehicle,
  }
}

function read() {
  try {
    return merge(JSON.parse(localStorage.getItem(KEY)))
  } catch {
    return DEFAULT_PREFS
  }
}

let current = typeof localStorage === 'undefined' ? DEFAULT_PREFS : read()
const listeners = new Set()
// The i18n module registers here, so a language change reaches it without a circular import.
const languageListeners = new Set()
export function onLanguagePref(fn) {
  languageListeners.add(fn)
  fn(current.language)
  return () => languageListeners.delete(fn)
}
function applySize() {
  if (typeof document === 'undefined') return
  document.documentElement.style.fontSize = `${current.textSize}%`
  // The workspace theme. Only .wm-app screens read it, so the marketing site is unaffected.
  document.documentElement.dataset.wmTheme = current.theme
  document.documentElement.dataset.wmReduceMotion = current.reduceMotion ? 'true' : 'false'
  languageListeners.forEach((fn) => fn(current.language))
}
applySize()

function write(next) {
  current = next
  applySize()
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage can be blocked or full. The choice still applies for this visit.
  }
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  const onStorage = (e) => {
    if (e.key !== KEY) return
    current = read()
    applySize()
    fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function useViewPrefs() {
  const prefs = useSyncExternalStore(subscribe, () => current, () => DEFAULT_PREFS)
  return {
    prefs,
    setTextSize: (textSize) => write({ ...current, textSize: TEXT_SIZES.includes(textSize) ? textSize : 100 }),
    setSpeechRate: (speechRate) => write({ ...current, speechRate }),
    setFeature: (id, on) => write({ ...current, features: { ...current.features, [id]: on } }),
    setSection: (id, on) => write({ ...current, sections: { ...current.sections, [id]: on } }),
    setVehicle: (vehicle) => write({ ...current, vehicle }),
    setTheme: (theme) => write({ ...current, theme: theme === 'light' ? 'light' : 'dark' }),
    setLanguage: (language) => write({ ...current, language: LANGUAGE_CODES.includes(language) ? language : 'en' }),
    setReduceMotion: (reduceMotion) => write({ ...current, reduceMotion: Boolean(reduceMotion) }),
    setReadAloudButton: (readAloudButton) => write({ ...current, readAloudButton: Boolean(readAloudButton) }),
    reset: () => write(DEFAULT_PREFS),
  }
}
