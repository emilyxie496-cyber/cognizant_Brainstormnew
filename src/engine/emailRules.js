/*
  Reads a supplier's delay email with fixed patterns, no AI. It runs in the
  browser and always runs first. Like the AI path, it only fills a field it can
  quote: every quote is copied word for word from the email.
*/

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DELAY_WORDS = /delay|pushed back|push back|postpon|late\b|later than|behind schedule|slip|held up|hold-up|rescheduled/i
const IN_PRODUCTION = /in production|still producing|still being (?:made|produced|manufactured)|not (?:yet )?(?:finished|ready|complete|completed|packed)|production (?:is |has been |was )?(?:delayed|behind|halted|paused|stopped)|unfinished/i
const READY = /\b(?:packed|ready (?:for|to) (?:ship|shipment|dispatch|load|loading)|goods are ready|cargo is ready|finished|completed|production is complete)\b/i
const RELEASE_WORDS = /release|ship|send|dispatch|available|partial|deliver|load/i
const READY_WORDS = /ready|finish|complet|done|available/i

/** Sentences as they appear in the email, so a quote is always a real excerpt. */
function sentences(text) {
  return (String(text).match(/[^.!?\n]+[.!?]?/g) ?? []).map((s) => s.trim()).filter((s) => s.length > 2)
}

const quoteOf = (sentence) => (sentence.length > 220 ? sentence.slice(0, 220) : sentence)

function findDelay(list) {
  for (const s of list) {
    if (!DELAY_WORDS.test(s)) continue
    const m = /(\d{1,3})\s*(?:more |extra |additional )?(day|week)s?/i.exec(s)
    if (m) return { value: Number(m[1]) * (m[2].toLowerCase() === 'week' ? 7 : 1), quote: quoteOf(s) }
  }
  return null
}

function findReadiness(list) {
  for (const s of list) if (IN_PRODUCTION.test(s)) return { value: 'in_production', quote: quoteOf(s) }
  for (const s of list) if (READY.test(s)) return { value: 'ready', quote: quoteOf(s) }
  return null
}

function findPartial(list) {
  for (const s of list) {
    if (!RELEASE_WORDS.test(s)) continue
    const m = /(\d[\d,]*)\s*(?:pcs|pieces|units|sets|cartons|ctns)\b/i.exec(s)
    if (m) return { value: Number(m[1].replace(/,/g, '')), quote: quoteOf(s) }
  }
  return null
}

function findReadyDate(list, now) {
  const today = new Date(now)
  for (const s of list) {
    if (!READY_WORDS.test(s)) continue
    const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s)
    if (iso) return { value: iso[0], quote: quoteOf(s) }
    const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(s) ?? null
    if (!named) continue
    const month = MONTHS.indexOf(named[1].toLowerCase())
    const day = Number(named[2])
    if (day < 1 || day > 31) continue
    // With no year given, take the next time that date comes round.
    let year = named[3] ? Number(named[3]) : today.getUTCFullYear()
    if (!named[3] && Date.UTC(year, month, day) < now - 86_400_000) year += 1
    return { value: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, quote: quoteOf(s) }
  }
  return null
}

/** @returns {{ fields, quotes, unsure: string[], by: 'rules' }} */
export function extractByRules(text, now = Date.now()) {
  const list = sentences(text)
  const found = { delayDays: findDelay(list), readiness: findReadiness(list), readyDate: findReadyDate(list, now), partialQty: findPartial(list) }
  const fields = {}
  const quotes = {}
  for (const [key, hit] of Object.entries(found)) {
    fields[key] = hit?.value ?? null
    if (hit) quotes[key] = hit.quote
  }
  return { fields, quotes, unsure: Object.keys(fields).filter((k) => fields[k] === null), by: 'rules' }
}

/** Fills the gaps in the pattern result with AI fields. The patterns win where both found a value. */
export function mergeExtractions(rules, ai) {
  if (!ai) return rules
  const fields = { ...rules.fields }
  const quotes = { ...rules.quotes }
  const by = {}
  for (const key of Object.keys(fields)) {
    by[key] = fields[key] != null ? 'rules' : null
    if (fields[key] == null && ai.fields?.[key] != null && ai.quotes?.[key]) {
      fields[key] = ai.fields[key]
      quotes[key] = ai.quotes[key]
      by[key] = 'llm'
    }
  }
  return { fields, quotes, unsure: Object.keys(fields).filter((k) => fields[k] === null), by: Object.values(by).includes('llm') ? 'rules+llm' : 'rules', fieldBy: by }
}
