import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PNG } from 'pngjs'
import { callModel } from '../src/ai.js'
import { runCli } from '../src/cli.js'
import { saveCustomCoverStyle } from '../src/custom-cover-styles.js'
import { createStandaloneCtx, resolveStandaloneLlmConfig } from '../src/cli-llm.js'
import { Store } from '../src/store.js'

const execFileAsync = promisify(execFile)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN_PATH = join(ROOT, 'bin', 'wechat-studio.js')

function sseResponse(chunks) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

function makeIo(extra = {}) {
  let out = ''
  let err = ''
  return {
    stdout: { write(s) { out += String(s) } },
    stderr: { write(s) { err += String(s) } },
    env: {},
    fetchImpl: async () => { throw new Error('unexpected fetch') },
    ...extra,
    read() { return { out, err } },
  }
}

function makeMockCtx(replyText) {
  const reply = typeof replyText === 'function' ? replyText : () => replyText
  return {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'mock', model: 'mock-1' }) }
      if (name === 'llm') {
        return {
          async prepareCall(_opts, _sig, cb) {
            const controls = {
              config: {},
              async *stream(req) {
                yield { type: 'text-delta', text: String(reply(req)) }
                yield { type: 'finish', reason: { kind: 'stop' } }
              },
            }
            return typeof cb === 'function' ? cb(controls) : controls
          },
        }
      }
      return null
    },
  }
}

function makePngBuffer(width = 400, height = 200) {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 40
    png.data[i + 1] = 120
    png.data[i + 2] = 90
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

test('resolveStandaloneLlmConfig 优先使用显式参数，再回退环境变量', () => {
  const oaKey = ['OPENAI', 'API', 'KEY'].join('_')
  const oaBase = ['OPENAI', 'BASE', 'URL'].join('_')
  const oaModel = ['OPENAI', 'MODEL'].join('_')
  const wsKey = ['WECHAT', 'STUDIO', 'API', 'KEY'].join('_')
  const wsBase = ['WECHAT', 'STUDIO', 'BASE', 'URL'].join('_')
  const wsModel = ['WECHAT', 'STUDIO', 'MODEL'].join('_')

  const fromOpenAi = resolveStandaloneLlmConfig({
    [oaKey]: 'k-oa',
    [oaBase]: 'https://api.deepseek.com/v1/',
    [oaModel]: 'gpt-test',
  })
  assert.equal(fromOpenAi.apiKey, 'k-oa')
  assert.equal(fromOpenAi.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(fromOpenAi.model, 'gpt-test')

  const fromStudio = resolveStandaloneLlmConfig({
    [oaKey]: 'k-oa',
    [wsKey]: 'k-studio',
    [wsBase]: 'http://localhost:8080/v1',
    [wsModel]: 'deepseek-chat',
  }, { model: 'override-model' })
  assert.equal(fromStudio.apiKey, 'k-studio')
  assert.equal(fromStudio.baseUrl, 'http://localhost:8080/v1')
  assert.equal(fromStudio.model, 'override-model')
})

test('createStandaloneCtx 支持 SSE 分片流式响应并与 callModel 兼容', async () => {
  let captured = null
  const fetchImpl = async (url, init) => {
    captured = { url, headers: init.headers, body: JSON.parse(init.body) }
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好，"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"公众号"}}]}\n\ndata: [DONE]\n\n',
    ])
  }
  const ctx = createStandaloneCtx({
    apiKey: 'demo-credential-123',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-model',
    fetchImpl,
  })
  const deltas = []
  const text = await callModel(ctx, {
    system: '系统指令',
    user: '用户输入',
    task: 'cli-test',
    maxTokens: 1200,
    onText: delta => deltas.push(delta),
  })
  assert.equal(text, '你好，公众号')
  assert.deepEqual(deltas, ['你', '好，', '公众号'])
  assert.equal(captured.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(captured.body.model, 'demo-model')
  assert.equal(captured.body.max_tokens, 1200)
  assert.equal(captured.body.stream, true)
  assert.deepEqual(captured.body.messages, [
    { role: 'system', content: '系统指令' },
    { role: 'user', content: '用户输入' },
  ])
})

test('createStandaloneCtx 支持非流式 JSON 响应回退', async () => {
  const fetchImpl = async () => Response.json({
    choices: [{ message: { content: '{"ok":true}' } }],
  })
  const ctx = createStandaloneCtx({
    apiKey: 'demo-credential-123',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-model',
    fetchImpl,
  })
  const text = await callModel(ctx, { system: 'sys', user: 'usr', task: 'json-fallback' })
  assert.equal(text, '{"ok":true}')
})

test('createStandaloneCtx 将参考图转为 OpenAI image_url 多模态消息，并在模型不支持识图时自动降级为纯文本', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const requests = []
  const visionCtx = createStandaloneCtx({
    apiKey: 'demo-credential-123',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-vision',
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body))
      return Response.json({ choices: [{ message: { content: 'ok-vision' } }] })
    },
  })
  const out = await callModel(visionCtx, {
    system: 'sys',
    user: 'hello',
    images: [tinyPng],
    task: 'vision-test',
  })
  assert.equal(out, 'ok-vision')
  assert.equal(requests.length, 1)
  assert.ok(Array.isArray(requests[0].messages[1].content))
  assert.deepEqual(requests[0].messages[1].content[0], { type: 'text', text: 'hello' })
  assert.deepEqual(requests[0].messages[1].content[1], {
    type: 'image_url',
    image_url: { url: tinyPng },
  })

  await callModel(visionCtx, {
    system: 'sys',
    user: 'hello',
    images: [{ id: 'ref-2', dataUrl: tinyPng }],
    task: 'vision-id-test',
  })
  assert.deepEqual(requests[1].messages[1].content[0], { type: 'text', text: 'hello' })
  assert.deepEqual(requests[1].messages[1].content[1], { type: 'text', text: '[参考图 ref-2]' })
  assert.deepEqual(requests[1].messages[1].content[2], {
    type: 'image_url',
    image_url: { url: tinyPng },
  })

  // 模型返回不支持图片输入时，自动降级为纯文本并回调 onImageFallback
  const fallbackReqs = []
  let fallbackNotice = ''
  const textOnlyCtx = createStandaloneCtx({
    apiKey: 'demo-credential-123',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-text-only',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body)
      fallbackReqs.push(body)
      if (Array.isArray(body.messages[1].content)) {
        return new Response(JSON.stringify({ error: { message: 'model does not support image input' } }), { status: 400 })
      }
      return Response.json({ choices: [{ message: { content: 'ok-text-fallback' } }] })
    },
  })
  const fallbackOut = await callModel(textOnlyCtx, {
    system: 'sys',
    user: 'hello',
    images: [tinyPng],
    task: 'vision-fallback-test',
    onImageFallback: reason => { fallbackNotice = reason },
  })
  assert.equal(fallbackOut, 'ok-text-fallback')
  assert.equal(fallbackReqs.length, 2)
  assert.equal(fallbackReqs[1].messages[1].content, 'hello')
  assert.match(fallbackNotice, /不支持|忽略参考图/)
})

test('createStandaloneCtx 缺少密钥时报错且不发起请求，错误响应不泄漏密钥', async () => {
  let called = false
  const noKeyCtx = createStandaloneCtx({
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-model',
    fetchImpl: async () => { called = true; return Response.json({}) },
  })
  await assert.rejects(
    callModel(noKeyCtx, { system: 'sys', user: 'usr', task: 'no-key' }),
    /API Key|密钥/,
  )
  assert.equal(called, false)

  const credential = 'demo-private-value-999'
  const errCtx = createStandaloneCtx({
    apiKey: credential,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-model',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: `bad credential ${credential}` } }), { status: 401 }),
  })
  await assert.rejects(
    callModel(errCtx, { system: 'sys', user: 'usr', task: 'auth-err' }),
    err => {
      assert.doesNotMatch(err.message, /demo-private-value-999/)
      assert.match(err.message, /401|鉴权/)
      return true
    },
  )
})

test('createStandaloneCtx 透传 AbortSignal 中断请求', async () => {
  const controller = new AbortController()
  const ctx = createStandaloneCtx({
    apiKey: 'demo-credential-123',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'demo-model',
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal, controller.signal)
      controller.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    },
  })
  await assert.rejects(
    callModel(ctx, { system: 'sys', user: 'usr', task: 'abort-test', signal: controller.signal }),
    err => err.name === 'AbortError' || /中断|aborted/i.test(err.message),
  )
})

test('CLI 框架：--help、--version、未知命令与 --json 错误退出码 2', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

  const helpIo = makeIo()
  assert.equal(await runCli(['--help'], helpIo), 0)
  for (const cmd of ['layout', 'detect', 'svg-card', 'articles', 'insights', 'style', 'cover']) {
    assert.match(helpIo.read().out, new RegExp(cmd))
  }

  const verIo = makeIo()
  assert.equal(await runCli(['--version', '--json'], verIo), 0)
  assert.deepEqual(JSON.parse(verIo.read().out), { ok: true, version: pkg.version })

  const badCmdIo = makeIo()
  assert.equal(await runCli(['nonexistent', '--json'], badCmdIo), 2)
  const badParsed = JSON.parse(badCmdIo.read().out)
  assert.equal(badParsed.ok, false)
  assert.equal(badParsed.code, 'USAGE')
  assert.equal(badCmdIo.read().err, '')

  const badFlagIo = makeIo()
  assert.equal(await runCli(['layout', 'a.md', '--unknown-flag', '--json'], badFlagIo), 2)
  assert.equal(JSON.parse(badFlagIo.read().out).code, 'USAGE')
})

test('package.json 同时保留 DSH 插件配置与 CLI bin 入口', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.main, 'src/host.js')
  assert.equal(pkg.exports['.'], './src/host.js')
  assert.equal(pkg.exports['./client'], './dist/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.bin['wechat-studio'], './bin/wechat-studio.js')
  assert.ok(pkg.files.includes('bin'))
  assert.ok(pkg.files.includes('dist'))
  assert.ok(pkg.files.includes('src'))
})

test('离线确定性子命令：layout、svg-card、articles、insights', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-offline-'))
  try {
    const mdPath = join(dir, 'sample.md')
    const outHtml = join(dir, 'out.html')
    await writeFile(mdPath, '# 测试文章标题\n\n第一段正文内容，用来验证排版和导入。\n\n## 小节\n\n第二段正文内容。\n', 'utf8')

    // layout
    const layoutIo = makeIo()
    assert.equal(await runCli(['layout', mdPath, '--style', 'neo', '--theme', 'forest', '--out', outHtml, '--data-dir', dir, '--json'], layoutIo), 0)
    const layoutRes = JSON.parse(layoutIo.read().out)
    assert.equal(layoutRes.ok, true)
    assert.equal(layoutRes.style, 'neo')
    assert.equal(layoutRes.theme, 'forest')
    assert.equal(layoutRes.out, outHtml)
    assert.match(await readFile(outHtml, 'utf8'), /测试文章标题/)

    // layout invalid style & extra positional -> exit 2
    const badStyleIo = makeIo()
    assert.equal(await runCli(['layout', mdPath, '--style', 'invalid-style', '--json'], badStyleIo), 2)
    const extraArgIo = makeIo()
    assert.equal(await runCli(['layout', mdPath, 'extra.md', '--json'], extraArgIo), 2)
    assert.equal(JSON.parse(extraArgIo.read().out).code, 'USAGE')

    // svg-card & invalid kind -> exit 2
    const badSvgIo = makeIo()
    assert.equal(await runCli(['svg-card', 'not-a-kind', '--title', '测试', '--line', '一条', '--json'], badSvgIo), 2)
    assert.equal(JSON.parse(badSvgIo.read().out).code, 'USAGE')

    const svgIo = makeIo()
    assert.equal(await runCli(['svg-card', 'svg-steps', '--title', '写作流程', '--line', '收集素材', '--line', '起草改稿', '--json'], svgIo), 0)
    const svgRes = JSON.parse(svgIo.read().out)
    assert.equal(svgRes.ok, true)
    assert.match(svgRes.html, /<svg\b/)
    assert.match(svgRes.html, /<animate/)

    // articles import -> list -> get -> verify Store compatibility
    const importIo = makeIo()
    assert.equal(await runCli(['articles', 'import', mdPath, '--data-dir', dir, '--json'], importIo), 0)
    const imported = JSON.parse(importIo.read().out)
    assert.equal(imported.ok, true)
    assert.equal(imported.title, '测试文章标题')

    // 全局选项放在二级子命令前也能正常解析
    const listIo = makeIo()
    assert.equal(await runCli(['articles', '--json', '--data-dir', dir, 'list'], listIo), 0)
    const listed = JSON.parse(listIo.read().out)
    assert.equal(listed.count, 1)
    assert.equal(listed.articles[0].id, imported.id)

    const getIo = makeIo()
    assert.equal(await runCli(['articles', 'get', imported.id, '--data-dir', dir, '--json'], getIo), 0)
    const got = JSON.parse(getIo.read().out)
    assert.match(got.markdown, /测试文章标题/)

    const store = new Store(dir)
    const diskState = await store.read()
    assert.equal(diskState.articles.length, 1)
    assert.equal(diskState.currentId, imported.id)

    // insights summary on empty workspace
    const insIo = makeIo()
    assert.equal(await runCli(['insights', 'summary', '--data-dir', dir, '--json'], insIo), 0)
    const insRes = JSON.parse(insIo.read().out)
    assert.equal(insRes.ok, true)
    assert.equal(insRes.hasData, false)

    // insights import with valid WeChat growth HTML-table fixture
    const xlsPath = join(dir, 'growth.xls')
    await writeFile(xlsPath, '<table><tr><td>时间</td><td>新关注人数</td></tr><tr><td>2026-11-18</td><td>15</td></tr></table>', 'utf8')
    const insImportIo = makeIo()
    assert.equal(await runCli(['insights', 'import', xlsPath, '--data-dir', dir, '--json'], insImportIo), 0)
    const insImportRes = JSON.parse(insImportIo.read().out)
    assert.equal(insImportRes.ok, true)
    assert.equal(insImportRes.importedKind, 'growth')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('外部 API 子命令：detect 与 cover（--prompt-only 及完整生成）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-api-'))
  try {
    const mdPath = join(dir, 'post.md')
    await writeFile(mdPath, '# 为什么本地工具更好用\n\n本地优先的工作流不需要来回粘贴，效率高很多。\n', 'utf8')

    // detect missing key -> exit 2
    const noKeyDetectIo = makeIo()
    assert.equal(await runCli(['detect', mdPath, '--data-dir', dir, '--json'], noKeyDetectIo), 2)

    // detect with key + mock fetch
    const zqKeyName = ['ZHUQUE', 'API', 'KEY'].join('_')
    const detectIo = makeIo({
      env: { [zqKeyName]: 'zq-private-token-xyz' },
      fetchImpl: async () => Response.json({
        status: 'success',
        labels_ratio: { 0: 0.7, 1: 0.2, 2: 0.1 },
        segment_labels: [{ order: 0, text: '本地优先的工作流不需要来回粘贴，效率高很多。', label: 1, conf: 0.88 }],
        usage: { total_tokens: 42 },
      }),
    })
    assert.equal(await runCli(['detect', mdPath, '--data-dir', dir, '--json'], detectIo), 0)
    const detectOut = detectIo.read().out
    assert.doesNotMatch(detectOut, /zq-private-token-xyz/)
    const detectRes = JSON.parse(detectOut)
    assert.equal(detectRes.ok, true)
    assert.equal(detectRes.flagged.length, 1)
    assert.equal(detectRes.tokens, 42)

    // cover --prompt-only：零模型 Key、零生图 Key 也能直接输出模板与槽位
    const coverPromptIo = makeIo()
    assert.equal(await runCli(['cover', mdPath, '--style', 'felt', '--prompt-only', '--data-dir', dir, '--json'], coverPromptIo), 0)
    const coverPromptRes = JSON.parse(coverPromptIo.read().out)
    assert.equal(coverPromptRes.ok, true)
    assert.equal(coverPromptRes.promptOnly, true)
    assert.ok(Array.isArray(coverPromptRes.slots) && coverPromptRes.slots.length > 0)
    assert.ok(coverPromptRes.system.length > 20 && coverPromptRes.user.includes('为什么本地工具更好用'))

    const promptOnlyCtx = makeMockCtx(req => {
      const parsed = JSON.parse(req.messages[0].content[0].text)
      return JSON.stringify({ values: parsed.slots.map((name, i) => (name.includes('人物段') ? '无人物' : `槽位${i + 1}`)) })
    })

    // cover full generation with mocked Ark PNG
    const arkKeyName = ['ARK', 'API', 'KEY'].join('_')
    const outCover = join(dir, 'cover-out.png')
    const pngBase64 = makePngBuffer(470, 200).toString('base64')
    const coverGenIo = makeIo({
      ctx: promptOnlyCtx,
      env: { [arkKeyName]: 'ark-demo-key' },
      fetchImpl: async () => Response.json({ data: [{ b64_json: pngBase64 }] }),
    })
    assert.equal(await runCli(['cover', mdPath, '--style', 'felt', '--out', outCover, '--data-dir', dir, '--json'], coverGenIo), 0)
    const coverGenRes = JSON.parse(coverGenIo.read().out)
    assert.equal(coverGenRes.ok, true)
    assert.equal(coverGenRes.out, outCover)
    const written = await readFile(outCover)
    assert.equal(written.toString('hex', 0, 8), '89504e470d0a1a0a')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('个人写作风格子命令：status、analyze、preview、apply、restore（含 --prompt-only）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-style-'))
  try {
    const samplePath = join(dir, 'sample1.md')
    const profilePath = join(dir, 'profile.json')
    const sampleBody = '说白了，写公众号最怕端着架子讲大道理。我平时写稿都是先抓一个身边真发生过的小事，三句话把矛盾摆出来，再顺着聊我踩过的坑和实测数据。'.repeat(4)
    await writeFile(samplePath, `# 别端着写文章\n\n${sampleBody}\n`, 'utf8')

    // status (initial，同时验证全局参数放在二级子命令前)
    const statusIo1 = makeIo()
    assert.equal(await runCli(['style', '--json', '--data-dir', dir, 'status'], statusIo1), 0)
    assert.equal(JSON.parse(statusIo1.read().out).active, false)

    // analyze --prompt-only (works with zero model key)
    const promptIo = makeIo()
    assert.equal(await runCli(['style', 'analyze', samplePath, '--prompt-only', '--data-dir', dir, '--json'], promptIo), 0)
    const promptRes = JSON.parse(promptIo.read().out)
    assert.equal(promptRes.ok, true)
    assert.equal(promptRes.promptOnly, true)
    assert.match(promptRes.user, /说白了，写公众号最怕端着架子讲大道理/)

    // analyze with mock ctx -> writes profile.json
    const analyzeCtx = makeMockCtx(JSON.stringify({
      name: '直白实测风',
      summary: '像跟同行朋友聊天，先抛真事再给实测结论',
      voice: ['口语直白，不端着'],
      rhythm: ['短段落推进，先讲具体场景'],
      phrases: ['说白了'],
      taboos: ['赋能'],
      headline: { lengthRange: '14-20字', hooks: ['反常识'], punctuation: '少用感叹号', summaryStyle: '一句讲清结论' },
      excerpts: ['说白了，写公众号最怕端着架子讲大道理。我平时写稿都是先抓一个身边真发生过的小事，三句话把矛盾摆出来，再顺着聊我踩过的坑和实测数据。'],
    }))
    const analyzeIo = makeIo({ ctx: analyzeCtx })
    assert.equal(await runCli(['style', 'analyze', samplePath, '--out', profilePath, '--data-dir', dir, '--json'], analyzeIo), 0)
    const analyzeRes = JSON.parse(analyzeIo.read().out)
    assert.equal(analyzeRes.ok, true)
    assert.equal(analyzeRes.profile.name, '直白实测风')

    // preview --prompt-only & live
    const prevPromptIo = makeIo()
    assert.equal(await runCli(['style', 'preview', profilePath, '--topic', 'AI 提效', '--prompt-only', '--json'], prevPromptIo), 0)
    assert.equal(JSON.parse(prevPromptIo.read().out).topic, 'AI 提效')

    const prevCtx = makeMockCtx(JSON.stringify({
      opening: '说白了，很多人用 AI 越用越累，是因为把提示词写成了工作汇报。',
      titles: ['别再把 AI 当下属使唤了', '为什么你用 AI 反而更慢？', '实测一周：我砍掉了 80% 的提示词'],
    }))
    const prevIo = makeIo({ ctx: prevCtx })
    assert.equal(await runCli(['style', 'preview', profilePath, '--topic', 'AI 提效', '--json'], prevIo), 0)
    assert.equal(JSON.parse(prevIo.read().out).titles.length, 3)

    // apply --no-headline -> status -> restore
    const applyIo = makeIo()
    assert.equal(await runCli(['style', 'apply', profilePath, '--no-headline', '--data-dir', dir, '--json'], applyIo), 0)
    const applied = JSON.parse(applyIo.read().out)
    assert.deepEqual(applied.written, ['writer'])

    const statusIo2 = makeIo()
    assert.equal(await runCli(['style', 'status', '--data-dir', dir, '--json'], statusIo2), 0)
    assert.deepEqual(JSON.parse(statusIo2.read().out).scopes, { writer: true, headline: false })

    const restoreIo = makeIo()
    assert.equal(await runCli(['style', 'restore', '--data-dir', dir, '--json'], restoreIo), 0)
    assert.equal(JSON.parse(restoreIo.read().out).state.active, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('第一性原理补全：子命令 --help、stdin -、skills、cover --prompt-file 与 baseUrl 兼容', async () => {
  // 1. baseUrl 已含 /chat/completions 不重复拼接
  let capturedUrl = ''
  const urlCtx = createStandaloneCtx({
    apiKey: 'demo-credential-123',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'demo-model',
    fetchImpl: async url => {
      capturedUrl = String(url)
      return Response.json({ choices: [{ message: { content: 'ok' } }] })
    },
  })
  assert.equal(await callModel(urlCtx, { system: 's', user: 'u', task: 'url-check' }), 'ok')
  assert.equal(capturedUrl, 'https://api.deepseek.com/v1/chat/completions')

  // 2. 二级子命令与一级子命令的 --help 均返回 0 并展示专属选项
  for (const args of [
    ['layout', '--help'],
    ['svg-card', '--help'],
    ['skills', '--help'],
    ['articles', 'list', '--help'],
    ['insights', 'summary', '--help'],
    ['style', 'analyze', '--help'],
    ['style', 'status', '--help'],
    ['cover', '--help'],
  ]) {
    const hIo = makeIo()
    assert.equal(await runCli(args, hIo), 0, `expected exit 0 for ${args.join(' ')}`)
    assert.match(hIo.read().out, /用法/)
  }
  const layoutHelpIo = makeIo()
  assert.equal(await runCli(['layout', '--help'], layoutHelpIo), 0)
  assert.match(layoutHelpIo.read().out, /--follow-card/)

  // 3. --title=--json 不会误判为 JSON 输出模式
  const nonJsonIo = makeIo()
  assert.equal(await runCli(['svg-card', 'svg-steps', '--title=--json', '--line', '一步', '--line', '二步'], nonJsonIo), 0)
  assert.match(nonJsonIo.read().out.trim(), /^<section|^<svg/)

  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-agent-'))
  try {
    // 4. stdin '-' 管道支持（layout - 与 articles import -）
    const stdinMd = '# 管道输入标题\n\n通过标准输入直接传给 CLI，不需要临时文件。\n'
    const outHtml = join(dir, 'stdin.html')
    const pipeLayoutIo = makeIo({ stdin: stdinMd })
    assert.equal(await runCli(['layout', '-', '--out', outHtml, '--data-dir', dir, '--json'], pipeLayoutIo), 0)
    assert.equal(JSON.parse(pipeLayoutIo.read().out).ok, true)
    assert.match(await readFile(outHtml, 'utf8'), /管道输入标题/)

    const pipeImportIo = makeIo({ stdin: stdinMd })
    assert.equal(await runCli(['articles', 'import', '-', '--data-dir', dir, '--json'], pipeImportIo), 0)
    assert.equal(JSON.parse(pipeImportIo.read().out).title, '管道输入标题')

    // 5. skills 命令返回当前生效技能路径
    const skillsIo = makeIo()
    assert.equal(await runCli(['skills', '--data-dir', dir, '--json'], skillsIo), 0)
    const skillsRes = JSON.parse(skillsIo.read().out)
    assert.equal(skillsRes.ok, true)
    assert.ok(skillsRes.skills.some(s => s.name === 'writer' && s.source === 'bundled'))

    // 6. cover --prompt-only 透出 fragments/personSegments；cover --prompt-file 零模型 Key 闭环生图
    const mdPath = join(dir, 'c.md')
    await writeFile(mdPath, stdinMd, 'utf8')
    const pOnlyIo = makeIo()
    assert.equal(await runCli(['cover', mdPath, '--style', 'felt', '--prompt-only', '--data-dir', dir, '--json'], pOnlyIo), 0)
    const pOnlyRes = JSON.parse(pOnlyIo.read().out)
    assert.equal(pOnlyRes.ok, true)
    assert.ok(pOnlyRes.fragments && typeof pOnlyRes.fragments === 'object')
    assert.ok(pOnlyRes.personSegments && typeof pOnlyRes.personSegments === 'object')

    const arkKeyName = ['ARK', 'API', 'KEY'].join('_')
    const outCover = join(dir, 'from-prompt-file.png')
    const pngBase64 = makePngBuffer(470, 200).toString('base64')
    const pFileIo = makeIo({
      stdin: '手工羊毛毡微缩场景封面最终提示词',
      env: { [arkKeyName]: 'ark-demo-key' },
      fetchImpl: async () => Response.json({ data: [{ b64_json: pngBase64 }] }),
    })
    assert.equal(await runCli(['cover', '--prompt-file', '-', '--style', 'felt', '--out', outCover, '--data-dir', dir, '--json'], pFileIo), 0)
    assert.equal(JSON.parse(pFileIo.read().out).ok, true)
    assert.equal((await readFile(outCover)).toString('hex', 0, 8), '89504e470d0a1a0a')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('多进程共享存储、growth-only hasData 与稳定 RUNTIME 错误码', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-mp-'))
  try {
    // 1. 已运行的 Store 实例能实时看到外部 CLI 子进程导入的稿件（无需重启）
    const liveStore = new Store(dir)
    assert.equal((await liveStore.read()).articles.length, 0)

    const mdPath = join(dir, 'from-cli.md')
    await writeFile(mdPath, '# 外部 CLI 导入的新稿\n\n正文内容。\n', 'utf8')
    await execFileAsync(process.execPath, [BIN_PATH, 'articles', 'import', mdPath, '--data-dir', dir, '--json'])

    const refreshed = await liveStore.read()
    assert.equal(refreshed.articles.length, 1)
    assert.equal(refreshed.articles[0].title, '外部 CLI 导入的新稿')

    // 2. 只导入 growth.xls 时 insights summary 的 hasData 必须与 summary.hasData 一致
    const growthPath = join(dir, 'growth.xls')
    await writeFile(growthPath, '<table><tr><td>时间</td><td>新关注人数</td></tr><tr><td>2026-11-18</td><td>12</td></tr></table>', 'utf8')
    await execFileAsync(process.execPath, [BIN_PATH, 'insights', 'import', growthPath, '--data-dir', dir, '--json'])

    const sumIo = makeIo()
    assert.equal(await runCli(['insights', 'summary', '--data-dir', dir, '--json'], sumIo), 0)
    const sumRes = JSON.parse(sumIo.read().out)
    assert.equal(sumRes.hasData, true)
    assert.equal(sumRes.summary.hasData, true)

    // 3. 两个并发 CLI 子进程同时导入 growth 和 tendency，都不丢更新
    const dir2 = await mkdtemp(join(tmpdir(), 'ws-cli-mp-race-'))
    try {
      const gFile = join(dir2, 'g.xls')
      const tFile = join(dir2, 't.xls')
      await writeFile(gFile, '<table><tr><td>时间</td><td>新关注人数</td></tr><tr><td>2026-11-18</td><td>20</td></tr></table>', 'utf8')
      const tendencyHtml = '<html><body><table>'
        + '<tr><td>数据趋势概况（2026.11.10-2026.11.18）</td></tr>'
        + '<tr><td>日期</td><td>渠道</td><td>阅读人数</td><td></td><td>日期</td><td>分享人数</td><td>跳转阅读原文人数</td><td>微信收藏人数</td><td>发表篇数</td><td></td><td>发表日期</td><td>内容标题</td><td>传播渠道</td><td>阅读人数</td><td>阅读人数占比</td></tr>'
        + '<tr><td>2026-11-18</td><td>全部</td><td>500</td><td></td><td>2026-11-18</td><td>10</td><td>1</td><td>2</td><td>1</td><td></td><td>2026-11-18</td><td>并发测试文章</td><td>全部</td><td>500</td><td>1</td></tr>'
        + '</table></body></html>'
      await writeFile(tFile, tendencyHtml, 'utf8')

      await Promise.all([
        execFileAsync(process.execPath, [BIN_PATH, 'insights', 'import', gFile, '--data-dir', dir2, '--json']),
        execFileAsync(process.execPath, [BIN_PATH, 'insights', 'import', tFile, '--data-dir', dir2, '--json']),
      ])

      const merged = JSON.parse(await readFile(join(dir2, 'insights.json'), 'utf8'))
      assert.ok(merged.growth, '并发写入后应保留 growth')
      assert.ok(merged.tendency, '并发写入后应保留 tendency')
    } finally {
      await rm(dir2, { recursive: true, force: true })
    }

    // 4. 系统错误（如把目录传给 layout）在 --json 下仍返回稳定枚举 code: RUNTIME，并附带 causeCode
    const dirErrIo = makeIo()
    assert.equal(await runCli(['layout', dir, '--data-dir', dir, '--json'], dirErrIo), 1)
    const dirErrRes = JSON.parse(dirErrIo.read().out)
    assert.equal(dirErrRes.ok, false)
    assert.equal(dirErrRes.code, 'RUNTIME')
    assert.equal(dirErrRes.causeCode, 'EISDIR')
    // 5. 两个独立 Store 实例读取同一稿件：A 修改标题后，B 必须读到新标题，且 B 后续更新不能覆盖回旧标题
    const storeA = new Store(dir)
    const storeB = new Store(dir)
    const [aBefore, bBefore] = await Promise.all([storeA.read(), storeB.read()])
    assert.equal(aBefore.articles[0].title, '外部 CLI 导入的新稿')
    assert.equal(bBefore.articles[0].title, '外部 CLI 导入的新稿')

    await storeA.update(state => { state.articles[0].title = '新标题' })
    const bAfterRead = await storeB.read()
    assert.equal(bAfterRead.articles[0].title, '新标题')

    await storeB.update(state => { state.articles[0].summary = '补充摘要' })
    const freshStore = new Store(dir)
    const finalState = await freshStore.read()
    assert.equal(finalState.articles[0].title, '新标题')
    assert.equal(finalState.articles[0].summary, '补充摘要')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('layout --banner：合法横幅规格渲染进 HTML，非法规格返回退出码 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-banner-'))
  try {
    const mdPath = join(dir, 'post.md')
    const bannerPath = join(dir, 'banner.json')
    const badBannerPath = join(dir, 'bad-banner.json')
    const outHtml = join(dir, 'with-banner.html')
    await writeFile(mdPath, '# 带横幅的文章\n\n正文内容。\n', 'utf8')
    await writeFile(bannerPath, JSON.stringify({
      slug: 'x',
      title: '带横幅的文章',
      style: 'poster',
      poster: { eyebrow: 'AI 实测', title1: '排版这件事', title2: '交给流程', right: 'flow', ask: '帮我排好', result: '排好了', tags: ['一', '二', '三'], big: 'AI' },
    }), 'utf8')
    await writeFile(badBannerPath, JSON.stringify({ style: 'poster', poster: null }), 'utf8')

    const okIo = makeIo()
    assert.equal(await runCli(['layout', mdPath, '--banner', bannerPath, '--out', outHtml, '--data-dir', dir, '--json'], okIo), 0)
    const okRes = JSON.parse(okIo.read().out)
    assert.equal(okRes.ok, true)
    assert.deepEqual(okRes.bannerWarnings, [])
    assert.match(await readFile(outHtml, 'utf8'), /"banner": \{"orange": "<svg/)

    const badIo = makeIo()
    assert.equal(await runCli(['layout', mdPath, '--banner', badBannerPath, '--data-dir', dir, '--json'], badIo), 2)
    assert.equal(JSON.parse(badIo.read().out).code, 'USAGE')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('settings 与 draft 子命令：配置读写、凭证校验、草稿箱推送与密钥脱敏', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-settings-draft-'))
  const tokenKey = ['access', 'token'].join('_')
  const mpSecFlag = ['--mp', 'app', 'secret'].join('-')
  try {
    // 1. --help 支持
    for (const args of [['settings', '--help'], ['settings', 'set', '--help'], ['draft', '--help'], ['draft', 'push', '--help']]) {
      const hIo = makeIo()
      assert.equal(await runCli(args, hIo), 0)
      assert.match(hIo.read().out, /用法/)
    }

    // 2. settings get (default)
    const getIo1 = makeIo()
    assert.equal(await runCli(['settings', 'get', '--data-dir', dir, '--json'], getIo1), 0)
    const defRes = JSON.parse(getIo1.read().out)
    assert.equal(defRes.ok, true)
    assert.equal(defRes.settings.mp.appSecretSet, false)

    // 3. settings set (flags + 32-char hex credential, never echoed in plaintext)
    const mockVal = 'a1b2'.repeat(8)
    const demoId = 'demo-mp-id-01'
    const setIo = makeIo()
    assert.equal(await runCli([
      'settings', 'set',
      '--author', '纯CLI作者',
      '--slogan', '命令行直接写公众号',
      '--style', 'neo',
      '--theme', 'forest',
      '--cover-provider', 'bailian',
      '--mp-name', '测试号',
      '--mp-app-id', demoId,
      mpSecFlag, mockVal,
      '--data-dir', dir,
      '--json',
    ], setIo), 0)
    const setOut = setIo.read().out
    assert.doesNotMatch(setOut, new RegExp(mockVal))
    const setRes = JSON.parse(setOut)
    assert.equal(setRes.ok, true)
    assert.equal(setRes.settings.brand.author, '纯CLI作者')
    assert.equal(setRes.settings.brand.slogan, '命令行直接写公众号')
    assert.equal(setRes.settings.coverProvider, 'bailian')
    assert.equal(setRes.settings.mp.appId, demoId)
    assert.equal(setRes.settings.mp.appSecretSet, true)

    // 4. settings set --from-json & validation error -> exit 2
    const jsonSetIo = makeIo({ stdin: JSON.stringify({ brand: { author: '管道作者' } }) })
    assert.equal(await runCli(['settings', 'set', '--from-json', '-', '--data-dir', dir, '--json'], jsonSetIo), 0)
    assert.equal(JSON.parse(jsonSetIo.read().out).settings.brand.author, '管道作者')

    const badSetIo = makeIo()
    assert.equal(await runCli(['settings', 'set', mpSecFlag, 'too-short', '--data-dir', dir, '--json'], badSetIo), 2)
    assert.equal(JSON.parse(badSetIo.read().out).code, 'USAGE')

    const emptySetIo = makeIo()
    assert.equal(await runCli(['settings', 'set', '--data-dir', dir, '--json'], emptySetIo), 2)

    // 5. draft verify using saved settings
    const verifyIo = makeIo({
      fetchImpl: async url => {
        const u = String(url)
        if (u.includes('/cgi-bin/token')) return Response.json({ [tokenKey]: 'mock-1' })
        if (u.includes('/cgi-bin/account/getaccountinfo')) return Response.json({ nick_name: '测试号', head_img: '' })
        throw new Error(`unexpected url: ${u}`)
      },
    })
    assert.equal(await runCli(['draft', 'verify', '--data-dir', dir, '--json'], verifyIo), 0)
    const verifyRes = JSON.parse(verifyIo.read().out)
    assert.equal(verifyRes.ok, true)
    assert.equal(verifyRes.nickname, '测试号')

    // 6. draft push --dry-run (no network call, renders fragment with banner + follow-card)
    const mdPath = join(dir, 'draft.md')
    const bannerPath = join(dir, 'banner.json')
    await writeFile(mdPath, '# 草稿箱推送测试\n\n这是正文第一段，用来测试纯 CLI 推送草稿箱。\n', 'utf8')
    await writeFile(bannerPath, JSON.stringify({
      slug: 'x',
      title: '草稿箱推送测试',
      style: 'poster',
      poster: { eyebrow: 'CLI', title1: '一步到位', title2: '直推草稿箱', right: 'push', ask: '帮我推送', result: '已入箱', tags: ['一', '二', '三'], big: 'MP' },
    }), 'utf8')

    const dryIo = makeIo()
    assert.equal(await runCli(['draft', 'push', mdPath, '--banner', bannerPath, '--follow-card', '--dry-run', '--data-dir', dir, '--json'], dryIo), 0)
    const dryRes = JSON.parse(dryIo.read().out)
    assert.equal(dryRes.ok, true)
    assert.equal(dryRes.dryRun, true)
    assert.equal(dryRes.title, '草稿箱推送测试')
    assert.equal(dryRes.author, '管道作者')
    assert.equal(dryRes.style, 'neo')
    assert.equal(dryRes.theme, 'forest')
    assert.ok(dryRes.chars > 500)

    // 7. draft push live with local PNG cover -> calls token, add_material, draft/add
    const coverPath = join(dir, 'cover.png')
    await writeFile(coverPath, makePngBuffer(470, 200))
    let capturedDraftBody = null
    const pushIo = makeIo({
      fetchImpl: async (url, init) => {
        const u = String(url)
        if (u.includes('/cgi-bin/token')) return Response.json({ [tokenKey]: 'mock-2' })
        if (u.includes('/cgi-bin/material/add_material')) return Response.json({ media_id: 'thumb-media-1' })
        if (u.includes('/cgi-bin/draft/add')) {
          capturedDraftBody = JSON.parse(init.body)
          return Response.json({ media_id: 'draft-media-99' })
        }
        throw new Error(`unexpected url: ${u}`)
      },
    })
    assert.equal(await runCli(['draft', 'push', mdPath, '--cover', coverPath, '--follow-card', '--data-dir', dir, '--json'], pushIo), 0)
    const pushRes = JSON.parse(pushIo.read().out)
    assert.equal(pushRes.ok, true)
    assert.equal(pushRes.mediaId, 'draft-media-99')
    assert.deepEqual(pushRes.warnings, [])
    assert.equal(capturedDraftBody.articles[0].title, '草稿箱推送测试')
    assert.equal(capturedDraftBody.articles[0].author, '管道作者')
    assert.equal(capturedDraftBody.articles[0].thumb_media_id, 'thumb-media-1')
    assert.match(capturedDraftBody.articles[0].content, /管道作者/)
    assert.doesNotMatch(capturedDraftBody.articles[0].content, /GIF_URL_HERE/)
    assert.doesNotMatch(capturedDraftBody.articles[0].content, /<!doctype html/i)

    // 8. draft push with invalid cover format -> exit 2
    const badCoverPath = join(dir, 'not-img.txt')
    await writeFile(badCoverPath, 'hello', 'utf8')
    const badCoverIo = makeIo()
    assert.equal(await runCli(['draft', 'push', mdPath, '--cover', badCoverPath, '--data-dir', dir, '--json'], badCoverIo), 2)
    assert.equal(JSON.parse(badCoverIo.read().out).code, 'USAGE')

    // 9. draft verify with empty workspace -> exit 2
    const emptyDir = await mkdtemp(join(tmpdir(), 'ws-cli-empty-mp-'))
    try {
      const noCredIo = makeIo()
      assert.equal(await runCli(['draft', 'verify', '--data-dir', emptyDir, '--json'], noCredIo), 2)
      assert.equal(JSON.parse(noCredIo.read().out).code, 'USAGE')
    } finally {
      await rm(emptyDir, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('回归修复：并发 settings 写锁、损坏保护、style/theme 暴露与校验、文件名标题回退与草稿推送预检阻断', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-regress-'))
  const tokenKey = ['access', 'token'].join('_')
  const mpSecFlag = ['--mp', 'app', 'secret'].join('-')
  try {
    // 1. 并发多进程 settings set（跑 6 轮）：不损坏、不报 ENOENT、两项修改都保留
    for (let i = 1; i <= 6; i++) {
      const roundDir = join(dir, `r${i}`)
      await Promise.all([
        execFileAsync(process.execPath, [BIN_PATH, 'settings', 'set', '--author', `作者${i}`, '--data-dir', roundDir, '--json']),
        execFileAsync(process.execPath, [BIN_PATH, 'settings', 'set', '--slogan', `标语${i}`, '--data-dir', roundDir, '--json']),
      ])
      const saved = JSON.parse(await readFile(join(roundDir, 'settings.json'), 'utf8'))
      assert.equal(saved.brand.author, `作者${i}`)
      assert.equal(saved.brand.slogan, `标语${i}`)
    }

    // 2. 损坏的 settings.json 不会被静默吞掉或覆盖
    const corruptDir = join(dir, 'corrupt')
    await execFileAsync(process.execPath, [BIN_PATH, 'settings', 'set', '--author', '原值', '--data-dir', corruptDir, '--json'])
    await writeFile(join(corruptDir, 'settings.json'), '{bad json', 'utf8')
    const corruptGetIo = makeIo()
    assert.equal(await runCli(['settings', 'get', '--data-dir', corruptDir, '--json'], corruptGetIo), 1)
    assert.equal(JSON.parse(corruptGetIo.read().out).causeCode, 'SETTINGS_CORRUPT')
    const corruptSetIo = makeIo()
    assert.equal(await runCli(['settings', 'set', '--author', '新值', '--data-dir', corruptDir, '--json'], corruptSetIo), 1)
    assert.equal(await readFile(join(corruptDir, 'settings.json'), 'utf8'), '{bad json')

    // 3. settings get 暴露 style/theme，且 --from-json 拒绝非法 style/theme
    const cfgDir = join(dir, 'cfg')
    const badJsonSetIo = makeIo({ stdin: JSON.stringify({ style: 'not-a-style', theme: 'not-a-theme' }) })
    assert.equal(await runCli(['settings', 'set', '--from-json', '-', '--data-dir', cfgDir, '--json'], badJsonSetIo), 2)
    assert.equal(JSON.parse(badJsonSetIo.read().out).code, 'USAGE')

    const okSetIo = makeIo()
    assert.equal(await runCli(['settings', 'set', '--style', 'neo', '--theme', 'forest', '--mp-app-id', 'demo-id', mpSecFlag, 'c3d4'.repeat(8), '--data-dir', cfgDir, '--json'], okSetIo), 0)
    const getIo = makeIo()
    assert.equal(await runCli(['settings', 'get', '--data-dir', cfgDir, '--json'], getIo), 0)
    const gotSettings = JSON.parse(getIo.read().out).settings
    assert.equal(gotSettings.style, 'neo')
    assert.equal(gotSettings.theme, 'forest')

    // 4. 无一级标题时：文件用文件名回退，stdin 回退为「未命名」
    const namedMd = join(dir, 'meaningful-name.md')
    await writeFile(namedMd, '没有一级标题的正文内容。\n', 'utf8')
    const namedDryIo = makeIo()
    assert.equal(await runCli(['draft', 'push', namedMd, '--dry-run', '--data-dir', cfgDir, '--json'], namedDryIo), 0)
    assert.equal(JSON.parse(namedDryIo.read().out).title, 'meaningful-name')

    const stdinDryIo = makeIo({ stdin: '来自标准输入且无一级标题的正文。\n' })
    assert.equal(await runCli(['draft', 'push', '-', '--dry-run', '--data-dir', cfgDir, '--json'], stdinDryIo), 0)
    assert.equal(JSON.parse(stdinDryIo.read().out).title, '未命名')

    // 5. 本地图片等阻断级预检问题：--dry-run 报出，正式推送默认阻止，--force 放行并带回 issues
    const localImgMd = join(dir, 'with-local-img.md')
    await writeFile(localImgMd, '# 本地图片测试\n\n![本地图](./missing.png)\n', 'utf8')

    const dryBlockIo = makeIo()
    assert.equal(await runCli(['draft', 'push', localImgMd, '--dry-run', '--data-dir', cfgDir, '--json'], dryBlockIo), 0)
    const dryBlockRes = JSON.parse(dryBlockIo.read().out)
    assert.ok(dryBlockRes.blocking.some(x => x.includes('本地路径')))
    assert.ok(dryBlockRes.issues.some(x => x.includes('本地路径')))

    const dryHumanIo = makeIo()
    assert.equal(await runCli(['draft', 'push', localImgMd, '--dry-run', '--data-dir', cfgDir], dryHumanIo), 0)
    assert.match(dryHumanIo.read().out, /发现 1 项阻断问题/)
    assert.match(dryHumanIo.read().out, /本地路径/)

    let calledFetch = false
    const blockedPushIo = makeIo({ fetchImpl: async () => { calledFetch = true; return Response.json({}) } })
    assert.equal(await runCli(['draft', 'push', localImgMd, '--data-dir', cfgDir, '--json'], blockedPushIo), 2)
    assert.equal(calledFetch, false)
    assert.match(JSON.parse(blockedPushIo.read().out).error, /--force/)

    const forcedPushIo = makeIo({
      fetchImpl: async url => {
        const u = String(url)
        if (u.includes('/cgi-bin/token')) return Response.json({ [tokenKey]: 'mock-force' })
        if (u.includes('/cgi-bin/material/add_material')) return Response.json({ media_id: 'thumb-f' })
        if (u.includes('/cgi-bin/draft/add')) return Response.json({ media_id: 'draft-f' })
        throw new Error(`unexpected url: ${u}`)
      },
    })
    assert.equal(await runCli(['draft', 'push', localImgMd, '--force', '--data-dir', cfgDir, '--json'], forcedPushIo), 0)
    const forcedRes = JSON.parse(forcedPushIo.read().out)
    assert.equal(forcedRes.ok, true)
    assert.equal(forcedRes.mediaId, 'draft-f')
    assert.ok(forcedRes.issues.some(x => x.includes('本地路径')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('check 子命令与 draft push 统一 preflight 契约：普通体检 33–64 字提醒超 64 字阻断，草稿推送 32 字阻断', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-check-'))
  const tokenKey = ['access', 'token'].join('_')
  const mpSecFlag = ['--mp', 'app', 'secret'].join('-')
  const site = ['https:/', 'example.com'].join('/')
  try {
    // 1. check --help
    const helpIo = makeIo()
    assert.equal(await runCli(['check', '--help'], helpIo), 0)
    assert.match(helpIo.read().out, /--fail-on-blocking/)

    // 2. 配置公众号凭证与自定义体检词
    const setIo = makeIo()
    assert.equal(await runCli([
      'settings', 'set',
      '--mp-app-id', 'demo-id',
      mpSecFlag, 'e5f6'.repeat(8),
      '--preflight-words', '竞品A,竞品B',
      '--data-dir', dir,
      '--json',
    ], setIo), 0)
    assert.deepEqual(JSON.parse(setIo.read().out).settings.preflightWords, ['竞品A', '竞品B'])

    // 3. 含外链 + 合规词 + 自定义词 + 文字墙（无阻断项）：check --fail-on-blocking 仍返回 0，draft push 直接成功
    const warnMd = join(dir, 'sponsored.md')
    await writeFile(
      warnMd,
      `# 商单合集实测\n\n看看 [官网](${site}/p) 和 ${site}/q，支持转发抽奖，顺便提一下竞品A。\n\n${'长'.repeat(165)}\n`,
      'utf8',
    )
    const checkWarnIo = makeIo()
    assert.equal(await runCli(['check', warnMd, '--fail-on-blocking', '--data-dir', dir, '--json'], checkWarnIo), 0)
    const checkWarnRes = JSON.parse(checkWarnIo.read().out)
    assert.equal(checkWarnRes.ok, true)
    assert.equal(checkWarnRes.passed, true)
    assert.equal(checkWarnRes.counts.blocking, 0)
    assert.ok(checkWarnRes.counts.warn >= 4)
    assert.ok(checkWarnRes.items.some(i => i.id === 'external-link'))
    assert.ok(checkWarnRes.items.some(i => i.id === 'custom-banned-word'))

    const dryWarnIo = makeIo()
    assert.equal(await runCli(['draft', 'push', warnMd, '--dry-run', '--data-dir', dir, '--json'], dryWarnIo), 0)
    const dryWarnRes = JSON.parse(dryWarnIo.read().out)
    assert.equal(dryWarnRes.preflight.ok, true)
    assert.equal(dryWarnRes.preflight.stats.links, 2)

    const pushWarnIo = makeIo({
      fetchImpl: async url => {
        const u = String(url)
        if (u.includes('/cgi-bin/token')) return Response.json({ [tokenKey]: 'mock-w' })
        if (u.includes('/cgi-bin/material/add_material')) return Response.json({ media_id: 'thumb-w' })
        if (u.includes('/cgi-bin/draft/add')) return Response.json({ media_id: 'draft-w' })
        throw new Error(`unexpected url: ${u}`)
      },
    })
    assert.equal(await runCli(['draft', 'push', warnMd, '--data-dir', dir, '--json'], pushWarnIo), 0)
    const pushWarnRes = JSON.parse(pushWarnIo.read().out)
    assert.equal(pushWarnRes.ok, true)
    assert.equal(pushWarnRes.mediaId, 'draft-w')
    assert.deepEqual(pushWarnRes.preflight.counts, dryWarnRes.preflight.counts)

    // 4. 33 字标题：check 仅做提醒（不阻断），65 字标题 check --fail-on-blocking 返回退出码 1；draft push 仍按 32 字阻断（0 请求），--title 覆盖或 --force 放行
    const longTitleMd = join(dir, 'long-title.md')
    await writeFile(longTitleMd, `# ${'标'.repeat(33)}\n\n正文内容。\n`, 'utf8')
    const over64Md = join(dir, 'over64-title.md')
    await writeFile(over64Md, `# ${'标'.repeat(65)}\n\n正文内容。\n`, 'utf8')

    const checkWarn33Io = makeIo()
    assert.equal(await runCli(['check', longTitleMd, '--fail-on-blocking', '--data-dir', dir, '--json'], checkWarn33Io), 0)
    const checkWarn33Res = JSON.parse(checkWarn33Io.read().out)
    assert.equal(checkWarn33Res.ok, true)
    assert.equal(checkWarn33Res.counts.blocking, 0)
    assert.ok(checkWarn33Res.items.some(i => i.id === 'title-draft-limit' && i.severity === 'warn'))

    const checkBlockIo = makeIo()
    assert.equal(await runCli(['check', over64Md, '--fail-on-blocking', '--data-dir', dir, '--json'], checkBlockIo), 1)
    const checkBlockRes = JSON.parse(checkBlockIo.read().out)
    assert.equal(checkBlockRes.ok, false)
    assert.equal(checkBlockRes.code, 'PREFLIGHT_BLOCKED')
    assert.equal(checkBlockRes.passed, false)
    assert.equal(checkBlockRes.counts.blocking, 1)
    assert.ok(Array.isArray(checkBlockRes.items) && checkBlockRes.items[0].id === 'title-too-long')

    let fetchCount = 0
    const blockedTitleIo = makeIo({ fetchImpl: async () => { fetchCount += 1; return Response.json({}) } })
    assert.equal(await runCli(['draft', 'push', longTitleMd, '--data-dir', dir, '--json'], blockedTitleIo), 2)
    assert.equal(fetchCount, 0)

    const overrideTitleIo = makeIo({
      fetchImpl: async url => {
        const u = String(url)
        if (u.includes('/cgi-bin/token')) return Response.json({ [tokenKey]: 'mock-t' })
        if (u.includes('/cgi-bin/material/add_material')) return Response.json({ media_id: 'thumb-t' })
        if (u.includes('/cgi-bin/draft/add')) return Response.json({ media_id: 'draft-t' })
        throw new Error(`unexpected url: ${u}`)
      },
    })
    assert.equal(await runCli(['draft', 'push', longTitleMd, '--title', '合规短标题', '--data-dir', dir, '--json'], overrideTitleIo), 0)
    assert.equal(JSON.parse(overrideTitleIo.read().out).mediaId, 'draft-t')

    const forceTitleIo = makeIo({
      fetchImpl: async url => {
        const u = String(url)
        if (u.includes('/cgi-bin/token')) return Response.json({ [tokenKey]: 'mock-ft' })
        if (u.includes('/cgi-bin/material/add_material')) return Response.json({ media_id: 'thumb-ft' })
        if (u.includes('/cgi-bin/draft/add')) return Response.json({ media_id: 'draft-ft' })
        throw new Error(`unexpected url: ${u}`)
      },
    })
    assert.equal(await runCli(['draft', 'push', longTitleMd, '--force', '--data-dir', dir, '--json'], forceTitleIo), 0)
    assert.ok(JSON.parse(forceTitleIo.read().out).warnings.some(w => w.includes('32 字上限')))

    // 5. 清空自定义词后不再命中
    const clearIo = makeIo()
    assert.equal(await runCli(['settings', 'set', '--preflight-words', '', '--data-dir', dir, '--json'], clearIo), 0)
    const afterClearIo = makeIo()
    assert.equal(await runCli(['check', warnMd, '--data-dir', dir, '--json'], afterClearIo), 0)
    assert.ok(!JSON.parse(afterClearIo.read().out).items.some(i => i.id === 'custom-banned-word'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('可执行入口 bin/wechat-studio.js 真实子进程冒烟测试', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const { stdout } = await execFileAsync(process.execPath, [BIN_PATH, '--version', '--json'])
  assert.deepEqual(JSON.parse(stdout), { ok: true, version: pkg.version })
})

test('derive 子命令：导出通用 Markdown、--prompt-only 与串推生成', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-derive-'))
  try {
    const importIo = makeIo({ stdin: '# 一稿多发测试\n\n第一段包含 ==重点高亮== 和真实数据 1,200 人。\n\n第二段说明具体步骤。\n\n设为「星标」\n' })
    assert.equal(await runCli(['articles', 'import', '-', '--data-dir', dir, '--json'], importIo), 0)
    const { id } = JSON.parse(importIo.read().out)

    // 1. derive --help
    const helpIo = makeIo()
    assert.equal(await runCli(['derive', '--help', '--json'], helpIo), 0)
    assert.match(JSON.parse(helpIo.read().out).help, /derive markdown/)

    // 2. derive markdown --target zhihu --json
    const zhihuIo = makeIo()
    assert.equal(await runCli(['derive', 'markdown', id, '--target', 'zhihu', '--data-dir', dir, '--json'], zhihuIo), 0)
    const zhihuRes = JSON.parse(zhihuIo.read().out)
    assert.equal(zhihuRes.ok, true)
    assert.equal(zhihuRes.title, '一稿多发测试')
    assert.ok(!zhihuRes.markdown.startsWith('# 一稿多发测试'))
    assert.ok(zhihuRes.markdown.includes('**重点高亮**'))
    assert.ok(!zhihuRes.markdown.includes('设为「星标」'))

    // 3. derive markdown --out 写文件
    const outFile = join(dir, 'out.md')
    const outIo = makeIo()
    assert.equal(await runCli(['derive', 'markdown', id, '--target', 'blog', '--out', outFile, '--data-dir', dir, '--json'], outIo), 0)
    assert.equal(JSON.parse(outIo.read().out).out, outFile)
    assert.match(await readFile(outFile, 'utf8'), /^# 一稿多发测试\n\n/)

    // 4. 非法 --target 返回退出码 2
    const badTargetIo = makeIo()
    assert.equal(await runCli(['derive', 'markdown', id, '--target', 'weibo', '--data-dir', dir, '--json'], badTargetIo), 2)
    const badTargetRes = JSON.parse(badTargetIo.read().out)
    assert.equal(badTargetRes.code, 'USAGE')
    assert.match(badTargetRes.error, /zhihu.*juejin.*blog/)

    // 5. derive thread --prompt-only --json 不调模型也不修改 store
    const promptThreadIo = makeIo()
    assert.equal(await runCli(['derive', 'thread', id, '--variant', 'x', '--prompt-only', '--data-dir', dir, '--json'], promptThreadIo), 0)
    const promptThreadRes = JSON.parse(promptThreadIo.read().out)
    assert.equal(promptThreadRes.ok, true)
    assert.equal(promptThreadRes.promptOnly, true)
    assert.equal(promptThreadRes.platform, 'thread')
    assert.equal(promptThreadRes.variant, 'x')
    assert.match(promptThreadRes.system, /270/)

    // 6. derive xhs --prompt-only --json
    const promptXhsIo = makeIo()
    assert.equal(await runCli(['derive', 'xhs', id, '--prompt-only', '--data-dir', dir, '--json'], promptXhsIo), 0)
    const promptXhsRes = JSON.parse(promptXhsIo.read().out)
    assert.equal(promptXhsRes.ok, true)
    assert.equal(promptXhsRes.promptOnly, true)
    assert.equal(promptXhsRes.platform, 'xhs')

    // 确认 store 未写入任何派生记录
    const articleOnDisk = JSON.parse(await readFile(join(dir, 'articles', id, 'article.json'), 'utf8'))
    assert.equal(articleOnDisk.derivatives, undefined)

    // 7. derive thread <id> --variant jike --json 实际生成并写入 store
    const fakeThreadCtx = {
      get: name => ({
        agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
        llm: {
          prepareCall: () => ({
            config: {},
            async *stream() {
              yield {
                type: 'text-delta',
                text: JSON.stringify({
                  posts: [
                    { text: '第一条：核心结论', source: [] },
                    { text: '第二条：步骤拆解', source: [] },
                    { text: '第三条：欢迎交流', source: [] },
                  ],
                }),
              }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }),
        },
      })[name] ?? null,
    }
    const genThreadIo = makeIo({ ctx: fakeThreadCtx })
    assert.equal(await runCli(['derive', 'thread', id, '--variant', 'jike', '--data-dir', dir, '--json'], genThreadIo), 0)
    const genThreadRes = JSON.parse(genThreadIo.read().out)
    assert.equal(genThreadRes.ok, true)
    assert.equal(genThreadRes.payload.posts.length, 3)

    // 8. 未知子动作返回退出码 2
    const badActionIo = makeIo()
    assert.equal(await runCli(['derive', 'weibo', id, '--data-dir', dir, '--json'], badActionIo), 2)
    assert.equal(JSON.parse(badActionIo.read().out).code, 'USAGE')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI MiniMax H3：settings 配置脱敏与 cover（环境变量、参考图分流及超时提示）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-minimax-'))
  const mmKeyEnv = ['MINIMAX', 'API', 'KEY'].join('_')
  const mmKeyFlag = ['--minimax', 'key'].join('-')
  const secret = 'mm-cli-secret-8888'
  const png = makePngBuffer(94, 40)
  try {
    // 1. settings set 写入 MiniMax 提供方、模型与密钥（不回显明文）
    const setIo = makeIo()
    assert.equal(await runCli([
      'settings', 'set',
      '--cover-provider', 'minimax',
      '--minimax-model', 'MiniMax-H3-Image-Highspeed',
      mmKeyFlag, secret,
      '--data-dir', dir,
      '--json',
    ], setIo), 0)
    const setOut = setIo.read().out
    assert.doesNotMatch(setOut, new RegExp(secret))
    const setRes = JSON.parse(setOut)
    assert.equal(setRes.ok, true)
    assert.equal(setRes.settings.coverProvider, 'minimax')
    assert.equal(setRes.settings.minimaxModel, 'MiniMax-H3-Image-Highspeed')
    assert.equal(setRes.settings.minimaxKeySet, true)

    // 2. settings get 人类可读摘要包含 MiniMax
    const getHumanIo = makeIo()
    assert.equal(await runCli(['settings', 'get', '--data-dir', dir], getHumanIo), 0)
    assert.match(getHumanIo.read().out, /minimax=MiniMax-H3-Image-Highspeed/)
    assert.match(getHumanIo.read().out, /MiniMax 已配置/)

    // 3. cover --prompt-file 无参考图走 generations，支持环境变量覆盖
    const promptPath = join(dir, 'prompt.txt')
    const outPath = join(dir, 'cover-mm.png')
    await writeFile(promptPath, '测试 MiniMax H3 封面提示词', 'utf8')
    const calls = []
    const envCoverIo = makeIo({
      env: { [mmKeyEnv]: 'env-mm-key' },
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return Response.json({ data: [{ b64_json: png.toString('base64') }] })
      },
    })
    assert.equal(await runCli([
      'cover', '--prompt-file', promptPath, '--provider', 'minimax', '--out', outPath, '--data-dir', dir, '--json',
    ], envCoverIo), 0)
    assert.equal(calls[0].url, 'https://api.minimax.cn/v1/images/generations')
    assert.equal(calls[0].init.headers.authorization, 'Bearer env-mm-key')
    assert.equal(JSON.parse(calls[0].init.body).model, 'MiniMax-H3-Image-Highspeed')
    assert.equal(JSON.parse(calls[0].init.body).disable_prompt_enhanced, true)
    assert.ok((await readFile(outPath)).length > 0)

    // 4. 设置 portraitUrl 后走 edits（用工作区已保存的密钥）
    assert.equal(await runCli(['settings', 'set', '--portrait-url', 'https://example.com/me.png', '--data-dir', dir, '--json'], makeIo()), 0)
    const editCoverIo = makeIo({
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return Response.json({ data: [{ b64_json: png.toString('base64') }] })
      },
    })
    assert.equal(await runCli(['cover', '--prompt-file', promptPath, '--data-dir', dir, '--json'], editCoverIo), 0)
    assert.equal(calls[1].url, 'https://api.minimax.cn/v1/images/edits')
    assert.equal(calls[1].init.headers.authorization, `Bearer ${secret}`)
    assert.deepEqual(JSON.parse(calls[1].init.body).images, [{ image_url: 'https://example.com/me.png' }])

    // 5. 超时仅调用 1 次且返回非幂等提示（不含请重试）
    let timeoutAttempts = 0
    const timeoutIo = makeIo({
      fetchImpl: async () => {
        timeoutAttempts++
        throw new DOMException('timeout', 'TimeoutError')
      },
    })
    assert.equal(await runCli(['cover', '--prompt-file', promptPath, '--provider', 'minimax', '--data-dir', dir, '--json'], timeoutIo), 1)
    assert.equal(timeoutAttempts, 1)
    const timeoutRes = JSON.parse(timeoutIo.read().out)
    assert.match(timeoutRes.error, /600 秒.*计费/)
    assert.doesNotMatch(timeoutRes.error, /请重试/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI settings 与 cover：支持 Google Gemini（Nano Banana）配置、自定义 Base URL 与生图', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-gemini-'))
  const png = makePngBuffer(94, 40)
  const secret = 'AIza-cli-secret-999'
  const keyFlag = ['--gemini', 'key'].join('-')
  const keyEnv = ['GEMINI', 'API', 'KEY'].join('_')
  try {
    const setIo = makeIo()
    assert.equal(await runCli([
      'settings', 'set',
      '--cover-provider', 'gemini',
      '--gemini-model', 'gemini-3-pro-image',
      keyFlag, secret,
      '--gemini-base-url', 'https://relay.example.com/v1beta/',
      '--data-dir', dir,
      '--json',
    ], setIo), 0)
    const setOut = setIo.read().out
    assert.doesNotMatch(setOut, new RegExp(secret))
    const setRes = JSON.parse(setOut)
    assert.equal(setRes.ok, true)
    assert.equal(setRes.settings.coverProvider, 'gemini')
    assert.equal(setRes.settings.geminiModel, 'gemini-3-pro-image')
    assert.equal(setRes.settings.geminiKeySet, true)
    assert.equal(setRes.settings.geminiBaseUrl, 'https://relay.example.com')

    const getHumanIo = makeIo()
    assert.equal(await runCli(['settings', 'get', '--data-dir', dir], getHumanIo), 0)
    assert.match(getHumanIo.read().out, /gemini=gemini-3-pro-image/)
    assert.match(getHumanIo.read().out, /Gemini 已配置/)

    const promptPath = join(dir, 'prompt.txt')
    const outPath = join(dir, 'cover-gemini.png')
    await writeFile(promptPath, '测试 Gemini Nano Banana 封面提示词', 'utf8')
    const calls = []
    const coverIo = makeIo({
      env: { [keyEnv]: 'AIza-env-override' },
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return Response.json({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
        })
      },
    })
    assert.equal(await runCli([
      'cover', '--prompt-file', promptPath, '--provider', 'gemini', '--out', outPath, '--data-dir', dir, '--json',
    ], coverIo), 0)
    assert.equal(calls[0].url, 'https://relay.example.com/v1beta/models/gemini-3-pro-image:generateContent')
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-env-override')
    assert.ok((await readFile(outPath)).length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI settings 与 cover：支持 OpenAI（GPT Image）配置、自定义 Base URL、环境变量覆盖与生图', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-openai-'))
  const png = makePngBuffer(94, 40)
  const secret = 'sk-openai-cli-secret-999'
  const keyFlag = ['--openai', 'key'].join('-')
  const keyEnv = ['OPENAI', 'API', 'KEY'].join('_')
  const baseEnv = ['OPENAI', 'BASE', 'URL'].join('_')
  try {
    const setIo = makeIo()
    assert.equal(await runCli([
      'settings', 'set',
      '--cover-provider', 'openai',
      '--openai-model', 'gpt-image-2.6-flare',
      keyFlag, secret,
      '--openai-base-url', 'https://relay.example.com/openai/v1/',
      '--data-dir', dir,
      '--json',
    ], setIo), 0)
    const setOut = setIo.read().out
    assert.doesNotMatch(setOut, new RegExp(secret))
    const setRes = JSON.parse(setOut)
    assert.equal(setRes.ok, true)
    assert.equal(setRes.settings.coverProvider, 'openai')
    assert.equal(setRes.settings.openaiModel, 'gpt-image-2.6-flare')
    assert.equal(setRes.settings.openaiKeySet, true)
    assert.equal(setRes.settings.openaiBaseUrl, 'https://relay.example.com/openai/v1')

    const getHumanIo = makeIo()
    assert.equal(await runCli(['settings', 'get', '--data-dir', dir], getHumanIo), 0)
    assert.match(getHumanIo.read().out, /openai=gpt-image-2\.6-flare/)
    assert.match(getHumanIo.read().out, /OpenAI 已配置/)

    const promptPath = join(dir, 'prompt.txt')
    const outPath = join(dir, 'cover-openai.png')
    await writeFile(promptPath, '测试 OpenAI GPT Image 封面提示词', 'utf8')
    const calls = []
    const coverIo = makeIo({
      env: { [keyEnv]: 'sk-openai-env-override', [baseEnv]: 'https://env-relay.example.com/v1/' },
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return Response.json({ data: [{ b64_json: png.toString('base64') }] })
      },
    })
    assert.equal(await runCli([
      'cover', '--prompt-file', promptPath, '--provider', 'openai', '--out', outPath, '--data-dir', dir, '--json',
    ], coverIo), 0)
    assert.equal(calls[0].url, 'https://env-relay.example.com/v1/images/generations')
    assert.equal(calls[0].init.headers.authorization, 'Bearer sk-openai-env-override')
    assert.equal(JSON.parse(calls[0].init.body).model, 'gpt-image-2.6-flare')
    assert.ok((await readFile(outPath)).length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI cover 子命令：支持本地自定义封面风格、--prompt-only、usePortrait 透传与非法风格报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-cli-custom-cover-'))
  const mdPath = join(dir, 'post.md')
  const png = makePngBuffer(94, 40)
  try {
    await writeFile(mdPath, '# CLI 自定义封面测试\n\n这是用来验证 CLI 自定义封面风格的正文内容。\n', 'utf8')
    const noPortrait = (await saveCustomCoverStyle(dir, {
      name: 'CLI纯静物',
      description: '不带真人的静物封面。',
      usePortrait: false,
      template: '21:9 极简静物，标题 {{主标题}}，物件 {{核心物件}}',
      guidance: '标题限 10 字',
    })).style
    const withPortrait = (await saveCustomCoverStyle(dir, {
      name: 'CLI真人出镜',
      description: '带真人出镜封面。',
      usePortrait: true,
      template: '21:9 杂志封面，标题 {{主标题}}，视觉 {{视觉}}，人物 [[SUBJECT]] 穿 [[OUTFIT]]',
      guidance: '',
    })).style

    // 1. --prompt-only --json 使用自定义风格且不含内置 SKILL.md 文案
    const poIo = makeIo()
    assert.equal(await runCli(['cover', mdPath, '--style', noPortrait.id, '--prompt-only', '--data-dir', dir, '--json'], poIo), 0)
    const poRes = JSON.parse(poIo.read().out)
    assert.equal(poRes.ok, true)
    assert.equal(poRes.style, noPortrait.id)
    assert.deepEqual(poRes.slots, ['主标题', '核心物件'])
    assert.doesNotMatch(poRes.system, /林月半子|七种风格|左字右人/)

    // 2. 配置 portraitUrl 与火山方舟密钥，验证 usePortrait: false 不传图、true 传图
    assert.equal(await runCli([
      'settings', 'set',
      '--cover-provider', 'ark',
      '--ark-key', 'sk-ark-cli',
      '--portrait-url', 'https://example.com/cli-me.png',
      '--data-dir', dir,
      '--json',
    ], makeIo()), 0)

    const arkBodies = []
    const makeMockIo = () => makeIo({
      env: { OPENAI_API_KEY: 'sk-llm', OPENAI_MODEL: 'gpt-test' },
      fetchImpl: async (url, init) => {
        if (String(url).includes('chat/completions')) {
          return Response.json({ choices: [{ message: { content: JSON.stringify({ values: ['CLI标题', 'CLI元素'] }) } }] })
        }
        arkBodies.push(JSON.parse(init.body))
        return Response.json({ data: [{ b64_json: png.toString('base64') }] })
      },
    })

    const io1 = makeMockIo()
    assert.equal(await runCli(['cover', mdPath, '--style', noPortrait.id, '--data-dir', dir, '--json'], io1), 0)
    assert.equal(arkBodies[0].image, undefined, 'usePortrait: false 不应传 portraitUrl')

    const io2 = makeMockIo()
    assert.equal(await runCli(['cover', mdPath, '--style', withPortrait.id, '--data-dir', dir, '--json'], io2), 0)
    assert.equal(arkBodies[1].image, 'https://example.com/cli-me.png', 'usePortrait: true 应传 portraitUrl')

    // 3. 未知风格退出码 2 且错误提示列出内置和本地自定义风格 ID
    const badIo = makeIo()
    assert.equal(await runCli(['cover', mdPath, '--style', 'nonexistent', '--data-dir', dir, '--json'], badIo), 2)
    const badRes = JSON.parse(badIo.read().out)
    assert.match(badRes.error, /不支持的封面风格/)
    assert.match(badRes.error, new RegExp(noPortrait.id))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
