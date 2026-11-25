// 公众号文末收尾标识（End Mark / Colophon）：纯函数、无运行时依赖、100% 公众号白名单内联样式与 SVG。

export const END_MARK_STYLES = [
  {
    id: 'none',
    name: '关闭',
    desc: '不额外追加文末标识',
  },
  {
    id: 'horizon',
    name: '落日余晖',
    desc: '双斜杠 END 搭配渐隐地平线与主题色落日水波，克制且有余韵',
  },
  {
    id: 'colophon',
    name: '刊尾星印',
    desc: '独立杂志与书刊末页的对称星芒印记，适合深度长文与随笔',
  },
  {
    id: 'signal',
    name: '余音终止符',
    desc: '微光状态点、EOF 标尺与衰减声波条，与电影监视器视频卡成套',
  },
]

export const END_MARK_STYLE_IDS = END_MARK_STYLES.map(item => item.id)

const DEFAULT_THEME = {
  st: 'std',
  main: '#C9643E',
  soft: '#FCF6F2',
  tint: '#F7E3D5',
  line: '#DAB196',
  mark: '#FCE7A6',
}

const SERIF = "Georgia,'Songti SC','Noto Serif SC','STSong',serif"
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Monaco,Consolas,monospace"

export function normalizeEndMark(value, fallback = 'none') {
  const clean = String(value ?? '').trim().toLowerCase()
  return END_MARK_STYLE_IDS.includes(clean) ? clean : fallback
}

// 1. 落日余晖（Horizon）— 对标参考图全面升级：主题色斜杠 + 渐隐地平线 + 精确弦长分层落日与微光水波
function renderHorizonEndMark(T) {
  const isDark = T.st === 'dark'
  const textInk = isDark ? '#9BA4B5' : '#646D7C'
  const lineBase = isDark ? '#2A313E' : '#DCE1E8'
  const domeTop = isDark ? '#EDF2F7' : '#181C24'
  const domeMid = isDark ? '#C5CEDD' : '#2D3442'
  const domeLow = isDark ? '#94A0B4' : '#4C566A'
  const rippleInk = isDark ? '#8C97AB' : '#535C6D'

  const slashesSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="13" viewBox="0 0 16 13" style="display:block;flex-shrink:0;">`
    + `<line x1="5.6" y1="1.5" x2="1.6" y2="11.5" stroke="${T.main}" stroke-width="1.55" stroke-linecap="round"/>`
    + `<line x1="10.8" y1="1.5" x2="6.8" y2="11.5" stroke="${T.main}" stroke-width="1.55" stroke-linecap="round" opacity="0.52"/>`
    + `<line x1="15.1" y1="3.4" x2="12.1" y2="11.5" stroke="${textInk}" stroke-width="1.1" stroke-linecap="round" opacity="0.34"/>`
    + `</svg>`

  const ruleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 8" preserveAspectRatio="none" style="display:block;width:100%;height:8px;">`
    + `<line x1="0" y1="4" x2="240" y2="4" stroke="${lineBase}" stroke-width="1"/>`
    + `<line x1="184" y1="4" x2="240" y2="4" stroke="${T.main}" stroke-width="1" opacity="0.45"/>`
    + `<rect x="0" y="2.2" width="1" height="3.6" fill="${T.main}" opacity="0.45"/>`
    + `</svg>`

  const sunSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="36" viewBox="0 0 52 36" style="display:block;flex-shrink:0;">`
    + `<path d="M15.8 11.4 A15 15 0 0 1 36.2 11.4 Z" fill="${domeTop}"/>`
    + `<rect x="13.6" y="12.8" width="24.8" height="2.3" rx="1.15" fill="${domeMid}"/>`
    + `<rect x="11.8" y="16.5" width="28.4" height="2.0" rx="1.0" fill="${domeLow}"/>`
    + `<rect x="11.1" y="19.9" width="29.8" height="1.7" rx="0.85" fill="${T.main}" opacity="0.92">`
    + `<animate attributeName="opacity" values="0.96;0.68;0.96" dur="4.2s" repeatCount="indefinite"/>`
    + `</rect>`
    + `<line x1="0" y1="23.2" x2="52" y2="23.2" stroke="${lineBase}" stroke-width="1"/>`
    + `<line x1="8" y1="23.2" x2="44" y2="23.2" stroke="${T.main}" stroke-width="1" opacity="0.52"/>`
    + `<rect x="13.5" y="25.1" width="25.0" height="1.5" rx="0.75" fill="${T.main}" opacity="0.68">`
    + `<animate attributeName="opacity" values="0.74;0.42;0.74" dur="4.2s" repeatCount="indefinite"/>`
    + `</rect>`
    + `<rect x="17.5" y="28.1" width="17.0" height="1.35" rx="0.68" fill="${rippleInk}" opacity="0.44"/>`
    + `<rect x="21.0" y="30.9" width="10.0" height="1.2" rx="0.6" fill="${rippleInk}" opacity="0.26"/>`
    + `<rect x="23.8" y="33.5" width="4.4" height="1.1" rx="0.55" fill="${rippleInk}" opacity="0.16"/>`
    + `</svg>`

  const tailRuleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="8" viewBox="0 0 26 8" style="display:block;flex-shrink:0;">`
    + `<line x1="0" y1="4" x2="24" y2="4" stroke="${lineBase}" stroke-width="1"/>`
    + `<circle cx="24.4" cy="4" r="1.4" fill="${T.main}" opacity="0.6"/>`
    + `</svg>`

  return `<section data-end-mark="horizon" style="margin:42px 0 18px;padding:4px 2px;">`
    + `<section style="display:flex;align-items:center;">`
    + `<section style="display:inline-flex;align-items:center;gap:7px;flex-shrink:0;margin-right:12px;padding-top:6px;">`
    + slashesSvg
    + `<span style="font-family:${SERIF};font-size:12px;font-style:italic;font-weight:600;letter-spacing:3.2px;color:${textInk};line-height:1;">END</span>`
    + `</section>`
    + `<section style="flex:1;min-width:24px;padding-top:10px;">${ruleSvg}</section>`
    + sunSvg
    + `<section style="flex-shrink:0;padding-top:10px;">${tailRuleSvg}</section>`
    + `</section></section>`
}

// 2. 刊尾星印（Colophon）— 书籍与独立杂志末页的对称几何星芒
function renderColophonEndMark(T) {
  const isDark = T.st === 'dark'
  const rule = isDark ? '#2B3240' : '#DED9D0'
  const muted = isDark ? '#8B94A6' : '#857E73'

  const wingLeft = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 8" preserveAspectRatio="none" style="display:block;width:100%;height:8px;">`
    + `<line x1="12" y1="4" x2="156" y2="4" stroke="${rule}" stroke-width="1"/>`
    + `<line x1="118" y1="4" x2="156" y2="4" stroke="${T.main}" stroke-width="1" opacity="0.55"/>`
    + `</svg>`

  const wingRight = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 8" preserveAspectRatio="none" style="display:block;width:100%;height:8px;">`
    + `<line x1="4" y1="4" x2="148" y2="4" stroke="${rule}" stroke-width="1"/>`
    + `<line x1="4" y1="4" x2="42" y2="4" stroke="${T.main}" stroke-width="1" opacity="0.55"/>`
    + `</svg>`

  const emblem = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="24" viewBox="0 0 46 24" style="display:block;flex-shrink:0;">`
    + `<path d="M9 6 L4 12 L9 18" fill="none" stroke="${rule}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M37 6 L42 12 L37 18" fill="none" stroke="${rule}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<circle cx="13.5" cy="12" r="1.15" fill="${muted}" opacity="0.55"/>`
    + `<circle cx="32.5" cy="12" r="1.15" fill="${muted}" opacity="0.55"/>`
    + `<path d="M23 3.2 L25.1 9.9 L31.8 12 L25.1 14.1 L23 20.8 L20.9 14.1 L14.2 12 L20.9 9.9 Z" fill="${T.main}"/>`
    + `<circle cx="23" cy="12" r="1.7" fill="${isDark ? '#0F1218' : '#FFFFFF'}"/>`
    + `</svg>`

  return `<section data-end-mark="colophon" style="margin:44px 0 20px;text-align:center;">`
    + `<section style="display:flex;align-items:center;gap:12px;">`
    + `<section style="flex:1;min-width:20px;">${wingLeft}</section>`
    + emblem
    + `<section style="flex:1;min-width:20px;">${wingRight}</section>`
    + `</section>`
    + `<p style="margin:7px 0 0;font-family:${SERIF};font-size:10.5px;letter-spacing:3.6px;color:${muted};line-height:1.4;">FINIS · THE END</p>`
    + `</section>`
}

// 3. 余音终止符（Signal）— 科技/AI 专栏专属，与电影监视器视频卡统一硬件美学
function renderSignalEndMark(T) {
  const isDark = T.st === 'dark'
  const rule = isDark ? '#2A313E' : '#DCE1E8'
  const ink = isDark ? '#D5DCE6' : '#2C3340'
  const muted = isDark ? '#7E889B' : '#858E9E'

  const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 9 9" style="display:block;flex-shrink:0;">`
    + `<circle cx="4.5" cy="4.5" r="4" fill="${T.main}" opacity="0.24">`
    + `<animate attributeName="opacity" values="0.32;0.1;0.32" dur="3.2s" repeatCount="indefinite"/>`
    + `</circle>`
    + `<circle cx="4.5" cy="4.5" r="2.1" fill="${T.main}"/>`
    + `</svg>`

  const midRule = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 8" preserveAspectRatio="none" style="display:block;width:100%;height:8px;">`
    + `<line x1="0" y1="4" x2="180" y2="4" stroke="${rule}" stroke-width="1"/>`
    + `<line x1="184" y1="4" x2="220" y2="4" stroke="${T.main}" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>`
    + `</svg>`

  const heights = [12, 9, 14, 10, 7, 9, 5.5, 4, 3, 2, 1.5]
  const bars = heights.map((h, idx) => {
    const x = idx * 4.2
    const y = Number(((16 - h) / 2).toFixed(1))
    const fill = idx < 4 ? T.main : muted
    const opacity = idx < 4 ? (0.95 - idx * 0.12).toFixed(2) : Math.max(0.2, 0.65 - (idx - 4) * 0.07).toFixed(2)
    return `<rect x="${x.toFixed(1)}" y="${y}" width="2.1" height="${h}" rx="1.05" fill="${fill}" opacity="${opacity}"/>`
  }).join('')
  const waveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="16" viewBox="0 0 46 16" style="display:block;flex-shrink:0;">${bars}</svg>`

  return `<section data-end-mark="signal" style="margin:42px 0 18px;padding:4px 2px;">`
    + `<section style="display:flex;align-items:center;gap:10px;">`
    + `<section style="display:inline-flex;align-items:center;gap:6px;flex-shrink:0;">`
    + dotSvg
    + `<span style="font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:1.8px;color:${ink};line-height:1;">EOF</span>`
    + `<span style="font-family:${MONO};font-size:10px;letter-spacing:1.2px;color:${muted};line-height:1;">// END</span>`
    + `</section>`
    + `<section style="flex:1;min-width:24px;">${midRule}</section>`
    + waveSvg
    + `</section></section>`
}

export function renderEndMarkHtml(styleId, theme = {}) {
  const id = normalizeEndMark(styleId, 'none')
  if (id === 'none') return ''
  const T = { ...DEFAULT_THEME, ...(theme || {}) }
  if (id === 'colophon') return renderColophonEndMark(T)
  if (id === 'signal') return renderSignalEndMark(T)
  return renderHorizonEndMark(T)
}
