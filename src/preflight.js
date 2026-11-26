// 发布防踩坑体检：纯 JS、零模型成本、100% 确定性。
// 作为 DSH 面板与独立 CLI 的唯一体检事实来源，不改动 vendor/layout/layout.js 的 renderPage。
import { blockKind, plainOf, splitMarkdown } from './article.js'
import { MAX_MP_TITLE, MAX_TITLE } from './wechat-meta.js'

export const MAX_WECHAT_TITLE = MAX_TITLE
export const MAX_WECHAT_MP_TITLE = MAX_MP_TITLE
export const DEFAULT_MAX_PARAGRAPH_CHARS = 160
export const DEFAULT_MAX_DENSE_CHARS = 600

export const DEFAULT_COMPLIANCE_WORDS = {
  share: ['转发抽奖', '转发到朋友圈', '分享到朋友圈', '集赞领', '点击在看领', '点在看领', '不转不是', '转给身边'],
  extreme: ['全网第一', '全网最低', '绝对有效', '100%有效', '根治', '包治百病', '国家级', '最高级'],
}

const TEMP_IMG_RE = /authcode|feishu\.cn|larksuite\.com|larkoffice\.com|feishucdn|\/space\/api\/box/i
const IMG_RE = /!\[(?:\\.|[^\]\\])*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g
const MD_LINK_RE = /\[([^\]]+)\]\(<?(https?:\/\/[^)\s>]+)>?(?:\s+"[^"]*")?\)/gi
const BARE_URL_RE = /https?:\/\/[^\s<>"'`）)】》」』，。！？；：、]+/gi
const PLACEHOLDER_RE = /\[(?:可补|截图)[：:][^\]\n]*\]/g
const URL_LIKE_ENTRY_RE = /(?:https?:\/\/|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}\/)/i

function normalizeList(list) {
  return [...new Set(
    (Array.isArray(list) ? list : [])
      .map(s => String(s ?? '').trim()).filter(Boolean),
  )]
}

function stripFencedCode(text) {
  const lines = String(text ?? '').split('\n')
  const segments = []
  let current = []
  let fence = null
  let hasFence = false
  const flush = () => {
    if (current.length) {
      segments.push(current.join('\n'))
      current = []
    }
  }
  for (const line of lines) {
    if (!fence) {
      const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (m && (m[1][0] === '~' || !m[2].includes('`'))) {
        flush()
        fence = { ch: m[1][0], len: m[1].length }
        hasFence = true
        continue
      }
      current.push(line)
    } else {
      const closeRe = fence.ch === '`'
        ? new RegExp('^\\s{0,3}`{' + fence.len + ',}\\s*$')
        : new RegExp('^\\s{0,3}~{' + fence.len + ',}\\s*$')
      if (closeRe.test(line)) fence = null
    }
  }
  flush()
  return { text: segments.join('\n'), segments, hasFence }
}

function stripInlineCode(text) {
  return String(text ?? '').replace(/(`+)([^\n]+?)\1/g, '')
}

function trimTrailingUrlPunctuation(raw) {
  let url = String(raw ?? '').trim()
  while (url.length) {
    const last = url.at(-1)
    if (/[.,;:!?'"，。！？；：、》」』】）]/.test(last)) {
      url = url.slice(0, -1)
      continue
    }
    if (last === ')') {
      const opens = (url.match(/\(/g) ?? []).length
      const closes = (url.match(/\)/g) ?? []).length
      if (closes > opens) {
        url = url.slice(0, -1)
        continue
      }
    }
    break
  }
  return url
}

/**
 * 提取文本中的超链接（Markdown 链接与裸 URL），跳过行内代码与图片语法，去重并剥离尾部标点。
 * @param {string} text
 * @returns {string[]}
 */
export function extractLinks(text) {
  const urls = []
  const seen = new Set()
  const push = raw => {
    const clean = trimTrailingUrlPunctuation(raw)
    if (clean && /^https?:\/\//i.test(clean) && !seen.has(clean)) {
      seen.add(clean)
      urls.push(clean)
    }
  }
  let cleaned = stripInlineCode(stripFencedCode(text).text)
  // 先去掉图片语法，避免把 ![alt](https://...) 误判为正文链接
  cleaned = cleaned.replace(IMG_RE, ' ')
  // 提取 Markdown 链接并用空格占位，避免被裸 URL 正则二次匹配
  cleaned = cleaned.replace(MD_LINK_RE, (_, _label, url) => {
    push(url)
    return ' '
  })
  for (const match of cleaned.matchAll(BARE_URL_RE)) {
    push(match[0])
  }
  return urls
}

function stripFixedLines(text, fixedLines) {
  if (!fixedLines.length) return text
  return String(text).split('\n')
    .filter(line => !fixedLines.some(needle => line.includes(needle)))
    .join('\n')
}

function normalizeBlocks(input) {
  if (Array.isArray(input?.blocks)) {
    return {
      title: String(input.title ?? '').trim(),
      blocks: input.blocks.map(b => ({ id: b?.id ?? null, text: String(b?.text ?? '') })),
    }
  }
  const parsed = splitMarkdown(String(input?.markdown ?? ''))
  const title = input?.title !== undefined && input?.title !== null
    ? String(input.title).trim()
    : String(parsed.title ?? '').trim()
  return {
    title,
    blocks: parsed.blocks.map(text => ({ id: null, text })),
  }
}

function isDuplicateLayoutIssue(issue) {
  return issue.includes('飞书临时链接')
    || issue.includes('本地路径或 base64')
    || issue.includes('处稿件占位')
}

/**
 * 执行零成本、确定性的发布防踩坑体检。
 * @param {{title?: string, markdown?: string, blocks?: Array<{id?: string, text: string}>}} input
 * @param {{fixedLines?: string[], customWords?: string[], maxParagraphChars?: number, maxDenseChars?: number, layoutIssues?: string[], sponsoredBrief?: {partner?: string, mustInclude?: string[], taboo?: string[]} | null}} [options]
 */
export function runPreflight(input = {}, options = {}) {
  const { title, blocks } = normalizeBlocks(input)
  const fixedLines = (Array.isArray(options.fixedLines) ? options.fixedLines : [])
    .map(s => String(s ?? '').trim()).filter(Boolean)
  const customWords = normalizeList(options.customWords)
  const maxParagraphChars = options.maxParagraphChars ?? DEFAULT_MAX_PARAGRAPH_CHARS
  const maxDenseChars = options.maxDenseChars ?? DEFAULT_MAX_DENSE_CHARS
  const layoutIssues = Array.isArray(options.layoutIssues) ? options.layoutIssues : []
  const sponsoredBrief = options.sponsoredBrief && typeof options.sponsoredBrief === 'object'
    ? options.sponsoredBrief
    : null
  const sponsoredPartner = String(sponsoredBrief?.partner ?? '').trim()
  const sponsoredMustInclude = normalizeList(sponsoredBrief?.mustInclude)
  const sponsoredTaboo = normalizeList(sponsoredBrief?.taboo)
  const hasSponsoredChecks = sponsoredMustInclude.length > 0 || sponsoredTaboo.length > 0

  const items = []
  const stats = { chars: 0, titleChars: title.length, links: 0, images: 0, longParagraphs: 0 }

  // 1. 标题两档检查：公众号网页后台手动编辑上限 64 字，草稿箱 API 推送上限 32 字
  const titleTarget = options.titleTarget === 'draft' ? 'draft' : 'mp'
  if (!title) {
    items.push({
      id: 'title-empty',
      severity: 'blocking',
      category: 'title',
      title: '缺少文章标题',
      detail: `发布前请填写文章标题（后台手动上限 ${MAX_WECHAT_MP_TITLE} 字，草稿箱推送上限 ${MAX_WECHAT_TITLE} 字）。`,
      blockId: null,
      blockNumber: null,
    })
  } else if (title.length > MAX_WECHAT_MP_TITLE) {
    items.push({
      id: 'title-too-long',
      severity: 'blocking',
      category: 'title',
      title: `标题共 ${title.length} 字，超过公众号后台 ${MAX_WECHAT_MP_TITLE} 字上限`,
      detail: `公众号网页后台标题上限为 ${MAX_WECHAT_MP_TITLE} 字（草稿箱接口上限为 ${MAX_WECHAT_TITLE} 字），请精简标题。`,
      blockId: null,
      blockNumber: null,
    })
  } else if (title.length > MAX_WECHAT_TITLE) {
    if (titleTarget === 'draft') {
      items.push({
        id: 'title-too-long',
        severity: 'blocking',
        category: 'title',
        title: `标题共 ${title.length} 字，超过草稿箱推送 ${MAX_WECHAT_TITLE} 字上限`,
        detail: `公众号草稿箱接口标题上限为 ${MAX_WECHAT_TITLE} 字，推送时超出部分会被截断（手动复制到公众号后台最长可填 ${MAX_WECHAT_MP_TITLE} 字）。`,
        blockId: null,
        blockNumber: null,
      })
    } else {
      items.push({
        id: 'title-draft-limit',
        severity: 'warn',
        category: 'title',
        title: `标题共 ${title.length} 字，超出草稿箱推送 ${MAX_WECHAT_TITLE} 字上限`,
        detail: `手动复制到公众号后台最长支持 ${MAX_WECHAT_MP_TITLE} 字；若使用一键推送草稿箱，超出 ${MAX_WECHAT_TITLE} 字的部分会被截断。`,
        blockId: null,
        blockNumber: null,
      })
    }
  }

  // 2. 逐块扫描：媒体/占位阻断、商单链接提醒、可读性、合规词与自定义词
  let denseChars = 0
  let denseStart = null
  let denseStartId = null
  let denseEnd = null
  const flushDense = () => {
    if (denseChars > maxDenseChars && denseStart !== null) {
      items.push({
        id: 'dense-run',
        severity: 'info',
        category: 'readability',
        title: `第 ${denseStart}–${denseEnd} 段连续 ${denseChars} 字无视觉停顿`,
        detail: `连续超过 ${maxDenseChars} 字纯文字在手机端容易阅读疲劳，建议插入小标题、引用、列表或配图。`,
        blockId: denseStartId,
        blockNumber: denseStart,
      })
    }
    denseChars = 0
    denseStart = null
    denseStartId = null
    denseEnd = null
  }

  const builtinWords = [...DEFAULT_COMPLIANCE_WORDS.share, ...DEFAULT_COMPLIANCE_WORDS.extreme]
  const visibleTitle = hasSponsoredChecks ? plainOf(stripInlineCode(title).replace(IMG_RE, ' ')) : ''
  const titleLinks = hasSponsoredChecks ? extractLinks(title) : []
  const visibleCorpusParts = visibleTitle ? [visibleTitle] : []
  const allLinks = [...titleLinks]

  if (sponsoredTaboo.length) {
    const titleLower = visibleTitle.toLowerCase()
    const titleLinksLower = titleLinks.map(u => u.toLowerCase())
    const hitTitleTaboo = sponsoredTaboo.filter(word => {
      const lower = word.toLowerCase()
      return titleLower.includes(lower) || titleLinksLower.some(u => u.includes(lower))
    })
    if (hitTitleTaboo.length) {
      items.push({
        id: 'sponsored-taboo',
        severity: 'warn',
        category: 'sponsored',
        title: `标题命中商单禁忌：${hitTitleTaboo.slice(0, 3).join('、')}`,
        detail: sponsoredPartner
          ? `命中商单（${sponsoredPartner}）禁忌红线，请核对是否需要修改或删除（不阻止发布）。`
          : '命中商单禁忌红线，请核对是否需要修改或删除（不阻止发布）。',
        blockId: null,
        blockNumber: null,
        matches: hitTitleTaboo,
      })
    }
  }

  blocks.forEach((block, index) => {
    const number = index + 1
    const raw = block.text
    const { text: withoutFences, segments, hasFence } = stripFencedCode(raw)

    // 纯围栏代码块跳过正文检查，且作为视觉停顿重置连续段落
    if (!withoutFences.trim()) {
      flushDense()
      return
    }

    const kind = hasFence ? blockKind(withoutFences.trim()) : blockKind(raw)
    const noInlineCode = stripInlineCode(withoutFences)
    const plain = plainOf(noInlineCode)
    stats.chars += plain.length

    // 2a. 图片检查（飞书临时图 / 本地或 base64 图）
    const feishuUrls = []
    const localImgs = []
    for (const match of noInlineCode.matchAll(IMG_RE)) {
      const src = match[1].trim()
      stats.images += 1
      if (TEMP_IMG_RE.test(src)) feishuUrls.push(src)
      else if (!/^https?:\/\//i.test(src)) localImgs.push(src)
    }
    if (feishuUrls.length) {
      items.push({
        id: 'feishu-image',
        severity: 'blocking',
        category: 'media',
        title: `第 ${number} 段包含 ${feishuUrls.length} 张飞书临时图片`,
        detail: '飞书临时链接粘进公众号或推草稿箱会失效，请先转存图床或替换成公众号图库地址。',
        blockId: block.id,
        blockNumber: number,
        matches: feishuUrls.slice(0, 3),
      })
    }
    if (localImgs.length) {
      items.push({
        id: 'local-image',
        severity: 'blocking',
        category: 'media',
        title: `第 ${number} 段包含 ${localImgs.length} 张本地路径或 base64 图片`,
        detail: '本地路径或 base64 图片无法在公众号里显示，请先上传图床或公众号素材库。',
        blockId: block.id,
        blockNumber: number,
        matches: localImgs.slice(0, 3),
      })
    }

    // 2b. 未填占位符 [可补：...] / [截图：...]
    const placeholders = [...noInlineCode.matchAll(PLACEHOLDER_RE)].map(m => m[0])
    if (placeholders.length) {
      items.push({
        id: 'placeholder',
        severity: 'blocking',
        category: 'media',
        title: `第 ${number} 段还有 ${placeholders.length} 处未填占位`,
        detail: `发布前请补齐或删掉占位符：${placeholders.slice(0, 3).join('、')}`,
        blockId: block.id,
        blockNumber: number,
        matches: placeholders.slice(0, 3),
      })
    }

    // 2c. 链接检查（商单外链提醒：永远只报 warn，绝不阻断发布）
    const links = extractLinks(withoutFences)
    if (links.length) {
      stats.links += links.length
      items.push({
        id: 'external-link',
        severity: 'warn',
        category: 'links',
        title: `第 ${number} 段包含 ${links.length} 处链接`,
        detail: `商单合作通常限制外链或跳转链接，请按合作要求确认是否保留（不阻止发布）：${links.slice(0, 3).join('、')}`,
        blockId: block.id,
        blockNumber: number,
        matches: links,
      })
    }

    // 2d. 手机端可读性（文字墙 & 连续纯文字区间）
    if (kind === 'para') {
      const maxSegLen = hasFence
        ? Math.max(0, ...segments.map(seg => plainOf(stripInlineCode(seg)).length))
        : plain.length
      if (maxSegLen > maxParagraphChars) {
        stats.longParagraphs += 1
        items.push({
          id: 'long-paragraph',
          severity: 'warn',
          category: 'readability',
          title: `第 ${number} 段共 ${maxSegLen} 字，手机端偏长`,
          detail: `超过 ${maxParagraphChars} 字的单段在手机屏上会形成大块文字墙，建议拆成 2–3 段。`,
          blockId: block.id,
          blockNumber: number,
        })
      }
      if (hasFence) {
        flushDense()
      } else {
        if (denseStart === null) {
          denseStart = number
          denseStartId = block.id
        }
        denseEnd = number
        denseChars += plain.length
      }
    } else {
      flushDense()
    }

    // 2e. 内置合规词 & 用户自定义提醒词（跳过 fixedLines，仅做 warn 提醒）
    const checkText = stripFixedLines(noInlineCode, fixedLines)
    const hitBuiltin = builtinWords.filter(word => checkText.includes(word))
    if (hitBuiltin.length) {
      items.push({
        id: 'compliance-word',
        severity: 'warn',
        category: 'compliance',
        title: `第 ${number} 段命中风险提醒词：${hitBuiltin.slice(0, 3).join('、')}`,
        detail: '可能触发诱导分享或广告极限词审核，仅供人工复核，不代表微信官方审核结论。',
        blockId: block.id,
        blockNumber: number,
        matches: hitBuiltin,
      })
    }
    if (customWords.length) {
      const hitCustom = customWords.filter(word => checkText.includes(word))
      if (hitCustom.length) {
        items.push({
          id: 'custom-banned-word',
          severity: 'warn',
          category: 'compliance',
          title: `第 ${number} 段命中自定义提醒词：${hitCustom.slice(0, 3).join('、')}`,
          detail: '命中你在「发布体检」里配置的自定义词，请确认是否需要替换。',
          blockId: block.id,
          blockNumber: number,
          matches: hitCustom,
        })
      }
    }

    // 2f. 商单双语料收集与禁忌红线检查（跳过围栏代码、行内代码与图片语法，永远只报 warn）
    if (hasSponsoredChecks) {
      const visibleText = plain ? plainOf(noInlineCode.replace(IMG_RE, ' ')) : ''
      if (visibleText) visibleCorpusParts.push(visibleText)
      if (links.length) allLinks.push(...links)

      if (sponsoredTaboo.length) {
        const visibleLower = visibleText.toLowerCase()
        const blockLinksLower = links.map(u => u.toLowerCase())
        const hitTaboo = sponsoredTaboo.filter(word => {
          const lower = word.toLowerCase()
          return visibleLower.includes(lower) || blockLinksLower.some(u => u.includes(lower))
        })
        if (hitTaboo.length) {
          items.push({
            id: 'sponsored-taboo',
            severity: 'warn',
            category: 'sponsored',
            title: `第 ${number} 段命中商单禁忌：${hitTaboo.slice(0, 3).join('、')}`,
            detail: sponsoredPartner
              ? `命中商单（${sponsoredPartner}）禁忌红线，请核对是否需要修改或删除（不阻止发布）。`
              : '命中商单禁忌红线，请核对是否需要修改或删除（不阻止发布）。',
            blockId: block.id,
            blockNumber: number,
            matches: hitTaboo,
          })
        }
      }
    }
  })

  flushDense()

  // 2g. 商单必带信息核对（URL 片段查真实链接 + 可见正文，普通文本仅查可见正文，大小写不敏感，永远只报 warn）
  if (sponsoredMustInclude.length) {
    const fullVisibleLower = visibleCorpusParts.join('\n').toLowerCase()
    const allLinksLower = allLinks.map(u => u.toLowerCase())
    for (const entry of sponsoredMustInclude) {
      const needle = entry.toLowerCase()
      const matched = URL_LIKE_ENTRY_RE.test(entry)
        ? (fullVisibleLower.includes(needle) || allLinksLower.some(u => u.includes(needle)))
        : fullVisibleLower.includes(needle)
      if (!matched) {
        items.push({
          id: 'sponsored-must-include',
          severity: 'warn',
          category: 'sponsored',
          title: `商单必带信息未出现：${entry}`,
          detail: sponsoredPartner
            ? `商单（${sponsoredPartner}）要求包含「${entry}」，当前正文与链接中未检测到（不阻止发布）。`
            : `商单要求包含「${entry}」，当前正文与链接中未检测到（不阻止发布）。`,
          blockId: null,
          blockNumber: null,
          matches: [entry],
        })
      }
    }
  }

  // 3. 合并排版引擎专属提醒（外部图床、视频占位、SVG 禁写属性、动画卡 >3 张、横幅警告），去除与上方重复的媒体/占位项
  for (const rawIssue of layoutIssues) {
    const text = String(rawIssue ?? '').trim()
    if (!text || isDuplicateLayoutIssue(text)) continue
    items.push({
      id: 'layout-issue',
      severity: 'warn',
      category: 'layout',
      title: text,
      detail: '来自排版自查，请在发布前确认。',
      blockId: null,
      blockNumber: null,
    })
  }

  const counts = { blocking: 0, warn: 0, info: 0 }
  for (const item of items) counts[item.severity] += 1

  return {
    ok: counts.blocking === 0,
    counts,
    stats,
    items,
  }
}
