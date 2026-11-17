/*
  World Situation news. Headlines come from two key-less aggregators, fetched on
  the server so the browser never calls them on page load:

  - Google News RSS search: publisher name, publication date and a link per item.
  - GDELT DOC 2.0: an open index of world news, used when the first is empty.

  Only headline metadata is used: title, publisher, date and link. No article
  text is downloaded and nothing is summarised or invented. If both sources
  fail, the caller gets an error and shows a freshness warning.
*/

export const NEWS_CATEGORIES = [
  { id: 'trade', label: 'Trade and tariffs', query: '(tariff OR tariffs OR "trade deal" OR customs OR "trade war") Canada' },
  { id: 'shipping', label: 'Shipping and ports', query: '("container shipping" OR "port congestion" OR "shipping rates" OR "port strike" OR "freight rates")' },
  { id: 'air', label: 'Air freight', query: '("air cargo" OR "air freight" OR "cargo airline")' },
  { id: 'land', label: 'Rail and trucking', query: '("rail strike" OR "freight rail" OR trucking OR "border crossing") (Canada OR freight)' },
  { id: 'supply', label: 'Suppliers and manufacturing', query: '("supply chain" OR "factory output" OR "manufacturing" OR shortage) (disruption OR shutdown OR slowdown)' },
  { id: 'policy', label: 'Sanctions and regulation', query: '(sanctions OR "export controls" OR "import ban" OR "trade restrictions")' },
  { id: 'disruption', label: 'Strikes, conflict and disasters', query: '(strike OR typhoon OR hurricane OR earthquake OR conflict OR blockade) ("supply chain" OR shipping OR port OR freight)' },
  { id: 'economy', label: 'Economy and energy', query: '("fuel prices" OR "oil prices" OR "exchange rate" OR inflation) (trade OR freight OR shipping OR imports)' },
]

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
const decode = (text) =>
  String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim()
const tag = (xml, name) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return match ? decode(match[1]) : ''
}

/** Google News RSS to [{ url, title, publisher, publishedAt }]. Titles end with " - Publisher", which is removed. */
export function parseNewsRss(xml) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) ?? []
  return items.map((item) => {
    const publisher = tag(item, 'source')
    let title = tag(item, 'title')
    for (const sep of [' - ', ' | ']) if (publisher && title.endsWith(`${sep}${publisher}`)) title = title.slice(0, -(publisher.length + sep.length)).trim()
    const date = new Date(tag(item, 'pubDate'))
    return { url: tag(item, 'link'), title, publisher, publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString() }
  })
}

/** GDELT's "20261027T051500Z" is when it indexed the article, not always when it was published. */
function gdeltDate(value = '') {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString() : null
}

/** Drops unusable rows and repeats of the same story or link, and sorts newest first. */
export function dedupeArticles(articles, limit = 60) {
  const seen = new Set()
  const out = []
  for (const a of articles) {
    if (!a?.title || !/^https?:\/\//i.test(a?.url ?? '')) continue
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (key.length < 12 || seen.has(key) || seen.has(a.url)) continue
    seen.add(key)
    seen.add(a.url)
    out.push(a)
  }
  return out.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))).slice(0, limit)
}

async function getText(url, timeoutMs, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'news-reader' } })
  if (!res.ok) throw new Error(`responded ${res.status}`)
  return res.text()
}

/**
 * Headlines for one category from the last week.
 * Resolves to { category, articles, source, fetchedAt }. Throws when both sources fail.
 */
export async function fetchWorldNews(config, categoryId, fetchImpl = fetch) {
  const category = NEWS_CATEGORIES.find((c) => c.id === categoryId) ?? NEWS_CATEGORIES[0]
  const timeoutMs = config.upstreamTimeoutMs ?? 10_000
  const stamp = (articles, source) => ({
    category: category.id,
    source,
    fetchedAt: new Date().toISOString(),
    articles: dedupeArticles(articles).map((a) => ({ ...a, category: category.id })),
  })

  let firstError = null
  try {
    const params = new URLSearchParams({ q: `${category.query} when:7d`, hl: 'en-CA', gl: 'CA', ceid: 'CA:en' })
    const articles = parseNewsRss(await getText(`${config.newsBaseUrl}/rss/search?${params}`, timeoutMs, fetchImpl))
    if (articles.length) return stamp(articles, 'Google News')
    firstError = new Error('returned no headlines')
  } catch (err) {
    firstError = err
  }

  try {
    const params = new URLSearchParams({ query: `${category.query} sourcelang:english`, mode: 'ArtList', format: 'json', maxrecords: '60', sort: 'DateDesc', timespan: '7d' })
    const data = JSON.parse(await getText(`${config.gdeltBaseUrl}/api/v2/doc/doc?${params}`, timeoutMs, fetchImpl))
    const articles = (data?.articles ?? []).map((a) => ({ url: a.url, title: a.title, publisher: a.domain ?? '', publishedAt: gdeltDate(a.seendate) }))
    if (articles.length) return stamp(articles, 'GDELT')
    throw new Error('returned no headlines')
  } catch (err) {
    throw new Error(`News sources are unavailable (first source ${firstError.message}; second source ${err.message}).`)
  }
}
