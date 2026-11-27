// 小红书画布矢量氛围背景装饰系统（零 DOM / Node 依赖，纯内联 SVG，100% 随 var(--xhs-*) 换肤）。
// 设计原则：
// 1. 所有装饰只留在四角与边缘留白区，绝不干扰中心正文阅读；
// 2. 支持智能视觉层次（smart）：封面/金句/尾页完整呈现，中间干货页轻透呼应；
// 3. 6 套差异化编辑部/海报/东方/工业矢量氛围风格，一键切换并同步写入 2× PNG / ZIP 导出。

export const XHS_DECOR_PRESETS = Object.freeze([
  { id: 'auto', label: '智能匹配', desc: '按风格自动搭配' },
  { id: 'silk-dots', label: '流光丝带 × 点阵', desc: '流体曲线 + 精致点阵' },
  { id: 'editorial-frame', label: '印刷准星 × 刊角', desc: '杂志裁切线 + 细线角标' },
  { id: 'orbital-arc', label: '几何轨道 × 星芒', desc: '同心弧线 + 极简星芒' },
  { id: 'swiss-grid', label: '瑞士坐标 × 刻度', desc: '建筑十字 + 精密微刻度' },
  { id: 'ink-wash', label: '东方留白 × 柔弧', desc: '暖光晕染 + 轻盈墨弧' },
  { id: 'blueprint-tech', label: '精密蓝图 × 切角', desc: '45° 切角支架 + 工程刻度' },
  { id: 'none', label: '极简无装饰', desc: '纯色底面' },
])

export const XHS_DECOR_SCOPES = Object.freeze([
  { id: 'smart', label: '智能层次（封面浓 · 内页轻）' },
  { id: 'cover', label: '仅封面页' },
  { id: 'all', label: '全套完整' },
  { id: 'none', label: '关闭装饰' },
])

export function resolveAutoDecorPreset({ deckStyle = 'tech', designPrompt = '', artDirection = null } = {}) {
  const text = `${designPrompt || ''} ${artDirection?.genre || ''} ${artDirection?.visualLanguage || ''}`
  if (/手账|备课本|笔记线条/i.test(text)) return 'none'
  if (/工业.*说明书|工具说明书|工程实测|终端/i.test(text)) return 'blueprint-tech'
  if (/瑞士.*荧光笔|瑞士海报|大字报/i.test(text)) return 'swiss-grid'
  if (/纽约客|复古.*报纸|专栏/i.test(text)) return 'editorial-frame'
  if (/monocle|知日|日系.*杂志|暖纸/i.test(text)) return 'ink-wash'
  if (deckStyle === 'editorial') return 'ink-wash'
  if (deckStyle === 'bold') return 'orbital-arc'
  return 'silk-dots'
}

function dotGridSvg(x0, y0, cols, rows, step, r, fill, opacity) {
  const circles = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      circles.push(`<circle cx="${x0 + col * step}" cy="${y0 + row * step}" r="${r}" />`)
    }
  }
  return `<g fill="${fill}" opacity="${opacity}">${circles.join('')}</g>`
}

function renderSilkDotsSvg(subtle) {
  const waveOp = subtle ? 0.52 : 1
  const dotOp = subtle ? 0.22 : 0.42
  // 左上角 10 层流光丝带曲线（仿参考图丝滑波纹）
  const tlPaths = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9
    const yStart = -20 + i * 24
    const c1x = 120 + i * 16
    const c1y = 140 + i * 14
    const c2x = 260 + i * 14
    const c2y = 30 + i * 16
    const xEnd = 430 + i * 12
    const yEnd = -18 + i * 6
    const op = (0.09 + Math.sin(t * Math.PI) * 0.22) * waveOp
    return `<path d="M -24 ${yStart} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xEnd} ${yEnd}" stroke="var(--xhs-accent)" stroke-width="1.35" fill="none" opacity="${op.toFixed(3)}" />`
  }).join('')

  // 右下角 10 层呼应流光丝带
  const brPaths = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9
    const xStart = 650 - i * 12
    const yStart = 1458 - i * 6
    const c1x = 810 - i * 14
    const c1y = 1390 - i * 16
    const c2x = 950 - i * 16
    const c2y = 1280 - i * 14
    const yEnd = 1460 - i * 24
    const op = (0.09 + Math.sin(t * Math.PI) * 0.22) * waveOp
    return `<path d="M ${xStart} ${yStart} C ${c1x} ${c1y}, ${c2x} ${c2y}, 1104 ${yEnd}" stroke="var(--xhs-accent)" stroke-width="1.35" fill="none" opacity="${op.toFixed(3)}" />`
  }).join('')

  const trDots = dotGridSvg(912, 40, 6, 7, 22, 2.3, 'var(--xhs-accent)', dotOp)
  const blDots = subtle ? '' : dotGridSvg(46, 1228, 6, 7, 22, 2.3, 'var(--xhs-accent)', dotOp * 0.9)
  const glow = subtle
    ? ''
    : `<circle cx="96" cy="84" r="240" fill="var(--xhs-accent)" opacity="0.045" /><circle cx="988" cy="1352" r="260" fill="var(--xhs-accent)" opacity="0.045" />`
  return `${glow}${tlPaths}${brPaths}${trDots}${blDots}`
}

function renderEditorialFrameSvg(subtle) {
  const op = subtle ? 0.28 : 0.52
  const accentOp = subtle ? 0.22 : 0.45
  return `
    <g stroke="var(--xhs-ink3)" stroke-width="1.2" fill="none" opacity="${op}">
      <path d="M 26 54 L 26 26 L 54 26 M 1026 26 L 1054 26 L 1054 54 M 26 1386 L 26 1414 L 54 1414 M 1026 1414 L 1054 1414 L 1054 1386" />
      <path d="M 38 14 L 38 30 M 14 38 L 30 38 M 1042 14 L 1042 30 M 1050 38 L 1066 38 M 38 1410 L 38 1426 M 14 1402 L 30 1402 M 1042 1410 L 1042 1426 M 1050 1402 L 1066 1402" stroke-width="0.9" />
    </g>
    <g stroke="var(--xhs-accent)" stroke-width="1.2" fill="none" opacity="${accentOp}">
      <circle cx="38" cy="38" r="5" />
      <circle cx="1042" cy="1402" r="5" />
      ${subtle ? '' : '<path d="M 960 26 L 1054 26 L 1054 120" stroke-width="2" /><path d="M 26 1320 L 26 1414 L 120 1414" stroke-width="2" />'}
    </g>
  `
}

function renderOrbitalArcSvg(subtle) {
  const op = subtle ? 0.14 : 0.24
  const solidOp = subtle ? 0.25 : 0.55
  return `
    <g fill="none" stroke="var(--xhs-accent)">
      <circle cx="1050" cy="40" r="240" stroke-width="1.2" opacity="${op}" />
      <circle cx="1050" cy="40" r="320" stroke-width="1" stroke-dasharray="6 8" opacity="${(op * 0.8).toFixed(3)}" />
      <circle cx="30" cy="1400" r="220" stroke-width="1.2" opacity="${op}" />
      ${subtle ? '' : `<circle cx="30" cy="1400" r="300" stroke-width="1" stroke-dasharray="5 9" opacity="${(op * 0.7).toFixed(3)}" />`}
    </g>
    <g fill="var(--xhs-accent)" opacity="${solidOp}">
      <circle cx="880" cy="210" r="5" />
      <path d="M 988 118 L 992 130 L 1004 134 L 992 138 L 988 150 L 984 138 L 972 134 L 984 130 Z" />
      ${subtle ? '' : '<circle cx="186" cy="1244" r="4.5" /><path d="M 88 1286 L 91 1295 L 100 1298 L 91 1301 L 88 1310 L 85 1301 L 76 1298 L 85 1295 Z" opacity="0.7" />'}
    </g>
  `
}

function renderSwissGridSvg(subtle) {
  const op = subtle ? 0.22 : 0.42
  const cross = (cx, cy) => `<path d="M ${cx - 9} ${cy} L ${cx + 9} ${cy} M ${cx} ${cy - 9} L ${cx} ${cy + 9}" />`
  const ticksTop = Array.from({ length: 13 }, (_, i) => {
    const x = 140 + i * 66
    const h = i % 3 === 0 ? 12 : 6
    return `<line x1="${x}" y1="16" x2="${x}" y2="${16 + h}" />`
  }).join('')
  const ticksBottom = subtle ? '' : Array.from({ length: 13 }, (_, i) => {
    const x = 140 + i * 66
    const h = i % 3 === 0 ? 12 : 6
    return `<line x1="${x}" y1="${1424 - h}" x2="${x}" y2="1424" />`
  }).join('')
  return `
    <g stroke="var(--xhs-ink3)" stroke-width="1.3" opacity="${op}">
      ${cross(34, 34)}${cross(1046, 34)}${cross(34, 1406)}${cross(1046, 1406)}
    </g>
    <g stroke="var(--xhs-line)" stroke-width="1" opacity="${subtle ? 0.45 : 0.75}">
      ${ticksTop}${ticksBottom}
    </g>
    ${dotGridSvg(958, 52, 4, 4, 20, 2, 'var(--xhs-accent)', subtle ? 0.2 : 0.36)}
    ${subtle ? '' : dotGridSvg(44, 1310, 4, 4, 20, 2, 'var(--xhs-accent)', 0.32)}
  `
}

function renderInkWashSvg(subtle) {
  const washOp = subtle ? 0.04 : 0.075
  const arcOp = subtle ? 0.16 : 0.3
  return `
    <circle cx="60" cy="40" r="290" fill="var(--xhs-accent)" opacity="${washOp}" />
    <circle cx="1030" cy="1390" r="320" fill="var(--xhs-accent)" opacity="${washOp}" />
    <path d="M -30 220 Q 160 150, 290 -20" stroke="var(--xhs-accent)" stroke-width="2" fill="none" opacity="${arcOp}" />
    <path d="M -20 248 Q 185 170, 326 -20" stroke="var(--xhs-accent)" stroke-width="1" fill="none" opacity="${(arcOp * 0.65).toFixed(3)}" />
    <path d="M 790 1460 Q 920 1280, 1110 1210" stroke="var(--xhs-accent)" stroke-width="2" fill="none" opacity="${arcOp}" />
    ${subtle ? '' : '<path d="M 754 1460 Q 896 1265, 1110 1184" stroke="var(--xhs-accent)" stroke-width="1" fill="none" opacity="0.18" />'}
  `
}

function renderBlueprintTechSvg(subtle) {
  const op = subtle ? 0.22 : 0.42
  return `
    <g stroke="var(--xhs-accent)" stroke-width="1.4" fill="none" opacity="${op}">
      <path d="M 24 88 L 24 40 L 40 24 L 116 24" />
      <path d="M 964 24 L 1040 24 L 1056 40 L 1056 88" />
      <path d="M 24 1352 L 24 1400 L 40 1416 L 116 1416" />
      <path d="M 964 1416 L 1040 1416 L 1056 1400 L 1056 1352" />
      ${subtle ? '' : '<path d="M 920 24 L 944 48 L 1018 48" stroke-width="1" /><circle cx="1024" cy="48" r="4" /><path d="M 160 1416 L 136 1392 L 62 1392" stroke-width="1" /><circle cx="56" cy="1392" r="4" />'}
    </g>
    ${dotGridSvg(970, 68, 4, 3, 18, 1.8, 'var(--xhs-accent)', subtle ? 0.16 : 0.32)}
  `
}

export function renderCardAmbientDecor({
  preset = 'auto',
  scope = 'smart',
  cardKind = 'list',
  deckStyle = 'tech',
  designPrompt = '',
  artDirection = null,
} = {}) {
  if (preset === 'none' || scope === 'none') return ''
  if (scope === 'cover' && cardKind !== 'cover') return ''

  const resolvedPreset = preset === 'auto'
    ? resolveAutoDecorPreset({ deckStyle, designPrompt, artDirection })
    : preset
  if (!resolvedPreset || resolvedPreset === 'none') return ''

  const isHeroPage = cardKind === 'cover' || cardKind === 'quote' || cardKind === 'end'
  const subtle = scope === 'smart' && !isHeroPage

  let inner = ''
  switch (resolvedPreset) {
    case 'silk-dots':
      inner = renderSilkDotsSvg(subtle)
      break
    case 'editorial-frame':
      inner = renderEditorialFrameSvg(subtle)
      break
    case 'orbital-arc':
      inner = renderOrbitalArcSvg(subtle)
      break
    case 'swiss-grid':
      inner = renderSwissGridSvg(subtle)
      break
    case 'ink-wash':
      inner = renderInkWashSvg(subtle)
      break
    case 'blueprint-tech':
      inner = renderBlueprintTechSvg(subtle)
      break
    default:
      return ''
  }

  return `<svg class="xhs-ambient-decor" data-xhs-decor="1" data-decor-preset="${resolvedPreset}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1440" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`
}
