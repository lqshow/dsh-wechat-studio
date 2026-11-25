import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { callModel, loadSkill, skillSources, extractJson } from '../src/ai.js'
import { createArticle } from '../src/article.js'
import {
  articleSourceHash,
  buildDerivePrompt,
  deleteDerivative,
  derivativesView,
  generateDerivative,
  prepareDerivePrompt,
  redesignXhsCard,
  updateDerivative,
} from '../src/derive.js'
import { cardContentVersion, computeDomTopologySignature, sanitizeXhsCardHtml } from '../src/derive-shared.js'
import { portableBlocks } from '../src/derive-markdown.js'
import { updateSettings } from '../src/settings.js'
import { Store } from '../src/store.js'

function setupStore(markdown = '# 实操复盘\n\n第一段核心结论，增长 1,200 人。\n\n第二段具体步骤，先做最小版本再收集反馈。\n\n设为「星标」') {
  const root = mkdtempSync(join(tmpdir(), 'ws-derive-'))
  const store = new Store(root)
  const article = createArticle({ markdown })
  return { root, store, article }
}

function makeFakeCtx(outputs) {
  const queue = Array.isArray(outputs) ? [...outputs] : [outputs]
  const calls = []
  let beforeStream = null
  const llm = {
    prepareCall() {
      return {
        config: {},
        async *stream(request) {
          calls.push(request)
          if (beforeStream) await beforeStream()
          const next = queue.length > 1 ? queue.shift() : queue[0]
          const text = typeof next === 'function' ? next(request) : typeof next === 'string' ? next : JSON.stringify(next)
          yield { type: 'text-delta', text }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const services = { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }
  return {
    ctx: { get: name => services[name] ?? null },
    calls,
    setBeforeStream(fn) { beforeStream = fn },
    setOutputs(list) { queue.splice(0, queue.length, ...(Array.isArray(list) ? list : [list])) },
  }
}

test('articleSourceHash 对正文和标题敏感，对质检标记不敏感', () => {
  const { article } = setupStore()
  const h1 = articleSourceHash(article)
  article.blocks[0].check = { status: 'flag', level: 'ai', score: 0.9 }
  assert.equal(articleSourceHash(article), h1)
  article.blocks[0].text += ' 加字'
  assert.notEqual(articleSourceHash(article), h1)
})

test('buildDerivePrompt 按段过滤 fixedLines 并按需注入个人声音与 30000 字截断', () => {
  const { article } = setupStore()
  const { blocks } = portableBlocks(article, { fixedLines: ['设为「星标」'] })
  assert.equal(blocks.length, 2)

  const withProfile = buildDerivePrompt({
    article,
    platform: 'thread',
    variant: 'jike',
    blocks,
    profile: {
      voice: ['老程序员口吻，直接讲重点'],
      phrases: ['说白了'],
      taboos: ['赋能', '抓手'],
    },
    skill: '平台技能说明',
  })
  assert.match(withProfile.system, /个人声音/)
  assert.match(withProfile.system, /老程序员口吻/)
  assert.match(withProfile.system, /禁止使用.*赋能/)
  const parsedUser = JSON.parse(withProfile.user)
  assert.equal(parsedUser.blocks.length, 2)

  const withoutProfile = buildDerivePrompt({
    article,
    platform: 'xhs',
    blocks,
    profile: null,
    skill: '小红书技能',
  })
  assert.doesNotMatch(withoutProfile.system, /个人声音/)

  const hugeBlocks = Array.from({ length: 10 }, (_, i) => ({
    id: `b${i}`,
    text: '甲'.repeat(5000),
  }))
  const truncated = buildDerivePrompt({
    article,
    platform: 'thread',
    variant: 'x',
    blocks: hugeBlocks,
    profile: null,
    skill: '技能',
  })
  const parsedHuge = JSON.parse(truncated.user)
  assert.equal(parsedHuge.blocks.length, 6)
  assert.ok(parsedHuge.blocks.reduce((s, b) => s + b.text.length, 0) <= 30000)

  const referenceImages = Array.from({ length: 12 }, (_, index) => (
    `data:image/png;base64,${Buffer.from(`reference-${index}`).toString('base64')}`
  ))
  const withReferences = buildDerivePrompt({
    article,
    platform: 'xhs',
    blocks,
    profile: null,
    skill: '小红书技能',
    referenceImages,
  })
  const referenceUser = JSON.parse(withReferences.user)
  assert.equal(withReferences.referenceImages.length, 10)
  assert.deepEqual(referenceUser.referenceImageIds, Array.from({ length: 10 }, (_, index) => `ref-${index + 1}`))
  assert.match(withReferences.system, /referencePlan/)
  assert.match(withReferences.system, /复用/)
  assert.match(withReferences.system, /自由设计/)
})

test('generateDerivative 正常生成、失败带错误反馈重试一次、两次失败报 502', async () => {
  const { root, store, article } = setupStore()
  await updateSettings(root, { fixedLines: ['设为「星标」'] })
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const validThread = {
    posts: [
      { text: '第一条钩子：增长 1,200 人的复盘', source: [b1.id] },
      { text: '第二条：先做最小可用版本再收集反馈，新增一个 99% 数字', source: [b2.id] },
      { text: '第三条收尾互动', source: [] },
    ],
  }

  // 首次返回非法 JSON，第二次返回合法 JSON
  const fake = makeFakeCtx(['不是JSON', validThread])
  const record = await generateDerivative(fake.ctx, store, { id: article.id, platform: 'thread', variant: 'jike' })
  assert.equal(fake.calls.length, 2)
  const retryReq = JSON.parse(fake.calls[1].messages[0].content[0].text)
  assert.ok(typeof retryReq.previousError === 'string' && retryReq.previousError.length > 0)
  assert.equal(record.platform, 'thread')
  assert.equal(record.variant, 'jike')
  assert.equal(record.editedAt, null)
  assert.ok(record.warnings.some(w => w.includes('99%')))

  // 两次都失败（例如只有 1 条）-> 502
  fake.setOutputs([{ posts: [{ text: '太少' }] }, { posts: [{ text: '还是太少' }] }])
  await assert.rejects(
    () => generateDerivative(fake.ctx, store, { id: article.id, platform: 'thread', variant: 'x', confirmOverwrite: true }),
    err => err.status === 502 && /至少.*3 条/.test(err.message),
  )
})

test('手改覆盖保护、生成期间母稿修改标 stale、归档 409 与空正文 400', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const validXhs = {
    title: '增长 1200 人实操',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '增长 1200 人复盘', lines: ['先做最小版本'], source: [b1.id] },
      { kind: 'quote', heading: '核心方法', lines: ['第一段核心结论，增长 1,200 人。'], source: [b1.id] },
      { kind: 'list', heading: '执行步骤', lines: ['先做最小版本', '再收集真实反馈'], source: [b2.id] },
      { kind: 'quote', heading: '', lines: ['第二段具体步骤，先做最小版本再收集反馈。'], source: [b2.id] },
      { kind: 'end', heading: '点个收藏', lines: ['欢迎评论区交流'], source: [] },
    ],
  }

  const fake = makeFakeCtx(validXhs)
  await generateDerivative(fake.ctx, store, { id: article.id, platform: 'xhs' })

  // 手改后不带 confirmOverwrite 被拒绝 409 code='edited'
  await updateDerivative(store, {
    id: article.id,
    platform: 'xhs',
    payload: { ...validXhs, title: '手改过的标题' },
  })
  await assert.rejects(
    () => generateDerivative(fake.ctx, store, { id: article.id, platform: 'xhs' }),
    err => err.status === 409 && err.code === 'edited',
  )

  // 生成期间母稿被改 -> 落盘后立刻判定为 stale === true
  fake.setBeforeStream(async () => {
    await store.update(state => {
      const target = state.articles.find(a => a.id === article.id)
      target.blocks[0].text = '生成期间改写了第一段，增长 2,500 人。'
    })
  })
  await generateDerivative(fake.ctx, store, { id: article.id, platform: 'xhs', confirmOverwrite: true })
  const latest = (await store.read()).articles.find(a => a.id === article.id)
  const viewList = derivativesView(latest)
  assert.equal(viewList.length, 1)
  assert.equal(viewList[0].stale, true)

  // updateDerivative 非法返回 400
  await assert.rejects(
    () => updateDerivative(store, { id: article.id, platform: 'xhs', payload: { ...validXhs, title: '字'.repeat(25) } }),
    err => err.status === 400,
  )

  // deleteDerivative 删除与幂等
  await deleteDerivative(store, { id: article.id, platform: 'xhs' })
  await deleteDerivative(store, { id: article.id, platform: 'xhs' })
  const afterDelete = (await store.read()).articles.find(a => a.id === article.id)
  assert.deepEqual(derivativesView(afterDelete), [])

  // 归档拒绝
  await store.update(state => { state.articles.find(a => a.id === article.id).archivedAt = new Date().toISOString() })
  await assert.rejects(
    () => generateDerivative(fake.ctx, store, { id: article.id, platform: 'thread' }),
    err => err.status === 409,
  )
  await assert.rejects(
    () => deleteDerivative(store, { id: article.id, platform: 'thread' }),
    err => err.status === 409,
  )

  // 空正文拒绝 400
  const empty = createArticle({ markdown: '# 只有标题\n\n设为「星标」' })
  await updateSettings(store.root, { fixedLines: ['设为「星标」'] })
  await store.update(state => { state.articles.push(empty) })
  await assert.rejects(
    () => prepareDerivePrompt(empty, { platform: 'thread', root: store.root }),
    err => err.status === 400 && /正文为空/.test(err.message),
  )
})

test('内置 repurpose-thread 与 repurpose-xhs skill 可读取且进入 skillSources', async () => {
  const threadSkill = await loadSkill('repurpose-thread')
  const xhsSkill = await loadSkill('repurpose-xhs')
  assert.match(threadSkill, /串推/)
  assert.match(xhsSkill, /小红书/)

  const sources = await skillSources()
  assert.ok(sources.some(s => s.name === 'repurpose-thread' && s.source === 'bundled'))
  assert.ok(sources.some(s => s.name === 'repurpose-xhs' && s.source === 'bundled'))
})

test('小红书派生：定向修复重试携带 previousOutput 与全部错误，轻微偏长放行并附提醒', async () => {
  const { store, article } = setupStore()
  article.blocks.push({ id: 'img1', text: '![架构图](https://cdn.example.com/arch.png)', check: null })
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const makeXhs = (longEndLine, heading = '核心步骤') => ({
    title: '增长 1200 人实操',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '增长 1200 人复盘', lines: ['先做最小版本'], source: [b1.id] },
      { kind: 'quote', heading: '核心方法', lines: ['第一段核心结论，增长 1,200 人。'], source: [b1.id] },
      { kind: 'list', heading, lines: ['第一步先做最小版本', '第二步收集真实反馈'], source: [b2.id] },
      { kind: 'quote', heading: '', lines: ['第二段具体步骤，先做最小版本再收集反馈。'], source: [b2.id] },
      { kind: 'grid', heading: '避坑清单', lines: ['别等完美 | 先上线拿反馈', '控制范围 | 每次只改一个点'], source: [b2.id] },
      { kind: 'end', heading: '点个收藏', lines: [longEndLine], source: [] },
    ],
  })

  // 1. 第 1 轮两处偏长，第 2 轮仍有一个 37 字 -> 携带 previousOutput 重试后，放行落盘并带提醒；同时 prompt 携带 images
  const over37 = '字'.repeat(37)
  const round1 = makeXhs(over37, '十八字卡片标题用来测试同时多点报错')
  const round2 = {
    ...round1,
    cards: round1.cards.map((c, idx) => (idx === 2 ? { ...c, heading: '核心步骤' } : c)),
  }
  const fake = makeFakeCtx([round1, round2])
  const saved = await generateDerivative(fake.ctx, store, { id: article.id, platform: 'xhs' })
  assert.equal(fake.calls.length, 2)
  const retryBody = JSON.parse(fake.calls[1].messages[0].content[0].text)
  assert.ok(retryBody.previousOutput, '重试应附带 previousOutput 供局部修改')
  assert.ok(retryBody.repairInstruction, '重试应附带局部修复指令')
  assert.equal(retryBody.images?.[0]?.url, 'https://cdn.example.com/arch.png')
  assert.match(retryBody.previousError, /第 3 页卡片标题/)
  assert.match(retryBody.previousError, /第 6 页第 1 行/)
  assert.ok(saved.warnings.some(w => w.includes('第 6 页第 1 行偏长') && w.includes('37 字')))

  // 2. 第 1 轮仅单行 37 字偏长，第 2 轮意外返回损坏 JSON -> 回退采用第 1 轮结果并带提醒
  const onlySoftIssue = makeXhs('短行', '核心步骤')
  onlySoftIssue.cards[5].lines = ['第一行正常', over37]
  const fakeFallback = makeFakeCtx([onlySoftIssue, '坏掉的非JSON回复'])
  const fallbackSaved = await generateDerivative(fakeFallback.ctx, store, {
    id: article.id,
    platform: 'xhs',
    confirmOverwrite: true,
  })
  assert.ok(fallbackSaved.warnings.some(w => w.includes('第 6 页第 2 行偏长') && w.includes('37 字')))

  // 3. updateDerivative 允许保存带 37 字卡片行的编辑，仍拦截 25 字笔记标题
  const updated = await updateDerivative(store, {
    id: article.id,
    platform: 'xhs',
    payload: onlySoftIssue,
  })
  assert.ok(updated.warnings.some(w => w.includes('第 6 页第 2 行偏长')))
  await assert.rejects(
    () => updateDerivative(store, { id: article.id, platform: 'xhs', payload: { ...onlySoftIssue, title: '字'.repeat(25) } }),
    err => err.status === 400,
  )
})

test('小红书蓝图截断时提高重试预算，受模型配置限制且保留完整蓝图', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks
  const valid = {
    title: '实操复盘',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '实操复盘', lines: ['先做最小版本'], source: [b1.id] },
      { kind: 'quote', heading: '核心方法', lines: ['第一段核心结论，增长 1,200 人。'], source: [b1.id] },
      { kind: 'list', heading: '执行步骤', lines: ['先做最小版本', '再收集真实反馈'], source: [b2.id] },
      { kind: 'quote', heading: '', lines: ['第二段具体步骤，先做最小版本再收集反馈。'], source: [b2.id] },
      { kind: 'end', heading: '点个收藏', lines: ['欢迎评论区交流'], source: [] },
    ],
  }
  const truncated = '<xhs-meta>{"title":"实操复盘","cards":['
  const complete = `<xhs-meta>${JSON.stringify(valid)}</xhs-meta>`
  for (const scenario of [
    { limit: 64_000, texts: [truncated, complete], budgets: [6144, 16384] },
    { limit: 10_000, texts: [truncated, truncated], budgets: [6144, 10000], error: /版式蓝图.*10000 tokens/ },
    { limit: 4096, texts: [truncated, complete], budgets: [4096, 4096] },
    { texts: ['', complete], budgets: [6144, 16384] },
    { texts: [complete], budgets: [6144] },
    { texts: ['', ''], budgets: [6144, 6144], finish: 'stop', error: /没有返回正文/ },
    { texts: ['格式不对', complete], budgets: [6144, 6144], finish: 'stop' },
  ]) {
    const progress = []
    const pending = [...scenario.texts]
    const budgets = []
    const llm = {
      async resolveModelInfo() { return { defaultMaxTokens: scenario.limit } },
      prepareCall({ maxTokens }) {
        budgets.push(maxTokens)
        return {
          config: {},
          async *stream() {
            const text = pending.shift()
            if (text) yield { type: 'text-delta', text }
            else yield { type: 'reasoning-delta', text: '模型正在规划版式' }
            yield { type: 'finish', reason: { kind: scenario.finish ?? 'max-tokens' } }
          },
        }
      },
    }
    const ctx = { get: name => name === 'llm' ? llm : { currentSelection: () => ({ provider: 'p', model: 'm' }) } }
    const generate = () => generateDerivative(ctx, store, {
      id: article.id, platform: 'xhs', stagedHtml: false, onProgress: item => progress.push(item),
    })
    if (scenario.error) await assert.rejects(generate, scenario.error)
    else assert.equal((await generate()).payload.title, valid.title)
    assert.deepEqual(budgets, scenario.budgets)
    if (budgets[1] > budgets[0]) assert.ok(progress.some(item => item.message.includes('提高输出预算')))
  }
})

test('extractJson 自动修复模型输出中的未转义双引号、裸换行、尾随逗号与 <think> 块', () => {
  const dirtyOutput = `<think>先构思一下小红书卡片内容</think>
\`\`\`json
{
  "title": "两个 "Agent" 关进同一房间",
  "body": "第一段正文包含裸换行
第二段继续讲 "Claude": 为什么能和 Codex 共享上下文",
  "callout": "Codex 的建议是针对性的，不是泛泛的 "加个异常处理"",
  "lines": [
    "在对话框输入 "@", 直接引用对方的历史对话",
    "点击 "开启" 按钮",
  ],
  "html": "<div class="cd-header">测试未转义属性</div>",
}
\`\`\``

  const parsed = extractJson(dirtyOutput)
  assert.ok(parsed, 'extractJson 应成功解析带未转义引号与尾随逗号的 JSON')
  assert.equal(parsed.title, '两个 "Agent" 关进同一房间')
  assert.equal(parsed.callout, 'Codex 的建议是针对性的，不是泛泛的 "加个异常处理"')
  assert.equal(parsed.lines[0], '在对话框输入 "@", 直接引用对方的历史对话')
  assert.equal(parsed.html, '<div class="cd-header">测试未转义属性</div>')
})

test('小红书分阶段自由 HTML/CSS 生成：按页分发参考图、designPrompt 注入、分批精绘、单页失败回退不丢弃整套、相邻拓扑自动去重', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const stage1Markup = `<xhs-meta>
{
  "deckStyle": "tech",
  "tweaks": { "preset": "claude" },
  "title": "增长 1200 人实操",
  "body": "${'这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2)}",
  "tags": ["实操复盘", "最小版本", "个人经验"],
  "cards": [
    { "kind": "cover", "layoutArchetype": "editorial-hero", "heading": "增长 1200 人复盘", "lines": ["先做最小版本"], "source": ["${b1.id}"] },
    { "kind": "compare", "layoutArchetype": "before-after-table", "heading": "旧做法与新做法", "lines": ["以前 | 手动折腾", "现在 | 一键出稿"], "source": ["${b1.id}"] },
    { "kind": "steps", "layoutArchetype": "timeline-steps", "heading": "三步跑通流程", "lines": ["第一步 | 先做最小版本", "第二步 | 收集真实反馈", "第三步 | 固化模板"], "source": ["${b2.id}"] },
    { "kind": "grid", "layoutArchetype": "quad-bento", "heading": "四个核心亮点", "lines": ["亮点一 | 结构稳定", "亮点二 | 配色正交"], "source": ["${b2.id}"] },
    { "kind": "end", "layoutArchetype": "dark-finale", "heading": "点个收藏", "lines": ["欢迎评论区交流"], "source": [] }
  ],
  "referencePlan": {
    "images": [
      { "id": "ref-1", "role": "cover", "reason": "封面主视觉" },
      { "id": "ref-2", "role": "content", "reason": "对比布局" },
      { "id": "ref-3", "role": "content", "reason": "步骤布局" },
      { "id": "ref-4", "role": "content", "reason": "矩阵布局" },
      { "id": "ref-5", "role": "style", "reason": "共享风格" }
    ],
    "sharedImageIds": ["ref-5"],
    "pages": [
      { "page": 1, "imageIds": ["ref-1"] },
      { "page": 2, "imageIds": ["ref-2"] },
      { "page": 3, "imageIds": ["ref-3", "ref-2"] },
      { "page": 4, "imageIds": ["ref-4"] }
    ]
  }
}
</xhs-meta>
<xhs-style>
body { display: none; }
.story-badge { color: var(--xhs-accent); font-weight: 800; }
</xhs-style>`

  // 故意让第 2 页和第 3 页返回完全相同的 DOM 拓扑，验证阶段 3 会自动定向重设计第 3 页
  const dupTopologyHtml = '<section><header><h2>同构标题</h2></header><ul><li>第一项</li><li>第二项</li></ul></section>'
  const batch1Markup = `
<xhs-page-style page="1">.hero-band { border-bottom: 2px solid var(--xhs-accent); }</xhs-page-style>
<xhs-card page="1"><div class="hero-band"><h1>增长 1200 人复盘</h1><p>先做最小版本</p></div></xhs-card>
<xhs-card page="2">${dupTopologyHtml}</xhs-card>
<xhs-card page="3">${dupTopologyHtml}</xhs-card>
`
  // 第 2 批故意只返回第 4 页，缺失第 5 页；随后的单页重试也返回空 -> 第 5 页回退保留空 html 不丢弃整套
  const batch2Markup = `
<xhs-card page="4"><article><h2>四个核心亮点</h2><div class="grid"><div>亮点一</div><div>亮点二</div></div></article></xhs-card>
`
  // 阶段 3 定向修复第 3 页，换一种截然不同的表格拓扑
  const dedupRepairMarkup = `
<xhs-page-style page="3">.step-table { border-color: var(--xhs-line); }</xhs-page-style>
<xhs-card page="3"><div class="step-table"><h2>三步跑通流程</h2><table><tbody><tr><td>01</td><td>先做最小版本</td></tr></tbody></table></div></xhs-card>
`

  const fake = makeFakeCtx([
    stage1Markup,
    batch1Markup,
    batch2Markup,
    '无效返回1',
    '无效返回2',
    dedupRepairMarkup,
  ])

  const record = await generateDerivative(fake.ctx, store, {
    id: article.id,
    platform: 'xhs',
    designPrompt: '杂志画报风，克制留白，强对比排版',
    referenceImages: Array.from({ length: 5 }, (_, index) => (
      `data:image/png;base64,${Buffer.from(`reference-${index}`).toString('base64')}`
    )),
  })

  const imageIdsFrom = call => call.messages[0].content
    .filter(part => part.type === 'text' && /^\[参考图 ref-/.test(part.text))
    .map(part => /^\[参考图 (ref-\d+)\]$/.exec(part.text)[1])
  assert.deepEqual(imageIdsFrom(fake.calls[0]), ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5'])
  assert.deepEqual(imageIdsFrom(fake.calls[1]), ['ref-5', 'ref-1', 'ref-2', 'ref-3'])
  assert.deepEqual(imageIdsFrom(fake.calls[2]), ['ref-5', 'ref-4'])
  const batch1User = JSON.parse(fake.calls[1].messages[0].content[0].text)
  assert.deepEqual(batch1User.targetCards[0].referenceImageIds, ['ref-5', 'ref-1'])
  assert.deepEqual(batch1User.targetCards[1].referenceImageIds, ['ref-5', 'ref-2'])
  assert.deepEqual(batch1User.targetCards[2].referenceImageIds, ['ref-5', 'ref-3', 'ref-2'], 'ref-2 可跨页复用')
  const batch2User = JSON.parse(fake.calls[2].messages[0].content[0].text)
  assert.deepEqual(batch2User.targetCards[1].referenceImageIds, ['ref-5'], '未分配页只携带共享风格图')
  assert.deepEqual(imageIdsFrom(fake.calls[3]), ['ref-5'], '单页失败重试不广播全部图片')
  assert.deepEqual(imageIdsFrom(fake.calls[4]), ['ref-5'])
  assert.deepEqual(imageIdsFrom(fake.calls[5]), ['ref-5', 'ref-3', 'ref-2'], '拓扑去重只携带目标页图片')

  // 验证 designPrompt 注入到 Stage 1 请求并保存
  assert.match(fake.calls[0].system, /杂志画报风/)
  assert.equal(record.payload.designPrompt, '杂志画报风，克制留白，强对比排版')
  // 验证 customCss 已净化并限定 .xhs-artboard
  assert.ok(record.payload.customCss.includes('.xhs-artboard .story-badge'))
  assert.doesNotMatch(record.payload.customCss, /(?:^|\n)body\s*\{/)
  // 第 1、2、3、4 页均已获得自由 HTML，第 5 页未崩溃而是回退为 ''
  assert.ok(record.payload.cards[0].html.includes('hero-band'))
  assert.ok(record.payload.cards[0].pageCss.includes('.xhs-artboard .hero-band'))
  assert.equal(record.payload.cards[4].html ?? '', '')
  // 第 2 页与第 3 页经过阶段 3 去重后拓扑不再相同
  const sig2 = computeDomTopologySignature(record.payload.cards[1].html)
  const sig3 = computeDomTopologySignature(record.payload.cards[2].html)
  assert.notEqual(sig2, sig3, '阶段 3 应将相邻同构页定向重设计为不同 DOM 拓扑')
})

test('无参考图计划时后续调用不带图片、按内容自由设计并追加警告', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks
  const stage1 = {
    title: '无计划自由设计',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', layoutArchetype: 'hero', heading: '封面', lines: ['先做最小版本'], source: [b1.id] },
      { kind: 'compare', layoutArchetype: 'compare', heading: '对比', lines: ['以前 | 慢', '现在 | 快'], source: [b1.id] },
      { kind: 'steps', layoutArchetype: 'steps', heading: '步骤', lines: ['一步 | a', '二步 | b', '三步 | c'], source: [b2.id] },
      { kind: 'grid', layoutArchetype: 'grid', heading: '矩阵', lines: ['模块一 | 稳', '模块二 | 快'], source: [b2.id] },
      { kind: 'end', layoutArchetype: 'end', heading: '收尾', lines: ['先收藏'], source: [] },
    ],
  }
  const batch1 = `
<xhs-card page="1"><div class="p1"><h1>封面</h1><p>最小版本</p></div></xhs-card>
<xhs-card page="2"><section><table><tbody><tr><td>以前</td><td>现在</td></tr></tbody></table></section></xhs-card>
<xhs-card page="3"><article><ol><li>一步</li><li>二步</li><li>三步</li></ol></article></xhs-card>`
  const batch2 = `
<xhs-card page="4"><div class="p4"><h2>矩阵</h2><div><span>模块一</span><span>模块二</span></div></div></xhs-card>
<xhs-card page="5"><footer class="p5"><h2>收尾</h2><p>先收藏</p></footer></xhs-card>`
  const fake = makeFakeCtx([stage1, batch1, batch2])
  const record = await generateDerivative(fake.ctx, store, {
    id: article.id,
    platform: 'xhs',
    referenceImages: ['data:image/png;base64,AA==', 'data:image/png;base64,BB=='],
  })
  assert.equal(fake.calls.length, 3)
  assert.ok(fake.calls[0].messages[0].content.some(part => part.type === 'image'))
  for (const call of fake.calls.slice(1)) {
    assert.equal(call.messages[0].content.some(part => part.type === 'image'), false)
    const user = JSON.parse(call.messages[0].content[0].text)
    assert.ok(user.targetCards.every(card => card.referenceImageIds.length === 0))
  }
  assert.ok(record.warnings.includes('参考图自动分配未完成，相关页面将按内容自由设计。'))
})

test('redesignXhsCard 局部写回只替换目标页、保留并发修改的其它页，并在 baseCardHash 冲突时返回 409', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const initialXhs = {
    title: '增长 1200 人实操',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '封面原题', lines: ['先做最小版本'], html: '<div class="c1"><h1>封面原题</h1></div>', source: [b1.id] },
      { kind: 'compare', heading: '第2页旧版', lines: ['以前 | 手动', '现在 | 自动'], html: '<div class="c2"><h2>第2页旧版</h2></div>', source: [b1.id] },
      { kind: 'steps', heading: '第3页原版', lines: ['第一步 | 验证'], html: '<div class="c3"><h2>第3页原版</h2></div>', source: [b2.id] },
      { kind: 'grid', heading: '第4页原版', lines: ['要点 | 保持原样'], html: '<div class="c4"><h2>第4页原版</h2></div>', source: [b2.id] },
      { kind: 'end', heading: '收尾', lines: ['先收藏'], source: [] },
    ],
  }

  const fakeInit = makeFakeCtx(initialXhs)
  await generateDerivative(fakeInit.ctx, store, { id: article.id, platform: 'xhs', stagedHtml: false })

  const beforeCard2 = (await store.read()).articles[0].derivatives.xhs.payload.cards[1]
  const baseHash2 = cardContentVersion(beforeCard2)

  // 1. 重设计第 2 页期间，用户并发修改了第 3 页 -> 第 2 页落盘后，第 3 页的用户修改完好保留！
  const fakeRedesign = makeFakeCtx(
    '<xhs-page-style page="2">.split-v2 { display: grid; grid-template-columns: 1fr 1fr; }</xhs-page-style><xhs-card page="2"><div class="split-v2"><h2>第2页新版双栏</h2><p>全新构图</p></div></xhs-card>',
  )
  fakeRedesign.setBeforeStream(async () => {
    await store.update(state => {
      const target = state.articles.find(a => a.id === article.id)
      target.derivatives.xhs.payload.cards[2].heading = '第3页并发手改标题'
      target.derivatives.xhs.payload.cards[2].html = '<div class="c3-edited"><h2>第3页并发手改标题</h2></div>'
    })
  })

  const updated = await redesignXhsCard(fakeRedesign.ctx, store, {
    id: article.id,
    cardIndex: 1,
    cardPrompt: '改成左右双栏对比卡片',
    baseCardHash: baseHash2,
  })
  assert.ok(updated.payload.cards[1].html.includes('split-v2'))
  assert.ok(updated.payload.cards[1].pageCss.includes('.xhs-artboard .split-v2'))
  assert.equal(updated.payload.cards[2].heading, '第3页并发手改标题')
  assert.ok(updated.payload.cards[2].html.includes('c3-edited'))

  // 2. 用过期的 baseCardHash 再次重设计第 2 页 -> 409 code='card_conflict'
  await assert.rejects(
    () => redesignXhsCard(fakeRedesign.ctx, store, {
      id: article.id,
      cardIndex: 1,
      cardPrompt: '再换一种',
      baseCardHash: baseHash2,
    }),
    err => err.status === 409 && err.code === 'card_conflict',
  )
})

test('手动单页重设计复用批量精绘参考逻辑并修复深色文字对比度', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA=='
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks
  const initialXhs = {
    title: '单页参考对齐测试',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '封面', lines: ['先做最小版本'], source: [b1.id] },
      { kind: 'compare', heading: '对比', lines: ['以前 | 手动', '现在 | 自动'], source: [b1.id] },
      { kind: 'steps', heading: '步骤', lines: ['第一步 | 验证', '第二步 | 收集', '第三步 | 固化'], source: [b2.id] },
      { kind: 'grid', heading: '矩阵', lines: ['模块一 | 清晰', '模块二 | 稳定'], source: [b2.id] },
      { kind: 'end', heading: '收尾', lines: ['先收藏'], source: [] },
    ],
  }
  const fakeInit = makeFakeCtx(initialXhs)
  await generateDerivative(fakeInit.ctx, store, { id: article.id, platform: 'xhs', stagedHtml: false })

  const longReferenceCss = [
    '.ref-dark { background: var(--xhs-dark); color: var(--xhs-ink); }',
    ...Array.from({ length: 45 }, (_, index) => `.filler-${index} { margin: ${index}px; padding: 20px; }`),
    '.cv2-tiles { display: grid; grid-template-columns: repeat(5, 1fr); }',
    '.cv2-box { width: 88px; height: 88px; }',
    '.cv2-list { display: flex; flex-direction: column; }',
  ].join('\n')
  assert.ok(longReferenceCss.length > 2000 && longReferenceCss.length < 4000)
  const fake = makeFakeCtx(`<xhs-page-style page="1">${longReferenceCss}</xhs-page-style><xhs-card page="1"><div class="ref-dark"><h1>参考图封面</h1><p>正文</p></div><div style="background:var(--xhs-dark)"><span>内联深色区</span></div></xhs-card>`)
  const updated = await redesignXhsCard(fake.ctx, store, {
    id: article.id,
    cardIndex: 0,
    cardPrompt: '参考这张图重新画',
    referenceImages: [tinyPng, tinyJpeg],
  })

  const request = fake.calls[0]
  assert.match(request.system, /阶段 2：分批自由 HTML\/CSS 精绘任务/)
  assert.match(request.system, /内联 SVG\/CSS/)
  assert.match(request.system, /单列纵向布局/)
  assert.match(request.system, /中性色|黑\/白\/灰/)
  assert.doesNotMatch(request.system, /禁止与整套卡片中任意其他页/)
  const parts = request.messages[0].content
  const labels = parts.filter(part => part.type === 'text').map(part => part.text)
  assert.ok(labels.includes('[参考图 ref-1]'))
  assert.ok(labels.includes('[参考图 ref-2]'))
  const user = JSON.parse(parts[0].text)
  assert.deepEqual(user.targetCards[0].referenceImageIds, ['ref-1', 'ref-2'])
  assert.equal(user.targetCards[0].kind, 'cover')
  assert.match(updated.payload.cards[0].pageCss, /\.ref-dark \*/)
  assert.match(updated.payload.cards[0].pageCss, /#FFFFFF\s*!important/)
  assert.match(updated.payload.cards[0].pageCss, /\[style\*="var\(--xhs-dark\)"\]/)
  assert.match(updated.payload.cards[0].pageCss, /\.cv2-tiles/)
  assert.match(updated.payload.cards[0].pageCss, /\.cv2-box/)
  assert.match(updated.payload.cards[0].pageCss, /\.cv2-list/)

  const excessiveCss = `${longReferenceCss}\n${Array.from({ length: 60 }, (_, index) => `.extra-${index} { margin: ${index}px; padding: 20px; }`).join('\n')}`
  assert.ok(excessiveCss.length > 4000)
  const retryFake = makeFakeCtx([
    `<xhs-page-style page="1">${excessiveCss}</xhs-page-style><xhs-card page="1"><div class="ref-dark"><h1>不应保存截断样式</h1></div></xhs-card>`,
    '<xhs-page-style page="1">.final-rules { display: flex; }</xhs-page-style><xhs-card page="1"><div class="final-rules"><h1>完整重试结果</h1></div></xhs-card>',
  ])
  const retried = await redesignXhsCard(retryFake.ctx, store, {
    id: article.id,
    cardIndex: 0,
    cardPrompt: '重新生成但保持样式完整',
  })
  assert.equal(retryFake.calls.length, 2, '超出 CSS 预算必须重试，不能保存静默截断的规则')
  assert.match(retried.payload.cards[0].html, /完整重试结果/)
  assert.match(retried.payload.cards[0].pageCss, /\.final-rules/)
})

test('单页重设计模型超时使用 240 秒预算并返回明确的 504 提示', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks
  const initialXhs = {
    title: '单页超时测试',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '封面', lines: ['先做最小版本'], source: [b1.id] },
      { kind: 'compare', heading: '对比', lines: ['以前 | 手动', '现在 | 自动'], source: [b1.id] },
      { kind: 'steps', heading: '步骤', lines: ['第一步 | 验证', '第二步 | 收集', '第三步 | 固化'], source: [b2.id] },
      { kind: 'grid', heading: '矩阵', lines: ['模块一 | 清晰', '模块二 | 稳定'], source: [b2.id] },
      { kind: 'end', heading: '收尾', lines: ['先收藏'], source: [] },
    ],
  }
  const fake = makeFakeCtx(initialXhs)
  await generateDerivative(fake.ctx, store, { id: article.id, platform: 'xhs', stagedHtml: false })

  const originalTimeout = AbortSignal.timeout
  const timeoutMs = []
  try {
    AbortSignal.timeout = ms => {
      timeoutMs.push(ms)
      return AbortSignal.abort()
    }
    fake.ctx.get('llm').prepareCall = () => ({
      config: {},
      async *stream({ signal }) {
        signal?.throwIfAborted()
      },
    })
    await assert.rejects(
      () => redesignXhsCard(fake.ctx, store, { id: article.id, cardIndex: 1 }),
      err => {
        assert.equal(err.status, 504)
        assert.match(err.message, /240 秒/)
        assert.match(err.message, /响应更快|重试/)
        return true
      },
    )
  } finally {
    AbortSignal.timeout = originalTimeout
  }
  assert.deepEqual(timeoutMs, [240_000])
})

test('阶段 3 整套拓扑去重：检出跨页同构（第 2 页与第 4 页重复）并在修复撞车第 3 页时二次复检重设计', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const stage1Markup = `<xhs-meta>
{
  "deckStyle": "tech",
  "tweaks": { "preset": "claude" },
  "title": "跨页拓扑去重测试",
  "body": "${'这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2)}",
  "tags": ["实操复盘", "最小版本", "个人经验"],
  "cards": [
    { "kind": "cover", "layoutArchetype": "editorial-hero", "heading": "增长 1200 人复盘", "lines": ["先做最小版本"], "source": ["${b1.id}"] },
    { "kind": "compare", "layoutArchetype": "table-compare", "heading": "旧做法与新做法", "lines": ["以前 | 手动折腾", "现在 | 一键出稿"], "source": ["${b1.id}"] },
    { "kind": "steps", "layoutArchetype": "timeline-steps", "heading": "三步跑通流程", "lines": ["第一步 | 先做最小版本", "第二步 | 收集真实反馈", "第三步 | 固化模板"], "source": ["${b2.id}"] },
    { "kind": "grid", "layoutArchetype": "quad-bento", "heading": "四个核心亮点", "lines": ["亮点一 | 结构稳定", "亮点二 | 配色正交"], "source": ["${b2.id}"] },
    { "kind": "end", "layoutArchetype": "dark-finale", "heading": "点个收藏", "lines": ["欢迎评论区交流"], "source": [] }
  ]
}
</xhs-meta>`

  // 拓扑 A 用于第 2 页和第 4 页（非相邻！中间隔着拓扑 B 的第 3 页）
  const topoA = '<section><header><h2>对比标题</h2></header><ul><li>项一</li><li>项二</li></ul></section>'
  const topoB = '<article><h2>流程步骤</h2><ol><li>步骤1</li><li>步骤2</li><li>步骤3</li></ol></article>'
  const topoC = '<div class="metrics-wrap"><h2>四宫格矩阵</h2><table><tbody><tr><td>亮点一</td><td>结构稳定</td></tr></tbody></table></div>'

  const batch1 = `
<xhs-card page="1"><div class="hero"><h1>增长 1200 人复盘</h1><p>先做最小版本</p></div></xhs-card>
<xhs-card page="2">${topoA}</xhs-card>
<xhs-card page="3">${topoB}</xhs-card>
`
  const batch2 = `
<xhs-card page="4">${topoA}</xhs-card>
<xhs-card page="5"><div class="finale"><h2>点个收藏</h2><p>欢迎评论区交流</p></div></xhs-card>
`
  // 第一次修复第 4 页时，故意返回与第 3 页同构的 topoB -> 复检应发现与第 3 页冲突，再次触发定向重设计，第二次返回全新的 topoC
  const repairCollisionWithPage3 = `<xhs-card page="4">${topoB}</xhs-card>`
  const repairUnique = `<xhs-card page="4">${topoC}</xhs-card>`

  const fake = makeFakeCtx([
    stage1Markup,
    batch1,
    batch2,
    repairCollisionWithPage3,
    repairUnique,
  ])

  const record = await generateDerivative(fake.ctx, store, {
    id: article.id,
    platform: 'xhs',
  })

  // 阶段 1 (1) + 阶段 2 两批 (2) + 阶段 3 两次去重修复 (2) = 5 次调用
  assert.equal(fake.calls.length, 5)
  assert.match(fake.calls[3].system, /第 4 页与第 2 页/)
  assert.match(fake.calls[4].system, /第 4 页与第 3 页/)

  const sig2 = computeDomTopologySignature(record.payload.cards[1].html)
  const sig3 = computeDomTopologySignature(record.payload.cards[2].html)
  const sig4 = computeDomTopologySignature(record.payload.cards[3].html)
  assert.equal(new Set([sig2, sig3, sig4]).size, 3, '第 2、3、4 页的最终 DOM 拓扑应全部互不相同')
})

test('extractJson 遇到 <xhs-meta> 后紧跟 <xhs-style> 时不被 CSS 花括号干扰，且渐进式流式生成逐张落盘回调', async () => {
  const withTrailingCss = `<xhs-meta>
{"title": "两个 "Agent" 协作", "body": "第一行
第二行", "tags": ["a", "b", "c"], "cards": []}
</xhs-meta>
<xhs-style>
.kicker { color: var(--xhs-accent); }
</xhs-style>`
  const extracted = extractJson(withTrailingCss)
  assert.ok(extracted, 'extractJson 应忽略紧随其后的 <xhs-style> 花括号')
  assert.equal(extracted.title, '两个 "Agent" 协作')

  // 验证渐进式逐张回调（progressive: true）：每闭合一张 <xhs-card> 就触发一次 onProgress 并实时写入 store
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const stage1 = `<xhs-meta>
{
  "deckStyle": "tech",
  "tweaks": { "preset": "claude" },
  "title": "流式逐张渲染测试",
  "body": "${'这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2)}",
  "tags": ["实操复盘", "最小版本", "个人经验"],
  "cards": [
    { "kind": "cover", "layoutArchetype": "hero", "heading": "封面", "lines": ["先做最小版本"], "source": ["${b1.id}"] },
    { "kind": "compare", "layoutArchetype": "cmp", "heading": "对比", "lines": ["以前 | 慢", "现在 | 快"], "source": ["${b1.id}"] },
    { "kind": "steps", "layoutArchetype": "steps", "heading": "步骤", "lines": ["一步 | a", "二步 | b", "三步 | c"], "source": ["${b2.id}"] },
    { "kind": "grid", "layoutArchetype": "grid", "heading": "矩阵", "lines": ["模块一 | 稳", "模块二 | 快"], "source": ["${b2.id}"] },
    { "kind": "end", "layoutArchetype": "end", "heading": "收尾", "lines": ["先收藏"], "source": [] }
  ]
}
</xhs-meta>`

  // 用分片流模拟批内逐张吐出 <xhs-card>
  const batch1Chunks = [
    '<xhs-card page="1"><div class="p1"><h1>封面</h1></div></xhs-card>\n',
    '<xhs-card page="2"><section><table><tbody><tr><td>对比</td></tr></tbody></table></section></xhs-card>\n',
    '<xhs-card page="3"><article><ol><li>步骤1</li></ol></article></xhs-card>',
  ]
  const batch2Chunks = [
    '<xhs-card page="4"><div class="grid"><div>模块一</div><div>模块二</div></div></xhs-card>\n',
    '<xhs-card page="5"><div class="end"><h2>收尾</h2></div></xhs-card>',
  ]
  const scriptedStreams = [[stage1], batch1Chunks, batch2Chunks]
  let callIdx = 0
  const llm = {
    prepareCall() {
      return {
        config: {},
        async *stream() {
          const chunks = scriptedStreams[callIdx++] || []
          for (const c of chunks) {
            yield { type: 'text-delta', text: c }
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const ctx = { get: name => ({ llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }[name] ?? null) }

  const snapshots = []
  await generateDerivative(ctx, store, {
    id: article.id,
    platform: 'xhs',
    progressive: true,
    onProgress: async progress => {
      const current = (await store.read()).articles.find(a => a.id === article.id)
      const htmlReadyCount = (current?.derivatives?.xhs?.payload?.cards || []).filter(c => Boolean(c.html)).length
      snapshots.push({ stage: progress.stage, completed: progress.completedCards?.length ?? 0, htmlReadyCount })
    },
  })

  // 应能观察到中间态（已完成 1、2、3、4、5 张逐步增长，而不是 0 直接跳到 5）
  const designingSteps = snapshots.filter(s => s.stage === 'designing').map(s => s.completed)
  assert.ok(designingSteps.includes(0), '阶段 1 完成后应立刻上报 0/5 骨架态')
  assert.ok(designingSteps.includes(1), '第 1 张闭合后应立刻上报 1/5')
  assert.ok(designingSteps.includes(2), '第 2 张闭合后应立刻上报 2/5')
  assert.ok(designingSteps.includes(5), '全部完成后应上报 5/5')
})

test('DSH 参考图先保存为附件，再以 attachment 图片块调用模型', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const attachment = {
    attachmentId: 'sha256:reference-image',
    mediaType: 'image/png',
    bytes: 68,
    width: 1,
    height: 1,
  }
  const saved = []
  const seen = []
  let messages
  const attachments = {
    async saveImage(input) {
      saved.push(input)
      return attachment
    },
  }
  const llm = {
    async listModels() {
      return [{ id: 'm', inputModalities: ['text', 'image'] }]
    },
    prepareCall() {
      return {
        config: {},
        async *stream({ messages: incomingMessages }) {
          messages = incomingMessages
          for (const part of messages[0].content) {
            if (part.type === 'image') seen.push(part.attachment.attachmentId)
          }
          yield { type: 'text-delta', text: 'ok' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    },
  }
  const services = { llm, attachments, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }
  const ctx = { get: name => services[name] ?? null }

  assert.equal(await callModel(ctx, { system: 'sys', user: 'usr', images: [{ id: 'ref-1', dataUrl: tinyPng }], task: 'vision-test' }), 'ok')
  assert.deepEqual(seen, [attachment.attachmentId])
  assert.equal(messages[0].content[1].type, 'text')
  assert.equal(messages[0].content[1].text, '[参考图 ref-1]')
  assert.equal(messages[0].content[2].type, 'image')
  assert.equal(messages[0].content[2].attachment.attachmentId, attachment.attachmentId)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.ok(saved[0].data instanceof Uint8Array)
  assert.equal(Buffer.from(saved[0].data).toString('base64'), tinyPng.split(',')[1])
})

test('小红书整套生成与单页重设计支持上传参考图，且纯文本模型自动降级并给出提示', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const stage1 = `<xhs-meta>
{
  "deckStyle": "tech",
  "tweaks": { "preset": "claude" },
  "title": "参考图风格测试",
  "body": "${'这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2)}",
  "tags": ["实操复盘", "最小版本", "个人经验"],
  "cards": [
    { "kind": "cover", "layoutArchetype": "hero", "heading": "封面", "lines": ["先做最小版本"], "source": ["${b1.id}"] },
    { "kind": "compare", "layoutArchetype": "cmp", "heading": "对比", "lines": ["以前 | 慢", "现在 | 快"], "source": ["${b1.id}"] },
    { "kind": "steps", "layoutArchetype": "steps", "heading": "步骤", "lines": ["一步 | a", "二步 | b", "三步 | c"], "source": ["${b2.id}"] },
    { "kind": "grid", "layoutArchetype": "grid", "heading": "矩阵", "lines": ["模块一 | 稳", "模块二 | 快"], "source": ["${b2.id}"] },
    { "kind": "end", "layoutArchetype": "end", "heading": "收尾", "lines": ["先收藏"], "source": [] }
  ],
  "referencePlan": {
    "images": [
      { "id": "ref-1", "role": "cover", "reason": "大标题封面" },
      { "id": "ref-2", "role": "style", "reason": "统一细线网格" }
    ],
    "sharedImageIds": ["ref-2"],
    "pages": [{ "page": 1, "imageIds": ["ref-1"] }]
  }
}
</xhs-meta>`
  const batch1 = `
<xhs-card page="1"><div class="p1"><h1>封面</h1></div></xhs-card>
<xhs-card page="2"><section><table><tbody><tr><td>对比</td></tr></tbody></table></section></xhs-card>
<xhs-card page="3"><article><ol><li>步骤1</li></ol></article></xhs-card>`
  const batch2 = `
<xhs-card page="4"><div class="grid"><div>模块一</div><div>模块二</div></div></xhs-card>
<xhs-card page="5"><div class="end"><h2>收尾</h2></div></xhs-card>`
  const singleRedesign = '<xhs-card page="2"><section class="ref-card"><h2>模仿参考图后的第 2 页</h2></section></xhs-card>'

  const makeModalCtx = (replies, inputModalities) => {
    const captured = []
    let i = 0
    const llm = {
      async listModels() {
        return [{ id: 'm', name: 'M', inputModalities }]
      },
      prepareCall() {
        return {
          config: {},
          async *stream({ system, messages }) {
            captured.push({ system, content: messages[0].content })
            const text = replies[i++] ?? ''
            yield { type: 'text-delta', text }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      },
    }
    return {
      captured,
      ctx: { get: name => ({ llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }[name] ?? null) },
    }
  }

  // 1) 支持识图的模型：整套生成 + 单页重设计都应带上 image 内容块
  const vision = makeModalCtx([stage1, batch1, batch2, singleRedesign], ['text', 'image'])
  const rec = await generateDerivative(vision.ctx, store, {
    id: article.id,
    platform: 'xhs',
    referenceImages: [tinyPng, tinyPng],
  })
  assert.equal(vision.captured.length, 3)
  assert.ok(vision.captured.every(call => call.content.some(p => p.type === 'image' && p.mediaType === 'image/png')))
  assert.equal(vision.captured[0].content[1].text, '[参考图 ref-1]')
  assert.equal(vision.captured[0].content[3].text, '[参考图 ref-2]')
  assert.deepEqual(rec.payload.referencePlan, {
    images: [
      { id: 'ref-1', role: 'cover', reason: '大标题封面' },
      { id: 'ref-2', role: 'style', reason: '统一细线网格' },
    ],
    sharedImageIds: ['ref-2'],
    pages: [{ page: 1, imageIds: ['ref-1'] }],
  })
  assert.equal(JSON.stringify(rec.payload).includes('data:image'), false)
  assert.match(vision.captured[0].system, /视觉参考图/)
  assert.match(vision.captured[1].system, /视觉参考图/)
  assert.ok(!rec.warnings.some(w => /不支持识图/.test(w)))

  const redesigned = await redesignXhsCard(vision.ctx, store, {
    id: article.id,
    cardIndex: 1,
    cardPrompt: '模仿参考图构图',
    referenceImages: [tinyPng, tinyPng],
  })
  assert.equal(vision.captured.length, 4)
  assert.equal(vision.captured[3].content.filter(part => part.type === 'image' && part.mediaType === 'image/png').length, 2)
  assert.match(vision.captured[3].system, /视觉参考图/)
  assert.ok(redesigned.payload.cards[1].html.includes('ref-card'))

  // 2) 纯文本模型（inputModalities: ['text']）：自动去掉图片块，不报错，并在 warnings 中提示降级
  const textOnly = makeModalCtx([stage1, batch1, batch2, singleRedesign], ['text'])
  const fallbackRec = await generateDerivative(textOnly.ctx, store, {
    id: article.id,
    platform: 'xhs',
    confirmOverwrite: true,
    referenceImages: [tinyPng],
  })
  assert.ok(textOnly.captured.every(call => !call.content.some(p => p.type === 'image')))
  assert.ok(fallbackRec.warnings.some(w => /未声明支持识图|不支持识图/.test(w)))

  const fallbackRedesign = await redesignXhsCard(textOnly.ctx, store, {
    id: article.id,
    cardIndex: 1,
    referenceImages: [tinyPng],
  })
  assert.ok(!textOnly.captured.at(-1).content.some(p => p.type === 'image'))
  assert.ok(fallbackRedesign.warnings.some(w => /未声明支持识图|不支持识图/.test(w)))

  // 嵌套在 <xhs-card> 内部的 <xhs-page-style> 应被完整剥离，不把原始 CSS 文本渲染到卡片正文里
  const sanitizedNested = sanitizeXhsCardHtml('<xhs-page-style page="2">.p2-vs { display: grid; }</xhs-page-style><div class="p2-vs"><h2>正文标题</h2></div>')
  assert.ok(!sanitizedNested.includes('.p2-vs {'), '不应把嵌套 <xhs-page-style> 里的 CSS 文本残留在卡片 HTML 中')
  assert.ok(sanitizedNested.includes('正文标题'))

  // 开头残留的裸 CSS 文本（模型忘记加标签时）也应被安全剥离
  const sanitizedBareCss = sanitizeXhsCardHtml('.xhs-artboard .p2-duel { display:grid; gap:12px; } .p2-side { border:1px solid var(--xhs-line); } <div class="p2-duel"><h2>对比正文</h2></div>')
  assert.ok(!sanitizedBareCss.includes('.p2-duel {'), '不应把裸 CSS 文本渲染到卡片中')
  assert.ok(sanitizedBareCss.includes('对比正文'))
})

test('单页重设计遇到未闭合截断的 <xhs-card> 时自动重试，绝不把 <xhs-page-style> 源码当成正文渲染', async () => {
  const { store, article } = setupStore()
  await store.update(state => { state.articles.push(article); state.currentId = article.id })
  const [b1, b2] = article.blocks

  const initialDeck = JSON.stringify({
    title: '单页截断防护测试',
    body: '这是一段符合一百字要求的测试小红书正文内容，重点记录我们在做公众号拆解和最小可用版本验证时的真实心得体会。'.repeat(2),
    tags: ['实操复盘', '最小版本', '个人经验'],
    cards: [
      { kind: 'cover', heading: '封面', lines: ['先做最小版本'], html: '<div class="c1"><h1>封面</h1></div>', source: [b1.id] },
      { kind: 'compare', heading: '对比', lines: ['以前 | 慢', '现在 | 快'], html: '<div class="c2"><h2>旧对比</h2></div>', source: [b1.id] },
      { kind: 'steps', heading: '步骤', lines: ['一步 | a', '二步 | b', '三步 | c'], html: '<div class="c3"><ol><li>步骤</li></ol></div>', source: [b2.id] },
      { kind: 'grid', heading: '矩阵', lines: ['模块一 | 稳', '模块二 | 快'], html: '<div class="c4"><table><tr><td>矩阵</td></tr></table></div>', source: [b2.id] },
      { kind: 'end', heading: '收尾', lines: ['先收藏'], html: '<div class="c5"><h2>收尾</h2></div>', source: [] },
    ],
  })

  // 第 1 次单页重设计故意模拟 maxTokens 截断：有完整的 <xhs-page-style> 但 <xhs-card> 半途截断缺少 </xhs-card>
  const truncatedReply = `<xhs-page-style page="2">
.p2-duel { display:grid; grid-template-columns:1fr 84px 1fr; }
</xhs-page-style>
<xhs-card page="2" kind="compare">
  <div class="cd-header"><h2>我以前是人肉翻译机</h2></div>
  <div class="p2-duel"><div class="p2-side">以前：来回搬运`

  // 第 2 次自动重试返回完整闭合标签
  const cleanReply = `<xhs-page-style page="2">
.p2-duel { display:grid; grid-template-columns:1fr 84px 1fr; }
</xhs-page-style>
<xhs-card page="2" kind="compare">
  <div class="cd-header"><h2>我以前是人肉翻译机</h2></div>
  <div class="p2-duel"><div class="p2-side">以前：来回搬运</div><div class="p2-vs">VS</div><div class="p2-side">现在：同房间协作</div></div>
</xhs-card>`

  const fake = makeFakeCtx([initialDeck, truncatedReply, cleanReply])
  await generateDerivative(fake.ctx, store, { id: article.id, platform: 'xhs' })
  const res = await redesignXhsCard(fake.ctx, store, { id: article.id, cardIndex: 1, cardPrompt: '左右对战对比' })

  // 1 次整套 + 2 次单页调用（第 1 次截断被拒并自动重试）
  assert.equal(fake.calls.length, 3)
  assert.match(fake.calls[2].messages[0].content[0].text, /截断|完整闭合/)
  const card2 = res.payload.cards[1]
  assert.ok(!card2.html.includes('.p2-duel {'), '卡片 HTML 中绝不能混入 CSS 源码')
  assert.ok(card2.html.includes('同房间协作'), '应采用第 2 次完整重试后的 HTML')
  assert.ok(card2.pageCss.includes('.xhs-artboard .p2-duel'), '应正确提取单页 pageCss')
})
