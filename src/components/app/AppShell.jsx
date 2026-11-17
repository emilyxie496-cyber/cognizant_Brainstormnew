// The signed-in application frame: top bar, navigation, company context and data-mode labels.
import { Suspense, useEffect, useRef } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PLANS, PLAN_ORDER } from '../../../shared/entitlements.js'
import { FEATURES, FEATURE_GROUPS, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Badge, Icon, Logo } from '../ui.jsx'
import { AnalystDock } from './AnalyzeButton.jsx'
import MonitorTrigger from './MonitorTrigger.jsx'
import AccessibilityTools from './Accessibility.jsx'
import { ErrorBoundary, Notice, Segmented, Skeleton, ToastProvider } from './kit.jsx'

/** The Command Center itself, then the enabled features. Settings has its own button in the top bar. */
function useNavItems() {
  const { prefs } = useViewPrefs()
  return [
    { to: '/app', end: true, label: 'Overview', icon: 'home' },
    ...FEATURES.filter((f) => prefs.features[f.id]),
  ]
}

/** Horizontal navigation shown on every page except a Command Center that already has its tiles. */
function NavStrip() {
  const items = useNavItems()
  const strip = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => {
    const el = strip.current
    const active = el?.querySelector('[aria-current="page"]')
    if (active) el.scrollTo({ left: active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2 })
  }, [pathname, items.length])
  return (
    <nav ref={strip} aria-label="Application" className="wm-strip flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-1.5 sm:px-5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-white/5 hover:text-white'}`
          }
        >
          <Icon name={item.icon} className="h-4 w-4" />
          {item.group && <span className="text-[0.625rem] uppercase opacity-60">{FEATURE_GROUPS.find(g => g.id === item.group)?.label}</span>}{item.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** Shown in place of a page whose feature has been switched off in settings. */
function FeatureOff({ feature }) {
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <Notice tone="info">
        <h1 tabIndex={-1} className="font-semibold">{feature.label} is turned off.</h1>
        <p className="mt-1">Your data is unchanged. Turn the feature back on to use this page.</p>
        <Link to="/app/settings?tab=display" className="mt-2 inline-block font-semibold underline">Open display settings</Link>
      </Notice>
    </div>
  )
}

export default function AppShell() {
  const { session, status, loadError, ws, model, plan, isDemo, isLocal, setDemoTier, endSession, reload } = useWorkspace()
  const { prefs, setTheme } = useViewPrefs()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    window.scrollTo({ top: 0 })
    const focus = () => {
      const heading = document.querySelector('main h1')
      if (heading) { heading.focus({ preventScroll: true }); return true }
      return false
    }
    if (focus()) return
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect() })
    observer.observe(document.getElementById('root'), { subtree: true, childList: true })
    return () => observer.disconnect()
  }, [location.pathname, status])

  if (!session) return <Navigate to="/demo" replace />

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Notice tone="error">
          <p className="font-semibold">Your workspace could not be loaded.</p>
          <p className="mt-1">{loadError}</p>
          <button type="button" onClick={reload} className="mt-2 font-semibold underline">Retry</button>
        </Notice>
      </div>
    )
  }

  if (status !== 'ready' || !ws?.company) {
    return (
      <div className="grid min-h-screen gap-3 bg-slate-100 p-6 sm:grid-cols-3">
        <Skeleton /><Skeleton /><Skeleton /><Skeleton className="h-96 sm:col-span-3" />
      </div>
    )
  }

  if (!ws.company.onboardingComplete) return <Navigate to="/onboarding" replace />

  const leave = async () => {
    await endSession()
    navigate('/')
  }

  const company = ws.company
  const alertCount = model?.alerts.length ?? 0
  const initials = company.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const onHome = location.pathname.replace(/\/$/, '') === '/app'
  // On the Command Center the feature tiles are the navigation, unless they are hidden.
  // Settings is its own screen: it shows only settings, with a link back, and no feature menu.
  const onSettings = location.pathname.startsWith('/app/settings')
  const showStrip = !onSettings && (!onHome || !prefs.sections.featureTiles)
  const offFeature = FEATURES.find((f) => !prefs.features[f.id] && location.pathname.startsWith(f.to))
  const place = [company.hq?.city, company.hq?.province].filter(Boolean).join(', ')

  return (
    <ToastProvider>
      <MonitorTrigger />
      <div className="wm-app">
        <a href="#app-content" className="wm-skip-link">Skip to content</a>
        <header className="wm-topbar sticky top-0 z-20 border-b border-slate-200 pt-[env(safe-area-inset-top)] print:hidden">
          <div className="mx-auto flex min-h-14 max-w-[100rem] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:px-6">
            <Link to="/app" aria-label="Waymark Command Center" className="flex shrink-0 items-center gap-3">
              <Logo tone={prefs.theme === "light" ? "dark" : "light"} />
              <span className="hidden border-l border-slate-300 pl-3 text-xs font-semibold tracking-[0.2em] text-slate-600 uppercase md:inline">Command Center</span>
            </Link>
            <div className="hidden min-w-0 flex-1 pl-2 sm:block">
              <p className="truncate text-sm font-bold text-navy">{company.name}</p>
              <p className="truncate text-xs text-slate-500">{place || 'Company workspace'}</p>
            </div>
            <span className="flex-1 sm:hidden" />
            {isDemo && (
              <>
                <Badge tone="amber">Demo Data: fictional company</Badge>
                <Segmented label="Demo tier" value={plan} onChange={setDemoTier} options={PLAN_ORDER.map((p) => ({ value: p, label: PLANS[p].name }))} />
              </>
            )}
            {isLocal && <Badge tone="sky">Local workspace: this browser only</Badge>}
            {company.sampleData && <Badge tone="amber">Sample data: fictional company</Badge>}
            {!isDemo && <Badge tone="emerald">{PLANS[plan].name} plan</Badge>}
            <button type="button" onClick={() => setTheme(prefs.theme === "light" ? "dark" : "light")} aria-label={prefs.theme === "light" ? "Switch to dark theme" : "Switch to light theme"} title={prefs.theme === "light" ? "Dark theme" : "Light theme"} className="rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-white">
              <Icon name={prefs.theme === "light" ? "moon" : "sun"} className="h-5 w-5" />
            </button>
            <AccessibilityTools />
            <div className="flex max-w-full flex-wrap items-center gap-1">
              <Link to="/app#alerts" aria-label={`${alertCount} risk alerts`} className="relative rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-white">
                <Icon name="bell" className="h-5 w-5" />
                {alertCount > 0 && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[0.625rem] font-bold text-white">{alertCount}</span>}
              </Link>
              <Link to="/app/settings" aria-label="Settings" title="Settings" className="rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-white">
                <Icon name="settings" className="h-5 w-5" />
              </Link>
              <button type="button" onClick={leave} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-white/5 hover:text-white">
                <Icon name="logout" className="h-[18px] w-[18px]" /> {isDemo ? 'Exit demo' : 'Sign out'}
              </button>
              <span aria-hidden="true" title={company.name} className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">{initials}</span>
            </div>
          </div>
          {showStrip && <div className="mx-auto max-w-[100rem]"><NavStrip /></div>}
        </header>

        <main id="app-content" data-tour="page-content" tabIndex={-1} className="mx-auto max-w-[100rem] px-4 py-5 sm:px-6 print:p-0">
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Skeleton className="h-96" />}>
              {offFeature ? <FeatureOff feature={offFeature} /> : <Outlet />}
            </Suspense>
          </ErrorBoundary>
        </main>
        <AnalystDock />
      </div>
    </ToastProvider>
  )
}
