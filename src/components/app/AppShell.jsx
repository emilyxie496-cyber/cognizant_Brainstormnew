// The signed-in application frame: top bar, two-level navigation, company context and data-mode labels.
import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PLANS, PLAN_ORDER } from '../../../shared/entitlements.js'
import { languageOf, useTranslation } from '../../i18n/index.js'
import { useBranding } from '../../state/branding.js'
import { FEATURES, FEATURE_GROUPS, HOME, featureForPath, useViewPrefs } from '../../state/viewPrefs.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { Badge, Icon, Logo } from '../ui.jsx'
import { AnalystDock } from './AnalyzeButton.jsx'
import MonitorTrigger from './MonitorTrigger.jsx'
import { GuidedHelp, ReadAloudFloating } from './Accessibility.jsx'
import { ErrorBoundary, Notice, Segmented, Skeleton, ToastProvider } from './kit.jsx'

const LAST_KEY = 'waymark.nav.last.v1'

/** The pages in each category that are switched on. The Command Center is always on. */
export function useNavGroups() {
  const { prefs } = useViewPrefs()
  return FEATURE_GROUPS.map((g) => ({ ...g, items: g.id === 'main' ? [HOME] : FEATURES.filter((f) => f.group === g.id && prefs.features[f.id]) }))
}

/** Remembers the last page opened in each category, so a category button returns there. */
function rememberLast(item) {
  if (!item) return
  try {
    const saved = JSON.parse(sessionStorage.getItem(LAST_KEY) ?? '{}')
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ ...saved, [item.group]: item.to }))
  } catch {
    // Session storage can be unavailable; the category then opens its first page.
  }
}
function lastIn(group) {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_KEY) ?? '{}')[group]
  } catch {
    return null
  }
}

/** Where a category button goes: the last page used in it, or its first enabled page. */
function targetOf(group) {
  const last = lastIn(group.id)
  return group.items.find((i) => i.to === last)?.to ?? group.items[0]?.to ?? null
}

/** Primary category bar. The active category follows the URL, so deep links, refresh and history all agree. */
function CategoryNav({ groups, activeGroup }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('nav.categories')} className="hidden min-w-0 md:block">
      <ul className="flex items-center gap-0.5">
        {groups.map((g) => {
          const to = targetOf(g)
          const active = g.id === activeGroup
          const label = t(`nav.${g.id}`)
          if (!to) {
            return (
              <li key={g.id}>
                <Link to="/app/settings?tab=features" title={t('nav.noFeatures')} className="wm-cat inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap text-slate-500 opacity-70 hover:text-navy">
                  <Icon name={g.icon} className="h-4 w-4" /><span>{label}</span>
                </Link>
              </li>
            )
          }
          return (
            <li key={g.id}>
              <Link
                to={to}
                aria-current={active ? 'true' : undefined}
                className={`wm-cat inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${active ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-white/5 hover:text-white'}`}
              >
                <Icon name={g.icon} className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Secondary bar: the enabled pages of the active category. Always the same height, so content never jumps. */
function FeatureNav({ group }) {
  const { t } = useTranslation()
  const strip = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => {
    const el = strip.current
    const active = el?.querySelector('[aria-current="page"]')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname, group?.id])
  if (!group) return <div className="wm-subnav hidden h-11 border-t border-slate-200 md:block" aria-hidden="true" />
  return (
    <nav aria-label={t('nav.features', { category: t(`nav.${group.id}`) })} className="wm-subnav hidden h-11 border-t border-slate-200 md:block">
      <ul ref={strip} className="wm-strip mx-auto flex h-full max-w-[100rem] items-center gap-1 overflow-x-auto px-4 sm:px-6">
        {group.items.map((item) => (
          <li key={item.id} className="shrink-0">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-white/10 text-white shadow-[inset_0_-2px_0_var(--color-brand-500)]' : 'text-slate-600 hover:bg-white/5 hover:text-white'}`}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" />
              {t(`feature.${item.id}`)}
            </NavLink>
          </li>
        ))}
        {!group.items.length && <li className="text-xs text-slate-500">{t('nav.noFeatures')}</li>}
      </ul>
    </nav>
  )
}

/** Phones and small tablets: every category and its pages in a drawer. */
function MobileNav({ open, onClose, groups, activeGroup }) {
  const { t } = useTranslation()
  const ref = useRef(null)
  const { pathname } = useLocation()
  useEffect(() => {
    const el = ref.current
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  useEffect(() => { onClose() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <dialog ref={ref} onClose={onClose} aria-label={t('nav.menu')} className="wm-drawer wm-drawer-start bg-white p-0 text-slate-700 shadow-2xl" style={{ '--wm-drawer-w': '20rem' }}>
      {open && (
        <div className="flex h-full max-h-[100dvh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <Logo tone="light" />
            <button type="button" onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Icon name="close" className="h-5 w-5" /></button>
          </div>
          <nav aria-label={t('nav.application')} className="wm-scroll flex-1 overflow-y-auto px-3 py-3">
            {groups.map((g) => (
              <div key={g.id} className="mb-3">
                <p className={`flex items-center gap-1.5 px-2 pb-1 text-[0.6875rem] font-semibold tracking-wider uppercase ${g.id === activeGroup ? 'text-brand-800' : 'text-slate-500'}`}>
                  <Icon name={g.icon} className="h-3.5 w-3.5" />{t(`nav.${g.id}`)}
                </p>
                <ul>
                  {g.items.map((item) => (
                    <li key={item.id}>
                      <NavLink to={item.to} end={item.end} className={({ isActive }) => `flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium ${isActive ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
                        <Icon name={item.icon} className="h-4 w-4 shrink-0" />{t(`feature.${item.id}`)}
                      </NavLink>
                    </li>
                  ))}
                  {!g.items.length && <li className="px-2.5 py-1 text-xs text-slate-500">{t('nav.noFeatures')}</li>}
                </ul>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-3">
              <NavLink to="/app/settings" className={({ isActive }) => `flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium ${isActive ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
                <Icon name="settings" className="h-4 w-4" />{t('nav.settings')}
              </NavLink>
            </div>
          </nav>
        </div>
      )}
    </dialog>
  )
}

/** Shown in place of a page whose feature has been switched off in settings. */
function FeatureOff({ feature }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <Notice tone="info">
        <h1 tabIndex={-1} className="font-semibold">{t('featureOff.title', { name: t(`feature.${feature.id}`) })}</h1>
        <p className="mt-1">{t('featureOff.body')}</p>
        <Link to="/app/settings?tab=features" className="mt-2 inline-block font-semibold underline">{t('featureOff.link')}</Link>
      </Notice>
    </div>
  )
}

/** The interface language sets the document language and direction while the workspace is open. */
function useDocumentLanguage() {
  const { i18n } = useTranslation()
  const lang = languageOf(i18n.language)
  useEffect(() => {
    const html = document.documentElement
    html.lang = lang.code
    html.dir = lang.dir
    return () => {
      html.lang = 'en'
      html.dir = 'ltr'
    }
  }, [lang.code, lang.dir])
}

export default function AppShell() {
  const { session, status, loadError, ws, model, plan, isDemo, isLocal, setDemoTier, endSession, reload } = useWorkspace()
  const { prefs, setTheme } = useViewPrefs()
  const { t } = useTranslation()
  const branding = useBranding()
  const location = useLocation()
  const navigate = useNavigate()
  const groups = useNavGroups()
  const [menuOpen, setMenuOpen] = useState(false)
  useDocumentLanguage()

  const current = featureForPath(location.pathname)
  useEffect(() => { rememberLast(current) }, [current])

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
          <button type="button" onClick={reload} className="mt-2 font-semibold underline">{t('actions.retry')}</button>
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
  const displayName = branding.data?.displayName || company.name
  const alertCount = model?.alerts.length ?? 0
  const initials = displayName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const onSettings = location.pathname.startsWith('/app/settings')
  const activeGroup = onSettings ? null : current?.group ?? 'main'
  const offFeature = FEATURES.find((f) => !prefs.features[f.id] && (location.pathname === f.to || location.pathname.startsWith(`${f.to}/`)))
  const place = [company.hq?.city, company.hq?.province].filter(Boolean).join(', ')
  const iconButton = 'inline-flex h-9 w-8 sm:w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-white/5 hover:text-white'

  return (
    <ToastProvider>
      <MonitorTrigger />
      <div className="wm-app">
        <a href="#app-content" className="wm-skip-link">{t('top.skip')}</a>
        <header className="wm-topbar sticky top-0 z-20 border-b border-slate-200 pt-[env(safe-area-inset-top)] print:hidden">
          <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-1.5 px-2 sm:gap-3 sm:px-6">
            <button type="button" onClick={() => setMenuOpen(true)} aria-label={t('nav.openMenu')} aria-expanded={menuOpen} className={`${iconButton} md:hidden`}>
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <Link to="/app" aria-label={t('top.commandCenter')} className="flex shrink-0 items-center">
              <Logo tone={prefs.theme === 'light' ? 'dark' : 'light'} />
            </Link>
            <div className="hidden min-w-0 items-center gap-2 border-s border-slate-300 ps-3 xl:flex" title={place || t('top.workspace')}>
              {branding.data?.logo && <img src={branding.data.logo} alt="" className="h-7 max-w-16 rounded object-contain" />}
              <p className="max-w-[11rem] truncate text-sm font-bold text-navy">{displayName}</p>
            </div>
            <div className="min-w-0 flex-1 md:flex md:justify-center lg:justify-start lg:ps-2">
              <CategoryNav groups={groups} activeGroup={activeGroup} />
            </div>
            <div className="flex shrink-0 items-center gap-0 sm:gap-1">
              {isDemo && <span className="hidden lg:inline-flex"><Badge tone="amber">{t('top.demoData')}</Badge></span>}
              {isDemo && <span className="hidden 2xl:inline-flex"><Segmented label={t('top.demoTier')} value={plan} onChange={setDemoTier} options={PLAN_ORDER.map((p) => ({ value: p, label: PLANS[p].name }))} /></span>}
              {isLocal && <span className="hidden lg:inline-flex"><Badge tone="sky">{t('top.localWorkspace')}</Badge></span>}
              {company.sampleData && <span className="hidden lg:inline-flex"><Badge tone="amber">{t('top.sampleData')}</Badge></span>}
              {!isDemo && <span className="hidden xl:inline-flex"><Badge tone="emerald">{t('top.plan', { name: PLANS[plan].name })}</Badge></span>}
              <GuidedHelp />
              <button type="button" onClick={() => setTheme(prefs.theme === 'light' ? 'dark' : 'light')} aria-label={prefs.theme === 'light' ? t('top.darkTheme') : t('top.lightTheme')} title={prefs.theme === 'light' ? t('top.darkTheme') : t('top.lightTheme')} className={`${iconButton} hidden sm:inline-flex`}>
                <Icon name={prefs.theme === 'light' ? 'moon' : 'sun'} className="h-5 w-5" />
              </button>
              <Link to="/app#alerts" aria-label={t('top.alerts', { count: alertCount })} title={t('top.alerts', { count: alertCount })} className={`${iconButton} relative`}>
                <Icon name="bell" className="h-5 w-5" />
                {alertCount > 0 && <span aria-hidden="true" className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[0.625rem] font-bold text-white">{alertCount}</span>}
              </Link>
              <Link to="/app/settings" aria-label={t('top.settings')} title={t('top.settings')} aria-current={onSettings ? 'page' : undefined} className={`${iconButton} ${onSettings ? 'bg-brand-700 text-white' : ''}`}>
                <Icon name="settings" className="h-5 w-5" />
              </Link>
              <button type="button" onClick={leave} title={isDemo ? t('top.exitDemo') : t('top.signOut')} className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm font-medium text-slate-600 hover:bg-white/5 hover:text-white lg:px-2">
                <Icon name="logout" className="h-[18px] w-[18px] rtl:rotate-180" /><span className="hidden lg:inline">{isDemo ? t('top.exitDemo') : t('top.signOut')}</span>
                <span className="sr-only lg:hidden">{isDemo ? t('top.exitDemo') : t('top.signOut')}</span>
              </button>
              <span aria-hidden="true" title={displayName} className="ms-1 hidden h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand-700 text-xs font-bold text-white sm:flex">
                {branding.data?.logo ? <img src={branding.data.logo} alt="" className="h-full w-full bg-white object-contain p-0.5" /> : initials}
              </span>
            </div>
          </div>
          <FeatureNav group={groups.find((g) => g.id === activeGroup)} />
        </header>
        <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} groups={groups} activeGroup={activeGroup} />

        <main id="app-content" data-tour="page-content" tabIndex={-1} className="mx-auto max-w-[100rem] px-4 py-5 sm:px-6 print:p-0">
          {isDemo && <p className="mb-3 lg:hidden"><Badge tone="amber">{t('top.demoData')}</Badge></p>}
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<Skeleton className="h-96" />}>
              {offFeature ? <FeatureOff feature={offFeature} /> : <Outlet />}
            </Suspense>
          </ErrorBoundary>
        </main>
        <AnalystDock />
        <ReadAloudFloating />
      </div>
    </ToastProvider>
  )
}
