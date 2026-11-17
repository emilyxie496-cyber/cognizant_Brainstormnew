import { describe, expect, it } from 'vitest'
import { matchHelp } from '../src/help/matcher.js'
import { HELP_TOPICS, SETTINGS_TABS } from '../src/help/topics.js'
import { FEATURES } from '../src/state/viewPrefs.js'

describe('offline help retrieval', () => {
  it.each([
    ['where do I see delayed shipments?', 'delay'],
    ['how do I change my company name?', 'settings-profile'],
    ['compare suppliers', 'canadian'],
    ['compare vendors', 'canadian'],
    ['comapre supliers', 'canadian'],
    ['delaye shipmnts', 'delay'],
    ['add a new delivery record', 'add-shipment'],
    ['make the font bigger', 'text-size'],
    ['voice over read this page', 'read-aloud'],
    ['change dashboard scene vehicle', 'vehicle'],
    ['carbon footprint', 'sustainability'],
    ['export PDF report', 'reports'],
    ['trade shipping news', 'world'],
  ])('%s finds %s', (question, id) => {
    expect(matchHelp(question, HELP_TOPICS).matches[0]?.topic.id).toBe(id)
  })
  it.each(['', '   ', 'pizza recipes', 'quantum unicorn tango', 'write a romantic poem', '🚀'])('rejects unrelated question %s', (question) => {
    expect(matchHelp(question, HELP_TOPICS)).toEqual({ kind: 'none', matches: [] })
  })
  it('offers choices for a broad query', () => {
    const result = matchHelp('settings', HELP_TOPICS)
    expect(result.kind).toBe('ambiguous')
    expect(result.matches.length).toBeGreaterThan(1)
  })
  it('covers every feature and Settings tab with stable targets', () => {
    for (const id of [...FEATURES.map((f) => f.id), ...SETTINGS_TABS.map((t) => `settings-${t}`), 'delay', 'add-shipment', 'vehicle', 'text-size', 'read-aloud', 'help']) {
      const topic = HELP_TOPICS.find((t) => t.id === id)
      expect(topic.steps.length).toBeGreaterThanOrEqual(3)
      expect(new Set(topic.steps.map(s => s.text)).size).toBe(topic.steps.length)
      expect(topic.steps.every((s) => s.to && s.target && s.text)).toBe(true)
    }
  })
  it('is deterministic and does not mutate inputs', () => {
    const before = JSON.stringify(HELP_TOPICS)
    expect(matchHelp('compare suppliers', HELP_TOPICS)).toEqual(matchHelp('compare suppliers', HELP_TOPICS))
    expect(JSON.stringify(HELP_TOPICS)).toBe(before)
    expect(matchHelp('anything', [])).toEqual({ kind: 'none', matches: [] })
  })
})
