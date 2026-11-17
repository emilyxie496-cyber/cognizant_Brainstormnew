import { unzipSync, strFromU8 } from 'fflate'

const MAX_EXPANDED = 25 * 1024 * 1024
const decode = s => s.replace(/&#x([a-f\d]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (_, h, d, n) => h || d ? String.fromCodePoint(parseInt(h || d, h ? 16 : 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n])
const text = s => [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decode(m[1])).join('')
const attr = (s, k) => new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1]

/** Bounded OOXML reader. Reads the first worksheet, without evaluating formulas or external links. */
export function readXlsx(buffer) {
  const input = new Uint8Array(buffer)
  if (input.length > 5 * 1024 * 1024 || input[0] !== 80 || input[1] !== 75) throw new Error('Invalid or oversized XLSX workbook.')
  let total = 0
  const files = unzipSync(input, { filter: file => {
    if (file.name.includes('..') || file.originalSize > MAX_EXPANDED || (total += file.originalSize) > MAX_EXPANDED) throw new Error('Workbook expands beyond the safe size limit.')
    return /^(\[Content_Types\]\.xml|xl\/.*\.xml|xl\/_rels\/workbook.xml.rels)$/.test(file.name)
  } })
  const xml = name => {
    if (!files[name]) throw new Error(`Workbook is missing ${name}.`)
    const value = strFromU8(files[name])
    if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('External XML entities are not supported.')
    return value
  }
  const workbook = xml('xl/workbook.xml')
  const sheet = /<sheet\s[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/.exec(workbook)
  if (!sheet) throw new Error('No worksheet found.')
  const relationships = xml('xl/_rels/workbook.xml.rels')
  const rel = [...relationships.matchAll(/<Relationship\s([^>]+)\/?\s*>/g)].find(m => attr(m[1], 'Id') === sheet[1])
  const target = rel && attr(rel[1], 'Target')
  if (!target || /\.\.|:/.test(target) || /TargetMode="External"/.test(rel[1])) throw new Error('Unsupported worksheet relationship.')
  const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`
  const strings = files['xl/sharedStrings.xml'] ? [...xml('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => text(m[1])) : []
  const worksheet = xml(path)
  if (/<f[\s>]/.test(worksheet)) throw new Error('Formula cells are unsupported. Export values only before importing.')
  if (!/<worksheet[\s>]/.test(worksheet) || !/<\/worksheet>/.test(worksheet)) throw new Error('Malformed worksheet XML.')
  const rows = []
  for (const r of worksheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= 10001) throw new Error('Import supports at most 10,000 data rows.')
    const row = []
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r')
      const letters = /^([A-Z]+)\d+$/.exec(ref ?? '')?.[1]
      if (!letters) throw new Error('A cell has an invalid coordinate.')
      const index = [...letters].reduce((n,l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1
      if (index > 255) throw new Error('Import supports at most 256 columns.')
      const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1] ?? ''
      const type = attr(c[1], 't')
      if (type === 'e') throw new Error('Workbook contains spreadsheet error cells.')
      row[index] = type === 's' ? strings[Number(value)] ?? '' : type === 'inlineStr' ? text(c[2] ?? '') : decode(value)
    }
    if (row.some(v => String(v).trim())) rows.push(Array.from({ length: row.length }, (_,i) => row[i] ?? ''))
  }
  return rows
}
