import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { detectImageFormat, MAX_LOCAL_IMAGE } from '../src/cloudinary.js'
import {
  PREP_EMPTY,
  PREP_LIMITS,
  addBag,
  addNote,
  batchNotes,
  buildPromotionMaterial,
  clusterFreeNotes,
  deleteBag,
  deleteNotes,
  detectNoteKind,
  extractBriefFromRaw,
  extractPrepAssetRefs,
  formatBriefMarkdown,
  isPrepAssetReferenced,
  normalizeBrief,
  normalizeTargetDate,
  readPrepAsset,
  removeOrphanPrepAssets,
  savePrepAsset,
  updateBag,
  updateNote,
} from '../src/prep.js'

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex')
const JPG = Buffer.from('ffd8ffe000104a464946', 'hex')
const GIF87 = Buffer.from('GIF87a0000', 'ascii')
const GIF89 = Buffer.from('GIF89a0000', 'ascii')
const WEBP = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'), Buffer.alloc(4)])

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-prep-test-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('detectImageFormat 识别有效 PNG/JPEG/GIF/WebP 并拒绝伪装或截断字节', () => {
  assert.deepEqual(detectImageFormat(PNG), { ext: 'png', mimeType: 'image/png' })
  assert.deepEqual(detectImageFormat(JPG), { ext: 'jpg', mimeType: 'image/jpeg' })
  assert.deepEqual(detectImageFormat(GIF87), { ext: 'gif', mimeType: 'image/gif' })
  assert.deepEqual(detectImageFormat(GIF89), { ext: 'gif', mimeType: 'image/gif' })
  assert.deepEqual(detectImageFormat(WEBP), { ext: 'webp', mimeType: 'image/webp' })

  assert.equal(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  assert.equal(detectImageFormat(Buffer.from('<!doctype html><html></html>')), null)
  assert.equal(detectImageFormat(Buffer.from('89504e47', 'hex')), null)
  assert.equal(detectImageFormat(Buffer.from('RIFF1234', 'ascii')), null)
  assert.equal(detectImageFormat(Buffer.alloc(0)), null)
  assert.equal(detectImageFormat(null), null)
})

test('savePrepAsset 校验大小和魔数，且 readPrepAsset 拦截路径穿越和非法标识', async () => {
  await withTempDir(async root => {
    const oversized = Buffer.concat([PNG, Buffer.alloc(MAX_LOCAL_IMAGE - PNG.length + 1)])
    await assert.rejects(
      savePrepAsset(root, oversized, 'huge.png'),
      err => err.status === 400,
    )
    await assert.rejects(
      savePrepAsset(root, Buffer.from('<svg></svg>'), 'fake.png'),
      err => err.status === 400,
    )
    await assert.rejects(readdir(join(root, 'prep-assets')), { code: 'ENOENT' })

    const saved = await savePrepAsset(root, PNG, 'shot.png')
    assert.match(saved.assetId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.equal(saved.ext, 'png')
    assert.equal(saved.mimeType, 'image/png')
    assert.equal(saved.bytes, PNG.length)
    assert.equal(saved.name, 'shot.png')

    const loaded = await readPrepAsset(root, saved.assetId, saved.ext)
    assert.deepEqual(loaded.buffer, PNG)
    assert.equal(loaded.mimeType, 'image/png')

    await assert.rejects(readPrepAsset(root, '../etc/passwd', 'png'), err => err.status === 400)
    await assert.rejects(readPrepAsset(root, 'not-a-uuid', 'png'), err => err.status === 400)
    await assert.rejects(readPrepAsset(root, saved.assetId, 'svg'), err => err.status === 400)
    await assert.rejects(
      readPrepAsset(root, '00000000-0000-4000-8000-000000000000', 'png'),
      err => err.status === 404,
    )
  })
})

test('extractPrepAssetRefs 与 isPrepAssetReferenced 支持三种路径和任意参数顺序，相对 URL 引用保护磁盘文件', async () => {
  const idA = '550e8400-e29b-41d4-a716-446655440000'
  const idB = '660e8400-e29b-41d4-a716-446655440001'
  const idC = '770e8400-e29b-41d4-a716-446655440002'

  const sample = [
    `![a](prep-assets/${idA}.png)`,
    `![b](/wechat-studio/prep/assets?id=${idB}&ext=jpg)`,
    `![c](wechat-studio/prep/assets?ext=webp&id=${idC})`,
  ].join('\n')

  const refs = extractPrepAssetRefs(sample)
  assert.equal(refs.length, 3)
  assert.deepEqual(
    refs.map(({ assetId, ext }) => ({ assetId, ext })),
    [
      { assetId: idA, ext: 'png' },
      { assetId: idB, ext: 'jpg' },
      { assetId: idC, ext: 'webp' },
    ],
  )

  for (const path of [
    `C:\\Users\\writer\\prep-assets\\${idA}.png`,
    `C:\\Users/writer/prep-assets\\${idA}.png`,
    `C:\\Users\\writer\\prep-assets/${idA}.png`,
  ]) {
    const text = `![Windows screenshot](${path})`
    const raw = path.slice(path.indexOf('prep-assets'))
    assert.deepEqual(extractPrepAssetRefs(text), [{ assetId: idA, ext: 'png', raw }])
    assert.equal(isPrepAssetReferenced(idA, PREP_EMPTY, [{ blocks: [{ text }] }]), true)
  }

  const stateWithNote = structuredClone(PREP_EMPTY)
  addNote(stateWithNote, {
    text: '截图',
    image: { assetId: idA, ext: 'png', mimeType: 'image/png', bytes: 12 },
  })
  assert.equal(isPrepAssetReferenced(idA, stateWithNote, []), true)
  assert.equal(isPrepAssetReferenced(idB, stateWithNote, []), false)

  const articles = [
    {
      id: 'a_1',
      blocks: [
        { id: 'b_1', text: `正文图 ![图1](prep-assets/${idA}.png)` },
        { id: 'b_2', text: '已编辑正文', prev: `正文图 ![图2](/wechat-studio/prep/assets?id=${idB}&ext=jpg)` },
      ],
      history: [{ blocks: [
        { id: 'b_3', text: `正文图 ![图3](wechat-studio/prep/assets?ext=webp&id=${idC})` },
      ] }],
    },
  ]
  assert.equal(isPrepAssetReferenced(idA, PREP_EMPTY, articles), true)
  assert.equal(isPrepAssetReferenced(idB, PREP_EMPTY, articles), true)
  assert.equal(isPrepAssetReferenced(idC, PREP_EMPTY, articles), true)

  await withTempDir(async root => {
    const state = structuredClone(PREP_EMPTY)
    const saved = await savePrepAsset(root, PNG, 'keep.png')
    const note = addNote(state, { text: '保留截图', image: saved })

    const refArticles = [
      {
        id: 'a_rel',
        blocks: [{ id: 'b_rel', text: `![相对地址](wechat-studio/prep/assets?ext=png&id=${saved.assetId})` }],
      },
    ]

    deleteNotes(state, [note.id])
    assert.equal(isPrepAssetReferenced(saved.assetId, state, refArticles), true)

    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await utimes(join(root, 'prep-assets', `${saved.assetId}.png`), oldTime, oldTime)

    await removeOrphanPrepAssets(root, state, refArticles)
    const fileStat = await stat(join(root, 'prep-assets', `${saved.assetId}.png`))
    assert.equal(fileStat.isFile(), true)
  })
})

test('removeOrphanPrepAssets 跳过文章引用与 24h 内文件，仅清理超时孤儿文件', async () => {
  await withTempDir(async root => {
    const now = Date.now()
    const referenced = await savePrepAsset(root, PNG, 'ref.png')
    const freshOrphan = await savePrepAsset(root, JPG, 'fresh.jpg')
    const staleOrphan = await savePrepAsset(root, WEBP, 'stale.webp')

    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000)
    await utimes(join(root, 'prep-assets', `${referenced.assetId}.png`), twoDaysAgo, twoDaysAgo)
    await utimes(join(root, 'prep-assets', `${staleOrphan.assetId}.webp`), twoDaysAgo, twoDaysAgo)

    const articles = [
      { id: 'a_1', blocks: [{ id: 'b_1', text: `![ref](prep-assets/${referenced.assetId}.png)` }] },
    ]

    const result = await removeOrphanPrepAssets(root, PREP_EMPTY, articles, { now })
    assert.deepEqual(result.removed, [`${staleOrphan.assetId}.webp`])

    const remaining = (await readdir(join(root, 'prep-assets'))).sort()
    assert.deepEqual(
      remaining,
      [`${referenced.assetId}.png`, `${freshOrphan.assetId}.jpg`].sort(),
    )
  })
})

test('addNote 自动识别 kind（image > link > text）并强制字数与数量上限', () => {
  assert.deepEqual(detectNoteKind('纯文字想法', null), { kind: 'text', link: null })
  assert.deepEqual(detectNoteKind('看看这篇 https://example.com/posts/1?ref=a', null), {
    kind: 'link',
    link: { url: 'https://example.com/posts/1?ref=a', host: 'example.com' },
  })
  assert.deepEqual(
    detectNoteKind('带链接的截图 https://example.com', { assetId: '550e8400-e29b-41d4-a716-446655440000', ext: 'png', mimeType: 'image/png', bytes: 10 }),
    { kind: 'image', link: null },
  )

  const state = structuredClone(PREP_EMPTY)
  const textNote = addNote(state, { text: '普通灵感' })
  assert.equal(textNote.kind, 'text')
  assert.equal(textNote.bagId, null)
  assert.equal(textNote.included, true)

  const linkNote = addNote(state, { text: '参考资料 https://openai.com/blog/test' })
  assert.equal(linkNote.kind, 'link')
  assert.equal(linkNote.link.host, 'openai.com')

  const imgNote = addNote(state, {
    text: 'https://openai.com/blog/test',
    image: { assetId: '550e8400-e29b-41d4-a716-446655440000', ext: 'png', mimeType: 'image/png', bytes: 10 },
  })
  assert.equal(imgNote.kind, 'image')
  assert.equal(imgNote.link, null)

  assert.throws(
    () => addNote(state, { text: 'a'.repeat(PREP_LIMITS.maxNoteText + 1) }),
    err => err.status === 400,
  )

  const fullState = {
    v: 1,
    bags: [],
    notes: Array.from({ length: PREP_LIMITS.maxNotes }, (_, i) => ({ id: `note_${i}`, bagId: null })),
  }
  assert.throws(() => addNote(fullState, { text: 'overflow' }), err => err.status === 400)

  const bagState = structuredClone(PREP_EMPTY)
  const bag = addBag(bagState, { title: '满袋测试' })
  for (let i = 0; i < PREP_LIMITS.maxNotesPerBag; i += 1) {
    bagState.notes.push({ id: `note_b_${i}`, bagId: bag.id })
  }
  assert.throws(() => addNote(bagState, { text: 'over bag cap', bagId: bag.id }), err => err.status === 400)
})

test('addBag / updateBag 强制限额、日期校验，且 sponsored 切回 topic 保留 brief', () => {
  assert.equal(normalizeTargetDate('2026-11-26'), '2026-11-26')
  assert.equal(normalizeTargetDate(''), null)
  assert.equal(normalizeTargetDate(null), null)
  assert.throws(() => normalizeTargetDate('2026-02-30'), err => err.status === 400)
  assert.throws(() => normalizeTargetDate('1999-12-31'), err => err.status === 400)
  assert.throws(() => normalizeTargetDate('2101-01-01'), err => err.status === 400)

  const state = structuredClone(PREP_EMPTY)
  assert.throws(() => addBag(state, { title: 'a'.repeat(121) }), err => err.status === 400)
  assert.throws(
    () => addBag(state, { title: 'ok', type: 'sponsored', brief: { mustInclude: Array.from({ length: 21 }, (_, i) => `item${i}`) } }),
    err => err.status === 400,
  )
  assert.throws(
    () => addBag(state, { title: 'ok', type: 'sponsored', brief: { taboo: ['x'.repeat(121)] } }),
    err => err.status === 400,
  )

  const bag = addBag(state, {
    title: 'Cursor 2.0 实战',
    type: 'sponsored',
    targetDate: '2026-11-26',
    brief: {
      partner: 'Cursor',
      sellingPoints: '多文件重构快',
      mustInclude: ['专属链接', '14天兑换码'],
      taboo: ['全网最强'],
    },
  })
  assert.equal(bag.type, 'sponsored')
  assert.equal(bag.brief.partner, 'Cursor')

  updateBag(state, bag.id, { type: 'topic' })
  assert.equal(bag.type, 'topic')
  assert.equal(bag.brief.partner, 'Cursor')
  assert.deepEqual(bag.brief.mustInclude, ['专属链接', '14天兑换码'])

  const fullBags = {
    v: 1,
    bags: Array.from({ length: PREP_LIMITS.maxBags }, (_, i) => ({ id: `bag_${i}` })),
    notes: [],
  }
  assert.throws(() => addBag(fullBags, { title: 'overflow' }), err => err.status === 400)
})

test('deleteBag 拒绝已成稿袋子（409），未成稿袋子默认退回自由纸条', () => {
  const state = structuredClone(PREP_EMPTY)
  const promotedBag = addBag(state, { title: '已成稿选题' })
  promotedBag.articleId = 'a_existing'
  assert.throws(() => deleteBag(state, promotedBag.id, { keepNotes: true }), err => err.status === 409)

  const activeBag = addBag(state, { title: '未成稿选题' })
  const note = addNote(state, { text: '核心角度', bagId: activeBag.id, pinned: true })
  assert.equal(note.bagId, activeBag.id)
  assert.equal(note.pinned, true)

  deleteBag(state, activeBag.id, { keepNotes: true })
  assert.equal(state.bags.some(b => b.id === activeBag.id), false)
  assert.equal(note.bagId, null)
  assert.equal(note.pinned, false)
})

test('batchNotes 与 updateNote 正确迁移纸条并处理 onlyLoose 跳过', () => {
  const state = structuredClone(PREP_EMPTY)
  const n1 = addNote(state, { text: '自由纸条 1' })
  const n2 = addNote(state, { text: '自由纸条 2' })
  const existing = addBag(state, { title: '已有袋' })
  updateNote(state, n2.id, { bagId: existing.id, pinned: true })
  assert.equal(n2.bagId, existing.id)
  assert.equal(n2.pinned, true)

  const res = batchNotes(state, { noteIds: [n1.id, n2.id, 'note_missing'], title: '合成新袋', onlyLoose: true })
  assert.equal(res.bag.title, '合成新袋')
  assert.deepEqual(res.movedIds, [n1.id])
  assert.deepEqual(res.skippedIds, [n2.id, 'note_missing'])
  assert.equal(n1.bagId, res.bag.id)
  assert.equal(n2.bagId, existing.id)
})

test('formatBriefMarkdown 与 buildPromotionMaterial 确定性输出：置顶在前、跳过 excluded、图片转写线索', () => {
  const bag = {
    id: 'bag_1',
    title: 'Cursor 2.0 实战',
    type: 'sponsored',
    targetDate: '2026-11-26',
    brief: normalizeBrief({
      partner: 'Cursor',
      sellingPoints: '多文件 Agent 重构',
      mustInclude: ['专属试用链接', '14天Pro兑换码'],
      taboo: ['全网最强'],
    }),
  }
  const notes = [
    {
      id: 'note_old',
      text: '普通想法 A',
      kind: 'text',
      bagId: 'bag_1',
      pinned: false,
      included: true,
      createdAt: '2026-11-20T10:00:00.000Z',
    },
    {
      id: 'note_excluded',
      text: '不带上的想法',
      kind: 'text',
      bagId: 'bag_1',
      pinned: true,
      included: false,
      createdAt: '2026-11-25T10:00:00.000Z',
    },
    {
      id: 'note_pin',
      text: '核心切入点：800 行旧表单翻车实录',
      kind: 'text',
      bagId: 'bag_1',
      pinned: true,
      included: true,
      createdAt: '2026-11-21T10:00:00.000Z',
    },
    {
      id: 'note_img',
      text: '',
      kind: 'image',
      image: { assetId: '550e8400-e29b-41d4-a716-446655440000', ext: 'png', mimeType: 'image/png', bytes: 100, name: 'refactor-diff.png' },
      bagId: 'bag_1',
      pinned: false,
      included: true,
      createdAt: '2026-11-22T10:00:00.000Z',
    },
  ]

  const md1 = formatBriefMarkdown(bag, notes, { root: '/tmp/ws' })
  const md2 = formatBriefMarkdown(bag, notes, { root: '/tmp/ws' })
  assert.equal(md1, md2)
  assert.match(md1, /# Cursor 2\.0 实战/)
  assert.match(md1, /\|\s*合作方\s*\|\s*Cursor\s*\|/)
  assert.match(md1, /专属试用链接/)
  assert.match(md1, /全网最强/)
  assert.equal(md1.includes('不带上的想法'), false)
  assert.ok(md1.indexOf('核心切入点') < md1.indexOf('普通想法 A'))
  assert.ok(md1.includes('/tmp/ws/prep-assets/550e8400-e29b-41d4-a716-446655440000.png'))

  const material = buildPromotionMaterial(bag, notes)
  assert.equal(material.includes('不带上的想法'), false)
  assert.ok(material.indexOf('核心切入点') < material.indexOf('普通想法 A'))
  assert.ok(material.includes('[截图：refactor-diff.png]'))
  assert.ok(material.includes('Cursor'))
})

function makeMockAiCtx(replyOrFn) {
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'mock', model: 'mock-1' }) }
      }
      if (name === 'llm') {
        return {
          async prepareCall(opts, signal) {
            return {
              config: {},
              async *stream(req) {
                calls.push({ opts, signal, req })
                const text = typeof replyOrFn === 'function' ? replyOrFn(req) : replyOrFn
                yield { type: 'text-delta', text }
                yield { type: 'finish', reason: { kind: 'stop' } }
              },
            }
          },
        }
      }
      return null
    },
  }
  return { ctx, calls }
}

test('extractBriefFromRaw 拒绝空输入或超长输入（400），清洗非法日期并按 PREP_LIMITS 截断输出', async () => {
  const { ctx: unusedCtx, calls: unusedCalls } = makeMockAiCtx('{}')
  await assert.rejects(() => extractBriefFromRaw(unusedCtx, ''), err => err.status === 400)
  await assert.rejects(() => extractBriefFromRaw(unusedCtx, '   \n\t  '), err => err.status === 400)
  await assert.rejects(() => extractBriefFromRaw(unusedCtx, null), err => err.status === 400)
  await assert.rejects(
    () => extractBriefFromRaw(unusedCtx, 'x'.repeat(PREP_LIMITS.maxRawText + 1)),
    err => err.status === 400,
  )
  assert.equal(unusedCalls.length, 0)

  for (const badDate of ['下周四', '1999-01-01', '2026-02-30', '2101-01-01', 20261126]) {
    const { ctx } = makeMockAiCtx(JSON.stringify({
      partner: 'Cursor',
      sellingPoints: '多文件重构',
      mustInclude: ['专属链接'],
      taboo: ['全网最强'],
      targetDate: badDate,
    }))
    const res = await extractBriefFromRaw(ctx, '甲方聊天记录：下周四前发稿')
    assert.equal(res.targetDate, null, `expected invalid targetDate ${String(badDate)} to be stripped to null`)
  }

  const oversizedPayload = {
    partner: `  ${'P'.repeat(PREP_LIMITS.maxPartner + 25)}  `,
    sellingPoints: 'S'.repeat(PREP_LIMITS.maxSellingPoints + 40),
    mustInclude: Array.from({ length: PREP_LIMITS.maxListItems + 5 }, (_, i) => `${i}_${'M'.repeat(PREP_LIMITS.maxListItemLength + 10)}`),
    taboo: Array.from({ length: PREP_LIMITS.maxListItems + 3 }, (_, i) => `${i}_${'T'.repeat(PREP_LIMITS.maxListItemLength + 15)}`),
    targetDate: '2026-11-26',
  }
  const { ctx: truncCtx, calls: truncCalls } = makeMockAiCtx(`\`\`\`json\n${JSON.stringify(oversizedPayload)}\n\`\`\``)
  const truncated = await extractBriefFromRaw(truncCtx, '甲方原文：11月26日上线')
  assert.equal(truncCalls.length, 1)
  assert.equal(truncated.partner.length, PREP_LIMITS.maxPartner)
  assert.equal(truncated.sellingPoints.length, PREP_LIMITS.maxSellingPoints)
  assert.equal(truncated.mustInclude.length, PREP_LIMITS.maxListItems)
  assert.ok(truncated.mustInclude.every(item => item.length === PREP_LIMITS.maxListItemLength))
  assert.equal(truncated.taboo.length, PREP_LIMITS.maxListItems)
  assert.ok(truncated.taboo.every(item => item.length === PREP_LIMITS.maxListItemLength))
  assert.equal(truncated.targetDate, '2026-11-26')
  assert.deepEqual(Object.keys(truncated).sort(), ['mustInclude', 'partner', 'sellingPoints', 'taboo', 'targetDate'])

  const { ctx: badJsonCtx } = makeMockAiCtx('这不是合法 JSON')
  await assert.rejects(() => extractBriefFromRaw(badJsonCtx, '甲方原文'), err => err.status === 502)
})

test('clusterFreeNotes 要求至少 5 条自由纸条，去重并过滤无效/已入袋 ID，丢弃 <2 条并上限 3 组', async () => {
  const fourFreePlusTwoInBag = [
    { id: 'n1', text: '自由1', kind: 'text', bagId: null },
    { id: 'n2', text: '自由2', kind: 'text', bagId: null },
    { id: 'n3', text: '自由3', kind: 'text', bagId: null },
    { id: 'n4', text: '自由4', kind: 'text', bagId: null },
    { id: 'n5', text: '袋内1', kind: 'text', bagId: 'bag_1' },
    { id: 'n6', text: '袋内2', kind: 'text', bagId: 'bag_1' },
  ]
  const { ctx: unusedCtx, calls: unusedCalls } = makeMockAiCtx('[]')
  await assert.rejects(() => clusterFreeNotes(unusedCtx, fourFreePlusTwoInBag), err => err.status === 400)
  assert.equal(unusedCalls.length, 0)

  const notes = [
    { id: 'n1', text: 'AI 编程提效实测', kind: 'text', bagId: null },
    { id: 'n2', text: 'Cursor 重构翻车记录', kind: 'text', bagId: null },
    { id: 'n3', text: 'MCP 协议生态盘点', kind: 'text', bagId: null },
    { id: 'n4', text: '本地 Agent 工作流搭建', kind: 'text', bagId: null },
    { id: 'n5', text: '长文排版与配图节奏', kind: 'text', bagId: null },
    { id: 'n6', text: '公众号标题点击率复盘', kind: 'text', bagId: null },
    { id: 'n7', text: '独立开发者冷启动经验', kind: 'text', bagId: null },
    { id: 'n8', text: '开源项目商业化路径', kind: 'text', bagId: null },
    { id: 'n_in_bag', text: '已在袋子里的笔记', kind: 'text', bagId: 'bag_existing' },
  ]

  const aiResponse = {
    clusters: [
      {
        // 去重后仅剩 1 条有效自由纸条（n_in_bag 已入袋、n_deleted 不存在），应被丢弃
        title: '无效单条聚类',
        angle: '应该被丢弃',
        noteIds: ['n1', 'n1', 'n_in_bag', 'n_deleted'],
      },
      {
        title: 'A'.repeat(PREP_LIMITS.maxBagTitle + 20),
        angle: '从翻车到提效的真实对比',
        noteIds: ['n1', 'n2', 'n2', 'n_in_bag', 'n_unknown'],
      },
      {
        title: 'Agent 与 MCP 工程实践',
        angle: '本地工作流落地指南',
        noteIds: ['n3', 'n4'],
      },
      {
        title: '公众号增长与内容节奏',
        angle: '标题与排版实操复盘',
        noteIds: ['n5', 'n6'],
      },
      {
        title: '第 4 组应被上限截断',
        angle: '超出 3 组上限',
        noteIds: ['n7', 'n8'],
      },
    ],
  }

  const { ctx, calls } = makeMockAiCtx(JSON.stringify(aiResponse))
  const clusters = await clusterFreeNotes(ctx, notes)
  assert.equal(calls.length, 1)
  assert.equal(clusters.length, 3)

  assert.equal(clusters[0].title.length, PREP_LIMITS.maxBagTitle)
  assert.equal(clusters[0].angle, '从翻车到提效的真实对比')
  assert.deepEqual(clusters[0].noteIds, ['n1', 'n2'])

  assert.deepEqual(clusters[1], {
    title: 'Agent 与 MCP 工程实践',
    angle: '本地工作流落地指南',
    noteIds: ['n3', 'n4'],
  })

  assert.deepEqual(clusters[2], {
    title: '公众号增长与内容节奏',
    angle: '标题与排版实操复盘',
    noteIds: ['n5', 'n6'],
  })
})

test('batchNotes 支持 action=create-bag 与 action=assign 的 onlyFree 写入复核并返回 movedIds/skippedIds', () => {
  const state = structuredClone(PREP_EMPTY)
  const n1 = addNote(state, { text: '仍自由 1' })
  const n2 = addNote(state, { text: '已归袋 2' })
  const n3 = addNote(state, { text: '仍自由 3' })
  const bagA = addBag(state, { title: '原袋 A' })
  const bagB = addBag(state, { title: '目标袋 B' })
  updateNote(state, n2.id, { bagId: bagA.id })

  // action: 'create-bag' + onlyFree: true
  const created = batchNotes(state, {
    action: 'create-bag',
    noteIds: [n1.id, n2.id, 'note_gone'],
    title: 'AI 聚拢新袋',
    onlyFree: true,
  })
  assert.equal(created.bag.title, 'AI 聚拢新袋')
  assert.deepEqual(created.movedIds, [n1.id])
  assert.deepEqual(created.skippedIds, [n2.id, 'note_gone'])
  assert.equal(n1.bagId, created.bag.id)
  assert.equal(n2.bagId, bagA.id)

  // action: 'assign' + onlyFree: true
  const assigned = batchNotes(state, {
    action: 'assign',
    bagId: bagB.id,
    noteIds: [n3.id, n2.id, 'note_missing'],
    onlyFree: true,
  })
  assert.equal(assigned.bag.id, bagB.id)
  assert.deepEqual(assigned.movedIds, [n3.id])
  assert.deepEqual(assigned.skippedIds, [n2.id, 'note_missing'])
  assert.equal(n3.bagId, bagB.id)
  assert.equal(n2.bagId, bagA.id)

  // 全部纸条均已被移动/删除时，create-bag + onlyFree 不应创建空袋
  const bagCountBefore = state.bags.length
  const emptyRes = batchNotes(state, {
    action: 'create-bag',
    noteIds: [n1.id, n2.id, 'note_missing'],
    title: '不应创建的空袋',
    onlyFree: true,
  })
  assert.equal(emptyRes.bag, null)
  assert.deepEqual(emptyRes.movedIds, [])
  assert.deepEqual(emptyRes.skippedIds, [n1.id, n2.id, 'note_missing'])
  assert.equal(state.bags.length, bagCountBefore)
})

test('拒绝更新时不保留纸条或选题袋的部分改动', () => {
  const state = structuredClone(PREP_EMPTY)
  const note = addNote(state, { text: '原纸条' })
  const bag = addBag(state, { title: '原创题' })
  assert.throws(() => updateNote(state, note.id, { text: '拒绝的新内容', bagId: 'missing' }), { status: 404 })
  assert.throws(() => updateBag(state, bag.id, { title: '拒绝的新标题', targetDate: 'invalid' }), { status: 400 })
  assert.equal(state.notes[0].text, '原纸条')
  assert.equal(state.bags[0].title, '原创题')
})
