// 小红书 1080×1440 HTML/CSS 视觉画布基础样式与兜底合成引擎。
// 纯函数模块：不依赖 node:*，也不访问浏览器全局 DOM 对象，可同时在 Node 测试与浏览器运行。
// 配色主题（XHS_STYLE_PRESETS）与页面自由 HTML/CSS 结构彻底正交：
// 切换配色主题仅更新 --xhs-* CSS 变量，绝不覆写已生成的卡片 HTML；
// 内置 .cd-* / .mn-* / .nb-* / .cb-* 组件类库供自由生成 HTML 混用，同时提供 8 种卡型兜底合成。

import {
  DERIVE_LIMITS,
  sanitizeCardImageUrl,
  sanitizeXhsCardHtml,
  sanitizeXhsCss,
} from '../src/derive-shared.js'

export const XHS_STYLE_PRESETS = [
  {
    id: 'claude',
    label: 'Claude 词元紫',
    desc: '经典紫白高对比，清透科技感',
    accent: '#6D3BF2',
    accentSoft: '#F2EEFF',
    accentLine: '#C9B8FC',
    bg: '#F7F7FA',
    cardBg: '#FFFFFF',
    mutedBg: '#F1F1F6',
    darkBg: '#160B38',
    ink: '#0A0A0A',
    ink2: '#525263',
    ink3: '#8A8A9E',
    line: '#E4E4EE',
  },
  {
    id: 'editorial',
    label: 'Anthropic 暖砂',
    desc: '杂志陶土橙与暖砂纸感，柔和高级',
    accent: '#C85A32',
    accentSoft: '#F9EFEA',
    accentLine: '#E6B8A6',
    bg: '#FAF7F2',
    cardBg: '#FFFFFF',
    mutedBg: '#F2EDE6',
    darkBg: '#22140E',
    ink: '#141210',
    ink2: '#57504A',
    ink3: '#8C827A',
    line: '#D8CFC3',
  },
  {
    id: 'tech',
    label: '冷白科技蓝',
    desc: '工程蓝与浅灰网格，理性架构感',
    accent: '#2563EB',
    accentSoft: '#EDF3FF',
    accentLine: '#B6CEFA',
    bg: '#F6F8FC',
    cardBg: '#FFFFFF',
    mutedBg: '#EEF2F8',
    darkBg: '#0E1B38',
    ink: '#0B1220',
    ink2: '#4B5565',
    ink3: '#8490A3',
    line: '#E1E7F0',
  },
  {
    id: 'emerald',
    label: '极客青绿',
    desc: '清透薄荷底与森林绿高光，清爽利落',
    accent: '#059669',
    accentSoft: '#E8F8F2',
    accentLine: '#A7E3CB',
    bg: '#F6FAF8',
    cardBg: '#FFFFFF',
    mutedBg: '#ECF3F0',
    darkBg: '#09241C',
    ink: '#0A1814',
    ink2: '#485E56',
    ink3: '#7E968E',
    line: '#DCE8E3',
  },
  {
    id: 'bold',
    label: '海报洋红',
    desc: '高反差红黑撞色，强视觉冲击力',
    accent: '#E11D48',
    accentSoft: '#FFE4E8',
    accentLine: '#FDA4AF',
    bg: '#F8F7F9',
    cardBg: '#FFFFFF',
    mutedBg: '#F1EFF4',
    darkBg: '#141118',
    ink: '#0A0A0C',
    ink2: '#52505B',
    ink3: '#8B8896',
    line: '#E5E3EC',
  },
  {
    id: 'theme',
    label: '跟随排版主题',
    desc: '自动继承当前公众号文章的主题色板',
    accent: '#6D3BF2',
    accentSoft: '#F2EEFF',
    accentLine: '#C9B8FC',
    bg: '#F7F7FA',
    cardBg: '#FFFFFF',
    mutedBg: '#F1F1F6',
    darkBg: '#161822',
    ink: '#0A0A0A',
    ink2: '#525263',
    ink3: '#8A8A9E',
    line: '#E4E4EE',
  },
]

const LEGACY_PRESET_MAP = {
  manual: 'editorial',
  notebook: 'editorial',
  chalkboard: 'emerald',
}

export const FONT_FAMILIES = {
  noto: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif',
  pingfang: '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
  serif: '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
  mono: '"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
}

export const DEFAULT_XHS_TWEAKS = {
  preset: 'claude',
  accent: '',
  surface: '',
  cardBg: '',
  scale: 1,
  density: 1,
  radius: 20,
  font: 'noto',
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function resolvePresetConfig({ deckStyle = 'tech', tweaks = {} } = {}) {
  const merged = { ...DEFAULT_XHS_TWEAKS, ...(tweaks || {}) }
  let presetId = merged.preset
  if (presetId && LEGACY_PRESET_MAP[presetId]) {
    presetId = LEGACY_PRESET_MAP[presetId]
  }
  if (!presetId) {
    presetId = deckStyle === 'editorial' ? 'editorial' : deckStyle === 'bold' ? 'bold' : 'claude'
  }
  return XHS_STYLE_PRESETS.find(p => p.id === presetId) || XHS_STYLE_PRESETS[0]
}

export function resolveXhsThemeVars({ deckStyle = 'tech', palette = {}, tweaks = {} } = {}) {
  const merged = { ...DEFAULT_XHS_TWEAKS, ...(tweaks || {}) }
  const base = resolvePresetConfig({ deckStyle, tweaks })
  const useThemePalette = base.id === 'theme' && palette?.main

  const accent = merged.accent || (useThemePalette ? palette.main : base.accent)
  const accentSoft = useThemePalette ? (palette.tint || base.accentSoft) : base.accentSoft
  const accentLine = useThemePalette ? (palette.line || base.accentLine) : base.accentLine
  const bg = merged.surface || (useThemePalette ? (palette.soft || base.bg) : base.bg)
  const cardBg = merged.cardBg || base.cardBg
  const scale = typeof merged.scale === 'number' && Number.isFinite(merged.scale) ? merged.scale : 1
  const density = typeof merged.density === 'number' && Number.isFinite(merged.density) ? merged.density : 1
  const radius = typeof merged.radius === 'number' && Number.isFinite(merged.radius) ? merged.radius : 20
  const fontStack = FONT_FAMILIES[merged.font] || FONT_FAMILIES.noto

  return {
    '--xhs-accent': accent,
    '--xhs-tint': accentSoft,
    '--xhs-accent-line': accentLine,
    '--xhs-bg': bg,
    '--xhs-card': cardBg,
    '--xhs-muted-bg': base.mutedBg,
    '--xhs-dark': base.darkBg,
    '--xhs-ink': base.ink,
    '--xhs-ink2': base.ink2,
    '--xhs-ink3': base.ink3,
    '--xhs-line': base.line,
    '--xhs-scale': String(scale),
    '--xhs-density': String(density),
    '--xhs-radius': `${radius}px`,
    '--xhs-font': fontStack,
    '--xhs-mono': FONT_FAMILIES.mono,
  }
}

export function themeVarsToCssText(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}

export const XHS_ARTBOARD_CSS = `
.xhs-artboard, .xhs-artboard * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.xhs-artboard {
  width: 1080px;
  height: 1440px;
  padding: calc(62px * var(--xhs-density, 1)) calc(68px * var(--xhs-density, 1)) calc(48px * var(--xhs-density, 1));
  background: var(--xhs-bg, #F7F7FA);
  color: var(--xhs-ink, #0A0A0A);
  font-family: var(--xhs-font, "Noto Sans SC", "PingFang SC", sans-serif);
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  font-size: calc(26px * var(--xhs-scale, 1));
  line-height: 1.45;
  gap: calc(22px * var(--xhs-density, 1));
  position: relative;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
.xhs-artboard :where(h1, h2, h3, h4, strong, b) {
  line-height: 1.28;
}
.xhs-artboard :where(p, li, span, div, td, th) {
  line-height: 1.45;
}
.xhs-artboard.is-dark-artboard {
  background: #12131A;
  color: #F7F8FC;
  --xhs-bg: #12131A !important;
  --xhs-card: #1C1E2A !important;
  --xhs-muted-bg: #232636 !important;
  --xhs-ink: #F7F8FC !important;
  --xhs-ink2: #A6ACCD !important;
  --xhs-ink3: #6E7494 !important;
  --xhs-line: #2E3247 !important;
}
.cd-ribbon {
  position: absolute;
  top: -20px;
  right: 76px;
  width: 240px;
  height: 210px;
  background: linear-gradient(155deg, color-mix(in srgb, var(--xhs-accent) 26%, #FFFFFF), color-mix(in srgb, var(--xhs-accent) 8%, #FFFFFF));
  clip-path: polygon(24% 0%, 100% 0%, 74% 100%, 0% 78%);
  border-radius: 0 0 28px 28px;
  pointer-events: none;
  z-index: 0;
}
.cd-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  z-index: 1;
}
.cd-eyebrow-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.cd-eyebrow {
  font-size: calc(23px * var(--xhs-scale, 1));
  font-weight: 800;
  color: var(--xhs-accent, #6D3BF2);
  letter-spacing: 0.01em;
  line-height: 1.3;
}
.cd-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 18px;
  border-radius: 999px;
  background: #E5F7ED;
  color: #15803D;
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 800;
  line-height: 1.2;
}
.cd-accent-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 18px;
  border-radius: 999px;
  background: var(--xhs-tint, #F2EEFF);
  color: var(--xhs-accent, #6D3BF2);
  border: 1px solid var(--xhs-accent-line, #C9B8FC);
  font-size: calc(21px * var(--xhs-scale, 1));
  font-weight: 800;
  line-height: 1.2;
}
.cd-eyebrow-sub {
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 600;
  color: var(--xhs-ink2, #525263);
}
.cd-title {
  font-size: calc(56px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-ink, #0A0A0A);
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.cd-title-xl {
  font-size: calc(70px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-ink, #0A0A0A);
  line-height: 1.18;
  letter-spacing: -0.025em;
}
.cd-hl {
  color: var(--xhs-accent, #6D3BF2);
}
.cd-sub {
  font-size: calc(25px * var(--xhs-scale, 1));
  font-weight: 500;
  color: var(--xhs-ink2, #525263);
  line-height: 1.45;
}
.cd-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: calc(20px * var(--xhs-density, 1));
  position: relative;
  z-index: 1;
}
.cd-code-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.cd-code-pill {
  display: inline-flex;
  align-items: center;
  padding: 8px 18px;
  border-radius: 10px;
  background: var(--xhs-muted-bg, #F1F1F6);
  color: var(--xhs-ink, #0A0A0A);
  font-family: var(--xhs-mono, monospace);
  font-size: calc(21px * var(--xhs-scale, 1));
  font-weight: 700;
}
.cd-dark-pill {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  align-self: flex-start;
  padding: 14px 26px;
  border-radius: 14px;
  background: var(--xhs-dark, #160B38);
  color: #FFFFFF;
  font-size: calc(26px * var(--xhs-scale, 1));
  font-weight: 800;
}
.cd-outline-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.cd-outline-tag {
  display: inline-flex;
  align-items: center;
  padding: 10px 22px;
  border-radius: 12px;
  background: var(--xhs-card, #FFFFFF);
  border: 2px solid var(--xhs-accent-line, #C9B8FC);
  color: var(--xhs-accent, #6D3BF2);
  font-size: calc(23px * var(--xhs-scale, 1));
  font-weight: 800;
}
.cd-card, .cd-table-card, .xhs-artboard :where(.cd-panel) {
  background: var(--xhs-card, #FFFFFF);
  border: 1.5px solid var(--xhs-line, #E4E4EE);
  border-radius: var(--xhs-radius, 20px);
  padding: calc(24px * var(--xhs-density, 1)) calc(28px * var(--xhs-density, 1));
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 6px 24px rgba(15, 15, 35, 0.03);
}
.xhs-artboard :where(.cd-panel > strong) {
  font-size: calc(28px * var(--xhs-scale, 1));
  font-weight: 800;
  color: var(--xhs-ink, #0A0A0A);
  line-height: 1.3;
}
.xhs-artboard :where(.cd-panel > p) {
  font-size: calc(22px * var(--xhs-scale, 1));
  color: var(--xhs-ink2, #525263);
  line-height: 1.48;
}
.cd-grow {
  flex: 1;
  justify-content: space-between;
}
.cd-section-tag {
  font-size: calc(23px * var(--xhs-scale, 1));
  font-weight: 800;
  color: var(--xhs-ink, #0A0A0A);
}
.cd-section-tag.is-accent {
  color: var(--xhs-accent, #6D3BF2);
}
.cd-table {
  width: 100%;
  border-collapse: collapse;
}
.cd-table th {
  text-align: left;
  font-size: calc(20px * var(--xhs-scale, 1));
  font-weight: 700;
  color: var(--xhs-ink3, #8A8A9E);
  padding: 8px 10px 12px 0;
  border-bottom: 1.5px solid var(--xhs-line, #E4E4EE);
}
.cd-table td {
  padding: 14px 10px 14px 0;
  border-bottom: 1px solid var(--xhs-line, #E4E4EE);
  font-size: calc(23px * var(--xhs-scale, 1));
  color: var(--xhs-ink, #0A0A0A);
  vertical-align: middle;
}
.cd-table tr:last-child td {
  border-bottom: none;
}
.cd-table td.is-bold {
  font-weight: 800;
  width: 28%;
}
.cd-table td.is-muted {
  color: var(--xhs-ink2, #525263);
}
.cd-alert-bar {
  padding: 14px 20px;
  border-radius: 12px;
  background: #FFF1F0;
  color: #E11D48;
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 10px;
}
.cd-flow-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(34px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-ink, #0A0A0A);
  line-height: 1;
}
.cd-dark-panel {
  background: var(--xhs-dark, #160B38);
  color: #FFFFFF;
  border-radius: calc(var(--xhs-radius, 20px) - 4px);
  padding: 20px 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.cd-dark-panel-title {
  font-size: calc(28px * var(--xhs-scale, 1));
  font-weight: 900;
  color: #FFFFFF;
}
.cd-dark-panel-tag {
  font-size: calc(21px * var(--xhs-scale, 1));
  font-weight: 700;
  color: #D8CEFF;
  background: rgba(255, 255, 255, 0.12);
  padding: 6px 16px;
  border-radius: 999px;
}
.cd-card.cd-grow + .cd-col-grid:has(> .cd-bento > .cd-bento-body) {
  flex: 0 0 auto;
}
.cd-col-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
  gap: 16px;
  flex: 1;
}
.cd-metrics-grid {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.cd-metrics-grid .cd-metric-num {
  overflow-wrap: anywhere;
}
.cd-bento {
  background: var(--xhs-card, #FFFFFF);
  border: 1.5px solid var(--xhs-line, #E4E4EE);
  border-radius: calc(var(--xhs-radius, 20px) - 4px);
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 14px;
}
.cd-bento.is-tint {
  background: var(--xhs-tint, #F2EEFF);
  border-color: var(--xhs-accent-line, #C9B8FC);
}
.cd-bento-title {
  font-size: calc(28px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-accent, #6D3BF2);
  line-height: 1.25;
}
.cd-bento-title.is-ink {
  color: var(--xhs-ink, #0A0A0A);
}
.cd-bento-body {
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 500;
  color: var(--xhs-ink2, #525263);
  line-height: 1.5;
}
.cd-metric-num {
  font-size: calc(50px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-accent, #6D3BF2);
  line-height: 1.08;
  letter-spacing: -0.02em;
}
.cd-metric-label {
  font-size: calc(21px * var(--xhs-scale, 1));
  font-weight: 700;
  color: var(--xhs-ink2, #525263);
}
.cd-metric-sub {
  font-size: calc(19px * var(--xhs-scale, 1));
  color: var(--xhs-ink3, #8A8A9E);
  line-height: 1.4;
}
.cd-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 28px;
  padding: 20px 26px;
  background: var(--xhs-card, #FFFFFF);
  border: 1.5px solid var(--xhs-line, #E4E4EE);
  border-radius: var(--xhs-radius, 20px);
}
.cd-kv-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cd-kv-k {
  font-size: calc(19px * var(--xhs-scale, 1));
  font-weight: 600;
  color: var(--xhs-ink3, #8A8A9E);
}
.cd-kv-v {
  font-size: calc(24px * var(--xhs-scale, 1));
  font-weight: 800;
  color: var(--xhs-ink, #0A0A0A);
}
.cd-step-list {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
  flex: 1;
}
.cd-step-item {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 22px 24px;
  border-radius: calc(var(--xhs-radius, 20px) - 2px);
  background: var(--xhs-muted-bg, #F1F1F6);
  flex: 1;
}
.cd-step-num {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  background: var(--xhs-accent, #6D3BF2);
  color: #FFFFFF;
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  margin-top: 2px;
}
.cd-step-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.cd-step-title {
  font-size: calc(28px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-ink, #0A0A0A);
  line-height: 1.3;
}
.cd-step-desc {
  font-size: calc(23px * var(--xhs-scale, 1));
  font-weight: 500;
  color: var(--xhs-ink2, #525263);
  line-height: 1.45;
}
.cd-slot {
  border: 2.5px dashed var(--xhs-accent-line, #C9B8FC);
  background: color-mix(in srgb, var(--xhs-tint, #F2EEFF) 72%, #FFFFFF);
  border-radius: var(--xhs-radius, 20px);
  padding: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  min-height: 240px;
  flex: 1;
}
.cd-slot-title {
  font-size: calc(28px * var(--xhs-scale, 1));
  font-weight: 900;
  color: var(--xhs-accent, #6D3BF2);
}
.cd-slot-sub {
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 600;
  color: var(--xhs-accent, #6D3BF2);
  opacity: 0.85;
}
.cd-shot-window {
  background: var(--xhs-card, #FFFFFF);
  border: 1.5px solid var(--xhs-line, #E4E4EE);
  border-radius: var(--xhs-radius, 20px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 240px;
  box-shadow: 0 8px 28px rgba(15, 15, 35, 0.06);
}
.cd-shot-bar {
  height: 42px;
  padding: 0 18px;
  background: var(--xhs-muted-bg, #F1F1F6);
  border-bottom: 1px solid var(--xhs-line, #E4E4EE);
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  position: relative;
  z-index: 2;
}
.cd-shot-dot {
  width: 11px;
  height: 11px;
  border-radius: 999px;
}
.cd-shot-label {
  margin-left: auto;
  font-size: 16px;
  font-weight: 800;
  color: var(--xhs-accent, #6D3BF2);
  background: var(--xhs-tint, #F2EEFF);
  padding: 2px 10px;
  border-radius: 6px;
}
.cd-shot-frame {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  position: relative;
  background: var(--xhs-card, #FFFFFF);
}
.cd-shot-img {
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  object-fit: cover;
  object-position: 50% 50%;
  display: block;
}
.cd-callout {
  background: var(--xhs-tint, #F2EEFF);
  border: 1.5px solid var(--xhs-accent-line, #C9B8FC);
  border-radius: calc(var(--xhs-radius, 20px) - 2px);
  padding: 20px 26px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cd-callout-line {
  font-size: calc(23px * var(--xhs-scale, 1));
  font-weight: 800;
  color: var(--xhs-ink, #0A0A0A);
  line-height: 1.45;
}
.cd-cover-wave {
  margin: 0 calc(-68px * var(--xhs-density, 1)) calc(-48px * var(--xhs-density, 1));
  padding: 36px calc(68px * var(--xhs-density, 1)) 40px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--xhs-accent) 22%, #FFFFFF), color-mix(in srgb, var(--xhs-accent) 10%, #FFFFFF));
  border-top: 1px solid var(--xhs-accent-line, #C9B8FC);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.cd-wave-meta {
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 700;
  color: var(--xhs-ink, #0A0A0A);
}
.cd-wave-cta {
  padding: 12px 26px;
  border-radius: 999px;
  background: #FFFFFF;
  color: var(--xhs-ink, #0A0A0A);
  font-size: calc(22px * var(--xhs-scale, 1));
  font-weight: 800;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.cd-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: calc(20px * var(--xhs-scale, 1));
  font-weight: 600;
  color: var(--xhs-ink3, #8A8A9E);
  padding-top: 4px;
  position: relative;
  z-index: 1;
}
.cd-footer > :only-child {
  flex: 1;
  width: 100%;
}

/* === 流派 B：说明书（大号数字 + 黄色标签工具手册风）=== */
.mn-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18px;
  border-bottom: 2.5px solid #111111;
  font-size: calc(24px * var(--xhs-scale, 1));
  font-weight: 900;
  color: #111111;
}
.mn-formula-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mn-io-label {
  font-size: calc(25px * var(--xhs-scale, 1));
  font-weight: 700;
  color: #78746C;
}
.mn-io-row {
  display: flex;
  align-items: center;
  gap: 22px;
  flex-wrap: wrap;
}
.mn-io-huge {
  font-size: calc(74px * var(--xhs-scale, 1));
  font-weight: 900;
  color: #111111;
  line-height: 1.08;
  letter-spacing: -0.03em;
}
.mn-yellow-tag {
  display: inline-flex;
  align-items: center;
  padding: 12px 26px;
  background: #FACC15;
  color: #111111;
  font-size: calc(30px * var(--xhs-scale, 1));
  font-weight: 900;
  transform: rotate(-2.2deg);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.mn-yellow-box {
  display: inline-flex;
  align-items: center;
  padding: 6px 18px;
  background: #FACC15;
  color: #111111;
  font-size: calc(27px * var(--xhs-scale, 1));
  font-weight: 900;
}
.mn-spec-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 2px solid #111111;
  border-bottom: 2px solid #111111;
}
.mn-spec-cell {
  padding: 18px 20px;
  border-right: 1.5px solid #111111;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mn-spec-cell:first-child {
  padding-left: 4px;
}
.mn-spec-cell:last-child {
  border-right: none;
}
.mn-spec-k {
  font-size: calc(20px * var(--xhs-scale, 1));
  font-weight: 600;
  color: #78746C;
}
.mn-spec-v {
  font-size: calc(28px * var(--xhs-scale, 1));
  font-weight: 900;
  color: #111111;
  line-height: 1.25;
}
.mn-step-hero {
  display: flex;
  align-items: center;
  gap: 32px;
}
.mn-giant-num {
  font-size: calc(134px * var(--xhs-scale, 1));
  font-weight: 900;
  color: #111111;
  line-height: 0.86;
  letter-spacing: -0.05em;
  font-family: "Arial Black", "Helvetica Neue", var(--xhs-font);
}
.mn-frame-box {
  background: #FFFFFF;
  border: 2.5px solid #111111;
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.mn-pin-num {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: #111111;
  color: #FFFFFF;
  font-size: 21px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

/* === 流派 A：备课本（红笔圈画 + 黄色便利贴手账风）=== */
.nb-paper {
  background-color: #FCFBF6;
  background-image: repeating-linear-gradient(180deg, transparent 0px, transparent 52px, rgba(190, 180, 162, 0.24) 53px);
}
.nb-stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 24px;
  border: 2.5px solid #C83E31;
  border-radius: 999px;
  color: #C83E31;
  font-size: calc(24px * var(--xhs-scale, 1));
  font-weight: 900;
  box-shadow: inset 0 0 0 2px #FCFBF6, inset 0 0 0 3.5px rgba(200, 62, 49, 0.55);
  transform: rotate(-2deg);
}
.nb-red-note {
  color: #C83E31;
  font-size: calc(27px * var(--xhs-scale, 1));
  font-weight: 800;
  letter-spacing: 0.01em;
}
.nb-red-circle {
  display: inline-block;
  padding: 2px 16px;
  border: 3px solid #C83E31;
  border-radius: 50% 45% 52% 48% / 45% 52% 48% 50%;
  color: var(--xhs-ink, #181615);
}
.nb-dark-cmd {
  background: #221F1D;
  color: #FFFFFF;
  padding: 22px 28px;
  border-radius: 16px;
  font-size: calc(25px * var(--xhs-scale, 1));
  font-weight: 800;
  line-height: 1.45;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}
.nb-sticky {
  background: #FFF09E;
  color: #1F1B16;
  padding: 24px 28px;
  border-radius: 6px;
  box-shadow: 0 10px 24px rgba(80, 65, 20, 0.12);
  transform: rotate(-1.4deg);
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-left: 4px solid #E5C94C;
}
.nb-fill-blank {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding-top: 12px;
  font-size: calc(34px * var(--xhs-scale, 1));
  font-weight: 900;
}
.nb-blank-line {
  flex: 1;
  border-bottom: 3px solid #181615;
  color: #C83E31;
  font-size: calc(44px * var(--xhs-scale, 1));
  font-weight: 900;
  text-align: center;
  padding-bottom: 4px;
}

/* === 流派 C：黑板（粉笔字 + 磁吸贴课堂板书风）=== */
.cb-board {
  background: radial-gradient(circle at 30% 25%, #2D4D3F 0%, #223B30 70%, #1C3128 100%);
  border: 20px solid #6E4E32;
  box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.32);
  color: #F6F8F6;
}
.cb-chalk-yellow {
  color: #F6D365;
}
.cb-chalk-underline {
  text-decoration: underline wavy #F6D365;
  text-underline-offset: 10px;
}
.cb-pinned-paper {
  background: #FFFFFF;
  color: #18181B;
  border-radius: 12px;
  padding: 30px 28px 24px;
  position: relative;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
  transform: rotate(-0.6deg);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.cb-magnet {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  position: absolute;
  top: -15px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35), inset 0 3px 5px rgba(255, 255, 255, 0.4);
  z-index: 5;
}
.cb-chalk-tray {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 2px solid rgba(255, 255, 255, 0.16);
  color: #B7D0C4;
  font-size: calc(20px * var(--xhs-scale, 1));
  font-weight: 700;
}

/* ==================== 1. 复古科技报纸 / 纽约客专栏原语 (.ny-*) ==================== */
.ny-masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border-top: 3px solid var(--xhs-ink);
  border-bottom: 1px solid var(--xhs-ink);
  padding: 10px 0;
  font-family: var(--xhs-mono);
  font-size: 18px;
  line-height: 1.2;
  letter-spacing: 0.08em;
  color: var(--xhs-ink2);
  text-transform: uppercase;
}
.ny-kicker {
  font-family: var(--xhs-mono);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.09em;
  color: var(--xhs-accent);
  text-transform: uppercase;
  line-height: 1.3;
}
.ny-serif-title {
  margin: 0;
  font-family: Georgia, "Songti SC", "Noto Serif SC", serif;
  font-size: calc(60px * var(--xhs-scale, 1));
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--xhs-ink);
}
.ny-pullquote {
  margin: 0;
  padding: 0 0 8px;
  border-bottom: 2px solid var(--xhs-accent);
  font-family: Georgia, "Songti SC", "Noto Serif SC", serif;
  font-size: calc(30px * var(--xhs-scale, 1));
  font-weight: 800;
  line-height: 1.38;
  color: var(--xhs-ink);
}
.ny-dropcap {
  float: left;
  font-family: Georgia, "Songti SC", "Noto Serif SC", serif;
  font-size: calc(74px * var(--xhs-scale, 1));
  font-weight: 900;
  line-height: 0.86;
  padding: 6px 12px 0 0;
  color: var(--xhs-ink);
}
.ny-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
  flex: 1;
  min-height: 0;
}
.ny-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.ny-cols > .ny-col + .ny-col {
  border-left: 1px solid var(--xhs-line);
  padding-left: 28px;
}
.ny-fig {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--xhs-line);
  background: var(--xhs-card);
}
.ny-fig img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
}
.ny-fig-cap {
  font-family: var(--xhs-mono);
  font-size: 18px;
  line-height: 1.35;
  color: var(--xhs-ink3);
}
.ny-ledger {
  display: flex;
  height: 14px;
  width: 100%;
  background: var(--xhs-muted-bg);
  border: 1px solid var(--xhs-line);
  overflow: hidden;
}
.ny-ledger-fill {
  background: var(--xhs-accent);
  height: 100%;
}
.ny-endmark {
  display: inline-block;
  color: var(--xhs-ink);
  font-size: 18px;
  line-height: 1;
}

/* ==================== 2. 瑞士大字报 + 荧光笔批注原语 (.sw-* / .hl-mark) ==================== */
.sw-heavy-rule,
.swiss-heavy-rule {
  border: 0;
  border-top: 3px solid var(--xhs-ink);
  margin: 0;
}
.sw-rule,
.swiss-rule {
  border: 0;
  border-top: 1px solid var(--xhs-line);
  margin: 0;
}
.sw-anchor {
  font-size: calc(88px * var(--xhs-scale, 1));
  font-weight: 900;
  line-height: 0.96;
  letter-spacing: -0.04em;
  color: var(--xhs-ink);
}
.hl-mark {
  background: linear-gradient(180deg, transparent 52%, rgba(250, 204, 21, 0.5) 52%, rgba(250, 204, 21, 0.5) 92%, transparent 92%);
  padding: 0 4px;
}
.sw-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px 32px;
}
.sw-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--xhs-line);
}
.sw-note {
  padding: 18px 22px;
  background: var(--xhs-tint);
  border-left: 5px solid var(--xhs-accent);
  font-size: calc(23px * var(--xhs-scale, 1));
  line-height: 1.48;
  color: var(--xhs-ink);
}

/* ==================== 3. Monocle 日系深度杂志原语 (.mo-*) ==================== */
.mo-issue-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--xhs-line);
  font-family: var(--xhs-mono);
  font-size: 18px;
  letter-spacing: 0.1em;
  color: var(--xhs-ink3);
  text-transform: uppercase;
}
.mo-giant-num {
  font-family: Georgia, "Songti SC", "Noto Serif SC", serif;
  font-size: calc(96px * var(--xhs-scale, 1));
  font-weight: 400;
  line-height: 0.88;
  color: var(--xhs-line);
  letter-spacing: -0.04em;
}
.mo-body-with-rail {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 24px;
  flex: 1;
  min-height: 0;
}
.mo-rail {
  writing-mode: vertical-rl;
  font-size: 18px;
  letter-spacing: 0.16em;
  color: var(--xhs-ink3);
  border-right: 1px solid var(--xhs-line);
  padding-right: 14px;
  display: flex;
  align-items: flex-start;
}
.mo-split {
  display: grid;
  grid-template-columns: 0.36fr 0.64fr;
  gap: 28px;
  align-items: start;
}
.mo-hairline-item {
  padding: 18px 0;
  border-top: 1px solid var(--xhs-line);
}
.mo-letter-end {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px 32px;
  background: var(--xhs-card);
  border-top: 2px solid var(--xhs-ink);
  border-bottom: 1px solid var(--xhs-line);
}

/* ==================== 4. 工业工具说明书原语 (.ind-*) ==================== */
.ind-tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  background: var(--xhs-ink);
  color: #FFFFFF;
  font-family: var(--xhs-mono);
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1.2;
}
.ind-tag-accent {
  background: var(--xhs-accent);
  color: #FFFFFF;
}
.ind-tag-tint {
  background: var(--xhs-tint);
  color: var(--xhs-accent);
  border: 1px solid var(--xhs-accent-line);
}
.ind-giant-num {
  font-family: var(--xhs-mono);
  font-size: calc(88px * var(--xhs-scale, 1));
  font-weight: 900;
  line-height: 0.92;
  letter-spacing: -0.04em;
  color: var(--xhs-accent);
}
.ind-io-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 18px 22px;
  background: var(--xhs-dark);
  color: #FFFFFF;
}
.ind-io-bar * {
  color: #FFFFFF;
}
.ind-spec-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 18px;
  padding: 14px 0;
  border-bottom: 1px solid var(--xhs-line);
  align-items: baseline;
}
.ind-tear-note {
  padding: 18px 22px;
  background: var(--xhs-dark);
  color: #FFFFFF;
  border-top: 2px dashed rgba(255, 255, 255, 0.35);
}
.ind-tear-note * {
  color: #FFFFFF;
}

/* ==================== 5. 红笔手账备课本原语 (.nb-*) ==================== */
.nb-paper {
  background-color: var(--xhs-bg);
  background-image:
    linear-gradient(to bottom, transparent 47px, var(--xhs-line) 48px),
    linear-gradient(to right, var(--xhs-accent-line) 0, var(--xhs-accent-line) 2px, transparent 2px);
  background-size: 100% 48px, 100% 100%;
  background-position: 0 24px, 76px 0;
  padding-left: 96px;
}
.nb-margin-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 19px;
  font-weight: 800;
  color: var(--xhs-accent);
}
.nb-stamp {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border: 2px solid var(--xhs-accent);
  color: var(--xhs-accent);
  font-size: 18px;
  font-weight: 800;
  transform: rotate(-2deg);
}
.nb-tape-note {
  padding: 16px 20px;
  background: var(--xhs-tint);
  border: 1px solid var(--xhs-accent-line);
  transform: rotate(-1deg);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
.nb-highlight {
  background: linear-gradient(180deg, transparent 54%, var(--xhs-tint) 54%, var(--xhs-tint) 94%, transparent 94%);
  padding: 0 5px;
}
.nb-check-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px dashed var(--xhs-line);
}
`

function highlightHeadingHtml(text, hlClass = 'cd-hl') {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const tokenRegex = /([A-Za-z0-9_+@.-]{2,}|「[^」]+」|\d+(?:\.\d+)?%|\d+\s*[个条步秒倍次张套])/g
  let lastIndex = 0
  let out = ''
  let match
  let highlightedCount = 0
  while ((match = tokenRegex.exec(raw)) !== null) {
    out += escapeHtml(raw.slice(lastIndex, match.index))
    if (highlightedCount < 2) {
      out += `<span class="${hlClass}">${escapeHtml(match[0])}</span>`
      highlightedCount += 1
    } else {
      out += escapeHtml(match[0])
    }
    lastIndex = match.index + match[0].length
  }
  out += escapeHtml(raw.slice(lastIndex))
  if (highlightedCount === 0 && raw.length >= 5) {
    const mid = Math.ceil(raw.length * 0.55)
    return `${escapeHtml(raw.slice(0, mid))}<span class="${hlClass}">${escapeHtml(raw.slice(mid))}</span>`
  }
  return out
}

function splitPipeParts(line) {
  return String(line || '')
    .split(/\s*[|｜]\s*/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function buildImageFramingStyle(framing = {}) {
  const fit = ['cover', 'contain', 'fill'].includes(framing?.fit) ? framing.fit : 'cover'
  const posX = typeof framing?.posX === 'number' && Number.isFinite(framing.posX) ? Math.max(0, Math.min(100, Math.round(framing.posX))) : 50
  const posY = typeof framing?.posY === 'number' && Number.isFinite(framing.posY) ? Math.max(0, Math.min(100, Math.round(framing.posY))) : 50
  const zoom = typeof framing?.zoom === 'number' && Number.isFinite(framing.zoom) ? Math.max(50, Math.min(250, Math.round(framing.zoom))) : 100
  const panX = typeof framing?.panX === 'number' && Number.isFinite(framing.panX) ? Math.max(-400, Math.min(400, Math.round(framing.panX))) : 0
  const panY = typeof framing?.panY === 'number' && Number.isFinite(framing.panY) ? Math.max(-400, Math.min(400, Math.round(framing.panY))) : 0
  const parts = [
    `object-fit:${fit}`,
    `object-position:${posX}% ${posY}%`,
  ]
  if (zoom !== 100 || panX !== 0 || panY !== 0) {
    parts.push(`transform-origin:${posX}% ${posY}%`)
    parts.push(`transform:translate(${panX}px, ${panY}px) scale(${(zoom / 100).toFixed(2)})`)
  }
  return `${parts.join(';')};`
}

function formatEyebrow(index, badge, fallback) {
  const pageNo = String(index + 1).padStart(2, '0')
  const cleaned = String(badge || '')
    .replace(/^\s*(?:STEP\s*)?0?\d+\s*[·./|｜:-]\s*/i, '')
    .trim()
  return `${pageNo} / ${cleaned || fallback}`
}

function cleanBadgeText(badge, fallback) {
  const cleaned = String(badge || '')
    .replace(/^\s*(?:STEP\s*)?0?\d+\s*[·./|｜:-]\s*/i, '')
    .trim()
  return cleaned || fallback
}

function splitTitleAndBodyFromParts(parts, defaultPrefix, idx) {
  const cleanParts = parts.filter(Boolean)
  if (!cleanParts.length) {
    return { title: `${defaultPrefix} 0${idx + 1}`, body: '' }
  }
  if (/^(?:以前|现在|旧方案|新方案|传统|如今|Before|After)$/i.test(cleanParts[0]) && cleanParts.length >= 2) {
    if (cleanParts.length >= 3) {
      return { title: cleanParts[1], body: cleanParts.slice(2).join(' · ') }
    }
    const text = cleanParts[1]
    const commaMatch = /^([^，,：:—–-]{3,14})[，,：:—–-]\s*(.+)$/.exec(text)
    if (commaMatch) {
      return { title: commaMatch[1], body: commaMatch[2] }
    }
    return { title: text.slice(0, 12), body: text }
  }
  if (cleanParts.length >= 2) {
    return { title: cleanParts[0], body: cleanParts.slice(1).join(' · ') }
  }
  const single = cleanParts[0]
  const commaMatch = /^([^，,：:—–-]{3,14})[，,：:—–-]\s*(.+)$/.exec(single)
  if (commaMatch) {
    return { title: commaMatch[1], body: commaMatch[2] }
  }
  return { title: `${defaultPrefix} 0${idx + 1}`, body: single }
}

function renderImageTag(card, defaultFitOverride = null) {
  const imageUrl = sanitizeCardImageUrl(card?.imageUrl)
  if (!imageUrl) return ''
  const f = card?.imageFraming || {}
  const defaultFit = defaultFitOverride || (card?.kind === 'cover' ? 'cover' : 'contain')
  const fit = ['cover', 'contain', 'fill'].includes(f.fit) ? f.fit : defaultFit
  const posX = typeof f.posX === 'number' && Number.isFinite(f.posX) ? Math.max(0, Math.min(100, Math.round(f.posX))) : 50
  const posY = typeof f.posY === 'number' && Number.isFinite(f.posY) ? Math.max(0, Math.min(100, Math.round(f.posY))) : 50
  const zoom = typeof f.zoom === 'number' && Number.isFinite(f.zoom) ? Math.max(50, Math.min(250, Math.round(f.zoom))) : 100
  const panX = typeof f.panX === 'number' && Number.isFinite(f.panX) ? Math.max(-400, Math.min(400, Math.round(f.panX))) : 0
  const panY = typeof f.panY === 'number' && Number.isFinite(f.panY) ? Math.max(-400, Math.min(400, Math.round(f.panY))) : 0
  const styleStr = buildImageFramingStyle({ fit, posX, posY, zoom, panX, panY })
  return `<img class="cd-shot-img" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(card?.heading || '实拍配图')}" data-img-fit="${fit}" data-img-pos-x="${posX}" data-img-pos-y="${posY}" data-img-zoom="${zoom}" data-img-pan-x="${panX}" data-img-pan-y="${panY}" style="${styleStr}" />`
}

function renderImageOrSlot(card) {
  const imgTag = renderImageTag(card)
  if (!imgTag) return ''
  return `
    <div class="cd-shot-window" data-xhs-slot="image">
      <div class="cd-shot-bar">
        <span class="cd-shot-dot" style="background:#FF5F56"></span>
        <span class="cd-shot-dot" style="background:#FFBD2E"></span>
        <span class="cd-shot-dot" style="background:#27C93F"></span>
        <span class="cd-shot-label">实拍截图</span>
      </div>
      <div class="cd-shot-frame">
        ${imgTag}
      </div>
    </div>
  `
}

// ============================================================================
// 兜底合成器：按 8 种卡片类型合成互不相同的版式结构（当 AI 未提供自由 html 时使用）
// ============================================================================
function synthesizeCoverHtml(card, { total, author }) {
  const badge = cleanBadgeText(card.badge, '实测复盘')
  const lines = Array.isArray(card.lines) && card.lines.length ? card.lines : ['真实工作流拆解 | 全程干货可直接抄作业']
  const tags = Array.isArray(card.tags) && card.tags.length ? card.tags : ['核心实测', '避坑指南', '一键复用']
  const parsedLines = lines.map((l, i) => splitTitleAndBodyFromParts(splitPipeParts(l), '看点', i))
  const shotHtml = renderImageOrSlot(card)

  const heroMiddleHtml = shotHtml || `
    <div class="cd-card cd-grow" style="background:linear-gradient(180deg, var(--xhs-card) 0%, var(--xhs-tint) 100%); border-color:var(--xhs-accent-line);">
      <div class="cd-eyebrow-row" style="justify-content:space-between;">
        <span class="cd-section-tag is-accent">CORE WORKFLOW · 核心看点</span>
        <span class="cd-code-pill">${escapeHtml(`${total} 页完整拆解`)}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:16px; flex:1; justify-content:center;">
        ${parsedLines.map((item, idx) => `
          <div style="display:flex; align-items:center; gap:16px; padding:20px 24px; background:var(--xhs-card); border-radius:16px; border:1.5px solid var(--xhs-line);">
            <span class="cd-step-num">${idx + 1}</span>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <strong style="font-size:calc(28px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-ink);">${escapeHtml(item.title)}</strong>
              ${item.body ? `<span style="font-size:calc(22px * var(--xhs-scale, 1)); color:var(--xhs-ink2);">${escapeHtml(item.body)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `

  return `
    <div class="cd-ribbon"></div>
    <div class="cd-header" style="margin-top:16px; gap:18px;">
      <div class="cd-eyebrow-row">
        <span class="cd-status-pill">实测笔记</span>
        <span class="cd-eyebrow-sub">${escapeHtml(badge)}</span>
      </div>
      <h1 class="cd-title-xl">${highlightHeadingHtml(card.heading || '核心实操复盘')}</h1>
      ${card.accent ? `<div style="font-size:calc(36px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-accent); line-height:1.3;">${escapeHtml(card.accent)}</div>` : ''}
    </div>

    <div class="cd-main">
      <div class="cd-code-strip">
        ${tags.map(t => `<span class="cd-code-pill">${escapeHtml(t)}</span>`).join('')}
      </div>

      <div class="cd-dark-pill">
        <span>↓</span>
        <span>${escapeHtml(card.callout || parsedLines[0]?.title || '一套流程，打通全链路效率')}</span>
      </div>

      ${heroMiddleHtml}

      <div class="cd-outline-tags">
        ${tags.map(t => `<span class="cd-outline-tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>

    <div class="cd-cover-wave">
      <span class="cd-wave-meta">${escapeHtml(author ? `@${author} · 实测整理` : `共 ${total} 页高密度拆解`)}</span>
      <span class="cd-wave-cta">左滑看实测 →</span>
    </div>
  `
}

function synthesizeCompareHtml(card, { index, total, author }) {
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['以前 | 手动来回复制粘贴，耗时费力', '现在 | 一键自动同步上下文，零返工']
  const parsed = rawLines.map(splitPipeParts)

  const beforeRows = []
  const afterRows = []
  parsed.forEach((parts, idx) => {
    const head = parts[0] || ''
    if (/^(?:以前|旧|传统|过去|Before|痛点)/i.test(head)) {
      beforeRows.push(parts)
    } else if (/^(?:现在|新|升级|如今|After|方案)/i.test(head)) {
      afterRows.push(parts)
    } else if (idx < Math.ceil(parsed.length / 2)) {
      beforeRows.push(parts)
    } else {
      afterRows.push(parts)
    }
  })
  if (!beforeRows.length && afterRows.length > 1) beforeRows.push(afterRows.shift())
  if (!afterRows.length && beforeRows.length > 1) afterRows.push(beforeRows.pop())

  const afterCols = Math.min(3, Math.max(1, afterRows.length))

  return `
    <div class="cd-header">
      <div class="cd-eyebrow">${escapeHtml(formatEyebrow(index, card.badge, '痛点对比'))}</div>
      <h2 class="cd-title">${highlightHeadingHtml(card.heading || '前后方案对比')}</h2>
      ${card.accent ? `<p class="cd-sub">${escapeHtml(card.accent)}</p>` : ''}
    </div>

    <div class="cd-main">
      <div class="cd-table-card">
        <div class="cd-eyebrow-row" style="justify-content:space-between;">
          <span class="cd-section-tag">以前 · 传统方式</span>
          <span class="cd-code-pill">BEFORE</span>
        </div>
        <table class="cd-table">
          <thead>
            <tr>
              <th>环节</th>
              <th>传统做法与痛点</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            ${beforeRows.map((parts, idx) => {
              const { title, body } = splitTitleAndBodyFromParts(parts, '痛点', idx)
              return `
                <tr>
                  <td class="is-bold">${escapeHtml(title)}</td>
                  <td>${escapeHtml(body || title)}</td>
                  <td><span class="cd-code-pill" style="color:#E11D48; background:#FFF1F0;">低效易错</span></td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
        <div class="cd-alert-bar">
          <span>⚠️ 痛点总结：${escapeHtml(card.callout || beforeRows[0]?.slice(-1)[0] || '步骤割裂，大量精力浪费在重复搬运上')}</span>
        </div>
      </div>

      <div class="cd-flow-arrow">↓</div>

      <div class="cd-card cd-grow" style="background:var(--xhs-tint); border-color:var(--xhs-accent-line);">
        <div class="cd-eyebrow-row" style="justify-content:space-between;">
          <span class="cd-section-tag is-accent">现在 · 升级方案</span>
          <span class="cd-status-pill">● 效率拉满</span>
        </div>
        <div class="cd-dark-panel">
          <span class="cd-dark-panel-title">${escapeHtml(card.accent || card.heading || '全流程打通 · 一步到位')}</span>
          <span class="cd-dark-panel-tag">1 个入口统一调度</span>
        </div>
        <div class="cd-col-grid" style="--cols:${afterCols};">
          ${afterRows.map((parts, idx) => {
            const { title, body } = splitTitleAndBodyFromParts(parts, '核心升级', idx)
            return `
              <div class="cd-bento" style="justify-content:flex-start; gap:14px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                  <span class="cd-bento-title">${escapeHtml(title)}</span>
                  <span class="cd-status-pill" style="padding:3px 10px; font-size:17px;">✓ 已就绪</span>
                </div>
                <p class="cd-bento-body" style="flex:1;">${escapeHtml(body)}</p>
                <div style="padding-top:10px; border-top:1px dashed var(--xhs-line); font-size:18px; color:var(--xhs-accent); font-weight:800;">
                  ● 升级亮点 0${idx + 1}
                </div>
              </div>
            `
          }).join('')}
        </div>
      </div>
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '实测对比')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

function synthesizeMetricsHtml(card, { index, total, author }) {
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['30s | 响应耗时 | 较传统方式缩短 90%', '0 次 | 返工次数 | 全链路一次跑通']
  const parsed = rawLines.map(splitPipeParts)
  const cols = Math.min(3, parsed.length)
  const rowCount = Math.ceil(parsed.length / 3)
  const itemsPerRow = Math.floor(parsed.length / rowCount)
  const extraRows = parsed.length % rowCount
  const shotHtml = renderImageOrSlot(card)

  return `
    <div class="cd-header">
      <div class="cd-eyebrow">${escapeHtml(formatEyebrow(index, card.badge, '实测数据'))}</div>
      <h2 class="cd-title">${highlightHeadingHtml(card.heading || '核心指标与实测表现')}</h2>
    </div>

    <div class="cd-main">
      <div class="cd-kv-grid">
        <div class="cd-kv-item">
          <span class="cd-kv-k">测评场景</span>
          <span class="cd-kv-v">${escapeHtml(card.heading || '真实工作流实测')}</span>
        </div>
        <div class="cd-kv-item">
          <span class="cd-kv-k">验证策略</span>
          <span class="cd-kv-v">${escapeHtml(card.accent || '端到端全链路实跑')}</span>
        </div>
        <div class="cd-kv-item">
          <span class="cd-kv-k">核心指标数</span>
          <span class="cd-kv-v">${parsed.length} 项关键数据对比</span>
        </div>
        <div class="cd-kv-item">
          <span class="cd-kv-k">实测状态</span>
          <span class="cd-kv-v" style="color:#15803D;">● 全部达标通过</span>
        </div>
      </div>

      ${shotHtml || `
        <div class="cd-card" style="padding:22px 26px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span class="cd-code-pill">${escapeHtml(cleanBadgeText(card.badge, 'BENCHMARK · 实测看板'))}</span>
            <span class="cd-status-pill">● 实测数据记录</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(${cols}, minmax(0, 1fr)); gap:14px;">
            ${parsed.slice(0, cols).map(parts => `
              <div style="padding:14px 16px; border-radius:14px; background:var(--xhs-muted-bg); display:flex; flex-direction:column; gap:4px;">
                <span style="font-size:18px; color:var(--xhs-ink3); font-weight:700;">${escapeHtml(parts[1] || '指标项')}</span>
                <strong style="font-size:26px; color:var(--xhs-ink); font-weight:900;">${escapeHtml(parts[0] || '--')}</strong>
              </div>
            `).join('')}
          </div>
        </div>
      `}

      <div class="cd-col-grid cd-metrics-grid">
        ${parsed.map((parts, idx) => {
          const rowSize = idx < extraRows * (itemsPerRow + 1) ? itemsPerRow + 1 : itemsPerRow
          const num = parts[0] || `#${idx + 1}`
          const label = parts[1] || `关键指标 0${idx + 1}`
          const desc = parts[2] || parts[1] || '实测表现稳定'
          return `
            <div class="cd-bento" style="grid-column:span ${6 / rowSize}">
              <span class="cd-metric-label">${escapeHtml(label)}</span>
              <div class="cd-metric-num">${escapeHtml(num)}</div>
              <span class="cd-metric-sub">${escapeHtml(desc)}</span>
            </div>
          `
        }).join('')}
      </div>

      <div class="cd-col-grid" style="--cols:2;">
        <div class="cd-bento is-tint">
          <span class="cd-section-tag is-accent">核心突破</span>
          <div style="font-size:calc(27px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-ink); line-height:1.3;">
            ${escapeHtml(parsed[0]?.[1] ? `${parsed[0][1]}：${parsed[0][0]}` : (card.accent || '关键指标显著跃升'))}
          </div>
          <p class="cd-bento-body">${escapeHtml(parsed[0]?.[2] || card.callout || '省去中间繁琐环节，直接拿到稳定结果')}</p>
        </div>
        <div class="cd-bento">
          <span class="cd-section-tag">实测体感</span>
          <div style="font-size:calc(27px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-ink); line-height:1.3;">
            ${escapeHtml(card.callout || parsed[parsed.length - 1]?.[2] || '全程顺滑，无额外心智负担')}
          </div>
          <p class="cd-bento-body">个人实测记录，不同场景与配置下表现供参考</p>
        </div>
      </div>
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '实测数据')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

function synthesizeStepsHtml(card, { index, total, author }) {
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['第一步 | 先明确输入与目标边界', '第二步 | 跑通最小闭环并检查输出', '第三步 | 固化成可复用的标准模板']
  const parsed = rawLines.map(splitPipeParts)
  const shotHtml = renderImageOrSlot(card)

  return `
    <div class="cd-header">
      <div class="cd-eyebrow">${escapeHtml(formatEyebrow(index, card.badge, '实操步骤'))}</div>
      <h2 class="cd-title">${highlightHeadingHtml(card.heading || '核心执行流程')}</h2>
      ${card.accent ? `<p class="cd-sub">${escapeHtml(card.accent)}</p>` : ''}
    </div>

    <div class="cd-main">
      ${shotHtml || `
        <div class="cd-table-card">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span class="cd-section-tag">流程概览 · 执行流水</span>
            <span class="cd-status-pill">+ ${parsed.length} 步跑通</span>
          </div>
          <table class="cd-table">
            <thead>
              <tr>
                <th>阶段</th>
                <th>核心动作</th>
                <th>校验结果</th>
              </tr>
            </thead>
            <tbody>
              ${parsed.map((parts, idx) => `
                <tr>
                  <td><span class="cd-status-pill" style="padding:3px 12px; font-size:18px;">STEP 0${idx + 1}</span></td>
                  <td class="is-bold">${escapeHtml(parts[0] || `步骤 ${idx + 1}`)}</td>
                  <td class="is-muted">${escapeHtml(parts[1] || '验证通过')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}

      <div class="cd-step-list">
        ${parsed.map((parts, idx) => {
          const title = parts[0] || `步骤 0${idx + 1}`
          const desc = parts.slice(1).join(' · ')
          return `
            <div class="cd-step-item">
              <span class="cd-step-num">${idx + 1}</span>
              <div class="cd-step-content">
                <div class="cd-step-title">${escapeHtml(title)}</div>
                ${desc ? `<div class="cd-step-desc">${escapeHtml(desc)}</div>` : ''}
              </div>
            </div>
          `
        }).join('')}
      </div>

      ${card.callout ? `
        <div class="cd-callout">
          <div class="cd-callout-line">· ${escapeHtml(card.callout)}</div>
        </div>
      ` : ''}
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '流程拆解')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

function synthesizeGridHtml(card, { index, total, author }) {
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['模块一 | 核心要点与边界说明', '模块二 | 关键机制与触发条件', '模块三 | 常见误区与避坑建议', '模块四 | 复用效果与落地收益']
  const parsed = rawLines.map(splitPipeParts)
  const shotHtml = renderImageOrSlot(card)

  return `
    <div class="cd-header">
      <div class="cd-eyebrow">${escapeHtml(formatEyebrow(index, card.badge, '核心矩阵'))}</div>
      <h2 class="cd-title">${highlightHeadingHtml(card.heading || '关键模块全览')}</h2>
      ${card.accent ? `<p class="cd-sub">${escapeHtml(card.accent)}</p>` : ''}
    </div>

    <div class="cd-main">
      ${shotHtml}

      <div class="cd-col-grid" style="--cols:2;">
        ${parsed.map((parts, idx) => {
          const title = parts[0] || `要点 0${idx + 1}`
          const desc = parts.slice(1).join(' · ')
          return `
            <div class="cd-bento">
              <span class="cd-accent-pill">0${idx + 1}</span>
              <div class="cd-bento-title is-ink" style="font-size:calc(31px * var(--xhs-scale, 1));">${escapeHtml(title)}</div>
              ${desc ? `<p class="cd-bento-body">${escapeHtml(desc)}</p>` : ''}
            </div>
          `
        }).join('')}
      </div>

      ${(card.callout || card.accent) ? `
        <div class="cd-callout">
          <div class="cd-callout-line">· ${escapeHtml(card.callout || card.accent)}</div>
        </div>
      ` : ''}
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '核心矩阵')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

function synthesizeListHtml(card, { index, total, author }) {
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['要点一 | 明确前置条件与适用范围', '要点二 | 严格核对关键参数与配置', '要点三 | 上线前走一遍完整体检清单']
  const parsed = rawLines.map(splitPipeParts)
  const shotHtml = renderImageOrSlot(card)

  return `
    <div class="cd-header">
      <div class="cd-eyebrow">${escapeHtml(formatEyebrow(index, card.badge, '重点清单'))}</div>
      <h2 class="cd-title">${highlightHeadingHtml(card.heading || '必看核心清单')}</h2>
      ${card.accent ? `<p class="cd-sub">${escapeHtml(card.accent)}</p>` : ''}
    </div>

    <div class="cd-main">
      ${shotHtml}

      <div class="cd-step-list">
        ${parsed.map((parts, idx) => {
          const title = parts[0] || `要点 0${idx + 1}`
          const desc = parts.slice(1).join(' · ')
          return `
            <div class="cd-card" style="flex:1; flex-direction:row; align-items:center; gap:20px; padding:22px 26px;">
              <span class="cd-step-num">${idx + 1}</span>
              <div style="display:flex; flex-direction:column; gap:6px; flex:1;">
                <div style="font-size:calc(29px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-ink); line-height:1.3;">${escapeHtml(title)}</div>
                ${desc ? `<div style="font-size:calc(23px * var(--xhs-scale, 1)); color:var(--xhs-ink2); line-height:1.45;">${escapeHtml(desc)}</div>` : ''}
              </div>
              <span class="cd-accent-pill">重点</span>
            </div>
          `
        }).join('')}
      </div>

      <div class="cd-callout">
        <div class="cd-callout-line">· ${escapeHtml(card.callout || card.accent || '建议收藏对照检查，避免遗漏关键细节')}</div>
      </div>
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '重点清单')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

function synthesizeQuoteHtml(card, { index, total, author }) {
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['真正的效率提升，不是把旧流程做快，而是把不必要的传话彻底砍掉。']
  const mainQuote = rawLines[0] || ''
  const extraLines = rawLines.slice(1)
  const shotHtml = renderImageOrSlot(card)

  return `
    <div class="cd-header">
      <div class="cd-eyebrow">${escapeHtml(formatEyebrow(index, card.badge, '核心洞察'))}</div>
      <h2 class="cd-title">${highlightHeadingHtml(card.heading || '最戳痛点的一句话')}</h2>
    </div>

    <div class="cd-main">
      <div class="cd-card cd-grow" style="padding:38px 40px; border-left:8px solid var(--xhs-accent); justify-content:center; gap:24px;">
        <div style="font-size:84px; font-weight:900; color:var(--xhs-accent); line-height:0.75; opacity:0.32;">“</div>
        <div style="font-size:calc(44px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-ink); line-height:1.38; letter-spacing:-0.015em;">
          ${highlightHeadingHtml(mainQuote)}
        </div>
        ${extraLines.map(line => `
          <div style="font-size:calc(30px * var(--xhs-scale, 1)); font-weight:700; color:var(--xhs-ink2); line-height:1.45;">
            ${escapeHtml(line)}
          </div>
        `).join('')}
      </div>

      ${shotHtml || `
        <div class="cd-col-grid" style="--cols:2; flex:0 0 auto;">
          <div class="cd-bento is-tint" style="padding:28px 30px; gap:14px;">
            <span class="cd-section-tag is-accent" style="font-size:calc(25px * var(--xhs-scale, 1));">为什么重要</span>
            <p class="cd-bento-body" style="color:var(--xhs-ink); font-weight:700; font-size:calc(26px * var(--xhs-scale, 1)); line-height:1.48;">
              ${escapeHtml(card.accent || '看清真正消耗精力的瓶颈，才能把好钢用在刀刃上')}
            </p>
          </div>
          <div class="cd-bento" style="padding:28px 30px; gap:14px;">
            <span class="cd-section-tag" style="font-size:calc(25px * var(--xhs-scale, 1));">落地启示</span>
            <p class="cd-bento-body" style="color:var(--xhs-ink); font-weight:700; font-size:calc(26px * var(--xhs-scale, 1)); line-height:1.48;">
              ${escapeHtml(card.callout || '先跑通最小闭环，再逐步沉淀成自己的自动化工具箱')}
            </p>
          </div>
        </div>
      `}

      ${card.callout ? `
        <div class="cd-callout">
          <div class="cd-callout-line">· ${escapeHtml(card.callout)}</div>
        </div>
      ` : ''}
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '金句提炼')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

function synthesizeEndHtml(card, { index, total, author }) {
  const pageNo = String(index + 1).padStart(2, '0')
  const rawLines = Array.isArray(card.lines) && card.lines.length
    ? card.lines
    : ['先收藏 | 下次实操时直接翻出来对照', '跑通闭环 | 按卡片顺序逐项验证', '欢迎交流 | 有问题评论区一起聊']
  const parsed = rawLines.map(splitPipeParts)

  return `
    <div class="cd-header">
      <div class="cd-eyebrow-row">
        <span class="cd-accent-pill">${escapeHtml(cleanBadgeText(card.badge, '写在最后'))}</span>
        <span class="cd-eyebrow-sub">${pageNo} / ${String(total).padStart(2, '0')}</span>
      </div>
      <h2 class="cd-title" style="font-size:calc(60px * var(--xhs-scale, 1));">${highlightHeadingHtml(card.heading || '直接拿走用的行动清单')}</h2>
      ${card.accent ? `<p class="cd-sub">${escapeHtml(card.accent)}</p>` : ''}
    </div>

    <div class="cd-main">
      <div style="display:flex; flex-direction:column; flex:1; justify-content:center; border-top:1px solid var(--xhs-line);">
        ${parsed.map((parts, idx) => {
          const title = parts[0] || `要点 0${idx + 1}`
          const desc = parts.slice(1).join(' · ')
          return `
            <div style="display:grid; grid-template-columns:84px 1fr; gap:18px; align-items:baseline; padding:26px 4px; border-bottom:1px solid var(--xhs-line);">
              <span style="font-family:var(--xhs-mono); font-size:32px; font-weight:800; color:var(--xhs-accent); line-height:1;">0${idx + 1}</span>
              <div style="display:flex; flex-direction:column; gap:6px;">
                <strong style="font-size:calc(29px * var(--xhs-scale, 1)); font-weight:900; color:var(--xhs-ink); line-height:1.3;">${escapeHtml(title)}</strong>
                ${desc ? `<p style="margin:0; font-size:calc(23px * var(--xhs-scale, 1)); color:var(--xhs-ink2); line-height:1.48;">${escapeHtml(desc)}</p>` : ''}
              </div>
            </div>
          `
        }).join('')}
      </div>

      ${card.callout ? `
        <div class="cd-callout" style="background:var(--xhs-tint); border-color:var(--xhs-accent-line);">
          <div class="cd-callout-line" style="color:var(--xhs-ink);">${escapeHtml(card.callout)}</div>
        </div>
      ` : ''}
    </div>

    <div class="cd-footer">
      <span>${escapeHtml(author ? `@${author}` : '全文完')}</span>
      <span>${index + 1} / ${total}</span>
    </div>
  `
}

export function resolveArtboardClassName() {
  return 'xhs-artboard'
}

export function buildCardStyleText({ customCss = '', pageCss = '' } = {}) {
  const parts = [XHS_ARTBOARD_CSS]
  const cleanDeck = sanitizeXhsCss(customCss, { maxChars: DERIVE_LIMITS.xhs.customCss })
  if (cleanDeck) parts.push(cleanDeck)
  const cleanPage = sanitizeXhsCss(pageCss, { maxChars: DERIVE_LIMITS.xhs.pageCss })
  if (cleanPage) parts.push(cleanPage)
  return parts.join('\n\n')
}

export function synthesizeCardHtml(card, opts = {}) {
  const kind = card?.kind || 'list'
  const index = opts.index ?? 0
  const total = opts.total ?? 1
  const author = opts.author ?? ''
  const ctx = { index, total, author }

  switch (kind) {
    case 'cover':
      return synthesizeCoverHtml(card, ctx).trim()
    case 'compare':
      return synthesizeCompareHtml(card, ctx).trim()
    case 'metrics':
      return synthesizeMetricsHtml(card, ctx).trim()
    case 'steps':
      return synthesizeStepsHtml(card, ctx).trim()
    case 'grid':
      return synthesizeGridHtml(card, ctx).trim()
    case 'quote':
      return synthesizeQuoteHtml(card, ctx).trim()
    case 'end':
      return synthesizeEndHtml(card, ctx).trim()
    case 'list':
    default:
      return synthesizeListHtml(card, ctx).trim()
  }
}

export function ensureCardHtml(card, opts = {}) {
  const custom = sanitizeXhsCardHtml(card?.html)
  if (custom) return custom
  return synthesizeCardHtml(card, opts)
}
