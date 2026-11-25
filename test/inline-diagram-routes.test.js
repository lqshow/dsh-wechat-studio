import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { blockKind, createArticle, parseMarkdownImage, toMarkdown } from '../src/article.js'
import { createHandler, route } from '../src/host.js'
import { renderLayout } from '../src/layout.js'
import { saveInlineImage } from '../src/inline-assets.js'
import { sourceHash } from '../src/inline-diagrams.js'
import { updateSettings } from '../src/settings.js'
import { Store } from '../src/store.js'

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex')
const PUBLIC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/dsh-wechat-studio/inline-demo.png'

async function setup({ fetchImpl, cloudinary = true, llm = null } = {}) {
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-inline-routes-')))
  const article = createArticle({ markdown: '# 插图测试\n\n第一段解释概念。\n\n第二段保持不变。' })
  article.inlineDiagrams = [{
    id: 'diagram-1', anchorId: article.blocks[0].id, sourceHash: sourceHash(article.blocks[0].text),
    kind: 'concept', title: '概念关系', reason: '看清关系', brief: '中心与两个节点相连', status: 'suggested',
  }]
  const other = createArticle({ markdown: '# 另一篇\n\n其他正文。' })
  await store.update(state => { state.articles.push(article, other); state.currentId = article.id })
  await updateSettings(store.root, {
    arkKey: 'ark-key',
    ...(cloudinary ? { cloudinary: { cloudName: 'demo', apiKey: 'cloud-key', apiSecret: 'cloud-secret' } } : {}),
  })
  const services = { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }
  const deps = { ctx: { get: name => services[name] ?? null }, store, pipeline: { job: () => null }, fetchImpl }
  let responseHeaders = {}
  const request = async (path, payload) => {
    const binary = Buffer.isBuffer(payload)
    const req = {
      url: `/wechat-studio/${path}`, method: payload ? 'POST' : 'GET',
      headers: binary ? { 'content-type': 'image/png' } : {},
      async *[Symbol.asyncIterator]() { if (payload) yield binary ? payload : Buffer.from(JSON.stringify(payload)) },
    }
    let result
    const res = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value },
      end(value) {
        responseHeaders = this.headers
        result = this.headers['content-type']?.startsWith('application/json') ? JSON.parse(value) : value
      },
    }
    await route(deps, req, res)
    return result
  }
  const wait = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await request('state')
      if (!state.current.inlineDiagramJob) return state.current
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.fail('插图任务未结束')
  }
  return { store, article, other, request, wait, responseHeaders: () => responseHeaders }
}

const arkSuccess = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG.toString('base64') }] }) })
const cloudSuccess = async () => Response.json({ secure_url: PUBLIC_URL })

test('本地图片通过原始字节上传，只返回图床地址，不自动修改正文', async () => {
  const { article, request } = await setup({ fetchImpl: cloudSuccess })
  const before = toMarkdown(article)
  const response = await request(`images/upload?id=${article.id}`, PNG)
  assert.equal(response.url, PUBLIC_URL)
  assert.equal(toMarkdown(article), before)
})

async function seedGenerated(store, article) {
  const assetId = await saveInlineImage(store.root, PNG)
  await store.update(() => {
    Object.assign(article.inlineDiagrams[0], { assetId, format: 'png', provider: 'ark', model: 'm', style: 'notebook', status: 'generated' })
  })
  return assetId
}

test('生图成功不改正文，插图只归所属稿件读取', async () => {
  const { article, other, request, wait, responseHeaders } = await setup({ fetchImpl: arkSuccess })
  const before = toMarkdown(article)
  const started = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.ok(!started.error, started.error)
  const current = await wait()
  const diagram = current.inlineDiagrams[0]
  assert.equal(diagram.status, 'generated')
  assert.equal(diagram.provider, 'ark')
  assert.equal(diagram.format, 'png')
  assert.equal(toMarkdown(article), before)
  const image = await request(`inline-diagrams/image?id=${article.id}&asset=${diagram.assetId}`)
  assert.ok(Buffer.isBuffer(image) && image.equals(PNG))
  assert.equal(responseHeaders()['cache-control'], 'private, max-age=31536000, immutable')
  await request(`inline-diagrams/image?id=${article.id}&asset=${diagram.assetId}&download=1`)
  const disposition = responseHeaders()['content-disposition']
  assert.match(disposition, /filename\*=UTF-8''/)
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), '概念关系.png')
  const denied = await request(`inline-diagrams/image?id=${other.id}&asset=${diagram.assetId}`)
  assert.match(denied.error, /没有这张插图/)
})

test('上方插段后仍按锚点插入，重复请求幂等，撤销后可复用链接重插', async () => {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return cloudSuccess() }
  const { store, article, request, wait } = await setup({ fetchImpl })
  await seedGenerated(store, article)
  await store.update(() => { article.blocks.unshift({ id: 'new-opening', text: '新增开头', check: null }) })
  const anchor = article.blocks.find(block => block.id === article.inlineDiagrams[0].anchorId)
  const expectedAnchorHash = sourceHash(anchor.text)
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash })
  let current = await wait()
  let diagram = current.inlineDiagrams[0]
  assert.equal(diagram.status, 'inserted', current.inlineDiagramMessage?.text)
  assert.equal(article.blocks[article.blocks.indexOf(anchor) + 1].id, diagram.insertedBlockId)
  assert.match(article.blocks[article.blocks.indexOf(anchor) + 1].text, /^!\[概念关系\]\(https:\/\/res\.cloudinary\.com\//)
  assert.match(toMarkdown(article), /https:\/\/res\.cloudinary\.com/)
  assert.equal(calls.length, 1)
  const upload = calls[0].init.body
  assert.equal(upload.get('overwrite'), 'true')
  const publicId = `dsh-wechat-studio/inline-${createHash('sha256').update(`${article.id}:${diagram.assetId}`).digest('hex')}`
  const signature = createHash('sha256').update(`overwrite=true&public_id=${publicId}&timestamp=${upload.get('timestamp')}cloud-secret`).digest('hex')
  assert.equal(upload.get('public_id'), publicId)
  assert.equal(upload.get('signature'), signature)

  const count = article.blocks.length
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash })
  current = await wait()
  assert.equal(article.blocks.length, count)
  assert.match(current.inlineDiagramMessage.text, /没有重复插入/)

  await request('undo', { id: article.id })
  current = await request('state')
  assert.equal(current.current.inlineDiagrams[0].status, 'generated')
  assert.equal(current.current.inlineDiagrams[0].insertedBlockExists, false)
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash })
  current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'inserted')
  assert.equal(article.blocks.filter(block => block.text.includes(PUBLIC_URL)).length, 1)
  assert.equal(calls.length, 1, '撤销后重插复用已上传链接')
})

test('上传中改写锚点不误插，保留图床链接，明确接受旧图后才能重插', async () => {
  let release
  let uploads = 0
  const pending = new Promise(resolve => { release = resolve })
  const fetchImpl = async () => {
    uploads++
    await pending
    return cloudSuccess()
  }
  const { store, article, request, wait } = await setup({ fetchImpl })
  await seedGenerated(store, article)
  const anchor = article.blocks[0]
  const expectedAnchorHash = sourceHash(anchor.text)
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash })
  while (!uploads) await new Promise(resolve => setTimeout(resolve, 5))
  await request('block/update', { id: article.id, blockId: anchor.id, expectedText: anchor.text, text: '上传期间改写后的目标段落。' })
  release()
  let current = await wait()
  assert.equal(article.blocks.some(block => block.text.includes(PUBLIC_URL)), false)
  assert.equal(current.inlineDiagrams[0].status, 'generated')
  assert.equal(current.inlineDiagrams[0].publicUrl, PUBLIC_URL)
  assert.match(current.inlineDiagramMessage.text, /确认期间发生变化/)

  const changedHash = sourceHash(anchor.text)
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash: changedHash })
  current = await wait()
  assert.equal(article.blocks.some(block => block.text.includes(PUBLIC_URL)), false)
  assert.match(current.inlineDiagramMessage.text, /继续使用这张旧图/)

  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash: changedHash, acceptStale: true })
  current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'inserted')
  assert.equal(article.blocks.filter(block => block.text.includes(PUBLIC_URL)).length, 1)
  assert.equal(uploads, 1)
})

test('同名上传冲突后仍可重试，未配置图床不丢本机图', async () => {
  let attempts = 0
  const fetchImpl = async (url, init) => {
    attempts++
    assert.equal(init.body.get('overwrite'), 'true')
    return attempts === 1 ? Response.json({}, { status: 400 }) : cloudSuccess()
  }
  const { store, article, request, wait } = await setup({ fetchImpl })
  const assetId = await seedGenerated(store, article)
  const expectedAnchorHash = sourceHash(article.blocks[0].text)
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash })
  let current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'generated')
  assert.match(current.inlineDiagramMessage.text, /上传插图失败/)
  await request('inline-diagrams/insert', { id: article.id, diagramId: 'diagram-1', expectedAnchorHash })
  current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'inserted')
  assert.equal(attempts, 2)

  const missing = await setup({ cloudinary: false })
  await seedGenerated(missing.store, missing.article)
  const response = await missing.request('inline-diagrams/insert', {
    id: missing.article.id, diagramId: 'diagram-1', expectedAnchorHash: sourceHash(missing.article.blocks[0].text),
  })
  assert.match(response.error, /已生成的插图会保留/)
  assert.equal(missing.article.inlineDiagrams[0].status, 'generated')
  assert.equal(missing.article.inlineDiagrams[0].assetId.length, assetId.length)
})

test('忽略和恢复不删除已有图片，重新生成后清理旧 PNG', async () => {
  const { store, article, request, wait } = await setup({ fetchImpl: arkSuccess })
  const oldAsset = await seedGenerated(store, article)
  await request('inline-diagrams/ignore', { id: article.id, diagramId: 'diagram-1' })
  assert.equal(article.inlineDiagrams[0].status, 'ignored')
  assert.ok(article.inlineDiagrams[0].assetId)
  await request('inline-diagrams/restore', { id: article.id, diagramId: 'diagram-1' })
  assert.equal(article.inlineDiagrams[0].status, 'generated')
  await store.update(() => { article.inlineDiagrams[0].status = 'generating' })
  const current = await request('state')
  assert.equal(current.current.inlineDiagrams[0].status, 'interrupted')
  const retry = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.ok(!retry.error, retry.error)
  const currentAfterRetry = await wait()
  const newAsset = currentAfterRetry.inlineDiagrams[0].assetId
  assert.notEqual(newAsset, oldAsset)
  assert.deepEqual(await readdir(join(store.root, 'inline-images')), [`${newAsset}.png`])
})


test('分析路由只保存建议，不调用生图接口', async () => {
  let article
  const llm = {
    prepareCall: async () => ({
      config: {},
      async *stream() {
        yield { type: 'text-delta', text: JSON.stringify({ suggestions: [{ anchorId: article.blocks[0].id, kind: 'concept', title: '概念图', reason: '帮助理解', brief: '中心连接两个组成' }] }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  let images = 0
  const context = await setup({ llm, fetchImpl: async () => { images++; return arkSuccess() } })
  article = context.article
  await context.store.update(() => { article.inlineDiagrams = [] })
  const response = await context.request('inline-diagrams/analyze', { id: article.id })
  assert.ok(!response.error, response.error)
  const current = await context.wait()
  assert.equal(current.inlineDiagrams.length, 1)
  assert.equal(current.inlineDiagrams[0].status, 'suggested')
  assert.equal(current.inlineDiagrams[0].assetId, undefined)
  assert.equal(images, 0)
})

test('旧图可重新选择锚点，来源摘要仍指向原段落并明确提示不重画', async () => {
  const { store, article, request } = await setup({ fetchImpl: cloudSuccess })
  await seedGenerated(store, article)
  const diagram = article.inlineDiagrams[0]
  const originalHash = diagram.sourceHash
  const target = article.blocks[1]
  const response = await request('inline-diagrams/reanchor', { id: article.id, diagramId: diagram.id, blockId: target.id })
  assert.ok(!response.error, response.error)
  assert.equal(diagram.anchorId, target.id)
  assert.equal(diagram.sourceHash, originalHash)
  assert.match(article.inlineMessage.text, /旧图.*不会自动重画/)
  const state = await request('state')
  assert.equal(state.current.inlineDiagrams[0].stale, true)
  assert.equal(state.current.inlineDiagrams[0].anchorNumber, 2)
  const retry = await request('inline-diagrams/generate', { id: article.id, diagramId: diagram.id, style: 'notebook' })
  assert.match(retry.error, /删除这条记录.*指定段落.*插入旧图/)
})


test('删除失效或已忽略记录不改正文，并清理本机资产', async () => {
  const { store, article, request } = await setup({ fetchImpl: arkSuccess })
  await seedGenerated(store, article)
  const before = toMarkdown(article)
  await store.update(() => {
    article.inlineDiagrams[0].status = 'ignored'
    article.inlineDiagrams[0].anchorId = 'deleted-block'
  })
  const response = await request('inline-diagrams/delete', { id: article.id, diagramId: 'diagram-1' })
  assert.ok(!response.error, response.error)
  assert.deepEqual(article.inlineDiagrams, [])
  assert.equal(toMarkdown(article), before)
  assert.deepEqual(await readdir(join(store.root, 'inline-images')), [])
})

test('删除稿件时清理只属于该稿的插图资产', async () => {
  const { store, article, request } = await setup({ fetchImpl: arkSuccess })
  await seedGenerated(store, article)
  const response = await request('articles/delete', { id: article.id })
  assert.ok(!response.error, response.error)
  assert.ok(!(await store.read()).articles.some(item => item.id === article.id))
  assert.deepEqual(await readdir(join(store.root, 'inline-images')), [])
})

test('没有当前图床配置时，已有 publicUrl 仍可免上传重插', async () => {
  const { store, article, request, wait } = await setup({
    cloudinary: false,
    fetchImpl: async () => { throw new Error('不应再次上传') },
  })
  await seedGenerated(store, article)
  await store.update(() => { article.inlineDiagrams[0].publicUrl = PUBLIC_URL })
  const response = await request('inline-diagrams/insert', {
    id: article.id, diagramId: 'diagram-1', expectedAnchorHash: sourceHash(article.blocks[0].text),
  })
  assert.ok(!response.error, response.error)
  const current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'inserted')
  assert.equal(article.blocks.filter(block => block.text.includes(PUBLIC_URL)).length, 1)
})

test('一个不可读的用户风格不会拖垮 state，并返回可诊断提示', async t => {
  if (process.platform === 'win32') return t.skip('Windows chmod 不支持移除文件读取权限')
  if (process.getuid?.() === 0) return t.skip('root 不受文件权限限制')
  const { store, article, request } = await setup({ fetchImpl: arkSuccess })
  const customDir = join(store.root, 'skills', 'linyuebanzi-inline-diagram', 'references', 'styles')
  await mkdir(customDir, { recursive: true })
  const broken = join(customDir, 'broken-style.md')
  await writeFile(broken, '# 风格: 坏风格 (broken-style)')
  assert.ok(!(await request('state')).error)
  await chmod(broken, 0)
  try {
    const state = await request('state')
    assert.ok(!state.error, state.error)
    assert.equal(state.current.id, article.id)
    assert.ok(state.current.inlineDiagramStyles.some(style => style.id === 'notebook'))
    assert.match(state.current.inlineDiagramStyleWarnings.join('\n'), /broken-style.*EACCES/)
  } finally {
    await chmod(broken, 0o600)
  }
})

test('分析超时后释放稿件任务锁，后续操作可继续', async () => {
  const llm = {
    prepareCall: async () => ({
      config: {},
      async *stream() { throw new DOMException('超时', 'TimeoutError') },
    }),
  }
  const { article, request, wait } = await setup({ llm, fetchImpl: arkSuccess })
  await request('inline-diagrams/analyze', { id: article.id })
  const current = await wait()
  assert.equal(current.inlineDiagramJob, null)
  assert.match(current.inlineDiagramMessage.text, /正文分析超时/)
  const response = await request('inline-diagrams/ignore', { id: article.id, diagramId: 'diagram-1' })
  assert.ok(!response.error, response.error)
  assert.equal(response.current.inlineDiagrams[0].status, 'ignored')
})


test('生图记录写入失败时删除新 PNG，旧图和旧资产引用保留', async () => {
  const { store, article, request, wait } = await setup({ fetchImpl: arkSuccess })
  const oldAsset = await seedGenerated(store, article)
  const update = store.update.bind(store)
  let calls = 0
  store.update = fn => {
    calls++
    if (calls === 2) return Promise.reject(new Error('模拟磁盘写入失败'))
    return update(fn)
  }
  const started = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.ok(!started.error, started.error)
  const current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'failed')
  assert.equal(current.inlineDiagrams[0].assetId, oldAsset)
  assert.match(current.inlineDiagramMessage.text, /模拟磁盘写入失败/)
  assert.deepEqual(await readdir(join(store.root, 'inline-images')), [`${oldAsset}.png`])
})

test('忽略记录不能直接通过接口插入，正文保持不变', async () => {
  const { store, article, request } = await setup({ fetchImpl: cloudSuccess })
  await seedGenerated(store, article)
  await request('inline-diagrams/ignore', { id: article.id, diagramId: 'diagram-1' })
  const before = toMarkdown(article)
  const response = await request('inline-diagrams/insert', {
    id: article.id, diagramId: 'diagram-1', expectedAnchorHash: sourceHash(article.blocks[0].text),
  })
  assert.match(response.error, /当前不能插入/)
  assert.equal(toMarkdown(article), before)
  assert.equal((await request('state')).current.inlineDiagramJob, null)
})


test('Host 启动后的首个请求前完成孤儿插图清理', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-inline-startup-gc-')))
  const article = createArticle({ markdown: '# 标题\n\n正文' })
  const referenced = await saveInlineImage(store.root, PNG)
  await saveInlineImage(store.root, PNG)
  article.inlineDiagrams = [{ id: 'diagram', assetId: referenced, format: 'png', status: 'generated' }]
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const services = { connection: { requestRejection: () => undefined } }
  const handler = createHandler({ get: name => services[name] ?? null }, { store })
  const req = { url: '/wechat-studio/state', method: 'GET', headers: {} }
  let body
  const res = {
    setHeader() {},
    end(value) { body = JSON.parse(value) },
  }
  await handler(req, res)
  assert.equal(body.current.id, article.id)
  assert.deepEqual(await readdir(join(store.root, 'inline-images')), [`${referenced}.png`])
})


test('状态文件损坏时启动清理不误删插图资产', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-inline-invalid-state-')))
  const asset = await saveInlineImage(store.root, PNG)
  await writeFile(join(store.root, 'state.json'), '{broken json')
  const services = { connection: { requestRejection: () => undefined } }
  const handler = createHandler({ get: name => services[name] ?? null }, { store })
  const req = { url: '/wechat-studio/state', method: 'GET', headers: {} }
  const res = { setHeader() {}, end() {} }
  await handler(req, res)
  assert.ok((await readdir(join(store.root, 'inline-images'))).includes(`${asset}.png`))
})

test('稿件分片损坏时启动清理不误删插图资产', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-inline-corrupt-shard-'))
  const seed = new Store(root)
  const article = createArticle({ markdown: '# 标题\n\n正文' })
  const asset = await saveInlineImage(root, PNG)
  article.inlineDiagrams = [{ id: 'diagram', assetId: asset, format: 'png', status: 'generated' }]
  await seed.update(state => { state.articles.push(article); state.currentId = article.id })
  const dir = join(root, 'articles', article.id)
  await writeFile(join(dir, 'article.json'), '{broken json')
  await writeFile(join(dir, 'article.json.bak'), '{broken json')
  const store = new Store(root)
  const services = { connection: { requestRejection: () => undefined } }
  const handler = createHandler({ get: name => services[name] ?? null }, { store })
  const req = { url: '/wechat-studio/state', method: 'GET', headers: {} }
  const res = { setHeader() {}, end() {} }
  await handler(req, res)
  assert.ok((await readdir(join(root, 'inline-images'))).includes(`${asset}.png`))
})

test('稿件主文件损坏回退到旧版备份时，启动清理不误删新版插图并返回 storageProblems', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-inline-backup-fallback-'))
  const seed = new Store(root)
  const article = createArticle({ markdown: '# v1\n\n第一版无插图' })
  await seed.update(state => { state.articles.push(article); state.currentId = article.id })
  const assetV2 = await saveInlineImage(root, PNG)
  await seed.update(state => {
    state.articles[0].title = 'v2'
    state.articles[0].inlineDiagrams = [{ id: 'diagram-v2', assetId: assetV2, format: 'png', status: 'generated' }]
  })
  // 损坏主文件，保留 .bak（v1，不含 assetV2）
  await writeFile(join(root, 'articles', article.id, 'article.json'), '{broken json')

  const warnings = []
  const store = new Store(root)
  const services = {
    connection: { requestRejection: () => undefined },
    logger: { warn: message => warnings.push(message) },
  }
  const handler = createHandler({ get: name => services[name] ?? null }, { store })
  const req = { url: '/wechat-studio/state', method: 'GET', headers: {} }
  let body
  const res = { setHeader() {}, end(value) { body = JSON.parse(value) } }
  await handler(req, res)

  assert.equal(body.current.title, 'v1')
  assert.equal(body.storageProblems.length, 1)
  assert.match(body.storageProblems[0], /主文件已损坏，已回退到上一版备份/)
  assert.equal(warnings.length, 1)
  assert.ok((await readdir(join(root, 'inline-images'))).includes(`${assetV2}.png`))
})


test('未生成建议换位置后必须按新段重新分析，成功后才允许生图', async () => {
  let article
  const llm = {
    prepareCall: async () => ({
      config: {},
      async *stream() {
        yield { type: 'text-delta', text: JSON.stringify({ suggestions: [{
          anchorId: article.blocks[1].id, kind: 'architecture', title: '新段架构关系', reason: '解释新段组件', brief: '分层展示新段的两个组件',
        }] }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }),
  }
  const context = await setup({ llm, fetchImpl: arkSuccess })
  article = context.article
  const diagram = article.inlineDiagrams[0]
  const originalHash = diagram.sourceHash
  const target = article.blocks[1]
  const moved = await context.request('inline-diagrams/reanchor', { id: article.id, diagramId: diagram.id, blockId: target.id })
  assert.ok(!moved.error, moved.error)
  assert.equal(diagram.pendingAnalysis, true)
  assert.equal(diagram.sourceHash, originalHash)
  assert.match(article.inlineMessage.text, /刷新建议.*重新分析/)
  const blocked = await context.request('inline-diagrams/generate', { id: article.id, diagramId: diagram.id, style: 'notebook' })
  assert.match(blocked.error, /重新分析.*刷新建议/)

  await context.request('inline-diagrams/analyze', { id: article.id, blockId: target.id })
  let current = await context.wait()
  assert.equal(current.inlineDiagrams.length, 1)
  assert.equal(current.inlineDiagrams[0].title, '新段架构关系')
  assert.equal(current.inlineDiagrams[0].kind, 'architecture')
  assert.equal(current.inlineDiagrams[0].sourceHash, sourceHash(target.text))
  assert.equal(current.inlineDiagrams[0].pendingAnalysis, undefined)
  const generated = await context.request('inline-diagrams/generate', { id: article.id, diagramId: current.inlineDiagrams[0].id, style: 'notebook' })
  assert.ok(!generated.error, generated.error)
  current = await context.wait()
  assert.equal(current.inlineDiagrams[0].status, 'generated')
})

test('恢复忽略项与现有候选冲突时保留忽略状态', async () => {
  const { store, article, request } = await setup({ fetchImpl: arkSuccess })
  const first = article.blocks[0]
  const second = article.blocks[1]
  await request('inline-diagrams/ignore', { id: article.id, diagramId: 'diagram-1' })
  await store.update(() => {
    article.inlineDiagrams.push({
      id: 'diagram-2', anchorId: second.id, sourceHash: sourceHash(second.text), kind: 'concept',
      title: '移入建议', reason: '另一段建议', brief: '另一个图意', status: 'suggested',
    })
  })
  const moved = await request('inline-diagrams/reanchor', { id: article.id, diagramId: 'diagram-2', blockId: first.id })
  assert.ok(!moved.error, moved.error)
  await assert.rejects(request('inline-diagrams/restore', { id: article.id, diagramId: 'diagram-1' }), /已有插图候选.*保留原忽略状态/)
  const current = await request('state')
  assert.equal(current.current.inlineDiagrams.find(item => item.id === 'diagram-1').status, 'ignored')
  assert.equal(current.current.inlineDiagrams.find(item => item.id === 'diagram-2').status, 'suggested')
  assert.equal(current.current.inlineDiagrams.filter(item => item.anchorId === first.id && item.status !== 'ignored').length, 1)
})

test('带方括号的图注在稿面解析和排版预览中都正常显示', async () => {
  const { store, article, request, wait } = await setup({ fetchImpl: cloudSuccess })
  await seedGenerated(store, article)
  await store.update(() => {
    article.inlineDiagrams[0].title = '流程 [旧版] 图'
    article.inlineDiagrams[0].publicUrl = PUBLIC_URL
  })
  await request('inline-diagrams/insert', {
    id: article.id, diagramId: 'diagram-1', expectedAnchorHash: sourceHash(article.blocks[0].text),
  })
  const current = await wait()
  assert.equal(current.inlineDiagrams[0].status, 'inserted')
  const imageBlock = article.blocks.find(block => block.id === current.inlineDiagrams[0].insertedBlockId)
  assert.equal(blockKind(imageBlock.text), 'media')
  assert.deepEqual(parseMarkdownImage(imageBlock.text), { caption: '流程 [旧版] 图', src: PUBLIC_URL, title: '' })
  const { html } = await renderLayout(toMarkdown(article))
  assert.ok(html.includes(PUBLIC_URL))
  assert.match(html, /流程 \[旧版\] 图/)
})

test('正文插图路由支持 MiniMax：缺 Key 拦截、正常生成与超时非幂等提示', async () => {
  let calls = 0
  const { store, article, request, wait } = await setup({
    fetchImpl: async url => {
      calls++
      assert.equal(url, 'https://api.minimax.cn/v1/images/generations')
      return Response.json({ data: [{ b64_json: PNG.toString('base64') }] })
    },
  })
  await updateSettings(store.root, { coverProvider: 'minimax', minimaxKey: '' })
  const missing = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.match(missing.error, /MiniMax API Key/)

  await updateSettings(store.root, { coverProvider: 'minimax', minimaxKey: 'sk-mm-inline', minimaxModel: 'MiniMax-H3-Image-Highspeed' })
  const started = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.ok(!started.error, started.error)
  const current = await wait()
  assert.equal(calls, 1)
  assert.equal(current.inlineDiagrams[0].status, 'generated')
  assert.equal(current.inlineDiagrams[0].provider, 'minimax')
  assert.equal(current.inlineDiagrams[0].model, 'MiniMax-H3-Image-Highspeed')

  let timeoutCalls = 0
  const timeoutCtx = await setup({
    fetchImpl: async () => {
      timeoutCalls++
      throw new DOMException('timeout', 'TimeoutError')
    },
  })
  await updateSettings(timeoutCtx.store.root, { coverProvider: 'minimax', minimaxKey: 'sk-mm-inline' })
  await timeoutCtx.request('inline-diagrams/generate', { id: timeoutCtx.article.id, diagramId: 'diagram-1', style: 'notebook' })
  const afterTimeout = await timeoutCtx.wait()
  assert.equal(timeoutCalls, 1)
  assert.equal(afterTimeout.inlineDiagrams[0].status, 'failed')
  assert.match(afterTimeout.inlineDiagrams[0].error, /600 秒.*计费/)
  assert.doesNotMatch(afterTimeout.inlineDiagrams[0].error, /请重试/)
})

test('正文插图路由支持 Google Gemini：缺 Key 拦截、自定义 Base URL 透传与 JPEG 自动转 PNG 落盘', async () => {
  const { default: jpegJs } = await import('jpeg-js')
  const jpeg = jpegJs.encode({ data: Buffer.from([255, 0, 0, 255]), width: 1, height: 1 }, 90).data
  const calls = []
  const { store, article, request, wait } = await setup({
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return Response.json({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }] } }],
      })
    },
  })
  await updateSettings(store.root, { coverProvider: 'gemini', geminiKey: '' })
  const missing = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.match(missing.error, /Google Gemini API Key/)

  await updateSettings(store.root, {
    coverProvider: 'gemini',
    geminiKey: 'AIza-inline-route',
    geminiModel: 'gemini-3.1-flash-image',
    geminiBaseUrl: 'https://relay.example.com/v1beta/',
  })
  const started = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.ok(!started.error, started.error)
  const current = await wait()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://relay.example.com/v1beta/models/gemini-3.1-flash-image:generateContent')
  assert.equal(current.inlineDiagrams[0].status, 'generated')
  assert.equal(current.inlineDiagrams[0].provider, 'gemini')
  assert.equal(current.inlineDiagrams[0].model, 'gemini-3.1-flash-image')
})

test('正文插图路由支持 OpenAI：缺 Key 拦截、自定义 Base URL 透传与正常生成', async () => {
  const { default: jpegJs } = await import('jpeg-js')
  const jpeg = jpegJs.encode({ data: Buffer.from([255, 0, 0, 255]), width: 1, height: 1 }, 90).data
  const calls = []
  const { store, article, request, wait } = await setup({
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return Response.json({ data: [{ b64_json: jpeg.toString('base64') }] })
    },
  })
  await updateSettings(store.root, { coverProvider: 'openai', openaiKey: '' })
  const missing = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.match(missing.error, /OpenAI API Key/)

  await updateSettings(store.root, {
    coverProvider: 'openai',
    openaiKey: 'sk-openai-inline-route',
    openaiModel: 'gpt-image-2.6-flare',
    openaiBaseUrl: 'https://relay.example.com/openai/v1/',
  })
  const started = await request('inline-diagrams/generate', { id: article.id, diagramId: 'diagram-1', style: 'notebook' })
  assert.ok(!started.error, started.error)
  const current = await wait()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://relay.example.com/openai/v1/images/generations')
  assert.equal(current.inlineDiagrams[0].status, 'generated')
  assert.equal(current.inlineDiagrams[0].provider, 'openai')
  assert.equal(current.inlineDiagrams[0].model, 'gpt-image-2.6-flare')
})
