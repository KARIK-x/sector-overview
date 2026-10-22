/** Client-side exports: CSV tables and chart PNGs. No server round-trip. */

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next frame so Safari has time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type CsvValue = string | number | null | undefined

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]) {
  const lines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))]
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

/**
 * Persist an ECharts canvas. The instance is resolved from the rendered DOM so
 * callers do not need to thread a ref through every page. ECharts sets a
 * device-pixel-ratio-aware canvas; the extra pixelRatio keeps labels crisp.
 */
export function downloadChartPng(container: HTMLElement | null, filename: string, background: string) {
  const canvas = container?.querySelector('canvas')
  if (!canvas) return false
  // ECharts renders on a transparent canvas. Composite onto the page surface at
  // 2x so exported charts are readable and do not arrive with a checkerboard.
  const scale = 2
  const out = document.createElement('canvas')
  out.width = canvas.width * scale
  out.height = canvas.height * scale
  const ctx = out.getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = background
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(canvas, 0, 0, out.width, out.height)
  const dataUrl = out.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}
