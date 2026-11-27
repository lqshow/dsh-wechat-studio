import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import * as gifenc from 'gifenc'
import { createArticle } from '../src/article.js'
import { runCli } from '../src/cli.js'
import { Store } from '../src/store.js'
import { exportXhsDeckToDir, findFfmpeg, findHeadlessBrowser } from '../src/xhs-cli-export.js'

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

test('CLI derive xhs --options returns full style, theme, and ambient decor catalog', async () => {
  const io = makeIo()
  const code = await runCli(['derive', 'xhs', '--options', '--json'], io)
  assert.equal(code, 0)
  const data = JSON.parse(io.read().out)
  assert.equal(data.ok, true)
  assert.equal(data.styles.length, 9)
  assert.ok(data.styles.some(s => s.id === 'vinyl'))
  assert.equal(data.themes.length, 6)
  assert.equal(data.decors.length, 8)
  assert.equal(data.decorScopes.length, 4)
  assert.ok(Array.isArray(data.interactionFlow) && data.interactionFlow.length >= 2)
})

test('CLI derive xhs without style/design-prompt/ref-image triggers NEEDS_STYLE_CONFIRMATION gate before calling LLM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-xhs-gate-'))
  try {
    const mdPath = join(dir, 'sample.md')
    await writeFile(mdPath, '# 标题\n\n第一段。\n', 'utf8')
    const io = makeIo()
    const code = await runCli(['derive', 'xhs', mdPath, '--data-dir', dir, '--out-dir', join(dir, 'out'), '--json'], io)
    assert.equal(code, 0)
    const data = JSON.parse(io.read().out)
    assert.equal(data.ok, true)
    assert.equal(data.needsConfirmation, true)
    assert.equal(data.code, 'NEEDS_STYLE_CONFIRMATION')
    assert.equal(data.actionRequired, 'ask_user_3_steps')
    assert.deepEqual(data.missingFields, ['style', 'theme', 'decor'])
    assert.equal(data.requiredQuestions.length, 3)
    assert.deepEqual(data.requiredQuestions.map(q => q.field), ['style', 'theme', 'decor'])
    assert.match(data.requiredQuestions[0].question, /swiss\(/)
    assert.match(data.requiredQuestions[0].question, /newyorker\(/)
    assert.match(data.requiredQuestions[0].question, /vinyl\(/)
    assert.equal(data.options.styles.length, 9)

    // Partial selection (only --style, missing --theme and --decor) is still gated for remaining 2 steps
    const ioPartial = makeIo()
    const codePartial = await runCli(['derive', 'xhs', mdPath, '--data-dir', dir, '--style', 'tech', '--json'], ioPartial)
    assert.equal(codePartial, 0)
    const partial = JSON.parse(ioPartial.read().out)
    assert.equal(partial.needsConfirmation, true)
    assert.deepEqual(partial.missingFields, ['theme', 'decor'])
    assert.deepEqual(partial.requiredQuestions.map(q => q.field), ['theme', 'decor'])
    assert.equal(data.options.themes.length, 6)
    assert.equal(data.options.decors.length, 8)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI derive xhs without API key automatically returns agent_generate bundle and completes via apply', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-xhs-agent-'))
  const outDir = join(dir, 'out')
  try {
    const mdPath = join(dir, 'article.md')
    await writeFile(
      mdPath,
      '# 借用朋友的 Codex\n\n第一段讲双 Agent 接力。\n\n![实测截图](https://example.com/shot-1.png)\n\n第二段讲上下文无缝流转。\n',
      'utf8',
    )

    // Step 1: With style chosen but no WECHAT_STUDIO_API_KEY, CLI returns agent_generate bundle (exit 0)
    const io1 = makeIo({ env: {} })
    const code1 = await runCli([
      'derive', 'xhs', mdPath,
      '--data-dir', dir,
      '--style', 'monocle',
      '--theme', 'editorial',
      '--decor', 'silk-dots',
      '--decor-scope', 'smart',
      '--out-dir', outDir,
      '--json',
    ], io1)
    assert.equal(code1, 0)
    const bundle = JSON.parse(io1.read().out)
    assert.equal(bundle.ok, true)
    assert.equal(bundle.mode, 'agent_generate')
    assert.equal(bundle.code, 'AGENT_GENERATE_REQUIRED')
    assert.equal(bundle.styleKit?.id, 'monocle')
    assert.match(bundle.styleKit?.guidance || '', /\.mo-giant-num/)
    assert.equal(bundle.articleImages.length, 1)
    assert.equal(bundle.articleImages[0].url, 'https://example.com/shot-1.png')
    assert.match(bundle.applyCommand, /derive xhs apply/)

    // Step 2: External agent writes deck.json using its own model and calls derive xhs apply
    const deckPath = join(dir, 'deck.json')
    await writeFile(deckPath, JSON.stringify({
      title: '借用朋友的 Codex 实测',
      body: '把两个 Agent 放进同一个 Room 之后，上下文无缝流动，再也不用人工来回粘贴复制，写代码和 Review 效率直接翻倍。',
      tags: ['AI编程', 'Codex', '效率工具'],
      deckStyle: 'editorial',
      cards: [
        {
          kind: 'cover',
          heading: 'Codex 额度借我，项目它全知道',
          subheading: '双 Agent 接力实测',
          lines: ['上下文自动流动'],
          html: '<div class="cd-main"><div class="mo-giant-num">01</div><h1 class="cd-title">Codex 额度借我</h1></div>',
        },
        {
          kind: 'steps',
          heading: '三步跑通协作',
          lines: ['进入同一 Room', '直接接手上下文', '原地 Review'],
          html: '<div class="cd-main"><h2 class="cd-title">三步跑通协作</h2><img src="https://example.com/shot-1.png" alt="实测截图" /></div>',
        },
        {
          kind: 'list',
          heading: '实测省下的时间',
          lines: ['不用复制对话摘要', '不用手动贴代码差异', '结论直接落回原对话'],
          html: '<div class="cd-main"><h2 class="cd-title">实测省下的时间</h2></div>',
        },
        {
          kind: 'quote',
          heading: '核心体会',
          lines: ['给 Agent 当翻译，可能比写代码还耗时。'],
          html: '<div class="cd-main"><blockquote>给 Agent 当翻译，可能比写代码还耗时。</blockquote></div>',
        },
        {
          kind: 'end',
          heading: '今晚就试试',
          lines: ['收藏备用，评论区聊聊你的双 Agent 工作流'],
          html: '<div class="cd-main"><div class="mo-letter-end">今晚就试试双 Agent 协作。</div></div>',
        },
      ],
    }), 'utf8')

    const io2 = makeIo({ env: {} })
    const code2 = await runCli([
      'derive', 'xhs', 'apply', mdPath, deckPath,
      '--data-dir', dir,
      '--style', 'monocle',
      '--theme', 'editorial',
      '--decor', 'silk-dots',
      '--decor-scope', 'smart',
      '--out-dir', outDir,
      '--no-png',
      '--json',
    ], io2)
    assert.equal(code2, 0)
    const applied = JSON.parse(io2.read().out)
    assert.equal(applied.ok, true)
    assert.equal(applied.applied, true)
    assert.equal(applied.payload.cards.length, 5)
    assert.deepEqual(applied.payload.tweaks, { preset: 'editorial', decor: 'silk-dots', decorScope: 'smart' })

    const previewHtml = await readFile(join(outDir, 'preview.html'), 'utf8')
    assert.match(previewHtml, /mo-giant-num/)
    assert.match(previewHtml, /data-decor-preset=&quot;silk-dots&quot;/)

    // Running apply again with the exact same local markdown reuses the existing article (no duplicate drafts)
    const io3 = makeIo({ env: {} })
    const code3 = await runCli([
      'derive', 'xhs', 'apply', mdPath, deckPath,
      '--data-dir', dir,
      '--style', 'monocle',
      '--theme', 'editorial',
      '--decor', 'silk-dots',
      '--no-png',
      '--json',
    ], io3)
    assert.equal(code3, 0)
    const appliedAgain = JSON.parse(io3.read().out)
    assert.equal(appliedAgain.id, applied.id)
    assert.equal(appliedAgain.imported, false)
    const storeAfter = await new Store(dir).read()
    assert.equal(storeAfter.articles.length, 1)
    assert.equal(storeAfter.articles[0].derivatives.xhs.platform, 'xhs')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI derive xhs accepts local markdown file with --style, --design-prompt, --theme, --decor in --prompt-only mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-xhs-cli-'))
  try {
    const mdPath = join(dir, 'sample.md')
    await writeFile(mdPath, '# 把剪辑交给 AI\n\n第一段讲为什么传统剪辑耗时。\n\n第二段讲 Skill 工作流怎么省事。\n', 'utf8')

    const io = makeIo()
    const code = await runCli([
      'derive', 'xhs', mdPath,
      '--data-dir', dir,
      '--style', 'monocle',
      '--design-prompt', '留白再多一点',
      '--theme', 'editorial',
      '--decor', 'silk-dots',
      '--decor-scope', 'smart',
      '--prompt-only',
      '--json',
    ], io)
    assert.equal(code, 0)
    const data = JSON.parse(io.read().out)
    assert.equal(data.ok, true)
    assert.equal(data.promptOnly, true)
    assert.equal(data.style, 'monocle')
    assert.match(data.designPrompt, /Monocle/)
    assert.match(data.designPrompt, /留白再多一点/)
    assert.deepEqual(data.tweaks, { preset: 'editorial', decor: 'silk-dots', decorScope: 'smart' })

    // Invalid style returns exit code 2
    const badIo = makeIo()
    const badCode = await runCli(['derive', 'xhs', mdPath, '--data-dir', dir, '--style', 'nonexistent', '--prompt-only', '--json'], badIo)
    assert.equal(badCode, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI derive xhs render re-renders existing deck with updated theme and decor at zero LLM cost', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-xhs-render-'))
  const outDir = join(dir, 'exported')
  try {
    const store = new Store(dir)
    const article = createArticle({ markdown: '# 测试稿件\n\n第一段正文。\n\n第二段正文。\n' })
    article.derivatives = {
      xhs: {
        generatedAt: Date.now(),
        payload: {
          title: '测试小红书标题',
          body: '正文内容测试。',
          tags: ['效率', 'AI'],
          deckStyle: 'editorial',
          designPrompt: 'Monocle 日系杂志',
          cards: [
            { kind: 'cover', heading: '把剪辑交给 AI', subheading: '三步自动成片', lines: ['省下两小时'] },
            { kind: 'list', heading: '核心步骤', lines: ['收集素材', '调用 Skill', '导出成片'] },
          ],
        },
      },
    }
    await store.update(s => {
      s.articles.push(article)
      s.currentId = article.id
    })

    const io = makeIo()
    const code = await runCli([
      'derive', 'xhs', 'render', article.id,
      '--data-dir', dir,
      '--theme', 'bold',
      '--decor', 'orbital-arc',
      '--decor-scope', 'cover',
      '--out-dir', outDir,
      '--no-png',
      '--json',
    ], io)
    assert.equal(code, 0)
    const data = JSON.parse(io.read().out)
    assert.equal(data.ok, true)
    assert.deepEqual(data.tweaks, { preset: 'bold', decor: 'orbital-arc', decorScope: 'cover' })

    const [postTxt, previewHtml, deckJson] = await Promise.all([
      readFile(join(outDir, 'post.txt'), 'utf8'),
      readFile(join(outDir, 'preview.html'), 'utf8'),
      readFile(join(outDir, 'deck.json'), 'utf8'),
    ])
    assert.match(postTxt, /测试小红书标题/)
    assert.match(previewHtml, /data-decor-preset=&quot;orbital-arc&quot;/)
    assert.equal(JSON.parse(deckJson).tweaks.preset, 'bold')

    // Confirm tweaks persisted back to shared store
    const persisted = (await store.read()).articles.find(a => a.id === article.id)
    assert.deepEqual(persisted.derivatives.xhs.payload.tweaks, {
      preset: 'bold',
      decor: 'orbital-arc',
      decorScope: 'cover',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('exportXhsDeckToDir renders real 2x PNG via headless browser when available', async t => {
  const browser = await findHeadlessBrowser(process.env)
  if (!browser) {
    t.skip('No local headless Chrome/Chromium available')
    return
  }
  const outDir = await mkdtemp(join(tmpdir(), 'ws-xhs-png-'))
  try {
    const res = await exportXhsDeckToDir({
      payload: {
        title: '实测无头出图',
        body: '测试正文',
        tags: ['AI'],
        deckStyle: 'editorial',
        tweaks: { preset: 'editorial', decor: 'silk-dots', decorScope: 'smart' },
        cards: [
          { kind: 'cover', heading: '不会写提示词也能剪视频', subheading: '实测工作流', lines: ['3 个 Skill 跑通'] },
        ],
      },
      author: '林月半子',
      outDir,
      renderPng: true,
      browserPath: browser,
    })
    assert.equal(res.pngFiles.length, 1)
    const buf = await readFile(res.pngFiles[0])
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    assert.equal(buf[0], 0x89)
    assert.equal(buf[1], 0x50)
    assert.equal(buf[2], 0x4e)
    assert.equal(buf[3], 0x47)
    assert.ok(buf.length > 5000, 'Rendered PNG should not be empty')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})

test('exportXhsDeckToDir automatically exports animated GIF for cards containing a GIF image', async t => {
  const [browser, ffmpeg] = await Promise.all([
    findHeadlessBrowser(process.env),
    findFfmpeg(process.env),
  ])
  if (!browser || !ffmpeg) {
    t.skip('Requires local headless Chrome and ffmpeg')
    return
  }
  const { GIFEncoder, quantize, applyPalette } = gifenc.GIFEncoder ? gifenc : gifenc.default
  const enc = GIFEncoder()
  const w = 16
  const h = 16
  const frame1 = new Uint8Array(w * h * 4)
  const frame2 = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    frame1.set([200, 90, 50, 255], i * 4)
    frame2.set([37, 99, 235, 255], i * 4)
  }
  const p1 = quantize(frame1, 16)
  const p2 = quantize(frame2, 16)
  enc.writeFrame(applyPalette(frame1, p1), w, h, { palette: p1, delay: 200 })
  enc.writeFrame(applyPalette(frame2, p2), w, h, { palette: p2, delay: 200 })
  enc.finish()
  const gifDataUrl = `data:image/gif;base64,${Buffer.from(enc.bytes()).toString('base64')}`

  const outDir = await mkdtemp(join(tmpdir(), 'ws-xhs-gif-'))
  try {
    const res = await exportXhsDeckToDir({
      payload: {
        title: '含 GIF 动图导出测试',
        body: '测试自动识别含 GIF 的卡片并导出动态 GIF 文件。',
        tags: ['动图'],
        deckStyle: 'editorial',
        tweaks: { preset: 'editorial', decor: 'silk-dots', decorScope: 'smart' },
        cards: [
          {
            kind: 'cover',
            heading: '动图卡片自动导出 GIF',
            subheading: '静态页仍为 2× PNG',
            lines: ['保留动图帧率'],
            html: `<div class="cd-main"><h1 class="cd-title">动图卡片测试</h1><img src="${gifDataUrl}" style="width:600px;height:400px;object-fit:cover;border-radius:16px;" /></div>`,
          },
          {
            kind: 'list',
            heading: '普通静态页',
            lines: ['依然导出 2× 高清 PNG'],
          },
        ],
      },
      author: '林月半子',
      outDir,
      renderPng: true,
      browserPath: browser,
    })
    assert.equal(res.gifFiles.length, 1)
    assert.equal(res.pngFiles.length, 1)
    assert.equal(res.mediaFiles.length, 2)
    assert.match(res.mediaFiles[0], /01\.gif$/)
    assert.match(res.mediaFiles[1], /02\.png$/)
    const gifBuf = await readFile(res.gifFiles[0])
    assert.equal(gifBuf.subarray(0, 6).toString('ascii'), 'GIF89a')
    // Verify high-resolution 2x (2160x2880) logical screen size when under 10 MB
    assert.equal(gifBuf.readUInt16LE(6), 2160)
    assert.equal(gifBuf.readUInt16LE(8), 2880)
    // Verify multiple animation frames (Graphic Control Extension 0x21 0xF9 0x04 appears >= 2 times)
    let gceCount = 0
    for (let i = 0; i < gifBuf.length - 3; i++) {
      if (gifBuf[i] === 0x21 && gifBuf[i + 1] === 0xf9 && gifBuf[i + 2] === 0x04) gceCount++
    }
    assert.ok(gceCount >= 2, `Expected >= 2 animation frames in exported GIF, got ${gceCount}`)
    assert.ok(gifBuf.length > 5000, 'Rendered GIF should not be empty')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
