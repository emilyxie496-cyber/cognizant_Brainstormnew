// Settings → Features: every feature, grouped by its navigation category, with on/off and plan availability.
import { useState } from 'react'
import { PLANS, requiredPlan } from '../../../../shared/entitlements.js'
import { Card, Notice, SearchInput, Segmented, StatusPill } from '../../../components/app/kit.jsx'
import { Icon } from '../../../components/ui.jsx'
import { useTranslation } from '../../../i18n/index.js'
import { FEATURES, FEATURE_GROUPS, useViewPrefs } from '../../../state/viewPrefs.js'
import { useWorkspace } from '../../../state/WorkspaceContext.jsx'

export function Switch({ label, checked, onChange, disabled = false }) {
  return (
    <span className="relative inline-flex shrink-0">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
      <span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 ${checked ? 'bg-brand-700' : 'bg-slate-300'} ${disabled ? 'opacity-60' : ''}`}>
        <span className={`absolute top-0.5 start-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5 rtl:-translate-x-5' : ''}`} />
      </span>
    </span>
  )
}

/** What the plan allows inside a feature. The page itself is on every plan; some capabilities are gated server-side. */
function useAvailability() {
  const { can } = useWorkspace()
  const { t } = useTranslation()
  return (feature) => {
    const locked = (feature.entitlements ?? []).filter((e) => !can(e))
    if (!locked.length) return { tone: 'emerald', text: t('features.fullAccess') }
    const plan = locked.map(requiredPlan).sort((a, b) => (a === 'enterprise' ? 1 : 0) - (b === 'enterprise' ? 1 : 0))[0]
    return { tone: 'amber', text: t('features.needsPlan', { plan: PLANS[plan]?.name ?? plan }) }
  }
}

export default function FeaturesTab() {
  const { t } = useTranslation()
  const { prefs, setFeature } = useViewPrefs()
  const availability = useAvailability()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const q = query.trim().toLowerCase()
  const matches = (f) => !q || `${t(`feature.${f.id}`)} ${f.label} ${t(`featureBlurb.${f.id}`)}`.toLowerCase().includes(q)
  const groups = FEATURE_GROUPS.filter((g) => g.id !== 'main' && (category === 'all' || category === g.id))
  const onCount = FEATURES.filter((f) => prefs.features[f.id]).length

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label={t('features.category')} value={category} onChange={setCategory} options={[{ value: 'all', label: t('actions.all') }, ...FEATURE_GROUPS.filter((g) => g.id !== 'main').map((g) => ({ value: g.id, label: t(`nav.${g.id}`) }))]} />
          <span className="text-xs text-slate-500">{t('features.enabledCount', { on: onCount, total: FEATURES.length })}</span>
        </div>
        <SearchInput label={t('features.search')} value={query} onChange={setQuery} className="md:w-72" />
      </div>
      <Notice tone="info">{t('features.note')}</Notice>

      {category === 'all' && !q && (
        <Card padded={false} className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-300"><Icon name="home" className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-navy">{t('feature.home')} <span className="text-xs font-normal text-slate-500">· {t('nav.main')}</span></p>
              <p className="text-xs text-slate-500">{t('features.commandCenterNote')}</p>
            </div>
            <StatusPill tone="emerald">{t('features.always')}</StatusPill>
          </div>
        </Card>
      )}

      {groups.map((g) => {
        const items = FEATURES.filter((f) => f.group === g.id && matches(f))
        if (!items.length) return null
        const on = items.filter((f) => prefs.features[f.id]).length
        return (
          <section key={g.id} aria-labelledby={`features-${g.id}`} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 id={`features-${g.id}`} className="flex items-center gap-2 text-sm font-bold text-navy">
                <Icon name={g.icon} className="h-4 w-4 text-brand-800" />{t(`nav.${g.id}`)}
                <span className="text-xs font-normal text-slate-500">{t('capabilities.enabledOf', { on, total: items.length })}</span>
              </h3>
              <span className="flex gap-1">
                <button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-50" onClick={() => items.forEach((f) => setFeature(f.id, true))}>{t('features.allOnInCategory')}</button>
                <button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" onClick={() => items.forEach((f) => setFeature(f.id, false))}>{t('features.allOffInCategory')}</button>
              </span>
            </div>
            <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {items.map((f) => {
                const avail = availability(f)
                const enabled = prefs.features[f.id]
                return (
                  <li key={f.id} className={`flex min-w-0 items-start gap-3 rounded-xl border p-3 ${enabled ? 'border-brand-200' : 'border-slate-200'}`}>
                    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-brand-100 text-brand-300' : 'bg-slate-100 text-slate-500'}`}><Icon name={f.icon} className="h-[18px] w-[18px]" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-navy">{t(`feature.${f.id}`)}</p>
                      <p className="text-xs text-slate-500">{t(`featureBlurb.${f.id}`)}</p>
                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        <StatusPill tone={enabled ? 'brand' : 'slate'}>{enabled ? t('status.enabled') : t('status.disabled')}</StatusPill>
                        <StatusPill tone={avail.tone}>{avail.text}</StatusPill>
                      </p>
                    </div>
                    <Switch label={t(`feature.${f.id}`)} checked={enabled} onChange={(v) => setFeature(f.id, v)} />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {q && !FEATURES.some(matches) && <Notice>{t('list.noResults')}</Notice>}
    </div>
  )
}
