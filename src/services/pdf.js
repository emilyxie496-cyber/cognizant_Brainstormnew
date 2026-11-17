/*
  Report export: a branded PDF (jsPDF, loaded on demand because it is large) and a
  print-ready HTML document for every interface language, including right-to-left.

  Both take the same report object the Reports page builds:
    { title, generatedAt, isDemo, context?, sections: [{ heading, paragraphs?, bullets?, table? }], sources, disclaimer }
  and an optional branding object { displayName, logo }. Neither adds content of its own:
  a report shows only what the analysis that produced it contained.
*/

// The standard PDF fonts cover Latin-1 only, so typographic characters are simplified.
const clean = (value) =>
  String(value ?? '')
    .replace(/₂/g, '2')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')

const BRAND = [76, 63, 209]
const NAVY = [11, 34, 57]

/** Reads a logo data URL's pixel size, so it can be drawn without distortion. */
function imageSize(dataUrl) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null)
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

export async function reportToPdf(report, { branding = null } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 48
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const width = pageW - margin * 2
  const top = 70
  const bottom = pageH - 54
  let y = top

  const ensure = (needed) => {
    if (y + needed > bottom) {
      doc.addPage()
      y = top
    }
  }

  const text = (value, { size = 10, bold = false, color = [51, 65, 85], gap = 4, indent = 0 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    doc.splitTextToSize(clean(value), width - indent).forEach((line) => {
      ensure(size + 4)
      doc.text(line, margin + indent, y)
      y += size + 3
    })
    y += gap
  }

  // Title block
  const company = clean(branding?.displayName ?? '')
  if (branding?.logo) {
    const size = await imageSize(branding.logo)
    if (size?.w && size?.h) {
      const h = 34
      const w = Math.min(140, (size.w / size.h) * h)
      try {
        doc.addImage(branding.logo, branding.logo.includes('image/jpeg') ? 'JPEG' : branding.logo.includes('image/webp') ? 'WEBP' : 'PNG', pageW - margin - w, y - 14, w, h)
      } catch {
        // A logo the PDF library cannot embed is left out rather than failing the report.
      }
    }
  }
  text(report.title, { size: 18, bold: true, color: NAVY, gap: 2 })
  text(`Generated ${new Date(report.generatedAt).toLocaleString('en-CA')}${company ? ` · Prepared for ${company}` : ''}`, { size: 9, gap: 2 })
  if (report.isDemo) text('Demo Data: this report describes a fictional company.', { size: 9, bold: true, color: [146, 64, 14], gap: 2 })
  doc.setDrawColor(...BRAND)
  doc.setLineWidth(1.2)
  doc.line(margin, y + 2, pageW - margin, y + 2)
  y += 16

  if (report.context) {
    text(report.context.heading ?? 'Report context', { size: 11, bold: true, color: NAVY, gap: 2 })
    ;(report.context.lines ?? []).forEach((line) => text(line, { size: 9, gap: 1 }))
    y += 6
  }

  for (const section of report.sections) {
    ensure(48)
    text(section.heading, { size: 13, bold: true, color: NAVY, gap: 3 })
    section.paragraphs?.forEach((p) => text(p))
    section.bullets?.forEach((b) => text(`- ${b}`, { gap: 2, indent: 6 }))
    if (section.table?.rows?.length) {
      autoTable(doc, {
        startY: y,
        head: [section.table.head.map(clean)],
        body: section.table.rows.map((row) => row.map(clean)),
        margin: { left: margin, right: margin, top, bottom: 54 },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [51, 65, 85], overflow: 'linebreak' },
        headStyles: { fillColor: NAVY, textColor: 255 },
        alternateRowStyles: { fillColor: [241, 245, 249] },
        rowPageBreak: 'avoid',
      })
      y = doc.lastAutoTable.finalY + 14
    }
    y += 6
  }

  ensure(70)
  text('Sources and data timestamps', { size: 13, bold: true, color: NAVY, gap: 3 })
  ;(report.sources ?? []).forEach((s) => text(`${s.label}: ${s.detail}`, { size: 9, gap: 1 }))
  y += 6
  if (report.disclaimer) text(report.disclaimer, { size: 8, color: [100, 116, 139] })

  // Header and footer on every page
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFillColor(...BRAND)
    doc.rect(0, 0, pageW, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...BRAND)
    doc.text('WAYMARK', margin, 30)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139)
    if (company) doc.text(company, pageW - margin, 30, { align: 'right' })
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.5)
    doc.line(margin, pageH - 40, pageW - margin, pageH - 40)
    doc.setFontSize(8)
    doc.text(`${clean(report.title).slice(0, 80)} · ${clean(report.isDemo ? 'Fictional demo data' : 'Confidential')}`, margin, pageH - 26)
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 26, { align: 'right' })
  }
  return doc.output('blob')
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * A complete, print-ready HTML document. Browsers shape every script (Devanagari, Arabic, Chinese)
 * and honour dir="rtl", so this is the export path for languages the PDF fonts cannot draw.
 * `labels` are the translated section names and fixed strings.
 */
export function reportToHtml(report, { branding = null, lang = 'en', dir = 'ltr', labels = {}, locale = 'en-CA' } = {}) {
  const L = { generated: 'Generated', preparedFor: 'Prepared for', sources: 'Sources and data timestamps', demo: 'Demo Data: this report describes a fictional company.', confidential: 'Confidential', ...labels }
  const when = new Date(report.generatedAt).toLocaleString(locale)
  const logo = typeof branding?.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(branding.logo) ? branding.logo : null
  const company = branding?.displayName ?? ''
  const section = (s) => `
    <section>
      <h2>${esc(s.heading)}</h2>
      ${(s.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}
      ${s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${s.table?.rows?.length ? `<table><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((r) => `<tr>${r.map((c) => `<td><bdi>${esc(c)}</bdi></td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
    </section>`
  return `<!doctype html>
<html lang="${esc(lang)}" dir="${dir === 'rtl' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.title)}</title>
<style>
  @page { size: letter; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Arabic", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif; color: #1e293b; margin: 0; font-size: 10.5pt; line-height: 1.5; }
  .bar { height: 6px; background: #4c3fd1; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 0 10px; border-bottom: 2px solid #4c3fd1; margin-bottom: 14px; }
  .brand { font-weight: 800; letter-spacing: .12em; color: #4c3fd1; font-size: 10pt; }
  .company { display: flex; align-items: center; gap: 8px; color: #475569; font-size: 9.5pt; }
  .company img { max-height: 36px; max-width: 140px; object-fit: contain; }
  h1 { font-size: 19pt; color: #0b2239; margin: 0 0 4px; }
  .meta { color: #64748b; font-size: 9pt; margin: 0 0 4px; }
  .demo { color: #92400e; font-weight: 700; font-size: 9pt; }
  .context { background: #f1f5f9; border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 9.5pt; }
  h2 { font-size: 12.5pt; color: #0b2239; margin: 18px 0 6px; break-after: avoid; }
  section { break-inside: auto; }
  p, li { margin: 0 0 5px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 8.5pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { background: #0b2239; color: #fff; text-align: start; padding: 4px 6px; }
  td { border-bottom: 1px solid #e2e8f0; padding: 4px 6px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 8pt; }
  .actions { position: sticky; top: 0; background: #fff; padding: 8px 0; text-align: end; }
  .actions button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid #4c3fd1; background: #4c3fd1; color: #fff; cursor: pointer; }
  @media print { .actions { display: none; } }
</style></head>
<body>
<div class="actions"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
<div class="bar"></div>
<header><span class="brand">WAYMARK</span><span class="company">${logo ? `<img src="${logo}" alt="">` : ''}<span>${esc(company)}</span></span></header>
<h1>${esc(report.title)}</h1>
<p class="meta">${esc(L.generated)} ${esc(when)}${company ? ` · ${esc(L.preparedFor)} ${esc(company)}` : ''}</p>
${report.isDemo ? `<p class="demo">${esc(L.demo)}</p>` : ''}
${report.context ? `<div class="context"><strong>${esc(report.context.heading ?? '')}</strong>${(report.context.lines ?? []).map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
${report.sections.map(section).join('')}
<section><h2>${esc(L.sources)}</h2><ul>${(report.sources ?? []).map((s) => `<li><strong>${esc(s.label)}:</strong> <bdi>${esc(s.detail)}</bdi></li>`).join('')}</ul></section>
<footer>${esc(report.disclaimer ?? '')}<br>Waymark · ${esc(report.isDemo ? L.demo : L.confidential)}</footer>
</body></html>`
}
