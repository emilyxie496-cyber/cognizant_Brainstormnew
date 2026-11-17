// Pure local retrieval: normalized stems, domain synonyms, one-edit typo repair,
// TF-IDF and cosine similarity. No workspace data, network or DOM access.
const stop = new Set('a an the i me my do does how where what is are to of in on for and with can see this it please'.split(' '))
const synonyms = { orders: 'shipment', order: 'shipment', delivery: 'shipment', deliveries: 'shipment', vendor: 'supplier', vendors: 'supplier', carbon: 'emission', co2: 'emission', co2e: 'emission', bigger: 'enlarge', larger: 'enlarge', font: 'text', late: 'delay', delayed: 'delay', overdue: 'delay' }
function stem(w) { return w.length > 4 ? w.replace(/(ing|es|s)$/, '') : w }
function tokens(s) { return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !stop.has(w)).map((w) => stem(synonyms[w] ?? w)) }
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false
  if (a.length === b.length) {
    const diffs = [...a].map((c, i) => c === b[i] ? -1 : i).filter((i) => i >= 0)
    return diffs.length === 1 || (diffs.length === 2 && diffs[1] === diffs[0] + 1 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]])
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return [...long].some((_, i) => long.slice(0, i) + long.slice(i + 1) === short)
}
export function matchHelp(question, topics) {
  if (/^settings[?.!\s]*$/i.test(question.trim())) return { kind: 'ambiguous', matches: topics.filter(t => t.id.startsWith('settings-')).slice(0,3).map(topic => ({ topic, score: 0.2 })) }
  const docs = topics.map((t) => tokens([t.title, ...t.examples, t.keywords].join(' ')))
  const vocabulary = [...new Set(docs.flat())]
  const query = tokens(question.slice(0, 600)).map((w) => vocabulary.includes(w) ? w : vocabulary.find((v) => near(w, v)) ?? w)
  const known = query.filter((w) => vocabulary.includes(w))
  if (!known.length || known.length / Math.max(query.length, 1) < 0.4) return { kind: 'none', matches: [] }
  const idf = (w) => 1 + Math.log((topics.length + 1) / (1 + docs.filter((d) => d.includes(w)).length))
  const vector = (words) => Object.fromEntries([...new Set(words)].map((w) => [w, (1 + Math.log(words.filter((x) => x === w).length)) * idf(w)]))
  const q = vector(query)
  const norm = (v) => Math.sqrt(Object.values(v).reduce((s, n) => s + n * n, 0))
  const ranked = docs.map((words, i) => {
    const d = vector(words)
    return { topic: topics[i], score: Object.keys(q).reduce((s, w) => s + q[w] * (d[w] ?? 0), 0) / (norm(q) * norm(d) || 1) }
  }).sort((a, b) => b.score - a.score)
  const matches = ranked.filter((m) => m.score >= 0.13).slice(0, 3)
  return { kind: !matches.length ? 'none' : matches[0].score >= 0.24 && (!matches[1] || matches[0].score - matches[1].score > 0.09) ? 'confident' : 'ambiguous', matches }
}
