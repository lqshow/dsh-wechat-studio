import { parseGalleryBlock } from './gallery.js'

// 文章模型：Markdown 按段切成块，所有修改都落到某一块上，改一段不会碰到别的段。
let counter = 0

// 标题钩子类型，来自 skills/headline.md 的四大钩子库。成稿选标题时记下，复盘按它比较。
export const HOOKS = { A: '自我打脸', B: '反转', C: '被求助', D: '技术发现', other: '其他' }
export const HOOK_IDS = Object.keys(HOOKS)

export function newId(prefix = 'b') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

const HISTORY_MAX = 20
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 把 Markdown 切成 front matter、标题和正文块。代码块内部的空行不切。
 * @param {string} markdown - 原文。
 * @returns {{front: string, title: string, blocks: string[]}} 切分结果。
 */
export function splitMarkdown(markdown, { bodyOnly = false } = {}) {
  let text = String(markdown ?? '').replace(/\r\n?/g, '\n')
  let front = ''
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(text)
  if (fm && !bodyOnly) {
    front = fm[0].trim()
    text = text.slice(fm[0].length)
  }
  const blocks = []
  let current = []
  let fence = null
  const flush = () => {
    const joined = current.join('\n').replace(/\s+$/, '')
    if (joined.trim()) blocks.push(joined)
    current = []
  }
  for (const line of text.split('\n')) {
    const mark = /^\s*(```+|~~~+)/.exec(line)
    if (mark) {
      if (!fence) fence = mark[1][0]
      else if (mark[1][0] === fence) fence = null
      current.push(line)
      continue
    }
    if (!fence && !line.trim()) flush()
    else current.push(line)
  }
  flush()
  let title = ''
  const head = bodyOnly ? -1 : blocks.findIndex(b => /^#\s+\S/.test(b) && !b.includes('\n'))
  if (head !== -1) title = blocks.splice(head, 1)[0].replace(/^#\s+/, '').trim()
  return { front, title, blocks }
}

export function parseMarkdownImage(text) {
  const match = /^!\[((?:\\.|[^\]\\])*)\]\(<?([^\s>)]+)>?(?:\s+"([^"]*)")?\)\s*$/.exec(String(text ?? ''))
  if (!match) return null
  return { caption: match[1].replace(/\\([\\\[\]])/g, '$1'), src: match[2], title: match[3] ?? '' }
}

export function parseMarkdownGallery(text) {
  return parseGalleryBlock(text)?.items ?? null
}

export function blockKind(text) {
  if (/^\s*(```|~~~)/.test(text)) return 'code'
  if (/^#{2,6}\s/.test(text)) return 'heading'
  if (/^>\s?/.test(text)) return 'quote'
  if (parseMarkdownImage(text) || parseMarkdownGallery(text) || /^\[[^\]]+\.(mp4|mov)\]\s*$/i.test(text)) return 'media'
  if (/^\|.*\|\s*$/m.test(text) && /^\|?\s*:?-{2,}/m.test(text)) return 'table'
  if (/^\s*([-*+]|\d+[.)])\s/.test(text)) return 'list'
  if (/^(-{3,}|\*{3,})\s*$/.test(text)) return 'rule'
  return 'para'
}

/** 去掉 Markdown 记号后的纯文字，用来和朱雀报告对段落。 */
export function plainOf(text) {
  if (parseMarkdownGallery(text)) return ''
  return String(text)
    .replace(/!\[(?:\\.|[^\]\\])*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*>\s?(\[![A-Z]+\]\s*)?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|==|\+\+|`|<\/?u>)/g, '')
    .trim()
}

/** 这一块要不要参加 AI 味质检：只看成段的文字。 */
export function isCheckable(text) {
  const kind = blockKind(text)
  return ['para', 'quote', 'list'].includes(kind) && plainOf(text).length >= 20
}

export function createArticle({ id, topic = '', material = '', markdown = '', sourceBagId, sponsoredSnapshot } = {}) {
  if (id !== undefined && id !== null) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw Object.assign(new Error(`非法稿件 ID：${id}`), { status: 400 })
    }
  }
  const parsed = splitMarkdown(markdown)
  const now = new Date().toISOString()
  const article = {
    id: id ?? newId('a'), createdAt: now, updatedAt: now,
    topic: String(topic).trim().slice(0, 400), material: String(material).slice(0, 60000),
    front: parsed.front, title: parsed.title, titles: [], summary: '', hook: null,
    blocks: parsed.blocks.map(text => ({ id: newId(), text, check: null })),
    chat: [], history: [], zhuque: { round: 0, lastAt: null }, inlineDiagrams: [],
  }
  if (sourceBagId !== undefined && sourceBagId !== null && sourceBagId !== '') {
    article.sourceBagId = String(sourceBagId)
  }
  if (sponsoredSnapshot !== undefined && sponsoredSnapshot !== null) {
    article.sponsoredSnapshot = structuredClone(sponsoredSnapshot)
  }
  return article
}

export function setBody(article, markdown) {
  const parsed = splitMarkdown(markdown)
  if (parsed.front) article.front = parsed.front
  if (parsed.title) article.title = parsed.title
  article.blocks = parsed.blocks.map(text => ({ id: newId(), text, check: null }))
  article.inlineDiagrams = []
  article.inlineMessage = null
}

export function toMarkdown(article) {
  const parts = []
  if (article.front) parts.push(article.front)
  if (article.title) parts.push(`# ${article.title}`)
  for (const block of article.blocks) parts.push(block.text)
  return `${parts.join('\n\n')}\n`
}

/** 改动前存一份快照，供撤销。 */
export function snapshot(article, label) {
  article.history.push({ label, at: new Date().toISOString(), title: article.title, hook: article.hook ?? null, titles: structuredClone(article.titles), blocks: structuredClone(article.blocks) })
  if (article.history.length > HISTORY_MAX) article.history.splice(0, article.history.length - HISTORY_MAX)
}

export function undo(article) {
  const last = article.history.pop()
  if (!last) return null
  article.title = last.title
  article.hook = last.hook ?? null
  article.titles = last.titles
  article.blocks = last.blocks
  if (last.reimportBefore) {
    for (const key of ['summary', 'zhuque', 'imageImport']) {
      const value = last.reimportBefore[key]
      if (value === undefined) delete article[key]
      else article[key] = structuredClone(value)
    }
  }
  touch(article)
  return last.label
}

/** 相邻快照就是一次修改前后的内容；按段落 ID 对齐，避免增删导致后续段落错位。 */
export function revisionChanges(article) {
  return article.history.map((before, index) => {
    const after = article.history[index + 1] ?? article
    const rows = []
    if (before.title !== after.title) {
      rows.push({ kind: 'title', before: before.title ? { text: before.title } : null, after: after.title ? { text: after.title } : null })
    }
    const oldBlocks = new Map(before.blocks.map((block, i) => [block.id, { text: block.text, number: i + 1 }]))
    const newIds = new Set(after.blocks.map(block => block.id))
    const oldRank = new Map(before.blocks.filter(block => newIds.has(block.id)).map((block, rank) => [block.id, rank]))
    const newRank = new Map(after.blocks.filter(block => oldBlocks.has(block.id)).map((block, rank) => [block.id, rank]))
    let cursor = 0
    const deleted = block => rows.push({ kind: 'delete', before: oldBlocks.get(block.id), after: null })
    after.blocks.forEach((block, i) => {
      const old = oldBlocks.get(block.id)
      if (old) {
        while (cursor < old.number - 1) {
          const pending = before.blocks[cursor++]
          if (!newIds.has(pending.id)) deleted(pending)
        }
        cursor = Math.max(cursor, old.number)
      }
      if (!old || old.text !== block.text) {
        rows.push({ kind: old ? 'rewrite' : 'insert', before: old ?? null, after: { text: block.text, number: i + 1 } })
      } else if (oldRank.get(block.id) !== newRank.get(block.id)) {
        rows.push({ kind: 'move', before: old, after: { text: block.text, number: i + 1 } })
      }
    })
    for (const block of before.blocks.slice(cursor)) {
      if (!newIds.has(block.id)) deleted(block)
    }
    return { index, label: before.label, at: before.at, rows }
  }).filter(revision => revision.rows.length).reverse()
}

export function touch(article) {
  article.updatedAt = new Date().toISOString()
}

const text = (value, max) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '')

/**
 * 把模型给的修改落到文章上。模型输出不可信：只认白名单里的操作和字段，段号越界的直接丢弃。
 * 段号是 1 起的、按当前顺序数的；为了让一批操作里的段号都指向修改前的位置，先解析成块 id 再执行。
 * @param {object} article - 文章，会被就地修改。
 * @param {Array<object>} ops - 操作列表。
 * @returns {{receipts: string[], changed: number[]}} 回执和被改到的段号。
 */
export function applyOps(article, ops) {
  const receipts = []
  const changed = []
  const list = Array.isArray(ops) ? ops.slice(0, 40) : []
  const resolved = list.map(op => {
    const index = Number.isInteger(op?.block) ? op.block - 1 : -1
    return { op, target: article.blocks[index] ?? null, no: index + 1 }
  })
  for (const { op, target, no } of resolved) {
    const kind = op?.op
    if (kind === 'title') {
      const value = text(op.text, 80)
      if (value && value !== article.title) {
        article.title = value
        article.hook = HOOK_IDS.includes(op.hook) ? op.hook : null
        receipts.push(`标题改成《${value}》`)
      }
    } else if (kind === 'titles') {
      const values = (Array.isArray(op.list) ? op.list : [])
        .map(v => ({ text: text(typeof v === 'string' ? v : v?.text, 80), hook: HOOK_IDS.includes(v?.hook) ? v.hook : null }))
        .filter(v => v.text).slice(0, 8)
      if (values.length) {
        article.titles = values
        receipts.push(`重写了 ${values.length} 个标题候选`)
      }
    } else if (kind === 'rewrite' && target) {
      const value = text(op.text, 20000)
      if (value && value !== target.text) {
        target.text = value
        target.check = null
        changed.push(no)
        receipts.push(`改写第 ${no} 段`)
      }
    } else if (kind === 'insert_after' && (target || op.block === 0)) {
      const value = text(op.text, 20000)
      if (value) {
        const at = target ? article.blocks.indexOf(target) + 1 : 0
        article.blocks.splice(at, 0, { id: newId(), text: value, check: null })
        receipts.push(target ? `在第 ${no} 段后面加了一段` : '在开头加了一段')
      }
    } else if (kind === 'delete' && target) {
      const at = article.blocks.indexOf(target)
      if (at !== -1) {
        article.blocks.splice(at, 1)
        receipts.push(`删掉第 ${no} 段`)
      }
    }
  }
  if (receipts.length) touch(article)
  return { receipts, changed }
}

/** 带段号的正文，喂给模型时用。 */
export function numbered(article) {
  return article.blocks.map((block, index) => `【${index + 1}】${block.text}`).join('\n\n')
}

/** 发车体检：五项全过才算就绪。横幅是否就绪由 Host 传入，避免依赖 banner.js。 */
export function readiness(article, { bannerReady = false } = {}) {
  const pending = article.blocks.some(block => ['flag', 'fixed'].includes(block.check?.status))
  const items = [
    { id: 'body', label: '正文', done: article.blocks.length > 0 },
    { id: 'title', label: '标题', done: Boolean(article.title) },
    { id: 'quality', label: '质检', done: Boolean(article.zhuque?.round) && !pending },
    { id: 'cover', label: '封面', done: Boolean(article.cover?.id) },
    { id: 'banner', label: '横幅', done: bannerReady },
  ]
  return { items, done: items.filter(item => item.done).length, total: items.length }
}

export function setSchedule(article, at) {
  article.scheduledFor = at
  touch(article)
}

export function clearSchedule(article) {
  delete article.scheduledFor
  touch(article)
}

export function markPublished(article, at, markedAt) {
  if (article.publishedAt) return false
  article.publishedAt = at
  if (markedAt) article.publishMarkedAt = markedAt
  touch(article)
  return true
}

export function correctPublishedAt(article, at) {
  if (!article.publishMarkedAt) article.publishMarkedAt = article.publishedAt
  article.publishedAt = at
  touch(article)
}

export function unpublish(article) {
  delete article.publishedAt
  delete article.publishMarkedAt
  touch(article)
}

export function listMeta(article, { bannerReady = false } = {}) {
  const chars = article.blocks.reduce((sum, block) => sum + plainOf(block.text).length, 0)
  return {
    id: article.id, title: article.title || article.topic || '未命名文章', updatedAt: article.updatedAt, chars,
    hook: article.hook ?? null,
    lastView: article.lastView === 'layout' ? 'layout' : 'paper',
    archivedAt: article.archivedAt ?? null,
    coverId: article.cover?.id ?? null,
    review: article.blocks.reduce((count, block) => count + Number(['flag', 'fixed'].includes(block.check?.status)), 0),
    checked: Boolean(article.zhuque?.round),
    scheduledFor: article.scheduledFor ?? null,
    publishedAt: article.publishedAt ?? null,
    publishMarkedAt: article.publishMarkedAt ?? null,
    sourceBagId: article.sourceBagId ?? null,
    readiness: readiness(article, { bannerReady }),
  }
}

/**
 * 一键处理要改哪些段。照 zhuque skill 的规矩跳过三种：改过两轮的（留给作者自己重说）、
 * 改完结论反而更重的（该退回上一版）、PDF 报告里 0.5–0.6 噪声带的。
 * @param {object} article - 文章。
 * @returns {{picked: number[], skipped: {twice: number, worse: number, noise: number}}} 要改的段（下标 0 起）和跳过的数目。
 */
export function fixPlan(article) {
  const picked = []
  const skipped = { twice: 0, worse: 0, noise: 0 }
  article.blocks.forEach((block, index) => {
    const check = block.check
    if (check?.status !== 'flag') return
    if (check.worse) skipped.worse += 1
    else if ((check.fixes ?? 0) >= 2) skipped.twice += 1
    else if (check.source !== 'api' && check.level !== 'ai' && check.score < 0.6) skipped.noise += 1
    else picked.push(index)
  })
  return { picked, skipped }
}

/**
 * 把要改的段按相邻关系分组：朱雀常把几段短段落判成一个片段，并列、对仗这类问题也常跨段，
 * 一起改才看得到。中间隔着一个标题或图片就断开。每组最多 5 段、约 900 字。
 * 排序照 skill 第 3 步：含 AI 特征的组先改，再按分数从高到低。
 * @param {object} article - 文章。
 * @param {number[]} picked - fixPlan 选出的段（下标 0 起，升序）。
 * @returns {number[][]} 分好的组。
 */
export function fixGroups(article, picked, { maxBlocks = 5, maxChars = 900 } = {}) {
  const groups = []
  let current = []
  let chars = 0
  for (const index of picked) {
    const size = plainOf(article.blocks[index].text).length
    const adjacent = current.length && index === current.at(-1) + 1
    if (current.length && (!adjacent || current.length >= maxBlocks || chars + size > maxChars)) {
      groups.push(current)
      current = []
      chars = 0
    }
    current.push(index)
    chars += size
  }
  if (current.length) groups.push(current)
  const weight = group => Math.max(...group.map(i => (article.blocks[i].check.level === 'ai' ? 2 : 1) + (article.blocks[i].check.score ?? 0)))
  return groups.sort((a, b) => weight(b) - weight(a))
}
