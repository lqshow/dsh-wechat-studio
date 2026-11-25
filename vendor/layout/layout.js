// 林月半子 · Markdown → 公众号排版。由 layout.py 逐行移植，输出与原脚本逐字节一致。
// 产出：自带风格、配色切换和复制按钮的完整 HTML 页面，以及自查报告。
import { esc, escQ, fixed, floatStr, round, pad, chars, len, slice, dumps, strip, rstrip, lstrip, PyError, ix, max, min, F, I, sum, int, float, splitN, splitWs, splitlines, expandtabs, get } from './py.js'
import { re } from './pyre.js'
import * as B from './banner.js'
import { DEFAULT_GALLERY_LABEL, galleryColors, isGalleryOpening, parseGalleryBlock } from '../../src/gallery.js'
import { parseVideoCardLines, renderVideoCardHtml } from '../../src/video-card.js'
import { normalizeEndMark, renderEndMarkHtml } from '../../src/end-mark.js'

const theme = (name, main, soft, tint, line, mark) => ({ name, main, soft, tint, line, mark })
// 15 套配色：main 主色 / soft 浅底 / tint 色块 / line 线条 / mark 荧光笔
export const THEMES = {
  orange: theme('品牌橙', '#C9643E', '#FCF6F2', '#F7E3D5', '#DAB196', '#FCE7A6'),
  blue: theme('科技蓝', '#2952B6', '#F4F8FD', '#DDE8FB', '#A6BBE2', '#F9E8A7'),
  teal: theme('薄荷绿', '#0C7D6C', '#F3F9F7', '#D8EDE6', '#9BC5B9', '#F8E8AB'),
  ink: theme('墨黑', '#1A1D23', '#F9F7F4', '#EAE7E1', '#BFBAB2', '#FAE39F'),
  navy: theme('藏青金', '#183053', '#F5F8FB', '#E0E8F3', '#CAAD71', '#F3E0B0'),
  violet: theme('葡萄紫', '#5F3F98', '#F8F6FD', '#E9E4F9', '#BFB3DD', '#F8E8AB'),
  rose: theme('胭脂红', '#A6344C', '#FDF5F6', '#FAE0E3', '#DEABB2', '#FBE6B3'),
  amber: theme('琥珀', '#9D6311', '#FAF7F2', '#F2E5D3', '#CFB791', '#CEE9FD'),
  morandi: theme('莫兰迪', '#7D6560', '#FAF7F5', '#ECE6E3', '#C4B8B2', '#F1E4C3'),
  forest: theme('松柏金', '#184731', '#F5F8F6', '#E0EAE2', '#CAAD71', '#F3E0B0'),
  petrol: theme('孔雀青', '#0A5765', '#F4F8F9', '#DAEBEE', '#A0C2C8', '#FBE7AB'),
  mist: theme('雾霾蓝', '#4B6D8A', '#F5F8FA', '#DFE9F0', '#AABECC', '#F9E7B7'),
  matcha: theme('橄榄绿', '#596B3A', '#F7F8F4', '#E6E9DB', '#B9BEA3', '#FDE4BB'),
  cocoa: theme('可可棕', '#603F2C', '#F9F7F5', '#EEE5DF', '#C8B7A9', '#F8E3B0'),
  dusty: theme('豆沙粉', '#9D5C61', '#FBF6F6', '#F5E2E2', '#D5B0AF', '#F9E6BF'),
}
// 10 套风格：不只换颜色，标题、强调、引用、列表、分隔线、图片的结构都不同。r 是卡片圆角
export const STYLES = {
  std: { name: '标准', r: 14, desc: 'PART 大标题 + 荧光笔 + 圆角卡片' },
  mag: { name: '杂志', r: 2, desc: '宋体标题居中、细线、留白多' },
  min: { name: '极简', r: 0, desc: '黑白为主、无底色、左对齐' },
  geek: { name: '极客', r: 6, desc: '等宽字标签、虚线框、终端感' },
  bold: { name: '醒目', r: 16, desc: '大色块标题、粗圆角、强对比' },
  neo: { name: '质感', r: 16, desc: '巨型数字和大引号做底纹、细线描边、柔和阴影、浅色金句卡' },
  note: { name: '手账', r: 6, desc: '便签贴纸编号、荧光笔、虚线和纸胶带' },
  zen: { name: '雅致', r: 2, desc: '印章编号、宋体标题居中、双线金句' },
  bento: { name: '卡片', r: 20, desc: '大圆角色块、胶囊编号、轻盈扁平' },
  dark: { name: '暗夜', r: 14, desc: '深色底、亮色强调，科技感' },
}
const NEW_ST = ['note', 'zen', 'bento', 'dark']
// 正文先用占位色渲染一次，换配色时由页面里的脚本替换，不用每种配色各渲染一遍
const TOK = { main: '#0A0B01', soft: '#0A0B02', tint: '#0A0B03', line: '#0A0B04', mark: '#0A0B05' }
const INK = '#111827', BODY = '#3F3F46', GRAY = '#6B7280', MUTE = '#94A3B8', BORDER = '#E5E7EB'
const PROMPT_INK = '#52607A'
const MONO = "Menlo,Consolas,'SF Mono',monospace"
const SERIF = "Georgia,'Songti SC','STSong','Source Han Serif SC','Noto Serif SC',serif"
const CN_NUM = '一二三四五六七八九十'
const IMAGE_ALT = String.raw`((?:\\.|[^\]\\])*)`
const imageAlt = s => re(String.raw`\\([\\\[\]])`).sub(m => m[1], s)
const g = (m, n) => m[n] ?? null

// 排版过程中发现的问题，最后在自查报告里打印。渲染全程同步，入口处清空
let WARN = []
function warn(x) {
  if (!WARN.includes(x)) WARN.push(x)
}

// ---------------- inline ----------------
function strongCss(T) {
  const st = T.st
  if (NEW_ST.includes(st)) return xStrong(T)
  if (st === 'neo') return `font-weight:800;color:${INK};background:linear-gradient(100deg,${T.mark},${T.tint});padding:2px 6px;border-radius:4px;`
  if (st === 'mag') return `font-weight:700;color:${T.main};`
  if (st === 'min') return 'font-weight:700;color:#000000;'
  if (st === 'geek') return `font-weight:700;color:${T.main};background:${T.soft};padding:1px 5px;border-radius:3px;`
  if (st === 'bold') return `font-weight:700;color:${INK};background:${T.mark};padding:2px 4px;border-radius:3px;`
  return `font-weight:700;color:${INK};background:linear-gradient(transparent 58%,${T.mark} 58%);padding:0 2px;`
}

function inline(s, T, notes) {
  const keep = []
  const stash = h => { keep.push(h); return `\x00${keep.length - 1}\x00` }
  // 行内代码、图片、链接先收起来，里面的 * _ = 不会被当成标记
  s = re('`([^`]+)`').sub(m => stash(`<code style="font-family:${MONO};font-size:0.9em;background:${T.soft};color:${T.main};padding:2px 5px;border-radius:4px;">${esc(m[1])}</code>`), s)
  s = re(String.raw`!\[${IMAGE_ALT}\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)`).sub(m => stash(`<img src="${m[2]}" style="max-width:100%;vertical-align:middle;"/>`), s)
  const link = m => {
    const text = esc(m[1]), url = m[2]
    if (url.includes('mp.weixin.qq.com')) {
      return stash(`<a href="${url}" style="color:${T.main};text-decoration:none;border-bottom:1px solid ${T.line};">${text}</a>`)
    }
    notes.push([m[1], url])
    return stash(`<span style="color:${T.main};border-bottom:1px solid ${T.line};">${text}</span><sup style="color:${T.main};font-size:11px;">[${notes.length}]</sup>`)
  }
  s = re(String.raw`\[([^\]]+)\]\(<?([^)\s>]+)>?\)`).sub(link, s)
  s = esc(s)
  s = re(String.raw`\*\*(?=\S)(.+?)(?<=\S)\*\*`).sub(m => `<strong style="${strongCss(T)}">${m[1]}</strong>`, s)
  const chip = T.st === 'min' ? INK : T.main
  const chipCss = NEW_ST.includes(T.st) ? xChip(T) : `background:${chip};color:#FFFFFF;font-weight:700;padding:2px 6px;border-radius:3px;`
  s = re(String.raw`==(?=\S)(.+?)(?<=\S)==`).sub(m => `<span style="${chipCss}">${m[1]}</span>`, s)
  s = re(String.raw`\+\+(?=\S)(.+?)(?<=\S)\+\+|&lt;u&gt;(.+?)&lt;/u&gt;`).sub(m => `<span style="${underlineCss(T)}">${m[1] || m[2]}</span>`, s)
  s = re(String.raw`~~(?=\S)(.+?)(?<=\S)~~`).sub(m => `<span style="text-decoration:line-through;color:#9CA3AF;">${m[1]}</span>`, s)
  s = re(String.raw`(?<![*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?![*\w])`).sub(m => `<em style="font-style:normal;color:${T.main};">${m[1]}</em>`, s)
  const plain = re(String.raw`<[^>]+>|\x00\d+\x00`).sub('', s)
  for (const mk of ['**', '==']) {
    if (plain.includes(mk)) warn(`有一处 ${mk} 没配成对，照原样显示了：「${slice(strip(plain), 0, 24)}…」。是标记就补齐，本来就是原文符号则不用管`)
  }
  return re(String.raw`\x00(\d+)\x00`).sub(m => ix(keep, int(m[1])), s)
}

function pCss(T) {
  const st = T.st
  if (NEW_ST.includes(st)) return xPCss(st)
  if (st === 'mag') return 'margin:0 0 24px;font-size:16px;line-height:2;letter-spacing:1px;color:#333333;text-align:justify;'
  if (st === 'min') return 'margin:0 0 20px;font-size:15px;line-height:1.85;letter-spacing:0.3px;color:#2B2B2B;text-align:left;'
  if (st === 'geek') return `margin:0 0 20px;font-size:15px;line-height:1.9;letter-spacing:0.4px;color:${BODY};text-align:justify;`
  return `margin:0 0 22px;font-size:16px;line-height:1.9;letter-spacing:0.5px;color:${BODY};text-align:justify;`
}

// ---------------- blocks ----------------
function h2Part(n, title, sub, T) {
  const st = T.st, M = T.main
  if (st === 'neo') return neoH2(n, title, sub, T)
  if (NEW_ST.includes(st)) return xH2(n, title, sub, T)
  const subp = (col, extra = '') => (sub ? `<p style="margin:6px 0 0;font-size:11px;letter-spacing:2px;color:${col};line-height:1.4;${extra}">${esc(sub.toUpperCase())}</p>` : '')
  if (st === 'mag') {
    return `<section style="margin:54px 0 30px;text-align:center;">`
      + `<p style="margin:0;font-size:34px;line-height:1;color:${M};font-family:${SERIF};font-weight:400;">${pad(n)}</p>`
      + `<p style="margin:14px 0 0;font-size:22px;font-weight:700;color:${INK};line-height:1.5;font-family:${SERIF};letter-spacing:1px;">${title}</p>`
      + subp(MUTE) + `<span style="display:inline-block;width:32px;height:1px;background:${M};margin-top:14px;"></span></section>`
  }
  if (st === 'min') {
    return `<section style="margin:48px 0 24px;padding-bottom:10px;border-bottom:2px solid ${INK};display:flex;align-items:flex-end;">`
      + `<section style="flex:1;min-width:0;"><p style="margin:0;font-size:20px;font-weight:800;color:${INK};line-height:1.45;">${title}</p>` + subp(MUTE) + '</section>'
      + `<span style="flex-shrink:0;margin-left:12px;font-size:13px;font-weight:700;color:${M};font-family:${MONO};line-height:1.8;">${pad(n)}</span></section>`
  }
  if (st === 'geek') {
    return `<section style="margin:46px 0 24px;padding-bottom:12px;border-bottom:1.5px dashed ${T.line};">`
      + `<p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;color:${M};font-family:${MONO};line-height:1.4;">// PART_${pad(n)}` + (sub ? ` · ${esc(sub.toUpperCase())}` : '') + '</p>'
      + `<section style="display:flex;align-items:center;"><span style="flex-shrink:0;display:inline-block;background:#0B0B0C;color:#FFFFFF;font-size:14px;font-weight:700;font-family:${MONO};padding:3px 9px;border-radius:5px;margin-right:12px;">${pad(n)}</span>`
      + `<span style="font-size:20px;font-weight:800;color:${INK};line-height:1.45;">${title}</span></section></section>`
  }
  if (st === 'bold') {
    return `<section style="margin:46px 0 26px;background:${M};border-radius:16px;padding:16px 20px;display:flex;align-items:center;">`
      + `<span style="flex-shrink:0;font-size:42px;line-height:1;font-weight:800;color:#FFFFFF;opacity:0.45;font-family:Helvetica,Arial,sans-serif;margin-right:16px;">${pad(n)}</span>`
      + `<section style="flex:1;min-width:0;"><p style="margin:0;font-size:20px;font-weight:800;color:#FFFFFF;line-height:1.45;">${title}</p>` + subp('#FFFFFF', 'opacity:0.75;') + '</section></section>'
  }
  return `<section style="margin:46px 0 26px;display:flex;align-items:center;">`
    + `<section style="flex-shrink:0;padding-right:18px;margin-right:18px;border-right:1px solid ${BORDER};text-align:center;">`
    + `<p style="margin:0;font-size:12px;letter-spacing:2px;font-weight:600;color:${MUTE};line-height:1.4;">PART</p>`
    + `<p style="margin:0;font-size:40px;line-height:1.05;font-weight:800;color:${M};font-family:Helvetica,Arial,sans-serif;">${pad(n)}</p></section>`
    + `<section style="flex:1;min-width:0;"><p style="margin:0;font-size:21px;font-weight:800;color:${INK};line-height:1.45;">${title}</p>` + subp(MUTE) + '</section></section>'
}

function h2Pill(n, title, T) {
  title = `${n <= 10 ? ix(CN_NUM, n - 1) : n}、${title}`
  return `<section style="margin:46px 0 28px;text-align:center;">`
    + `<span style="display:inline-block;background:${T.main};color:#FFFFFF;font-size:18px;font-weight:800;line-height:1.5;`
    + `padding:10px 24px;border-radius:10px;box-shadow:0 4px 0 ${T.tint};">${title}</span></section>`
}

function h3(title, T) {
  const st = T.st, M = T.main
  const m = re(String.raw`^(第[一二三四五六七八九十\d]+步|Step\s*\d+)\s*[：:、.，,]?\s*(.*)$`).match(title)
  if (st === 'neo') return neoH3(m, title, T)
  if (NEW_ST.includes(st)) return xH3(m, title, T)
  if (m) {
    const chip = { mag: `border:1px solid ${M};color:${M};`, geek: `background:${T.soft};color:${M};font-family:${MONO};border-radius:5px;`, bold: `background:${M};color:#FFFFFF;` }[st] ?? `background:${INK};color:#FFFFFF;`
    return `<section style="margin:30px 0 14px;display:flex;align-items:center;">`
      + `<span style="flex-shrink:0;display:inline-block;font-size:13px;font-weight:700;padding:4px 14px;border-radius:20px;margin-right:12px;${chip}">${m[1]}</span>`
      + `<span style="font-size:18px;font-weight:800;color:${INK};line-height:1.5;">${m[2]}</span></section>`
  }
  if (st === 'mag') return `<section style="margin:34px 0 14px;"><span style="font-size:18px;font-weight:700;color:${INK};font-family:${SERIF};padding-bottom:4px;border-bottom:1px solid ${M};">${title}</span></section>`
  if (st === 'min') return `<section style="margin:30px 0 12px;"><span style="font-size:17px;font-weight:800;color:#000000;">${title}</span></section>`
  if (st === 'geek') return `<section style="margin:30px 0 14px;"><span style="font-size:16px;font-weight:700;color:${M};font-family:${MONO};margin-right:8px;">##</span><span style="font-size:18px;font-weight:800;color:${INK};">${title}</span></section>`
  if (st === 'bold') return `<section style="margin:32px 0 14px;"><span style="display:inline-block;background:${T.tint};color:${M};font-size:17px;font-weight:800;padding:5px 14px;border-radius:10px;">${title}</span></section>`
  return `<section style="margin:32px 0 14px;"><span style="display:inline-block;width:4px;height:18px;background:${M};border-radius:2px;vertical-align:-2px;margin-right:10px;"></span>`
    + `<span style="font-size:18px;font-weight:800;color:${INK};">${title}</span></section>`
}

const h4 = (title, T) => `<p style="margin:24px 0 10px;font-size:16px;font-weight:800;color:${T.st === 'dark' ? '#FFFFFF' : INK};line-height:1.6;">${title}</p>`

/** 黑底 terminal：所有风格保持一致 */
function terminal(lines) {
  const rows = lines.map(l => `<p style="margin:0;white-space:pre;font-size:14px;line-height:1.9;color:#E5E7EB;font-family:${MONO};">${esc(l) || ' '}</p>`).join('')
  return `<section style="margin:24px 0;background:#0B0B0C;border-radius:10px;padding:14px 18px 16px;">`
    + `<section style="margin-bottom:10px;line-height:0;">` + ['#FF5F57', '#FEBC2E', '#28C840'].map(c => `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${c};margin-right:7px;"></span>`).join('') + '</section>'
    + `<section style="overflow-x:auto;">${rows}</section></section>`
}

/** 长提示词：黑色 PROMPT 标签 + 文件名，正文限高可滑动 */
function promptBox(lines, title, T) {
  const body = []
  const mark = t => re('(【[^】]+】)').sub(m => `<strong style="color:${T.main};">${m[1]}</strong>`, t)
  if (NEW_ST.includes(T.st)) {
    for (const l of lines) body.push(mark(esc(l) || ' '))
    return xPrompt(body, title, T)
  }
  for (const l of lines) {
    const t = mark(esc(l) || ' ')
    body.push(`<p style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:1.85;color:${PROMPT_INK};font-family:${MONO};">${t}</p>`)
  }
  return `<section style="margin:26px 0;border:1px solid ${BORDER};border-radius:${T.r}px;background:#F8FAFC;overflow:hidden;">`
    + `<section style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid ${BORDER};background:#FFFFFF;">`
    + `<span style="display:inline-block;background:${INK};color:#FFFFFF;font-size:12px;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:20px;font-family:${MONO};">PROMPT</span>`
    + `<span style="font-size:12px;color:${MUTE};">${esc(title || '提示词')} · 上下滑动查看 ↕</span></section>`
    + `<section style="max-height:320px;overflow-y:auto;padding:14px 18px;">${body.join('')}</section></section>`
}

/** 虚线滑动卡：长提示词 / 长图 */
function dashedBox(title, icon, inner, T, height = 320) {
  const ic = {
    list: `<span style="display:block;width:14px;height:2px;background:${T.main};margin:3px auto;"></span>`.repeat(3),
    image: `<span style="display:block;width:16px;height:12px;border:2px solid ${T.main};border-radius:3px;margin:3px auto;"></span>`,
  }[icon]
  return `<section style="margin:26px 0;border:1.5px dashed ${T.line};border-radius:${T.r}px;background:#FFFFFF;overflow:hidden;">`
    + `<section style="display:flex;align-items:center;padding:12px 16px;background:${T.soft};border-bottom:1.5px dashed ${T.line};">`
    + `<span style="flex-shrink:0;display:inline-block;width:30px;height:30px;border:1px solid ${T.tint};background:#FFFFFF;border-radius:8px;padding-top:6px;box-sizing:border-box;margin-right:10px;">${ic}</span>`
    + `<span style="flex:1;font-size:15px;font-weight:700;color:#374151;">${esc(title)}</span>`
    + `<span style="font-size:12px;color:${T.main};">↕ 滑动</span></section>`
    + `<section style="max-height:${height}px;overflow-y:auto;padding:16px 18px;">${inner}</section></section>`
}

function quote(textHtml, T) {
  const st = T.st, M = T.main
  if (st === 'neo') return neoQuote(textHtml, T)
  if (NEW_ST.includes(st)) return xQuote(textHtml, T)
  if (st === 'mag') {
    return `<section style="margin:32px 0;padding:22px 14px 16px;border-top:1px solid ${T.line};border-bottom:1px solid ${T.line};text-align:center;">`
      + quoteSvg(M, 1, 30, '0 auto 8px')
      + `<section style="font-size:16px;line-height:2;color:#444444;letter-spacing:1px;font-family:${SERIF};text-align:left;">${textHtml}</section></section>`
  }
  if (st === 'min') return `<section style="margin:26px 0;padding:2px 0 2px 16px;border-left:2px solid #D4D4D8;"><section style="font-size:15px;line-height:1.85;color:${GRAY};">${textHtml}</section></section>`
  if (st === 'geek') {
    return `<section style="margin:26px 0;padding:12px 16px 10px;background:${T.soft};border:1px dashed ${T.line};border-radius:6px;">`
      + `<p style="margin:0 0 6px;font-size:12px;color:${M};font-family:${MONO};line-height:1.4;">&gt; quote</p>`
      + `<section style="font-size:15px;line-height:1.9;color:#1F2937;">${textHtml}</section></section>`
  }
  if (st === 'bold') {
    return `<section style="margin:28px 0;padding:18px 20px 14px;background:${T.tint};border-radius:16px;border-left:6px solid ${M};">`
      + `<section style="font-size:16px;line-height:1.9;color:${INK};font-weight:600;">${textHtml}</section></section>`
  }
  return `<section style="margin:28px 0;padding:18px 22px 20px;background:${T.soft};border-left:4px solid ${M};border-radius:4px 12px 12px 4px;">`
    + quoteSvg(T.line, 1, 30, '2px 0 6px')
    + `<section style="font-size:16px;line-height:1.9;color:#1F2937;letter-spacing:0.5px;">${textHtml}</section></section>`
}

/** 金句卡 */
function golden(textHtml, T) {
  const st = T.st, M = T.main
  if (st === 'neo') return neoGolden(textHtml, T)
  if (NEW_ST.includes(st)) return xGolden(textHtml, T)
  if (st === 'mag') {
    return `<section style="margin:40px 0;text-align:center;">` + quoteSvg(M, 1, 36, '0 auto')
      + `<p style="margin:10px 12px 0;font-size:21px;line-height:1.8;font-weight:700;color:${INK};font-family:${SERIF};letter-spacing:1px;">${textHtml}</p></section>`
  }
  if (st === 'min') {
    return `<section style="margin:34px 0;padding:18px 0;border-top:1px solid ${INK};border-bottom:1px solid ${INK};">`
      + `<p style="margin:0;font-size:19px;line-height:1.7;font-weight:800;color:#000000;">${textHtml}</p></section>`
  }
  if (st === 'geek') {
    return `<section style="margin:34px 0;padding:18px 18px;border:1.5px solid ${M};border-radius:6px;text-align:center;">`
      + `<p style="margin:0 0 8px;font-size:12px;color:${M};font-family:${MONO};line-height:1.4;">/* key point */</p>`
      + `<p style="margin:0;font-size:19px;line-height:1.7;font-weight:800;color:${INK};">${textHtml}</p></section>`
  }
  if (st === 'bold') {
    return `<section style="margin:34px 0;padding:24px 20px;background:${T.soft};border:2px solid ${M};border-radius:16px;text-align:center;">`
      + `<p style="margin:0;font-size:21px;line-height:1.7;font-weight:800;color:${M};">${textHtml}</p></section>`
  }
  return `<section style="margin:36px 0;text-align:center;">`
    + `<span style="display:inline-block;width:36px;height:3px;background:${M};border-radius:2px;"></span>`
    + `<p style="margin:16px 8px;font-size:20px;line-height:1.7;font-weight:800;color:${INK};">${textHtml}</p>`
    + `<span style="display:inline-block;width:36px;height:3px;background:${M};border-radius:2px;"></span></section>`
}

const CALLOUT_LABELS = { TIP: '小技巧', NOTE: '说明', WARN: '注意', TLDR: '省流版' }

function callout(kind, textHtml, T) {
  const st = T.st
  const lab = get(CALLOUT_LABELS, kind, kind)
  const wn = kind === 'WARN', col = wn ? '#D97706' : T.main
  const body = `<section style="font-size:15px;line-height:1.85;color:${BODY};">${textHtml}</section>`
  if (NEW_ST.includes(st)) return xCallout(kind, textHtml, T)
  if (st === 'neo') {
    return `<section style="margin:28px 0;border:1px solid ${wn ? '#F3DDB4' : T.tint};border-radius:16px;background:${wn ? '#FFFCF5' : '#FFFFFF'};padding:18px 20px 16px;box-shadow:0 10px 30px rgba(17,24,39,0.06);">`
      + `<p style="margin:0 0 10px;line-height:1;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${col};vertical-align:middle;margin-right:8px;"></span>`
      + `<span style="font-size:12px;font-weight:800;letter-spacing:3px;color:${col};vertical-align:middle;">${lab}</span></p>${body}</section>`
  }
  if (st === 'mag') {
    return `<section style="margin:28px 0;padding:14px 0 4px;border-top:2px solid ${col};">`
      + `<p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:3px;color:${col};">${lab}</p>${body}</section>`
  }
  if (st === 'min') return `<section style="margin:26px 0;padding:2px 0 2px 16px;border-left:2px solid ${col};"><p style="margin:0 0 4px;font-size:13px;font-weight:800;color:${col};">${lab}</p>${body}</section>`
  if (st === 'geek') {
    return `<section style="margin:26px 0;border:1px dashed ${wn ? '#F0B45C' : T.line};border-radius:6px;background:${wn ? '#FFF7E6' : '#FFFFFF'};padding:12px 16px;">`
      + `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${col};font-family:${MONO};">// ${lab}</p>${body}</section>`
  }
  if (st === 'bold') {
    return `<section style="margin:26px 0;border-radius:16px;background:${wn ? '#FFF1D6' : T.tint};padding:16px 18px;">`
      + `<span style="display:inline-block;background:${col};color:#FFFFFF;font-size:13px;font-weight:800;padding:4px 12px;border-radius:20px;margin-bottom:10px;">${lab}</span>${body}</section>`
  }
  return `<section style="margin:26px 0;border:1px solid ${wn ? '#FCD9A5' : T.tint};border-radius:12px;background:${wn ? '#FFF7E6' : '#FFFFFF'};padding:16px 18px;">`
    + `<span style="display:inline-block;background:${col};color:#FFFFFF;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;margin-bottom:10px;">${lab}</span>${body}</section>`
}

const isPlainAlt = alt => ['image', 'img', '图片'].includes(alt.toLowerCase())

function image(src, alt, T) {
  const fr = { mag: 'border-radius:0;', min: 'border-radius:0;', geek: `border-radius:6px;border:1px solid ${BORDER};box-sizing:border-box;`, bold: 'border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,0.10);' }[T.st] ?? 'border-radius:8px;'
  if (T.st === 'neo') {
    const cap = alt && !isPlainAlt(alt) ? caption(esc(alt), T, 14, 0) : ''
    return `<section style="margin:26px 0;text-align:center;"><img src="${src}" style="display:inline-block;width:100%;max-width:100%;vertical-align:top;border-radius:14px;box-shadow:0 12px 32px rgba(17,24,39,0.10);"/>${cap}</section>`
  }
  const cap = alt && !isPlainAlt(alt) ? caption(esc(alt), T, 8, 0) : ''
  return `<section style="margin:24px 0;text-align:center;"><img src="${src}" style="display:inline-block;width:100%;max-width:100%;vertical-align:top;${fr}"/>${cap}</section>`
}

/** 横滑图集，含标签、总张数、滑动提示和图注。 */
function gallery({ label, items }, T) {
  const total = items.length
  const slideW = total === 1 ? '100%' : '86%'
  const imgR = { mag: '0', min: '0', neo: '8px', bold: '10px' }[T.st] ?? '4px'
  const { badgeBg, badgeText, countColor } = galleryColors(T.st, T)
  const badgeFont = T.st === 'zen' ? `font-family:${SERIF_CN};` : ''
  const head = `<section style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;">`
    + `<span style="display:inline-block;overflow-wrap:anywhere;background:${badgeBg};color:${badgeText};font-size:11px;font-weight:800;letter-spacing:1.5px;padding:4px 10px;border-radius:3px;line-height:1.2;${badgeFont}">${esc(label || DEFAULT_GALLERY_LABEL)}</span>`
    + `<span style="flex-shrink:0;font-size:12px;color:${countColor};letter-spacing:0.5px;">${total} 张${total > 1 ? ' · 左右滑动 →' : ''}</span></section>`
  const slides = items.map((item, idx) => {
    const last = idx === total - 1
    const mr = last ? '0' : '10px'
    const description = item.caption.trim()
    const capHtml = description && !isPlainAlt(description)
      ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;text-align:left;overflow-wrap:anywhere;color:${GRAY};">${esc(description)}</p>`
      : ''
    return `<section style="display:inline-block;vertical-align:top;width:${slideW};margin-right:${mr};white-space:normal;box-sizing:border-box;scroll-snap-align:${last ? 'end' : 'start'};scroll-snap-stop:always;">`
      + `<img src="${escQ(item.src)}" style="display:block;width:100%;height:auto;border-radius:${imgR};"/>`
      + `${capHtml}</section>`
  }).join('')
  return `<section style="margin:26px 0;">${head}<section style="overflow-x:auto;white-space:nowrap;font-size:0;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;padding-bottom:4px;">${slides}</section></section>`
}

/** 图注：灰色小字。跟在图片或视频下面的一行短说明 */
function caption(textHtml, T, top = -12, bottom = 24) {
  const st = T.st
  if (st === 'neo') {
    return `<p style="margin:${top + 2}px 0 ${bottom}px;text-align:center;line-height:1.6;"><span style="display:inline-block;width:14px;height:1px;background:${T.line};vertical-align:middle;margin-right:8px;"></span>`
      + `<span style="color:${MUTE};font-size:12px;letter-spacing:0.5px;vertical-align:middle;">${textHtml}</span>`
      + `<span style="display:inline-block;width:14px;height:1px;background:${T.line};vertical-align:middle;margin-left:8px;"></span></p>`
  }
  const pre = st === 'geek' ? `<span style="color:${T.main};font-family:${MONO};">// </span>` : st === 'mag' ? `<span style="color:${T.main};">▲ </span>` : ''
  return `<p style="margin:${top}px 0 ${bottom}px;font-size:13px;color:${MUTE};text-align:${st === 'min' ? 'left' : 'center'};line-height:1.6;">${pre}${textHtml}</p>`
}

/** items: [层级, 序号或 null, 文字]。序号沿用原文写的数字 */
function listBlock(items, T, notes) {
  const st = T.st, M = T.main, fs = ['min', 'geek'].includes(st) ? '15px' : '16px', rows = []
  for (const [lv, num, text] of items) {
    let mk
    if (num === null) {
      if (st === 'neo' && !lv) mk = `<span style="flex-shrink:0;display:inline-block;width:8px;height:8px;background:${M};border-radius:2px;margin:12px 12px 0 3px;"></span>`
      else if (lv) mk = `<span style="flex-shrink:0;display:inline-block;width:5px;height:5px;border-radius:50%;border:1px solid ${M};margin:12px 11px 0 4px;"></span>`
      else if (st === 'mag') mk = `<span style="flex-shrink:0;color:${M};margin-right:10px;line-height:1.9;font-size:${fs};">—</span>`
      else if (st === 'min') mk = `<span style="flex-shrink:0;display:inline-block;width:5px;height:5px;background:${INK};margin:12px 12px 0 4px;"></span>`
      else if (st === 'geek') mk = `<span style="flex-shrink:0;color:${M};font-family:${MONO};margin-right:10px;line-height:1.9;font-size:13px;">&gt;</span>`
      else if (st === 'bold') mk = `<span style="flex-shrink:0;display:inline-block;width:8px;height:8px;border-radius:50%;background:${M};margin:11px 12px 0 2px;"></span>`
      else mk = `<span style="flex-shrink:0;display:inline-block;width:6px;height:6px;border-radius:50%;background:${M};margin:12px 12px 0 4px;"></span>`
    } else {
      if (st === 'neo') mk = `<span style="flex-shrink:0;color:${M};font-family:Helvetica,Arial,sans-serif;font-style:italic;font-size:20px;font-weight:900;margin-right:10px;line-height:1.5;min-width:28px;">${pad(num)}</span>`
      else if (st === 'mag') mk = `<span style="flex-shrink:0;color:${M};font-family:${SERIF};font-size:17px;font-weight:700;margin-right:10px;line-height:1.75;">${num}.</span>`
      else if (st === 'min') mk = `<span style="flex-shrink:0;color:#000000;font-size:${fs};font-weight:800;margin-right:8px;line-height:1.9;">${num}.</span>`
      else if (st === 'geek') mk = `<span style="flex-shrink:0;color:${M};font-family:${MONO};font-size:13px;font-weight:700;margin-right:10px;line-height:2.1;">${pad(num)}</span>`
      else if (st === 'bold') mk = `<span style="flex-shrink:0;display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:${M};color:#FFFFFF;font-size:12px;font-weight:800;margin:4px 10px 0 0;">${num}</span>`
      else mk = `<span style="flex-shrink:0;display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:${T.tint};color:${M};font-size:12px;font-weight:800;margin:4px 10px 0 0;">${num}</span>`
    }
    rows.push(`<section style="display:flex;margin:0 0 10px ${lv * 22}px;">${mk}<p style="margin:0;flex:1;min-width:0;font-size:${fs};line-height:1.9;color:${BODY};">${inline(text, T, notes)}</p></section>`)
  }
  return '<section style="margin:0 0 22px;">' + rows.join('') + '</section>'
}

function table(rows, T, notes) {
  const st = T.st, head = ix(rows, 0), n = head.length
  const body = rows.slice(1).map(r => [...r, ...Array(n).fill('')].slice(0, n))
  if (st === 'neo') {
    const th = head.map(c => `<th style="padding:12px 14px;font-weight:800;text-align:left;font-size:12px;letter-spacing:1px;background:${T.soft};color:${T.main};border-bottom:1px solid ${T.tint};">${inline(c, T, notes)}</th>`).join('')
    const tb = body.map(r => '<tr>' + r.map((c, j) => `<td style="padding:12px 14px;color:${j === 0 ? INK : BODY};font-weight:${j === 0 ? 700 : 400};border-top:1px solid #F1F2F4;">${inline(c, T, notes)}</td>`).join('') + '</tr>').join('')
    return `<section style="margin:28px 0;border:1px solid ${T.tint};border-radius:14px;overflow:hidden;background:#FFFFFF;box-shadow:0 10px 30px rgba(17,24,39,0.06);"><section style="overflow-x:auto;">`
      + `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.7;"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></section></section>`
  }
  if (st === 'dark') {
    const th = head.map(c => `<th style="padding:11px 13px;font-weight:800;text-align:left;font-size:13px;background:#1A2029;color:${T.line};border-bottom:1px solid #2A313C;">${inline(c, T, notes)}</th>`).join('')
    const tb = body.map(r => '<tr>' + r.map((c, j) => `<td style="padding:11px 13px;color:${j === 0 ? '#FFFFFF' : '#C5CCD6'};font-weight:${j === 0 ? 700 : 400};border-top:1px solid #2A313C;">${inline(c, T, notes)}</td>`).join('') + '</tr>').join('')
    return `<section style="margin:26px 0;border:1px solid #2A313C;border-radius:14px;overflow:hidden;background:#151A21;"><section style="overflow-x:auto;">`
      + `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.7;"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></section></section>`
  }
  let hs, cs
  if (['mag', 'min'].includes(st)) [hs, cs] = [`border-bottom:2px solid ${INK};color:${INK};`, `border-bottom:1px solid ${BORDER};`]
  else if (st === 'geek') [hs, cs] = [`background:#0B0B0C;color:#FFFFFF;border:1px solid #0B0B0C;font-family:${MONO};`, `border:1px solid ${BORDER};`]
  else if (st === 'bold') [hs, cs] = [`background:${T.main};color:#FFFFFF;border:1px solid ${T.main};`, `border:1px solid ${T.tint};`]
  else [hs, cs] = [`background:${T.soft};color:${INK};border:1px solid ${BORDER};`, `border:1px solid ${BORDER};`]
  const th = head.map(c => `<th style="padding:10px 12px;font-weight:700;text-align:left;${hs}">${inline(c, T, notes)}</th>`).join('')
  const tb = body.map(r => '<tr>' + r.map(c => `<td style="padding:10px 12px;color:${BODY};${cs}">${inline(c, T, notes)}</td>`).join('') + '</tr>').join('')
  return `<section style="margin:24px 0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.7;"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></section>`
}

function hr(T) {
  const st = T.st, M = T.main, box = '<section style="margin:40px 0;text-align:center;line-height:1;">'
  if (NEW_ST.includes(st)) return xHr(T)
  if (st === 'mag') {
    const ln = `<span style="display:inline-block;width:44px;height:1px;background:${T.line};vertical-align:middle;"></span>`
    return box + ln + `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${M};margin:0 10px;vertical-align:middle;"></span>` + ln + '</section>'
  }
  if (st === 'min') return box + `<span style="display:inline-block;width:40px;height:1px;background:${INK};"></span></section>`
  if (st === 'neo') {
    const sq = c => `<span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:2px;margin:0 4px;vertical-align:middle;"></span>`
    const ln = (a, b) => `<span style="display:inline-block;width:70px;height:3px;border-radius:2px;background:linear-gradient(90deg,${a},${b});vertical-align:middle;"></span>`
    return box + ln('#FFFFFF', M) + sq(T.line) + sq(INK) + sq(T.line) + ln(M, '#FFFFFF') + '</section>'
  }
  if (st === 'geek') return box + `<span style="font-size:13px;letter-spacing:6px;color:${T.line};font-family:${MONO};">/ / /</span></section>`
  if (st === 'bold') return box + `<span style="display:inline-block;width:56px;height:5px;border-radius:3px;background:${M};"></span></section>`
  return box + [T.tint, M, T.tint].map(c => `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};margin:0 6px;"></span>`).join('') + '</section>'
}

function videoSlot(name, T) {
  return `<section data-video-slot="${esc(name)}" style="margin:20px 0;border:1.5px dashed ${T.line};border-radius:12px;background:${T.soft};padding:18px 16px;text-align:center;">`
    + `<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${T.main};">此处放视频：${esc(name)}</p>`
    + `<p style="margin:0;font-size:13px;color:#888888;">在公众号编辑器里插入视频或动图，然后删掉这个方框</p></section>`
}

const AUTHOR = '林月半子的AI笔记', SLOGAN = '我是林月半子，教你用AI干掉90%的重复劳动', CTA = '点个关注，下一篇见 →'

function authorCard(T, meta) {
  if (NEW_ST.includes(T.st)) return xAuthor(T, meta)
  if (T.st === 'neo') {
    return `<section style="margin:52px 0 16px;padding:22px;border:1px solid ${T.tint};border-radius:18px;background:#FFFFFF;box-shadow:0 12px 32px rgba(17,24,39,0.07);display:flex;align-items:center;">`
      + `<section style="flex-shrink:0;width:72px;height:72px;border-radius:50%;background:${T.tint};overflow:hidden;margin-right:16px;"><img src="GIF_URL_HERE" style="display:block;width:72px;height:72px;"/></section>`
      + `<section style="flex:1;"><p style="margin:0;font-size:17px;font-weight:900;color:${INK};">${esc(get(meta, 'author', AUTHOR))}</p>`
      + `<p style="margin:4px 0 0;font-size:13px;line-height:1.7;color:${GRAY};">${esc(get(meta, 'slogan', SLOGAN))}</p>`
      + `<p style="margin:10px 0 0;line-height:1;"><span style="display:inline-block;color:${T.main};font-size:12px;font-weight:800;letter-spacing:0.5px;padding:5px 12px;border-radius:20px;border:1px solid ${T.line};">${esc(get(meta, 'outro_cta', CTA))}</span></p></section></section>`
  }
  const box = ['min', 'mag'].includes(T.st)
    ? `margin:48px 0 12px;padding:20px 0 0;border-top:1px solid ${INK};`
    : `margin:48px 0 12px;padding:20px;border-radius:${Math.max(T.r, 6) + 2}px;background:${T.soft};border:1px solid ${T.tint};`
  return `<section style="${box}display:flex;align-items:center;">`
    + `<section style="flex-shrink:0;width:72px;height:72px;border-radius:50%;background:${T.tint};overflow:hidden;margin-right:16px;"><img src="GIF_URL_HERE" style="display:block;width:72px;height:72px;"/></section>`
    + `<section style="flex:1;"><p style="margin:0;font-size:17px;font-weight:800;color:${INK};">${esc(get(meta, 'author', AUTHOR))}</p>`
    + `<p style="margin:4px 0 0;font-size:13px;line-height:1.7;color:${GRAY};">${esc(get(meta, 'slogan', SLOGAN))}</p>`
    + `<p style="margin:8px 0 0;font-size:13px;font-weight:700;color:${T.main};">${esc(get(meta, 'outro_cta', CTA))}</p></section></section>`
}

function notesBlock(notes, T) {
  if (!notes.length) return ''
  const items = notes.map(([t, u], i) => `<p style="margin:0 0 6px;font-size:12px;line-height:1.7;color:${MUTE};word-break:break-all;">[${i + 1}] ${esc(t)}：${esc(u)}</p>`).join('')
  return `<section style="margin:36px 0 0;padding-top:14px;border-top:1px solid ${BORDER};"><p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${GRAY};">参考链接</p>${items}</section>`
}
// ---------------- 潮酷风格（neo）：巨型数字/引号做底纹，黑描边，错位色块投影 ----------------
function neoH2(n, title, sub, T) {
  const M = T.main
  return `<section style="margin:56px 0 30px;">`
    + `<p style="margin:0 0 0 -3px;line-height:0.82;height:70px;white-space:nowrap;overflow:hidden;">`
    + `<span style="font-size:92px;line-height:0.82;font-weight:900;font-style:italic;letter-spacing:-3px;color:${T.tint};font-family:Helvetica,Arial,sans-serif;">${pad(n)}</span>`
    + `<span style="font-size:11px;font-weight:800;letter-spacing:3px;color:${M};margin-left:14px;vertical-align:30px;">${sub ? esc(sub.toUpperCase()) : 'PART ' + pad(n)}</span></p>`
    + `<section style="margin:-20px 0 0 10px;">`
    + `<p style="margin:0;font-size:23px;font-weight:900;color:${INK};line-height:1.4;">${title}</p>`
    + `<section style="margin-top:12px;line-height:0;"><span style="display:inline-block;width:72px;height:6px;border-radius:3px;background:linear-gradient(90deg,${M},${T.line});"></span>`
    + `<span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${INK};margin-left:5px;"></span></section></section></section>`
}

function neoH3(m, title, T) {
  const M = T.main
  if (m) {
    return `<section style="margin:32px 0 16px;display:flex;align-items:center;">`
      + `<span style="flex-shrink:0;display:inline-block;background:${INK};color:#FFFFFF;font-size:13px;font-weight:800;padding:5px 14px;border-radius:20px;letter-spacing:1px;margin-right:12px;">${m[1]}</span>`
      + `<span style="font-size:18px;font-weight:900;color:${INK};line-height:1.5;">${m[2]}</span></section>`
  }
  return `<section style="margin:34px 0 14px;display:flex;align-items:center;">`
    + `<span style="flex-shrink:0;display:inline-block;width:18px;height:3px;background:${M};border-radius:2px;margin-right:10px;"></span>`
    + `<span style="font-size:18px;font-weight:900;color:${INK};line-height:1.5;">${title}</span></section>`
}

/** 大引号压在左上角当底纹，文字叠在上面 */
function neoQuote(textHtml, T) {
  return `<section style="margin:32px 0;padding:14px 24px 22px;background:${T.soft};border:1px solid ${T.tint};border-radius:18px;overflow:hidden;">`
    + quoteSvg(T.line, 0.55, 58, '18px 0 8px -2px')
    + `<section style="margin-top:0;font-size:16px;line-height:1.95;color:${INK};letter-spacing:0.5px;">${textHtml}</section>`
    + `<section style="margin-top:10px;text-align:right;line-height:0;"><span style="display:inline-block;width:28px;height:4px;border-radius:2px;background:${T.main};"></span></section></section>`
}

/** 金句卡：浅色扁平。超大引号当底纹，文字压在引号下半截上，没有阴影和描边 */
function neoGolden(textHtml, T) {
  const M = T.main
  return `<section style="margin:40px 0;padding:1px 28px 30px;background:${T.soft};border-radius:22px;overflow:hidden;">`
    + quoteSvg(T.line, 0.45, 96, '26px 0 12px -2px')
    + `<p style="margin:0;font-size:22px;line-height:1.7;font-weight:900;color:${INK};letter-spacing:0.5px;">${textHtml}</p>`
    + `<section style="margin-top:18px;line-height:0;"><span style="display:inline-block;width:56px;height:5px;border-radius:3px;background:linear-gradient(90deg,${M},${T.line});vertical-align:middle;"></span>`
    + `<span style="display:inline-block;width:5px;height:5px;border-radius:3px;background:${INK};margin-left:5px;vertical-align:middle;"></span></section></section>`
}

// ================= 4 套新风格：手账 note / 雅致 zen / 卡片 bento / 暗夜 dark =================
// 没写分支的组件（列表、表格、图片、步骤卡等）自动用标准风格的样子；暗夜在最后统一把浅色底上的文字色换成深色底上的
const SERIF_CN = "'Songti SC','STSong','Source Han Serif SC','Noto Serif SC','Noto Serif CJK SC',Georgia,serif"
const CN_BIG = '壹贰叁肆伍陆柒捌玖拾'
const DK_BG = '#0F1218', DK_PANEL = '#151A21', DK_BORDER = '#2A313C'

/** 大引号画成 SVG 形状：不依赖 Georgia 字体（大多数安卓手机没有，引号会掉下来压字） */
function quoteSvg(color, opacity = 1, w = 92, margin = '0') {
  const h = round(w * 0.72)
  const mark = dx => `<circle cx="${18 + dx}" cy="47" r="15" fill="${color}"/>`
    + `<path d="M${3 + dx} 47C${3 + dx} 26 ${13 + dx} 11 ${32 + dx} 3L${36 + dx} 10C${24 + dx} 17 ${19 + dx} 27 ${20 + dx} 37Z" fill="${color}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 64" width="${w}" height="${h}" `
    + `style="display:block;margin:${margin};overflow:visible;"><g opacity="${opacity}">${mark(0)}${mark(40)}</g></svg>`
}

function xPCss(st) {
  return {
    note: 'margin:0 0 22px;font-size:16px;line-height:1.95;letter-spacing:0.5px;color:#3D3A36;text-align:justify;',
    zen: 'margin:0 0 24px;font-size:16px;line-height:2.05;letter-spacing:1px;color:#333333;text-align:justify;',
    bento: 'margin:0 0 22px;font-size:16px;line-height:1.85;letter-spacing:0.3px;color:#1D1D1F;text-align:justify;',
    dark: 'margin:0 0 22px;font-size:16px;line-height:1.9;letter-spacing:0.5px;color:#C5CCD6;text-align:justify;',
  }[st]
}

function xStrong(T) {
  const st = T.st
  if (st === 'note') return `font-weight:700;color:#1F1F1F;background:${T.mark};padding:2px 4px;border-radius:3px;`
  if (st === 'zen') return `font-weight:700;color:#1F1F1F;background:linear-gradient(transparent 66%,${T.tint} 66%);padding:0 2px;`
  if (st === 'bento') return `font-weight:700;color:#1D1D1F;background:${T.tint};padding:2px 7px;border-radius:7px;`
  return 'font-weight:700;color:#FFFFFF;background:#252C37;padding:2px 6px;border-radius:5px;'
}

function xChip(T) {
  const st = T.st
  if (st === 'zen') return `font-family:${SERIF_CN};font-weight:700;color:#FFFFFF;background:${T.main};padding:3px 9px;letter-spacing:1px;`
  if (st === 'bento') return `background:${T.main};color:#FFFFFF;font-weight:700;padding:4px 10px;border-radius:9px;`
  if (st === 'dark') return `background:${T.line};color:${DK_BG};font-weight:800;padding:2px 8px;border-radius:4px;`
  return `background:${T.main};color:#FFFFFF;font-weight:700;padding:2px 7px;border-radius:3px;`
}

/** ++下划线++：每种风格一种画法，和荧光笔、色块分得开 */
function underlineCss(T) {
  const st = T.st, M = T.main
  return {
    mag: `border-bottom:1px solid ${M};padding-bottom:3px;`, min: `border-bottom:2px solid ${INK};padding-bottom:1px;`,
    geek: `border-bottom:2px dashed ${M};padding-bottom:2px;`, bold: `border-bottom:3px solid ${M};padding-bottom:1px;`,
    neo: `border-bottom:2px solid ${T.line};padding-bottom:2px;`, note: `border-bottom:2px dashed ${M};padding-bottom:2px;`,
    zen: `border-bottom:1px solid ${M};padding-bottom:3px;`, bento: `border-bottom:2px solid ${M};padding-bottom:1px;`,
    dark: `color:#E6EAF0;border-bottom:2px solid ${T.line};padding-bottom:1px;`,
  }[st] ?? `border-bottom:2px solid ${M};padding-bottom:1px;`
}

function xH2(n, title, sub, T) {
  const st = T.st, M = T.main, S = T.soft, TT = T.tint, L = T.line, K = T.mark
  if (st === 'note') {
    return `<section style="margin:52px 0 26px;padding-bottom:16px;border-bottom:1.5px dashed ${L};">`
      + `<p style="margin:0;line-height:1;"><span style="display:inline-block;background:${K};color:#1F1F1F;font-size:12px;font-weight:800;letter-spacing:2px;line-height:1;padding:6px 14px;transform:rotate(-3deg);font-family:${MONO};">NO.${pad(n)}</span></p>`
      + `<p style="margin:14px 0 0;font-size:23px;font-weight:800;color:#1F1F1F;line-height:1.55;"><span style="background:linear-gradient(transparent 62%,${TT} 62%);padding:0 4px;">${title}</span></p>`
      + (sub ? `<p style="margin:8px 0 0 4px;font-size:11px;letter-spacing:3px;color:#A8A29E;line-height:1.4;">— ${esc(sub.toUpperCase())}</p>` : '') + '</section>'
  }
  if (st === 'zen') {
    const ln = `<span style="display:inline-block;width:28px;height:1px;background:${L};vertical-align:middle;margin:0 10px;"></span>`
    return `<section style="margin:60px 0 34px;text-align:center;">`
      + `<p style="margin:0;line-height:1;"><span style="display:inline-block;width:42px;height:42px;line-height:42px;background:${M};color:#FFFFFF;font-size:21px;font-weight:700;border-radius:5px;font-family:${SERIF_CN};">${n <= 10 ? ix(CN_BIG, n - 1) : n}</span></p>`
      + `<p style="margin:18px 0 0;font-size:23px;font-weight:700;letter-spacing:3px;color:#1F1F1F;line-height:1.6;font-family:${SERIF_CN};">${title}</p>`
      + (sub ? `<p style="margin:12px 0 0;font-size:10px;letter-spacing:4px;color:#A8A29E;line-height:1.4;">${ln}${esc(sub.toUpperCase())}${ln}</p>` : '') + '</section>'
  }
  if (st === 'bento') {
    return `<section style="margin:52px 0 26px;background:${S};border-radius:22px;padding:22px 22px 24px;">`
      + `<p style="margin:0;line-height:1;"><span style="display:inline-block;background:${M};color:#FFFFFF;font-size:13px;font-weight:800;line-height:1;padding:6px 13px;border-radius:20px;font-family:Helvetica,Arial,sans-serif;">${pad(n)}</span>`
      + (sub ? `<span style="margin-left:10px;font-size:11px;font-weight:600;letter-spacing:2px;color:#86868B;">${esc(sub.toUpperCase())}</span>` : '') + '</p>'
      + `<p style="margin:14px 0 0;font-size:24px;font-weight:800;color:#1D1D1F;line-height:1.4;">${title}</p></section>`
  }
  return `<section style="margin:54px 0 28px;">`
    + `<p style="margin:0 0 0 -2px;font-size:68px;line-height:0.9;height:46px;font-weight:800;color:#1D242E;font-family:Helvetica,Arial,sans-serif;">${pad(n)}</p>`
    + (sub ? `<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:3px;color:${L};line-height:1.4;">${esc(sub.toUpperCase())}</p>` : '')
    + `<p style="margin:8px 0 0;font-size:23px;font-weight:800;color:#FFFFFF;line-height:1.45;">${title}</p>`
    + `<p style="margin:16px 0 0;line-height:0;"><span style="display:inline-block;width:48px;height:3px;border-radius:2px;background:${L};"></span></p></section>`
}

function xH3(m, title, T) {
  const st = T.st, M = T.main, ink = st === 'dark' ? '#FFFFFF' : '#1F1F1F'
  if (m) {
    const chip = {
      note: `background:${T.mark};color:#1F1F1F;transform:rotate(-2deg);`, zen: `border:1px solid ${M};color:${M};font-family:${SERIF_CN};`,
      bento: `background:${M};color:#FFFFFF;`, dark: `background:${T.line};color:${DK_BG};`,
    }[st]
    return `<section style="margin:30px 0 14px;display:flex;align-items:center;">`
      + `<span style="flex-shrink:0;display:inline-block;font-size:13px;font-weight:700;padding:4px 14px;border-radius:20px;margin-right:12px;${chip}">${m[1]}</span>`
      + `<span style="font-size:18px;font-weight:800;color:${ink};line-height:1.5;">${m[2]}</span></section>`
  }
  if (st === 'zen') return `<section style="margin:34px 0 14px;"><span style="font-size:18px;font-weight:700;color:${ink};font-family:${SERIF_CN};letter-spacing:1px;">${title}</span></section>`
  if (st === 'note') return `<section style="margin:32px 0 14px;"><span style="font-size:18px;font-weight:800;color:${ink};background:linear-gradient(transparent 60%,${T.mark} 60%);padding:0 3px;">${title}</span></section>`
  if (st === 'bento') return `<section style="margin:32px 0 14px;"><span style="display:inline-block;background:${T.soft};color:#1D1D1F;font-size:17px;font-weight:800;padding:6px 14px;border-radius:12px;">${title}</span></section>`
  return `<section style="margin:32px 0 14px;"><span style="font-size:18px;font-weight:800;color:${ink};border-left:3px solid ${T.line};padding-left:10px;">${title}</span></section>`
}

function xQuote(textHtml, T) {
  const st = T.st, M = T.main, S = T.soft, TT = T.tint, L = T.line
  if (st === 'note') {
    return `<section style="margin:30px 6px;padding:16px 20px;background:#FFFFFF;border:1.5px dashed ${L};border-radius:6px;">`
      + `<section style="font-size:16px;line-height:1.95;color:#3D3A36;">${textHtml}</section></section>`
  }
  if (st === 'zen') {
    return `<section style="margin:32px 0;padding:6px 0 6px 20px;border-left:2px solid ${M};">`
      + `<section style="font-size:16px;line-height:2;color:#444444;letter-spacing:1px;font-family:${SERIF_CN};">${textHtml}</section></section>`
  }
  if (st === 'bento') {
    return `<section style="margin:28px 0;padding:6px 22px 20px;background:${S};border-radius:20px;">` + quoteSvg(TT, 1, 40, '14px 0 4px')
      + `<section style="font-size:16px;line-height:1.9;color:#1D1D1F;">${textHtml}</section></section>`
  }
  return `<section style="margin:28px 0;padding:6px 20px 18px;background:${DK_PANEL};border:1px solid ${DK_BORDER};border-radius:14px;">` + quoteSvg(L, 0.55, 36, '14px 0 4px')
    + `<section style="font-size:16px;line-height:1.9;color:#E6EAF0;">${textHtml}</section></section>`
}

function xGolden(textHtml, T) {
  const st = T.st, S = T.soft, TT = T.tint, L = T.line, K = T.mark
  if (st === 'note') {
    return `<section style="margin:44px 6px 40px;background:${S};border:1.5px dashed ${L};border-radius:6px;padding:0 22px 24px;text-align:center;">`
      + `<p style="margin:-12px 0 16px;line-height:0;"><span style="display:inline-block;width:84px;height:24px;background:${K};opacity:0.9;transform:rotate(-2deg);"></span></p>`
      + `<p style="margin:0;font-size:19px;line-height:1.75;font-weight:800;color:#1F1F1F;">${textHtml}</p></section>`
  }
  if (st === 'zen') {
    return `<section style="margin:46px 0;padding:28px 10px;border-top:3px double ${L};border-bottom:3px double ${L};text-align:center;">`
      + `<p style="margin:0;font-size:20px;line-height:1.9;font-weight:700;letter-spacing:2px;color:#1F1F1F;font-family:${SERIF_CN};"><span style="color:${L};">「</span>${textHtml}<span style="color:${L};">」</span></p></section>`
  }
  if (st === 'bento') {
    return `<section style="margin:40px 0;background:${S};border-radius:26px;padding:10px 26px 30px;overflow:hidden;">` + quoteSvg(TT, 1, 74, '22px 0 14px')
      + `<p style="margin:0;font-size:22px;line-height:1.6;font-weight:800;color:#1D1D1F;">${textHtml}</p></section>`
  }
  return `<section style="margin:40px 0;background:${DK_PANEL};border:1px solid ${DK_BORDER};border-radius:18px;padding:8px 24px 28px;overflow:hidden;">` + quoteSvg(L, 0.55, 64, '22px 0 14px')
    + `<p style="margin:0;font-size:21px;line-height:1.65;font-weight:800;color:#FFFFFF;">${textHtml}</p></section>`
}

function xCallout(kind, textHtml, T) {
  const st = T.st, lab = get(CALLOUT_LABELS, kind, kind)
  const wn = kind === 'WARN', col = wn ? '#D97706' : T.main
  if (st === 'note') {
    return `<section style="margin:30px 6px;border:1.5px dashed ${wn ? '#F0B45C' : T.line};border-radius:6px;background:#FFFFFF;padding:22px 18px 14px;">`
      + `<p style="margin:-34px 0 10px;line-height:1;"><span style="display:inline-block;background:${wn ? '#FDE3B0' : T.mark};color:#1F1F1F;font-size:12px;font-weight:800;padding:5px 12px;transform:rotate(-2deg);">${lab}</span></p>`
      + `<section style="font-size:15px;line-height:1.85;color:#3D3A36;">${textHtml}</section></section>`
  }
  if (st === 'zen') {
    return `<section style="margin:30px 0;padding:16px 4px 6px;border-top:1px solid ${col};border-bottom:1px solid ${T.tint};">`
      + `<p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:4px;color:${col};font-family:${SERIF_CN};">${lab}</p>`
      + `<section style="font-size:15px;line-height:1.95;color:#444444;">${textHtml}</section></section>`
  }
  if (st === 'bento') {
    return `<section style="margin:26px 0;border-radius:20px;background:${wn ? '#FFF4E0' : T.soft};padding:18px 20px;">`
      + `<span style="display:inline-block;background:${col};color:#FFFFFF;font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;margin-bottom:10px;">${lab}</span>`
      + `<section style="font-size:15px;line-height:1.85;color:#1D1D1F;">${textHtml}</section></section>`
  }
  return `<section style="margin:26px 0;border-radius:14px;background:${DK_PANEL};border:1px solid ${wn ? '#6B4A1A' : DK_BORDER};padding:16px 18px;">`
    + `<span style="display:inline-block;background:${wn ? '#F0B45C' : T.line};color:${DK_BG};font-size:12px;font-weight:800;padding:3px 10px;border-radius:6px;margin-bottom:10px;">${lab}</span>`
    + `<section style="font-size:15px;line-height:1.85;color:#C5CCD6;">${textHtml}</section></section>`
}

function xPrompt(body, title, T) {
  const st = T.st, L = T.line, lab = `${esc(title || '提示词')} · 上下滑动查看 ↕`
  const p = (col, lh) => body.map(b => `<p style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:${lh};color:${col};font-family:${MONO};">${b}</p>`).join('')
  if (st === 'note') {
    return `<section style="margin:28px 0;border:1.5px solid ${L};border-radius:6px;background:#FFFFFF;">`
      + `<section style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1.5px dashed ${L};">`
      + `<span style="display:inline-block;background:${T.mark};color:#1F1F1F;font-size:12px;font-weight:800;letter-spacing:1px;padding:4px 12px;transform:rotate(-2deg);font-family:${MONO};">PROMPT</span>`
      + `<span style="font-size:12px;color:#A8A29E;">${lab}</span></section><section style="max-height:320px;overflow-y:auto;padding:14px 18px;">${p('#5B5A57', '1.9')}</section></section>`
  }
  if (st === 'zen') {
    return `<section style="margin:30px 0;border:1px solid ${L};padding:4px;"><section style="border:1px solid ${T.tint};background:#FFFFFF;">`
      + `<section style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid ${T.tint};">`
      + `<span style="font-size:13px;font-weight:700;letter-spacing:4px;color:${T.main};font-family:${SERIF_CN};">PROMPT</span><span style="font-size:12px;color:#A8A29E;">${lab}</span></section>`
      + `<section style="max-height:320px;overflow-y:auto;padding:16px 18px;">${p('#5B5A57', '2')}</section></section></section>`
  }
  if (st === 'bento') {
    return `<section style="margin:26px 0;border-radius:20px;background:#F5F5F7;overflow:hidden;">`
      + `<section style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 0;">`
      + `<span style="display:inline-block;background:#1D1D1F;color:#FFFFFF;font-size:12px;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:20px;font-family:${MONO};">PROMPT</span>`
      + `<span style="font-size:12px;color:#86868B;">${lab}</span></section><section style="max-height:320px;overflow-y:auto;padding:14px 18px 18px;">${p('#515154', '1.85')}</section></section>`
  }
  return `<section style="margin:26px 0;border:1px solid ${DK_BORDER};border-radius:14px;background:${DK_PANEL};overflow:hidden;">`
    + `<section style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid ${DK_BORDER};background:#1A2029;">`
    + `<span style="display:inline-block;background:${L};color:${DK_BG};font-size:12px;font-weight:800;letter-spacing:1px;padding:4px 12px;border-radius:20px;font-family:${MONO};">PROMPT</span>`
    + `<span style="font-size:12px;color:#6B7685;">${lab}</span></section><section style="max-height:320px;overflow-y:auto;padding:14px 18px;">${p('#9FB0C3', '1.85')}</section></section>`
}

function xHr(T) {
  const st = T.st, M = T.main, L = T.line, K = T.mark, TT = T.tint
  if (st === 'note') {
    return `<section style="margin:40px 0;display:flex;align-items:center;justify-content:center;">`
      + `<span style="display:inline-block;width:70px;border-top:1.5px dashed ${L};"></span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${K};border:1.5px solid ${L};margin:0 12px;"></span>`
      + `<span style="display:inline-block;width:70px;border-top:1.5px dashed ${L};"></span></section>`
  }
  if (st === 'zen') {
    const ln = `<span style="display:inline-block;width:56px;height:1px;background:${L};vertical-align:middle;"></span>`
    return `<section style="margin:44px 0;text-align:center;line-height:1;">${ln}`
      + `<span style="display:inline-block;width:7px;height:7px;background:${M};transform:rotate(45deg);vertical-align:middle;margin:0 14px;"></span>${ln}</section>`
  }
  if (st === 'bento') return `<section style="margin:40px 0;text-align:center;line-height:0;"><span style="display:inline-block;width:44px;height:5px;border-radius:3px;background:${TT};"></span></section>`
  return '<section style="margin:40px 0;text-align:center;line-height:1;">'
    + [DK_BORDER, L, DK_BORDER].map(c => `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};margin:0 6px;"></span>`).join('') + '</section>'
}

function xAuthor(T, meta) {
  const st = T.st
  const box = {
    note: `border-radius:6px;background:#FFFFFF;border:1.5px dashed ${T.line};`, zen: `border-top:1px solid ${T.line};border-bottom:1px solid ${T.line};`,
    bento: `border-radius:24px;background:${T.soft};`, dark: `border-radius:16px;background:${DK_PANEL};border:1px solid ${DK_BORDER};`,
  }[st]
  const [c1, c2, c3, av] = st === 'dark' ? ['#FFFFFF', '#8B95A3', T.line, '#232A35'] : ['#1F1F1F', '#78716C', T.main, T.tint]
  return `<section style="margin:48px 0 12px;padding:20px;${box}display:flex;align-items:center;">`
    + `<section style="flex-shrink:0;width:72px;height:72px;border-radius:50%;background:${av};overflow:hidden;margin-right:16px;"><img src="GIF_URL_HERE" style="display:block;width:72px;height:72px;"/></section>`
    + `<section style="flex:1;"><p style="margin:0;font-size:17px;font-weight:800;color:${c1};">${esc(get(meta, 'author', AUTHOR))}</p>`
    + `<p style="margin:4px 0 0;font-size:13px;line-height:1.7;color:${c2};">${esc(get(meta, 'slogan', SLOGAN))}</p>`
    + `<p style="margin:8px 0 0;font-size:13px;font-weight:700;color:${c3};">${esc(get(meta, 'outro_cta', CTA))}</p></section></section>`
}

/** 暗夜：没写分支的组件（正文列表、表格、图注、小标题等）在深色底上要换成浅色字。SVG 里的颜色不动 */
function darkFix(h) {
  const parts = re(String.raw`(<svg[\s\S]*?</svg>)`).split(h)
  const rep = [['color:#111827', 'color:#FFFFFF'], ['color:#3F3F46', 'color:#C5CCD6'], ['color:#1F2937', 'color:#E6EAF0'], ['color:#374151', 'color:#E6EAF0'],
    ['color:#6B7280', 'color:#8B95A3'], ['color:#94A3B8', 'color:#6B7685'], ['background:#FFFFFF', `background:${DK_PANEL}`],
    ['background:#F8FAFC', `background:${DK_PANEL}`], ['border:1px solid #E5E7EB', `border:1px solid ${DK_BORDER}`],
    ['border-top:1px solid #F1F2F4', `border-top:1px solid ${DK_BORDER}`], ['border-bottom:1px solid #E5E7EB', `border-bottom:1px solid ${DK_BORDER}`],
    ['color:#52607A', 'color:#9FB0C3']]
  for (let k = 0; k < parts.length; k += 2) {
    for (const [a, b] of rep) parts[k] = parts[k].split(a).join(b)
  }
  return parts.join('')
}

// ---------------- 公众号会删掉没有文字的空元素：装饰色块一律画成 SVG ----------------
function px(v) {
  const m = re(String.raw`(-?[\d.]+)px`).match(strip(v))
  return m ? float(m[1]) : null
}
const r2 = v => rstrip(rstrip(fixed(v, 2), '0'), '.')

function decoSvg(style) {
  const d = Object.create(null)
  for (const part of style.split(';')) {
    if (part.includes(':')) {
      const [k, v] = splitN(part, ':', 1)
      d[strip(k)] = strip(v)
    }
  }
  const has = k => Object.hasOwn(d, k)
  const w = px(get(d, 'width', '')); let h = px(get(d, 'height', ''))
  if (w === null) return null
  const keep = ['margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'vertical-align', 'flex-shrink'].filter(has).map(k => `${k}:${d[k]}`)
  let inner
  if (has('border-top') && h === null) {
    const parts = splitWs(d['border-top'])
    if (parts.length !== 3) throw new PyError('ValueError', 'not enough values to unpack')
    const [bw, bs, bc] = parts
    const t = px(bw)
    if (t === null) throw new PyError('TypeError', "unsupported operand type(s) for +: 'NoneType' and 'float'")
    h = Math.max(2, round(t + 0.5))
    const dash = bs === 'dashed' ? ' stroke-dasharray="4 3"' : ''
    inner = `<line x1="0" y1="${r2(h / 2)}" x2="${r2(w)}" y2="${r2(h / 2)}" stroke="${bc}" stroke-width="${r2(t)}"${dash}/>`
  } else {
    if (h === null) return null
    const br = get(d, 'border-radius', '0')
    const rx = br.includes('%') ? Math.min(w, h) / 2 : Math.min(px(br) || 0, Math.min(w, h) / 2)
    const bg = get(d, 'background', '')
    let stroke = '', sw = 0
    if (has('border')) {
      const parts = splitWs(d.border)
      if (parts.length !== 3) throw new PyError('ValueError', 'not enough values to unpack')
      const [bw, , bc] = parts
      sw = px(bw); stroke = ` stroke="${bc}" stroke-width="${r2(sw)}"`
    }
    const gm = re(String.raw`linear-gradient\(90deg,\s*(#[0-9A-Fa-f]{6}),\s*(#[0-9A-Fa-f]{6})\)`).match(bg)
    if (gm) { // 渐变：公众号会删 SVG 渐变，用一排细条逐渐变淡拼出来
      const [, c1, c2] = gm
      const a = rx, b_ = w - rx, n = Math.max(8, Math.trunc((b_ - a) / 1.5)), sw_ = (b_ - a) / n
      inner = `<rect x="0" y="0" width="${r2(w)}" height="${r2(h)}" rx="${r2(rx)}" fill="${c2}"/>`
        + `<rect x="0" y="0" width="${r2(2 * rx)}" height="${r2(h)}" rx="${r2(rx)}" fill="${c1}"/>`
      for (let i = 0; i < n; i++) {
        inner += `<rect x="${r2(a + i * sw_)}" y="0" width="${r2(sw_)}" height="${r2(h)}" fill="${c1}" fill-opacity="${fixed(1 - (i + 0.5) / n, 3)}" shape-rendering="crispEdges"/>`
      }
    } else {
      if ((!bg && !stroke) || bg.includes('(')) return null
      const o = sw / 2
      inner = `<rect x="${r2(o)}" y="${r2(o)}" width="${r2(w - sw)}" height="${r2(h - sw)}" rx="${r2(Math.max(0, rx - o))}" fill="${bg || 'none'}"${stroke}/>`
    }
    const tr = re(String.raw`rotate\((-?[\d.]+)deg\)`).match(get(d, 'transform', ''))
    if (tr) inner = `<g transform="rotate(${tr[1]} ${r2(w / 2)} ${r2(h / 2)})">${inner}</g>`
    if (has('opacity')) inner = `<g opacity="${d.opacity}">${inner}</g>`
  }
  const disp = get(d, 'display') === 'block' ? 'display:block' : 'display:inline-block'
  const st = [disp, 'overflow:visible', ...keep].join(';')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(w)} ${r2(h)}" width="${r2(w)}" height="${r2(h)}" style="${st};">${inner}</svg>`
}

const fixEmpty = h => re('<span style="([^"]*)"></span>').sub(m => decoSvg(m[1]) || m[0], h)

/** 「复制 Markdown」用的纯正文：去掉图片、视频、动画卡和 [] 占位，标记符号去掉，方便贴到朱雀做 AI 检测 */
export function plainMd(md) {
  const out = []
  let fence = false, lang = '', buf = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    let s = strip(ln)
    const m = re(String.raw`^(` + '```' + String.raw`+|~~~+)\s*([\w-]*)`).match(s)
    if (m && !fence) { fence = true; lang = m[2].toLowerCase(); buf = []; continue }
    if (fence && (s.startsWith('```') || s.startsWith('~~~'))) {
      fence = false
      if (['prompt', 'promptbox', 'text', ''].includes(lang)) out.push(...buf.filter(x => strip(x)).map(x => '> ' + x))
      continue
    }
    if (fence) { buf.push(ln); continue }
    if (s.startsWith('<')) {
      if (parseGalleryBlock(s)) continue
      if (isGalleryOpening(s)) {
        const gbuf = [ln]
        let j = i + 1
        while (j < lines.length && strip(lines[j])) {
          gbuf.push(lines[j])
          if (strip(lines[j]).endsWith('>')) { j++; break }
          j++
        }
        if (parseGalleryBlock(gbuf.join('\n'))) { i = j - 1; continue }
      }
    }
    if (re(String.raw`^!\[|^\[[^\]]*\.(mp4|mov|gif)\]$|^\[(截图|可补|可选|视频|GIF)`).match(s) || s.startsWith('^')) continue
    s = re(String.raw`\[!(\w+)\]\s*`).sub('', s)
    s = re(String.raw`\*\*|==|\+\+|~~`).sub('', s)
    s = re(String.raw`\[([^\]]+)\]\([^)]+\)`).sub(m => m[1], s)
    s = re(String.raw`[，,]?\[可补[^\]]*\]`).sub('', s)
    out.push(s)
  }
  return strip(re(String.raw`\n{3,}`).sub('\n\n', out.join('\n')))
}
// ================= 动画 SVG 卡（```svg-xxx 代码块）=================
// 规则沿用 wechat-svg-cards：只用 SMIL、无 id/class/渐变/emoji、标题胶囊 t=0 可见、循环播放
const SW = 750, SD = 10.0, S_OUT = 9.1 // 宽度、一轮时长、开始淡出的时刻
const SFONT = "'PingFang SC','Helvetica Neue','Microsoft YaHei',sans-serif"
// round(min(max(t / D, 0), 1), 4)：超出范围时 Python 返回的是整数 0 / 1，打印不带 .0
const clampKey = x => (x < 0 ? '0' : x > 1 ? '1' : floatStr(round(x, 4)))
const sk = t => clampKey(t / SD)
const sR = v => rstrip(rstrip(fixed(v, 1), '0'), '.')
const scw = (c, size) => (c.codePointAt(0) > 255 ? I(size) : F(size * 0.56))
const stwT = (s, size) => sum(chars(s).map(c => scw(c, size)))
const stw = (s, size) => stwT(s, size).v
const SD_STR = floatStr(SD)

function swrap(s, size, maxw) {
  const lines = []
  let cur = '', w = 0
  for (const c of chars(s)) {
    const cw = scw(c, size).v
    if (w + cw > maxw && cur) {
      lines.push(cur); cur = ''; w = 0
      if (c === ' ') continue
    }
    cur += c; w += cw
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

function sA(attr, vals, ts, spline = null, typ = null) {
  const kt = ts.map(sk).join(';'), vs = vals.map(String).join(';')
  let ex = ''
  if (spline) ex = ` calcMode="spline" keySplines="${Array(ts.length - 1).fill(spline).join(';')}"`
  const tag = typ ? `animateTransform attributeName="transform" type="${typ}"` : `animate attributeName="${attr}"`
  return `<${tag} values="${vs}" keyTimes="${kt}"${ex} dur="${SD_STR}s" repeatCount="indefinite"/>`
}

const sIn = (t, d = 0.35) => sA('opacity', [0, 0, 1, 1, 0, 0], [0, t, t + d, S_OUT, S_OUT + 0.4, SD])

function sFade(inner, t, dx = 0, dy = 14) {
  const mv = dx || dy ? sA(null, [`${dx} ${dy}`, `${dx} ${dy}`, '0 0', '0 0'], [0, t, t + 0.45, SD], '0.23 1 0.32 1', 'translate') : ''
  return `<g opacity="0">${sIn(t)}<g>${mv}${inner}</g></g>`
}

const sGrow = (attr, a, b, t, d = 0.4) => sA(attr, [a, a, b, b], [0, t, t + d, SD], '0.42 0 0.58 1')

const sText = (x, y, s, size = 22, fill = '#333333', w = 400, anchor = 'start') =>
  `<text x="${sR(x)}" y="${sR(y)}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`

function sCheck(cx, cy, t, col, r = 16) {
  const L = round(r * 2.1)
  return `<g opacity="0">${sIn(t, 0.1)}<circle cx="${sR(cx)}" cy="${sR(cy)}" r="${r}" fill="#FFFFFF" stroke="${col}" stroke-width="2.5"/>`
    + `<path d="M${sR(cx - r * 0.45)} ${sR(cy)}l${sR(r * 0.32)} ${sR(r * 0.32)}l${sR(r * 0.6)} ${sR(-r * 0.62)}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" `
    + `stroke-dasharray="${L}" stroke-dashoffset="${L}">${sGrow('stroke-dashoffset', L, 0, t + 0.05, 0.35)}</path></g>`
}

/** 卡片外框 + 标题（t=0 就可见）。外框跟着风格变，里面的内容各风格通用 */
function sFrame(title, body, H, T) {
  const st = get(T, 'st', 'std'), M = T.main, capW = stw(title, 24) + 48, W = SW
  let Hh = H, bg
  if (st === 'mag') {
    bg = `<rect x="1" y="1" width="${SW - 2}" height="${sR(H - 2)}" rx="4" fill="#FFFFFF" stroke="${T.line}" stroke-width="1.5"/>`
      + sText(40, 64, title, 26, INK, 800) + `<rect x="40" y="80" width="44" height="3" fill="${M}"/>`
  } else if (st === 'min') {
    bg = `<rect x="1" y="1" width="${SW - 2}" height="${sR(H - 2)}" fill="#FFFFFF" stroke="${INK}" stroke-width="2"/>`
      + `<rect x="1" y="1" width="${SW - 2}" height="88" fill="${INK}"/>` + sText(40, 56, title, 25, '#FFFFFF', 800)
  } else if (st === 'geek') {
    bg = `<rect x="1" y="1" width="${SW - 2}" height="${sR(H - 2)}" rx="10" fill="${T.soft}" stroke="${T.line}" stroke-width="1.5" stroke-dasharray="7 6"/>`
      + `<rect x="36" y="30" width="${sR(capW + 26)}" height="48" rx="8" fill="#0B0B0C"/>`
      + `<text x="52" y="62" font-size="22" font-weight="700" fill="${T.line}" font-family="Menlo,Consolas,monospace">&gt;</text>`
      + sText(36 + 26 + capW / 2, 62, title, 24, '#FFFFFF', 800, 'middle')
  } else if (st === 'bold') {
    bg = `<rect x="0" y="0" width="${SW}" height="${sR(H)}" rx="28" fill="${T.tint}"/>`
      + `<rect x="36" y="28" width="${sR(capW)}" height="52" rx="26" fill="${M}"/>` + sText(36 + capW / 2, 63, title, 25, '#FFFFFF', 800, 'middle')
  } else if (st === 'neo') { // 质感：白卡 + 细线 + 叠三层淡色当柔和阴影（公众号不支持滤镜）
    Hh = H + 18
    bg = [0, 1, 2].map(k => `<rect x="${8 - k * 2}" y="${10 + k * 3}" width="${SW - 16 + k * 4}" height="${sR(H - 6)}" rx="26" fill="#0F172A" opacity="0.028"/>`).join('')
      + `<rect x="6" y="1" width="${SW - 12}" height="${sR(H)}" rx="24" fill="#FFFFFF" stroke="${T.tint}" stroke-width="1.5"/>`
      + `<rect x="40" y="38" width="5" height="34" rx="2.5" fill="${M}"/>` + sText(58, 65, title, 27, INK, 800)
  } else if (st === 'dark') {
    bg = `<rect x="0" y="0" width="${SW}" height="${sR(H)}" rx="24" fill="#151A21" stroke="#2A313C" stroke-width="2"/>`
      + `<rect x="40" y="38" width="5" height="34" rx="2.5" fill="${T.line}"/>` + sText(58, 65, title, 27, '#FFFFFF', 800)
  } else {
    bg = `<rect x="0" y="0" width="${SW}" height="${sR(H)}" rx="24" fill="${T.soft}"/>`
      + `<rect x="36" y="30" width="${sR(capW)}" height="48" rx="24" fill="${M}"/>` + sText(36 + capW / 2, 62, title, 24, '#FFFFFF', 800, 'middle')
  }
  return `<section style="margin:28px 0;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${sR(Hh)}" width="100%" `
    + `style="display:block;max-width:100%;height:auto;margin:0 auto;font-family:${SFONT}">` + bg + body + '</svg></section>'
}

function sFooter(quote, y, t, T) {
  if (!quote) return ['', y]
  const w = Math.min(stw(quote, 24), 640), x0 = (SW - w) / 2
  return [sFade(sText(SW / 2, y + 30, quote, 24, INK, 800, 'middle'), t, 0, 10)
    + `<g opacity="0">${sIn(t + 0.3, 0.05)}<line x1="${sR(x0)}" y1="${sR(y + 44)}" x2="${sR(x0)}" y2="${sR(y + 44)}" stroke="${T.main}" stroke-width="5" stroke-linecap="round">${sGrow('x2', sR(x0), sR(x0 + w), t + 0.3, 0.5)}</line></g>`, y + 80]
}

function sSplit(lines) {
  const rows = []
  let quote = ''
  for (const l of lines) {
    const s = strip(l)
    if (!s) continue
    if (s.startsWith('>')) { quote = strip(s.slice(1)); continue }
    if (re(String.raw`^\|?\s*:?-{2,}`).match(s) && chars(s).every(c => '|-: '.includes(c))) continue
    const cells = strip(s, '|').split('|').map(c => strip(c))
    const hl = cells.some(c => c.includes('★'))
    rows.push([cells.map(c => strip(c.split('★').join(''))), hl])
  }
  return [rows, quote]
}

const range = n => Array.from({ length: Math.max(0, n) }, (_, i) => i)

function svgTable(title, lines, T) {
  const [rows, quote] = sSplit(lines)
  const head = ix(ix(rows, 0), 0), body = rows.slice(1)
  const n = head.length, X0 = 40, WID = SW - 80
  const need = range(n).map(c => {
    const m = max([stwT(head[c], 20), ...body.map(r => stwT(c < r[0].length ? r[0][c] : '', 22))], x => x.v)
    return { v: m.v + 32, f: m.f }
  })
  const tot = sum(need).v
  let cw = need.map(w => { const x = WID * w.v / tot; return x > 100 ? F(x) : I(100) })
  const s_ = sum(cw).v
  cw = cw.map(c => c.v * WID / s_)
  const xs = range(n).map(i => X0 + sum(cw.slice(0, i).map(F)).v)
  const o = [`<rect x="${X0}" y="104" width="${WID}" height="50" rx="12" fill="${T.tint}"/>`]
  o.push(...range(n).map(c => sText(xs[c] + 18, 136, head[c], 20, T.main, 800)))
  let y = 166, t = 0.5
  for (const [cells, hl] of body) {
    const wl = range(n).map(c => swrap(c < cells.length ? cells[c] : '', 22, cw[c] - 30))
    const h = max(wl.map(w => w.length)) * 32 + 30
    let inner = `<rect x="${X0}" y="${sR(y)}" width="${WID}" height="${sR(h)}" rx="12" fill="#FFFFFF" stroke="${hl ? T.main : T.tint}" stroke-width="${hl ? '2.5' : '1.5'}"/>`
      + (hl ? `<rect x="${X0}" y="${sR(y)}" width="6" height="${sR(h)}" rx="3" fill="${T.main}"/>` : '')
    for (const c of range(n)) {
      wl[c].forEach((ln, j) => {
        inner += sText(xs[c] + 18, y + 36 + j * 32, ln, 22, hl && c === 0 ? T.main : c === 0 ? INK : BODY, c === 0 ? 700 : 400)
      })
    }
    o.push(sFade(inner, t, -24, 0)); y += h + 10; t += 0.35
  }
  if (body.some(([, hl]) => hl)) {
    o.push(`<g opacity="0">${sIn(t + 0.1, 0.1)}` + sText(SW - 52, 136, '★ 重点', 18, T.main, 800, 'end') + '</g>')
  }
  const [f, y2] = sFooter(quote, y + 6, t + 0.4, T); o.push(f)
  return sFrame(title, o.join(''), y2 + 24, T)
}

function svgBars(title, lines, T) {
  const [rows, quote] = sSplit(lines)
  const vals = rows.map(r => float(re(String.raw`[^\d.]`).sub('', ix(r[0], 1)) || '0'))
  const vmax = max(vals) || 1
  let hls = rows.map(([, hl]) => hl)
  if (!hls.some(Boolean)) hls = vals.map(v => v === vmax)
  const lw = Math.min(220, max(rows.map(r => stw(r[0][0], 24))) + 24), bx = 40 + lw, bwmax = SW - 40 - bx - 110
  const o = []
  let y = 116, t = 0.5
  rows.forEach(([cells], i) => {
    const v = vals[i]
    const col = hls[i] ? T.main : T.line, w = Math.max(8, bwmax * v / vmax), cy = y + 22
    const txt = cells.length > 2 && cells[2] ? cells[2] : cells[1]
    o.push(sFade(sText(40, cy + 9, cells[0], 24, INK, hls[i] ? 700 : 500), t, -16, 0))
    o.push(`<g opacity="0">${sIn(t, 0.1)}<rect x="${sR(bx)}" y="${sR(cy - 16)}" width="${sR(bwmax)}" height="32" rx="16" fill="#FFFFFF"/>`
      + `<rect x="${sR(bx)}" y="${sR(cy - 16)}" width="0" height="32" rx="16" fill="${col}">${sGrow('width', 0, sR(w), t + 0.1, 0.6)}</rect></g>`)
    o.push(`<g opacity="0">${sIn(t + 0.6, 0.2)}` + sText(bx + w + 14, cy + 9, txt, 24, hls[i] ? T.main : GRAY, 800) + '</g>')
    y += 64; t += 0.45
  })
  const [f, y2] = sFooter(quote, y + 4, t + 0.4, T); o.push(f)
  return sFrame(title, o.join(''), y2 + 24, T)
}

function svgSteps(title, lines, T) {
  const [rows, quote] = sSplit(lines)
  const o = [], X0 = 40, WID = SW - 80
  let y = 108, t = 0.5
  rows.forEach(([cells], i) => {
    const tl = swrap(cells[0], 24, WID - 170), sl = cells.length > 1 && cells[1] ? swrap(cells[1], 19, WID - 170) : []
    const h = 36 + tl.length * 32 + sl.length * 28 + (sl.length ? 6 : 0)
    let inner = `<rect x="${X0}" y="${sR(y)}" width="${WID}" height="${sR(h)}" rx="18" fill="#FFFFFF" stroke="${T.tint}" stroke-width="1.5"/>`
      + `<circle cx="${X0 + 46}" cy="${sR(y + h / 2)}" r="24" fill="${T.main}"/>` + sText(X0 + 46, y + h / 2 + 9, String(i + 1), 24, '#FFFFFF', 800, 'middle')
    let ty = y + 18 + 26
    for (const ln of tl) { inner += sText(X0 + 92, ty, ln, 24, INK, 800); ty += 32 }
    ty += 4
    for (const ln of sl) { inner += sText(X0 + 92, ty, ln, 19, GRAY); ty += 28 }
    o.push(sFade(inner, t, -28, 0)); o.push(sCheck(X0 + WID - 44, y + h / 2, t + 0.45, T.main))
    y += h + 14; t += 0.6
  })
  const [f, y2] = sFooter(quote, y + 4, t + 0.3, T); o.push(f)
  return sFrame(title, o.join(''), y2 + 24, T)
}

function svgTimeline(title, lines, T) {
  let [rows, quote] = sSplit(lines)
  const n = rows.slice(0, 6).length; rows = rows.slice(0, 6)
  const xa = 90, xb = SW - 90, xs = range(n).map(i => xa + (xb - xa) * i / Math.max(n - 1, 1))
  const span = (xb - xa) / Math.max(n - 1, 1), ly = 196, t0 = 0.5, dur = 0.45 * n
  const o = [`<g opacity="0">${sIn(t0, 0.05)}<line x1="${xa}" y1="${ly}" x2="${xa}" y2="${ly}" stroke="${T.line}" stroke-width="4" stroke-linecap="round">${sGrow('x2', xa, xb, t0, dur)}</line></g>`]
  let maxl = 1
  rows.forEach(([cells, hl], i) => {
    const ti = t0 + dur * (xs[i] - xa) / Math.max(xb - xa, 1)
    const tl = swrap(cells.length > 1 ? cells[1] : '', 19, Math.min(span - 14, 220)); maxl = Math.max(maxl, tl.length)
    const inner = sText(xs[i], ly - 30, cells[0], 22, T.main, 800, 'middle')
      + `<circle cx="${sR(xs[i])}" cy="${ly}" r="${hl ? 12 : 10}" fill="${T.main}" stroke="#FFFFFF" stroke-width="4"/>`
      + tl.map((ln, j) => sText(xs[i], ly + 46 + j * 28, ln, 19, hl ? INK : BODY, hl ? 700 : 400, 'middle')).join('')
    o.push(sFade(inner, ti, 0, 12))
  })
  const y = ly + 46 + maxl * 28
  const [f, y2] = sFooter(quote, y, t0 + dur + 0.4, T); o.push(f)
  return sFrame(title, o.join(''), y2 + 24, T)
}

function svgBreakdown(title, lines, T) {
  const [rows, quote] = sSplit(lines)
  const lw = max(rows.map(r => stw(r[0][0], 20))) + 30, tx = 40 + lw + 18, tmax = SW - 40 - tx
  const o = []
  let y = 112, t = 0.5
  for (const [cells, hl] of rows) {
    const tl = swrap(cells.length > 1 ? cells[1] : '', 22, tmax), h = tl.length * 36
    o.push(sFade(`<rect x="40" y="${sR(y - 2)}" width="${sR(lw)}" height="36" rx="18" fill="${hl ? T.main : T.tint}"/>`
      + sText(40 + lw / 2, y + 23, cells[0], 20, hl ? '#FFFFFF' : T.main, 800, 'middle'), t, 0, 0))
    tl.forEach((ln, j) => {
      const ly = y + j * 36, w = stw(ln, 22) + 12, ts = t + 0.35 + j * 0.25
      o.push(`<g opacity="0">${sIn(t + 0.15, 0.2)}`
        + `<rect x="${sR(tx - 6)}" y="${sR(ly + 1)}" width="0" height="32" rx="6" fill="${hl ? T.main : T.tint}">${sGrow('width', 0, sR(w), ts, 0.35)}</rect>`
        + `<text x="${sR(tx)}" y="${sR(ly + 25)}" font-size="22" font-weight="${hl ? 700 : 400}" fill="#9CA3AF">${sA('fill', ['#9CA3AF', '#9CA3AF', hl ? '#FFFFFF' : INK, hl ? '#FFFFFF' : INK], [0, ts + 0.2, ts + 0.35, SD])}${esc(ln)}</text></g>`)
    })
    y += Math.max(h, 36) + 20; t += 0.35 + tl.length * 0.25 + 0.15
  }
  const [f, y2] = sFooter(quote, y, t + 0.2, T); o.push(f)
  return sFrame(title, o.join(''), y2 + 24, T)
}

function svgCompare(title, lines, T) {
  const [rows, quote] = sSplit(lines)
  const headCells = ix(ix(rows, 0), 0).slice(0, 2)
  if (headCells.length !== 2) throw new PyError('ValueError', 'not enough values to unpack (expected 2)')
  const [lt, rt] = headCells, items = rows.slice(1)
  const cw = 300, lx = 40, rx = SW - 40 - cw, tw_ = cw - 74
  const wl = items.map(([c]) => [swrap(c[0], 21, tw_), swrap(c.length > 1 ? c[1] : '', 21, tw_)])
  const hs = wl.map(([a, b]) => Math.max(a.length, b.length) * 30 + 26)
  const top = 112, H_ = 64 + hs.reduce((a, b) => a + b, 0) + 10 * (hs.length - 1) + 20
  const o = [sFade(`<rect x="${lx}" y="${top}" width="${cw}" height="${H_}" rx="18" fill="#FFFFFF" stroke="${BORDER}" stroke-width="1.5"/>` + sText(lx + cw / 2, top + 42, lt, 22, GRAY, 800, 'middle'), 0.3, 0, 10),
    sFade(`<rect x="${rx}" y="${top}" width="${cw}" height="${H_}" rx="18" fill="#FFFFFF" stroke="${T.main}" stroke-width="2.5"/>`
      + `<rect x="${rx}" y="${top}" width="${cw}" height="60" rx="18" fill="${T.main}"/><rect x="${rx}" y="${top + 40}" width="${cw}" height="20" fill="${T.main}"/>`
      + sText(rx + cw / 2, top + 42, rt, 22, '#FFFFFF', 800, 'middle'), 0.5, 0, 10),
    `<g opacity="0">${sIn(0.7)}<path d="M${floatStr(SW / 2 - 14)} ${floatStr(top + H_ / 2 - 14)}L${floatStr(SW / 2 + 10)} ${floatStr(top + H_ / 2)}L${floatStr(SW / 2 - 14)} ${floatStr(top + H_ / 2 + 14)}" fill="none" stroke="${T.main}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`]
  let y = top + 74, t = 0.9
  wl.forEach(([a, b], i) => {
    const h = hs[i], cy = y + 18
    o.push(sFade(`<circle cx="${lx + 28}" cy="${sR(cy)}" r="11" fill="#E5E7EB"/><path d="M${lx + 24} ${sR(cy - 4)}l8 8M${lx + 32} ${sR(cy - 4)}l-8 8" stroke="#9CA3AF" stroke-width="2.4" stroke-linecap="round"/>`
      + a.map((ln, j) => sText(lx + 50, y + 25 + j * 30, ln, 21, '#9CA3AF')).join(''), t, -14, 0))
    o.push(sFade(`<circle cx="${rx + 28}" cy="${sR(cy)}" r="11" fill="${T.main}"/><path d="M${rx + 23} ${sR(cy)}l4 4l7 -8" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
      + b.map((ln, j) => sText(rx + 50, y + 25 + j * 30, ln, 21, INK, 700)).join(''), t + 0.3, 14, 0))
    y += h + 10; t += 0.6
  })
  const [f, y2] = sFooter(quote, top + H_ + 16, t + 0.2, T); o.push(f)
  return sFrame(title, o.join(''), (quote ? y2 : top + H_) + 24, T)
}

/** 概念对比时间线：灰色虚线是「以前」，主题色实线一段段画出来是「现在」，沿途节点点亮 */
function svgConcept(title, lines, T) {
  const [rows, quote] = sSplit(lines.filter(l => !strip(l).startsWith('!')))
  const notes = lines.filter(l => strip(l).startsWith('!')).map(l => strip(strip(l).slice(1)))
  const lead = rows.filter(r => r[0].length === 1).map(r => r[0][0]), tracks = rows.filter(r => r[0].length > 1).slice(0, 2)
  const [old, nw] = tracks.length === 2 ? [...tracks, null].slice(0, 2) : [null, ix(tracks, 0)]
  const M = T.main, o = []
  let y = 104, t = 0.4
  for (const ld of lead.slice(0, 1)) {
    for (const ln of swrap(ld, 26, SW - 80)) {
      y += 36; o.push(sFade(sText(40, y, ln, 26, INK, 800), t, 0, 10))
    }
    y += 14; t += 0.4
  }
  const lw = Math.min(230, max([old, nw].filter(Boolean).map(tr => stw(tr[0][0], 21))) + 34), xa = 40 + lw + 34, xb = SW - 70
  const track = (tr, y, t, live) => {
    const cells = tr[0], nodes = cells.slice(1, 5), n = nodes.length, col = live ? M : '#B6BCC6'
    const xs = range(n).map(i => xa + (xb - xa) * (i + 0.5) / n), span = (xb - xa) / n, dur = live ? 0.5 * n : 0.3
    const out = [sFade(`<rect x="40" y="${sR(y - 19)}" width="${sR(lw)}" height="38" rx="19" fill="${live ? M : '#E5E7EB'}"/>`
      + sText(40 + lw / 2, y + 7, cells[0], 21, live ? '#FFFFFF' : GRAY, 800, 'middle'), t, -12, 0)]
    const dash = live ? '' : ' stroke-dasharray="3 9"'
    out.push(`<g opacity="0">${sIn(t + 0.15, 0.05)}<line x1="${sR(xa)}" y1="${sR(y)}" x2="${sR(xa)}" y2="${sR(y)}" stroke="${col}" stroke-width="${live ? 5 : 4}" stroke-linecap="round"${dash}>${sGrow('x2', sR(xa), sR(xb), t + 0.15, dur)}</line></g>`)
    let maxl = 1
    nodes.forEach((nd, i) => {
      const ti = t + 0.15 + dur * (xs[i] - xa) / (xb - xa), tl = swrap(nd, 19, span - 12); maxl = Math.max(maxl, tl.length)
      out.push(sFade(`<circle cx="${sR(xs[i])}" cy="${sR(y)}" r="${live ? 11 : 8}" fill="${live ? col : '#FFFFFF'}" stroke="${live ? '#FFFFFF' : col}" stroke-width="${live ? 4 : 3}"/>`
        + tl.map((ln, j) => sText(xs[i], y + 40 + j * 26, ln, 19, live ? INK : '#9CA3AF', live ? 700 : 400, 'middle')).join(''), ti, 0, 8))
    })
    return [out, y + 40 + maxl * 26, t + 0.15 + dur + 0.3]
  }
  if (old) { const [a, y2, t2] = track(old, y + 34, t, false); o.push(...a); y = y2 + 6; t = t2 }
  if (nw === null) throw new PyError('TypeError', "'NoneType' object is not subscriptable")
  const [a, y2, t2] = track(nw, y + 34, t, true); o.push(...a); y = y2 + 4; t = t2
  for (const nt of notes.slice(0, 1)) {
    const tl = swrap(nt, 21, SW - 140), h = tl.length * 32 + 28
    o.push(sFade(`<rect x="40" y="${sR(y)}" width="${SW - 80}" height="${sR(h)}" rx="14" fill="#FFFFFF" stroke="${T.line}" stroke-width="2" stroke-dasharray="8 6"/>`
      + tl.map((ln, j) => sText(SW / 2, y + 38 + j * 32, ln, 21, M, 700, 'middle')).join(''), t, 0, 10))
    y += h + 14; t += 0.5
  }
  const [f, y3] = sFooter(quote, y + 4, t + 0.2, T); o.push(f)
  return sFrame(title, o.join(''), y3 + 24, T)
}

/** 手机演示卡：左边手机里一幕一幕轮播，右边功能列表的高亮跟着走。是示意，不是真实截图 */
function svgPhone(title, lines, T) {
  const [rows] = sSplit(lines)
  const subs = rows.filter(r => r[0].length === 1).map(r => r[0][0]), sc = rows.filter(r => r[0].length > 1).map(r => r[0]).slice(0, 5)
  const sub = subs.length ? subs[0] : '示意演示，非真实截图'
  const M = T.main, n = sc.length, S = 2.8, D_ = n * S
  const kk = t => clampKey(t / D_)
  const A = (attr, vals, ts, disc = false) => `<animate attributeName="${attr}" values="${vals.map(String).join(';')}" keyTimes="${ts.map(kk).join(';')}"`
    + (disc ? ' calcMode="discrete"' : '') + ` dur="${sR(D_)}s" repeatCount="indefinite"/>`
  const win = (i, a = 0.0, f = 0.25) => { // 第 i 幕里，从 a 秒开始显示到这一幕结束
    const t0 = i * S + a, t1 = (i + 1) * S
    if (i === 0 && a === 0) return A('opacity', [1, 1, 0, 0], [0, t1 - 0.25, t1, D_])
    return A('opacity', [0, 0, 1, 1, 0, 0], [0, t0, t0 + f, t1 - 0.25, t1, D_])
  }
  const px = 44, py = 132, pw = 262, ph = 520, sx = px + 12, sy = py + 12, sw_ = pw - 24, sh = ph - 24
  const o = [sText(40, 112, sub, 19, GRAY),
    `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="42" fill="${INK}"/>`,
    `<rect x="${sx}" y="${sy}" width="${sw_}" height="${sh}" rx="31" fill="#F3F4F6"/>`,
    `<rect x="${floatStr(px + pw / 2 - 36)}" y="${sy + 10}" width="72" height="18" rx="9" fill="${INK}"/>`]
  sc.forEach((c, i) => {
    const name = c[0], who = c.length > 2 ? c[1] : '', text = c[c.length - 1]
    const me = ['我', 'me', 'Me', '用户'].includes(who)
    const tl = swrap(text, 19, sw_ - 74), bw = max(tl.map(l => stw(l, 19))) + 30, bh = tl.length * 28 + 22
    const bx = me ? sx + sw_ - 16 - bw : sx + 16, by = sy + 132
    o.push(`<g opacity="${i === 0 ? 1 : 0}">${win(i)}`
      + sText(px + pw / 2, sy + 66, name, 20, INK, 800, 'middle')
      + `<rect x="${sx + 20}" y="${sy + 82}" width="${sw_ - 40}" height="1.5" fill="#E5E7EB"/>`
      + (who && !me ? sText(px + pw / 2, sy + 112, who, 15, '#9CA3AF', 400, 'middle') : '') + '</g>',
    `<g opacity="0">${win(i, 0.5)}<rect x="${sR(bx)}" y="${by}" width="${sR(bw)}" height="${bh}" rx="16" fill="${me ? M : '#FFFFFF'}"/>`
      + tl.map((l, j) => sText(bx + 15, by + 31 + j * 28, l, 19, me ? '#FFFFFF' : INK)).join('') + '</g>',
    `<g opacity="0">${win(i, 1.3)}<circle cx="${floatStr(px + pw / 2)}" cy="${by + bh + 62}" r="24" fill="#FFFFFF" stroke="${M}" stroke-width="3"/>`
      + `<path d="M${floatStr(px + pw / 2 - 11)} ${by + bh + 62}l8 8l14 -15" fill="none" stroke="${M}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>`)
    const dx = px + pw / 2 - (n - 1) * 9 + i * 18 // 分页小圆点
    o.push(`<circle cx="${sR(dx)}" cy="${sy + sh - 22}" r="4" fill="#D1D5DB">` + A('fill', i ? ['#D1D5DB', M, '#D1D5DB'] : [M, '#D1D5DB', '#D1D5DB'], i ? [0, i * S, (i + 1) * S] : [0, S, D_], true) + '</circle>')
  })
  if (n === 0) throw new PyError('ZeroDivisionError', 'division by zero')
  const lx = px + pw + 40, lwid = SW - 40 - lx, rh = Math.min(92, (ph - 12 * (n - 1)) / n), ly = py + (ph - (n * rh + (n - 1) * 12)) / 2
  sc.forEach((c, i) => {
    const yy = ly + i * (rh + 12), on = i ? [0, i * S, (i + 1) * S] : [0, S, D_]
    const hi = (a, b) => A(a[0], i ? [b, a[1], b] : [a[1], b, b], on, true)
    o.push(`<rect x="${lx}" y="${sR(yy)}" width="${lwid}" height="${sR(rh)}" rx="16" fill="#FFFFFF" stroke="${T.tint}" stroke-width="2">` + hi(['fill', M], '#FFFFFF') + '</rect>'
      + `<circle cx="${lx + 40}" cy="${sR(yy + rh / 2)}" r="18" fill="${T.tint}">` + hi(['fill', '#FFFFFF'], T.tint) + '</circle>'
      + `<text x="${lx + 40}" y="${sR(yy + rh / 2 + 7)}" font-size="19" font-weight="800" fill="${M}" text-anchor="middle">${i + 1}</text>`
      + `<text x="${lx + 74}" y="${sR(yy + rh / 2 + 8)}" font-size="23" font-weight="800" fill="${INK}">` + hi(['fill', '#FFFFFF'], INK) + esc(swrap(c[0], 23, lwid - 96)[0]) + '</text>')
  })
  return sFrame(title, o.join(''), py + ph + 30, T)
}

const SVG_KINDS = {
  'svg-table': svgTable, 'svg-bars': svgBars, 'svg-steps': svgSteps, 'svg-timeline': svgTimeline,
  'svg-breakdown': svgBreakdown, 'svg-compare': svgCompare, 'svg-concept': svgConcept, 'svg-phone': svgPhone,
}
const SVG_TITLES = { 'svg-table': '一张表看懂', 'svg-bars': '数据对比', 'svg-steps': '照着做', 'svg-timeline': '时间线', 'svg-breakdown': '拆开看', 'svg-compare': '对比', 'svg-concept': '一张图看懂', 'svg-phone': '演示' }

/** 动画卡写错格式时不让整篇崩掉：退回成普通代码框，并在自查报告里提示 */
function svgCardHtml(lang, title, body, T) {
  title = title || SVG_TITLES[lang]
  try {
    return SVG_KINDS[lang](title, body, T)
  } catch (e) {
    warn(`${lang}「${title}」的内容格式不对（${e?.name ?? 'Exception'}），没画成动画卡，先按普通代码框显示。对照写法表检查每行的 | 分隔`)
    return terminal(body)
  }
}
// ---------------- 飞书导出清理 + 自查 ----------------
const ESC_RE = re(String.raw`\\([\\` + '`' + String.raw`*_{}\[\]()#+\-.!>~=|])`)
const VIDEO_RE = re(String.raw`^\[([^\]]+\.(?:mp4|mov|m4v|webm|avi|gif))\]$`, 'i')
const TEMP_IMG = re(String.raw`authcode|feishu\.cn|larksuite\.com|larkoffice\.com|feishucdn|/space/api/box`, 'i')
const CJK = String.raw`[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]`

/** 去 BOM、统一换行；去掉飞书导出的转义反斜杠（代码块和行内代码里不动） */
function cleanMd(md) {
  md = lstrip(md, '\ufeff').split('\r\n').join('\n').split('\r').join('\n')
  const out = []
  let fence = false
  for (const ln of md.split('\n')) {
    if (strip(ln).startsWith('```')) { fence = !fence; out.push(ln); continue }
    if (fence || (strip(ln).startsWith('<[') && isGalleryOpening(strip(ln)))) { out.push(ln); continue }
    out.push(re('(`[^`]*`)').split(ln).map((seg, k) => (k % 2 ? seg : ESC_RE.sub(m => m[1], seg))).join(''))
  }
  return out.join('\n')
}

/** 段内换行合并：中文之间不加空格，英文之间加空格 */
function joinLines(parts) {
  let s = parts[0]
  for (const p of parts.slice(1)) {
    s += (re(CJK + '$').search(s) || re(CJK).match(p) ? '' : ' ') + p
  }
  return s
}

/** 生成后自动跑的文字自查，代替截图。返回问题列表 */
function check(md, htmlBody, banner, stat) {
  const issues = []
  const imgs = re(String.raw`!\[[^\]]*\]\(<?([^)\s>]+)`).findall(md)
  stat['图片'] = imgs.length
  const temp = imgs.filter(u => TEMP_IMG.search(u))
  const local = imgs.filter(u => !u.startsWith('http') && !temp.includes(u))
  const other = imgs.filter(u => u.startsWith('http') && !u.includes('mmbiz.qpic.cn') && !temp.includes(u))
  if (temp.length) issues.push(`${temp.length} 张图是飞书临时链接，粘进公众号会丢，发布前换成公众号图库地址`)
  if (local.length) issues.push(`${local.length} 张图是本地路径或 base64，粘进公众号会丢：${slice(local[0], 0, 60)}…`)
  if (other.length) issues.push(`${other.length} 张图在外部图床，公众号会尝试转存，失败的要手动重传`)
  if (get(stat, '视频占位')) issues.push(`${stat['视频占位']} 处视频占位，需要在公众号里手动插视频或删掉`)
  const svgs = re(String.raw`<svg[\s\S]*?</svg>`).findall(htmlBody + (banner || ''))
  const bad = svgs.filter(x => re(String.raw`\s(id|class)="`).search(x) || x.includes('<style') || x.includes('<script') || x.includes('Gradient'))
  if (bad.length) issues.push(`${bad.length} 个 SVG 含 id/class/style/script/渐变，公众号会吞掉，需要修`)
  if (get(stat, '动画卡', 0) > 3) issues.push(`动画卡有 ${stat['动画卡']} 张，超过 3 张会显得花，建议删到 3 张以内`)
  return [...issues, ...WARN]
}

// ---------------- parser ----------------
function frontMatter(text) {
  const meta = Object.create(null)
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4)
    if (end > 0) {
      for (const line of splitlines(text.slice(4, end))) {
        if (line.includes(':')) {
          const [k, v] = splitN(line, ':', 1)
          meta[strip(k).toLowerCase()] = strip(strip(strip(v), '"'), "'")
        }
      }
      text = lstrip(text.slice(end + 4), '\n')
    }
  }
  return [meta, text]
}

const LI_RE = re(String.raw`^(\s*)(?:([-*+])|(\d+)[.)、])\s+(.*)$`)
const CAP_END = '。！？!?：:；;，,、…'
const bump = (stat, k) => { stat[k] = get(stat, k, 0) + 1 }

function render(md, T, meta, stat = null) {
  const lines = md.split('\n'), out = [], notes = []
  let i = 0, h2n = 0
  stat = stat ?? {}
  const pill = get(meta, 'h2', 'part') === 'pill' && T.st === 'std'
  const autocap = !['off', 'false', 'no'].includes(get(meta, 'caption', 'auto').toLowerCase())
  const para = [], st8 = { media: false }
  const emit = (h, media = false) => { out.push(h); st8.media = media }
  const flush = () => {
    if (!para.length) return
    const text = joinLines(para), n = para.length
    para.length = 0
    if (text.startsWith('^')) { // 手动图注：^ 开头
      bump(stat, '图注'); emit(caption(inline(strip(text.slice(1)), T, notes), T)); return
    }
    if (autocap && st8.media && n === 1 && len(text) <= 46 && !CAP_END.includes(ix(text, -1))
      && !re(String.raw`\*\*|==|\+\+|^[「“\"]`).search(text)) { // 自动图注：紧跟图片/视频的一行短句，结尾没有标点
      bump(stat, '图注'); emit(caption(inline(text, T, notes), T)); return
    }
    emit(`<p style="${pCss(T)}">${inline(text, T, notes)}</p>`)
  }
  while (i < lines.length) {
    const ln = lines[i], s = strip(ln)
    if (!s) { flush(); i++; continue }
    const m = re(String.raw`^(` + '```' + String.raw`+|~~~+)\s*([\w][\w-]*)?\s*(.*)$`).match(s)
    if (m) {
      flush()
      const fence = slice(m[1], 0, 3), lang = (g(m, 2) || '').toLowerCase(), arg = strip(m[3]), body = []
      i++
      while (i < lines.length && !strip(lines[i]).startsWith(fence)) { body.push(lines[i]); i++ }
      if (i >= lines.length) warn(`有一个代码块没有结束的 \`\`\`（开头是「${slice(body.length ? body[0] : '', 0, 20)}」），后面的内容全被当成了代码`)
      i++
      while (body.length && !strip(body[body.length - 1])) body.pop()
      while (body.length && !strip(body[0])) body.shift()
      if (Object.hasOwn(SVG_KINDS, lang)) { bump(stat, '动画卡'); emit(svgCardHtml(lang, arg, body, T)) }
      else if (lang === 'video') { bump(stat, '视频占位'); emit(renderVideoCardHtml(parseVideoCardLines(body, arg), T), true) }
      else if (lang === 'prompt') { bump(stat, '滑动卡'); emit(promptBox(body, arg, T)) }
      else if (lang === 'promptbox') {
        const inner = body.map(b => `<p style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:1.85;color:${PROMPT_INK};font-family:${MONO};">${esc(b) || ' '}</p>`).join('')
        bump(stat, '滑动卡'); emit(dashedBox(arg || '滑动查看完整提示词', 'list', inner, T))
      } else if (lang === 'longimage') {
        const first = body.find(b => strip(b))
        const src = first === undefined ? '' : strip(first)
        bump(stat, '滑动卡'); emit(dashedBox(arg || '滑动查看长图', 'image', `<img src="${src}" style="display:block;width:100%;"/>`, T, 420), true)
      } else emit(terminal(body))
      continue
    }
    const mh = re(String.raw`^(#{1,6})\s+(.+?)\s*#*$`).match(s)
    if (mh) {
      flush()
      const lv = mh[1].length
      let t = strip(mh[2])
      if (lv === 1) { if (!Object.hasOwn(meta, 'title')) meta.title = t }
      else if (lv === 2) {
        h2n++
        let sub = ''
        if (t.includes('|')) [t, sub] = splitN(t, '|', 1).map(x => strip(x))
        // 原文自带的「一、」去掉，编号由版式加
        t = strip(re(String.raw`^(?:[一二三四五六七八九十]+[、.．]|\d+[、.．]\s*|PART\s*\d+\s*[:：]?\s*)`).sub('', t, 1)) || t
        emit(pill ? h2Pill(h2n, inline(t, T, notes), T) : h2Part(h2n, inline(t, T, notes), sub, T))
      } else if (lv === 3) emit(h3(inline(t, T, notes), T))
      else emit(h4(inline(t, T, notes), T))
      i++; continue
    }
    if (re(String.raw`^(-{3,}|\*{3,}|_{3,})$`).match(s)) { flush(); emit(hr(T)); i++; continue }
    if (s.startsWith('>')) {
      flush()
      const q = []
      while (i < lines.length && strip(lines[i]).startsWith('>')) { q.push(strip(strip(lines[i]).slice(1))); i++ }
      let kind = null
      const mm = q.length ? re(String.raw`^\[!(\w+)\]\s*(.*)$`).match(q[0]) : null
      if (mm) { kind = mm[1].toUpperCase(); q[0] = mm[2] }
      const paras = q.join('\n').split('\n\n').filter(x => strip(x)).map(x => joinLines(x.split('\n')))
      const body = paras.map(x => `<p style="margin:0 0 6px;">${inline(x, T, notes)}</p>`).join('')
      if (kind === 'QUOTE') emit(golden(inline(q.some(Boolean) ? joinLines(q.filter(Boolean)) : '', T, notes), T))
      else if (kind) emit(callout(kind, body, T))
      else emit(quote(body, T))
      continue
    }
    const mv = VIDEO_RE.match(s)
    if (mv) { flush(); bump(stat, '视频占位'); emit(videoSlot(mv[1], T), true); i++; continue }
    if (s.startsWith('<')) {
      let block = parseGalleryBlock(s), nextI = i + 1
      if (!block && isGalleryOpening(s)) {
        const buf = [ln]
        let j = i + 1
        while (j < lines.length && strip(lines[j])) {
          buf.push(lines[j])
          if (strip(lines[j]).endsWith('>')) { j++; break }
          j++
        }
        const parsed = parseGalleryBlock(buf.join('\n'))
        if (parsed) { block = parsed; nextI = j }
      }
      if (block) { flush(); bump(stat, '滑动卡'); emit(gallery(block, T), true); i = nextI; continue }
    }
    const mi = re(String.raw`^!\[${IMAGE_ALT}\]\(<?([^)\s>]+)>?(?:\s+"([^"]*)")?\)$`).match(s)
    if (mi) {
      flush()
      if ((g(mi, 3) || '').toLowerCase() === 'long') {
        bump(stat, '滑动卡')
        emit(dashedBox(mi[1] && mi[1].toLowerCase() !== 'image' ? imageAlt(mi[1]) : '滑动查看长图', 'image', `<img src="${mi[2]}" style="display:block;width:100%;"/>`, T, 420), true)
      } else emit(image(mi[2], imageAlt(mi[1]), T), true)
      i++; continue
    }
    const ml = LI_RE.match(ln)
    if (ml) {
      flush()
      const items = [], base = len(expandtabs(ml[1], 4)), ordered = g(ml, 3) !== null
      while (i < lines.length) {
        const x = LI_RE.match(lines[i])
        if (x) {
          const lv = Math.min(2, Math.max(0, Math.floor((len(expandtabs(x[1], 4)) - base) / 2)))
          if (lv === 0 && (g(x, 3) !== null) !== ordered) break // 换了列表类型，另起一个
          items.push([lv, g(x, 3) !== null ? int(x[3]) : null, x[4]]); i++; continue
        }
        if (strip(lines[i]) && ' \t'.includes(slice(lines[i], 0, 1)) && items.length) { // 缩进的续行并进上一条
          items[items.length - 1][2] = joinLines([items[items.length - 1][2], strip(lines[i])]); i++; continue
        }
        let j = i
        while (j < lines.length && !strip(lines[j])) j++ // 飞书导出的列表每条之间有空行，跳过去接着算同一个列表
        const next = j > i && j < lines.length ? LI_RE.match(lines[j]) : null
        if (next && (len(next[1]) > 0 || (g(next, 3) !== null) === ordered)) { i = j; continue }
        break
      }
      emit(listBlock(items, T, notes)); continue
    }
    if (s.includes('|') && i + 1 < lines.length && re(String.raw`^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$`).match(strip(lines[i + 1])) && lines[i + 1].includes('|')) {
      flush()
      const rows = []
      while (i < lines.length && lines[i].includes('|') && strip(lines[i])) {
        const r = re(String.raw`^\||\|$`).sub('', strip(lines[i])).split('|').map(c => strip(c))
        if (!r.every(c => re(String.raw`^:?-+:?$`).match(c))) rows.push(r)
        i++
      }
      emit(table(rows, T, notes)); continue
    }
    para.push(s); i++
  }
  flush()
  const endMark = normalizeEndMark(get(meta, 'end_mark', 'none'), 'none')
  if (endMark !== 'none') out.push(renderEndMarkHtml(endMark, T))
  if (get(meta, 'outro', 'true').toLowerCase() !== 'false') out.push(authorCard(T, meta))
  out.push(notesBlock(notes, T))
  const wrap = T.st === 'dark' ? 'padding:26px 18px 30px;background:#0F1218;border-radius:18px;' : 'padding:0 4px;'
  return `<section style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif;${wrap}">` + out.join('') + '</section>'
}

// ---------------- page ----------------
const PAGE = String.raw`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>__TITLE__ · 公众号排版</title>
<style>
body{margin:0;background:#EDEDED;font-family:'PingFang SC',sans-serif;color:#222}
.bar{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #e5e5e5;padding:10px 20px;display:flex;gap:8px 10px;flex-wrap:wrap;align-items:center}
.bar b{font-size:15px;width:100%} .bar input[type=text]{width:340px;padding:8px 10px;border:1.5px solid #ccc;border-radius:8px;font-size:13px}
.bar label{font-size:13px;color:#555} .row{width:100%;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}
.sw{border:2px solid transparent;border-radius:20px;padding:4px 12px 4px 8px;font-size:13px;cursor:pointer;background:#f3f3f3;display:inline-flex;align-items:center;gap:6px}.sw i{width:12px;height:12px;border-radius:50%;display:inline-block}
.sw.st{padding:4px 14px}.sw.on{border-color:#222;background:#fff;font-weight:700}
button.go{border:0;background:#C9643E;color:#fff;padding:9px 16px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:700}
button.ghost{border:1.5px solid #C9643E;background:#fff;color:#C9643E;padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer}
#m{font-size:13px;width:100%} #m.ok{color:#1B7A44;font-weight:700} .err{color:#C9643E;font-weight:700}
#toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:9;background:#1B7A44;color:#fff;padding:10px 20px;border-radius:22px;font-size:14px;font-weight:700;box-shadow:0 6px 24px #0003;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap;max-width:min(90vw,640px);overflow:hidden;text-overflow:ellipsis}
#toast.show{opacity:1}
.phone{max-width:640px;margin:24px auto 80px;background:#fff;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,.08);padding:28px 22px}
.phone h1{font-size:22px;line-height:1.4;margin:0 0 18px;color:#111}
#manual{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9}
#manual>div{background:#fff;border-radius:12px;padding:18px;width:min(720px,90vw)} #manual textarea{width:100%;height:220px;font-size:12px;box-sizing:border-box}
body{height:100vh;display:flex;flex-direction:column;background:#eeefec;color:#222}
*{box-sizing:border-box}
.bar{position:relative;top:auto;flex:none;display:flex;justify-content:space-between;gap:8px;padding:10px 16px;background:#fcfcfa}
.bar b{width:auto;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.actions{display:flex;gap:6px;align-items:center}
button.go{background:#252a26;padding:9px 14px}
button.subtle,.actions summary{font:inherit;font-size:13px;padding:8px 10px;border:1px solid #dedfda;border-radius:8px;background:white;cursor:pointer;color:#252a26}
#push-draft.ok{border-color:#2F9E5A;background:#E8F5EE;color:#1B7A44;font-weight:700}
.actions details{position:relative}
.actions .menu{position:absolute;right:0;top:calc(100% + 7px);min-width:150px;padding:5px;background:white;border:1px solid #dedfda;border-radius:9px;box-shadow:0 8px 24px #0002}
.menu button{display:block;width:100%;text-align:left;border:0;background:white;padding:8px;cursor:pointer;white-space:nowrap}
.menu button:hover{background:#f0f2ee}
#m:empty{display:none}
.actions #review-panel{width:min(380px,calc(100vw - 24px));white-space:normal;padding:12px}
#review-panel h3{font-size:13px;margin:8px 0 4px}
#review-panel ul{margin:0;padding-left:20px;font-size:13px;line-height:1.6}
#review-panel button{white-space:normal;overflow-wrap:anywhere}
#review-panel .go{margin-top:10px}
#review-panel button[hidden]{display:none}
#review-stats{font-size:12px;color:#555;margin:8px 0 0}
[data-video-slot]{scroll-margin-block:20px}
[data-video-slot]:focus{outline:2px solid #4a6c54;outline-offset:3px}
.workbench{display:grid;grid-template-columns:minmax(0,1fr) 290px;flex:1;min-height:0;position:relative}
.workbench.settings-closed{grid-template-columns:minmax(0,1fr)}
.canvas{min-width:0;overflow:auto;padding:24px clamp(12px,3vw,44px) 48px;background-image:radial-gradient(#232d2317 1px,transparent 1px);background-size:16px 16px}
.phone{max-width:684px;margin:0 auto;padding:28px clamp(14px,3vw,26px);box-shadow:0 2px 3px #0001,0 12px 38px #0001;border:1px solid #e4e5df}
.settings{overflow:auto;background:#fcfcfa;border-left:1px solid #dedfda;padding:16px;min-width:0}
.settings h2{font-size:15px;margin:0 0 14px}
.settings section{padding:14px 0;border-top:1px solid #e7e8e3}
.settings h3{margin:0 0 9px;font-size:13px}
.settings .row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
.settings .palette{grid-template-columns:repeat(5,minmax(0,1fr))}
.settings .sw{border:1px solid #e6e7e1;background:white;border-radius:7px;padding:6px 3px;justify-content:center;font-size:12px}
.settings .sw.on{border-color:#4a6c54;background:#edf4ed;color:#24452e}
.settings .palette .sw{flex-direction:column;gap:4px}
.settings .palette i{margin:0}
.settings label{display:block;font-size:12px;margin:8px 0 5px}
.settings input[type=text]{width:100%;padding:7px;border:1px solid #dedfda;border-radius:6px}
.settings input[type=file]{width:100%;font-size:12px}
.settings .follow{display:flex;align-items:center;justify-content:space-between;font-size:13px;margin:0}
.follow input{appearance:none;width:36px;height:21px;border-radius:20px;background:#777880;cursor:pointer;margin:0}
.follow input::before{content:"";display:block;width:17px;height:17px;margin:2px;background:white;border-radius:50%}
.follow input:checked{background:#24863d}
.follow input:checked::before{transform:translateX(15px)}
#banner-actions{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:8px;font-size:12px}
.msg-act{margin-left:6px;padding:2px 9px;border:1px solid currentColor;border-radius:6px;background:#fff;color:inherit;font-size:12px;cursor:pointer;font-weight:600}
.msg-act:hover{background:#f7f3f0}
.avatar-hint{margin:6px 0 0;font-size:12px;line-height:1.5;color:#666}
.avatar-help{margin:6px 0 8px;font-size:12px;color:#555}
.avatar-help summary{cursor:pointer;color:#4a6c54}
.avatar-help ol{margin:6px 0 0;padding-left:18px;line-height:1.6}
.avatar-help code{font-size:11px;background:#f0f1ed;padding:1px 4px;border-radius:4px}
@media(max-width:780px){.workbench{grid-template-columns:minmax(0,1fr)}.settings{position:absolute;inset:0 0 0 auto;width:min(290px,100%);z-index:2;box-shadow:-6px 0 20px #0002}.bar{padding-inline:10px}.actions{margin-left:auto}}
</style></head><body>
<header class="bar"><b>__TITLE__</b>
<div class="actions">
<button class="subtle" id="settings-toggle" type="button" aria-controls="layout-settings" aria-expanded="true">排版设置</button>
<details id="review"><summary>自查报告</summary><div id="review-panel" class="menu">
<div id="review-items"></div><p id="review-stats"></p>
<button type="button" class="go" id="review-copy" hidden>确认并复制全文</button>
</div></details>
<button class="go" id="copy-all" onclick="copyAll(this)">复制全文到公众号</button>
<button class="subtle" id="push-draft" type="button" hidden>推送草稿箱</button>
<details id="copy-menu"><summary aria-label="其他复制方式">更多</summary><div class="menu">
<button onclick="copyPart(this,'banner')">只复制横幅</button>
<button onclick="copyPart(this,'body')">只复制正文</button>
<button onclick="copyMd(this)">复制 Markdown</button>
</div></details></div>
<div id="m" role="status"></div></header>
<div class="workbench">
<main class="canvas"><article class="phone"><h1>__TITLE__</h1><div id="pv"></div></article></main>
<aside class="settings" id="layout-settings" aria-label="排版设置">
<h2>排版设置</h2>
<section><h3>正文风格</h3><div id="sts" class="row"></div></section>
<section><h3>配色</h3><div id="sws" class="row palette"></div></section>
<section id="studio-options" hidden>
<h3>开头横幅</h3><div id="banner-choices" class="row"></div><div id="banner-actions"><span id="banner-status" role="status"></span><button type="button" class="subtle" id="banner-generate">重新生成</button></div>
</section>
<section id="follow-options" hidden><label class="follow">文末关注卡 <input id="follow-card" type="checkbox" role="switch"></label></section>
<section><h3>头像</h3>
<label for="gif">公众号图片地址</label><input type="text" id="gif" placeholder="留空自动使用首字徽章，或填 https://mmbiz.qpic.cn/…">
<p class="avatar-hint">不填也能直接复制，自动用作者首字徽章兜底。</p>
<details class="avatar-help"><summary>如何获取公众号图片地址？</summary><ol><li>登录公众号后台，在「内容管理 → 素材库」上传头像图片</li><li>点开图片后右键选择「复制图片地址」</li><li>粘贴到上方输入框（以 <code>https://mmbiz.qpic.cn/</code> 开头）</li></ol></details></section>
</aside></div>
<div id="manual"><div><b>浏览器没让我写剪贴板，请手动复制</b><p style="font-size:13px;color:#666">已全选，按 ⌘C / Ctrl+C。</p><textarea readonly></textarea><p style="text-align:right"><button class="ghost" onclick="document.getElementById('manual').style.display='none'">关闭</button></p></div></div>
<div id="toast" role="status"></div>
<script>
const D=__DATA__;
const G=document.getElementById('gif');
const settings=document.getElementById('layout-settings'), settingsToggle=document.getElementById('settings-toggle');
function toggleSettings(open){settings.hidden=!open;settings.parentElement.classList.toggle('settings-closed',!open);
  settingsToggle.setAttribute('aria-expanded',String(open));}
toggleSettings(ls('lq_layout_panel')===null?!matchMedia('(max-width:780px)').matches:ls('lq_layout_panel')==='open');
settingsToggle.onclick=()=>{toggleSettings(settings.hidden);ls('lq_layout_panel',settings.hidden?'closed':'open')};
document.getElementById('copy-menu').addEventListener('click',event=>{if(event.target.closest('button'))event.currentTarget.open=false});
let saveLayoutPreferences;
window.setStudioOptions=(state, action)=>{
  saveLayoutPreferences=state.layoutPreferences===undefined?undefined:action;
  const saved=state.layoutPreferences;
  if(saved&&D.styles[saved.style]&&D.palette[saved.theme]&&(style!==saved.style||theme!==saved.theme)){
    style=saved.style;theme=saved.theme;render();
  }
  const options=document.getElementById('studio-options'), choices=document.getElementById('banner-choices');
  options.hidden=false;
  choices.replaceChildren(...state.banner.choices.map(choice=>{
    const b=document.createElement('button');b.type='button';b.className='sw'+(choice.id===state.banner.style?' on':'');
    b.textContent=choice.name;b.disabled=state.busy;b.setAttribute('aria-pressed',String(choice.id===state.banner.style));
    b.onclick=()=>{if(choice.id!==state.banner.style)action('banner/style',{style:choice.id})};return b;
  }));
  document.getElementById('banner-status').textContent=state.status;
  const generate=document.getElementById('banner-generate');
  generate.hidden=state.banner.style==='none';generate.disabled=state.busy;
  generate.textContent=state.banner.ready?'重新生成':'生成';generate.onclick=()=>action('banner/generate',{});
  const follow=document.getElementById('follow-card');
  document.getElementById('follow-options').hidden=typeof state.followCard!=='boolean';
  follow.checked=state.followCard===true;follow.disabled=state.followPending;
  follow.onchange=()=>{const enabled=follow.checked;follow.checked=state.followCard;action('layout/follow-card',{enabled})};
};
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
G.value=ls('lq_banner_gif')||'';
let theme=D.fixed_theme?D.default_theme:(ls('lq_layout_theme')||D.default_theme); if(!D.palette[theme])theme=D.default_theme;
let style=D.fixed_style?D.default_style:(ls('lq_layout_style')||D.default_style); if(!D.styles[style])style=D.default_style;
function esc(u){return u.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function avatarBadgeHtml(){const m=D.palette[theme].main,ch=escHtml(D.avatar_initial||'文');return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72" style="display:block;width:72px;height:72px;"><rect width="72" height="72" rx="36" fill="'+m+'"/><text x="36" y="47" font-size="30" font-weight="800" fill="#FFFFFF" text-anchor="middle" font-family="\'PingFang SC\',\'Helvetica Neue\',sans-serif">'+ch+'</text></svg>'}
function avatarBadgeSvg(x,y,w,h){const m=D.palette[theme].main,ch=escHtml(D.avatar_initial||'文'),nw=+w,nh=+h,cx=Math.round((+x)+nw/2),aligned=nw===84&&nh===80,cy=aligned?Math.round((+y)+44):Math.round((+y)+nh/2),r=aligned?34:Math.round(Math.min(nw,nh)*0.38),fs=Math.round(r*0.92);return '<g><circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+m+'"/><text x="'+cx+'" y="'+Math.round(cy+fs*0.35)+'" font-size="'+fs+'" font-weight="800" fill="#FFFFFF" text-anchor="middle" font-family="\'PingFang SC\',\'Helvetica Neue\',sans-serif">'+ch+'</text></g>'}
function fillAvatar(html,u){if(u)return html.split('GIF_URL_HERE').join(u);return html.replace(/<img\s+src="GIF_URL_HERE"[^>]*\/>/g,()=>avatarBadgeHtml()).replace(/<image\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"[^>]*href="GIF_URL_HERE"\s*\/>/g,(_,x,y,w,h)=>avatarBadgeSvg(x,y,w,h))}
function paint(h){for(const k in D.tokens)h=h.split(D.tokens[k]).join(D.palette[theme][k]);return h}
function parts(u){const BN=(style=='neo'&&D.banner_neo)?D.banner_neo:D.banner;const b=BN?(BN[theme]||BN._):'';return {banner:fillAvatar(b,u),body:fillAvatar(paint(D.styles[style]),u)}}
const review=document.getElementById('review'), reviewCopy=document.getElementById('review-copy');
const popovers=[review,document.getElementById('copy-menu')];
window.dismissLayoutPopovers=()=>{for(const panel of popovers)panel.open=false};
document.addEventListener('pointerdown',event=>{
  for(const panel of popovers){if(panel.open&&!panel.contains(event.target))panel.open=false;}
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const opened=popovers.find(panel=>panel.open);
  if(!opened)return;
  window.dismissLayoutPopovers();
  opened.querySelector('summary').focus();
});
function renderReview(){
  const root=document.getElementById('review-items');root.replaceChildren();
  const videos=[...document.querySelectorAll('#pv [data-video-slot]')];
  const groups=[
    ['复制前确认',D.review?.before||[]],
    ['到公众号编辑器处理',videos],
    ['排版提示',D.review?.notes||[]],
  ];
  for(const [title,items] of groups){
    if(!items.length)continue;
    const heading=document.createElement('h3');heading.textContent=title;root.append(heading);
    const list=document.createElement('ul');root.append(list);
    for(const item of items){
      const li=document.createElement('li');list.append(li);
      if(typeof item==='string'){li.textContent=item;continue;}
      const button=document.createElement('button');button.type='button';
      button.textContent='插入视频：'+item.dataset.videoSlot;
      button.onclick=()=>{review.open=false;item.tabIndex=-1;item.focus({preventScroll:true});item.scrollIntoView({block:'center'});};
      li.append(button);
    }
  }
  if(!root.childNodes.length)root.textContent='没有待处理项。';
  review.querySelector('summary').textContent='自查报告'+(groups[0][1].length||videos.length?'（'+(groups[0][1].length+videos.length)+'）':'');
  document.getElementById('review-stats').textContent=D.review?.stats||'';
}
let copyFallback=false;
function setReviewCopyAction(action){reviewAction=action;reviewCopy.textContent=action=='draft'?'确认并推送草稿箱':'确认并复制全文'}
reviewCopy.onclick=()=>{
  if(reviewAction=='draft'){setReviewCopyAction(null);pushDraft(document.getElementById('push-draft'),true);return;}
  setReviewCopyAction(null);copyAll(document.getElementById('copy-all'),true,copyFallback);
};
for(const panel of popovers)panel.addEventListener('toggle',()=>{
  if(panel.open)for(const other of popovers){if(other!==panel)other.open=false;}
});
review.addEventListener('toggle',()=>{if(!review.open){reviewCopy.hidden=true;setReviewCopyAction(null)}});
function render(){const p=parts(esc(G.value.trim()||''));document.getElementById('pv').innerHTML=(p.banner?'<section style="margin:0 0 24px">'+p.banner+'</section>':'')+p.body;
  document.getElementById('sts').innerHTML=Object.keys(D.styles).map(k=>'<button type="button" class="sw st'+(k==style?' on':'')+'" title="'+D.style_desc[k]+'" onclick="pickS(\''+k+'\')">'+D.style_names[k]+'</button>').join('');
  document.getElementById('sws').innerHTML=Object.keys(D.palette).map(k=>'<button type="button" class="sw'+(k==theme?' on':'')+'" onclick="pick(\''+k+'\')"><i style="background:'+D.palette[k].main+'"></i>'+D.names[k]+'</button>').join('');renderReview()}
let savingLayout=false;
async function selectLayout(nextStyle,nextTheme){
  if(savingLayout)return;
  const previous={style,theme};
  if(saveLayoutPreferences){
    savingLayout=true;
    style=nextStyle;theme=nextTheme;render();
    try {
      if(!await saveLayoutPreferences('layout/preferences',{style,theme})){
        style=previous.style;theme=previous.theme;render();
      }
    } finally {savingLayout=false}
  } else {
    style=nextStyle;theme=nextTheme;ls('lq_layout_style',style);ls('lq_layout_theme',theme);render();
  }
}
function pick(k){selectLayout(style,k)}
function pickS(k){selectLayout(k,theme)}
G.addEventListener('input',()=>{ls('lq_banner_gif',G.value.trim());render()});
render();
if(D.studio_options){
  const options=D.studio_options;
  window.setStudioOptions({...options,busy:true,followPending:true,
    status:options.banner.style==='none'?'':options.banner.ready?'已生成':'待生成'});
  window.frameElement?.dispatchEvent(new Event('studio-options-ready'));
  document.getElementById('push-draft').hidden=false;
}
function msg(t,ok,act){const m=document.getElementById('m');m.textContent=t;m.className=ok?'ok':'err';if(act){const btn=document.createElement('button');btn.type='button';btn.className='msg-act';btn.textContent=act.label;btn.onclick=act.onClick;m.append(' ',btn)}}
let toastTimer=0;
function showToast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4000)}
function flash(b,t){const o=b.dataset.l||b.textContent;b.dataset.l=o;b.textContent=t;setTimeout(()=>b.textContent=o,1800)}
function need(part,fallback,retry){const u=G.value.trim();const raw=parts('GIF_URL_HERE');if((part?raw[part]:raw.banner+raw.body).indexOf('GIF_URL_HERE')<0)return parts('');
  if(fallback||!u)return parts('');
  if(!/^https:\/\/mmbiz\.qpic\.cn\//.test(u)){msg('头像地址要以 https://mmbiz.qpic.cn/ 开头（公众号图库里的图）',false,{label:'改用默认徽章直接复制',onClick:retry});toggleSettings(true);G.focus();return null}
  return parts(esc(u))}
function legacy(h,p){let d=false;const f=e=>{e.clipboardData.setData('text/html',h);e.clipboardData.setData('text/plain',p);e.preventDefault();d=true};
  document.addEventListener('copy',f);let ok=false;try{ok=document.execCommand('copy')}catch(e){}document.removeEventListener('copy',f);return ok&&d}
async function put(h){const t=h.replace(/<[^>]+>/g,'');if(legacy(h,t))return true;
  try{if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([h],{type:'text/html'}),'text/plain':new Blob([t],{type:'text/plain'})})]);return true}}catch(e){}return false}
function manual(p){const d=document.getElementById('manual');const t=d.querySelector('textarea');t.value=p;d.style.display='flex';t.focus();t.select()}
async function send(b,h,what){if(await put(h)){flash(b,'已复制 ✓');msg('已复制'+what+'（'+D.style_names[style]+' · '+D.names[theme]+'），去公众号编辑器正文里粘贴',true)}else{msg('这个窗口不允许写剪贴板：请用 Chrome 直接打开本文件',false);manual(h)}}
async function copyAll(b,confirmed=false,fallback=false){const p=need(null,fallback,()=>copyAll(b,confirmed,true));if(!p)return;
  if(!confirmed&&D.review?.before.length){copyFallback=fallback;setReviewCopyAction('copy');reviewCopy.hidden=false;review.open=true;return;}
  copyFallback=false;review.open=false;send(b,(p.banner?'<section style="margin:0 0 24px">'+p.banner+'</section>':'')+p.body,'全文')}
async function copyMd(b){const t=D.md||'';let ok=false;
  try{await navigator.clipboard.writeText(t);ok=true}catch(e){}
  if(!ok){const f=e=>{e.clipboardData.setData('text/plain',t);e.preventDefault();ok=true};document.addEventListener('copy',f);try{document.execCommand('copy')}catch(e){}document.removeEventListener('copy',f)}
  if(ok){flash(b,'已复制 ✓');msg('已复制 Markdown（'+t.length+' 字），可以贴到朱雀做检测',true)}else{msg('浏览器没让写剪贴板，请手动复制',false);manual(t)}}
async function copyPart(b,k,fallback=false){const p=need(k,fallback,()=>copyPart(b,k,true));if(!p)return;if(!p[k]){msg('这篇没有横幅',false);return}send(b,p[k],k=='banner'?'横幅':'正文')}
let reviewAction=null;
async function pushDraft(b,confirmed=false,fallback=false){const p=need(null,fallback,()=>pushDraft(b,confirmed,true));if(!p)return;
  if(!confirmed&&D.review?.before.length){setReviewCopyAction('draft');reviewCopy.hidden=false;review.open=true;return;}
  review.open=false;
  if(!saveLayoutPreferences){msg('请从工作台里打开排版预览再推送',false);return;}
  const label=b.textContent;b.disabled=true;b.textContent='推送中…';
  const ok=await saveLayoutPreferences('wechat/draft',{html:(p.banner?'<section style="margin:0 0 24px">'+p.banner+'</section>':'')+p.body});
  b.disabled=false;b.textContent=label;
  if(ok){b.classList.add('ok');flash(b,'已推送 ✓');setTimeout(()=>b.classList.remove('ok'),1800);showToast('✓ 已推送到公众号草稿箱，去后台「草稿箱」查看')}
  else msg('推送没有成功，看页面上的提示',false)}
document.getElementById('push-draft').onclick=()=>pushDraft(document.getElementById('push-draft'));
</script></body></html>`

const ORDER = ['图片', '图注', '视频占位', '动画卡', '滑动卡']
const jsonCopy = v => JSON.parse(JSON.stringify(v))

/**
 * 渲染整篇排版页，对应原 layout.py 的 `layout.py article.md --out out [...]`。
 * @param {string} source - 文章 Markdown。
 * @param {{banner?: object, style?: string, theme?: string, studioOptions?: object, outro?: 'true'|'false', brandAuthor?: string, brandSlogan?: string, name?: string}} [options]
 * @returns {{html: string, report: string, filename: string}} 页面、自查报告（原脚本打印的内容）、原脚本会写出的文件名。
 */
export function renderPage(source, { banner: bannerSpec, style: argStyle, theme: argTheme, studioOptions, outro, endMark, brandAuthor, brandSlogan, name = 'article.md' } = {}) {
  WARN = []
  if (!Object.hasOwn(STYLES, argStyle)) argStyle = undefined
  if (!Object.hasOwn(THEMES, argTheme)) argTheme = undefined
  let [meta, md] = frontMatter(cleanMd(source))
  const brand = {}
  if (brandAuthor) brand.author = brandAuthor
  if (brandSlogan) brand.slogan = brandSlogan
  Object.assign(meta, brand)
  if (outro !== undefined && outro !== null) meta.outro = outro
  if (endMark !== undefined && endMark !== null) meta.end_mark = normalizeEndMark(endMark, 'none')
  const m = re(String.raw`^#\s+(.+)$`, 'm').search(md)
  const base = name.split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  const title = get(meta, 'title') || (m ? strip(m[1]) : dot > 0 ? base.slice(0, dot) : base)
  const slug = get(meta, 'slug') || strip(slice(re(String.raw`[^\w一-鿿-]+`).sub('-', title), 0, 30), '-') || 'article'
  let style = argStyle || get(meta, 'style', 'std'), theme = argTheme || get(meta, 'theme', 'orange')
  if (!Object.hasOwn(STYLES, style)) { warn(`没有「${style}」这个风格，用了标准。可选：${Object.keys(STYLES).join('、')}`); style = 'std' }
  if (!Object.hasOwn(THEMES, theme)) { warn(`没有「${theme}」这个配色，用了品牌橙。可选：${Object.keys(THEMES).join('、')}`); theme = 'orange' }
  const stat = {}, rendered = {}
  for (const k of [style, ...Object.keys(STYLES).filter(x => x !== style)]) { // 默认风格先渲染，统计和提示只记这一遍
    const n = WARN.length
    rendered[k] = fixEmpty(render(md, { ...TOK, st: k, r: STYLES[k].r }, Object.assign(Object.create(null), meta), k === style ? stat : {}))
    if (k === 'dark') rendered[k] = darkFix(rendered[k])
    if (k !== style) WARN.length = n
  }
  const styles = Object.fromEntries(Object.keys(STYLES).map(k => [k, rendered[k]]))
  let banner = null, bannerNeo = null
  if (bannerSpec) {
    const spec = jsonCopy(bannerSpec)
    if (Object.keys(brand).length) spec.brand = brand
    const key = get(spec, 'style') === 'card' ? 'card' : 'poster'
    const body = get(spec, key, {})
    if (['card', 'poster', 'neo'].includes(get(spec, 'style')) && (body === null || typeof body !== 'object' || Array.isArray(body))) {
      throw new PyError('AttributeError', `'${body === null ? 'NoneType' : Array.isArray(body) ? 'list' : typeof body}' object has no attribute 'get'`)
    }
    if (['card', 'poster', 'neo'].includes(get(spec, 'style')) && get(body, 'theme', 'all') === 'all') {
      const themes = { ...B.THEMES } // 标题卡 / 大字海报 / 潮酷横幅跟着配色换色
      for (const [k, T] of Object.entries(THEMES)) themes[k] = { main: T.main, light: T.tint, line: T.line, border: T.tint, bg: T.soft }
      const perTheme = st => Object.fromEntries(Object.keys(THEMES).map(k => {
        const sp = jsonCopy(spec)
        sp.style = st
        if (!Object.hasOwn(sp, key)) throw new PyError('KeyError', `'${key}'`)
        sp[key].theme = k
        return [k, B.build(sp, themes)]
      }))
      banner = perTheme(spec.style)
      if (spec.style === 'poster') bannerNeo = perTheme('neo') // 正文切到质感时，横幅自动换成质感版
    } else {
      banner = { _: B.build(spec) }
    }
    for (const x of B.checkSpec(spec, Object.values(banner))) warn('横幅：' + x)
  }
  const issues = check(md, styles[style], Object.values(banner || {}).join(''), stat)
  const before = issues.filter(issue => issue.includes('飞书临时链接') || issue.includes('本地路径或 base64'))
  const notes = issues.filter(issue => !before.includes(issue) && !re(String.raw`^\d+ 处视频占位`).match(issue))
  const prose = re(String.raw`(?ms)^\s*(` + '```' + String.raw`|~~~).*?^\s*\1[^\n]*`).sub('', md)
  const placeholders = re(String.raw`\[(?:可补|截图)[：:][^\]\n]*\]`).findall(prose)
  if (placeholders.length) before.push(`还有 ${placeholders.length} 处稿件占位：` + placeholders.slice(0, 3).join('、'))
  const stats = ORDER.map(k => `${k} ${get(stat, k, 0)}`).join('，')
  const data = {
    studio_options: studioOptions ?? null, review: { before, notes, stats }, styles,
    style_names: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.name])),
    style_desc: Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, v.desc])),
    palette: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, Object.fromEntries(Object.keys(TOK).map(c => [c, v[c]]))])),
    names: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.name])), tokens: TOK,
    banner, banner_neo: bannerNeo, default_theme: theme, default_style: style,
    avatar_initial: (() => { const ch = Array.from(String(get(meta, 'author', AUTHOR) || AUTHOR).trim())[0] || '文'; return /^[a-z]$/.test(ch) ? ch.toUpperCase() : ch })(),
    fixed_theme: Boolean(argTheme || get(meta, 'theme')), fixed_style: Boolean(argStyle || get(meta, 'style')), md: plainMd(md),
  }
  const html = PAGE.split('__TITLE__').join(esc(title)).split('__DATA__').join(dumps(data).split('</').join('<\\/'))
  const filename = `${slug}-公众号排版.html`
  const kb = Math.floor(Buffer.byteLength(html, 'utf8') / 1024)
  const report = [`ok  out/${filename}  （${kb} KB，默认：${STYLES[style].name} · ${THEMES[theme].name}）`, '统计：' + stats]
  if (issues.length) report.push('发布前要处理：', ...issues.map(x => '  - ' + x))
  else report.push('自查通过：没有发现会在公众号里出问题的地方')
  return { html, report: report.join('\n'), filename }
}

export const SVG_CARD_KINDS = Object.keys(SVG_KINDS)

/**
 * 单独画一张动画卡，用真实配色（不是占位色）。
 * @returns {{html: string, warnings: string[]}} 格式不对时 html 是普通代码框，原因在 warnings 里。
 */
export function renderSvgCard(kind, title, lines, { style = 'std', theme = 'orange' } = {}) {
  WARN = []
  const T = { ...THEMES[theme], st: style, r: STYLES[style].r }
  const html = svgCardHtml(kind, title, lines, T)
  return { html, warnings: [...WARN] }
}

/**
 * 渲染可直接推送到微信公众号草稿箱的 HTML 片段（与预览页「复制全文 / 推送草稿箱」一致）。
 */
export function renderFragment(source, { banner: bannerSpec, style: argStyle, theme: argTheme, outro, endMark, brandAuthor, brandSlogan, avatarUrl = '', name = 'article.md' } = {}) {
  WARN = []
  if (!Object.hasOwn(STYLES, argStyle)) argStyle = undefined
  if (!Object.hasOwn(THEMES, argTheme)) argTheme = undefined
  let [meta, md] = frontMatter(cleanMd(source))
  const brand = {}
  if (brandAuthor) brand.author = brandAuthor
  if (brandSlogan) brand.slogan = brandSlogan
  Object.assign(meta, brand)
  if (outro !== undefined && outro !== null) meta.outro = outro
  if (endMark !== undefined && endMark !== null) meta.end_mark = normalizeEndMark(endMark, 'none')
  const m = re(String.raw`^#\s+(.+)$`, 'm').search(md)
  const base = String(name || '').split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  const nameTitle = dot > 0 ? base.slice(0, dot) : base
  const title = get(meta, 'title') || (m ? strip(m[1]) : nameTitle)
  let style = argStyle || get(meta, 'style', 'std'), theme = argTheme || get(meta, 'theme', 'orange')
  if (!Object.hasOwn(STYLES, style)) style = 'std'
  if (!Object.hasOwn(THEMES, theme)) theme = 'orange'
  const stat = {}
  let body = fixEmpty(render(md, { ...TOK, st: style, r: STYLES[style].r }, Object.assign(Object.create(null), meta), stat))
  if (style === 'dark') body = darkFix(body)
  const pal = THEMES[theme]
  for (const [k, tok] of Object.entries(TOK)) body = body.split(tok).join(pal[k])
  let bannerHtml = ''
  if (bannerSpec) {
    const spec = jsonCopy(bannerSpec)
    if (Object.keys(brand).length) spec.brand = brand
    const key = get(spec, 'style') === 'card' ? 'card' : 'poster'
    const bBody = get(spec, key, {})
    if (['card', 'poster', 'neo'].includes(get(spec, 'style')) && get(bBody, 'theme', 'all') === 'all') {
      const themes = { ...B.THEMES }
      for (const [k, T] of Object.entries(THEMES)) themes[k] = { main: T.main, light: T.tint, line: T.line, border: T.tint, bg: T.soft }
      const sp = jsonCopy(spec)
      if (style === 'neo' && sp.style === 'poster') sp.style = 'neo'
      sp[key].theme = theme
      bannerHtml = B.build(sp, themes)
    } else {
      bannerHtml = B.build(spec)
    }
    for (const x of B.checkSpec(spec, [bannerHtml])) warn('横幅：' + x)
  }
  const chRaw = Array.from(String(get(meta, 'author', AUTHOR) || AUTHOR).trim())[0] || '文'
  const avatarInitial = /^[a-z]$/.test(chRaw) ? chRaw.toUpperCase() : chRaw
  const badgeHtml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72" style="display:block;width:72px;height:72px;"><rect width="72" height="72" rx="36" fill="${pal.main}"/><text x="36" y="47" font-size="30" font-weight="800" fill="#FFFFFF" text-anchor="middle" font-family="'PingFang SC','Helvetica Neue',sans-serif">${esc(avatarInitial)}</text></svg>`
  const badgeSvg = (x, y, w, h) => {
    const nw = Number(w), nh = Number(h), cx = Math.round(Number(x) + nw / 2)
    const aligned = nw === 84 && nh === 80
    const cy = aligned ? Math.round(Number(y) + 44) : Math.round(Number(y) + nh / 2)
    const r = aligned ? 34 : Math.round(Math.min(nw, nh) * 0.38)
    const fs = Math.round(r * 0.92)
    return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${pal.main}"/><text x="${cx}" y="${Math.round(cy + fs * 0.35)}" font-size="${fs}" font-weight="800" fill="#FFFFFF" text-anchor="middle" font-family="'PingFang SC','Helvetica Neue',sans-serif">${esc(avatarInitial)}</text></g>`
  }
  const fillAvatar = (h, u) => {
    if (u) return h.split('GIF_URL_HERE').join(esc(u))
    return h
      .replace(/<img\s+src="GIF_URL_HERE"[^>]*\/>/g, () => badgeHtml)
      .replace(/<image\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"[^>]*href="GIF_URL_HERE"\s*\/>/g, (_, x, y, w, h_) => badgeSvg(x, y, w, h_))
  }
  const u = String(avatarUrl || '').trim()
  const finalBanner = fillAvatar(bannerHtml, u)
  const finalBody = fillAvatar(body, u)
  const html = (finalBanner ? `<section style="margin:0 0 24px">${finalBanner}</section>` : '') + finalBody
  const issues = check(md, body, bannerHtml, stat)
  const blocking = issues.filter(issue => issue.includes('飞书临时链接') || issue.includes('本地路径或 base64'))
  const prose = re(String.raw`(?ms)^\s*(` + '```' + String.raw`|~~~).*?^\s*\1[^\n]*`).sub('', md)
  const placeholders = re(String.raw`\[(?:可补|截图)[：:][^\]\n]*\]`).findall(prose)
  if (placeholders.length) {
    const msg = `还有 ${placeholders.length} 处稿件占位：` + placeholders.slice(0, 3).join('、')
    blocking.push(msg)
    issues.push(msg)
  }
  return { title, style, theme, html, issues, blocking }
}
