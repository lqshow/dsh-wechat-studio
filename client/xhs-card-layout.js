export const CARD_SIZE = { width: 1080, height: 1440 }
export const PADDING = 80
export const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif'
export const XHS_DECK_STYLES = ['tech', 'editorial', 'bold']

const NO_LINE_START = new Set([...'，。！？、；：）」』》”’…,.!?;:)]}>'])
const NO_LINE_END = new Set([...'（「『《“‘([{<'])

const INK_DARK = '#14161A'
const INK_BODY = '#2B303B'
const INK_MUTED = '#5B6270'
const INK_SUBTLE = '#8A92A3'
const WHITE = '#FFFFFF'
const DARK_BG = '#16181D'
const DARK_CARD = '#23262E'
const DARK_BORDER = '#323744'
const DARK_MUTED = '#CBD5E1'

const DEFAULT_BADGES = {
  cover: '实操笔记',
  compare: '痛点对比',
  steps: 'STEP 流程',
  metrics: '实测数据',
  grid: '核心要点',
  list: '实战清单',
  quote: '核心判断',
  end: '抄作业清单',
}

function tokenize(text) {
  const input = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!input) return []
  return input.match(/[A-Za-z0-9_\-./]+|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) ?? []
}

function splitLongToken(token, maxWidth, measure) {
  const chars = [...token]
  const out = []
  let cur = ''
  for (const ch of chars) {
    if (!cur) cur = ch
    else if (measure(cur + ch) <= maxWidth) cur += ch
    else {
      out.push(cur)
      cur = ch
    }
  }
  if (cur) out.push(cur)
  return out
}

export function wrapText(text, maxWidth, measure) {
  const tokens = tokenize(text)
  if (!tokens.length) return []
  const lines = []
  let current = ''

  for (const token of tokens) {
    if (!current) {
      if (token === ' ') continue
      if (measure(token) <= maxWidth) {
        current = token
      } else {
        const parts = splitLongToken(token, maxWidth, measure)
        lines.push(...parts.slice(0, -1))
        current = parts.at(-1) ?? ''
      }
      continue
    }

    if (measure(current + token) <= maxWidth) {
      current += token
      continue
    }

    if (token === ' ') {
      lines.push(current.trimEnd())
      current = ''
      continue
    }

    if (NO_LINE_START.has(token)) {
      lines.push((current + token).trimEnd())
      current = ''
      continue
    }

    const curChars = [...current]
    let carry = ''
    while (curChars.length > 1 && NO_LINE_END.has(curChars.at(-1))) {
      carry = curChars.pop() + carry
    }
    lines.push(curChars.join('').trimEnd())

    const nextStart = carry + token
    if (measure(nextStart) <= maxWidth) {
      current = nextStart
    } else {
      const parts = splitLongToken(nextStart, maxWidth, measure)
      lines.push(...parts.slice(0, -1))
      current = parts.at(-1) ?? ''
    }
  }

  if (current.trimEnd()) lines.push(current.trimEnd())
  return lines
}

function splitPipe(line) {
  return String(line ?? '')
    .split('|')
    .map(part => part.trim())
    .filter(Boolean)
}

function resolveStyleTokens(deckStyle, palette) {
  const style = XHS_DECK_STYLES.includes(deckStyle) ? deckStyle : 'tech'
  const softShadow = { color: 'rgba(20, 22, 26, 0.06)', blur: 20, x: 0, y: 6 }
  const hardShadow = { color: '#18181B', blur: 0, x: 6, y: 6 }

  if (style === 'editorial') {
    return {
      style,
      bg: WHITE,
      cardBg: palette.soft,
      cardBorder: palette.line,
      borderWidth: 1.5,
      shadow: null,
      softBg: palette.soft,
      badgeBg: palette.tint,
      badgeText: palette.main,
      divider: palette.tint,
    }
  }
  if (style === 'bold') {
    return {
      style,
      bg: palette.soft,
      cardBg: WHITE,
      cardBorder: '#18181B',
      borderWidth: 3,
      shadow: hardShadow,
      softBg: palette.tint,
      badgeBg: palette.main,
      badgeText: WHITE,
      divider: '#18181B',
    }
  }
  // tech (冷白科技风)
  return {
    style,
    bg: '#F7F8FA',
    cardBg: WHITE,
    cardBorder: '#DFE4EC',
    borderWidth: 1.5,
    shadow: softShadow,
    softBg: '#EEF1F6',
    badgeBg: palette.main,
    badgeText: WHITE,
    divider: '#E2E7EF',
  }
}

function addBackgroundAndChrome(ops, { card, index, total, palette, author, tokens, isDark }) {
  const { width, height } = CARD_SIZE
  ops.push({ type: 'rect', x: 0, y: 0, w: width, h: height, fill: isDark ? DARK_BG : tokens.bg })

  if (isDark) {
    ops.push({ type: 'rect', x: 0, y: 0, w: width, h: 12, fill: palette.main })
  } else if (tokens.style === 'tech') {
    ops.push({ type: 'dotGrid', x: 40, y: 40, w: width - 80, h: height - 80, step: 36, radius: 1.3, color: '#DCE1EA' })
    ops.push({ type: 'rect', x: 0, y: 0, w: width, h: 10, fill: palette.main })
  } else if (tokens.style === 'editorial') {
    if (card.kind === 'cover') {
      ops.push({
        type: 'polygon',
        points: [[width - 420, 0], [width, 0], [width, 460], [width - 140, 320]],
        fill: palette.tint,
        opacity: 0.75,
      })
    } else {
      ops.push({
        type: 'polygon',
        points: [[width - 260, 0], [width, 0], [width, 180]],
        fill: palette.soft,
        opacity: 0.9,
      })
    }
    ops.push({ type: 'rect', x: 0, y: 0, w: width, h: 10, fill: palette.main })
  } else {
    ops.push({ type: 'rect', x: 0, y: 0, w: width, h: 14, fill: '#18181B' })
  }

  // 页脚分割线与 @author + i/n
  const footerLineY = height - 96
  const footerTextY = height - 68
  ops.push({
    type: 'line',
    x1: PADDING,
    y1: footerLineY,
    x2: width - PADDING,
    y2: footerLineY,
    stroke: isDark ? DARK_BORDER : tokens.divider,
    lineWidth: 1.5,
  })
  const authorLabel = author ? (String(author).startsWith('@') ? String(author) : `@${author}`) : '@笔记卡片'
  ops.push({
    type: 'text',
    x: PADDING,
    y: footerTextY,
    text: authorLabel,
    fontPx: 26,
    weight: 500,
    color: isDark ? '#94A3B8' : INK_SUBTLE,
    align: 'left',
  })
  ops.push({
    type: 'text',
    x: width - PADDING,
    y: footerTextY,
    text: `${index + 1}/${total}`,
    fontPx: 26,
    weight: 700,
    color: isDark ? palette.mark : palette.main,
    align: 'right',
  })
}

function addHeaderBadgeAndTitle(ops, { card, index, palette, tokens, measure, contentWidth, isDark = false }) {
  let y = 78
  const badgeText = card.badge || DEFAULT_BADGES[card.kind] || '要点'
  const pageTag = card.kind === 'cover' || card.kind === 'end'
    ? badgeText
    : `${String(index + 1).padStart(2, '0')} · ${badgeText}`
  const badgePx = 24
  const badgeW = Math.min(contentWidth, Math.round(measure(pageTag, badgePx, 700)) + 40)
  const badgeH = 44

  ops.push({
    type: 'rect',
    x: PADDING,
    y,
    w: badgeW,
    h: badgeH,
    fill: isDark ? palette.main : tokens.badgeBg,
    radius: 22,
    ...(tokens.style === 'bold' && !isDark ? { stroke: '#18181B', lineWidth: 2 } : {}),
  })
  ops.push({
    type: 'text',
    x: PADDING + 20,
    y: y + 10,
    text: pageTag,
    fontPx: badgePx,
    weight: 700,
    color: isDark ? WHITE : tokens.badgeText,
    align: 'left',
  })
  y += badgeH + 26

  const heading = card.heading || ''
  if (heading) {
    const headPx = card.kind === 'cover' ? 84 : card.kind === 'end' ? 66 : 56
    const headLineH = Math.round(headPx * 1.24)
    const headLines = wrapText(heading, contentWidth, t => measure(t, headPx, 800))
    headLines.forEach(line => {
      ops.push({
        type: 'text',
        x: PADDING,
        y,
        text: line,
        fontPx: headPx,
        weight: 800,
        color: isDark ? WHITE : INK_DARK,
        align: 'left',
      })
      y += headLineH
    })
  }

  if (card.accent) {
    const accPx = card.kind === 'cover' ? 58 : 30
    const accWeight = card.kind === 'cover' ? 800 : 600
    const accLineH = Math.round(accPx * 1.3)
    const accLines = wrapText(card.accent, contentWidth, t => measure(t, accPx, accWeight))
    if (card.kind === 'cover' && accLines.length) {
      const last = accLines.at(-1)
      const lastW = Math.min(contentWidth, Math.round(measure(last, accPx, accWeight)))
      const lastY = y + (accLines.length - 1) * accLineH
      ops.push({
        type: 'rect',
        x: PADDING - 4,
        y: Math.round(lastY + accPx * 0.62),
        w: Math.min(contentWidth + 8, lastW + 14),
        h: Math.round(accPx * 0.36),
        fill: palette.mark,
        radius: 6,
      })
    }
    accLines.forEach(line => {
      ops.push({
        type: 'text',
        x: PADDING,
        y,
        text: line,
        fontPx: accPx,
        weight: accWeight,
        color: isDark ? palette.mark : (card.kind === 'cover' ? palette.main : INK_MUTED),
        align: 'left',
      })
      y += accLineH
    })
  }

  return y + 24
}

function addCalloutBar(ops, { text, y, maxBottom, contentWidth, palette, tokens, measure, isDark = false }) {
  if (!text) return { nextY: y, overflow: false }
  const fontPx = 26
  const lineH = 38
  const padX = 24
  const padY = 18
  const lines = wrapText(text, contentWidth - padX * 2 - 12, t => measure(t, fontPx, 600))
  const boxH = padY * 2 + lines.length * lineH
  const boxY = Math.min(y, maxBottom - boxH)
  const overflow = boxY + boxH > maxBottom || boxY < y - 10

  ops.push({
    type: 'rect',
    x: PADDING,
    y: Math.max(y, boxY),
    w: contentWidth,
    h: boxH,
    fill: isDark ? DARK_CARD : palette.tint,
    stroke: isDark ? palette.main : palette.main,
    lineWidth: 2,
    radius: 14,
  })
  const actualY = Math.max(y, boxY)
  ops.push({
    type: 'rect',
    x: PADDING,
    y: actualY,
    w: 8,
    h: boxH,
    fill: palette.main,
    radius: 4,
  })
  let ly = actualY + padY
  lines.forEach(line => {
    ops.push({
      type: 'text',
      x: PADDING + padX + 4,
      y: ly,
      text: line,
      fontPx,
      weight: 600,
      color: isDark ? WHITE : INK_DARK,
      align: 'left',
    })
    ly += lineH
  })
  return { nextY: actualY + boxH, overflow }
}

function addScreenshotWindow(ops, { src, x, y, w, h, tokens, palette }) {
  const barH = 34
  ops.push({
    type: 'rect',
    x,
    y,
    w,
    h,
    fill: WHITE,
    stroke: tokens.cardBorder,
    lineWidth: tokens.borderWidth,
    radius: 16,
    shadow: tokens.shadow,
  })
  ops.push({
    type: 'rect',
    x,
    y,
    w,
    h: barH,
    fill: tokens.softBg,
    radius: 12,
  })
  const dots = ['#F87171', '#FBBF24', '#34D399']
  dots.forEach((dotColor, i) => {
    ops.push({
      type: 'rect',
      x: x + 16 + i * 20,
      y: y + 11,
      w: 12,
      h: 12,
      fill: dotColor,
      radius: 6,
    })
  })
  ops.push({
    type: 'text',
    x: x + w - 16,
    y: y + 7,
    text: '实拍',
    fontPx: 18,
    weight: 600,
    color: palette.main,
    align: 'right',
  })
  ops.push({
    type: 'image',
    src,
    x: x + 10,
    y: y + barH + 8,
    w: w - 20,
    h: h - barH - 18,
    radius: 10,
    fit: 'contain',
  })
}

function layoutCover(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  let y = startY
  let overflow = false

  // 引言框（承载 lines）
  const quoteLines = card.lines ?? []
  if (quoteLines.length) {
    const qPx = 34
    const qLineH = 48
    const wrappedAll = quoteLines.flatMap(l => wrapText(l, contentWidth - 56, t => measure(t, qPx, 500)))
    const boxH = 36 + wrappedAll.length * qLineH
    ops.push({
      type: 'rect',
      x: PADDING,
      y,
      w: contentWidth,
      h: boxH,
      fill: tokens.cardBg,
      stroke: tokens.cardBorder,
      lineWidth: tokens.borderWidth,
      radius: 16,
      shadow: tokens.shadow,
    })
    ops.push({ type: 'rect', x: PADDING, y, w: 8, h: boxH, fill: palette.main, radius: 4 })
    let qy = y + 20
    wrappedAll.forEach(line => {
      ops.push({ type: 'text', x: PADDING + 28, y: qy, text: line, fontPx: qPx, weight: 500, color: INK_BODY, align: 'left' })
      qy += qLineH
    })
    y += boxH + 28
  }

  const calloutH = card.callout ? 82 : 68
  const tagList = card.tags?.length ? card.tags : []
  const tagsRowH = tagList.length ? 60 : 0
  const availVisualH = maxBottom - calloutH - tagsRowH - 24 - y

  if (card.imageUrl && availVisualH >= 200) {
    addScreenshotWindow(ops, { src: card.imageUrl, x: PADDING, y, w: contentWidth, h: Math.min(availVisualH, 380), tokens, palette })
    y += Math.min(availVisualH, 380) + 22
  } else if (availVisualH >= 140) {
    // 封面模块预览卡片（3 宫格 / 核心流程条，确保封面视觉饱满）
    const panelH = Math.min(200, availVisualH)
    ops.push({
      type: 'rect',
      x: PADDING,
      y,
      w: contentWidth,
      h: panelH,
      fill: palette.soft,
      stroke: palette.line,
      lineWidth: 1.5,
      radius: 18,
    })
    const steps = ['提炼核心观点', '多版式卡片直出', '一键打包发布']
    const colW = Math.floor((contentWidth - 64 - 48) / 3)
    const boxY = y + Math.round((panelH - 86) / 2)
    steps.forEach((label, i) => {
      const bx = PADDING + 24 + i * (colW + 32)
      ops.push({
        type: 'rect',
        x: bx,
        y: boxY,
        w: colW,
        h: 86,
        fill: i === 1 ? palette.main : WHITE,
        stroke: i === 1 ? palette.main : tokens.cardBorder,
        lineWidth: 1.5,
        radius: 14,
      })
      ops.push({
        type: 'text',
        x: bx + colW / 2,
        y: boxY + 26,
        text: label,
        fontPx: 25,
        weight: 700,
        color: i === 1 ? WHITE : INK_DARK,
        align: 'center',
      })
      if (i < 2) {
        ops.push({
          type: 'arrow',
          x1: bx + colW + 6,
          y1: boxY + 43,
          x2: bx + colW + 26,
          y2: boxY + 43,
          color: palette.main,
          lineWidth: 3,
          headSize: 10,
        })
      }
    })
    y += panelH + 24
  }

  // 封面 tags 胶囊
  if (tagList.length && y + 48 <= maxBottom - calloutH) {
    let tx = PADDING
    const tagPx = 24
    for (const tag of tagList) {
      const label = `# ${tag}`
      const tw = Math.round(measure(label, tagPx, 600)) + 32
      if (tx + tw > PADDING + contentWidth) break
      ops.push({
        type: 'rect',
        x: tx,
        y,
        w: tw,
        h: 44,
        fill: palette.tint,
        stroke: palette.line,
        lineWidth: 1,
        radius: 22,
      })
      ops.push({ type: 'text', x: tx + 16, y: y + 10, text: label, fontPx: tagPx, weight: 600, color: palette.main, align: 'left' })
      tx += tw + 14
    }
  }

  // 底部引导条
  const barText = card.callout || '左滑查看详细拆解 →'
  const barY = maxBottom - 62
  if (barY < y) overflow = true
  ops.push({ type: 'rect', x: PADDING, y: Math.max(y, barY), w: contentWidth, h: 62, fill: palette.main, radius: 14 })
  ops.push({ type: 'text', x: Math.round(CARD_SIZE.width / 2), y: Math.max(y, barY) + 17, text: barText, fontPx: 28, weight: 700, color: WHITE, align: 'center' })

  return { ops, overflow }
}

function layoutCompare(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const lines = card.lines ?? []
  const before = []
  const after = []

  lines.forEach(line => {
    const parts = splitPipe(line)
    if (parts.length >= 2 && /^(以前|旧|之前|痛点|before)/i.test(parts[0])) {
      before.push(parts.slice(1).join('：'))
    } else if (parts.length >= 2 && /^(现在|新|之后|解法|after)/i.test(parts[0])) {
      after.push(parts.slice(1).join('：'))
    } else if (before.length < Math.ceil(lines.length / 2)) {
      before.push(line)
    } else {
      after.push(line)
    }
  })
  if (!after.length && before.length > 1) after.push(before.pop())

  const calloutReserve = card.callout ? 102 : 0
  const usableBottom = maxBottom - calloutReserve
  let y = startY
  let overflow = false

  for (const fontPx of [30, 26, 23]) {
    const lineH = Math.round(fontPx * 1.45)
    const beforeWrapped = before.map(item => wrapText(item, contentWidth - 96, t => measure(t, fontPx, 500)))
    const afterWrapped = after.map(item => wrapText(item, contentWidth - 96, t => measure(t, fontPx, 600)))
    const topBoxH = 74 + beforeWrapped.reduce((s, w) => s + w.length * lineH + 14, 0) + 16
    const botBoxH = 76 + afterWrapped.reduce((s, w) => s + w.length * lineH + 16, 0) + 18
    const arrowGap = 64
    const totalH = topBoxH + arrowGap + botBoxH

    if (y + totalH <= usableBottom || fontPx === 23) {
      if (y + totalH > usableBottom) overflow = true

      // 上半区：以前
      ops.push({
        type: 'rect',
        x: PADDING,
        y,
        w: contentWidth,
        h: topBoxH,
        fill: tokens.softBg,
        stroke: tokens.cardBorder,
        lineWidth: tokens.borderWidth,
        radius: 20,
      })
      ops.push({ type: 'rect', x: PADDING + 24, y: y + 20, w: 120, h: 36, fill: '#E2E8F0', radius: 18 })
      ops.push({ type: 'text', x: PADDING + 84, y: y + 27, text: '以前方式', fontPx: 20, weight: 700, color: '#475569', align: 'center' })
      let by = y + 72
      beforeWrapped.forEach(wLines => {
        ops.push({ type: 'text', x: PADDING + 28, y: by, text: '✕', fontPx, weight: 700, color: '#DC2626', align: 'left' })
        wLines.forEach(wl => {
          ops.push({ type: 'text', x: PADDING + 66, y: by, text: wl, fontPx, weight: 500, color: INK_BODY, align: 'left' })
          by += lineH
        })
        by += 14
      })

      // 向下箭头
      const cx = Math.round(CARD_SIZE.width / 2)
      ops.push({
        type: 'arrow',
        x1: cx,
        y1: y + topBoxH + 10,
        x2: cx,
        y2: y + topBoxH + arrowGap - 10,
        color: palette.main,
        lineWidth: 5,
        headSize: 16,
      })

      // 下半区：现在
      const botY = y + topBoxH + arrowGap
      ops.push({
        type: 'rect',
        x: PADDING,
        y: botY,
        w: contentWidth,
        h: botBoxH,
        fill: tokens.cardBg,
        stroke: palette.main,
        lineWidth: 2.5,
        radius: 20,
        shadow: tokens.shadow,
      })
      ops.push({ type: 'rect', x: PADDING, y: botY, w: contentWidth, h: 58, fill: palette.main, radius: 16 })
      ops.push({ type: 'text', x: PADDING + 28, y: botY + 15, text: '现在 · 新方案', fontPx: 26, weight: 700, color: WHITE, align: 'left' })
      let ay = botY + 76
      afterWrapped.forEach(wLines => {
        ops.push({ type: 'text', x: PADDING + 28, y: ay, text: '✓', fontPx, weight: 800, color: palette.main, align: 'left' })
        wLines.forEach(wl => {
          ops.push({ type: 'text', x: PADDING + 66, y: ay, text: wl, fontPx, weight: 600, color: INK_DARK, align: 'left' })
          ay += lineH
        })
        ay += 16
      })

      y = botY + botBoxH + 22
      break
    }
  }

  if (card.callout) {
    const res = addCalloutBar(ops, { text: card.callout, y, maxBottom, contentWidth, palette, tokens, measure })
    overflow = overflow || res.overflow
  }
  return { ops, overflow }
}

function layoutSteps(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const items = (card.lines ?? []).map(line => {
    const parts = splitPipe(line)
    return { title: parts[0] ?? line, desc: parts.slice(1).join('｜') }
  })
  const cols = Math.max(1, items.length)
  const gap = 28
  const colW = Math.floor((contentWidth - gap * (cols - 1)) / cols)
  const calloutReserve = card.callout ? 102 : 0
  const usableBottom = maxBottom - calloutReserve

  let y = startY
  let overflow = false
  const titlePx = cols >= 4 ? 26 : 30
  const descPx = cols >= 4 ? 22 : 25
  const titleLineH = Math.round(titlePx * 1.35)
  const descLineH = Math.round(descPx * 1.45)

  const wrappedCols = items.map(item => ({
    title: wrapText(item.title, colW - 36, t => measure(t, titlePx, 700)),
    desc: item.desc ? wrapText(item.desc, colW - 36, t => measure(t, descPx, 500)) : [],
  }))
  const cardH = Math.max(
    240,
    92 + Math.max(...wrappedCols.map(c => c.title.length * titleLineH + (c.desc.length ? 12 + c.desc.length * descLineH : 0))) + 24,
  )

  items.forEach((_, i) => {
    const cx = PADDING + i * (colW + gap)
    ops.push({
      type: 'rect',
      x: cx,
      y,
      w: colW,
      h: cardH,
      fill: tokens.cardBg,
      stroke: tokens.cardBorder,
      lineWidth: tokens.borderWidth,
      radius: 18,
      shadow: tokens.shadow,
    })
    ops.push({ type: 'rect', x: cx + 18, y: y + 20, w: 56, h: 36, fill: palette.main, radius: 18 })
    ops.push({ type: 'text', x: cx + 46, y: y + 27, text: `0${i + 1}`, fontPx: 22, weight: 800, color: WHITE, align: 'center' })

    let ty = y + 74
    wrappedCols[i].title.forEach(line => {
      ops.push({ type: 'text', x: cx + 18, y: ty, text: line, fontPx: titlePx, weight: 700, color: INK_DARK, align: 'left' })
      ty += titleLineH
    })
    if (wrappedCols[i].desc.length) {
      ty += 12
      wrappedCols[i].desc.forEach(line => {
        ops.push({ type: 'text', x: cx + 18, y: ty, text: line, fontPx: descPx, weight: 500, color: INK_MUTED, align: 'left' })
        ty += descLineH
      })
    }

    if (i < cols - 1) {
      ops.push({
        type: 'arrow',
        x1: cx + colW + 4,
        y1: y + Math.round(cardH / 2),
        x2: cx + colW + gap - 4,
        y2: y + Math.round(cardH / 2),
        color: palette.main,
        lineWidth: 3.5,
        headSize: 10,
      })
    }
  })

  y += cardH + 28
  const remainH = usableBottom - y
  if (card.imageUrl && remainH >= 180) {
    addScreenshotWindow(ops, { src: card.imageUrl, x: PADDING, y, w: contentWidth, h: remainH, tokens, palette })
    y += remainH + 20
  } else if (remainH >= 120) {
    // 补充「核心执行节奏」横幅块，保持画面饱满
    const summaryH = Math.min(200, remainH)
    ops.push({
      type: 'rect',
      x: PADDING,
      y,
      w: contentWidth,
      h: summaryH,
      fill: palette.soft,
      stroke: palette.line,
      lineWidth: 1.5,
      radius: 18,
    })
    ops.push({
      type: 'text',
      x: PADDING + 28,
      y: y + 26,
      text: '按顺序逐一落地，每步结果直接喂给下一步',
      fontPx: 28,
      weight: 700,
      color: palette.main,
      align: 'left',
    })
    ops.push({
      type: 'text',
      x: PADDING + 28,
      y: y + 76,
      text: items.map((it, idx) => `${idx + 1}. ${it.title}`).join('  →  '),
      fontPx: 25,
      weight: 500,
      color: INK_BODY,
      align: 'left',
    })
    y += summaryH + 20
  } else if (remainH < 0) {
    overflow = true
  }

  if (card.callout) {
    const res = addCalloutBar(ops, { text: card.callout, y, maxBottom, contentWidth, palette, tokens, measure })
    overflow = overflow || res.overflow
  }
  return { ops, overflow }
}

function layoutMetrics(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const items = (card.lines ?? []).map(line => {
    const parts = splitPipe(line)
    if (parts.length >= 3) return { value: parts[0], label: parts[1], note: parts.slice(2).join(' ') }
    if (parts.length === 2) return { value: parts[0], label: parts[1], note: '' }
    const numMatch = /^([^\s]+)\s+(.+)$/.exec(line)
    return numMatch ? { value: numMatch[1], label: numMatch[2], note: '' } : { value: line, label: '', note: '' }
  })

  const cols = 2
  const gap = 24
  const valPx = items.length <= 2 ? 64 : 54
  const labelPx = 28
  const notePx = 23
  const cellH = items.length <= 2 ? 250 : 210
  const calloutReserve = card.callout ? 102 : 0
  const usableBottom = maxBottom - calloutReserve

  let y = startY
  let overflow = false

  items.forEach((item, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const rowSize = Math.min(cols, items.length - row * cols)
    const cellW = Math.floor((contentWidth - gap * (rowSize - 1)) / rowSize)
    const cx = PADDING + col * (cellW + gap)
    const cy = y + row * (cellH + gap)
    ops.push({
      type: 'rect',
      x: cx,
      y: cy,
      w: cellW,
      h: cellH,
      fill: tokens.cardBg,
      stroke: tokens.cardBorder,
      lineWidth: tokens.borderWidth,
      radius: 20,
      shadow: tokens.shadow,
    })
    ops.push({ type: 'rect', x: cx + 24, y: cy, w: Math.min(120, cellW - 48), h: 8, fill: palette.main, radius: 4 })
    ops.push({ type: 'text', x: cx + 28, y: cy + 32, text: item.value, fontPx: valPx, weight: 800, color: palette.main, align: 'left' })
    let ty = cy + 32 + valPx + 18
    if (item.label) {
      wrapText(item.label, cellW - 56, t => measure(t, labelPx, 700)).slice(0, 2).forEach(line => {
        ops.push({ type: 'text', x: cx + 28, y: ty, text: line, fontPx: labelPx, weight: 700, color: INK_DARK, align: 'left' })
        ty += 38
      })
    }
    if (item.note) {
      wrapText(item.note, cellW - 56, t => measure(t, notePx, 500)).slice(0, 2).forEach(line => {
        ops.push({ type: 'text', x: cx + 28, y: ty + 4, text: line, fontPx: notePx, weight: 500, color: INK_MUTED, align: 'left' })
        ty += 32
      })
    }
  })

  const rows = Math.ceil(items.length / cols)
  y += rows * cellH + Math.max(0, rows - 1) * gap + 24
  const remainH = usableBottom - y
  if (card.imageUrl && remainH >= 180) {
    addScreenshotWindow(ops, { src: card.imageUrl, x: PADDING, y, w: contentWidth, h: remainH, tokens, palette })
    y += remainH + 20
  } else if (remainH < 0) {
    overflow = true
  }

  if (card.callout) {
    const res = addCalloutBar(ops, { text: card.callout, y, maxBottom, contentWidth, palette, tokens, measure })
    overflow = overflow || res.overflow
  }
  return { ops, overflow }
}

function layoutGrid(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const items = (card.lines ?? []).map(line => {
    const parts = splitPipe(line)
    return parts.length >= 2 ? { title: parts[0], desc: parts.slice(1).join('：') } : { title: line, desc: '' }
  })
  const cols = 2
  const gap = 24
  const cellW = Math.floor((contentWidth - gap) / 2)
  const calloutReserve = card.callout ? 110 : 0
  const usableBottom = maxBottom - calloutReserve
  const rows = Math.ceil(items.length / cols)
  const availH = usableBottom - startY - Math.max(0, rows - 1) * gap
  const cellH = Math.max(180, Math.min(280, Math.floor(availH / Math.max(1, rows))))

  let y = startY
  let overflow = availH < rows * 180
  const titlePx = 32
  const descPx = 25

  items.forEach((item, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const isOddLast = items.length % 2 === 1 && i === items.length - 1
    const w = isOddLast ? contentWidth : cellW
    const cx = PADDING + col * (cellW + gap)
    const cy = y + row * (cellH + gap)

    ops.push({
      type: 'rect',
      x: cx,
      y: cy,
      w,
      h: cellH,
      fill: tokens.cardBg,
      stroke: tokens.cardBorder,
      lineWidth: tokens.borderWidth,
      radius: 20,
      shadow: tokens.shadow,
    })
    ops.push({ type: 'rect', x: cx + 26, y: cy + 26, w: 44, h: 44, fill: palette.tint, radius: 12 })
    ops.push({ type: 'text', x: cx + 48, y: cy + 36, text: `0${i + 1}`, fontPx: 22, weight: 800, color: palette.main, align: 'center' })

    let ty = cy + 88
    wrapText(item.title, w - 52, t => measure(t, titlePx, 700)).forEach(line => {
      ops.push({ type: 'text', x: cx + 26, y: ty, text: line, fontPx: titlePx, weight: 700, color: INK_DARK, align: 'left' })
      ty += 42
    })
    if (item.desc) {
      ty += 8
      wrapText(item.desc, w - 52, t => measure(t, descPx, 500)).forEach(line => {
        ops.push({ type: 'text', x: cx + 26, y: ty, text: line, fontPx: descPx, weight: 500, color: INK_MUTED, align: 'left' })
        ty += 36
      })
    }
    if (ty > cy + cellH - 12) overflow = true
  })

  y += rows * cellH + Math.max(0, rows - 1) * gap + 22
  if (card.callout) {
    const res = addCalloutBar(ops, { text: card.callout, y, maxBottom, contentWidth, palette, tokens, measure })
    overflow = overflow || res.overflow
  }
  return { ops, overflow }
}

function layoutList(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const items = (card.lines ?? []).map(line => {
    const parts = splitPipe(line)
    return parts.length >= 2 ? { title: parts[0], desc: parts.slice(1).join('：') } : { title: line, desc: '' }
  })
  const calloutReserve = card.callout ? 102 : 0
  const imageReserve = card.imageUrl ? 290 : 0
  const maxListH = maxBottom - calloutReserve - imageReserve - startY

  let chosen = null
  let overflow = false
  for (const itemPx of [34, 30, 27, 24]) {
    const descPx = Math.max(22, itemPx - 6)
    const lineH = Math.round(itemPx * 1.4)
    const descLineH = Math.round(descPx * 1.4)
    const padY = 20
    const gap = 16
    const innerW = contentWidth - 116
    const measured = items.map(item => {
      const tLines = wrapText(item.title, innerW, t => measure(t, itemPx, 700))
      const dLines = item.desc ? wrapText(item.desc, innerW, t => measure(t, descPx, 500)) : []
      const h = Math.max(76, padY * 2 + tLines.length * lineH + (dLines.length ? 6 + dLines.length * descLineH : 0))
      return { tLines, dLines, h }
    })
    const totalH = measured.reduce((s, m) => s + m.h, 0) + Math.max(0, measured.length - 1) * gap
    chosen = { itemPx, descPx, lineH, descLineH, padY, gap, measured, totalH }
    if (totalH <= maxListH) break
    if (itemPx === 24) overflow = true
  }

  let y = startY
  const { itemPx, descPx, lineH, descLineH, padY, gap, measured } = chosen
  measured.forEach((m, index) => {
    ops.push({
      type: 'rect',
      x: PADDING,
      y,
      w: contentWidth,
      h: m.h,
      fill: tokens.cardBg,
      stroke: tokens.cardBorder,
      lineWidth: tokens.borderWidth,
      radius: 18,
      shadow: tokens.shadow,
    })
    ops.push({ type: 'rect', x: PADDING + 24, y: y + Math.round((m.h - 48) / 2), w: 48, h: 48, fill: palette.main, radius: 24 })
    ops.push({ type: 'text', x: PADDING + 48, y: y + Math.round((m.h - 48) / 2) + 11, text: String(index + 1), fontPx: 26, weight: 800, color: WHITE, align: 'center' })

    let ty = y + padY
    m.tLines.forEach(line => {
      ops.push({ type: 'text', x: PADDING + 92, y: ty, text: line, fontPx: itemPx, weight: 700, color: INK_DARK, align: 'left' })
      ty += lineH
    })
    m.dLines.forEach((line, di) => {
      ops.push({ type: 'text', x: PADDING + 92, y: ty + (di === 0 ? 6 : 0), text: line, fontPx: descPx, weight: 500, color: INK_MUTED, align: 'left' })
      ty += descLineH + (di === 0 ? 6 : 0)
    })
    y += m.h + gap
  })

  if (card.imageUrl && maxBottom - calloutReserve - y >= 180) {
    const imgH = maxBottom - calloutReserve - y - 16
    addScreenshotWindow(ops, { src: card.imageUrl, x: PADDING, y, w: contentWidth, h: imgH, tokens, palette })
    y += imgH + 16
  }

  if (card.callout) {
    const res = addCalloutBar(ops, { text: card.callout, y, maxBottom, contentWidth, palette, tokens, measure })
    overflow = overflow || res.overflow
  }
  return { ops, overflow }
}

function layoutQuote(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const calloutReserve = 120
  const maxBoxH = maxBottom - calloutReserve - startY
  let chosen = null
  let overflow = false

  for (let fontPx = 56; fontPx >= 40; fontPx -= 4) {
    const lineH = Math.round(fontPx * 1.55)
    const paraGap = 24
    const paragraphs = (card.lines ?? []).map(line => wrapText(line, contentWidth - 110, t => measure(t, fontPx, 700)))
    const totalLines = paragraphs.reduce((s, p) => s + p.length, 0)
    const innerH = totalLines * lineH + Math.max(0, paragraphs.length - 1) * paraGap
    const boxH = Math.max(360, innerH + 170)
    chosen = { fontPx, lineH, paraGap, paragraphs, innerH, boxH }
    if (boxH <= maxBoxH) break
    if (fontPx === 40) overflow = true
  }

  const { fontPx, lineH, paraGap, paragraphs, innerH, boxH } = chosen
  const y = startY + (overflow ? 0 : Math.max(0, Math.round((maxBoxH - boxH) * 0.25)))

  ops.push({
    type: 'rect',
    x: PADDING,
    y,
    w: contentWidth,
    h: Math.min(boxH, maxBottom - calloutReserve - y),
    fill: tokens.cardBg,
    stroke: tokens.cardBorder,
    lineWidth: tokens.borderWidth,
    radius: 24,
    shadow: tokens.shadow,
  })
  ops.push({
    type: 'rect',
    x: PADDING,
    y,
    w: 12,
    h: Math.min(boxH, maxBottom - calloutReserve - y),
    fill: palette.main,
    radius: 6,
  })
  ops.push({
    type: 'text',
    x: PADDING + 44,
    y: y + 18,
    text: '“',
    fontPx: 140,
    weight: 800,
    color: palette.tint,
    align: 'left',
  })

  let qy = y + Math.max(108, Math.round((Math.min(boxH, maxBottom - calloutReserve - y) - innerH) / 2))
  paragraphs.forEach((lines, pIdx) => {
    lines.forEach((line, lIdx) => {
      if (pIdx === 0 && lIdx === lines.length - 1) {
        const lw = Math.min(contentWidth - 110, Math.round(measure(line, fontPx, 700)))
        ops.push({
          type: 'rect',
          x: PADDING + 52,
          y: Math.round(qy + fontPx * 0.68),
          w: lw + 10,
          h: Math.round(fontPx * 0.34),
          fill: palette.mark,
          radius: 5,
        })
      }
      ops.push({
        type: 'text',
        x: PADDING + 56,
        y: qy,
        text: line,
        fontPx,
        weight: 700,
        color: INK_DARK,
        align: 'left',
      })
      qy += lineH
    })
    if (pIdx < paragraphs.length - 1) qy += paraGap
  })

  const afterY = y + Math.min(boxH, maxBottom - calloutReserve - y) + 26
  const calloutRes = addCalloutBar(ops, {
    text: card.callout || '原句提炼自原文 · 建议结合上下页一起看',
    y: afterY,
    maxBottom,
    contentWidth,
    palette,
    tokens,
    measure,
  })
  return { ops, overflow: overflow || calloutRes.overflow }
}

function layoutEnd(card, ctx, measure) {
  const { contentWidth, startY, maxBottom, palette, tokens } = ctx
  const ops = []
  const items = (card.lines ?? []).map(line => {
    const parts = splitPipe(line)
    return parts.length >= 2 ? { title: parts[0], desc: parts.slice(1).join('：') } : { title: line, desc: '' }
  })
  const calloutReserve = 102
  const usableBottom = maxBottom - calloutReserve
  let y = startY
  let overflow = false

  if (items.length) {
    const titlePx = 28
    const descPx = 24
    const gap = 16
    const innerW = contentWidth - 56
    const cardsData = items.map(item => {
      const tLines = wrapText(item.title, innerW, t => measure(t, titlePx, 700))
      const dLines = item.desc ? wrapText(item.desc, innerW, t => measure(t, descPx, 400)) : []
      const h = 34 + tLines.length * 38 + (dLines.length ? 6 + dLines.length * 34 : 0)
      return { tLines, dLines, h }
    })
    const totalH = cardsData.reduce((s, d) => s + d.h, 0) + (cardsData.length - 1) * gap
    if (y + totalH > usableBottom) overflow = true

    cardsData.forEach(d => {
      ops.push({
        type: 'rect',
        x: PADDING,
        y,
        w: contentWidth,
        h: d.h,
        fill: DARK_CARD,
        stroke: DARK_BORDER,
        lineWidth: 1.5,
        radius: 16,
      })
      let cy = y + 18
      d.tLines.forEach(line => {
        ops.push({ type: 'text', x: PADDING + 28, y: cy, text: line, fontPx: titlePx, weight: 700, color: palette.mark, align: 'left' })
        cy += 38
      })
      d.dLines.forEach((line, di) => {
        ops.push({ type: 'text', x: PADDING + 28, y: cy + (di === 0 ? 6 : 0), text: line, fontPx: descPx, weight: 400, color: DARK_MUTED, align: 'left' })
        cy += 34 + (di === 0 ? 6 : 0)
      })
      y += d.h + gap
    })
  } else {
    // 无 lines 时展示大居中收束块
    const boxH = Math.min(340, usableBottom - y)
    ops.push({ type: 'rect', x: PADDING, y, w: contentWidth, h: boxH, fill: DARK_CARD, stroke: palette.main, lineWidth: 2, radius: 22 })
    ops.push({ type: 'text', x: Math.round(CARD_SIZE.width / 2), y: y + Math.round(boxH / 2) - 20, text: '欢迎收藏，欢迎在评论区交流实战体会', fontPx: 30, weight: 600, color: WHITE, align: 'center' })
    y += boxH + 24
  }

  const res = addCalloutBar(ops, {
    text: card.callout || '先收藏备用，跑通了回来交作业',
    y,
    maxBottom,
    contentWidth,
    palette,
    tokens,
    measure,
    isDark: true,
  })
  return { ops, overflow: overflow || res.overflow }
}

export function layoutCard(card, { index = 0, total = 1, palette = {}, author = '', deckStyle = 'tech' } = {}, measure) {
  const tokens = resolveStyleTokens(deckStyle, palette)
  const isDark = card.kind === 'end'
  const contentWidth = CARD_SIZE.width - PADDING * 2
  const maxBottom = CARD_SIZE.height - 122

  const ops = []
  addBackgroundAndChrome(ops, { card, index, total, palette, author, tokens, isDark })
  const startY = addHeaderBadgeAndTitle(ops, { card, index, palette, tokens, measure, contentWidth, isDark })

  const layoutCtx = { contentWidth, startY, maxBottom, palette, tokens }
  let result
  if (card.kind === 'cover') result = layoutCover(card, layoutCtx, measure)
  else if (card.kind === 'compare') result = layoutCompare(card, layoutCtx, measure)
  else if (card.kind === 'steps') result = layoutSteps(card, layoutCtx, measure)
  else if (card.kind === 'metrics') result = layoutMetrics(card, layoutCtx, measure)
  else if (card.kind === 'grid') result = layoutGrid(card, layoutCtx, measure)
  else if (card.kind === 'quote') result = layoutQuote(card, layoutCtx, measure)
  else if (card.kind === 'end') result = layoutEnd(card, layoutCtx, measure)
  else result = layoutList(card, layoutCtx, measure)

  ops.push(...result.ops)
  return { ops, overflow: result.overflow }
}
