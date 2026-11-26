export const MAX_SELLING_POINTS = 500

// Older briefs often store a long summary as a single line.
export function formatSellingPoints(text = '') {
  if (text.length < 120 || /[\r\n]/.test(text)) return text

  const paragraphs = []
  const maxBreaks = Math.min(4, Math.floor((MAX_SELLING_POINTS - text.length) / 2))
  let start = 0
  for (const match of text.matchAll(/[。！？；][”’」』）】]*/g)) {
    const end = match.index + match[0].length
    if (paragraphs.length >= maxBreaks || text.length - end < 28) break
    if (end - start < 55) continue
    paragraphs.push(text.slice(start, end))
    start = end
  }
  return [...paragraphs, text.slice(start)].join('\n\n')
}
