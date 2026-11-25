// 排版：vendor/layout 里的排版引擎（移植自 lqshow/wechat-article-skills 的 layout.py / banner.py，输出逐字节一致）。
// 产物是一个自带风格、配色切换和复制按钮的完整 HTML 页面，前端放进 iframe 里用。
import * as engine from '../vendor/layout/layout.js'
import * as bannerEngine from '../vendor/layout/banner.js'
import { END_MARK_STYLES, END_MARK_STYLE_IDS, normalizeEndMark } from './end-mark.js'

export { END_MARK_STYLES, END_MARK_STYLE_IDS, normalizeEndMark }

export const STYLES = ['std', 'mag', 'min', 'geek', 'bold', 'neo', 'note', 'zen', 'bento', 'dark']
export const THEMES = ['orange', 'blue', 'teal', 'ink', 'navy', 'violet', 'rose', 'amber', 'morandi', 'forest', 'petrol', 'mist', 'matcha', 'cocoa', 'dusty']
// 显示名与 vendor/layout/layout.js 的 STYLES/THEMES 保持一致，复盘对比块用
export const STYLE_NAMES = { std: '标准', mag: '杂志', min: '极简', geek: '极客', bold: '醒目', neo: '质感', note: '手账', zen: '雅致', bento: '卡片', dark: '暗夜' }
export const THEME_NAMES = { orange: '品牌橙', blue: '科技蓝', teal: '薄荷绿', ink: '墨黑', navy: '藏青金', violet: '葡萄紫', rose: '胭脂红', amber: '琥珀', morandi: '莫兰迪', forest: '松柏金', petrol: '孔雀青', mist: '雾霾蓝', matcha: '橄榄绿', cocoa: '可可棕', dusty: '豆沙粉' }

export function resolveLayoutPreferences(settings = {}, article = {}) {
  const preferred = article.layoutPreferences ?? {}
  return {
    style: STYLES.includes(preferred.style) ? preferred.style : STYLES.includes(settings.style) ? settings.style : 'std',
    theme: THEMES.includes(preferred.theme) ? preferred.theme : THEMES.includes(settings.theme) ? settings.theme : 'orange',
  }
}

const jsonCopy = value => JSON.parse(JSON.stringify(value))

/**
 * 把 Markdown 排成公众号版式页面。
 * @param {string} markdown - 文章 Markdown。
 * @param {{style?: string, theme?: string, banner?: object, followCard?: boolean, brand?: {author?: string, slogan?: string}}} [options] - 默认风格和配色（不合法的值忽略），横幅规格（没有就不画横幅）。
 * @returns {Promise<{html: string, report: string}>} 页面和排版引擎的自查报告。
 */
export async function renderLayout(markdown, { style, theme, banner, followCard = false, endMark, brand, studioOptions } = {}) {
  const { html, report } = engine.renderPage(String(markdown), {
    outro: followCard ? 'true' : 'false',
    endMark: endMark !== undefined ? normalizeEndMark(endMark, 'none') : undefined,
    brandAuthor: brand?.author || undefined,
    brandSlogan: brand?.slogan || undefined,
    studioOptions: studioOptions ? jsonCopy(studioOptions) : undefined,
    banner: banner ? jsonCopy(banner) : undefined,
    style: STYLES.includes(style) ? style : undefined,
    theme: THEMES.includes(theme) ? theme : undefined,
  })
  return { html, report: report.trim() }
}

/**
 * 渲染可直接推送到微信公众号草稿箱的正文 HTML 片段（不含预览页壳子）。
 */
export async function renderWechatHtml(markdown, { style, theme, banner, followCard = false, endMark, brand, avatarUrl, name = '' } = {}) {
  return engine.renderFragment(String(markdown), {
    outro: followCard ? 'true' : 'false',
    endMark: endMark !== undefined ? normalizeEndMark(endMark, 'none') : undefined,
    brandAuthor: brand?.author || undefined,
    brandSlogan: brand?.slogan || undefined,
    avatarUrl: avatarUrl || '',
    banner: banner ? jsonCopy(banner) : undefined,
    style: STYLES.includes(style) ? style : undefined,
    theme: THEMES.includes(theme) ? theme : undefined,
    name,
  })
}

export const SVG_CARD_KINDS = ['svg-table', 'svg-bars', 'svg-steps', 'svg-timeline', 'svg-breakdown', 'svg-compare', 'svg-concept', 'svg-phone']
const SVG_ELEMENTS = new Set(['section', 'svg', 'g', 'rect', 'circle', 'line', 'path', 'text', 'animate', 'animateTransform', 'set'])
const SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'style', 'opacity', 'x', 'y', 'rx', 'ry', 'fill', 'stroke',
  'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'font-size',
  'font-weight', 'font-family', 'text-anchor', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'd', 'transform',
  'attributeName', 'values', 'keyTimes', 'calcMode', 'keySplines', 'dur', 'repeatCount', 'begin', 'from', 'to', 'type', 'by',
])

export function assertSvgCardFragment(html) {
  const source = String(html ?? '')
  if (!source || source.length > 500_000 || (source.match(/<svg\b/g) ?? []).length !== 1 || (source.match(/<\/svg>/g) ?? []).length !== 1) {
    throw Object.assign(new Error('单卡渲染没有返回唯一 SVG。'), { status: 422 })
  }
  if (/<(?:script|style|foreignObject|iframe|image|use|clipPath)\b|Gradient|\son\w+\s*=|(?:href|src)\s*=|url\s*\(|@import/i.test(source)) {
    throw Object.assign(new Error('单卡渲染包含脚本、外部引用或不支持的元素。'), { status: 422 })
  }
  for (const match of source.matchAll(/<\/?([A-Za-z][\w-]*)[^>]*>/g)) {
    const [tag, element] = match
    if (!SVG_ELEMENTS.has(element)) throw Object.assign(new Error(`单卡渲染包含不支持的元素：${element}`), { status: 422 })
    for (const attr of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=/g)) {
      if (!SVG_ATTRIBUTES.has(attr[1])) throw Object.assign(new Error(`单卡渲染包含不支持的属性：${attr[1]}`), { status: 422 })
    }
  }
  if (!/<(?:animate|animateTransform|set)\b/.test(source)) {
    throw Object.assign(new Error('卡片格式无法渲染成动画，请检查条目和分隔符。'), { status: 422 })
  }
  return source
}

export async function renderSvgCard(card, { style = 'std', theme = 'orange' } = {}) {
  if (!SVG_CARD_KINDS.includes(card?.kind) || typeof card.title !== 'string' || !Array.isArray(card.lines) || card.lines.some(line => typeof line !== 'string')) {
    throw Object.assign(new Error('卡片类型或内容格式无效。'), { status: 400 })
  }
  const safeStyle = STYLES.includes(style) ? style : 'std'
  const safeTheme = THEMES.includes(theme) ? theme : 'orange'
  const result = engine.renderSvgCard(card.kind, card.title, card.lines, { style: safeStyle, theme: safeTheme })
  if (!String(result.html).includes('<svg')) {
    throw Object.assign(new Error(`卡片格式无法渲染：${result.warnings.join('；') || '请检查条目和分隔符'}`), { status: 422 })
  }
  return { html: assertSvgCardFragment(result.html), report: result.warnings.join('\n') }
}

/**
 * 检测用纯文本：等于读者最终读到的文字，用来贴到朱雀。先用排版引擎自带的 plainMd，
 * 再去掉每篇都一样的固定句（它们会和正文混进同一个片段，把分数拉高）。
 * @param {string} markdown - 文章 Markdown。
 * @param {string[]} [fixedLines] - 含有这些文字的行整行去掉。
 * @returns {Promise<string>} 纯文本。
 */
export async function detectionText(markdown, fixedLines = []) {
  const body = String(markdown).replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '')
  const plain = engine.plainMd(body)
  const needles = fixedLines.map(line => String(line).trim()).filter(Boolean)
  return plain.split('\n')
    .filter(line => !needles.some(needle => line.includes(needle)))
    // plainMd 留下了标题井号、二级标题的英文副标题和引用符号，读者看不到这些
    .map(line => (/^#{1,6}\s/.test(line) ? line.replace(/^#{1,6}\s+/, '').replace(/\s*\|\s*[A-Za-z0-9 &·'.-]+$/, '') : line.replace(/^>\s?/, '')))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 用横幅引擎自带的 checkSpec 检查规格：字数、数量超限、写法不对。
 * @param {object} spec - 横幅规格。
 * @returns {Promise<string[]>} 问题列表，空数组表示通过；规格坏到画不出来时也作为一条问题返回。
 */
export async function checkBanner(spec) {
  let out
  try {
    const copy = jsonCopy(spec ?? null)
    out = bannerEngine.checkSpec(copy, [bannerEngine.build(copy)])
  } catch (err) {
    out = [`规格画不出来：${err?.name ?? 'Error'}: ${err?.message ?? err}`]
  }
  return Array.isArray(out) ? out.map(String) : []
}
