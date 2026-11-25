import { blockKind, parseMarkdownGallery, parseMarkdownImage } from './article.js'
import { MARKDOWN_TARGETS } from './derive-shared.js'
import { feishuImageUrls } from './markdown-images.js'
import { parseSvgCardBlock } from './svg-cards.js'
import { parseVideoCardBlock } from './video-card.js'

const CTA_BLOCK_RE = /^(点个?赞|在看|转发|设为[「"“]?星标|关注我|点击.{0,6}阅读原文)/
const VIDEO_PLACEHOLDER_RE = /^\[([^\]]+\.(?:mp4|mov|m4v|webm|avi))\]$/i
const UNFILLED_PLACEHOLDER_RE = /^\[(截图|可补|可选|视频|GIF)/
const CALLOUT_LABELS = {
  NOTE: '提示',
  TIP: '技巧',
  IMPORTANT: '重要',
  WARNING: '注意',
  WARN: '注意',
  CAUTION: '警告',
  TLDR: '省流版',
  QUOTE: '金句',
}

function assertTarget(target) {
  if (!MARKDOWN_TARGETS.includes(target)) {
    throw Object.assign(
      new Error(`不支持的导出目标：${target}（可选：${MARKDOWN_TARGETS.join('、')}）。`),
      { status: 400 },
    )
  }
}

function splitCells(line) {
  return line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
}

function degradeSvgCard(card) {
  const lines = [...card.lines]
  const quote = lines.at(-1)?.startsWith('>') ? lines.pop() : null
  const header = `**${card.title}**`
  let body = ''

  if (card.kind === 'svg-table') {
    body = lines.join('\n')
  } else if (card.kind === 'svg-steps' || card.kind === 'svg-timeline') {
    body = lines.map((line, i) => {
      const [left, right] = splitCells(line)
      return `${i + 1}. ${left}：${right ?? ''}`
    }).join('\n')
  } else if (card.kind === 'svg-compare') {
    const rows = lines.map(line => {
      const [left, right] = splitCells(line)
      return `| ${left} | ${right ?? ''} |`
    })
    body = ['| 对比项 | 说明 |', '| --- | --- |', ...rows].join('\n')
  } else if (card.kind === 'svg-breakdown') {
    body = lines.map(line => {
      const [left, right] = splitCells(line)
      return `- ${left}：${right ?? ''}`
    }).join('\n')
  } else if (card.kind === 'svg-bars') {
    body = lines.map(line => {
      const [label, value, display] = splitCells(line)
      return `- ${label}：${display || value}`
    }).join('\n')
  } else if (card.kind === 'svg-concept') {
    const rest = [...lines]
    const intro = rest.shift()
    const items = rest.map(line => {
      if (line.startsWith('!')) return `- ${line.replace(/^!\s*/, '')}`
      const [head, ...vals] = splitCells(line)
      return `- ${head}：${vals.join('、')}`
    })
    body = [intro, '', ...items].join('\n')
  } else if (card.kind === 'svg-phone') {
    body = lines.slice(1).map((line, i) => {
      const cells = splitCells(line)
      return `${i + 1}. ${cells[0]}：${cells.slice(1).join('｜')}`
    }).join('\n')
  }

  let out = [header, body].filter(Boolean).join('\n')
  if (quote) out += `\n\n${quote}`
  return out
}

function replaceWechatInline(segment) {
  return segment
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, '**$1**')
    .replace(/\+\+(?=\S)(.+?)(?<=\S)\+\+/g, '**$1**')
    .replace(/<u>([\s\S]*?)<\/u>/gi, '**$1**')
}

function transformInlineSyntax(text) {
  const inlineCodeRe = /(`+)([^\n]*?)\1/g
  let out = ''
  let cursor = 0
  for (const match of text.matchAll(inlineCodeRe)) {
    out += replaceWechatInline(text.slice(cursor, match.index)) + match[0]
    cursor = match.index + match[0].length
  }
  return out + replaceWechatInline(text.slice(cursor))
}

function convertZhihuCallouts(text) {
  return text.replace(
    /^(\s*>\s*)\[!([A-Z]+)\](?:[ \t]+(.*))?$/gm,
    (_, prefix, kind, rest) => {
      const label = CALLOUT_LABELS[kind] ?? kind
      const body = rest?.trim()
      return body ? `${prefix}**${label}**：${body}` : `${prefix}**${label}**`
    },
  )
}

export function portableBlocks(article, { target = 'blog', fixedLines = [] } = {}) {
  assertTarget(target)
  const fixedSet = new Set((fixedLines ?? []).map(line => String(line ?? '').trim()).filter(Boolean))
  const sourceBlocks = Array.isArray(article?.blocks) ? article.blocks : []
  const blocks = []
  const warnings = []
  let failedSvgCount = 0

  sourceBlocks.forEach((block, index) => {
    const no = index + 1
    const raw = String(block?.text ?? '')
    const trimmed = raw.trim()
    if (!trimmed) return

    if (blockKind(trimmed) === 'code') {
      if (/^```svg-[a-z]+/.test(trimmed)) {
        try {
          const card = parseSvgCardBlock(trimmed)
          blocks.push({ id: block.id, text: degradeSvgCard(card) })
        } catch {
          failedSvgCount += 1
        }
        return
      }
      const videoCard = parseVideoCardBlock(trimmed)
      if (videoCard) {
        const label = [videoCard.index, videoCard.title].filter(Boolean).join(' ') || '视频片段'
        warnings.push(`第 ${no} 段的视频装裱卡需在目标平台手动上传视频：${label}`)
        const lines = [`> 视频：${label}${videoCard.duration ? `（${videoCard.duration}）` : ''}`]
        if (videoCard.note) lines.push(`> ${videoCard.note}`)
        blocks.push({ id: block.id, text: lines.join('\n') })
        return
      }
      blocks.push({ id: block.id, text: raw })
      return
    }

    if (fixedSet.has(trimmed)) return
    if ([...trimmed].length <= 40 && CTA_BLOCK_RE.test(trimmed)) return

    const gallery = parseMarkdownGallery(trimmed)
    if (gallery) {
      blocks.push({
        id: block.id,
        text: gallery.map(item => `![${item.caption}](${item.src})`).join('\n\n'),
      })
      return
    }

    if (!parseMarkdownImage(trimmed)) {
      const video = VIDEO_PLACEHOLDER_RE.exec(trimmed)
      if (video) {
        warnings.push(`第 ${no} 段的视频需要在目标平台手动上传：${video[1]}`)
        return
      }
      if (UNFILLED_PLACEHOLDER_RE.test(trimmed)) {
        warnings.push(`第 ${no} 段还有未补的占位：${trimmed.slice(0, 40)}`)
        return
      }
    }

    const keptLines = raw.split('\n').filter(line => !fixedSet.has(line.trim()))
    let text = keptLines.join('\n').trim()
    if (!text) return
    text = transformInlineSyntax(text)
    if (target === 'zhihu') text = convertZhihuCallouts(text)
    blocks.push({ id: block.id, text })
  })

  if (failedSvgCount > 0) {
    warnings.push(`有 ${failedSvgCount} 张动画卡无法解析，已省略`)
  }
  const feishu = feishuImageUrls(blocks)
  if (feishu.length > 0) {
    warnings.push(`有 ${feishu.length} 张飞书图片尚未转存，外部平台可能无法显示`)
  }

  return { blocks, warnings }
}

export function toPortableMarkdown(article, { target = 'blog', fixedLines = [] } = {}) {
  assertTarget(target)
  const { blocks, warnings } = portableBlocks(article, { target, fixedLines })
  const title = String(article?.title ?? '').trim()
  const parts = []
  if (target !== 'zhihu' && title) parts.push(`# ${title}`)
  for (const block of blocks) parts.push(block.text)
  const markdown = parts.length ? `${parts.join('\n\n')}\n` : ''
  return { title, markdown, warnings }
}
