import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createArticle } from '../src/article.js'
import { route } from '../src/host.js'
import { PREP_EMPTY } from '../src/prep.js'
import { JsonStore, Store } from '../src/store.js'

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'ws-paper-edit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const store = new Store(root)
  const prepStore = new JsonStore(root, { file: 'prep.json', empty: PREP_EMPTY })
  const deps = {
    ctx: { get: () => null },
    store,
    prepStore,
    pipeline: { job: () => null },
  }

  async function request(path, { method, body } = {}) {
    const req = {
      url: `/wechat-studio/${path}`,
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers: {},
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body))
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
        ended = ct.startsWith('application/json') ? JSON.parse(String(value ?? 'null')) : value
      },
    }
    try {
      await route(deps, req, res)
    } catch (err) {
      res.statusCode = err.status || 500
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: err.message }))
    }
    return { status: res.statusCode, body: ended }
  }

  return { store, request }
}

test('summary/update：保存、折叠空白、按 120 码元安全截断并支持清空', async t => {
  const { store, request } = setup(t)
  const article = createArticle({ markdown: '# 测试稿\n\n第一段正文。' })
  await store.update(state => {
    state.articles.push(article)
    state.currentId = article.id
  })

  const r1 = await request('summary/update', { body: { id: article.id, text: '  这是一条\n自定义   摘要  ' } })
  assert.equal(r1.status, 200)
  assert.equal(r1.body.current.summary, '这是一条 自定义 摘要')

  const longEmoji = '字'.repeat(119) + '🚀'
  const r2 = await request('summary/update', { body: { id: article.id, text: longEmoji } })
  assert.equal(r2.status, 200)
  assert.equal(r2.body.current.summary, '字'.repeat(119))

  const r3 = await request('summary/update', { body: { id: article.id, text: '   ' } })
  assert.equal(r3.status, 200)
  assert.equal(r3.body.current.summary, '')
})

test('block/append 与 block/move：支持任意位置插段、文末续写、上下移段与撤销', async t => {
  const { store, request } = setup(t)
  const article = createArticle({ markdown: '# 标题\n\n第一段\n\n第二段' })
  await store.update(state => {
    state.articles.push(article)
    state.currentId = article.id
  })

  const firstId = article.blocks[0].id
  const ins = await request('block/append', {
    body: { id: article.id, afterBlockId: firstId, text: '中间段A\n\n中间段B' },
  })
  assert.equal(ins.status, 200)
  assert.deepEqual(ins.body.current.blocks.map(b => b.text), ['第一段', '中间段A', '中间段B', '第二段'])

  const midBId = ins.body.current.blocks[2].id
  const movedUp = await request('block/move', { body: { id: article.id, blockId: midBId, direction: 'up' } })
  assert.equal(movedUp.status, 200)
  assert.deepEqual(movedUp.body.current.blocks.map(b => b.text), ['第一段', '中间段B', '中间段A', '第二段'])

  // 边界不越界、非法方向报 400
  const badDir = await request('block/move', { body: { id: article.id, blockId: midBId, direction: 'sideways' } })
  assert.equal(badDir.status, 400)

  const topNoop = await request('block/move', { body: { id: article.id, blockId: firstId, direction: 'up' } })
  assert.equal(topNoop.status, 200)
  assert.deepEqual(topNoop.body.current.blocks.map(b => b.text), ['第一段', '中间段B', '中间段A', '第二段'])

  // 撤销恢复上一次顺序
  const undone = await request('undo', { body: { id: article.id } })
  assert.equal(undone.status, 200)
  assert.deepEqual(undone.body.current.blocks.map(b => b.text), ['第一段', '中间段A', '中间段B', '第二段'])
})

test('block/replace-all：支持单段与全文替换、大小写敏感、清理空段与一键撤销', async t => {
  const { store, request } = setup(t)
  const article = createArticle({ markdown: '# 标题\n\nDeepSeek 很好用，deepseek 很快。\n\n另一段也有 DeepSeek。\n\n仅含 deepseek' })
  await store.update(state => {
    state.articles.push(article)
    state.currentId = article.id
  })

  // 单段区分大小写替换
  const firstId = article.blocks[0].id
  const one = await request('block/replace-all', {
    body: { id: article.id, blockId: firstId, find: 'DeepSeek', replace: 'DS', caseSensitive: true },
  })
  assert.equal(one.status, 200)
  assert.deepEqual(one.body.replaced, { count: 1, blocks: 1 })
  assert.equal(one.body.current.blocks[0].text, 'DS 很好用，deepseek 很快。')
  assert.equal(one.body.current.blocks[1].text, '另一段也有 DeepSeek。')

  // 全文不区分大小写替换
  const all = await request('block/replace-all', {
    body: { id: article.id, find: 'deepseek', replace: 'DS', caseSensitive: false },
  })
  assert.equal(all.status, 200)
  assert.deepEqual(all.body.replaced, { count: 3, blocks: 3 })
  assert.deepEqual(all.body.current.blocks.map(b => b.text), ['DS 很好用，DS 很快。', '另一段也有 DS。', '仅含 DS'])

  // 一键撤销全文替换
  const undone = await request('undo', { body: { id: article.id } })
  assert.equal(undone.status, 200)
  assert.equal(undone.body.current.blocks[1].text, '另一段也有 DeepSeek。')

  // 空查找词报错
  const empty = await request('block/replace-all', { body: { id: article.id, find: '', replace: 'x' } })
  assert.equal(empty.status, 400)
})
