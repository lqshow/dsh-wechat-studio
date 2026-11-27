export const DERIVE_PLATFORMS = ['thread', 'xhs']
export const THREAD_VARIANTS = ['jike', 'x']
export const MARKDOWN_TARGETS = ['zhihu', 'juejin', 'blog']
export const XHS_CARD_KINDS = ['cover', 'compare', 'steps', 'metrics', 'grid', 'list', 'quote', 'end']
export const XHS_DECK_STYLES = ['tech', 'editorial', 'bold']
export const XHS_STYLE_PRESETS = ['claude', 'editorial', 'tech', 'emerald', 'bold', 'theme']

export const DERIVE_LIMITS = {
  thread: {
    minPosts: 3,
    maxPosts: 15,
    x: { maxWeighted: 270 }, // X 预留 "12/15 " 编号空间
    jike: { maxChars: 500 },
  },
  xhs: {
    title: 20,
    body: [100, 1000],
    tags: [3, 10],
    tagChars: 15,
    cards: [5, 8],
    heading: 16,
    badge: 20,
    accent: 24,
    callout: 48,
    cardTags: [0, 4],
    cardTagChars: 12,
    cardHtml: 9000,
    pageCss: 4000,
    customCss: 4000,
    totalDeckMarkup: 48000,
    designPrompt: 400,
    referenceImages: 10,
    referenceImagesPerCard: 2,
    sharedReferenceImages: 1,
    cover: { lines: [0, 2], lineChars: 28 },
    compare: { lines: [2, 6], lineChars: 34 },
    steps: { lines: [3, 4], lineChars: 30 },
    metrics: { lines: [2, 4], lineChars: 32 },
    grid: { lines: [2, 4], lineChars: 36 },
    list: { lines: [2, 5], lineChars: 28 },
    quote: { lines: [1, 3], lineChars: 48 },
    end: { lines: [0, 5], lineChars: 36 },
  },
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/
const CARD_KINDS = new Set(XHS_CARD_KINDS)
const HEADING_REQUIRED_KINDS = new Set(['cover', 'compare', 'steps', 'metrics', 'grid', 'list'])
const fail = (message, status = 502, extra = {}) => Object.assign(new Error(message), { status }, extra)

const ALLOWED_HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'main', 'footer', 'section', 'article', 'aside', 'figure', 'figcaption', 'time',
  'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'hr', 'br',
  'img', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
])

const VOID_HTML_TAGS = new Set(['br', 'hr', 'img', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])

const ALLOWED_HTML_ATTRS = new Set([
  'class', 'style', 'src', 'alt', 'title', 'width', 'height',
  'colspan', 'rowspan', 'viewbox', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'opacity', 'transform',
])

const ALLOWED_SEMANTIC_COLORS = new Set([
  '#15803D', '#16A34A', '#E5F7ED', '#E6F7EE', '#27C93F', '#DCFCE7',
  '#E11D48', '#FFF1F0', '#FF5F56', '#FEE2E2', '#C83E31',
  '#FFBD2E', '#FACC15', '#FFF09E', '#FFF3B0', '#FFF3A1', '#FEF9C3',
])

const DATA_IMAGE_URI_RE = /data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/gi

export function htmlMarkupLength(text) {
  if (typeof text !== 'string' || !text) return 0
  // 本地上传的 base64 截图体积大但不属于 HTML 标签预算，按 64 字符占位计入结构预算
  return text.replace(DATA_IMAGE_URI_RE, 'data:image/local;base64,placeholder').length
}

export function sanitizeReferenceImages(list, { maxCount = 3, maxChars = 650_000 } = {}) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (out.length >= maxCount) break
    const raw = typeof item === 'string' ? item.trim() : typeof item?.dataUrl === 'string' ? item.dataUrl.trim() : ''
    if (!raw || raw.length > maxChars) continue
    const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(raw)
    if (!match) continue
    const mediaType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
    out.push(`data:${mediaType};base64,${match[2]}`)
  }
  return out
}

export function normalizeXhsReferencePlan(rawPlan, { cards = [], referenceImageIds = [] } = {}) {
  if (!rawPlan || typeof rawPlan !== 'object') return null
  const uploadedIds = Array.isArray(referenceImageIds) && referenceImageIds.length
    ? new Set(referenceImageIds)
    : null
  const images = []
  const roles = new Map()
  for (const item of Array.isArray(rawPlan.images) ? rawPlan.images : []) {
    const id = typeof item?.id === 'string' ? item.id : ''
    const role = item?.role
    if (!/^ref-(?:[1-9]|10)$/.test(id) || !['cover', 'content', 'style'].includes(role)) continue
    if (uploadedIds && !uploadedIds.has(id)) continue
    if (roles.has(id)) continue
    const reason = typeof item.reason === 'string'
      ? item.reason.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 120)
      : ''
    images.push({ id, role, reason })
    roles.set(id, role)
  }
  if (!images.length) return null

  const sharedImageIds = []
  for (const id of Array.isArray(rawPlan.sharedImageIds) ? rawPlan.sharedImageIds : []) {
    if (roles.get(id) !== 'style' || sharedImageIds.includes(id)) continue
    if (sharedImageIds.length >= DERIVE_LIMITS.xhs.sharedReferenceImages) break
    sharedImageIds.push(id)
  }

  const pagesByNumber = new Map()
  for (const item of Array.isArray(rawPlan.pages) ? rawPlan.pages : []) {
    const page = item?.page
    if (!Number.isInteger(page) || page < 1 || page > cards.length) continue
    for (const id of Array.isArray(item.imageIds) ? item.imageIds : []) {
      const role = roles.get(id)
      if (!role || (role === 'cover' && page !== 1) || (role === 'content' && page === 1)) continue
      const entry = pagesByNumber.get(page) ?? { page, imageIds: [] }
      if (entry.imageIds.includes(id)) continue
      if (entry.imageIds.length >= DERIVE_LIMITS.xhs.referenceImagesPerCard) continue
      entry.imageIds.push(id)
      pagesByNumber.set(page, entry)
    }
  }
  const pages = [...pagesByNumber.values()].filter(item => item.imageIds.length).sort((a, b) => a.page - b.page)
  return { images, sharedImageIds, pages }
}

export function selectXhsReferenceImages(referenceImages, referencePlan, cardIndex) {
  if (!Array.isArray(referenceImages) || !referencePlan) return []
  const page = referencePlan.pages?.find(item => item.page === cardIndex + 1)
  const ids = [...(referencePlan.sharedImageIds ?? []), ...(page?.imageIds ?? [])]
  const seen = new Set()
  const selected = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const match = /^ref-(?:[1-9]|10)$/.exec(id)
    if (!match) continue
    const index = Number(id.slice(4)) - 1
    const item = referenceImages[index]
    const dataUrl = typeof item === 'string' ? item : item?.dataUrl
    if (typeof dataUrl !== 'string' || !dataUrl) continue
    selected.push({ id, dataUrl })
  }
  return selected
}

export function parseDataImageUri(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl ?? '').trim())
  if (!match) return null
  const mediaType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  return { mediaType, data: match[2] }
}

export function sanitizeCardImageUrl(url) {
  if (typeof url !== 'string') return ''
  const s = url.trim()
  if (!s) return ''
  if (
    s.startsWith('https://') ||
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(s) ||
    s.startsWith('wechat-studio/') ||
    s.startsWith('blob:') ||
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(s)
  ) {
    return s
  }
  return ''
}

export function sanitizeInlineStyle(rawStyle) {
  if (typeof rawStyle !== 'string' || !rawStyle.trim()) return ''
  const dangerous = /(?:url\s*\(|image-set\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|@import|<\/style|<script|data:text\/html)/i
  const parts = rawStyle.split(';')
  const kept = []
  for (const part of parts) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim()
    let val = part.slice(idx + 1).trim()
    if (!prop || !val) continue
    if (!/^(?:--[a-z0-9-]+|[a-z-]+)$/i.test(prop)) continue
    if (dangerous.test(prop) || dangerous.test(val)) continue
    if (prop.toLowerCase() === 'position' && /^fixed\b/i.test(val)) {
      val = val.replace(/^fixed\b/i, 'absolute')
    }
    kept.push(`${prop}:${val}`)
  }
  return kept.join(';')
}

export function sanitizeXhsCss(rawCss, { scope = '.xhs-artboard', maxChars = DERIVE_LIMITS.xhs.customCss } = {}) {
  if (typeof rawCss !== 'string' || !rawCss.trim()) return ''
  let s = rawCss
    .replace(/\u0000/g, '')
    .replace(/<\/?style\b[^>]*>/gi, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // 剥离带语句的 at-rules（@import / @charset / @namespace）
    .replace(/@(?:import|charset|namespace)\b[^;]*;?/gi, '')
    // 剥离带块的危险/外部 at-rules（@font-face / @keyframes / @media / @supports 等）
    .replace(/@[a-z-]+\b[^{;]*\{(?:[^{}]*|\{[^{}]*\})*\}/gi, '')

  const rules = []
  let totalLen = 0
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = ruleRe.exec(s)) !== null) {
    const rawSelectors = match[1].trim()
    const rawBody = match[2].trim()
    if (!rawSelectors || !rawBody) continue
    if (rawSelectors.startsWith('@')) continue
    const cleanDecls = sanitizeInlineStyle(rawBody)
    if (!cleanDecls) continue

    const scopedList = []
    for (const part of rawSelectors.split(',')) {
      const sel = part.trim()
      if (!sel || sel.includes('<')) continue
      if (/^(?:html|body|:root|:host)$/i.test(sel)) {
        scopedList.push(scope)
      } else if (sel === '*') {
        scopedList.push(`${scope} *`)
      } else if (/^(?:html|body|:root|:host)\s+/i.test(sel)) {
        scopedList.push(`${scope} ${sel.replace(/^(?:html|body|:root|:host)\s+/i, '')}`)
      } else if (sel.startsWith(scope)) {
        scopedList.push(sel)
      } else {
        scopedList.push(`${scope} ${sel}`)
      }
    }
    if (!scopedList.length) continue
    const ruleText = `${scopedList.join(', ')} { ${cleanDecls.replace(/;/g, '; ')}; }`
    if (totalLen + ruleText.length + 1 > maxChars) break
    rules.push(ruleText)
    totalLen += ruleText.length + 1
  }
  return rules.join('\n').trim()
}

export function sanitizeXhsCardHtml(rawHtml) {
  if (typeof rawHtml !== 'string') return ''
  let s = rawHtml.replace(/\u0000/g, '').trim()
  if (!s) return ''
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|xhs[-_]page[-_]style|xhs[-_]style|iframe|object|embed|form|frameset|applet|base|meta|link|foreignobject|noscript|template)\b[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
    // 若模型被截断导致 <style>/<xhs-page-style> 未闭合，连同其后未闭合样式块一并剥离
    .replace(/<(style|xhs[-_]page[-_]style|xhs[-_]style)\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<(script|style|xhs[-_]page[-_]style|xhs[-_]style|iframe|object|embed|form|frameset|applet|base|meta|link|foreignobject|noscript|template|input|button|textarea|select)\b[^>]*\/?>/gi, '')
    .trim()

  // 防御兜底：若 HTML 开头意外残留了未包裹在标签内的裸 CSS 规则（如 ".xhs-artboard .p2-duel { display:grid; }"），在第一个 HTML 标签前剥离
  const firstTagIdx = s.indexOf('<')
  if (firstTagIdx > 0) {
    const leadingText = s.slice(0, firstTagIdx)
    if (/(?:^|\s)[.#a-zA-Z_-][^{}<>]*\{[^{}<>]*:[^{}<>]*\}/.test(leadingText)) {
      const cleanedPrefix = leadingText.replace(/[.#@a-zA-Z0-9_:*[\]="',>+~\-\s()]+\{[^{}]*\}/g, '').trim()
      s = `${cleanedPrefix ? `${cleanedPrefix}\n` : ''}${s.slice(firstTagIdx)}`
    }
  }

  // 严格标签与属性白名单重写
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?(\/?)>/g, (full, slash, tagName, rawAttrs = '', selfClose = '') => {
    const lowerTag = tagName.toLowerCase()
    if (!ALLOWED_HTML_TAGS.has(lowerTag)) return ''
    if (slash) return `</${lowerTag}>`

    const cleanAttrs = []
    const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    let m
    while ((m = attrRe.exec(rawAttrs)) !== null) {
      const attrName = m[1]
      const lowerAttr = attrName.toLowerCase()
      const val = m[2] ?? m[3] ?? m[4] ?? ''
      if (lowerAttr.startsWith('on')) continue
      const allowed = ALLOWED_HTML_ATTRS.has(lowerAttr) || /^data-(?:xhs|img)-[a-z0-9-]+$/i.test(lowerAttr)
      if (!allowed) continue

      if (lowerAttr === 'src') {
        if (lowerTag !== 'img') continue
        const safeUrl = sanitizeCardImageUrl(val)
        if (!safeUrl) continue
        cleanAttrs.push(`src="${safeUrl.replace(/"/g, '&quot;')}"`)
      } else if (lowerAttr === 'style') {
        const safeStyle = sanitizeInlineStyle(val)
        if (!safeStyle) continue
        cleanAttrs.push(`style="${safeStyle.replace(/"/g, '&quot;')}"`)
      } else {
        const safeVal = String(val).replace(/[<>"]/g, '').replace(CONTROL_CHARS, '')
        const emitName = lowerAttr === 'viewbox' ? 'viewBox' : lowerAttr
        cleanAttrs.push(`${emitName}="${safeVal}"`)
      }
    }
    const attrText = cleanAttrs.length ? ` ${cleanAttrs.join(' ')}` : ''
    const closing = selfClose || VOID_HTML_TAGS.has(lowerTag) ? ' /' : ''
    return `<${lowerTag}${attrText}${closing}>`
  })

  if (htmlMarkupLength(s) > DERIVE_LIMITS.xhs.cardHtml) {
    // 若非 base64 的 HTML 标签文本仍超过预算，仅在不含 data:image 截断风险时按上限裁剪
    const placeholders = []
    const masked = s.replace(DATA_IMAGE_URI_RE, uri => {
      const token = `__XHS_DATA_URI_${placeholders.length}__`
      placeholders.push(uri)
      return token
    })
    let trimmed = masked.slice(0, DERIVE_LIMITS.xhs.cardHtml)
    const lastClose = trimmed.lastIndexOf('>')
    if (lastClose > DERIVE_LIMITS.xhs.cardHtml * 0.5) {
      trimmed = trimmed.slice(0, lastClose + 1)
    }
    s = trimmed.replace(/__XHS_DATA_URI_(\d+)__/g, (_, idx) => placeholders[Number(idx)] ?? '')
  }

  return s.trim()
}

export function findHardcodedBrandColors(text) {
  if (typeof text !== 'string' || !text) return []
  const cleaned = text.replace(DATA_IMAGE_URI_RE, '').replace(/\bsrc\s*=\s*"[^"]*"/gi, '')
  const found = new Set()
  const re = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g
  let m
  while ((m = re.exec(cleaned)) !== null) {
    let hex = m[1].toUpperCase()
    if (hex.length === 3) hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    const full = `#${hex}`
    if (ALLOWED_SEMANTIC_COLORS.has(full)) continue
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    // 中性灰黑/暖纸白（色差 ≤ 18）允许直接写死
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 18) continue
    found.add(full)
  }
  return [...found]
}

export function computeDomTopologySignature(html) {
  if (typeof html !== 'string' || !html.trim()) return ''
  const s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DATA_IMAGE_URI_RE, '')

  const landmarks = new Set()
  if (/<table\b/i.test(s)) landmarks.add('table')
  if (/<img\b|data-xhs-slot="image"/i.test(s)) landmarks.add('media')
  if (/<(?:ul|ol)\b/i.test(s)) landmarks.add('list')
  if (/<blockquote\b/i.test(s)) landmarks.add('quote')
  if (/<(?:pre|code)\b/i.test(s)) landmarks.add('code')
  const gridMatch = /grid-template-columns\s*:\s*repeat\(\s*(\d+)/i.exec(s) || /--cols\s*:\s*(\d+)/i.exec(s)
  if (gridMatch) landmarks.add(`grid${gridMatch[1]}`)
  else if (/display\s*:\s*grid/i.test(s)) landmarks.add('grid')

  const STRUCT_TAGS = new Set(['div', 'table', 'tr', 'ul', 'ol', 'li', 'blockquote', 'pre', 'img', 'h1', 'h2', 'h3', 'p', 'svg'])
  const root = { tag: 'root', children: [] }
  const stack = [root]
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g
  let m
  while ((m = tagRe.exec(s)) !== null) {
    const isClose = Boolean(m[1])
    const tag = m[2].toLowerCase()
    const isSelf = Boolean(m[3]) || VOID_HTML_TAGS.has(tag)
    if (!STRUCT_TAGS.has(tag)) continue
    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) {
        stack.pop()
      }
      continue
    }
    const node = { tag, children: [] }
    if (stack.length <= 5) {
      stack[stack.length - 1].children.push(node)
    }
    if (!isSelf && stack.length <= 5) {
      stack.push(node)
    }
  }

  function serializeNode(node, depth = 0) {
    if (depth >= 4 || !node.children.length) return node.tag
    const collapsed = []
    for (const child of node.children) {
      const sig = serializeNode(child, depth + 1)
      const prev = collapsed[collapsed.length - 1]
      if (prev && prev.sig === sig) {
        prev.count += 1
      } else {
        collapsed.push({ sig, count: 1 })
      }
    }
    const inner = collapsed.map(item => (item.count > 1 ? `${item.sig}+` : item.sig)).join(',')
    return `${node.tag}(${inner})`
  }

  const lm = [...landmarks].sort().join('|')
  return `${lm ? `[${lm}]` : ''}${serializeNode(root, 0)}`
}

export function cardContentVersion(card) {
  const payload = JSON.stringify({
    kind: card?.kind ?? '',
    heading: card?.heading ?? '',
    badge: card?.badge ?? '',
    accent: card?.accent ?? '',
    callout: card?.callout ?? '',
    lines: Array.isArray(card?.lines) ? card.lines : [],
    tags: Array.isArray(card?.tags) ? card.tags : [],
    imageUrl: card?.imageUrl ?? '',
    html: card?.html ?? '',
    pageCss: card?.pageCss ?? '',
  })
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

function parseTagAttributes(rawAttrs) {
  const attrs = {}
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m
  while ((m = re.exec(String(rawAttrs || ''))) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

function extractFallbackHeadingAndLinesFromHtml(html) {
  const headingMatch = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(html)
  const heading = headingMatch ? stripHtmlToText(headingMatch[1]).slice(0, 16) : stripHtmlToText(html).slice(0, 14)
  const lines = []
  const blockRe = /<(?:p|li|td|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|td|blockquote)>/gi
  let m
  while ((m = blockRe.exec(html)) !== null && lines.length < 4) {
    const txt = stripHtmlToText(m[1]).slice(0, 48)
    if (txt && txt !== heading && !lines.includes(txt)) lines.push(txt)
  }
  return { heading, lines }
}

function nextNonSpaceIndex(str, fromIndex) {
  let i = fromIndex
  while (i < str.length && /[\s\r\n\t]/.test(str[i])) i += 1
  return i
}

function isLikelyClosingQuote(str, quoteIndex, containerStack, expectingKey) {
  const nextIdx = nextNonSpaceIndex(str, quoteIndex + 1)
  if (nextIdx >= str.length) return true
  const nextCh = str[nextIdx]

  const topContainer = containerStack[containerStack.length - 1]
  if (topContainer === '{' && expectingKey) {
    return nextCh === ':'
  }

  if (nextCh === '}' || nextCh === ']') return true
  if (nextCh !== ',') return false

  const afterCommaIdx = nextNonSpaceIndex(str, nextIdx + 1)
  if (afterCommaIdx >= str.length) return true
  const afterCommaCh = str[afterCommaIdx]

  if (topContainer === '{') {
    return afterCommaCh === '"' || afterCommaCh === '}'
  }
  if (topContainer === '[') {
    return /["{\[\-0-9tfn\]]/.test(afterCommaCh)
  }
  return true
}

export function repairLooseJson(raw) {
  const s = String(raw ?? '').trim()
  let out = ''
  let inString = false
  let escaped = false
  const containerStack = []
  let expectingKey = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
      } else if (ch === '\\') {
        out += ch
        escaped = true
      } else if (ch === '"') {
        if (isLikelyClosingQuote(s, i, containerStack, expectingKey)) {
          out += '"'
          inString = false
        } else {
          out += '\\"'
        }
      } else if (ch === '\n') {
        out += '\\n'
      } else if (ch === '\r') {
        // 忽略裸 \r
      } else if (ch === '\t') {
        out += '\\t'
      } else {
        out += ch
      }
    } else {
      if (ch === '"') {
        inString = true
        out += ch
      } else if (ch === '{') {
        containerStack.push('{')
        expectingKey = true
        out += ch
      } else if (ch === '[') {
        containerStack.push('[')
        expectingKey = false
        out += ch
      } else if (ch === '}' || ch === ']') {
        containerStack.pop()
        expectingKey = false
        out += ch
      } else if (ch === ':') {
        expectingKey = false
        out += ch
      } else if (ch === ',') {
        const top = containerStack[containerStack.length - 1]
        expectingKey = top === '{'
        out += ch
      } else {
        out += ch
      }
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

export function extractBalancedJsonSlice(raw) {
  const s = String(raw ?? '')
  const start = s.search(/[{[]/)
  if (start === -1) return ''
  const openChar = s[start]
  const closeChar = openChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  const containerStack = []
  let expectingKey = false

  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        if (isLikelyClosingQuote(s, i, containerStack, expectingKey)) {
          inString = false
        }
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      containerStack.push('{')
      expectingKey = true
      if (openChar === '{') depth += 1
    } else if (ch === '[') {
      containerStack.push('[')
      expectingKey = false
      if (openChar === '[') depth += 1
    } else if (ch === '}') {
      containerStack.pop()
      expectingKey = false
      if (openChar === '{') {
        depth -= 1
        if (depth === 0) return s.slice(start, i + 1)
      }
    } else if (ch === ']') {
      containerStack.pop()
      expectingKey = false
      if (openChar === '[') {
        depth -= 1
        if (depth === 0) return s.slice(start, i + 1)
      }
    } else if (ch === ':') {
      expectingKey = false
    } else if (ch === ',') {
      const top = containerStack[containerStack.length - 1]
      expectingKey = top === '{'
    }
  }
  const lastEnd = s.lastIndexOf(closeChar)
  return lastEnd > start ? s.slice(start, lastEnd + 1) : ''
}

function parseLooseJsonBlock(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  if (!s) return null
  const balanced = extractBalancedJsonSlice(s)
  const candidates = [balanced, s].filter(Boolean)
  for (const cand of candidates) {
    try {
      return JSON.parse(cand)
    } catch {
      try {
        return JSON.parse(repairLooseJson(cand))
      } catch {
        // 尝试下一个候选
      }
    }
  }
  return null
}

export function parseSingleXhsCardMarkup(rawText) {
  const source = String(rawText ?? '').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim()
  const cardMatch = /<xhs[-_]card\b([^>]*)>([\s\S]*?)<\/xhs[-_]card>/i.exec(source)
  if (!cardMatch) return null
  const cssBlocks = []
  for (const m of source.matchAll(/<xhs[-_]page[-_]style\b[^>]*>([\s\S]*?)<\/xhs[-_]page[-_]style>/gi)) {
    if (m[1]?.trim()) cssBlocks.push(m[1].trim())
  }
  const attrs = parseTagAttributes(cardMatch[1])
  const html = cardMatch[2].trim()
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[1]?.trim()) cssBlocks.push(m[1].trim())
  }
  const derived = extractFallbackHeadingAndLinesFromHtml(html)
  const card = {
    kind: attrs.kind || 'list',
    heading: (attrs.heading || derived.heading || '').trim(),
    lines: attrs.lines
      ? attrs.lines.split(/\s*;;\s*/).map(s => s.trim()).filter(Boolean)
      : derived.lines,
    source: attrs.source ? attrs.source.split(/[\s,，]+/).map(s => s.trim()).filter(Boolean) : [],
    html,
  }
  if (attrs.badge) card.badge = attrs.badge.trim()
  if (attrs.accent) card.accent = attrs.accent.trim()
  if (attrs.callout) card.callout = attrs.callout.trim()
  if (attrs.tags) card.tags = attrs.tags.split(/[\s,，、|｜]+/).map(s => s.trim()).filter(Boolean)
  if (attrs.image || attrs.imageurl) card.imageUrl = (attrs.image || attrs.imageurl).trim()
  if (attrs.layoutarchetype || attrs.archetype) card.layoutArchetype = (attrs.layoutarchetype || attrs.archetype).trim()
  if (cssBlocks.length) card.pageCss = cssBlocks.join('\n')
  return card
}

export function parseXhsDeckMarkup(rawText) {
  const source = String(rawText ?? '').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim()
  if (!/<xhs[-_](?:meta|card|style)\b/i.test(source)) return null

  const metaMatch = /<xhs[-_]meta\b[^>]*>([\s\S]*?)(?:<\/xhs[-_]meta>|(?=<xhs[-_](?:style|card|page[-_]style)\b)|$)/i.exec(source)
  const meta = metaMatch ? parseLooseJsonBlock(metaMatch[1]) : null
  const styleMatch = /<xhs[-_]style\b[^>]*>([\s\S]*?)(?:<\/xhs[-_]style>|(?=<xhs[-_](?:meta|card|page[-_]style)\b)|$)/i.exec(source)
  const customCss = styleMatch ? styleMatch[1].trim() : ''

  const pageCssMap = new Map()
  const pageStyleRe = /<xhs[-_]page[-_]style\b([^>]*)>([\s\S]*?)<\/xhs[-_]page[-_]style>/gi
  let psMatch
  while ((psMatch = pageStyleRe.exec(source)) !== null) {
    const attrs = parseTagAttributes(psMatch[1])
    const pageNo = Number(attrs.page || attrs.index)
    if (Number.isInteger(pageNo) && pageNo >= 1) {
      pageCssMap.set(pageNo, psMatch[2].trim())
    }
  }

  const cards = []
  const cardRe = /<xhs[-_]card\b([^>]*)>([\s\S]*?)<\/xhs[-_]card>/gi
  let cMatch
  while ((cMatch = cardRe.exec(source)) !== null) {
    const attrs = parseTagAttributes(cMatch[1])
    const html = cMatch[2].trim()
    const pageNo = Number(attrs.page || attrs.index) || (cards.length + 1)
    const derived = extractFallbackHeadingAndLinesFromHtml(html)
    const card = {
      kind: attrs.kind || (cards.length === 0 ? 'cover' : 'list'),
      heading: (attrs.heading || derived.heading || '').trim(),
      lines: attrs.lines
        ? attrs.lines.split(/\s*;;\s*/).map(s => s.trim()).filter(Boolean)
        : derived.lines,
      source: attrs.source ? attrs.source.split(/[\s,，]+/).map(s => s.trim()).filter(Boolean) : [],
      html,
    }
    if (attrs.badge) card.badge = attrs.badge.trim()
    if (attrs.accent) card.accent = attrs.accent.trim()
    if (attrs.callout) card.callout = attrs.callout.trim()
    if (attrs.tags) card.tags = attrs.tags.split(/[\s,，、|｜]+/).map(s => s.trim()).filter(Boolean)
    if (attrs.image || attrs.imageurl) card.imageUrl = (attrs.image || attrs.imageurl).trim()
    if (attrs.layoutarchetype || attrs.archetype) card.layoutArchetype = (attrs.layoutarchetype || attrs.archetype).trim()
    const pCss = pageCssMap.get(pageNo)
    if (pCss) card.pageCss = pCss
    cards.push(card)
  }

  if (!meta && !cards.length) return null
  const base = meta && typeof meta === 'object' ? { ...meta } : {}
  if (cards.length) base.cards = cards
  if (customCss) base.customCss = customCss
  return base
}

export function stripHtmlToText(html) {
  if (typeof html !== 'string' || !html) return ''
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LEGACY_PRESET_MAP = {
  manual: 'editorial',
  notebook: 'editorial',
  chalkboard: 'emerald',
}

export function normalizeXhsTweaks(rawTweaks) {
  if (!rawTweaks || typeof rawTweaks !== 'object') return null
  const out = {}
  if (typeof rawTweaks.preset === 'string') {
    const mapped = LEGACY_PRESET_MAP[rawTweaks.preset] || rawTweaks.preset
    if (XHS_STYLE_PRESETS.includes(mapped)) {
      out.preset = mapped
    }
  }
  for (const key of ['accent', 'surface', 'cardBg', 'ink']) {
    if (typeof rawTweaks[key] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(rawTweaks[key].trim())) {
      out[key] = rawTweaks[key].trim()
    }
  }
  if (typeof rawTweaks.scale === 'number' && Number.isFinite(rawTweaks.scale)) {
    out.scale = Math.min(1.35, Math.max(0.75, Number(rawTweaks.scale.toFixed(2))))
  }
  if (typeof rawTweaks.density === 'number' && Number.isFinite(rawTweaks.density)) {
    out.density = Math.min(1.35, Math.max(0.75, Number(rawTweaks.density.toFixed(2))))
  }
  if (typeof rawTweaks.radius === 'number' && Number.isFinite(rawTweaks.radius)) {
    out.radius = Math.min(40, Math.max(0, Math.round(rawTweaks.radius)))
  }
  if (typeof rawTweaks.font === 'string' && ['noto', 'pingfang', 'serif', 'mono'].includes(rawTweaks.font)) {
    out.font = rawTweaks.font
  }
  return Object.keys(out).length ? out : null
}

export function normalizeCardImageFraming(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  if (typeof raw.fit === 'string' && ['cover', 'contain', 'fill'].includes(raw.fit)) {
    out.fit = raw.fit
  }
  if (typeof raw.posX === 'number' && Number.isFinite(raw.posX)) {
    out.posX = Math.max(0, Math.min(100, Math.round(raw.posX)))
  }
  if (typeof raw.posY === 'number' && Number.isFinite(raw.posY)) {
    out.posY = Math.max(0, Math.min(100, Math.round(raw.posY)))
  }
  if (typeof raw.zoom === 'number' && Number.isFinite(raw.zoom)) {
    out.zoom = Math.max(50, Math.min(250, Math.round(raw.zoom)))
  }
  if (typeof raw.panX === 'number' && Number.isFinite(raw.panX)) {
    out.panX = Math.max(-400, Math.min(400, Math.round(raw.panX)))
  }
  if (typeof raw.panY === 'number' && Number.isFinite(raw.panY)) {
    out.panY = Math.max(-400, Math.min(400, Math.round(raw.panY)))
  }
  return Object.keys(out).length ? out : null
}

export function charCount(text) {
  return [...String(text ?? '')].length
}

function isSingleWeightCodePoint(cp) {
  return (cp >= 0x0000 && cp <= 0x10ff) ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
}

export function weightedLength(text) {
  const input = String(text ?? '')
  const urlPattern = /https?:\/\/\S+/g
  let total = 0
  let cursor = 0
  for (const match of input.matchAll(urlPattern)) {
    const segment = input.slice(cursor, match.index)
    for (const ch of segment) total += isSingleWeightCodePoint(ch.codePointAt(0)) ? 1 : 2
    total += 23
    cursor = match.index + match[0].length
  }
  for (const ch of input.slice(cursor)) total += isSingleWeightCodePoint(ch.codePointAt(0)) ? 1 : 2
  return total
}

export function numberTokens(text) {
  return (String(text ?? '').match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).map(token => token.replace(/,/g, ''))
}

export function unsupportedFacts(text, sourceText) {
  const sourceSet = new Set(numberTokens(sourceText))
  const seen = new Set()
  const out = []
  for (const token of numberTokens(text)) {
    if (/^(?:[1-9]|10)$/.test(token)) continue
    if (!sourceSet.has(token) && !seen.has(token)) {
      seen.add(token)
      out.push(token)
    }
  }
  return out
}

function cleanBigrams(text) {
  return [...String(text ?? '').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()]
}

export function sourceOverlap(text, sourceText) {
  const chars = cleanBigrams(text)
  if (chars.length < 2) return 1
  const srcChars = cleanBigrams(sourceText)
  if (srcChars.length < 2) return 0
  const srcSet = new Set()
  for (let i = 0; i < srcChars.length - 1; i++) srcSet.add(srcChars[i] + srcChars[i + 1])
  let hits = 0
  for (let i = 0; i < chars.length - 1; i++) {
    if (srcSet.has(chars[i] + chars[i + 1])) hits += 1
  }
  return hits / (chars.length - 1)
}

function filterSourceIds(rawSource, validIds) {
  if (!Array.isArray(rawSource) || !validIds.size) return []
  const out = []
  const seen = new Set()
  for (const id of rawSource) {
    if (typeof id === 'string' && validIds.has(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

function stripThreadPrefix(text) {
  return text.replace(/^\s*(?:[（(\[]\s*\d+\s*\/\s*\d+\s*[）)\]][:：\s]*|\d+\s*\/\s*\d+(?:[:：]\s*|\s+))/, '')
}

export function normalizeThread(raw, { variant = 'jike', blockIds = [], sourceText = '', status = 502 } = {}) {
  if (!THREAD_VARIANTS.includes(variant)) {
    throw fail(`不支持的串推平台：${variant}（可选：${THREAD_VARIANTS.join('、')}）。`, 400)
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.posts)) {
    throw fail('串推格式无效，必须包含 posts 数组。', status)
  }
  const { minPosts, maxPosts, x, jike } = DERIVE_LIMITS.thread
  if (raw.posts.length < minPosts) {
    throw fail(`串推至少需要 ${minPosts} 条（当前 ${raw.posts.length} 条）。`, status)
  }
  if (raw.posts.length > maxPosts) {
    throw fail(`串推最多 ${maxPosts} 条（当前 ${raw.posts.length} 条）。`, status)
  }

  const validIds = new Set(blockIds)
  const posts = []
  const warnings = []
  const errors = []

  raw.posts.forEach((item, index) => {
    const no = index + 1
    if (!item || typeof item !== 'object' || typeof item.text !== 'string') {
      errors.push(`第 ${no} 条串推缺少文本内容`)
      return
    }
    if (CONTROL_CHARS.test(item.text)) {
      errors.push(`第 ${no} 条串推包含不允许的控制字符`)
      return
    }
    const text = stripThreadPrefix(item.text.replace(/\r\n/g, '\n')).trim()
    if (!text) {
      errors.push(`第 ${no} 条串推内容为空`)
      return
    }
    if (variant === 'x') {
      const len = weightedLength(text)
      if (len > x.maxWeighted) {
        errors.push(`第 ${no} 条串推超出 X 加权字数上限 ${x.maxWeighted}（当前 ${len}）`)
        return
      }
    } else {
      const len = charCount(text)
      if (len > jike.maxChars) {
        errors.push(`第 ${no} 条串推超出即刻字数上限 ${jike.maxChars}（当前 ${len}）`)
        return
      }
    }

    const source = filterSourceIds(item.source, validIds)
    posts.push({ text, source })

    if (sourceText) {
      const badFacts = unsupportedFacts(text, sourceText)
      if (badFacts.length) {
        warnings.push(`第 ${no} 条出现原文没有的数字：${badFacts.join('、')}`)
      }
    }
    if (validIds.size > 0 && index > 0 && index < raw.posts.length - 1 && source.length === 0) {
      warnings.push(`第 ${no} 条没有标注来源段落`)
    }
  })

  if (errors.length) {
    throw fail(`${errors.join('；')}。`, status, { issues: errors })
  }

  return { variant, posts, warnings }
}

export function enforceXhsDarkSurfaceContrast(html, css) {
  const source = String(css || '').trim()
  const additions = []
  const seen = new Set()
  const addContrastRule = selectorText => {
    for (const part of String(selectorText || '').split(',')) {
      const selector = part.trim()
      if (!selector || seen.has(selector)) continue
      seen.add(selector)
      const rule = `${selector}, ${selector} * { color: #FFFFFF !important; }`
      if (!source.includes(rule)) additions.push(rule)
    }
  }

  if (/background(?:-color)?\s*:\s*var\(--xhs-dark\)/i.test(String(html || ''))) {
    addContrastRule('.xhs-artboard [style*="var(--xhs-dark)"]')
  }
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/background(?:-color)?\s*:\s*var\(--xhs-dark\)/i.test(match[2])) {
      addContrastRule(match[1])
    }
  }
  return [source, ...additions].filter(Boolean).join('\n')
}

export function normalizeXhs(raw, { blockIds = [], sourceText = '', status = 502, strictCardLength = true, referenceImageIds = [] } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw fail('小红书格式无效，必须是 JSON 对象。', status)
  }
  const limits = DERIVE_LIMITS.xhs

  if (typeof raw.title !== 'string') throw fail('小红书缺少标题（title）。', status)
  if (typeof raw.body !== 'string') throw fail('小红书缺少正文（body）。', status)
  if (!Array.isArray(raw.tags)) throw fail('小红书标签（tags）必须是字符串数组。', status)
  if (!Array.isArray(raw.cards)) throw fail('小红书卡片（cards）必须是数组。', status)
  if (raw.cards.length < limits.cards[0] || raw.cards.length > limits.cards[1]) {
    throw fail(`小红书卡片需为 ${limits.cards[0]}–${limits.cards[1]} 页（当前 ${raw.cards.length} 页）。`, status)
  }

  const errors = []
  const warnings = []

  let title = ''
  if (CONTROL_CHARS.test(raw.title)) {
    errors.push('小红书标题包含不允许的控制字符')
  } else {
    title = raw.title.replace(/#/g, '').replace(/[\r\n]+/g, ' ').trim()
    const titleLen = charCount(title)
    if (titleLen < 1 || titleLen > limits.title) {
      errors.push(`小红书标题需为 1–${limits.title} 字（当前 ${titleLen} 字）`)
    }
  }

  let body = ''
  if (CONTROL_CHARS.test(raw.body)) {
    errors.push('小红书正文包含不允许的控制字符')
  } else {
    body = raw.body.replace(/\r\n/g, '\n').trim()
    const bodyLen = charCount(body)
    const hardBodyMax = limits.body[1] * 2
    if (bodyLen > hardBodyMax) {
      errors.push(`小红书正文超出 ${hardBodyMax} 字硬上限（当前 ${bodyLen} 字）`)
    } else if (bodyLen > limits.body[1]) {
      if (strictCardLength) {
        errors.push(`小红书正文超出 ${limits.body[1]} 字上限（当前 ${bodyLen} 字）`)
      } else {
        warnings.push(`正文偏长（${bodyLen} 字，建议 ${limits.body[0]}–${limits.body[1]} 字），可在右侧「笔记文案」中精简`)
      }
    } else if (bodyLen < 20) {
      errors.push(`小红书正文过短，至少需要 20 字（当前 ${bodyLen} 字）`)
    } else if (bodyLen < limits.body[0]) {
      if (strictCardLength) {
        errors.push(`小红书正文需为 ${limits.body[0]}–${limits.body[1]} 字（当前 ${bodyLen} 字）`)
      } else {
        warnings.push(`正文偏短（${bodyLen} 字，建议 ${limits.body[0]}–${limits.body[1]} 字）`)
      }
    }
  }

  const tags = []
  const seenTags = new Set()
  raw.tags.forEach((rawTag, index) => {
    if (typeof rawTag !== 'string') {
      errors.push(`第 ${index + 1} 个标签必须是文本`)
      return
    }
    if (CONTROL_CHARS.test(rawTag)) {
      errors.push(`第 ${index + 1} 个标签包含不允许的控制字符`)
      return
    }
    const tag = rawTag.replace(/[#\s]+/g, '')
    if (!tag) return
    if (charCount(tag) > limits.tagChars) {
      errors.push(`标签「${tag}」超出 ${limits.tagChars} 字上限（当前 ${charCount(tag)} 字）`)
      return
    }
    if (!seenTags.has(tag)) {
      seenTags.add(tag)
      tags.push(tag)
    }
  })
  if (tags.length < limits.tags[0] || tags.length > limits.tags[1]) {
    errors.push(`小红书标签需为 ${limits.tags[0]}–${limits.tags[1]} 个（当前 ${tags.length} 个）`)
  }

  const validIds = new Set(blockIds)
  const cards = []

  if (sourceText && title && body) {
    const bodyFacts = unsupportedFacts(`${title}\n${body}`, sourceText)
    if (bodyFacts.length) {
      warnings.push(`标题或正文出现原文没有的数字：${bodyFacts.join('、')}`)
    }
  }

  raw.cards.forEach((item, index) => {
    const page = index + 1
    if (!item || typeof item !== 'object') {
      errors.push(`第 ${page} 页卡片格式无效`)
      return
    }
    const kind = item.kind
    if (!CARD_KINDS.has(kind)) {
      errors.push(`第 ${page} 页卡片类型无效：${String(kind)}`)
      return
    }
    if (index === 0 && kind !== 'cover') {
      errors.push('第 1 页卡片类型必须是 cover')
    }
    if (index > 0 && kind === 'cover') {
      errors.push(`第 ${page} 页不能使用 cover，封面只能放在第 1 页`)
    }
    if (kind === 'end' && index !== raw.cards.length - 1) {
      errors.push(`第 ${page} 页不能使用 end，尾页卡只能放在最后 1 页`)
    }

    let heading = ''
    if (item.heading != null && typeof item.heading !== 'string') {
      errors.push(`第 ${page} 页卡片标题必须是文本`)
    } else if (typeof item.heading === 'string' && CONTROL_CHARS.test(item.heading)) {
      errors.push(`第 ${page} 页卡片标题包含不允许的控制字符`)
    } else {
      heading = String(item.heading ?? '').replace(/[\r\n]+/g, ' ').trim()
      const headLen = charCount(heading)
      const hardHeadMax = limits.heading * 2
      if (headLen > hardHeadMax) {
        errors.push(`第 ${page} 页卡片标题超出 ${hardHeadMax} 字硬上限（当前 ${headLen} 字）`)
      } else if (headLen > limits.heading) {
        if (strictCardLength) {
          errors.push(`第 ${page} 页卡片标题超出 ${limits.heading} 字上限（当前 ${headLen} 字）`)
        } else {
          warnings.push(`第 ${page} 页卡片标题偏长（${headLen} 字，建议 ≤ ${limits.heading} 字），可在右侧精简`)
        }
      }
      if (HEADING_REQUIRED_KINDS.has(kind) && !heading) {
        errors.push(`第 ${page} 页（${kind}）必须填写卡片标题`)
      }
    }

    const badge = cleanOptionalCardField({ value: item.badge, page, label: '角标', softLimit: limits.badge, strictCardLength, errors, warnings })
    const accent = cleanOptionalCardField({ value: item.accent, page, label: '强调副题', softLimit: limits.accent, strictCardLength, errors, warnings })
    const callout = cleanOptionalCardField({ value: item.callout, page, label: '底部提示', softLimit: limits.callout, strictCardLength, errors, warnings })

    const cardTags = []
    if (item.tags != null) {
      if (!Array.isArray(item.tags)) {
        errors.push(`第 ${page} 页卡片标签（tags）必须是数组`)
      } else {
        const seenCardTags = new Set()
        for (const rawTag of item.tags) {
          if (typeof rawTag !== 'string') {
            errors.push(`第 ${page} 页卡片标签必须是文本`)
            break
          }
          if (CONTROL_CHARS.test(rawTag)) {
            errors.push(`第 ${page} 页卡片标签包含不允许的控制字符`)
            break
          }
          const tag = rawTag.replace(/[#\s]+/g, '')
          if (!tag || seenCardTags.has(tag)) continue
          seenCardTags.add(tag)
          const tagLen = charCount(tag)
          if (tagLen > limits.cardTagChars * 2) {
            errors.push(`第 ${page} 页卡片标签「${tag}」超出 ${limits.cardTagChars * 2} 字硬上限`)
            continue
          }
          if (tagLen > limits.cardTagChars) {
            if (strictCardLength) {
              errors.push(`第 ${page} 页卡片标签「${tag}」超出 ${limits.cardTagChars} 字上限`)
            } else {
              warnings.push(`第 ${page} 页卡片标签「${tag}」偏长（建议 ≤ ${limits.cardTagChars} 字）`)
            }
          }
          if (cardTags.length < limits.cardTags[1]) cardTags.push(tag)
        }
      }
    }

    const imageUrl = sanitizeCardImageUrl(item.imageUrl)
    const imageFraming = normalizeCardImageFraming(item.imageFraming)
    const html = sanitizeXhsCardHtml(item.html)
    const pageCss = enforceXhsDarkSurfaceContrast(html, sanitizeXhsCss(item.pageCss, { maxChars: limits.pageCss }))
    const layoutArchetype = typeof item.layoutArchetype === 'string'
      ? item.layoutArchetype.replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
      : ''

    if (!heading && html && HEADING_REQUIRED_KINDS.has(kind)) {
      const derived = extractFallbackHeadingAndLinesFromHtml(html)
      if (derived.heading) heading = derived.heading
    }

    const lines = []
    if (item.lines != null && !Array.isArray(item.lines)) {
      errors.push(`第 ${page} 页卡片条目（lines）必须是字符串数组`)
    } else {
      let lineTypeOk = true
      for (const rawLine of item.lines ?? []) {
        if (typeof rawLine !== 'string') {
          errors.push(`第 ${page} 页卡片条目必须全部是文本`)
          lineTypeOk = false
          break
        }
        if (CONTROL_CHARS.test(rawLine)) {
          errors.push(`第 ${page} 页卡片条目包含不允许的控制字符`)
          lineTypeOk = false
          break
        }
        const cleaned = rawLine.replace(/[\r\n]+/g, ' ').trim()
        if (cleaned) lines.push(cleaned)
      }
      if (lineTypeOk) {
        if (kind === 'end' && !heading && lines.length === 0 && !html) {
          errors.push(`第 ${page} 页（end）不能是空白尾页，请填写标题或至少一行内容`)
        }
        const spec = limits[kind]
        if (!html && (lines.length < spec.lines[0] || lines.length > spec.lines[1])) {
          errors.push(`第 ${page} 页（${kind}）正文行数需为 ${spec.lines[0]}–${spec.lines[1]} 行（当前 ${lines.length} 行）`)
        }
        const hardLineMax = Math.max(spec.lineChars * 2, 60)
        lines.forEach((line, lineIdx) => {
          const len = charCount(line)
          if (len > hardLineMax) {
            errors.push(`第 ${page} 页第 ${lineIdx + 1} 行超出 ${hardLineMax} 字硬上限（当前 ${len} 字）`)
          } else if (len > spec.lineChars) {
            if (strictCardLength) {
              errors.push(`第 ${page} 页第 ${lineIdx + 1} 行超出 ${spec.lineChars} 字上限（当前 ${len} 字）`)
            } else {
              warnings.push(`第 ${page} 页第 ${lineIdx + 1} 行偏长（${len} 字，建议 ≤ ${spec.lineChars} 字），可在右侧精简`)
            }
          }
        })
      }
    }

    const source = filterSourceIds(item.source, validIds)
    const card = { kind, heading, lines, source }
    if (badge) card.badge = badge
    if (accent) card.accent = accent
    if (callout) card.callout = callout
    if (cardTags.length) card.tags = cardTags
    if (imageUrl) card.imageUrl = imageUrl
    if (imageFraming) card.imageFraming = imageFraming
    if (layoutArchetype) card.layoutArchetype = layoutArchetype
    if (html) card.html = html
    if (pageCss) card.pageCss = pageCss
    cards.push(card)

    if (html || pageCss) {
      const hardcoded = findHardcodedBrandColors(`${html}\n${pageCss}`)
      if (hardcoded.length) {
        warnings.push(`第 ${page} 页包含硬编码主色（${hardcoded.slice(0, 3).join('、')}），切换配色主题时可能不联动`)
      }
    }

    if (sourceText) {
      const htmlText = html ? stripHtmlToText(html) : ''
      if (kind === 'quote') {
        let quoteBody = lines.join(' ')
        if (html) {
          const bqMatch = /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i.exec(html)
          quoteBody = bqMatch
            ? stripHtmlToText(bqMatch[1])
            : htmlText
              .replace(heading, '')
              .replace(badge, '')
              .replace(/\b0?\d+\s*\/\s*0?\d+\b/g, '')
              .trim()
        }
        if (quoteBody && sourceOverlap(quoteBody, sourceText) < 0.6) {
          warnings.push(`第 ${page} 页金句偏离原文较多`)
        }
      }
      const cardFacts = unsupportedFacts(`${heading}\n${accent}\n${callout}\n${lines.join('\n')}\n${htmlText}`, sourceText)
      if (cardFacts.length) {
        warnings.push(`第 ${page} 页卡片出现原文没有的数字：${cardFacts.join('、')}`)
      }
    }
  })

  if (errors.length) {
    throw fail(`${errors.join('；')}。`, status, { issues: errors })
  }

  const customCss = enforceXhsDarkSurfaceContrast('', sanitizeXhsCss(raw.customCss, { maxChars: limits.customCss }))
  const designPrompt = typeof raw.designPrompt === 'string'
    ? raw.designPrompt.replace(CONTROL_CHARS, '').replace(/[\r\n]+/g, ' ').trim().slice(0, limits.designPrompt)
    : ''

  // 整套卡片 HTML + CSS 总量预算检查
  const totalMarkup = htmlMarkupLength(customCss) + cards.reduce(
    (sum, c) => sum + htmlMarkupLength(c.html || '') + htmlMarkupLength(c.pageCss || ''),
    0,
  )
  if (totalMarkup > limits.totalDeckMarkup) {
    warnings.push(`整套卡片 HTML/CSS 总量偏大（${totalMarkup} 字符，建议 ≤ ${limits.totalDeckMarkup} 字符）`)
  }

  // 中间页 DOM 拓扑重复检查（有自定义 HTML 时按 DOM 骨架查重，否则按卡型查重）
  const middleCards = cards.map((c, idx) => ({ card: c, page: idx + 1 })).filter(x => x.card.kind !== 'cover' && x.card.kind !== 'end')
  const middleWithHtml = middleCards.filter(x => Boolean(x.card.html))
  if (middleWithHtml.length >= 2) {
    let hasAdjDup = false
    for (let i = 1; i < middleWithHtml.length; i++) {
      if (computeDomTopologySignature(middleWithHtml[i - 1].card.html) === computeDomTopologySignature(middleWithHtml[i].card.html)) {
        hasAdjDup = true
        warnings.push(`第 ${middleWithHtml[i - 1].page} 页与第 ${middleWithHtml[i].page} 页排版结构雷同，可点「重设计此页」换一种版式`)
      }
    }
    if (!hasAdjDup && middleWithHtml.length >= 3) {
      const uniqueSigs = new Set(middleWithHtml.map(x => computeDomTopologySignature(x.card.html)))
      if (uniqueSigs.size < 2) {
        warnings.push('中间页排版拓扑较为单一，可对单页点击「重设计此页」增加层次')
      }
    }
  } else {
    const middleKinds = middleCards.map(x => x.card.kind)
    if (middleKinds.length >= 3 && new Set(middleKinds).size === 1) {
      warnings.push('卡片版式较为单一，可在右侧切换不同卡型')
    }
  }

  const deckStyle = XHS_DECK_STYLES.includes(raw.deckStyle) ? raw.deckStyle : 'tech'
  const tweaks = normalizeXhsTweaks(raw.tweaks)
  const out = { deckStyle, title, body, tags, cards, warnings }
  if (tweaks) out.tweaks = tweaks
  if (customCss) out.customCss = customCss
  if (designPrompt) out.designPrompt = designPrompt
  if (raw.artDirection && typeof raw.artDirection === 'object') {
    const cleanField = (val, maxLen) => (
      typeof val === 'string'
        ? val.replace(CONTROL_CHARS, '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
        : ''
    )
    const genre = cleanField(raw.artDirection.genre, 48)
    const visualLanguage = cleanField(raw.artDirection.visualLanguage, 160)
    const rhythm = cleanField(raw.artDirection.rhythm, 160)
    const endMood = ['light', 'tint', 'split', 'dark'].includes(raw.artDirection.endMood)
      ? raw.artDirection.endMood
      : ''
    if (genre || visualLanguage || rhythm || endMood) {
      out.artDirection = {
        ...(genre ? { genre } : {}),
        ...(visualLanguage ? { visualLanguage } : {}),
        ...(rhythm ? { rhythm } : {}),
        ...(endMood ? { endMood } : {}),
      }
    }
  }
  const referencePlan = normalizeXhsReferencePlan(raw.referencePlan, {
    cards: raw.cards,
    referenceImageIds,
  })
  if (referencePlan) out.referencePlan = referencePlan
  return out
}

function cleanOptionalCardField({ value, page, label, softLimit, strictCardLength, errors, warnings }) {
  if (value == null) return ''
  if (typeof value !== 'string') {
    errors.push(`第 ${page} 页${label}必须是文本`)
    return ''
  }
  if (CONTROL_CHARS.test(value)) {
    errors.push(`第 ${page} 页${label}包含不允许的控制字符`)
    return ''
  }
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim()
  if (!cleaned) return ''
  const len = charCount(cleaned)
  const hardLimit = softLimit * 2
  if (len > hardLimit) {
    errors.push(`第 ${page} 页${label}超出 ${hardLimit} 字硬上限（当前 ${len} 字）`)
  } else if (len > softLimit) {
    if (strictCardLength) {
      errors.push(`第 ${page} 页${label}超出 ${softLimit} 字上限（当前 ${len} 字）`)
    } else {
      warnings.push(`第 ${page} 页${label}偏长（${len} 字，建议 ≤ ${softLimit} 字），可在右侧精简`)
    }
  }
  return cleaned
}

export function threadClipboardText(posts, { numbered = true } = {}) {
  const list = Array.isArray(posts) ? posts : []
  const total = list.length
  return list
    .map((post, index) => (numbered ? `${index + 1}/${total} ${post.text}` : post.text))
    .join('\n\n')
}

export function xhsClipboardText({ title = '', body = '', tags = [] } = {}) {
  const tagLine = Array.isArray(tags) && tags.length
    ? tags.map(tag => (String(tag).startsWith('#') ? String(tag) : `#${tag}`)).join(' ')
    : ''
  return [String(title).trim(), String(body).trim(), tagLine].filter(Boolean).join('\n\n')
}
