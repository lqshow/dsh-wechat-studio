// 公众号视频装裱卡（```video 代码块）：纯函数、无运行时依赖、100% 公众号白名单内联样式与 SVG。

export const VIDEO_CARD_STYLES = [
  {
    id: 'cinema',
    name: '电影监视器 Pro',
    desc: '阳极氧化石墨机身、微光状态灯与精密声波时间码，适合短片、实拍与 AI 视频展示',
  },
  {
    id: 'editorial',
    name: '编辑部胶片框',
    desc: '暖纸画册装帧、极细眉线与导演注记，适合杂志、雅致与深度长文',
  },
  {
    id: 'studio',
    name: '极简演示窗',
    desc: '类 Apple Keynote 磨砂窗口框与轻盈信息条，适合软件录屏、工具与产品演示',
  },
]

export const VIDEO_CARD_STYLE_IDS = VIDEO_CARD_STYLES.map(s => s.id)

const DEFAULT_THEME = {
  st: 'std',
  main: '#C9643E',
  soft: '#FCF6F2',
  tint: '#F7E3D5',
  line: '#DAB196',
  mark: '#FCE7A6',
}

const FENCE_OPEN_RE = /^\s*(?:`{3,}|~{3,})\s*video(?:\s+([a-z0-9_-]+))?[ \t]*$/i
const FENCE_CLOSE_RE = /^\s*(?:`{3,}|~{3,})\s*$/

const KEY_ALIASES = {
  style: 'style',
  风格: 'style',
  样式: 'style',
  index: 'index',
  case: 'index',
  badge: 'index',
  编号: 'index',
  期号: 'index',
  title: 'title',
  标题: 'title',
  name: 'title',
  model: 'model',
  source: 'model',
  camera: 'model',
  来源: 'model',
  设备: 'model',
  参数: 'model',
  duration: 'duration',
  time: 'duration',
  tc: 'duration',
  时长: 'duration',
  spec: 'spec',
  tag: 'spec',
  lut: 'spec',
  规格: 'spec',
  标签: 'spec',
  note: 'note',
  caption: 'note',
  desc: 'note',
  说明: 'note',
  备注: 'note',
  poster: 'poster',
  cover: 'poster',
  image: 'poster',
  封面: 'poster',
}

const SANS = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
const SERIF = "'Songti SC','Noto Serif SC','STSong',Georgia,serif"
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Monaco,Consolas,monospace"

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function sanitizePosterUrl(raw) {
  const value = String(raw ?? '').trim().replace(/^<(.+)>$/, '$1')
  if (!value) return ''
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    return url.href
  } catch {
    return ''
  }
}

export function normalizeVideoCard(input = {}) {
  const rawStyle = String(input.style ?? '').trim().toLowerCase()
  const style = VIDEO_CARD_STYLE_IDS.includes(rawStyle) ? rawStyle : 'cinema'
  const clean = (v, max = 80) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max)
  return {
    style,
    index: clean(input.index, 24),
    title: clean(input.title, 60),
    model: clean(input.model, 48),
    duration: clean(input.duration, 16),
    spec: clean(input.spec, 28),
    note: clean(input.note, 140),
    poster: sanitizePosterUrl(input.poster),
  }
}

export function isVideoCardText(text) {
  const lines = String(text ?? '').trim().split(/\r?\n/)
  return lines.length >= 2 && FENCE_OPEN_RE.test(lines[0]) && FENCE_CLOSE_RE.test(lines.at(-1))
}

export function parseVideoCardLines(lines, styleArg = '') {
  const out = { style: styleArg }
  for (const rawLine of lines ?? []) {
    const line = String(rawLine ?? '').trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([^:：\s]+)\s*[:：]\s*(.*)$/.exec(line)
    if (match) {
      const key = KEY_ALIASES[match[1].trim().toLowerCase()]
      if (key) {
        out[key] = match[2].trim()
        continue
      }
    }
    if (!out.title) out.title = line
    else if (!out.note) out.note = line
  }
  return normalizeVideoCard(out)
}

export function parseVideoCardBlock(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const lines = trimmed.split(/\r?\n/)
  if (lines.length < 2) return null
  const open = FENCE_OPEN_RE.exec(lines[0])
  if (!open || !FENCE_CLOSE_RE.test(lines.at(-1))) return null
  return parseVideoCardLines(lines.slice(1, -1), open[1] ?? '')
}

export function formatVideoCardMarkdown(raw = {}) {
  const card = normalizeVideoCard(raw)
  const rows = []
  if (card.index) rows.push(`index: ${card.index}`)
  if (card.title) rows.push(`title: ${card.title}`)
  if (card.model) rows.push(`model: ${card.model}`)
  if (card.duration) rows.push(`duration: ${card.duration}`)
  if (card.spec) rows.push(`spec: ${card.spec}`)
  if (card.note) rows.push(`note: ${card.note}`)
  if (card.poster) rows.push(`poster: ${card.poster}`)
  if (!rows.length) rows.push('title: 演示视频')
  return '```video ' + card.style + '\n' + rows.join('\n') + '\n```'
}

export function formatTimecode(duration) {
  const clean = String(duration ?? '').trim().replace(/^TC\s*/i, '')
  if (!clean) return 'TC 00:00:00'
  const parts = clean.split(':').map(s => s.trim()).filter(Boolean)
  if (parts.length === 2 && parts.every(p => /^\d{1,2}$/.test(p))) {
    return `TC 00:${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  if (parts.length === 3 && parts.every(p => /^\d{1,2}$/.test(p))) {
    return `TC ${parts.map(p => p.padStart(2, '0')).join(':')}`
  }
  return `TC ${clean}`
}

// 19 根精密非对称声波条（模拟真实人声/环境声包络，比粗柱更有专业监视器质感）
function waveformSvg(accent) {
  const heights = [3, 5, 4, 8, 11, 7, 13, 15, 10, 14, 9, 12, 6, 9, 5, 7, 4, 5, 3]
  const bars = heights.map((h, idx) => {
    const x = idx * 3.4
    const y = Number(((16 - h) / 2).toFixed(1))
    const fill = idx < 7 ? accent : idx < 12 ? '#D5DCE6' : '#555E6E'
    const opacity = idx < 7 ? '0.95' : idx < 12 ? '0.82' : '0.68'
    return `<rect x="${x.toFixed(1)}" y="${y}" width="2" height="${h}" rx="1" fill="${fill}" opacity="${opacity}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="66" height="16" viewBox="0 0 66 16" style="display:block;flex-shrink:0;">${bars}</svg>`
}

// 电影监视器呼吸状态灯（公众号原生支持 SVG SMIL 微呼吸动效）
function liveDotSvg(color = '#34D399') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" style="display:block;flex-shrink:0;">`
    + `<circle cx="5" cy="5" r="4.5" fill="${color}" opacity="0.28">`
    + `<animate attributeName="opacity" values="0.34;0.1;0.34" dur="2.6s" repeatCount="indefinite"/>`
    + `</circle>`
    + `<circle cx="5" cy="5" r="2.3" fill="${color}"/>`
    + `</svg>`
}

// 精密硬件光学/电量指示（替代廉价手机电池图标）
function precisionGaugeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="14" viewBox="0 0 44 14" style="display:block;flex-shrink:0;">`
    + `<rect x="1" y="8" width="2" height="4" rx="0.8" fill="#525A69"/>`
    + `<rect x="4.5" y="6" width="2" height="6" rx="0.8" fill="#7D8696"/>`
    + `<rect x="8" y="4" width="2" height="8" rx="0.8" fill="#B6BFCE"/>`
    + `<rect x="11.5" y="2.5" width="2" height="9.5" rx="0.8" fill="#E5E9F0"/>`
    + `<rect x="19" y="2.5" width="20.5" height="9" rx="2.2" fill="none" stroke="#6E7787" stroke-width="1.2"/>`
    + `<rect x="21.2" y="4.7" width="14.5" height="4.6" rx="1" fill="#D5DCE6"/>`
    + `<rect x="40.5" y="5" width="1.8" height="4" rx="0.8" fill="#6E7787"/>`
    + `</svg>`
}

// 标题胶囊内的精密主题色圆点（不用容易出戏的 emoji）
function accentDotSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 7 7" style="display:inline-block;vertical-align:middle;margin-right:6px;"><circle cx="3.5" cy="3.5" r="3" fill="${color}"/></svg>`
}

// 极简演示窗三色控制点（柔和钛灰，不喧宾夺主）
function studioDotsSvg(dark) {
  const c1 = dark ? '#4B5262' : '#D0D5DD'
  const c2 = dark ? '#3C4250' : '#DCE0E7'
  const c3 = dark ? '#303642' : '#E5E8EE'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="10" viewBox="0 0 38 10" style="display:block;flex-shrink:0;">`
    + `<circle cx="5" cy="5" r="4" fill="${c1}"/>`
    + `<circle cx="19" cy="5" r="4" fill="${c2}"/>`
    + `<circle cx="33" cy="5" r="4" fill="${c3}"/>`
    + `</svg>`
}

// 公众号安全视频槽占位：纯单行 <p>，绝不在槽内放 <svg>（微信公众号编辑器在 <svg> 内插入视频会把 SVG 劈成上下两截残片）
function videoSlotPlaceholderHtml(card, { dark = true } = {}) {
  const bg = dark ? '#0D1016' : '#EEF1F6'
  const color = dark ? '#8C96A8' : '#5B6578'
  const durSuffix = card.duration ? ` · ${esc(card.duration)}` : ''
  return `<p style="margin:0;padding:38px 16px;text-align:center;background:${bg};font-family:${SANS};font-size:13px;line-height:1.6;letter-spacing:0.3px;color:${color};">`
    + `▶ 选中并删掉本行，点顶部「视频」上传或从素材库插入${durSuffix}`
    + `</p>`
}

function renderApertureInner(card, { dark = true } = {}) {
  if (card.poster) {
    return `<p style="margin:0;line-height:0;"><img src="${esc(card.poster)}" style="display:block;width:100%;height:auto;vertical-align:top;"/></p>`
  }
  return videoSlotPlaceholderHtml(card, { dark })
}

function renderCinemaCard(card, T) {
  const isDarkPage = T.st === 'dark'
  const titleColor = isDarkPage ? '#F3F5F8' : '#14171D'
  const slotName = card.title || card.index || '视频装裱卡'

  const headerHtml = (card.index || card.title)
    ? `<section style="display:flex;align-items:center;gap:9px;margin:0 0 11px;padding:0 2px;">`
      + (card.index
        ? `<span style="display:inline-flex;align-items:center;flex-shrink:0;padding:4px 11px 4px 9px;border-radius:999px;background:#12151B;border:1px solid rgba(255,255,255,0.12);color:#F3F5F8;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.2px;line-height:1.2;box-shadow:0 3px 10px rgba(8,10,15,0.16);">${accentDotSvg(T.main)}${esc(card.index)}</span>`
        : '')
      + (card.title
        ? `<span style="font-family:${SANS};font-size:16px;font-weight:800;letter-spacing:-0.015em;color:${titleColor};line-height:1.35;overflow-wrap:anywhere;">${esc(card.title)}</span>`
        : '')
      + `</section>`
    : ''

  const topLeftParts = [
    card.index ? `<span style="font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.3px;color:#F3F5F8;">${esc(card.index)}</span>` : '',
    card.model ? `<span style="font-family:${MONO};font-size:10.5px;font-weight:500;letter-spacing:0.9px;color:#9BA5B6;">${esc(card.model)}</span>` : '',
  ].filter(Boolean)

  const topMeta = topLeftParts.length
    ? topLeftParts.join(`<span style="color:#5B6577;font-size:11px;">·</span>`)
    : `<span style="font-family:${MONO};font-size:10.5px;letter-spacing:1.2px;color:#9BA5B6;">MONITOR · REC</span>`

  const specBadge = card.spec
    ? `<span style="display:inline-block;padding:3px 9px;border-radius:5px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:1.2px;line-height:1.3;color:#D5DCE6;">${esc(card.spec)}</span>`
    : ''

  const noteHtml = card.note
    ? `<p style="margin:9px 3px 0;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);font-family:${SANS};font-size:12px;line-height:1.6;color:#949EB0;text-align:left;">${esc(card.note)}</p>`
    : ''

  return `<section style="margin:26px 0;">`
    + headerHtml
    + `<section style="border-radius:16px;padding:11px 12px 12px;background:linear-gradient(180deg,#1C2028 0%,#11141A 14%,#0A0C10 100%);border:1px solid #2C313C;box-shadow:0 18px 40px rgba(8,10,15,0.28),inset 0 1px 0 rgba(255,255,255,0.11);">`
    + `<section style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:1px 3px 10px;">`
    + `<section style="display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;">${liveDotSvg('#34D399')}${topMeta}</section>`
    + precisionGaugeSvg()
    + `</section>`
    + `<section data-video-slot="${esc(slotName)}" style="border-radius:9px;overflow:hidden;background:#050608;border:1px solid rgba(255,255,255,0.09);box-shadow:inset 0 2px 12px rgba(0,0,0,0.72);">`
    + renderApertureInner(card, { dark: true })
    + `</section>`
    + `<section style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 3px 0;">`
    + `<section style="display:flex;align-items:center;gap:10px;min-width:0;">${waveformSvg(T.main)}<span style="font-family:${MONO};font-size:11px;font-weight:600;letter-spacing:1.3px;color:#D5DCE6;">${esc(formatTimecode(card.duration))}</span></section>`
    + specBadge
    + `</section>`
    + noteHtml
    + `</section></section>`
}

function renderEditorialCard(card, T) {
  const isDarkPage = T.st === 'dark'
  const cardBg = isDarkPage ? '#16181F' : '#FAF7F2'
  const cardBorder = isDarkPage ? '#2B303B' : '#E5DDD0'
  const ruleColor = isDarkPage ? 'rgba(255,255,255,0.09)' : 'rgba(28,25,23,0.10)'
  const ink = isDarkPage ? '#F3F1EC' : '#1A1816'
  const muted = isDarkPage ? '#939BA8' : '#746C61'
  const slotName = card.title || card.index || '编辑部放映框'

  const folioLeft = card.index || 'FILM FRAME'
  const folioRight = [card.model, card.spec].filter(Boolean).join(' · ')

  return `<section style="margin:26px 0;border-radius:12px;padding:14px 14px 13px;background:${cardBg};border:1px solid ${cardBorder};box-shadow:0 10px 28px rgba(24,20,14,${isDarkPage ? '0.32' : '0.06'});">`
    + `<section style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 1px 9px;margin-bottom:10px;border-bottom:1px solid ${ruleColor};">`
    + `<span style="display:inline-flex;align-items:center;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.4px;color:${T.main};">${accentDotSvg(T.main)}${esc(folioLeft)}</span>`
    + (folioRight ? `<span style="font-family:${MONO};font-size:10.5px;letter-spacing:0.9px;color:${muted};">${esc(folioRight)}</span>` : '')
    + `</section>`
    + `<section data-video-slot="${esc(slotName)}" style="border-radius:5px;overflow:hidden;background:#080A0D;border:1px solid ${isDarkPage ? 'rgba(255,255,255,0.09)' : 'rgba(24,20,14,0.12)'};">`
    + renderApertureInner(card, { dark: true })
    + `</section>`
    + `<section style="padding:11px 2px 0;">`
    + `<section style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">`
    + `<span style="font-family:${SERIF};font-size:16px;font-weight:700;color:${ink};line-height:1.4;letter-spacing:-0.01em;">${esc(card.title || '影像片段')}</span>`
    + (card.duration ? `<span style="flex-shrink:0;font-family:${MONO};font-size:11px;letter-spacing:0.9px;color:${muted};">${esc(card.duration)}</span>` : '')
    + `</section>`
    + (card.note ? `<p style="margin:5px 0 0;font-family:${SANS};font-size:12.5px;line-height:1.65;color:${muted};text-align:left;">${esc(card.note)}</p>` : '')
    + `</section></section>`
}

function renderStudioCard(card, T) {
  const isDarkPage = T.st === 'dark'
  const shellBg = isDarkPage
    ? 'linear-gradient(180deg,#1F232C 0%,#15181F 100%)'
    : 'linear-gradient(180deg,#F9FAFC 0%,#EFF2F6 100%)'
  const shellBorder = isDarkPage ? '#2E3440' : '#DFE4EC'
  const ink = isDarkPage ? '#F3F5F8' : '#181C24'
  const muted = isDarkPage ? '#8F98A8' : '#647084'
  const chipBg = isDarkPage ? 'rgba(255,255,255,0.07)' : '#FFFFFF'
  const chipBorder = isDarkPage ? 'rgba(255,255,255,0.12)' : '#DCE1EA'
  const slotName = card.title || card.index || '演示视频'
  const topTitle = [card.index, card.title].filter(Boolean).join(' · ') || 'Demo Preview'
  const rightChip = card.spec || card.duration || ''

  const footerText = card.note
  const footerHtml = (footerText || card.duration)
    ? `<section style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 4px 1px;">`
      + (footerText
        ? `<span style="font-family:${SANS};font-size:12px;line-height:1.55;color:${muted};">${accentDotSvg(T.main)}${esc(footerText)}</span>`
        : `<span style="font-size:12px;">&#8203;</span>`)
      + (card.duration ? `<span style="flex-shrink:0;font-family:${MONO};font-size:11px;letter-spacing:0.8px;color:${muted};">${esc(card.duration)}</span>` : '')
      + `</section>`
    : ''

  return `<section style="margin:26px 0;border-radius:16px;padding:10px 11px 11px;background:${shellBg};border:1px solid ${shellBorder};box-shadow:0 14px 36px rgba(15,23,42,${isDarkPage ? '0.34' : '0.08'}),inset 0 1px 0 rgba(255,255,255,${isDarkPage ? '0.08' : '0.85'});">`
    + `<section style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 4px 10px;">`
    + studioDotsSvg(isDarkPage)
    + `<span style="flex:1;min-width:0;text-align:center;font-family:${SANS};font-size:12.5px;font-weight:600;color:${ink};line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(topTitle)}</span>`
    + (rightChip
      ? `<span style="flex-shrink:0;padding:2px 8px;border-radius:999px;background:${chipBg};border:1px solid ${chipBorder};font-family:${MONO};font-size:10px;font-weight:600;letter-spacing:0.8px;color:${muted};">${esc(rightChip)}</span>`
      : `<span style="display:inline-block;width:38px;">&#8203;</span>`)
    + `</section>`
    + `<section data-video-slot="${esc(slotName)}" style="border-radius:10px;overflow:hidden;background:${isDarkPage ? '#090B10' : '#E7EBF2'};border:1px solid ${isDarkPage ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'};">`
    + renderApertureInner(card, { dark: isDarkPage })
    + `</section>`
    + footerHtml
    + `</section>`
}

export function renderVideoCardHtml(rawCard, theme = {}) {
  const card = normalizeVideoCard(rawCard)
  const T = { ...DEFAULT_THEME, ...(theme || {}) }
  if (card.style === 'editorial') return renderEditorialCard(card, T)
  if (card.style === 'studio') return renderStudioCard(card, T)
  return renderCinemaCard(card, T)
}
