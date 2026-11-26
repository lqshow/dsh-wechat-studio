import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createArticle, listMeta } from '../src/article.js'
import { duplicateArticle } from '../src/duplicate-article.js'
import {
  PREP_EMPTY,
  addBag,
  addNote,
  deleteBag,
  deriveLinkedArticleStatus,
  extractPrepAssetRefs,
  promoteBag,
  reconcilePrep,
  resetDeletedBagLink,
  resolveSponsoredBrief,
  savePrepAsset,
  transferPromotedArticleImages,
  updateBag,
} from '../src/prep.js'
import { atOn } from '../src/schedule-time.js'
import { JsonStore, Store } from '../src/store.js'

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex')
const FEISHU_URL = 'https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=promo123'
const CLOUDINARY = { cloudName: 'demo-cloud', apiKey: 'key-1', apiSecret: 'sec-1' }

async function withStores(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prep-promote-'))
  const store = new Store(root)
  const prepStore = new JsonStore(root, { file: 'prep.json', empty: PREP_EMPTY })
  try {
    return await fn({ root, store, prepStore })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('extractPrepAssetRefs 忽略 URL 尾部 #fragment 不污染 query 参数', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000'
  const refs = extractPrepAssetRefs(`![图](/wechat-studio/prep/assets?id=${id}&ext=png#top)`)
  assert.deepEqual(refs, [
    { assetId: id, ext: 'png', raw: `/wechat-studio/prep/assets?id=${id}&ext=png` },
  ])
})

test('createArticle 支持预设 id（校验 ID_PATTERN）、sourceBagId、sponsoredSnapshot，并在 listMeta 中透出 sourceBagId', () => {
  const snapshot = {
    partner: 'Cursor',
    sellingPoints: '多文件重构',
    mustInclude: ['试用链接'],
    taboo: ['全网最强'],
  }
  const article = createArticle({
    id: 'a_custom_123',
    topic: 'Cursor 实测',
    markdown: '# 标题\n\n正文段落。',
    sourceBagId: 'bag_001',
    sponsoredSnapshot: snapshot,
  })
  assert.equal(article.id, 'a_custom_123')
  assert.equal(article.sourceBagId, 'bag_001')
  assert.deepEqual(article.sponsoredSnapshot, snapshot)
  assert.equal(listMeta(article).sourceBagId, 'bag_001')

  const plain = createArticle({ topic: '普通稿' })
  assert.equal(listMeta(plain).sourceBagId, null)

  assert.throws(() => createArticle({ id: '../bad', topic: '非法' }), err => err.status === 400)
  assert.throws(() => createArticle({ id: '', topic: '空ID' }), err => err.status === 400)
})

test('promoteBag 支持 ai、blank、import 模式与多选自由纸条直建升格', async () => {
  await withStores(async ({ store, prepStore }) => {
    // 1. mode: 'ai'
    const aiBag = await prepStore.update(state => {
      const bag = addBag(state, {
        title: 'AI 起草商单',
        type: 'sponsored',
        targetDate: '2026-11-26',
        brief: {
          partner: 'Acme',
          sellingPoints: '省时 80%',
          mustInclude: ['兑换码 ACME2026'],
          taboo: ['第一'],
        },
      })
      addNote(state, { text: '核心切入：旧项目翻车复盘', bagId: bag.id, pinned: true })
      addNote(state, { text: '不带上的废话', bagId: bag.id, included: false })
      return bag
    })

    const aiRes = await promoteBag({ prepStore, store, bagId: aiBag.id, mode: 'ai' })
    assert.equal(aiRes.created, true)
    assert.equal(aiRes.bagId, aiBag.id)
    assert.equal(aiRes.mode, 'ai')
    assert.equal(aiRes.scheduledFor, atOn('2026-11-26', 20, 0))

    const afterAi = await store.read()
    const aiArticle = afterAi.articles.find(a => a.id === aiRes.articleId)
    assert.ok(aiArticle)
    assert.equal(aiArticle.sourceBagId, aiBag.id)
    assert.equal(aiArticle.topic, 'AI 起草商单')
    assert.equal(aiArticle.blocks.length, 0)
    assert.equal(aiArticle.scheduledFor, atOn('2026-11-26', 20, 0))
    assert.match(aiArticle.material, /Acme/)
    assert.match(aiArticle.material, /核心切入/)
    assert.equal(aiArticle.material.includes('不带上的废话'), false)
    assert.deepEqual(aiArticle.sponsoredSnapshot, {
      partner: 'Acme',
      sellingPoints: '省时 80%',
      mustInclude: ['兑换码 ACME2026'],
      taboo: ['第一'],
    })

    const prepAfterAi = await prepStore.read()
    const savedAiBag = prepAfterAi.bags.find(b => b.id === aiBag.id)
    assert.equal(savedAiBag.articleId, aiRes.articleId)
    assert.ok(savedAiBag.promotedAt)
    assert.equal(savedAiBag.pendingPromotion, null)

    // 2. mode: 'blank'
    const blankBag = await prepStore.update(state => addBag(state, { title: '空白手写选题' }))
    const blankRes = await promoteBag({ prepStore, store, bagId: blankBag.id, mode: 'blank' })
    assert.equal(blankRes.created, true)
    assert.equal(blankRes.mode, 'blank')
    assert.equal(blankRes.scheduledFor, null)
    const blankArticle = (await store.read()).articles.find(a => a.id === blankRes.articleId)
    assert.equal(blankArticle.blocks.length, 0)
    assert.equal(blankArticle.sourceBagId, blankBag.id)
    assert.equal(blankArticle.sponsoredSnapshot, undefined)

    // 3. mode: 'import'
    const importBag = await prepStore.update(state => addBag(state, { title: '站外回填选题' }))
    const assetUuid = '550e8400-e29b-41d4-a716-446655440000'
    const md = `# 站外成稿标题\n\n第一段正文。\n\n![飞书图](${FEISHU_URL})\n\n![本地截图](prep-assets/${assetUuid}.png)`
    const importRes = await promoteBag({ prepStore, store, bagId: importBag.id, mode: 'import', markdown: md })
    assert.equal(importRes.created, true)
    assert.equal(importRes.mode, 'import')
    assert.deepEqual(importRes.feishuUrls, [FEISHU_URL])
    assert.equal(importRes.prepAssetRefs.length, 1)
    assert.equal(importRes.prepAssetRefs[0].assetId, assetUuid)
    const importArticle = (await store.read()).articles.find(a => a.id === importRes.articleId)
    assert.equal(importArticle.title, '站外成稿标题')
    assert.equal(importArticle.blocks.length, 3)

    // 4. 多选自由纸条直接升格（自动建袋并把选中纸条移出自由池）
    const { n1, n2, nLoose } = await prepStore.update(state => ({
      n1: addNote(state, { text: '把多个零散想法串成一篇实战复盘' }),
      n2: addNote(state, { text: '附上真实踩坑数据对比' }),
      nLoose: addNote(state, { text: '留在自由池的纸条' }),
    }))
    const multiRes = await promoteBag({
      prepStore,
      store,
      noteIds: [n1.id, n2.id],
      title: '零散灵感合集',
      mode: 'ai',
    })
    assert.equal(multiRes.created, true)
    assert.ok(multiRes.bagId)
    const prepAfterMulti = await prepStore.read()
    const createdBag = prepAfterMulti.bags.find(b => b.id === multiRes.bagId)
    assert.equal(createdBag.title, '零散灵感合集')
    assert.equal(createdBag.articleId, multiRes.articleId)
    assert.equal(prepAfterMulti.notes.find(n => n.id === n1.id).bagId, multiRes.bagId)
    assert.equal(prepAfterMulti.notes.find(n => n.id === n2.id).bagId, multiRes.bagId)
    assert.equal(prepAfterMulti.notes.find(n => n.id === nLoose.id).bagId, null)
  })
})

test('promoteBag 校验无效 targetDate 并拒绝升格', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => {
      const b = addBag(state, { title: '坏日期袋' })
      b.targetDate = '2026-02-30'
      return b
    })
    await assert.rejects(
      promoteBag({ prepStore, store, bagId: bag.id, mode: 'blank' }),
      err => err.status === 400,
    )
    const prepState = await prepStore.read()
    assert.equal(prepState.bags[0].pendingPromotion, null)
    assert.equal((await store.read()).articles.length, 0)
  })
})

test('崩溃恢复 1：写完 pendingPromotion 后崩溃，reconcilePrep 清理超时占位，同 operationId 重试仅建 1 篇稿', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => addBag(state, { title: '崩溃场景一' }))
    const opId = 'op-crash-after-pending'

    await assert.rejects(
      promoteBag({
        prepStore,
        store,
        bagId: bag.id,
        mode: 'ai',
        operationId: opId,
        testHooks: {
          afterPending: () => {
            throw new Error('simulated crash after pendingPromotion')
          },
        },
      }),
      /simulated crash after pendingPromotion/,
    )

    const midPrep = await prepStore.read()
    assert.ok(midPrep.bags[0].pendingPromotion)
    assert.equal(midPrep.bags[0].articleId, null)
    assert.equal((await store.read()).articles.length, 0)

    // 未超时（<30s）时不清除
    const createdMs = Date.parse(midPrep.bags[0].pendingPromotion.createdAt)
    const earlyRec = await reconcilePrep(prepStore, store, { staleMs: 30_000, now: createdMs + 10_000 })
    assert.deepEqual(earlyRec, { completed: 0, cleared: 0, relinked: 0 })
    assert.ok((await prepStore.read()).bags[0].pendingPromotion)

    // 超时（>30s）后清理 pendingPromotion
    const staleRec = await reconcilePrep(prepStore, store, { staleMs: 30_000, now: createdMs + 31_000 })
    assert.deepEqual(staleRec, { completed: 0, cleared: 1, relinked: 0 })
    assert.equal((await prepStore.read()).bags[0].pendingPromotion, null)

    // 使用同一 operationId 重试，成功创建恰好 1 篇文章
    const retried = await promoteBag({ prepStore, store, bagId: bag.id, mode: 'ai', operationId: opId })
    assert.equal(retried.created, true)
    const articles = (await store.read()).articles
    assert.equal(articles.length, 1)
    assert.equal(articles[0].id, retried.articleId)
    assert.equal((await prepStore.read()).bags[0].articleId, retried.articleId)
  })
})

test('崩溃恢复 2：建稿成功但写回袋子前崩溃，reconcilePrep 自动绑定，同 operationId 重试幂等返回且不重复建稿', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => addBag(state, { title: '崩溃场景二' }))
    const opId = 'op-crash-after-article'

    await assert.rejects(
      promoteBag({
        prepStore,
        store,
        bagId: bag.id,
        mode: 'blank',
        operationId: opId,
        testHooks: {
          afterArticleCreate: () => {
            throw new Error('simulated crash before finalize')
          },
        },
      }),
      /simulated crash before finalize/,
    )

    const articlesAfterCrash = (await store.read()).articles
    assert.equal(articlesAfterCrash.length, 1)
    const expectedArticleId = articlesAfterCrash[0].id
    assert.equal((await prepStore.read()).bags[0].articleId, null)
    assert.equal((await prepStore.read()).bags[0].pendingPromotion.articleId, expectedArticleId)

    // reconcilePrep 自动完成第 3 步绑定
    const rec = await reconcilePrep(prepStore, store)
    assert.deepEqual(rec, { completed: 1, cleared: 0, relinked: 0 })
    const prepAfterRec = await prepStore.read()
    assert.equal(prepAfterRec.bags[0].articleId, expectedArticleId)
    assert.equal(prepAfterRec.bags[0].pendingPromotion, null)

    // 同 operationId + 相同参数重试：幂等返回已有文章且 created: false
    const retry = await promoteBag({ prepStore, store, bagId: bag.id, mode: 'blank', operationId: opId })
    assert.equal(retry.articleId, expectedArticleId)
    assert.equal(retry.created, false)
    assert.equal((await store.read()).articles.length, 1)
  })
})

test('慢写竞态：pendingPromotion 超时被清理后，慢请求落地 + 并发/后续重试仍严格只产生 1 篇文章', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => addBag(state, { title: '慢写竞态袋' }))

    let releaseSlowWriter
    const slowPaused = new Promise(resolve => { releaseSlowWriter = resolve })
    let notifyReachedHook
    const reachedHook = new Promise(resolve => { notifyReachedHook = resolve })

    const slowPromise = promoteBag({
      prepStore,
      store,
      bagId: bag.id,
      mode: 'ai',
      operationId: 'op-slow-1',
      testHooks: {
        afterPending: async () => {
          notifyReachedHook()
          await slowPaused
        },
      },
    })

    await reachedHook

    // 模拟 31 秒后对账把超时 pendingPromotion 清掉
    const createdMs = Date.parse((await prepStore.read()).bags[0].pendingPromotion.createdAt)
    const rec1 = await reconcilePrep(prepStore, store, { staleMs: 30_000, now: createdMs + 31_000 })
    assert.equal(rec1.cleared, 1)

    // 放行慢请求，同时发起一个新重试
    const blank = { prepStore, store, bagId: bag.id, mode: 'blank', operationId: 'op-retry-2' }
    const slowRejected = assert.rejects(slowPromise, { status: 409 })
    const winner = await promoteBag({
      ...blank,
      testHooks: {
        afterArticleCreate: async () => {
          releaseSlowWriter()
          await slowRejected
        },
      },
    })

    await reconcilePrep(prepStore, store)
    const articles = (await store.read()).articles
    assert.equal(articles.length, 1)
    assert.equal(articles[0].sourceBagId, bag.id)
    const finalBag = (await prepStore.read()).bags[0]
    assert.equal(finalBag.articleId, articles[0].id)
    assert.equal(finalBag.pendingPromotion, null)
    assert.equal(winner.articleId, articles[0].id)
    assert.equal(finalBag.lastPromotionOp.operationId, blank.operationId)
    const retry = await promoteBag(blank)
    assert.equal(retry.articleId, winner.articleId)
    assert.equal(retry.mode, 'blank')
    assert.equal(retry.created, false)
  })
})

test('超时后被删除的选题袋不会被仍在运行的升格请求重新关联', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => addBag(state, { title: '已删除选题袋' }))
    await assert.rejects(promoteBag({
      prepStore,
      store,
      bagId: bag.id,
      mode: 'blank',
      testHooks: {
        afterPending: async () => {
          const { pendingPromotion } = (await prepStore.read()).bags[0]
          await reconcilePrep(prepStore, store, { now: Date.parse(pendingPromotion.createdAt) + 31_000 })
          await prepStore.update(state => deleteBag(state, bag.id))
        },
      },
    }), { status: 409 })
    assert.equal((await prepStore.read()).bags.length, 0)
    assert.equal((await store.read()).articles.length, 0)
  })
})

test('reconcilePrep 支持无 pendingPromotion 时通过 article.sourceBagId 自动回绑', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => addBag(state, { title: '孤儿回绑袋' }))
    const orphanArticle = createArticle({ topic: bag.title, sourceBagId: bag.id })
    await store.update(state => { state.articles.push(orphanArticle) })

    const rec = await reconcilePrep(prepStore, store)
    assert.deepEqual(rec, { completed: 0, cleared: 0, relinked: 1 })
    const saved = (await prepStore.read()).bags[0]
    assert.equal(saved.articleId, orphanArticle.id)
    assert.ok(saved.promotedAt)
  })
})

test('同 operationId 载荷不一致抛 409；已成稿袋用新 operationId 抛 409', async () => {
  await withStores(async ({ store, prepStore }) => {
    const { bag1, bag2 } = await prepStore.update(state => ({
      bag1: addBag(state, { title: '袋子一' }),
      bag2: addBag(state, { title: '袋子二' }),
    }))

    const opId = 'op-shared-key'
    const first = await promoteBag({
      prepStore,
      store,
      bagId: bag1.id,
      mode: 'import',
      markdown: '# 正文 A\n\n第一版。',
      operationId: opId,
    })
    assert.equal(first.created, true)

    // 同 opId 不同 bagId -> 409
    await assert.rejects(
      promoteBag({ prepStore, store, bagId: bag2.id, mode: 'import', markdown: '# 正文 A\n\n第一版。', operationId: opId }),
      err => err.status === 409,
    )
    // 同 opId 不同 mode -> 409
    await assert.rejects(
      promoteBag({ prepStore, store, bagId: bag1.id, mode: 'blank', operationId: opId }),
      err => err.status === 409,
    )
    // 同 opId 不同 markdown -> 409
    await assert.rejects(
      promoteBag({ prepStore, store, bagId: bag1.id, mode: 'import', markdown: '# 正文 B\n\n篡改版。', operationId: opId }),
      err => err.status === 409,
    )
    // 已成稿袋换不同 operationId -> 409
    await assert.rejects(
      promoteBag({ prepStore, store, bagId: bag1.id, mode: 'import', markdown: '# 正文 A\n\n第一版。', operationId: 'op-different' }),
      err => err.status === 409,
    )
    assert.equal((await store.read()).articles.length, 1)
  })
})

test('duplicateArticle 清除 sourceBagId 并支持写入最新 sponsoredSnapshot', async () => {
  await withStores(async ({ root }) => {
    const source = createArticle({
      topic: '原商单稿',
      markdown: '# 原商单\n\n第一段。',
      sourceBagId: 'bag_sponsored_1',
      sponsoredSnapshot: {
        partner: 'OldPartner',
        sellingPoints: '旧卖点',
        mustInclude: ['旧链接'],
        taboo: ['旧禁忌'],
      },
    })

    const latestBrief = {
      partner: 'NewPartner',
      sellingPoints: '最新卖点',
      mustInclude: ['最新链接'],
      taboo: ['最新禁忌'],
    }
    const { article: copy } = await duplicateArticle(root, source, { sponsoredSnapshot: latestBrief })
    assert.equal(copy.sourceBagId, undefined)
    assert.deepEqual(copy.sponsoredSnapshot, latestBrief)
    assert.equal(source.sourceBagId, 'bag_sponsored_1')

    // 传入 null 时清除副本的 sponsoredSnapshot
    const { article: cleared } = await duplicateArticle(root, source, { sponsoredSnapshot: null })
    assert.equal(cleared.sourceBagId, undefined)
    assert.equal(cleared.sponsoredSnapshot, undefined)
  })
})

test('resolveSponsoredBrief 精确实现 3 分支语义（含归档商单袋、商单切回普通、缺袋兜底）', () => {
  const prepState = structuredClone(PREP_EMPTY)
  const sponsoredBag = addBag(prepState, {
    title: '商单袋',
    type: 'sponsored',
    brief: {
      partner: 'Cursor',
      sellingPoints: '最新核心卖点',
      mustInclude: ['最新链接'],
      taboo: ['全网最强'],
      rawText: '原始聊天记录不应透出到 snapshot',
    },
  })
  updateBag(prepState, sponsoredBag.id, { archived: true })

  const toggledBag = addBag(prepState, {
    title: '切回普通选题的袋',
    type: 'sponsored',
    brief: { partner: 'BrandX', sellingPoints: '卖点', mustInclude: ['口令'], taboo: ['禁忌'] },
  })
  updateBag(prepState, toggledBag.id, { type: 'topic' })

  // 分支 1：原袋存在且 type === 'sponsored'（即使已归档）→ 返回实时 bag.brief
  const a1 = createArticle({
    topic: 'a1',
    sourceBagId: sponsoredBag.id,
    sponsoredSnapshot: { partner: 'Stale', sellingPoints: '旧', mustInclude: [], taboo: [] },
  })
  assert.deepEqual(resolveSponsoredBrief(a1, prepState), {
    partner: 'Cursor',
    sellingPoints: '最新核心卖点',
    mustInclude: ['最新链接'],
    taboo: ['全网最强'],
  })

  // 分支 2：原袋存在但已切回 type === 'topic' → 返回 null（停止商单体检）
  const a2 = createArticle({
    topic: 'a2',
    sourceBagId: toggledBag.id,
    sponsoredSnapshot: { partner: 'BrandX', sellingPoints: '旧', mustInclude: ['口令'], taboo: ['禁忌'] },
  })
  assert.equal(resolveSponsoredBrief(a2, prepState), null)

  // 分支 3a：原袋缺失 → 兜底 article.sponsoredSnapshot
  const a3 = createArticle({
    topic: 'a3',
    sourceBagId: 'bag_missing',
    sponsoredSnapshot: { partner: 'Fallback', sellingPoints: '兜底', mustInclude: ['A'], taboo: ['B'] },
  })
  assert.deepEqual(resolveSponsoredBrief(a3, prepState), {
    partner: 'Fallback',
    sellingPoints: '兜底',
    mustInclude: ['A'],
    taboo: ['B'],
  })

  // 分支 3b：副本文章无 sourceBagId → 使用自身 sponsoredSnapshot；无 snapshot 返回 null
  const a4 = createArticle({
    topic: 'a4',
    sponsoredSnapshot: { partner: 'CopyBrand', sellingPoints: '副本卖点', mustInclude: [], taboo: ['禁止词'] },
  })
  assert.deepEqual(resolveSponsoredBrief(a4, prepState), {
    partner: 'CopyBrand',
    sellingPoints: '副本卖点',
    mustInclude: [],
    taboo: ['禁止词'],
  })
  assert.equal(resolveSponsoredBrief(createArticle({ topic: 'plain' }), prepState), null)
})

test('deriveLinkedArticleStatus 识别 active / archived / deleted；resetDeletedBagLink 支持显式重置后重新升格', async () => {
  await withStores(async ({ store, prepStore }) => {
    const bag = await prepStore.update(state => addBag(state, { title: '生命周期测试袋' }))
    assert.deepEqual(deriveLinkedArticleStatus(bag, []), { status: null, article: null })

    const res = await promoteBag({ prepStore, store, bagId: bag.id, mode: 'blank' })
    let prepState = await prepStore.read()
    let storeState = await store.read()
    assert.equal(deriveLinkedArticleStatus(prepState.bags[0], storeState.articles).status, 'active')

    // 归档原稿
    await store.update(state => {
      state.articles[0].archivedAt = new Date().toISOString()
    })
    storeState = await store.read()
    const archivedInfo = deriveLinkedArticleStatus(prepState.bags[0], storeState.articles)
    assert.equal(archivedInfo.status, 'archived')
    assert.equal(archivedInfo.article.id, res.articleId)

    // 删除原稿：袋子不会静默退回活跃，状态为 deleted
    await store.update(state => {
      state.articles = []
      state.currentId = null
    })
    storeState = await store.read()
    assert.deepEqual(deriveLinkedArticleStatus(prepState.bags[0], storeState.articles), { status: 'deleted', article: null })

    // 未显式重置前直接再次升格被 409 拒绝
    await assert.rejects(
      promoteBag({ prepStore, store, bagId: bag.id, mode: 'blank' }),
      err => err.status === 409,
    )

    // 显式调用 resetDeletedBagLink 后可重新升格
    await prepStore.update(state => resetDeletedBagLink(state, bag.id))
    prepState = await prepStore.read()
    assert.equal(prepState.bags[0].articleId, null)
    assert.equal(prepState.bags[0].promotedAt, null)

    const rePromoted = await promoteBag({ prepStore, store, bagId: bag.id, mode: 'blank' })
    assert.equal(rePromoted.created, true)
    assert.notEqual(rePromoted.articleId, res.articleId)
  })
})

test('transferPromotedArticleImages 配置图床时转存飞书与本地 prep-assets 并缓存 cloudinaryUrl；复用缓存不重传', async () => {
  await withStores(async ({ root, store, prepStore }) => {
    const saved = await savePrepAsset(root, PNG, 'demo.png')
    const { bag, note } = await prepStore.update(state => {
      const b = addBag(state, { title: '带图导入袋' })
      const n = addNote(state, { text: '界面截图', image: saved, bagId: b.id })
      return { bag: b, note: n }
    })

    const md = [
      '# 带图文章',
      '',
      `![飞书图](${FEISHU_URL})`,
      '',
      `![本地图](prep-assets/${saved.assetId}.${saved.ext})`,
      '',
      `![接口图](/wechat-studio/prep/assets?id=${saved.assetId}&ext=${saved.ext}#top)`,
    ].join('\n')

    const promoted = await promoteBag({ prepStore, store, bagId: bag.id, mode: 'import', markdown: md })
    let uploadCalls = 0
    const mockFetch = async () => {
      uploadCalls += 1
      return new Response(
        JSON.stringify({ secure_url: `https://res.cloudinary.com/demo-cloud/image/upload/v1/img-${uploadCalls}.png` }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const result = await transferPromotedArticleImages({
      store,
      prepStore,
      articleId: promoted.articleId,
      feishuUrls: promoted.feishuUrls,
      prepAssetRefs: promoted.prepAssetRefs,
      settings: { cloudinary: CLOUDINARY },
      fetchImpl: mockFetch,
    })

    assert.equal(result.uploaded, 2)
    assert.equal(result.failed, 0)
    assert.deepEqual(result.warnings, [])
    assert.equal(uploadCalls, 2) // 同一 assetId 出现两次仅上传一次 + 飞书图 1 次

    const article = (await store.read()).articles.find(a => a.id === promoted.articleId)
    assert.equal(article.imageImport, null)
    const bodyText = article.blocks.map(b => b.text).join('\n')
    assert.equal(bodyText.includes('feishu.cn'), false)
    assert.equal(bodyText.includes('prep-assets/'), false)
    assert.equal(bodyText.includes('wechat-studio/prep/assets'), false)
    assert.match(bodyText, /https:\/\/res\.cloudinary\.com\/demo-cloud\/image\/upload\/v1\/img-/)

    // cloudinaryUrl 已缓存回 prep note
    const cachedNote = (await prepStore.read()).notes.find(n => n.id === note.id)
    assert.match(cachedNote.image.cloudinaryUrl, /^https:\/\/res\.cloudinary\.com\//)

    // 第二篇文章引用同一资产时直接复用缓存，不触发新上传
    const bag2 = await prepStore.update(state => addBag(state, { title: '复用缓存袋' }))
    const p2 = await promoteBag({
      prepStore,
      store,
      bagId: bag2.id,
      mode: 'import',
      markdown: `# 二次导入\n\n![复用图](prep-assets/${saved.assetId}.${saved.ext})`,
    })
    let secondCalls = 0
    const r2 = await transferPromotedArticleImages({
      store,
      prepStore,
      articleId: p2.articleId,
      feishuUrls: p2.feishuUrls,
      prepAssetRefs: p2.prepAssetRefs,
      settings: { cloudinary: CLOUDINARY },
      fetchImpl: async () => {
        secondCalls += 1
        throw new Error('should not upload cached asset')
      },
    })
    assert.equal(secondCalls, 0)
    assert.equal(r2.failed, 0)
    assert.deepEqual(r2.warnings, [])
    const a2 = (await store.read()).articles.find(a => a.id === p2.articleId)
    assert.ok(a2.blocks[0].text.includes(cachedNote.image.cloudinaryUrl))
  })
})

test('transferPromotedArticleImages 未配置图床或上传失败时保留本地路径并返回明确 warnings，不删图不重造文章', async () => {
  await withStores(async ({ root, store, prepStore }) => {
    const saved = await savePrepAsset(root, PNG, 'offline.png')
    const bag = await prepStore.update(state => addBag(state, { title: '离线与失败测试袋' }))
    const localRef = `prep-assets/${saved.assetId}.${saved.ext}`
    const md = `# 离线成稿\n\n![飞书图](${FEISHU_URL})\n\n![本地图](${localRef})`

    const promoted = await promoteBag({ prepStore, store, bagId: bag.id, mode: 'import', markdown: md })

    // 1. 未配置 Cloudinary
    const unconfigured = await transferPromotedArticleImages({
      store,
      prepStore,
      articleId: promoted.articleId,
      feishuUrls: promoted.feishuUrls,
      prepAssetRefs: promoted.prepAssetRefs,
      settings: { cloudinary: { cloudName: '', apiKey: '', apiSecret: '' } },
    })
    assert.equal(unconfigured.uploaded, 0)
    assert.equal(unconfigured.failed, 0)
    assert.ok(unconfigured.warnings.length >= 1)
    assert.equal((await store.read()).articles.length, 1)
    const bodyAfterOffline = (await store.read()).articles[0].blocks.map(b => b.text).join('\n')
    assert.ok(bodyAfterOffline.includes(localRef))
    assert.ok(bodyAfterOffline.includes(FEISHU_URL))

    // 2. 上传全部失败（HTTP 500）
    const failedRes = await transferPromotedArticleImages({
      store,
      prepStore,
      articleId: promoted.articleId,
      feishuUrls: promoted.feishuUrls,
      prepAssetRefs: promoted.prepAssetRefs,
      settings: { cloudinary: CLOUDINARY },
      fetchImpl: async () => new Response('boom', { status: 500 }),
    })
    assert.equal(failedRes.uploaded, 0)
    assert.equal(failedRes.failed, 2)
    assert.ok(failedRes.warnings.length >= 2)
    assert.equal((await store.read()).articles.length, 1)
    const bodyAfterFail = (await store.read()).articles[0].blocks.map(b => b.text).join('\n')
    assert.ok(bodyAfterFail.includes(localRef))
    assert.ok(bodyAfterFail.includes(FEISHU_URL))
  })
})

test('多选自由纸条直建崩溃后用同 operationId 重试不重复建袋，且支持显式 scheduleTime 与绝对路径 prep-assets 转存', async () => {
  await withStores(async ({ root, store, prepStore }) => {
    const saved = await savePrepAsset(root, PNG, 'abs.png')
    const { n1, n2 } = await prepStore.update(state => ({
      n1: addNote(state, { text: '第一条自由纸条灵感' }),
      n2: addNote(state, { text: '第二条自由纸条灵感' }),
    }))

    const opId = 'op-multi-crash-retry'
    const customSchedule = '2026-12-01T12:00:00.000Z'

    // 无效 scheduleTime 应被 400 拒绝且不建袋
    await assert.rejects(
      promoteBag({ prepStore, store, noteIds: [n1.id], mode: 'blank', scheduleTime: 'not-a-date' }),
      err => err.status === 400,
    )
    assert.equal((await prepStore.read()).bags.length, 0)

    // 首次多选升格在 pendingPromotion 后崩溃
    await assert.rejects(
      promoteBag({
        prepStore,
        store,
        noteIds: [n1.id, n2.id],
        mode: 'ai',
        operationId: opId,
        scheduleTime: customSchedule,
        testHooks: {
          afterPending: () => {
            throw new Error('multi crash after pending')
          },
        },
      }),
      /multi crash after pending/,
    )
    assert.equal((await prepStore.read()).bags.length, 1)
    assert.equal((await store.read()).articles.length, 0)

    const pending = (await prepStore.read()).bags[0].pendingPromotion
    const expired = await reconcilePrep(prepStore, store, { now: Date.parse(pending.createdAt) + 31_000 })
    assert.equal(expired.cleared, 1)

    // 超时后仍以同一 operationId 复用原袋和预占文章。
    const retried = await promoteBag({
      prepStore,
      store,
      noteIds: [n1.id, n2.id],
      mode: 'ai',
      operationId: opId,
      scheduleTime: customSchedule,
    })
    assert.equal(retried.created, true)
    assert.equal(retried.scheduledFor, customSchedule)
    assert.equal((await prepStore.read()).bags.length, 1)
    assert.equal((await store.read()).articles.length, 1)

    // 绝对路径的本地 prep-assets 引用也可被正确转存替换
    const absBag = await prepStore.update(state => addBag(state, { title: '绝对路径图袋' }))
    const absPath = join(root, 'prep-assets', `${saved.assetId}.${saved.ext}`)
    const paths = [
      absPath,
      `C:\\Users\\writer\\prep-assets\\${saved.assetId}.png`,
      `C:\\Users\\writer/prep-assets/${saved.assetId}.png`,
    ]
    const images = paths.map(path => `![绝对路径图](${path})`).join('\n\n')
    const absPromoted = await promoteBag({
      prepStore,
      store,
      bagId: absBag.id,
      mode: 'import',
      markdown: `# 绝对路径测试\n\n${images}`,
    })
    assert.equal(absPromoted.prepAssetRefs.length, 2)
    const transferRes = await transferPromotedArticleImages({
      store,
      prepStore,
      articleId: absPromoted.articleId,
      feishuUrls: absPromoted.feishuUrls,
      prepAssetRefs: absPromoted.prepAssetRefs,
      settings: { cloudinary: CLOUDINARY },
      fetchImpl: async () => new Response(
        JSON.stringify({ secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/abs.png' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    })
    assert.equal(transferRes.uploaded, 1)
    assert.equal(transferRes.failed, 0)
    const absArticle = (await store.read()).articles.find(a => a.id === absPromoted.articleId)
    assert.deepEqual(absArticle.blocks.map(block => block.text), paths.map(() =>
      '![绝对路径图](https://res.cloudinary.com/demo-cloud/image/upload/v1/abs.png)',
    ))
  })
})
