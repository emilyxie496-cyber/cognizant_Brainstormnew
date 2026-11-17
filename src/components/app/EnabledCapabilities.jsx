// Command Center: which features are on, by category, with links. Integration status is shown separately.
import { Link } from 'react-router-dom'
import { useTranslation } from '../../i18n/index.js'
import { platform } from '../../services/api.js'
import { FEATURES, FEATURE_GROUPS, useViewPrefs } from '../../state/viewPrefs.js'
import { Icon } from '../ui.jsx'
import { AiStatusBadge } from './AiLauncher.jsx'
import { StatusPill } from './kit.jsx'
import { usePlatform } from './PlatformKit.jsx'

export default function EnabledCapabilities() {
  const { t } = useTranslation()
  const { prefs } = useViewPrefs()
  const summary = usePlatform(() => platform.summary())
  const integ = summary.data?.integrations
  return (
    <section aria-labelledby="capabilities-title" data-tour="enabled-capabilities" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="capabilities-title" className="text-[0.9375rem] font-bold text-navy">{t('capabilities.title')}</h2>
          <p className="text-xs text-slate-500">{t('capabilities.subtitle')}</p>
        </div>
        <Link to="/app/settings?tab=features" className="text-sm font-semibold text-brand-800 hover:underline">{t('capabilities.manage')}</Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {FEATURE_GROUPS.filter((g) => g.id !== 'main').map((g) => {
          const all = FEATURES.filter((f) => f.group === g.id)
          const on = all.filter((f) => prefs.features[f.id])
          return (
            <div key={g.id} className="min-w-0 rounded-xl border border-slate-200 p-3">
              <p className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <span className="flex items-center gap-1.5"><Icon name={g.icon} className="h-3.5 w-3.5" />{t(`nav.${g.id}`)}</span>
                <span className="normal-case">{t('capabilities.enabledOf', { on: on.length, total: all.length })}</span>
              </p>
              {on.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {on.map((f) => (
                    <li key={f.id}>
                      <Link to={f.to} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100">
                        <Icon name={f.icon} className="h-3.5 w-3.5" />{t(`feature.${f.id}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-slate-500">{t('capabilities.none')}</p>}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-navy">{t('capabilities.integrations')}:</span>
          {integ ? (integ.connected
            ? <><StatusPill tone="emerald">{integ.connected} connected</StatusPill>{integ.names.slice(0, 4).map((n) => <span key={n} className="text-slate-600">{n}</span>)}</>
            : <span className="text-slate-500">{t('capabilities.integrationsNone')}</span>)
            : <span className="text-slate-500">{summary.error ? t('status.unavailable') : t('actions.loading')}</span>}
          {integ?.demo > 0 && <StatusPill tone="amber">{integ.demo} demo</StatusPill>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-navy">{t('capabilities.ai')}:</span><AiStatusBadge compact /></span>
      </div>
    </section>
  )
}
