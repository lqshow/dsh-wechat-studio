import { formatSellingPoints } from '../src/prep-brief-text.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatDueCountdown,
  isEditableTarget,
  isQuickCaptureShortcut,
  summarizePrep,
} from '../client/prep-model.js'

const DAY_MS = 24 * 60 * 60 * 1000

test('summarizePrep 排序活跃袋子（商单按 targetDate 升序、无日期置后，再普通选题按 updatedAt 降序）且 capsules 上限为 4', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z')
  const prep = {
    v: 1,
    bags: [
      { id: 'topic_old', title: '旧选题', type: 'topic', targetDate: null, updatedAt: '2026-11-20T10:00:00.000Z' },
      { id: 'sp_undated_old', title: '无日期旧商单', type: 'sponsored', targetDate: null, brief: { partner: 'Alpha' }, updatedAt: '2026-11-21T10:00:00.000Z' },
      { id: 'sp_later', title: '较晚商单', type: 'sponsored', targetDate: '2026-11-30', brief: { partner: 'Beta' }, updatedAt: '2026-11-25T09:00:00.000Z' },
      { id: 'sp_soon', title: '近期商单', type: 'sponsored', targetDate: '2026-11-26', brief: { partner: 'Cursor' }, updatedAt: '2026-11-22T09:00:00.000Z' },
      { id: 'sp_undated_new', title: '无日期新商单', type: 'sponsored', targetDate: null, brief: { partner: 'Gamma' }, updatedAt: '2026-11-24T10:00:00.000Z' },
      { id: 'topic_new', title: '新选题', type: 'topic', targetDate: '2026-11-26', updatedAt: '2026-11-25T11:00:00.000Z' },
      { id: 'promoted_1', title: '已成稿袋', type: 'sponsored', targetDate: '2026-11-24', articleId: 'a_1', promotedAt: '2026-11-24T12:00:00.000Z', updatedAt: '2026-11-24T12:00:00.000Z' },
      { id: 'archived_1', title: '已归档袋', type: 'topic', targetDate: null, archivedAt: '2026-11-23T12:00:00.000Z', updatedAt: '2026-11-23T12:00:00.000Z' },
    ],
    notes: [
      { id: 'n_bag_1', text: '普通想法', kind: 'text', bagId: 'sp_soon', pinned: false, included: true, createdAt: '2026-11-25T10:00:00.000Z', updatedAt: '2026-11-25T10:00:00.000Z' },
      { id: 'n_bag_2', text: '核心切入点', kind: 'text', bagId: 'sp_soon', pinned: true, included: true, createdAt: '2026-11-24T10:00:00.000Z', updatedAt: '2026-11-24T10:00:00.000Z' },
      { id: 'n_free_1', text: '自由纸条一', kind: 'text', bagId: null, createdAt: '2026-11-25T08:00:00.000Z', updatedAt: '2026-11-25T08:00:00.000Z' },
    ],
  }

  const res = summarizePrep(prep, { now })

  assert.deepEqual(
    res.activeBags.map(b => b.id),
    ['sp_soon', 'sp_later', 'sp_undated_new', 'sp_undated_old', 'topic_new', 'topic_old'],
  )
  assert.deepEqual(
    res.capsules.map(b => b.id),
    ['sp_soon', 'sp_later', 'sp_undated_new', 'sp_undated_old'],
  )
  assert.equal(res.capsules.length, 4)
  assert.deepEqual(res.promotedBags.map(b => b.id), ['promoted_1'])
  assert.deepEqual(res.archivedBags.map(b => b.id), ['archived_1'])
  assert.equal(res.counts.sponsored, 4)
  assert.equal(res.counts.topics, 2)
  assert.equal(res.counts.freeNotes, 1)

  // 袋内纸条置顶优先
  const spSoon = res.activeBags[0]
  assert.deepEqual(spSoon.notes.map(n => n.id), ['n_bag_2', 'n_bag_1'])
  assert.equal(spSoon.noteCount, 2)
})

test('summarizePrep 分离超过 30 天未动的自由纸条并在超过 12 条时折叠', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z')
  const makeNote = (id, daysAgo, extra = {}) => {
    const iso = new Date(now - daysAgo * DAY_MS).toISOString()
    return { id, text: `纸条 ${id}`, kind: 'text', bagId: null, createdAt: iso, updatedAt: iso, ...extra }
  }

  // 12 条沉淀纸条：不折叠
  const twelveOld = Array.from({ length: 12 }, (_, i) => makeNote(`old_${i}`, 31 + i))
  const fresh = [makeNote('fresh_1', 2), makeNote('fresh_edge', 30)]
  const res12 = summarizePrep({ bags: [], notes: [...fresh, ...twelveOld] }, { now })
  assert.equal(res12.freshFreeNotes.length, 2)
  assert.equal(res12.settledFreeNotes.length, 12)
  assert.equal(res12.collapseSettled, false)

  // 13 条沉淀纸条：触发折叠
  const thirteenOld = [...twelveOld, makeNote('old_12', 45)]
  const res13 = summarizePrep({ bags: [], notes: [...fresh, ...thirteenOld] }, { now })
  assert.equal(res13.settledFreeNotes.length, 13)
  assert.equal(res13.collapseSettled, true)
})

test('summarizePrep 支持 noteFilter 与 NFKC 搜索（袋标题、甲方名、纸条正文）', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z')
  const iso = '2026-11-25T08:00:00.000Z'
  const prep = {
    bags: [
      { id: 'b1', title: 'Ｃｕｒｓｏｒ 实战', type: 'sponsored', brief: { partner: 'CursorLabs' }, updatedAt: iso },
      { id: 'b2', title: '独立开发复盘', type: 'topic', updatedAt: iso },
    ],
    notes: [
      { id: 'n1', text: '看看这个链接 https://example.com/a', kind: 'link', link: { url: 'https://example.com/a', host: 'example.com' }, bagId: null, createdAt: iso, updatedAt: iso },
      { id: 'n2', text: '架构图', kind: 'image', image: { assetId: 'u1', ext: 'png', name: 'arch.png' }, bagId: null, createdAt: iso, updatedAt: iso },
      { id: 'n3', text: '纯文字随想', kind: 'text', bagId: null, createdAt: iso, updatedAt: iso },
    ],
  }

  const onlyLinks = summarizePrep(prep, { noteFilter: 'link', now })
  assert.deepEqual(onlyLinks.freshFreeNotes.map(n => n.id), ['n1'])

  const onlyImages = summarizePrep(prep, { noteFilter: 'image', now })
  assert.deepEqual(onlyImages.freshFreeNotes.map(n => n.id), ['n2'])

  const byPartner = summarizePrep(prep, { query: 'cursorlabs', now })
  assert.deepEqual(byPartner.activeBags.map(b => b.id), ['b1'])
  // capsules 仍保留全部活跃袋子供顶部速记投递
  assert.equal(byPartner.capsules.length, 2)

  const byTitleNfkc = summarizePrep(prep, { query: 'cursor 实战', now })
  assert.deepEqual(byTitleNfkc.activeBags.map(b => b.id), ['b1'])

  const byNoteText = summarizePrep(prep, { query: '架构图', now })
  assert.deepEqual(byNoteText.freshFreeNotes.map(n => n.id), ['n2'])
  assert.equal(byNoteText.activeBags.length, 0)
})

test('summarizePrep 兼容 null 或空输入', () => {
  const res = summarizePrep(null)
  assert.deepEqual(res.activeBags, [])
  assert.deepEqual(res.promotedBags, [])
  assert.deepEqual(res.archivedBags, [])
  assert.deepEqual(res.capsules, [])
  assert.deepEqual(res.freshFreeNotes, [])
  assert.deepEqual(res.settledFreeNotes, [])
  assert.equal(res.counts.freeNotes, 0)
})

test('formatDueCountdown 处理今天、+3 天、远期、已过期与 null', () => {
  const now = new Date(2026, 10, 25, 14, 30, 0) // 2026-11-25 本地时间

  assert.deepEqual(formatDueCountdown('2026-11-25', now), {
    label: '今天到期',
    urgent: true,
    overdue: false,
  })
  assert.deepEqual(formatDueCountdown('2026-11-28', now), {
    label: '剩 3 天',
    urgent: true,
    overdue: false,
  })
  assert.deepEqual(formatDueCountdown('2026-12-05', now), {
    label: '剩 10 天',
    urgent: false,
    overdue: false,
  })
  assert.deepEqual(formatDueCountdown('2026-11-24', now), {
    label: '已过目标日',
    urgent: true,
    overdue: true,
  })
  assert.deepEqual(formatDueCountdown(null, now), {
    label: '',
    urgent: false,
    overdue: false,
  })
  assert.deepEqual(formatDueCountdown('invalid-date', now), {
    label: '',
    urgent: false,
    overdue: false,
  })
})

test('isQuickCaptureShortcut 匹配 macOS ⌘J 与全平台 Alt+Shift+J，拒绝 Ctrl+J', () => {
  // macOS
  assert.equal(isQuickCaptureShortcut({ metaKey: true, key: 'j' }, 'MacIntel'), true)
  assert.equal(isQuickCaptureShortcut({ metaKey: true, key: 'J' }, 'MacIntel'), true)
  assert.equal(isQuickCaptureShortcut({ altKey: true, shiftKey: true, key: 'J' }, 'MacIntel'), true)
  assert.equal(isQuickCaptureShortcut({ altKey: true, shiftKey: true, key: 'Ô', code: 'KeyJ' }, 'MacIntel'), true)
  assert.equal(isQuickCaptureShortcut({ ctrlKey: true, key: 'j' }, 'MacIntel'), false)
  assert.equal(isQuickCaptureShortcut({ metaKey: true, shiftKey: true, key: 'j' }, 'MacIntel'), false)

  // Windows
  assert.equal(isQuickCaptureShortcut({ altKey: true, shiftKey: true, key: 'J' }, 'Win32'), true)
  assert.equal(isQuickCaptureShortcut({ altKey: true, shiftKey: true, key: 'j' }, 'Win32'), true)
  assert.equal(isQuickCaptureShortcut({ ctrlKey: true, key: 'j' }, 'Win32'), false)
  assert.equal(isQuickCaptureShortcut({ ctrlKey: true, shiftKey: true, key: 'j' }, 'Win32'), false)
  assert.equal(isQuickCaptureShortcut({ metaKey: true, key: 'j' }, 'Win32'), false)

  // Linux
  assert.equal(isQuickCaptureShortcut({ altKey: true, shiftKey: true, key: 'J' }, 'Linux x86_64'), true)
  assert.equal(isQuickCaptureShortcut({ ctrlKey: true, key: 'j' }, 'Linux x86_64'), false)
  assert.equal(isQuickCaptureShortcut({ metaKey: true, key: 'j' }, 'Linux x86_64'), false)

  // Composing / unrelated
  assert.equal(isQuickCaptureShortcut({ metaKey: true, key: 'j', isComposing: true }, 'MacIntel'), false)
  assert.equal(isQuickCaptureShortcut({ metaKey: true, key: 'k' }, 'MacIntel'), false)
})

test('isEditableTarget 正确识别输入框与 contenteditable 元素', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true)
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true)
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true)
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isEditableTarget({ tagName: 'DIV', getAttribute: attr => (attr === 'contenteditable' ? 'true' : null) }), true)
  assert.equal(isEditableTarget({ tagName: 'SPAN', closest: () => ({ tagName: 'DIV' }) }), true)
  assert.equal(isEditableTarget({ nodeType: 3, parentElement: { tagName: 'DIV', isContentEditable: true } }), true)
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: false }), false)
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isEditableTarget(null), false)
})

test('纸条写入刷新稿面和排期，旧的读取响应不会覆盖新快照', async t => {
  const { getState, loadPrep, prepAct, refresh } = await import('../client/state.js')
  const pending = []
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => {
    pending.push({ url, method: options?.method, respond: body => resolve(Response.json(body)) })
  }))
  const oldState = refresh()
  const oldPrep = loadPrep()
  const write = prepAct('prep/notes/update', { id: 'note-1', text: '新内容' })
  assert.deepEqual(pending.map(({ url, method }) => [url, method]), [
    ['wechat-studio/state', undefined],
    ['wechat-studio/prep', undefined],
    ['wechat-studio/prep/notes/update', 'PATCH'],
  ])

  const note = { id: 'note-1', text: '新内容' }
  pending[2].respond({ bags: [], notes: [note] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending[3].url, 'wechat-studio/state')
  const placeholder = { id: 'bag-1', noteCount: 1 }
  pending[3].respond({
    articles: [],
    current: null,
    currentSourceBag: { notes: [note] },
    prepPlaceholders: [placeholder],
  })
  await write

  pending[0].respond({ articles: [], current: null, prepPlaceholders: [] })
  pending[1].respond({ bags: [], notes: [] })
  await Promise.all([oldState, oldPrep])
  assert.deepEqual(getState().prep.notes, [note])
  assert.deepEqual(getState().data.currentSourceBag.notes, [note])
  assert.deepEqual(getState().data.prepPlaceholders, [placeholder])

  const remove = prepAct('prep/notes/delete', { id: note.id })
  const focus = loadPrep()
  pending[4].respond({ bags: [], notes: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending[6].url, 'wechat-studio/prep')
  pending[5].respond({ bags: [], notes: [note] })
  pending[6].respond({ bags: [], notes: [] })
  await focus
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending[7].url, 'wechat-studio/state')
  pending[7].respond({ articles: [], current: null, prepPlaceholders: [{ ...placeholder, noteCount: 0 }] })
  await remove
  assert.deepEqual(getState().prep.notes, [])
  assert.equal(getState().data.prepPlaceholders[0].noteCount, 0)
})

test('核心卖点在句末分段，保留文字、手工分段和存储上限', () => {
  const point = '围绕生产力展开，重点评估复杂任务的交付质量与可用性。'.repeat(3)
  const original = point.repeat(3)
  const formatted = formatSellingPoints(original)
  assert.ok(formatted.split('\n\n').length >= 2)
  assert.equal(formatted.replaceAll('\n', ''), original)
  assert.equal(formatSellingPoints(formatted), formatted)
  assert.equal(formatSellingPoints('短卖点。'), '短卖点。')
  const atLimit = original.padEnd(500, '字')
  assert.equal(formatSellingPoints(atLimit), atLimit)
})
