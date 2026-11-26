import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createArticle } from '../src/article.js'
import { createHandler, route } from '../src/host.js'
import { PREP_EMPTY } from '../src/prep.js'
import { updateSettings } from '../src/settings.js'
import { JsonStore, Store } from '../src/store.js'

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)

const CLOUDINARY_CONFIG = { cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' }

function makeLlmContext(responder) {
  const llm = {
    prepareCall: async () => ({
      config: {},
      async *stream({ messages }) {
        const text = messages[0]?.content?.[0]?.text ?? ''
        const task = messages[0]?.source?.task ?? ''
        yield { type: 'text-delta', text: responder({ task, text }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  const services = {
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
  }
  return { get: name => services[name] ?? null }
}

function setup(t, { fetchImpl, ctx, pipeline } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ws-prep-host-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new Store(root)
  const prepStore = new JsonStore(root, { file: 'prep.json', empty: PREP_EMPTY })
  const draftCalls = []
  const titleCalls = []
  const activeJobs = new Map()
  const mockPipeline = pipeline ?? {
    job: id => activeJobs.get(id) ?? null,
    draft: id => { draftCalls.push(id) },
    titles: id => { titleCalls.push(id) },
  }
  const deps = {
    ctx: ctx ?? { get: () => null },
    store,
    prepStore,
    pipeline: mockPipeline,
    fetchImpl,
  }

  async function request(path, { method, body, rawBody, headers = {} } = {}) {
    const reqMethod = method ?? (body !== undefined || rawBody !== undefined ? 'POST' : 'GET')
    const req = {
      url: `/wechat-studio/${path}`,
      method: reqMethod,
      headers,
      async *[Symbol.asyncIterator]() {
        if (rawBody !== undefined) yield rawBody
        else if (body !== undefined) yield Buffer.from(JSON.stringify(body))
      },
    }
    let ended
    const res = {
      statusCode: 200,
      headers: {},
      headersSent: false,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value },
      end(value) {
        this.headersSent = true
        const ct = this.headers['content-type'] ?? ''
        if (ct.startsWith('application/json')) ended = JSON.parse(String(value ?? 'null'))
        else ended = value
      },
    }
    try {
      await route(deps, req, res)
    } catch (err) {
      res.statusCode = err.status || 500
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: err.message, ...(err.code ? { code: err.code } : {}) }))
    }
    return { status: res.statusCode, headers: res.headers, body: ended }
  }

  return { root, store, prepStore, deps, request, draftCalls, titleCalls, activeJobs }
}

test('prep note & bag CRUD, PATCH updates, brief-markdown, and enriched linkedArticleStatus lifecycle', async t => {
  const { request } = setup(t)

  const bagRes = await request('prep/bags', {
    body: {
      title: 'Cursor 2.0 深度测评',
      type: 'sponsored',
      targetDate: '2026-11-28',
      brief: {
        partner: 'Cursor',
        sellingPoints: '多文件重构快',
        mustInclude: ['14天Pro兑换码'],
        taboo: ['全网最强'],
      },
    },
  })
  assert.equal(bagRes.status, 200)
  const bagId = bagRes.body.bag.id
  assert.equal(bagRes.body.bags.length, 1)

  const n1 = await request('prep/notes', { body: { text: '看官方文档 https://cursor.com/blog/v2' } })
  assert.equal(n1.status, 200)
  assert.equal(n1.body.note.kind, 'link')
  assert.equal(n1.body.note.link.host, 'cursor.com')

  const n2 = await request('prep/notes', { body: { text: '开篇先讲真实翻车经历', bagId, pinned: true } })
  assert.equal(n2.status, 200)
  assert.equal(n2.body.note.bagId, bagId)
  assert.equal(n2.body.note.pinned, true)

  const updatedNote = await request('prep/notes/update', {
    method: 'PATCH',
    body: { id: n1.body.note.id, text: '更新后的灵感 https://cursor.com/docs', included: false },
  })
  assert.equal(updatedNote.status, 200)
  assert.equal(updatedNote.body.note.included, false)
  assert.equal(updatedNote.body.note.link.url, 'https://cursor.com/docs')

  const n3 = await request('prep/notes', { body: { text: '第三条自由灵感' } })
  const batchRes = await request('prep/notes/batch', {
    body: {
      action: 'assign',
      bagId,
      noteIds: [n1.body.note.id, n2.body.note.id, n3.body.note.id],
      onlyFree: true,
    },
  })
  assert.equal(batchRes.status, 200)
  assert.deepEqual(batchRes.body.movedIds.sort(), [n1.body.note.id, n3.body.note.id].sort())
  assert.deepEqual(batchRes.body.skippedIds, [n2.body.note.id])

  const briefMd = await request('prep/bags/brief-markdown', { body: { id: bagId } })
  assert.equal(briefMd.status, 200)
  assert.match(briefMd.body.markdown, /# Cursor 2\.0 深度测评/)
  assert.match(briefMd.body.markdown, /14天Pro兑换码/)
  assert.match(briefMd.body.markdown, /开篇先讲真实翻车经历/)
  assert.doesNotMatch(briefMd.body.markdown, /更新后的灵感/)

  // Update bag via PATCH
  const bagPatch = await request('prep/bags/update', {
    method: 'PATCH',
    body: { id: bagId, title: 'Cursor 2.0 重构实战' },
  })
  assert.equal(bagPatch.status, 200)
  assert.equal(bagPatch.body.bag.title, 'Cursor 2.0 重构实战')

  // PATCH rejected on non-update routes
  const badPatch = await request('prep/bags', { method: 'PATCH', body: { title: 'x' } })
  assert.equal(badPatch.status, 405)

  // Unpromoted bag deletion releases notes back to free pool
  const tempBag = await request('prep/bags', { body: { title: '临时袋' } })
  const tempNote = await request('prep/notes', { body: { text: '临时想法', bagId: tempBag.body.bag.id } })
  const delBag = await request('prep/bags/delete', { body: { id: tempBag.body.bag.id } })
  assert.equal(delBag.status, 200)
  assert.deepEqual(delBag.body.releasedNoteIds, [tempNote.body.note.id])
  assert.equal(delBag.body.notes.find(n => n.id === tempNote.body.note.id).bagId, null)

  // Promote bag -> active -> archive -> archived -> delete article -> deleted -> reset-link
  const promoted = await request('prep/bags/promote', { body: { bagId, mode: 'blank' } })
  assert.equal(promoted.status, 200)
  const articleId = promoted.body.articleId

  let prep = await request('prep')
  assert.equal(prep.status, 200)
  let enriched = prep.body.bags.find(b => b.id === bagId)
  assert.equal(enriched.linkedArticleStatus, 'active')
  assert.equal(enriched.linkedArticle.id, articleId)

  // Cannot reset link while article exists
  const badReset = await request('prep/bags/reset-link', { body: { id: bagId } })
  assert.equal(badReset.status, 409)

  // Promoted bag cannot be hard deleted
  const badDel = await request('prep/bags/delete', { body: { id: bagId } })
  assert.equal(badDel.status, 409)

  await request('articles/archive', { body: { id: articleId } })
  prep = await request('prep')
  enriched = prep.body.bags.find(b => b.id === bagId)
  assert.equal(enriched.linkedArticleStatus, 'archived')

  await request('articles/delete', { body: { id: articleId } })
  prep = await request('prep')
  enriched = prep.body.bags.find(b => b.id === bagId)
  assert.equal(enriched.linkedArticleStatus, 'deleted')
  assert.equal(enriched.articleId, articleId)

  const reset = await request('prep/bags/reset-link', { body: { id: bagId } })
  assert.equal(reset.status, 200)
  assert.equal(reset.body.bag.articleId, null)
  assert.equal(reset.body.bags.find(b => b.id === bagId).linkedArticleStatus, null)
})

test('prep/assets validates magic bytes, serves PNG, and preserves files referenced by articles on note delete', async t => {
  const { root, store, request } = setup(t)

  // Fake PNG (SVG payload) rejected with 400 and writes zero files
  const fake = await request('prep/assets?name=fake.png', {
    method: 'POST',
    rawBody: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  })
  assert.equal(fake.status, 400)
  assert.equal(existsSync(join(root, 'prep-assets')), false)

  // Real PNG succeeds and is served via GET prep/assets
  const upload1 = await request('prep/assets?name=shot1.png', { method: 'POST', rawBody: PNG_BYTES })
  assert.equal(upload1.status, 200)
  assert.equal(upload1.body.ext, 'png')
  assert.equal(upload1.body.mimeType, 'image/png')

  const served = await request(`prep/assets?id=${upload1.body.assetId}&ext=png`)
  assert.equal(served.status, 200)
  assert.equal(served.headers['content-type'], 'image/png')
  assert.deepEqual(served.body, PNG_BYTES)

  const badPath = await request('prep/assets?id=../etc/passwd&ext=png')
  assert.equal(badPath.status, 400)

  // Deleting unreferenced note removes disk file
  const note1 = await request('prep/notes', { body: { text: '未引用截图', image: upload1.body } })
  const file1 = join(root, 'prep-assets', `${upload1.body.assetId}.png`)
  assert.equal(existsSync(file1), true)
  const del1 = await request('prep/notes/delete', { body: { ids: [note1.body.note.id] } })
  assert.equal(del1.status, 200)
  assert.equal(existsSync(file1), false)

  // Deleting note whose image is still referenced in an article keeps the file on disk
  const upload2 = await request('prep/assets?name=shot2.png', { method: 'POST', rawBody: PNG_BYTES })
  const note2 = await request('prep/notes', { body: { text: '已引用截图', imageAssetId: upload2.body.assetId } })
  assert.equal(note2.status, 200)
  assert.equal(note2.body.note.kind, 'image')
  assert.equal(note2.body.note.image.ext, 'png')
  const file2 = join(root, 'prep-assets', `${upload2.body.assetId}.png`)

  const upload3 = await request('prep/assets?name=shot3.png', { method: 'POST', rawBody: PNG_BYTES })
  const note3 = await request('prep/notes', { body: { text: '相对URL引用截图', image: upload3.body } })
  const file3 = join(root, 'prep-assets', `${upload3.body.assetId}.png`)

  const article = createArticle({
    markdown: `# 离线导入文章\n\n![本地截图](prep-assets/${upload2.body.assetId}.png)\n\n![接口截图](wechat-studio/prep/assets?ext=png&id=${upload3.body.assetId})`,
  })
  await store.update(state => {
    state.articles.push(article)
    state.currentId = article.id
  })

  const del2 = await request('prep/notes/delete', { body: { ids: [note2.body.note.id, note3.body.note.id] } })
  assert.equal(del2.status, 200)
  assert.equal(del2.body.notes.some(n => n.id === note2.body.note.id), false)
  assert.equal(existsSync(file2), true, '文章以 prep-assets/ 引用的文件必须保留')
  assert.equal(existsSync(file3), true, '文章以相对 API URL 引用的文件必须保留')
})

test('POST prep/bags/promote supports blank, ai (idempotent retry), import (with & without Cloudinary), and multi-note promote', async t => {
  const feishuUrl = 'https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=abc'
  let uploadCount = 0
  let failUploads = false
  const { root, store, prepStore, deps, request, draftCalls, titleCalls, activeJobs } = setup(t, {
    fetchImpl: async () => {
      uploadCount += 1
      if (failUploads) return new Response(null, { status: 500 })
      return Response.json({ secure_url: `https://res.cloudinary.com/demo/image/upload/v1/img-${uploadCount}.png` })
    },
  })

  // 1. AI mode: triggers pipeline.draft ONLY after both stores are consistent, skips on idempotent retry if busy or has body
  let bagStateWhenDraftCalled = null
  const aiBagRes = await request('prep/bags', { body: { title: 'AI起草选题', targetDate: '2026-12-01' } })
  const aiBagId = aiBagRes.body.bag.id
  const opId = 'op-ai-retry-1'
  const origDraftFn = deps.pipeline.draft
  deps.pipeline.draft = id => {
    bagStateWhenDraftCalled = structuredClone(prepStore.cache?.bags?.find(b => b.id === aiBagId) ?? null)
    origDraftFn(id)
  }
  const aiPromote = await request('prep/bags/promote', { body: { bagId: aiBagId, mode: 'ai', operationId: opId } })
  assert.equal(aiPromote.status, 200)
  assert.equal(aiPromote.body.created, true)
  assert.ok(aiPromote.body.scheduledFor)
  assert.deepEqual(draftCalls, [aiPromote.body.articleId])
  assert.equal(bagStateWhenDraftCalled?.articleId, aiPromote.body.articleId, 'pipeline.draft 必须在两侧 store 落定一致后才触发')
  assert.equal(bagStateWhenDraftCalled?.pendingPromotion, null)
  const bagAfterAi = (await prepStore.read()).bags.find(b => b.id === aiBagId)
  assert.equal(bagAfterAi.articleId, aiPromote.body.articleId)
  assert.equal(bagAfterAi.pendingPromotion, null)

  // Retry while job is active -> idempotent, does NOT kick off draft again
  activeJobs.set(aiPromote.body.articleId, { kind: 'draft' })
  const aiRetry = await request('prep/bags/promote', { body: { bagId: aiBagId, mode: 'ai', operationId: opId } })
  assert.equal(aiRetry.status, 200)
  assert.equal(aiRetry.body.created, false)
  assert.equal(aiRetry.body.articleId, aiPromote.body.articleId)
  assert.equal(draftCalls.length, 1)
  activeJobs.delete(aiPromote.body.articleId)

  // 2. Import mode WITHOUT Cloudinary: preserves local path + returns explicit warnings, does not duplicate article
  const asset1 = await request('prep/assets?name=local.png', { method: 'POST', rawBody: PNG_BYTES })
  const offlineBag = (await request('prep/bags', { body: { title: '离线导入袋' } })).body.bag
  await request('prep/notes', { body: { text: '本地图', bagId: offlineBag.id, image: asset1.body } })
  const offlineMd = `# 离线标题\n\n![本地](prep-assets/${asset1.body.assetId}.png)\n\n![飞书](${feishuUrl})`
  const offlineImport = await request('prep/bags/promote', {
    body: { bagId: offlineBag.id, mode: 'import', markdown: offlineMd, titles: false },
  })
  assert.equal(offlineImport.status, 200)
  assert.equal(offlineImport.body.imageTransfer.uploaded, 0)
  assert.ok(offlineImport.body.warnings.length >= 2)
  assert.equal(titleCalls.length, 0)
  const offlineArticle = (await store.read()).articles.find(a => a.id === offlineImport.body.articleId)
  assert.match(offlineArticle.blocks[0].text, new RegExp(`prep-assets/${asset1.body.assetId}\\.png`))

  // 3. Import mode WITH Cloudinary configured: transfers both Feishu and prep-assets, caches cloudinaryUrl, kicks off titles
  await updateSettings(root, { cloudinary: CLOUDINARY_CONFIG })
  const asset2 = await request('prep/assets?name=cloud.png', { method: 'POST', rawBody: PNG_BYTES })
  const cloudBag = (await request('prep/bags', { body: { title: '图床导入袋' } })).body.bag
  const cloudNote = (await request('prep/notes', { body: { text: '图床图', bagId: cloudBag.id, image: asset2.body } })).body.note
  const cloudMd = `# 图床标题\n\n![本地](prep-assets/${asset2.body.assetId}.png)\n\n![飞书](${feishuUrl})`
  const cloudImport = await request('prep/bags/promote', {
    body: { bagId: cloudBag.id, mode: 'import', markdown: cloudMd },
  })
  assert.equal(cloudImport.status, 200)
  assert.equal(cloudImport.body.imageTransfer.uploaded, 2)
  assert.equal(cloudImport.body.imageTransfer.failed, 0)
  assert.deepEqual(cloudImport.body.warnings, [])
  assert.deepEqual(titleCalls, [cloudImport.body.articleId])
  const cloudArticle = (await store.read()).articles.find(a => a.id === cloudImport.body.articleId)
  assert.ok(cloudArticle.blocks[0].text.includes('https://res.cloudinary.com/demo/image/upload/'))
  assert.ok(cloudArticle.blocks[1].text.includes('https://res.cloudinary.com/demo/image/upload/'))
  const cachedNote = (await prepStore.read()).notes.find(n => n.id === cloudNote.id)
  assert.match(cachedNote.image.cloudinaryUrl, /^https:\/\/res\.cloudinary\.com\//)

  // 4. Import mode when Cloudinary upload fails: keeps local path + returns explicit warnings, creates 1 article
  failUploads = true
  const asset3 = await request('prep/assets?name=fail.png', { method: 'POST', rawBody: PNG_BYTES })
  const failBag = (await request('prep/bags', { body: { title: '上传失败袋' } })).body.bag
  const articlesBeforeFail = (await store.read()).articles.length
  const failImport = await request('prep/bags/promote', {
    body: {
      bagId: failBag.id,
      mode: 'import',
      markdown: `# 失败测试\n\n![图](prep-assets/${asset3.body.assetId}.png)`,
      titles: false,
    },
  })
  assert.equal(failImport.status, 200)
  assert.equal(failImport.body.imageTransfer.failed, 1)
  assert.ok(failImport.body.warnings.length >= 1)
  assert.equal((await store.read()).articles.length, articlesBeforeFail + 1)
  const failArticle = (await store.read()).articles.find(a => a.id === failImport.body.articleId)
  assert.match(failArticle.blocks[0].text, new RegExp(`prep-assets/${asset3.body.assetId}\\.png`))

  // 5. Multi-note direct promote without bagId
  const free1 = (await request('prep/notes', { body: { text: '火花一：MCP 协议落地案例' } })).body.note
  const free2 = (await request('prep/notes', { body: { text: '火花二：权限边界怎么画' } })).body.note
  const multiPromote = await request('prep/bags/promote', {
    body: { noteIds: [free1.id, free2.id], title: '多纸条直建稿', mode: 'blank' },
  })
  assert.equal(multiPromote.status, 200)
  assert.ok(multiPromote.body.bagId)
  assert.ok(multiPromote.body.articleId)
  const prepAfterMulti = await prepStore.read()
  assert.equal(prepAfterMulti.notes.find(n => n.id === free1.id).bagId, multiPromote.body.bagId)
  assert.equal(prepAfterMulti.notes.find(n => n.id === free2.id).bagId, multiPromote.body.bagId)
})

test('GET state exposes prepPlaceholders, current.sourceBag, and live sponsored preflight', async t => {
  const { request } = setup(t)

  const datedSponsored = (await request('prep/bags', {
    body: {
      title: '商单占位选题',
      type: 'sponsored',
      targetDate: '2026-11-30',
      brief: {
        partner: 'Acme',
        sellingPoints: '极速编译',
        mustInclude: ['ACME2026', 'https://acme.example/try'],
        taboo: ['全网最强'],
      },
    },
  })).body.bag
  await request('prep/notes', { body: { text: '一条实测笔记', bagId: datedSponsored.id } })

  // Undated bag should NOT appear in prepPlaceholders
  await request('prep/bags', { body: { title: '无日期选题', type: 'topic' } })

  const stateBefore = await request('state')
  assert.equal(stateBefore.status, 200)
  assert.equal(stateBefore.body.prepPlaceholders.length, 1)
  assert.deepEqual(stateBefore.body.prepPlaceholders[0], {
    id: datedSponsored.id,
    title: '商单占位选题',
    type: 'sponsored',
    partner: 'Acme',
    targetDate: '2026-11-30',
    noteCount: 1,
  })

  // Promote bag -> disappears from prepPlaceholders, appears in current.sourceBag + current.preflight
  const promoted = await request('prep/bags/promote', {
    body: {
      bagId: datedSponsored.id,
      mode: 'import',
      markdown: '# Acme 实测\n\n这是全网最强的一篇测评，但忘了写口令。',
      titles: false,
    },
  })
  assert.equal(promoted.status, 200)

  const stateAfter = await request('state')
  assert.equal(stateAfter.body.prepPlaceholders.length, 0)
  assert.equal(stateAfter.body.current.sourceBag.id, datedSponsored.id)
  assert.equal(stateAfter.body.current.sourceBag.exists, true)
  assert.equal(stateAfter.body.current.sourceBag.linkedArticleStatus, 'active')
  assert.equal(stateAfter.body.current.sourceBag.notes.length, 1)
  assert.equal(stateAfter.body.current.sourceBag.brief.partner, 'Acme')

  const pfIds = stateAfter.body.current.preflight.items.map(i => i.id)
  assert.ok(pfIds.includes('sponsored-must-include'))
  assert.ok(pfIds.includes('sponsored-taboo'))

  // Editing brief on promoted bag updates preflight immediately
  await request('prep/bags/update', {
    method: 'PATCH',
    body: {
      id: datedSponsored.id,
      brief: { mustInclude: ['Acme'], taboo: [] },
    },
  })
  const stateEdited = await request('state')
  assert.equal(stateEdited.body.current.preflight.items.some(i => i.id === 'sponsored-must-include'), false)
  assert.equal(stateEdited.body.current.preflight.items.some(i => i.id === 'sponsored-taboo'), false)

  // Toggling promoted bag to topic stops sponsored preflight while preserving brief in storage
  await request('prep/bags/update', {
    method: 'PATCH',
    body: { id: datedSponsored.id, type: 'topic', brief: { mustInclude: ['绝不出现'], taboo: ['全网最强'] } },
  })
  const stateTopic = await request('state')
  assert.equal(stateTopic.body.current.sourceBag.type, 'topic')
  assert.equal(stateTopic.body.current.sourceBag.brief, null)
  assert.equal(stateTopic.body.current.preflight.items.some(i => i.id.startsWith('sponsored-')), false)
})

test('POST articles/duplicate strips sourceBagId and snapshots the bag latest edited brief', async t => {
  const { store, request } = setup(t)

  const bag = (await request('prep/bags', {
    body: {
      title: '商单原稿',
      type: 'sponsored',
      brief: {
        partner: 'OldCo',
        sellingPoints: '旧卖点',
        mustInclude: ['旧口令'],
        taboo: ['旧禁忌'],
      },
    },
  })).body.bag

  const promoted = await request('prep/bags/promote', {
    body: {
      bagId: bag.id,
      mode: 'import',
      markdown: '# 商单测评\n\n正文包含新禁忌，但漏掉了要求的信息。',
      titles: false,
    },
  })
  const origId = promoted.body.articleId

  // Edit bag brief AFTER promotion
  await request('prep/bags/update', {
    method: 'PATCH',
    body: {
      id: bag.id,
      brief: {
        partner: 'NewCo',
        sellingPoints: '最新卖点',
        mustInclude: ['新口令'],
        taboo: ['新禁忌'],
      },
    },
  })

  const dupRes = await request('articles/duplicate', { body: { id: origId } })
  assert.equal(dupRes.status, 200)
  const dupId = dupRes.body.current.id
  assert.notEqual(dupId, origId)

  const dupArticle = (await store.read()).articles.find(a => a.id === dupId)
  assert.equal('sourceBagId' in dupArticle, false)
  assert.deepEqual(dupArticle.sponsoredSnapshot, {
    partner: 'NewCo',
    sellingPoints: '最新卖点',
    mustInclude: ['新口令'],
    taboo: ['新禁忌'],
  })

  assert.equal(dupRes.body.current.sourceBag.exists, false)
  assert.equal(dupRes.body.current.sourceBag.brief.partner, 'NewCo')
  assert.ok(dupRes.body.current.preflight.items.some(i => i.id === 'sponsored-must-include'))
  assert.ok(dupRes.body.current.preflight.items.some(i => i.id === 'sponsored-taboo'))

  // Mutating original bag afterwards does NOT affect duplicate
  await request('prep/bags/update', {
    method: 'PATCH',
    body: { id: bag.id, brief: { partner: 'LaterCo', mustInclude: [], taboo: [] } },
  })
  const dupStateAgain = await request('state')
  assert.equal(dupStateAgain.body.current.sourceBag.brief.partner, 'NewCo')
})

test('POST prep/notes/insert-to-article inserts text, cached Cloudinary image, and offline placeholder fallback', async t => {
  let cloudinaryCalls = 0
  const cdnUrl = 'https://res.cloudinary.com/demo/image/upload/v1/inserted.png'
  const { root, prepStore, request } = setup(t, {
    fetchImpl: async () => {
      cloudinaryCalls += 1
      return Response.json({ secure_url: cdnUrl })
    },
  })

  const bag = (await request('prep/bags', { body: { title: '插料测试' } })).body.bag
  const textNote = (await request('prep/notes', { body: { text: '结尾补一句金句。', bagId: bag.id } })).body.note
  const asset = (await request('prep/assets?name=demo.png', { method: 'POST', rawBody: PNG_BYTES })).body
  const imgNote = (await request('prep/notes', { body: { text: '架构对比图', bagId: bag.id, image: asset } })).body.note

  const promoted = await request('prep/bags/promote', {
    body: { bagId: bag.id, mode: 'import', markdown: '# 测试\n\n第一段。', titles: false },
  })
  const articleId = promoted.body.articleId

  // Text note insertion (using act-style `id` field)
  const insText = await request('prep/notes/insert-to-article', {
    body: { id: articleId, noteId: textNote.id },
  })
  assert.equal(insText.status, 200)
  assert.equal(insText.body.fallback, false)
  assert.equal(insText.body.current.blocks.at(-1).text, '结尾补一句金句。')

  // Image note WITHOUT Cloudinary -> inserts [截图：...] placeholder with fallback: true
  const insFallback = await request('prep/notes/insert-to-article', {
    body: { articleId, noteId: imgNote.id },
  })
  assert.equal(insFallback.status, 200)
  assert.equal(insFallback.body.fallback, true)
  assert.equal(insFallback.body.current.blocks.at(-1).text, '[截图：架构对比图]')
  assert.equal(cloudinaryCalls, 0)

  // Image note WITH Cloudinary -> uploads once, caches cloudinaryUrl on note, reuses cache on second insert
  await updateSettings(root, { cloudinary: CLOUDINARY_CONFIG })
  const insCloud1 = await request('prep/notes/insert-to-article', {
    body: { articleId, noteId: imgNote.id },
  })
  assert.equal(insCloud1.status, 200)
  assert.equal(insCloud1.body.fallback, false)
  assert.equal(insCloud1.body.current.blocks.at(-1).text, `![架构对比图](${cdnUrl})`)
  assert.equal(cloudinaryCalls, 1)
  assert.equal((await prepStore.read()).notes.find(n => n.id === imgNote.id).image.cloudinaryUrl, cdnUrl)

  const insCloud2 = await request('prep/notes/insert-to-article', {
    body: { articleId, noteId: imgNote.id },
  })
  assert.equal(insCloud2.status, 200)
  assert.equal(insCloud2.body.fallback, false)
  assert.equal(cloudinaryCalls, 1, '第二次插入应复用缓存的 cloudinaryUrl')
})

test('POST prep/ai/extract-brief and POST prep/ai/cluster-notes return validated model output', async t => {
  let noteIdsForCluster = []
  const ctx = makeLlmContext(({ task }) => {
    if (task === 'prep-extract-brief') {
      return JSON.stringify({
        partner: 'Cursor',
        sellingPoints: 'Agent 重构',
        mustInclude: ['试用链接'],
        taboo: ['宇宙第一'],
        targetDate: '2026-12-05',
      })
    }
    return JSON.stringify({
      clusters: [
        { title: 'AI 编程提效复盘', angle: '对比真实重构案例', noteIds: [noteIdsForCluster[0], noteIdsForCluster[1], 'note_ghost'] },
      ],
    })
  })
  const { request } = setup(t, { ctx })

  const extracted = await request('prep/ai/extract-brief', {
    body: { rawText: '甲方是 Cursor，12月5号发，记得带试用链接，别写宇宙第一。' },
  })
  assert.equal(extracted.status, 200)
  assert.deepEqual(extracted.body, {
    partner: 'Cursor',
    sellingPoints: 'Agent 重构',
    mustInclude: ['试用链接'],
    taboo: ['宇宙第一'],
    targetDate: '2026-12-05',
  })

  for (let i = 1; i <= 5; i++) {
    const res = await request('prep/notes', { body: { text: `自由灵感 ${i}` } })
    noteIdsForCluster.push(res.body.note.id)
  }

  const clustered = await request('prep/ai/cluster-notes', { body: {} })
  assert.equal(clustered.status, 200)
  assert.equal(clustered.body.clusters.length, 1)
  assert.deepEqual(clustered.body.clusters[0].noteIds, [noteIdsForCluster[0], noteIdsForCluster[1]])
})

test('createHandler runs startup reconcilePrep and removeOrphanPrepAssets, skipping cleanup when corrupted', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ws-prep-startup-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const seedStore = new Store(root)
  const seedPrep = new JsonStore(root, { file: 'prep.json', empty: PREP_EMPTY })

  const article = createArticle({ id: 'a_reconcile1', topic: '崩溃恢复', sourceBagId: 'bag_rec1' })
  await seedStore.update(state => { state.articles.push(article) })
  await seedPrep.update(state => {
    state.bags.push({
      id: 'bag_rec1',
      title: '崩溃恢复',
      type: 'topic',
      targetDate: null,
      brief: { partner: '', sellingPoints: '', mustInclude: [], taboo: [], rawText: '' },
      articleId: null,
      pendingPromotion: { operationId: 'op-rec', articleId: 'a_reconcile1', mode: 'blank', createdAt: new Date().toISOString() },
      promotedAt: null,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  })

  // Seed one >24h orphan and one fresh orphan in prep-assets/
  const oldId = '11111111-1111-4111-8111-111111111111'
  const freshId = '22222222-2222-4222-8222-222222222222'
  const assetsDir = join(root, 'prep-assets')
  const oldFile = join(assetsDir, `${oldId}.png`)
  const freshFile = join(assetsDir, `${freshId}.png`)
  await import('node:fs/promises').then(fs => fs.mkdir(assetsDir, { recursive: true }))
  writeFileSync(oldFile, PNG_BYTES)
  writeFileSync(freshFile, PNG_BYTES)
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)
  utimesSync(oldFile, twoDaysAgo, twoDaysAgo)

  const authCtx = {
    get: name => (name === 'connection' ? { admit: () => ({ peer: { principal: { kind: 'owner' } } }) } : null),
  }
  const handler = createHandler(authCtx, { store: new Store(root) })
  let body = ''
  await handler(
    { method: 'GET', url: '/wechat-studio/prep', headers: { host: '127.0.0.1:4173' }, async *[Symbol.asyncIterator]() {} },
    { statusCode: 200, setHeader() {}, end(v) { body = String(v ?? '') } },
  )
  const parsed = JSON.parse(body)
  assert.equal(parsed.bags[0].articleId, 'a_reconcile1')
  assert.equal(parsed.bags[0].pendingPromotion, null)
  assert.equal(existsSync(oldFile), false, '超过 24 小时的孤儿文件应被回收')
  assert.equal(existsSync(freshFile), true, '24 小时内的文件不应被提前删除')

  // Corrupted prep.json -> startup orphan cleanup must be skipped
  const rootBad = mkdtempSync(join(tmpdir(), 'ws-prep-corrupt-'))
  t.after(() => rmSync(rootBad, { recursive: true, force: true }))
  writeFileSync(join(rootBad, 'prep.json'), '{broken')
  const badAssetsDir = join(rootBad, 'prep-assets')
  await import('node:fs/promises').then(fs => fs.mkdir(badAssetsDir, { recursive: true }))
  const keepFile = join(badAssetsDir, `${oldId}.png`)
  writeFileSync(keepFile, PNG_BYTES)
  utimesSync(keepFile, twoDaysAgo, twoDaysAgo)

  const handlerBad = createHandler(authCtx, { store: new Store(rootBad) })
  await handlerBad(
    { method: 'GET', url: '/wechat-studio/state', headers: { host: '127.0.0.1:4173' }, async *[Symbol.asyncIterator]() {} },
    { statusCode: 200, setHeader() {}, end() {} },
  )
  assert.equal(existsSync(keepFile), true, 'prep.json 损坏时必须跳过孤儿文件清理')
  assert.deepEqual(readdirSync(badAssetsDir), [`${oldId}.png`])
})

test('block/append appends user-written paragraphs to blank promoted article and supports undo', async t => {
  const { request } = setup(t)
  const bag = await request('prep/bags', { body: { title: '空白手写测试', type: 'topic' } })
  const promoted = await request('prep/bags/promote', { body: { bagId: bag.body.bag.id, mode: 'blank' } })
  assert.equal(promoted.status, 200)
  const articleId = promoted.body.articleId
  assert.equal(promoted.body.current.blocks.length, 0)

  const emptyErr = await request('block/append', { body: { id: articleId, text: '   ' } })
  assert.equal(emptyErr.status, 400)

  const appended = await request('block/append', {
    body: { id: articleId, text: '第一段手写正文。\n\n第二段继续展开。' },
  })
  assert.equal(appended.status, 200)
  assert.equal(appended.body.current.blocks.length, 2)
  assert.equal(appended.body.current.blocks[0].text, '第一段手写正文。')
  assert.equal(appended.body.current.blocks[1].text, '第二段继续展开。')
  assert.equal(appended.body.current.canUndo, true)

  const undone = await request('undo', { body: { id: articleId } })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.current.blocks.length, 0)
})
