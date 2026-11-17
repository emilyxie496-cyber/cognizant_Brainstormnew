/*
  World Situation: current trade, shipping and disruption headlines, each
  matched against the company's own suppliers and shipments.

  Headlines are real and link to their publisher. Waymark shows the headline,
  publisher and date only: it does not download, summarise or reword articles,
  and it never invents one. When the sources cannot be reached, the page says so.
*/
import { useCallback, useEffect, useMemo, useState } from 'react'
import { countryName } from '../../../shared/countries.js'
import WeatherIntelligence from '../../components/app/WeatherIntelligence.jsx'
import { Investigate } from '../../components/app/PlatformKit.jsx'
import AnalyzeButton from '../../components/app/AnalyzeButton.jsx'
import { Card, DemoTag, Empty, Notice, PageHeader, SelectInput, Skeleton, TextInput } from '../../components/app/kit.jsx'
import { Badge, Button, Icon } from '../../components/ui.jsx'
import { EXPOSURE_LABELS, articleExposure } from '../../engine/exposure.js'
import { modeLabel } from '../../engine/model.js'
import { api } from '../../services/api.js'
import { useWorkspace } from '../../state/WorkspaceContext.jsx'
import { fetchTradeNews } from '../../utils/newsApi.js'
import { CATEGORY_NEWS_TERMS, cleanTitle, parseSeenDate } from '../../utils/tradeNews.js'

// Kept in step with NEWS_CATEGORIES on the server, which owns the search terms.
const CATEGORIES = [
  { value: 'trade', label: 'Trade and tariffs' },
  { value: 'shipping', label: 'Shipping and ports' },
  { value: 'air', label: 'Air freight' },
  { value: 'land', label: 'Rail and trucking' },
  { value: 'supply', label: 'Suppliers and manufacturing' },
  { value: 'policy', label: 'Sanctions and regulation' },
  { value: 'disruption', label: 'Strikes, conflict and disasters' },
  { value: 'economy', label: 'Economy and energy' },
]
const INDUSTRIES = [
  { value: 'home', label: 'Home goods' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'apparel', label: 'Apparel and textiles' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'food', label: 'Food and agriculture' },
  { value: 'beauty', label: 'Health and beauty' },
  { value: 'furniture', label: 'Furniture' },
]
const AGES = [{ value: '1', label: 'Last 24 hours' }, { value: '3', label: 'Last 3 days' }, { value: '7', label: 'Last 7 days' }]
const RELEVANCE = Object.entries(EXPOSURE_LABELS).map(([value, x]) => ({ value, label: x.label }))
const SORTS = [{ value: 'relevance', label: 'Relevant to me first' }, { value: 'newest', label: 'Newest first' }]
const PAGE = 12
const TTL = 15 * 60_000

const cache = new Map()

/**
 * Headlines for a category. The API aggregates and caches them. If it cannot
 * be reached, the general trade feed is read directly as a fallback.
 */
async function loadNews(category, force) {
  const hit = cache.get(category)
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value
  let value
  try {
    const res = await api.news(category)
    value = { articles: res.articles, source: res.source, fetchedAt: res.fetchedAt, fallback: false }
  } catch (apiError) {
    if (category !== 'trade') throw new Error(`The news service is unavailable (${apiError.message}).`)
    const res = await fetchTradeNews('', { force })
    value = {
      fallback: true,
      source: res.source === 'gdelt' ? 'GDELT' : 'Google News',
      fetchedAt: new Date(res.fetchedAt).toISOString(),
      articles: res.articles
        .filter((a) => a?.url && a?.title)
        .map((a) => ({ url: a.url, title: cleanTitle(a.title), publisher: a.domain ?? '', publishedAt: a.published ?? parseSeenDate(a.seendate)?.toISOString() ?? null, category })),
    }
  }
  cache.set(category, { at: Date.now(), value })
  return value
}

const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not given')

function ArticleCard({ article, featured = false }) {
  const x = article.exposure
  const label = EXPOSURE_LABELS[x.level]
  const matches = [...x.shipments.map((s) => `${s.reference}: ${s.why}`), ...x.suppliers.map((s) => `${s.name}: ${s.why}`)]
  const extra = { title: article.title, url: article.url, publisher: article.publisher, publishedAt: article.publishedAt }
  return (
    <article className={`wm-tile flex min-w-0 flex-col rounded-2xl border bg-white p-4 shadow-sm ${featured ? 'border-brand-200' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={label.tone}>{label.label}</Badge>
        {x.signals.topics.slice(0, 2).map((t) => <Badge key={t.id} tone="slate">{t.label}</Badge>)}
      </div>
      <h3 className={`mt-2 font-bold break-words text-navy ${featured ? 'text-base' : 'text-[0.9375rem]'}`}>
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{article.title}</a>
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {article.publisher || 'Publisher not given'} · {when(article.publishedAt)}
        {x.signals.countries.length > 0 && <> · {x.signals.countries.slice(0, 3).map(countryName).join(', ')}</>}
        {x.signals.modes.length > 0 && <> · {x.signals.modes.map(modeLabel).join(', ')}</>}
      </p>
      {matches.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
          {matches.slice(0, 3).map((m) => <li key={m} className="flex gap-1.5"><Icon name="route" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />{m}</li>)}
          {matches.length > 3 && <li className="text-xs text-slate-500">and {matches.length - 3} more</li>}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-600">{label.text}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Investigate task={`Investigate possible shipment exposure to reported event: ${article.title}. Source: ${article.url}`} />
        <AnalyzeButton type="news" id={article.url} extra={extra} open label="Analyze impact on my business" />
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-800 hover:underline">Read at source <Icon name="arrowRight" className="h-4 w-4" /></a>
      </div>
    </article>
  )
}

export default function WorldSituation() {
  const { model, isDemo } = useWorkspace()
  const [category, setCategory] = useState('trade')
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [filters, setFilters] = useState({ query: '', region: '', country: '', mode: '', relevance: '', age: '7', industry: '' })
  const [sort, setSort] = useState('relevance')
  const [shown, setShown] = useState(PAGE)
  const set = (key) => (value) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setShown(PAGE)
  }

  const load = useCallback((id, force = false) => {
    let live = true
    setState((s) => ({ loading: true, data: force ? s.data : null, error: null }))
    loadNews(id, force)
      .then((data) => live && setState({ loading: false, data, error: null }))
      .catch((err) => live && setState((s) => ({ loading: false, data: force ? s.data : null, error: err.message })))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    setShown(PAGE)
    return load(category)
  }, [category, load])

  // Matching runs once per feed, not on every keystroke in the filters.
  const articles = useMemo(() => (state.data?.articles ?? []).map((a) => ({ ...a, exposure: articleExposure(a, model) })), [state.data, model])

  const options = useMemo(() => {
    const regions = new Set()
    const countries = new Set()
    articles.forEach((a) => {
      a.exposure.signals.regions.forEach((r) => regions.add(r))
      a.exposure.signals.countries.forEach((c) => countries.add(c))
    })
    return {
      regions: [...regions].sort().map((r) => ({ value: r, label: r })),
      countries: [...countries].map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [articles])

  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    const cutoff = Date.now() - Number(filters.age) * 86_400_000
    const terms = CATEGORY_NEWS_TERMS[filters.industry] ?? []
    const rank = { potential: 0, insufficient: 1, none: 2 }
    return articles
      .filter((a) => {
        const s = a.exposure.signals
        const title = a.title.toLowerCase()
        if (q && !title.includes(q) && !(a.publisher ?? '').toLowerCase().includes(q)) return false
        if (filters.region && !s.regions.includes(filters.region)) return false
        if (filters.country && !s.countries.includes(filters.country)) return false
        if (filters.mode && !s.modes.includes(filters.mode)) return false
        if (filters.relevance && a.exposure.level !== filters.relevance) return false
        if (terms.length && !terms.some((t) => title.includes(t))) return false
        // An item with no date is kept: hiding it would look like the source had nothing.
        if (a.publishedAt && Date.parse(a.publishedAt) < cutoff) return false
        return true
      })
      .sort((a, b) => (sort === 'relevance' ? rank[a.exposure.level] - rank[b.exposure.level] : 0) || String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
  }, [articles, filters, sort])

  const regionCounts = useMemo(() => {
    const counts = new Map()
    articles.forEach((a) => a.exposure.signals.regions.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1)))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [articles])
  const maxRegion = Math.max(1, ...regionCounts.map(([, n]) => n))
  const exposed = articles.filter((a) => a.exposure.level === 'potential').length
  const filtering = Object.entries(filters).some(([k, v]) => v && !(k === 'age' && v === '7'))
  const featured = filtering ? [] : visible.slice(0, 3)
  const rest = filtering ? visible : visible.slice(3)

  return (
    <div>
      <PageHeader
        title="Global Risk Intelligence"
        badge={isDemo && <DemoTag />}
        actions={<Button variant="secondary" onClick={() => load(category, true)} disabled={state.loading}><Icon name="refresh" className="h-4 w-4" /> Refresh</Button>}
      >
        Trade, shipping and disruption headlines from the last week, matched to your suppliers and shipments. A match shows possible exposure, never a confirmed effect.
      </PageHeader>

      <WeatherIntelligence />
      <div data-tour="feature-world" className="wm-strip mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="News category" onKeyDown={(e) => {
        const i = CATEGORIES.findIndex((c) => c.value === category)
        const next = e.key === 'ArrowRight' ? (i + 1) % CATEGORIES.length : e.key === 'ArrowLeft' ? (i + CATEGORIES.length - 1) % CATEGORIES.length : e.key === 'Home' ? 0 : e.key === 'End' ? CATEGORIES.length - 1 : null
        if (next !== null) { e.preventDefault(); setCategory(CATEGORIES[next].value); e.currentTarget.querySelectorAll('[role="tab"]')[next].focus() }
      }}>
        {CATEGORIES.map((c) => (
          <button key={c.value} type="button" role="tab" id={`news-tab-${c.value}`} aria-controls="news-panel" tabIndex={category === c.value ? 0 : -1} aria-selected={category === c.value} onClick={() => setCategory(c.value)} className={`min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${category === c.value ? 'border-brand-600 bg-brand-700 text-white' : 'border-slate-200 text-slate-700 hover:border-brand-400'}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div id="news-panel" role="tabpanel" aria-labelledby={`news-tab-${category}`}>
      {state.error && (
        <Notice tone="warn" className="mb-3">
          <p className="font-semibold">Headlines could not be refreshed.</p>
          <p className="mt-0.5">{state.error} {state.data ? 'The headlines below are from the last successful update.' : 'No headlines are shown, because Waymark never fills this page with placeholder news.'}</p>
          <button type="button" onClick={() => load(category, true)} className="mt-1 font-semibold underline">Try again</button>
        </Notice>
      )}
      {state.data && (
        <p className="mb-3 text-xs text-slate-500">
          {articles.length} headlines · updated {new Date(state.data.fetchedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })} · via {state.data.source}
          {state.data.fallback && ' (direct fallback: the Waymark news service is unreachable, so only this category is available)'} · {exposed} with potential impact on your records
        </p>
      )}

      {state.loading && !state.data && <div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /><Skeleton className="h-44" /></div>}

      {state.data && (
        <>
          <Card className="mb-3">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <TextInput label="Search" placeholder="Headline or publisher" value={filters.query} onChange={set('query')} />
              <SelectInput label="Relevance to my business" placeholder="Any" value={filters.relevance} onChange={set('relevance')} options={RELEVANCE} />
              <SelectInput label="Region" placeholder="All regions" value={filters.region} onChange={set('region')} options={options.regions} />
              <SelectInput label="Country" placeholder="All countries" value={filters.country} onChange={set('country')} options={options.countries} />
              <SelectInput label="Transport mode" placeholder="All modes" value={filters.mode} onChange={set('mode')} options={['sea', 'air', 'rail', 'road'].map((m) => ({ value: m, label: modeLabel(m) }))} />
              <SelectInput label="Industry" placeholder="All industries" value={filters.industry} onChange={set('industry')} options={INDUSTRIES} />
              <SelectInput label="Date" placeholder={null} value={filters.age} onChange={set('age')} options={AGES} />
              <SelectInput label="Sort" placeholder={null} value={sort} onChange={setSort} options={SORTS} />
            </div>
          </Card>

          {featured.length > 0 && (
            <>
              <h2 className="mb-2 text-lg font-bold text-navy">Featured developments</h2>
              <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{featured.map((a) => <ArticleCard key={a.url} article={a} featured />)}</div>
            </>
          )}

          <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              <h2 className="mb-2 text-lg font-bold text-navy">{filtering ? `${visible.length} matching headlines` : 'More headlines'}</h2>
              {rest.length ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">{rest.slice(0, shown).map((a) => <ArticleCard key={a.url} article={a} />)}</div>
                  {rest.length > shown && <div className="mt-3 text-center"><Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>Show more ({rest.length - shown} left)</Button></div>}
                </>
              ) : (
                !featured.length && <Empty icon="newspaper" title="No headlines match">{filtering ? 'Change or clear the filters.' : 'The sources returned nothing for this category in the last week.'}</Empty>
              )}
            </div>

            <Card title="Where the news is" subtitle="Headlines by region named. Choose one to filter.">
              {regionCounts.length ? (
                <ul className="space-y-2">
                  {regionCounts.map(([region, n]) => (
                    <li key={region}>
                      <button type="button" aria-pressed={filters.region === region} onClick={() => set('region')(filters.region === region ? '' : region)} className="w-full text-left">
                        <span className="flex justify-between gap-2 text-sm"><span className={filters.region === region ? 'font-bold text-navy' : 'text-slate-700'}>{region}</span><span className="text-slate-500 tabular-nums">{n}</span></span>
                        <span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-brand-600" style={{ width: `${(n / maxRegion) * 100}%` }} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600">No headline in this feed names a country.</p>
              )}
              <p className="mt-3 text-xs text-slate-500">Regions come from country names in the headline. Events are not placed on a map, because a headline does not give a reliable location.</p>
            </Card>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
