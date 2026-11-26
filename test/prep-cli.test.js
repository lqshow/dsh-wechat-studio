import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { runCli } from '../src/cli.js'
import { PREP_EMPTY } from '../src/prep.js'
import { atOn } from '../src/schedule-time.js'
import { updateSettings } from '../src/settings.js'
import { JsonStore, Store } from '../src/store.js'

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

function makePngBuffer(width = 32, height = 32) {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 168
    png.data[i + 1] = 75
    png.data[i + 2] = 44
    png.data[i + 3] = 255
  }
  return PNG.sync.write(png)
}

test('prep 帮助与 check/draft 帮助包含新增选项', async () => {
  for (const args of [
    ['--help'],
    ['prep', '--help'],
    ['prep', 'list', '--help'],
    ['prep', 'note', '--help'],
    ['prep', 'bag', '--help'],
    ['prep', 'bag', 'create', '--help'],
    ['prep', 'bag', 'export', '--help'],
    ['prep', 'bag', 'promote', '--help'],
  ]) {
    const io = makeIo()
    assert.equal(await runCli(args, io), 0, `expected exit 0 for ${args.join(' ')}`)
    assert.match(io.read().out, /prep/)
  }

  const checkHelp = makeIo()
  assert.equal(await runCli(['check', '--help'], checkHelp), 0)
  assert.match(checkHelp.read().out, /--bag/)
  assert.match(checkHelp.read().out, /--article/)

  const draftHelp = makeIo()
  assert.equal(await runCli(['draft', '--help'], draftHelp), 0)
  assert.match(draftHelp.read().out, /--bag/)
  assert.match(draftHelp.read().out, /--article/)
})

test('prep note / bag create / list / bag export 完整工作流', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-prep-cli-basic-'))
  try {
    // 1. 创建自由纸条（直接传文本 & stdin）
    const note1Io = makeIo()
    assert.equal(await runCli(['prep', 'note', '自由灵感：开头用真实翻车案例', '--data-dir', dir, '--json'], note1Io), 0)
    const note1Res = JSON.parse(note1Io.read().out)
    assert.equal(note1Res.ok, true)
    assert.equal(note1Res.note.bagId, null)
    assert.equal(note1Res.note.kind, 'text')
    assert.equal(note1Res.note.text, '自由灵感：开头用真实翻车案例')

    const noteStdinIo = makeIo({ stdin: '参考链接 https://example.com/cursor-review\n' })
    assert.equal(await runCli(['prep', 'note', '-', '--data-dir', dir, '--json'], noteStdinIo), 0)
    const noteStdinRes = JSON.parse(noteStdinIo.read().out)
    assert.equal(noteStdinRes.ok, true)
    assert.equal(noteStdinRes.note.kind, 'link')
    assert.equal(noteStdinRes.note.link.host, 'example.com')

    // 2. 创建商单袋与普通选题袋
    const sponsoredIo = makeIo()
    assert.equal(await runCli([
      'prep', 'bag', 'create', 'Cursor 2.0 实测',
      '--sponsored',
      '--partner', 'Cursor',
      '--date', '2026-11-26',
      '--selling-points', '多文件重构速度快、本地隐私模式',
      '--must-include', '专属试用链接,14天Pro兑换码',
      '--taboo', '全网最强,贬低竞品',
      '--data-dir', dir,
      '--json',
    ], sponsoredIo), 0)
    const sponsoredRes = JSON.parse(sponsoredIo.read().out)
    assert.equal(sponsoredRes.ok, true)
    assert.equal(sponsoredRes.bag.type, 'sponsored')
    assert.equal(sponsoredRes.bag.targetDate, '2026-11-26')
    assert.equal(sponsoredRes.bag.brief.partner, 'Cursor')
    assert.deepEqual(sponsoredRes.bag.brief.mustInclude, ['专属试用链接', '14天Pro兑换码'])
    assert.deepEqual(sponsoredRes.bag.brief.taboo, ['全网最强', '贬低竞品'])
    const sponsoredBagId = sponsoredRes.bag.id

    const topicIo = makeIo()
    assert.equal(await runCli(['prep', 'bag', 'create', '普通技术复盘', '--data-dir', dir, '--json'], topicIo), 0)
    const topicRes = JSON.parse(topicIo.read().out)
    assert.equal(topicRes.ok, true)
    assert.equal(topicRes.bag.type, 'topic')

    // 非法日期 -> exit 2
    const badDateIo = makeIo()
    assert.equal(await runCli(['prep', 'bag', 'create', '坏日期', '--date', '2026-13-40', '--data-dir', dir, '--json'], badDateIo), 2)
    assert.equal(JSON.parse(badDateIo.read().out).code, 'USAGE')

    // 3. 向商单袋投递带图片的纸条
    const imgPath = join(dir, 'shot.png')
    await writeFile(imgPath, makePngBuffer())
    const bagNoteIo = makeIo()
    assert.equal(await runCli([
      'prep', 'note', '实测重构对比截图',
      '--bag', sponsoredBagId,
      '--image', imgPath,
      '--data-dir', dir,
      '--json',
    ], bagNoteIo), 0)
    const bagNoteRes = JSON.parse(bagNoteIo.read().out)
    assert.equal(bagNoteRes.ok, true)
    assert.equal(bagNoteRes.note.bagId, sponsoredBagId)
    assert.equal(bagNoteRes.note.kind, 'image')
    assert.equal(bagNoteRes.note.image.ext, 'png')

    // 非法图片 -> exit 2
    const badImgPath = join(dir, 'fake.png')
    await writeFile(badImgPath, 'not a png', 'utf8')
    const badImgIo = makeIo()
    assert.equal(await runCli(['prep', 'note', '坏图', '--image', badImgPath, '--data-dir', dir, '--json'], badImgIo), 2)
    assert.equal(JSON.parse(badImgIo.read().out).code, 'USAGE')

    // 4. prep list 过滤（全部 / --sponsored / --bags / --notes）
    const listAllIo = makeIo()
    assert.equal(await runCli(['prep', 'list', '--data-dir', dir, '--json'], listAllIo), 0)
    const listAll = JSON.parse(listAllIo.read().out)
    assert.equal(listAll.ok, true)
    assert.equal(listAll.bags.length, 2)
    assert.equal(listAll.notes.length, 2) // 仅自由纸条，不含已入袋的纸条

    const listSponsoredIo = makeIo()
    assert.equal(await runCli(['prep', 'list', '--sponsored', '--data-dir', dir, '--json'], listSponsoredIo), 0)
    const listSponsored = JSON.parse(listSponsoredIo.read().out)
    assert.equal(listSponsored.ok, true)
    assert.equal(listSponsored.bags.length, 1)
    assert.equal(listSponsored.bags[0].id, sponsoredBagId)
    assert.equal(listSponsored.notes.length, 0)

    const listNotesIo = makeIo()
    assert.equal(await runCli(['prep', 'list', '--notes', '--data-dir', dir, '--json'], listNotesIo), 0)
    const listNotes = JSON.parse(listNotesIo.read().out)
    assert.equal(listNotes.bags.length, 0)
    assert.equal(listNotes.notes.length, 2)

    // 5. prep bag export --json 与 --out
    const outFile = join(dir, 'brief.md')
    const exportIo = makeIo()
    assert.equal(await runCli(['prep', 'bag', 'export', sponsoredBagId, '--out', outFile, '--data-dir', dir, '--json'], exportIo), 0)
    const exportRes = JSON.parse(exportIo.read().out)
    assert.equal(exportRes.ok, true)
    assert.equal(exportRes.bagId, sponsoredBagId)
    assert.equal(exportRes.out, outFile)
    assert.match(exportRes.markdown, /# Cursor 2\.0 实测/)
    assert.match(exportRes.markdown, /Cursor/)
    assert.match(exportRes.markdown, /专属试用链接/)
    assert.match(exportRes.markdown, /prep-assets[/\\]/)
    assert.equal(await readFile(outFile, 'utf8'), exportRes.markdown)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('prep bag promote：执行对账、继承排期，并在 Cloudinary 配置/未配置/失败时正确转存图片与输出 warnings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-prep-cli-promote-'))
  try {
    const imgPath = join(dir, 'demo.png')
    await writeFile(imgPath, makePngBuffer())

    // Case A: Cloudinary 已配置 + 存在超时 pendingPromotion（验证 reconcilePrep 先清理再升格，上传并缓存 cloudinaryUrl）
    await updateSettings(dir, {
      cloudinary: { cloudName: 'demo-cloud', apiKey: 'demo-key', apiSecret: 'demo-secret-1234' },
    })

    const bagAIo = makeIo()
    assert.equal(await runCli([
      'prep', 'bag', 'create', '已配图床商单',
      '--sponsored',
      '--partner', 'Acme',
      '--date', '2026-11-26',
      '--data-dir', dir,
      '--json',
    ], bagAIo), 0)
    const bagAId = JSON.parse(bagAIo.read().out).bag.id

    const noteAIo = makeIo()
    assert.equal(await runCli(['prep', 'note', '演示截图', '--bag', bagAId, '--image', imgPath, '--data-dir', dir, '--json'], noteAIo), 0)
    const assetA = JSON.parse(noteAIo.read().out).note.image

    // 注入一个超时（>30s）的 pendingPromotion，验证 promote 前会执行 reconcilePrep 自动清理而非报 409
    const prepStore = new JsonStore(dir, { file: 'prep.json', empty: PREP_EMPTY })
    await prepStore.update(state => {
      const b = state.bags.find(x => x.id === bagAId)
      b.pendingPromotion = {
        operationId: 'stale-op-1',
        articleId: 'a_stale_999',
        mode: 'import',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      }
    })

    const mdAPath = join(dir, 'article-a.md')
    await writeFile(
      mdAPath,
      `# 已配图床商单\n\n这是实测正文。\n\n![演示截图](prep-assets/${assetA.assetId}.${assetA.ext})\n`,
      'utf8',
    )

    let uploadCalls = 0
    const promoteAIo = makeIo({
      fetchImpl: async url => {
        uploadCalls += 1
        assert.match(String(url), /api\.cloudinary\.com\/v1_1\/demo-cloud\/image\/upload/)
        return Response.json({ secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/demo-a.png' })
      },
    })
    const promoteArgs = ['prep', 'bag', 'promote', bagAId, '--markdown', mdAPath, '--operation-id', 'cli-retry-a', '--data-dir', dir, '--json']
    assert.equal(await runCli(promoteArgs, promoteAIo), 0)
    const promoteARes = JSON.parse(promoteAIo.read().out)
    assert.equal(promoteARes.ok, true)
    assert.equal(promoteARes.bagId, bagAId)
    assert.ok(promoteARes.articleId)
    assert.equal(promoteARes.scheduledFor, atOn('2026-11-26', 20, 0))
    assert.deepEqual(promoteARes.imageTransfer, { uploaded: 1, failed: 0, warnings: [] })
    assert.deepEqual(promoteARes.warnings, [])
    assert.equal(uploadCalls, 1)
    const retryIo = makeIo()
    assert.equal(await runCli(promoteArgs, retryIo), 0)
    assert.equal(JSON.parse(retryIo.read().out).articleId, promoteARes.articleId)

    // 验证文章内容已替换为 Cloudinary URL，且 prep note 已缓存 cloudinaryUrl，且没有重复文章
    const store = new Store(dir)
    const stateAfterA = await store.read()
    assert.equal(stateAfterA.articles.length, 1)
    const articleA = stateAfterA.articles[0]
    assert.equal(articleA.id, promoteARes.articleId)
    assert.equal(articleA.sourceBagId, bagAId)
    assert.ok(articleA.blocks.some(b => b.text.includes('https://res.cloudinary.com/demo-cloud/image/upload/v1/demo-a.png')))

    const prepAfterA = await prepStore.read()
    const cachedNoteA = prepAfterA.notes.find(n => n.image?.assetId === assetA.assetId)
    assert.equal(cachedNoteA.image.cloudinaryUrl, 'https://res.cloudinary.com/demo-cloud/image/upload/v1/demo-a.png')

    // Case B: Cloudinary 上传失败 -> 保留本地路径，返回 imageTransfer.failed = 1 和 warnings，不重复建稿
    const bagBIo = makeIo()
    assert.equal(await runCli(['prep', 'bag', 'create', '上传失败测试', '--date', '2026-11-27', '--data-dir', dir, '--json'], bagBIo), 0)
    const bagBId = JSON.parse(bagBIo.read().out).bag.id

    const noteBIo = makeIo()
    assert.equal(await runCli(['prep', 'note', '失败截图', '--bag', bagBId, '--image', imgPath, '--data-dir', dir, '--json'], noteBIo), 0)
    const assetB = JSON.parse(noteBIo.read().out).note.image

    const promoteBIo = makeIo({
      stdin: `# 上传失败测试\n\n![失败截图](prep-assets/${assetB.assetId}.${assetB.ext})\n`,
      fetchImpl: async () => new Response('boom', { status: 500 }),
    })
    assert.equal(await runCli(['prep', 'bag', 'promote', bagBId, '--markdown', '-', '--data-dir', dir, '--json'], promoteBIo), 0)
    const promoteBRes = JSON.parse(promoteBIo.read().out)
    assert.equal(promoteBRes.ok, true)
    assert.equal(promoteBRes.imageTransfer.uploaded, 0)
    assert.equal(promoteBRes.imageTransfer.failed, 1)
    assert.ok(promoteBRes.warnings.length >= 1)
    assert.deepEqual(promoteBRes.warnings, promoteBRes.imageTransfer.warnings)

    const stateAfterB = await store.read()
    assert.equal(stateAfterB.articles.length, 2)
    const articleB = stateAfterB.articles.find(a => a.id === promoteBRes.articleId)
    assert.ok(articleB.blocks.some(b => b.text.includes(`prep-assets/${assetB.assetId}.${assetB.ext}`)))

    // Case C: 未配置 Cloudinary（独立工作区）-> 保留本地路径，--json 返回结构化 warnings，人类模式也打印 warnings
    const uncfgDir = await mkdtemp(join(tmpdir(), 'ws-prep-cli-nocld-'))
    try {
      const imgCPath = join(uncfgDir, 'local.png')
      await writeFile(imgCPath, makePngBuffer())

      const bagCIo = makeIo()
      assert.equal(await runCli(['prep', 'bag', 'create', '未配图床测试', '--date', '2026-11-28', '--data-dir', uncfgDir, '--json'], bagCIo), 0)
      const bagCId = JSON.parse(bagCIo.read().out).bag.id

      const noteCIo = makeIo()
      assert.equal(await runCli(['prep', 'note', '本地图', '--bag', bagCId, '--image', imgCPath, '--data-dir', uncfgDir, '--json'], noteCIo), 0)
      const assetC = JSON.parse(noteCIo.read().out).note.image

      const mdCPath = join(uncfgDir, 'article-c.md')
      await writeFile(mdCPath, `# 未配图床测试\n\n![本地图](prep-assets/${assetC.assetId}.${assetC.ext})\n`, 'utf8')

      // 人类模式：打印 warnings
      const promoteHumanIo = makeIo()
      assert.equal(await runCli(['prep', 'bag', 'promote', bagCId, '--markdown', mdCPath, '--data-dir', uncfgDir], promoteHumanIo), 0)
      const humanOut = promoteHumanIo.read().out
      assert.match(humanOut, /未配置 Cloudinary/)
      assert.match(humanOut, /2026-11-28/)

      // 验证保留本地路径且仅创建 1 篇文章
      const uncfgStore = new Store(uncfgDir)
      const uncfgArticles = (await uncfgStore.read()).articles
      assert.equal(uncfgArticles.length, 1)
      assert.ok(uncfgArticles[0].blocks.some(b => b.text.includes(`prep-assets/${assetC.assetId}.${assetC.ext}`)))
    } finally {
      await rm(uncfgDir, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('check 与 draft push 支持 --bag / --article 商单体检且互斥报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ws-prep-cli-check-'))
  try {
    // 创建商单袋并升格为文章
    const bagIo = makeIo()
    assert.equal(await runCli([
      'prep', 'bag', 'create', '商单体检测试',
      '--sponsored',
      '--partner', 'Cursor',
      '--must-include', '14天Pro兑换码,https://cursor.com/promo',
      '--taboo', '全网最强,秒杀竞品',
      '--data-dir', dir,
      '--json',
    ], bagIo), 0)
    const bagId = JSON.parse(bagIo.read().out).bag.id

    const mdPath = join(dir, 'draft.md')
    await writeFile(mdPath, '# 商单体检测试\n\n这款工具堪称全网最强，今天分享实测体验。\n', 'utf8')

    // 1. check --bag <bagId> --json 返回必带缺失与禁忌命中提醒
    const checkBagIo = makeIo()
    assert.equal(await runCli(['check', mdPath, '--bag', bagId, '--data-dir', dir, '--json'], checkBagIo), 0)
    const checkBagRes = JSON.parse(checkBagIo.read().out)
    assert.equal(checkBagRes.ok, true)
    assert.equal(checkBagRes.passed, true) // 商单提醒为 warn，不阻断
    assert.ok(checkBagRes.items.some(i => i.id === 'sponsored-must-include' && i.severity === 'warn'))
    assert.ok(checkBagRes.items.some(i => i.id === 'sponsored-taboo' && i.severity === 'warn'))

    // 升格为文章后，用 --article <articleId> 同样触发商单体检
    const promoteIo = makeIo()
    assert.equal(await runCli(['prep', 'bag', 'promote', bagId, '--markdown', mdPath, '--data-dir', dir, '--json'], promoteIo), 0)
    const articleId = JSON.parse(promoteIo.read().out).articleId

    const checkArticleIo = makeIo()
    assert.equal(await runCli(['check', mdPath, '--article', articleId, '--data-dir', dir, '--json'], checkArticleIo), 0)
    const checkArticleRes = JSON.parse(checkArticleIo.read().out)
    assert.equal(checkArticleRes.ok, true)
    assert.ok(checkArticleRes.items.some(i => i.id === 'sponsored-must-include' && i.severity === 'warn'))
    assert.ok(checkArticleRes.items.some(i => i.id === 'sponsored-taboo' && i.severity === 'warn'))

    // 2. draft push --dry-run --bag 与 --article 返回商单预检提醒
    const draftBagIo = makeIo()
    assert.equal(await runCli(['draft', 'push', mdPath, '--dry-run', '--bag', bagId, '--data-dir', dir, '--json'], draftBagIo), 0)
    const draftBagRes = JSON.parse(draftBagIo.read().out)
    assert.equal(draftBagRes.ok, true)
    assert.ok(draftBagRes.preflight.items.some(i => i.id === 'sponsored-must-include'))
    assert.ok(draftBagRes.preflight.items.some(i => i.id === 'sponsored-taboo'))

    const draftArticleIo = makeIo()
    assert.equal(await runCli(['draft', 'push', mdPath, '--dry-run', '--article', articleId, '--data-dir', dir, '--json'], draftArticleIo), 0)
    const draftArticleRes = JSON.parse(draftArticleIo.read().out)
    assert.equal(draftArticleRes.ok, true)
    assert.ok(draftArticleRes.preflight.items.some(i => i.id === 'sponsored-must-include'))
    assert.ok(draftArticleRes.preflight.items.some(i => i.id === 'sponsored-taboo'))

    // 3. 同时传 --bag 和 --article -> exit 2 (USAGE) 且明确报错
    const checkConflictIo = makeIo()
    assert.equal(await runCli(['check', mdPath, '--bag', bagId, '--article', articleId, '--data-dir', dir, '--json'], checkConflictIo), 2)
    const checkConflictRes = JSON.parse(checkConflictIo.read().out)
    assert.equal(checkConflictRes.ok, false)
    assert.equal(checkConflictRes.code, 'USAGE')
    assert.match(checkConflictRes.error, /--bag.*--article|--article.*--bag/)

    const draftConflictIo = makeIo()
    assert.equal(await runCli(['draft', 'push', mdPath, '--dry-run', '--bag', bagId, '--article', articleId, '--data-dir', dir, '--json'], draftConflictIo), 2)
    const draftConflictRes = JSON.parse(draftConflictIo.read().out)
    assert.equal(draftConflictRes.ok, false)
    assert.equal(draftConflictRes.code, 'USAGE')
    assert.match(draftConflictRes.error, /--bag.*--article|--article.*--bag/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
