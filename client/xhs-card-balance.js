// Measure ink rather than panel backgrounds: a tall, nearly empty grid cell
// otherwise looks indistinguishable from a full illustration.
function measure(root, nodes) {
  const board = root.getBoundingClientRect()
  const scale = board.height / 1440
  if (!scale) return null
  const lanes = Array.from({ length: 2 }, () => [])
  let overflow = 0
  const range = document.createRange()
  function record(rect) {
    if (!rect.width || !rect.height) return
    const top = (rect.top - board.top) / scale
    const bottom = (rect.bottom - board.top) / scale
    overflow = Math.max(overflow, bottom - 1440, -top,
      (rect.right - board.right) / scale, (board.left - rect.left) / scale)
    const middle = board.left + board.width / 2
    if (rect.left < middle) lanes[0].push([top, bottom])
    if (rect.right > middle) lanes[1].push([top, bottom])
  }
  for (const node of nodes) {
    if (node.nodeType === 3) {
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) record(rect)
    } else record(node.getBoundingClientRect())
  }
  let score = 0
  for (const spans of lanes) {
    if (!spans.length) continue
    spans.sort((a, b) => a[0] - b[0])
    let end = 60
    for (const [top, bottom] of spans) {
      score += Math.max(0, top - end - 100) ** 2
      end = Math.max(end, bottom)
    }
    score += Math.max(0, 1280 - end) ** 2
  }
  return { score, overflow }
}

function hasClippedContent(elements) {
  return elements.some(el => el.clientHeight > 0 &&
      (el.scrollHeight > el.clientHeight + 3 || el.scrollWidth > el.clientWidth + 3) &&
      /hidden|clip|auto|scroll/.test(getComputedStyle(el).overflow))
}

// A flex child with min-height:0 can paint through its footer even when
// the whole artboard still fits. Reserve the main area's actual boundary.
function mainOverflow(main) {
  return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0
}

export function balanceXhsArtboard(root, sheet) {
  sheet.textContent = ''
  const main = root.querySelector(':scope > .cd-main')
  let fitRules = ''
  if (mainOverflow(main) > 3) {
    // Zoom participates in layout, so text wraps at the new available width.
    // Pick the largest readable scale that fits, preserving header/footer size.
    let smallestOverflow = mainOverflow(main)
    for (const zoom of [0.95, 0.9, 0.85, 0.8, 0.75]) {
      sheet.textContent = '.xhs-artboard > .cd-main {zoom:' + zoom + '}'
      const overflow = mainOverflow(main)
      if (overflow < smallestOverflow) {
        fitRules = sheet.textContent
        smallestOverflow = overflow
      }
      if (overflow <= 3) break
    }
    sheet.textContent = fitRules
  }
  const nodes = [...root.querySelectorAll('img,svg:not([data-xhs-decor])')]
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const sizes = new Map()
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!node.textContent.trim() || node.parentElement.closest('svg,style')) continue
    nodes.push(node)
    const el = node.parentElement
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (size >= 12 && size < 48 && el.textContent.trim().length >= 5 &&
        !el.closest('footer,.cd-footer') && !el.style.fontSize) sizes.set(el, size)
  }
  let best = measure(root, nodes)
  if (!best || best.score < 10000 || !sizes.size) return
  const elements = [...root.querySelectorAll('*')]
  const paths = new Map([[root, '.xhs-artboard']])
  for (const el of elements) {
    const index = Array.prototype.indexOf.call(el.parentElement.children, el) + 1
    paths.set(el, paths.get(el.parentElement) + ' > :nth-child(' + index + ')')
  }
  let accepted = fitRules
  for (const factor of [1.2, 1.45, 1.7]) {
    sheet.textContent = fitRules + [...sizes].map(([el, size]) =>
      paths.get(el) + '{font-size:' + Math.min(58, size * factor) + 'px!important;line-height:1.38!important}'
    ).join('\n')
    const next = measure(root, nodes)
    if (mainOverflow(main) <= 3 && !hasClippedContent(elements) && next.overflow <= 1 && next.score < best.score) {
      accepted = sheet.textContent
      best = next
    }
  }
  // Give stacked entries room to breathe inside a tall column. Only keep
  // spacing that reduces measured gaps after text has wrapped at its new size.
  const textRules = accepted
  const blockCandidates = [...sizes.keys()].filter(el =>
    ['block', 'table-cell'].includes(getComputedStyle(el).display) &&
    !el.style.padding && !el.style.paddingBlock)
  if (blockCandidates.length) {
    for (const padding of [10, 24, 40, 56]) {
      const rules = blockCandidates.map(el => paths.get(el) + '{padding-block:' + padding + 'px}')
      sheet.textContent = textRules + rules.join('\n')
      const next = measure(root, nodes)
      if (mainOverflow(main) > 3 || next.overflow > 1 || hasClippedContent(elements)) break
      if (next.score < best.score) {
        accepted = sheet.textContent
        best = next
      }
    }
  }
  sheet.textContent = accepted
}
