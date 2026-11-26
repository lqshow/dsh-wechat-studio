// 备稿模块的纯函数汇总、倒计时与快捷键判定（零外部依赖，便于单测）。
import { dayKey, parseDay } from '../src/schedule-time.js'

const DAY_MS = 24 * 60 * 60 * 1000
const SETTLED_AFTER_MS = 30 * DAY_MS
const SETTLED_COLLAPSE_THRESHOLD = 12
const MAX_CAPSULES = 4

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase()
}

function parseQueryTerms(query) {
  return normalizeText(query).trim().split(/\s+/).filter(Boolean)
}

function compareDesc(a, b) {
  return String(b ?? '').localeCompare(String(a ?? ''))
}

function sortBagNotes(notes) {
  return [...notes].sort((a, b) => {
    const pinDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned))
    if (pinDiff !== 0) return pinDiff
    return compareDesc(a?.createdAt, b?.createdAt)
  })
}

function sortActiveBags(bags) {
  return [...bags].sort((a, b) => {
    const aSponsored = a?.type === 'sponsored' ? 1 : 0
    const bSponsored = b?.type === 'sponsored' ? 1 : 0
    if (aSponsored !== bSponsored) return bSponsored - aSponsored

    if (aSponsored) {
      const aDate = a?.targetDate ? String(a.targetDate) : ''
      const bDate = b?.targetDate ? String(b.targetDate) : ''
      if (aDate && bDate) {
        const cmp = aDate.localeCompare(bDate)
        if (cmp !== 0) return cmp
      } else if (aDate || bDate) {
        return aDate ? -1 : 1
      }
    }

    const updatedCmp = compareDesc(a?.updatedAt, b?.updatedAt)
    if (updatedCmp !== 0) return updatedCmp
    return compareDesc(a?.createdAt, b?.createdAt)
  })
}

function bagMatchesTerms(bag, bagNotes, terms) {
  if (!terms.length) return true
  const brief = bag?.brief ?? {}
  const haystack = normalizeText([
    bag?.title,
    brief.partner,
    brief.sellingPoints,
    ...(Array.isArray(brief.mustInclude) ? brief.mustInclude : []),
    ...(Array.isArray(brief.taboo) ? brief.taboo : []),
    ...bagNotes.map(n => n?.text),
    ...bagNotes.map(n => n?.link?.url),
    ...bagNotes.map(n => n?.link?.host),
    ...bagNotes.map(n => n?.image?.name),
  ].filter(Boolean).join(' '))
  return terms.every(term => haystack.includes(term))
}

function noteMatchesTerms(note, terms) {
  if (!terms.length) return true
  const haystack = normalizeText([
    note?.text,
    note?.link?.url,
    note?.link?.host,
    note?.image?.name,
  ].filter(Boolean).join(' '))
  return terms.every(term => haystack.includes(term))
}

/**
 * 汇总备稿页所需的袋子分组、定向投递胶囊、自由纸条（活跃/沉淀）与计数。
 * @param {{ bags?: Array<object>, notes?: Array<object> } | null | undefined} prep
 * @param {{ query?: string, noteFilter?: 'all' | 'link' | 'image' | 'text', now?: number | Date }} [options]
 */
export function summarizePrep(prep, { query = '', noteFilter = 'all', now = Date.now() } = {}) {
  const bags = Array.isArray(prep?.bags) ? prep.bags : []
  const notes = Array.isArray(prep?.notes) ? prep.notes : []
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const terms = parseQueryTerms(query)
  const hasQuery = terms.length > 0

  const notesByBag = new Map()
  const rawFreeNotes = []
  for (const note of notes) {
    if (!note) continue
    if (note.bagId) {
      let list = notesByBag.get(note.bagId)
      if (!list) {
        list = []
        notesByBag.set(note.bagId, list)
      }
      list.push(note)
    } else {
      rawFreeNotes.push(note)
    }
  }

  const enrichBag = bag => {
    const bagNotes = sortBagNotes(notesByBag.get(bag.id) ?? [])
    return {
      ...bag,
      notes: bagNotes,
      noteCount: bagNotes.length,
      includedCount: bagNotes.filter(n => n.included !== false).length,
    }
  }

  const allActiveBags = sortActiveBags(bags.filter(b => b && !b.archivedAt && !b.articleId).map(enrichBag))
  const allPromotedBags = bags
    .filter(b => b && !b.archivedAt && Boolean(b.articleId))
    .map(enrichBag)
    .sort((a, b) => compareDesc(a.promotedAt || a.updatedAt, b.promotedAt || b.updatedAt))
  const allArchivedBags = bags
    .filter(b => b && Boolean(b.archivedAt))
    .map(enrichBag)
    .sort((a, b) => compareDesc(a.archivedAt || a.updatedAt, b.archivedAt || b.updatedAt))

  const capsules = allActiveBags.slice(0, MAX_CAPSULES)

  const counts = {
    sponsored: allActiveBags.filter(b => b.type === 'sponsored').length,
    topics: allActiveBags.filter(b => b.type !== 'sponsored').length,
    activeBags: allActiveBags.length,
    promotedBags: allPromotedBags.length,
    archivedBags: allArchivedBags.length,
    freeNotes: rawFreeNotes.length,
    totalNotes: notes.length,
  }

  const activeBags = hasQuery
    ? allActiveBags.filter(b => bagMatchesTerms(b, b.notes, terms))
    : allActiveBags
  const promotedBags = hasQuery
    ? allPromotedBags.filter(b => bagMatchesTerms(b, b.notes, terms))
    : allPromotedBags
  const archivedBags = hasQuery
    ? allArchivedBags.filter(b => bagMatchesTerms(b, b.notes, terms))
    : allArchivedBags

  const filteredFreeNotes = [...rawFreeNotes]
    .sort((a, b) => compareDesc(a.updatedAt || a.createdAt, b.updatedAt || b.createdAt))
    .filter(note => {
      if (noteFilter && noteFilter !== 'all' && note.kind !== noteFilter) return false
      return noteMatchesTerms(note, terms)
    })

  const freshFreeNotes = []
  const settledFreeNotes = []
  for (const note of filteredFreeNotes) {
    const ts = Date.parse(note.updatedAt || note.createdAt || '')
    const isSettled = Number.isFinite(ts) && Number.isFinite(nowMs) && (nowMs - ts) > SETTLED_AFTER_MS
    if (isSettled) settledFreeNotes.push(note)
    else freshFreeNotes.push(note)
  }

  return {
    counts,
    activeBags,
    promotedBags,
    archivedBags,
    capsules,
    freshFreeNotes,
    settledFreeNotes,
    collapseSettled: !hasQuery && settledFreeNotes.length > SETTLED_COLLAPSE_THRESHOLD,
    hasQuery,
  }
}

/**
 * 格式化选题/商单袋的目标日倒计时。
 * @param {string | null | undefined} targetDate 'YYYY-MM-DD'
 * @param {number | Date} [now]
 * @returns {{ label: string, urgent: boolean, overdue: boolean }}
 */
export function formatDueCountdown(targetDate, now = Date.now()) {
  if (!targetDate) return { label: '', urgent: false, overdue: false }
  let target
  let today
  try {
    target = parseDay(targetDate)
    const nowDate = now instanceof Date ? now : new Date(now)
    today = parseDay(dayKey(nowDate))
  } catch {
    return { label: '', urgent: false, overdue: false }
  }
  const diffDays = Math.round((target.getTime() - today.getTime()) / DAY_MS)
  if (diffDays < 0) return { label: '已过目标日', urgent: true, overdue: true }
  if (diffDays === 0) return { label: '今天到期', urgent: true, overdue: false }
  return {
    label: `剩 ${diffDays} 天`,
    urgent: diffDays <= 3,
    overdue: false,
  }
}

/**
 * 判定全站速记快捷键：
 * - macOS: ⌘J 或 Alt+Shift+J
 * - Windows / Linux: Alt+Shift+J（永不响应 Ctrl+J，避开浏览器下载页）
 */
export function isQuickCaptureShortcut(event, platform) {
  if (!event || event.isComposing) return false
  const key = String(event.key ?? '').toLowerCase()
  const isJ = key === 'j' || event.code === 'KeyJ'
  if (!isJ) return false
  if (event.ctrlKey) return false

  if (event.altKey && event.shiftKey && !event.metaKey) return true

  const rawPlatform = platform !== undefined
    ? platform
    : (typeof navigator !== 'undefined'
      ? (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')
      : '')
  const isMac = /mac|iphone|ipad|ipod|darwin/i.test(String(rawPlatform))
  if (isMac && event.metaKey && !event.altKey && !event.shiftKey) return true

  return false
}

/** 焦点守卫：判定事件目标是否位于可编辑元素内。 */
export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.nodeType === 3) return isEditableTarget(target.parentElement)
  const tag = String(target.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable === true) return true
  const ce = typeof target.getAttribute === 'function'
    ? target.getAttribute('contenteditable')
    : target.contentEditable
  if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true
  if (typeof target.closest === 'function') {
    if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) {
      return true
    }
  }
  return false
}
