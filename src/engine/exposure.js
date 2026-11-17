/*
  Matches a world event (a news headline, a country, a port) to a company's own
  suppliers and shipments. Pure rules on structured fields, so the result can be
  explained: every match says which record matched and why.

  A headline is a report, not a measurement. The strongest result this module
  gives is "potential impact". It never marks an impact as confirmed and never
  changes a shipment's status.
*/
import { COUNTRIES, countryOf } from '../../shared/countries.js'
import { AIRPORTS, PORTS } from '../../shared/places.js'
import { classifyTitle } from '../utils/tradeNews.js'

// Common adjectives and short forms that headlines use instead of the country name.
const ALIASES = {
  CA: ['canada', 'canadian', 'ottawa', 'cbsa'],
  US: ['united states', 'america', 'american', 'washington', 'white house'],
  MX: ['mexico', 'mexican'],
  CN: ['china', 'chinese', 'beijing'],
  HK: ['hong kong'],
  TW: ['taiwan', 'taiwanese'],
  KR: ['south korea', 'korean', 'seoul'],
  JP: ['japan', 'japanese', 'tokyo'],
  VN: ['vietnam', 'vietnamese', 'hanoi'],
  TH: ['thailand', 'thai'],
  MY: ['malaysia', 'malaysian'],
  SG: ['singapore'],
  ID: ['indonesia', 'indonesian'],
  KH: ['cambodia', 'cambodian'],
  IN: ['india', 'indian', 'new delhi'],
  BD: ['bangladesh', 'bangladeshi'],
  LK: ['sri lanka'],
  PK: ['pakistan', 'pakistani'],
  TR: ['turkey', 'türkiye', 'turkish'],
  DE: ['germany', 'german'],
  NL: ['netherlands', 'dutch', 'rotterdam'],
  BE: ['belgium', 'belgian', 'antwerp'],
  IT: ['italy', 'italian'],
  PT: ['portugal', 'portuguese'],
  PL: ['poland', 'polish'],
  GB: ['united kingdom', 'britain', 'british'],
  BR: ['brazil', 'brazilian'],
  AU: ['australia', 'australian'],
}

const MODE_TERMS = {
  sea: ['port', 'ports', 'vessel', 'vessels', 'container', 'containers', 'shipping', 'maritime', 'canal', 'ocean', 'dock', 'dockworkers', 'longshore'],
  air: ['air cargo', 'air freight', 'airport', 'airline', 'airlines', 'flight', 'flights'],
  rail: ['rail', 'railway', 'railways', 'train', 'trains', 'cn rail', 'cpkc'],
  road: ['truck', 'trucks', 'trucking', 'truckers', 'border crossing', 'highway'],
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (text, term) => new RegExp(`(?<![a-z])${escape(term)}(?![a-z])`, 'i').test(text)

// "Port of Vancouver" and "Vancouver International" are both found by the city name.
const HUBS = [...PORTS, ...AIRPORTS].map((p) => ({
  ...p,
  keyword: p.name.replace(/^Port of /, '').replace(/[- ](International|Pearson|Trudeau).*$/, '').trim().toLowerCase(),
})).filter((p) => p.keyword.length >= 4)

/** What a headline names: countries, hubs, transport modes and trade topics. */
export function articleSignals(article) {
  const text = String(article?.title ?? '')
  const countries = COUNTRIES.filter((c) => (ALIASES[c.code] ?? [c.name.toLowerCase()]).some((t) => mentions(text, t))).map((c) => c.code)
  // "US" and "UK" are only countries in capitals: "us" is also a pronoun.
  if (/(?<![A-Za-z])U\.?S\.?(?![A-Za-z])/.test(text) && !countries.includes('US')) countries.push('US')
  if (/(?<![A-Za-z])U\.?K\.?(?![A-Za-z])/.test(text) && !countries.includes('GB')) countries.push('GB')
  const hubs = [...new Set(HUBS.filter((h) => mentions(text, h.keyword)).map((h) => h.code))]
  const hubCountries = HUBS.filter((h) => hubs.includes(h.code)).map((h) => h.country)
  const modes = Object.entries(MODE_TERMS).filter(([, terms]) => terms.some((t) => mentions(text, t))).map(([mode]) => mode)
  const allCountries = [...new Set([...countries, ...hubCountries])]
  return {
    countries: allCountries,
    hubs,
    modes,
    topics: classifyTitle(text).map(({ topic }) => ({ id: topic.id, label: topic.label })),
    regions: [...new Set(allCountries.map((code) => countryOf(code)?.region).filter(Boolean))],
  }
}

export const EXPOSURE_LABELS = {
  potential: { label: 'Potential impact', tone: 'amber', text: 'Your records name the same place or route. This is not a confirmed effect.' },
  none: { label: 'No identified exposure', tone: 'slate', text: 'The headline names a place, and none of your suppliers or active shipments use it.' },
  insufficient: { label: 'Insufficient data', tone: 'sky', text: 'The headline does not name a country or hub, so it cannot be matched to your records.' },
}

const usesHub = (shipment, code) => shipment.originHub === code || shipment.destHub === code || shipment.legs?.some((l) => l.from?.code === code || l.to?.code === code)

/**
 * Which suppliers and active shipments share a place with the signals.
 * @returns {{ level, suppliers: {id,name,why}[], shipments: {id,reference,why}[] }}
 */
export function matchExposure(signals, model) {
  const suppliers = []
  const shipments = []
  // Canada is every company's home market, so it is matched through hubs, not by country.
  const foreign = signals.countries.filter((c) => c !== 'CA')

  for (const s of model.suppliers) {
    if (foreign.includes(s.country)) suppliers.push({ id: s.id, name: s.name, why: `Supplier is in ${countryOf(s.country)?.name ?? s.country}` })
  }
  for (const s of model.shipments) {
    if (!s.active) continue
    const hub = signals.hubs.find((code) => usesHub(s, code))
    const country = foreign.find((c) => s.supplier?.country === c || s.destinationCountry === c)
    if (!hub && !country) continue
    // A headline about one mode does not touch a shipment that never uses it.
    if (!hub && signals.modes.length && !signals.modes.some((m) => s.mode === m || s.inlandMode === m || s.legs?.some((l) => l.mode === m))) continue
    const place = hub ? HUBS.find((h) => h.code === hub)?.name : countryOf(country)?.name
    shipments.push({ id: s.id, reference: s.reference, why: hub ? `Route uses ${place}` : s.destinationCountry === country ? `Destination is ${place}` : `Supplier is in ${place}` })
  }

  const named = signals.countries.length > 0 || signals.hubs.length > 0
  const level = suppliers.length || shipments.length ? 'potential' : named ? 'none' : 'insufficient'
  return { level, suppliers, shipments }
}

/** Convenience for a headline: its signals and its match in one call. */
export function articleExposure(article, model) {
  const signals = articleSignals(article)
  return { signals, ...matchExposure(signals, model) }
}
