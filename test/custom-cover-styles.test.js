import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import {
  analyzeCustomCoverStyle,
  CUSTOM_STYLE_PREVIEW_FILES,
  deleteCustomCoverStyle,
  detectImageContentType,
  listCoverStyles,
  previewCustomCoverStyle,
  pruneExpiredDrafts,
  readCustomCoverStyle,
  readCustomStylePreview,
  readCustomStyleReferenceDataUrl,
  readDraftPreview,
  resolveCoverReferenceImage,
  resolveCoverStyle,
  saveCustomCoverStyle,
  saveDraftPreview,
  validateCustomStyleInput,
} from '../src/custom-cover-styles.js'
import { buildCoverPromptRequest, coverPrompt } from '../src/cover-prompt.js'
import jpeg from 'jpeg-js'

const crcTable = (() => {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = buf => {
  let crc = 0xffffffff
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(width = 94, height = 40) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const off = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) { const p = off + 1 + x * 3; raw[p] = 0x22; raw[p + 1] = 0x44; raw[p + 2] = 0x88 }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function makeJpeg(width = 94, height = 40) {
  const data = Buffer.alloc(width * height * 4, 0x80)
  return Buffer.from(jpeg.encode({ data, width, height }, 85).data)
}

const VALID_TEMPLATE = [
  '21:9 宽幅黑金科技杂志风封面，深炭黑底（#141414），香槟金强调色（#D4AF37）。',
  '主标题：{{主标题第一行}} / {{主标题第二行}}',
  '右侧视觉元素：{{右侧视觉元素}}',
  '```code-fence-inside-template',
  'keep verbatim',
  '```',
].join('\n')

test('CRUD 与排序：空目录返回 7 套内置，新建/读取/更新/删除完整落盘且反引号围栏无损', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-crud-'))
  const initial = await listCoverStyles(root)
  assert.equal(initial.styles.length, 7)
  assert.deepEqual(initial.warnings, [])
  assert.ok(initial.styles.every(s => s.source === 'builtin'))

  const { draftToken } = await saveDraftPreview(root, makePng(94, 40), 'png')
  const first = await saveCustomCoverStyle(root, {
    name: '黑金杂志风',
    description: '深炭黑底与香槟金标题，适合深度评测。',
    usePortrait: false,
    userRequirement: '黑金杂志风，不要真人',
    template: VALID_TEMPLATE,
    guidance: '标题每行不超过 8 字',
    previewDraftToken: draftToken,
  })
  assert.match(first.style.id, /^custom-[a-f0-9]{8}$/)
  assert.equal(first.style.source, 'custom')
  assert.equal(first.style.previewFile, 'preview.png')
  assert.equal(first.styles.length, 8)

  // 确认磁盘结构为 meta.json + template.txt + guidance.txt + preview.png，且草稿图已被转正清理
  const styleDir = join(root, 'cover-styles', first.style.id)
  const files = (await readdir(styleDir)).sort()
  assert.deepEqual(files, ['guidance.txt', 'meta.json', 'preview.png', 'template.txt'])
  assert.equal(await readFile(join(styleDir, 'template.txt'), 'utf8'), VALID_TEMPLATE)
  await assert.rejects(readDraftPreview(root, draftToken))

  // 再建第 2 套，确保按 createdAt 升序排在内置 7 套之后
  await new Promise(r => setTimeout(r, 15))
  const second = await saveCustomCoverStyle(root, {
    name: '极简白纸风',
    description: '高留白纯文字封面，适合观点随笔。',
    usePortrait: true,
    template: '白纸底，标题 {{主标题}}，视觉 {{核心符号}}，人物 [[SUBJECT]] 穿 [[OUTFIT]]',
    guidance: '',
  })
  assert.equal(second.style.previewFile, null)
  const listed = await listCoverStyles(root)
  assert.equal(listed.styles.length, 9)
  assert.deepEqual(listed.styles.slice(7).map(s => s.id), [first.style.id, second.style.id])

  // 读取详情与 resolveCoverStyle
  const full = await readCustomCoverStyle(root, first.style.id)
  assert.equal(full.template, VALID_TEMPLATE)
  assert.equal(full.guidance, '标题每行不超过 8 字')
  assert.equal((await resolveCoverStyle(root, 'classic')).source, 'builtin')
  assert.equal((await resolveCoverStyle(root, first.style.id)).source, 'custom')

  // 更新保留 createdAt 与原预览图，更新 updatedAt
  await new Promise(r => setTimeout(r, 15))
  const updated = await saveCustomCoverStyle(root, {
    id: first.style.id,
    name: '黑金杂志风Pro',
    description: '升级版黑金杂志风。',
    usePortrait: false,
    userRequirement: '黑金杂志风升级',
    template: VALID_TEMPLATE + '\n补充一行',
    guidance: '新指引',
  })
  assert.equal(updated.style.createdAt, first.style.createdAt)
  assert.notEqual(updated.style.updatedAt, first.style.updatedAt)
  assert.equal(updated.style.previewFile, 'preview.png', '编辑未重试图且未换参考图时保留原预览')

  // 删除移除目录
  const afterDelete = await deleteCustomCoverStyle(root, first.style.id)
  assert.equal(afterDelete.styles.length, 8)
  assert.equal(await readCustomCoverStyle(root, first.style.id), null)
})

test('校验边界：字段长度、少于 2 个占位符、禁用词、30 套上限与禁止改删内置风格', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-limits-'))
  assert.throws(() => validateCustomStyleInput({ name: '', description: 'x', template: VALID_TEMPLATE }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '字'.repeat(17), description: 'x', template: VALID_TEMPLATE }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '', template: VALID_TEMPLATE }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描'.repeat(81), template: VALID_TEMPLATE }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描', template: '只有 {{一个槽位}}' }, []), err => err.status === 400 && /2 个/.test(err.message))
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描', template: '含禁用词 excited {{槽1}} {{槽2}}' }, ['excited']), err => err.status === 400 && /excited/.test(err.message))

  await assert.rejects(saveCustomCoverStyle(root, { id: 'classic', name: '改内置', description: '描', template: VALID_TEMPLATE }), err => err.status === 400)
  await assert.rejects(deleteCustomCoverStyle(root, 'classic'), err => err.status === 400)
  await assert.rejects(deleteCustomCoverStyle(root, '../escape'), err => err.status === 400)

  // 30 套上限
  for (let i = 0; i < 30; i++) {
    await saveCustomCoverStyle(root, { name: `风格${i + 1}`, description: '描述', template: VALID_TEMPLATE })
  }
  await assert.rejects(
    saveCustomCoverStyle(root, { name: '第31套', description: '描述', template: VALID_TEMPLATE }),
    err => err.status === 400 && /30/.test(err.message),
  )
})

test('两阶段原子落盘与失败恢复：新建不留脏目录、更新失败旧版无损、预览换扩展名清旧图、并发写安全', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-atomic-'))

  // 1. 新建中途失败不留 .staging-* 或目标目录
  await assert.rejects(
    saveCustomCoverStyle(root, { name: '失败新建', description: '描', template: VALID_TEMPLATE }, { _testFailBeforeCommit: true }),
    /simulated/,
  )
  const afterFailedCreate = await readdir(join(root, 'cover-styles'))
  assert.equal(afterFailedCreate.filter(name => name !== '.lock').length, 0)

  // 2. 先成功创建带 .jpg 预览图的风格
  const { draftToken: jpgDraft } = await saveDraftPreview(root, makeJpeg(94, 40), 'jpeg')
  const created = await saveCustomCoverStyle(root, {
    name: '原子测试',
    description: '旧描述',
    usePortrait: false,
    template: VALID_TEMPLATE,
    guidance: '旧指引',
    previewDraftToken: jpgDraft,
  })
  assert.equal(created.style.previewFile, 'preview.jpg')
  const styleDir = join(root, 'cover-styles', created.style.id)

  // 3. 更新写完临时文件后模拟失败：旧文件毫发无损，无残留 .tmp
  const { draftToken: pngDraft } = await saveDraftPreview(root, makePng(94, 40), 'png')
  await assert.rejects(
    saveCustomCoverStyle(root, {
      id: created.style.id,
      name: '新名字不应生效',
      description: '新描述',
      usePortrait: true,
      template: '{{新槽1}} {{新槽2}}',
      guidance: '新指引',
      previewDraftToken: pngDraft,
    }, { _testFailBeforeCommit: true }),
    /simulated/,
  )
  const intact = await readCustomCoverStyle(root, created.style.id)
  assert.equal(intact.name, '原子测试')
  assert.equal(intact.template, VALID_TEMPLATE)
  assert.equal(intact.guidance, '旧指引')
  assert.equal(intact.previewFile, 'preview.jpg')
  const entriesAfterFail = await readdir(styleDir)
  assert.ok(!entriesAfterFail.some(n => n.endsWith('.tmp')), '失败后不应残留 .tmp 文件')

  // 4. 正常更新并把预览图从 .jpg 换为 .png：旧 preview.jpg 被清理
  const updated = await saveCustomCoverStyle(root, {
    id: created.style.id,
    name: '换图成功',
    description: '新描述',
    usePortrait: false,
    template: VALID_TEMPLATE,
    guidance: '新指引',
    previewDraftToken: pngDraft,
  })
  assert.equal(updated.style.previewFile, 'preview.png')
  const entriesAfterSwap = (await readdir(styleDir)).sort()
  assert.deepEqual(entriesAfterSwap, ['guidance.txt', 'meta.json', 'preview.png', 'template.txt'])

  // 5. 并发 5 次新建，全部成功无冲突
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => saveCustomCoverStyle(root, {
      name: `并发风格${i}`,
      description: '并发写入测试',
      template: VALID_TEMPLATE,
    })),
  )
  assert.equal(new Set(results.map(r => r.style.id)).size, 5)
  assert.equal((await listCoverStyles(root)).styles.length, 7 + 1 + 5)
})

test('损坏目录隔离与隐藏/暂存目录忽略', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-corrupt-'))
  const ok = await saveCustomCoverStyle(root, { name: '正常风格', description: '描', template: VALID_TEMPLATE })
  const stylesDir = join(root, 'cover-styles')
  await mkdir(join(stylesDir, 'custom-broken1'), { recursive: true })
  await writeFile(join(stylesDir, 'custom-broken1', 'meta.json'), '{bad json')
  await mkdir(join(stylesDir, 'custom-broken2'), { recursive: true })
  await writeFile(join(stylesDir, 'custom-broken2', 'meta.json'), JSON.stringify({ id: 'custom-broken2', name: '缺模板', description: '描' }))
  await mkdir(join(stylesDir, '.staging-leftover'), { recursive: true })
  await mkdir(join(stylesDir, '_drafts'), { recursive: true })

  const listed = await listCoverStyles(root)
  assert.equal(listed.styles.length, 8)
  assert.equal(listed.styles[7].id, ok.style.id)
  assert.equal(listed.warnings.length, 2)
})

test('路径安全、符号链接逃逸拦截、文件魔数校验与草稿图 24h TTL 清理', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-sec-'))
  const outsidePng = join(root, 'outside-secret.png')
  await writeFile(outsidePng, makePng(94, 40))

  assert.deepEqual([...CUSTOM_STYLE_PREVIEW_FILES].sort(), ['preview.jpeg', 'preview.jpg', 'preview.png'])
  assert.equal(detectImageContentType(makePng(47, 20)), 'image/png')
  assert.equal(detectImageContentType(makeJpeg(47, 20)), 'image/jpeg')
  assert.equal(detectImageContentType(Buffer.from('not-an-image')), null)

  const { draftToken } = await saveDraftPreview(root, makePng(94, 40), 'png')
  const created = await saveCustomCoverStyle(root, {
    name: '安全测试',
    description: '描',
    template: VALID_TEMPLATE,
    previewDraftToken: draftToken,
  })
  const styleDir = join(root, 'cover-styles', created.style.id)
  const metaPath = join(styleDir, 'meta.json')

  // 正常读取返回正确魔数 Content-Type
  const good = await readCustomStylePreview(root, created.style.id)
  assert.equal(good.contentType, 'image/png')

  // 1. 篡改 meta.json 的 previewFile 为各种恶意值全部拒绝
  for (const malicious of ['../outside-secret.png', '/etc/passwd', 'other.png', 'sub/preview.png', '..\\x.png']) {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    meta.previewFile = malicious
    await writeFile(metaPath, JSON.stringify(meta))
    await assert.rejects(readCustomStylePreview(root, created.style.id), err => err.status === 400 || err.status === 404)
  }

  // 恢复合法 previewFile，将 JPEG 字节写入 preview.png -> 按魔数识别为 image/jpeg
  const meta = JSON.parse(await readFile(metaPath, 'utf8'))
  meta.previewFile = 'preview.png'
  await writeFile(metaPath, JSON.stringify(meta))
  await writeFile(join(styleDir, 'preview.png'), makeJpeg(94, 40))
  const mismatchedExt = await readCustomStylePreview(root, created.style.id)
  assert.equal(mismatchedExt.contentType, 'image/jpeg')

  // 伪装文本文件为 preview.png -> 拒绝
  await writeFile(join(styleDir, 'preview.png'), '<html>not an image</html>')
  await assert.rejects(readCustomStylePreview(root, created.style.id), err => err.status === 415 || err.status === 404)

  // 符号链接预览图指向外部真实 PNG -> 拒绝
  await import('node:fs/promises').then(fs => fs.unlink(join(styleDir, 'preview.png')))
  await symlink(outsidePng, join(styleDir, 'preview.png'))
  await assert.rejects(readCustomStylePreview(root, created.style.id), err => err.status === 400 || err.status === 404)

  // 符号链接风格目录 -> 拒绝读取且列表跳过
  const externalStyleDir = join(root, 'external-style')
  await mkdir(externalStyleDir, { recursive: true })
  await writeFile(join(externalStyleDir, 'meta.json'), JSON.stringify({ id: 'custom-symlink1', name: '坏', description: '坏', previewFile: 'preview.png' }))
  await writeFile(join(externalStyleDir, 'template.txt'), VALID_TEMPLATE)
  await writeFile(join(externalStyleDir, 'preview.png'), makePng(94, 40))
  await symlink(externalStyleDir, join(root, 'cover-styles', 'custom-symlink1'))
  assert.equal(await readCustomCoverStyle(root, 'custom-symlink1'), null)
  await assert.rejects(readCustomStylePreview(root, 'custom-symlink1'))

  // 非 UUID draftToken -> 拒绝
  for (const badToken of ['../outside-secret', 'not-a-uuid', '12345']) {
    await assert.rejects(readDraftPreview(root, badToken), err => err.status === 400)
  }

  // _drafts 24h TTL 清理
  const { draftToken: oldToken } = await saveDraftPreview(root, makePng(94, 40), 'png')
  const { draftToken: freshToken } = await saveDraftPreview(root, makePng(94, 40), 'png')
  const oldPath = join(root, 'cover-styles', '_drafts', `${oldToken}.png`)
  const past = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(oldPath, past, past)
  const pruned = await pruneExpiredDrafts(root)
  assert.equal(pruned, 1)
  await assert.rejects(readDraftPreview(root, oldToken))
  assert.equal((await readDraftPreview(root, freshToken)).contentType, 'image/png')
})

test('兜底预览策略：新建带参考图裁切为 47:20，极端尺寸降级无图不阻断保存', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-fallback-'))
  const refDataUrl = `data:image/png;base64,${makePng(100, 50).toString('base64')}`
  const withFallback = await saveCustomCoverStyle(root, {
    name: '参考图兜底',
    description: '跳过试生成用参考图裁切兜底。',
    template: VALID_TEMPLATE,
    fallbackReferenceImage: refDataUrl,
  })
  assert.equal(withFallback.style.previewFile, 'preview.png')
  const preview = await readCustomStylePreview(root, withFallback.style.id)
  assert.equal(preview.contentType, 'image/png')

  // 极端小尺寸（10x10 无法按 47:20 裁切）不阻断保存，降级 previewFile: null
  const tinyDataUrl = `data:image/png;base64,${makePng(10, 10).toString('base64')}`
  const degraded = await saveCustomCoverStyle(root, {
    name: '极小图降级',
    description: '极小图裁切失败降级无图。',
    template: VALID_TEMPLATE,
    fallbackReferenceImage: tinyDataUrl,
  })
  assert.equal(degraded.style.previewFile, null)
})

test('修复回归：缺失 meta.json 返 404、更新前软链拒绝、超长上限与非字符串模板校验', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-fix1-'))
  // 超长与非字符串校验
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描', userRequirement: '诉'.repeat(1001), template: VALID_TEMPLATE }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描', template: '{{a}} {{b}} ' + '模'.repeat(8000) }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描', template: VALID_TEMPLATE, guidance: '指'.repeat(4001) }, []), err => err.status === 400)
  assert.throws(() => validateCustomStyleInput({ name: '合法', description: '描', template: ['{{a}}', '{{b}}'] }, []), err => err.status === 400)

  // 缺失 meta.json 的目录调用 readCustomStylePreview 与 update 必须抛带 HTTP status 的错误
  const brokenDir = join(root, 'cover-styles', 'custom-nometa11')
  await mkdir(brokenDir, { recursive: true })
  await assert.rejects(readCustomStylePreview(root, 'custom-nometa11'), err => err.status === 404)
  await assert.rejects(
    saveCustomCoverStyle(root, { id: 'custom-nometa11', name: '修', description: '描', template: VALID_TEMPLATE }),
    err => err.status === 404,
  )
  await writeFile(join(brokenDir, 'meta.json'), '{bad json')
  await writeFile(join(brokenDir, 'template.txt'), VALID_TEMPLATE)
  await assert.rejects(
    saveCustomCoverStyle(root, { id: 'custom-nometa11', name: '修', description: '描', template: VALID_TEMPLATE }),
    err => err.status === 400,
  )

  // 更新前 guidance.txt 或旧预览图被替换为符号链接 -> 拒绝跟随
  const secretTxt = join(root, 'secret.txt')
  await writeFile(secretTxt, 'secret')
  const { draftToken: d1 } = await saveDraftPreview(root, makePng(94, 40), 'png')
  const saved = await saveCustomCoverStyle(root, {
    name: '软链更新测试',
    description: '描',
    template: VALID_TEMPLATE,
    guidance: '初始指引',
    previewDraftToken: d1,
  })
  const styleDir = join(root, 'cover-styles', saved.style.id)
  const fs = await import('node:fs/promises')
  await fs.unlink(join(styleDir, 'guidance.txt'))
  await symlink(secretTxt, join(styleDir, 'guidance.txt'))
  await assert.rejects(
    saveCustomCoverStyle(root, { id: saved.style.id, name: '改', description: '描', template: VALID_TEMPLATE }),
    err => err.status === 400,
  )

  // 恢复 guidance.txt，将 preview.png 换成软链，带新同名 png 更新时同样拒绝
  await fs.unlink(join(styleDir, 'guidance.txt'))
  await writeFile(join(styleDir, 'guidance.txt'), '初始指引')
  const outsidePng = join(root, 'outside.png')
  await writeFile(outsidePng, makePng(94, 40))
  await fs.unlink(join(styleDir, 'preview.png'))
  await symlink(outsidePng, join(styleDir, 'preview.png'))
  const { draftToken: d2 } = await saveDraftPreview(root, makePng(94, 40), 'png')
  await assert.rejects(
    saveCustomCoverStyle(root, { id: saved.style.id, name: '改', description: '描', template: VALID_TEMPLATE, previewDraftToken: d2 }),
    err => err.status === 400,
  )
})

function mockLlmCtx({ replies, modalities = ['text', 'image'], onCall = null }) {
  let idx = 0
  return {
    get: name => ({
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
      llm: {
        listModels: async () => [{ id: 'm', ...(modalities ? { inputModalities: modalities } : {}) }],
        prepareCall: async () => ({
          config: {},
          async *stream(req) {
            onCall?.(req)
            const next = replies[Math.min(idx++, replies.length - 1)]
            if (next instanceof Error) throw next
            yield { type: 'text-delta', text: typeof next === 'string' ? next : JSON.stringify(next) }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }),
      },
    }[name] ?? null),
  }
}

test('自定义风格中性填词：不注入内置 SKILL.md，按 usePortrait 展开人物占位符，反引号无截断且禁用词自动重试', async () => {
  const customStyle = {
    id: 'custom-11223344',
    name: '居中极简风',
    usePortrait: true,
    template: '21:9 极简白底，主标题 {{主标题}}，视觉 {{视觉主体}}，人物 [[SUBJECT]] 穿 [[OUTFIT]]。\n```fence\nkeep\n```',
    guidance: '标题限 10 字以内',
  }
  const req = await buildCoverPromptRequest('测试文章', '正文内容', customStyle.id, { gender: 'female', outfit: 'photo' }, { hasReference: true, customStyle })
  assert.doesNotMatch(req.system, /林月半子|七种风格|左字右人/, '自定义风格绝不能注入内置 SKILL.md')
  assert.match(req.system, /标题限 10 字以内/)
  assert.deepEqual(req.slots, ['主标题', '视觉主体'])

  // 第 1 次返回含禁用词 excited，第 2 次返回正常值
  const calls = []
  const ctx = mockLlmCtx({
    replies: [
      { values: ['an excited headline', '极简几何块'] },
      { values: ['冷静复盘', '极简几何块'] },
    ],
    onCall: r => calls.push(r),
  })
  const prompt = await coverPrompt(ctx, '测试文章', '正文内容', customStyle.id, { gender: 'female', outfit: 'photo' }, { hasReference: true, customStyle })
  assert.equal(calls.length, 2)
  assert.match(prompt, /冷静复盘/)
  assert.match(prompt, /reference image/)
  assert.match(prompt, /```fence/)
  assert.ok(!/\[\[SUBJECT\]\]|\[\[OUTFIT\]\]/.test(prompt))

  // usePortrait: false 时不带参考图描述
  const noPortraitStyle = {
    id: 'custom-55667788',
    name: '纯物件风',
    usePortrait: false,
    template: '21:9 暖白底，标题 {{主标题}}，物件 {{核心物件}}',
    guidance: '',
  }
  const ctx2 = mockLlmCtx({ replies: [{ values: ['纯标题', '陶瓷杯'] }] })
  const prompt2 = await coverPrompt(ctx2, '测试', '正文', noPortraitStyle.id, {}, { hasReference: false, customStyle: noPortraitStyle })
  assert.doesNotMatch(prompt2, /参考图|reference image/)
})

test('analyzeCustomCoverStyle：输入校验、严格视觉门禁、质量重试与最新草稿微调', async () => {
  const refImg = `data:image/png;base64,${makePng(94, 40).toString('base64')}`

  // 空输入报错
  await assert.rejects(
    analyzeCustomCoverStyle(mockLlmCtx({ replies: [] }), { referenceImages: [], requirement: '   ' }),
    err => err.status === 400,
  )
  // 超 3 张或非法 Data URL 或超 2 MB 报错
  await assert.rejects(
    analyzeCustomCoverStyle(mockLlmCtx({ replies: [] }), { referenceImages: [refImg, refImg, refImg, refImg] }),
    err => err.status === 400,
  )
  await assert.rejects(
    analyzeCustomCoverStyle(mockLlmCtx({ replies: [] }), { referenceImages: ['not-a-data-url'] }),
    err => err.status === 400,
  )
  await assert.rejects(
    analyzeCustomCoverStyle(mockLlmCtx({ replies: [] }), { referenceImages: ['data:image/gif;base64,R0lGODlhAQABAAAAACw='] }),
    err => err.status === 400 && /PNG\/JPEG\/WebP/.test(err.message),
  )
  await assert.rejects(
    analyzeCustomCoverStyle(mockLlmCtx({ replies: [] }), {
      referenceImages: [refImg],
      requirement: '已有诉求',
      draft: { name: '手改草稿', description: '描', usePortrait: false, template: '{{a}} {{b}}', guidance: '' },
      adjustment: '   ',
    }),
    err => err.status === 400 && /调整/.test(err.message),
  )
  const hugeImg = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 16, 1).toString('base64')}`
  await assert.rejects(
    analyzeCustomCoverStyle(mockLlmCtx({ replies: [] }), { referenceImages: [hugeImg] }),
    err => err.status === 400,
  )

  // 纯文本模型带参考图 -> 严格门禁直接 400 且不调用模型
  let called = 0
  const textOnlyCtx = mockLlmCtx({ replies: [{}], modalities: ['text'], onCall: () => { called++ } })
  await assert.rejects(
    analyzeCustomCoverStyle(textOnlyCtx, { referenceImages: [refImg], requirement: '模仿这张图' }),
    err => err.status === 400 && /不支持识图/.test(err.message),
  )
  assert.equal(called, 0)

  // 运行时报图片不支持 -> 不静默降级纯文本
  let rtCalls = 0
  const rtFailCtx = mockLlmCtx({
    replies: [new Error('model does not support images'), { name: '瞎编', description: '瞎编', usePortrait: false, template: '{{a}} {{b}}', guidance: '' }],
    modalities: null,
    onCall: () => { rtCalls++ },
  })
  await assert.rejects(
    analyzeCustomCoverStyle(rtFailCtx, { referenceImages: [refImg] }),
    err => err.status === 400 && /不支持图片输入/.test(err.message),
  )
  assert.equal(rtCalls, 1)

  // 首次返回不合规（只有 1 个占位符）-> 自动带错误原因重试第 2 次并成功
  const retryCalls = []
  const retryCtx = mockLlmCtx({
    replies: [
      { name: '杂志风', description: '黑金质感', usePortrait: false, template: '只有一个 {{主标题}}', guidance: '' },
      { name: '黑金杂志风', description: '深炭黑底与香槟金大字', usePortrait: false, template: '21:9 黑底金字，主标题 {{主标题}}，视觉 {{视觉主体}}', guidance: '每行限 8 字' },
    ],
    onCall: r => retryCalls.push(r),
  })
  const analyzed = await analyzeCustomCoverStyle(retryCtx, { referenceImages: [refImg], requirement: '黑金高级感' })
  assert.equal(retryCalls.length, 2)
  assert.equal(analyzed.draft.name, '黑金杂志风')
  assert.equal(analyzed.draft.usePortrait, false)
  assert.deepEqual(analyzed.draft.slots, ['主标题', '视觉主体'])

  // 微调模式：确认把用户手改后的最新 draft + adjustment + referenceImages 一并送给模型
  const refineCalls = []
  const refineCtx = mockLlmCtx({
    replies: [{
      name: '黑金杂志风',
      description: '亮白纸感黑金大字',
      usePortrait: true,
      template: '21:9 亮白纸底，标题 {{主标题}}，主体 {{视觉主体}}，人物 [[SUBJECT]] 穿 [[OUTFIT]]',
      guidance: '保留大字',
    }],
    onCall: r => refineCalls.push(r),
  })
  const editedDraft = {
    name: '用户手改名',
    description: '用户手改简介',
    usePortrait: true,
    template: '用户手改后的模板 {{主标题}} 与 {{视觉主体}}',
    guidance: '用户手改指引',
  }
  const refined = await analyzeCustomCoverStyle(refineCtx, {
    referenceImages: [refImg],
    draft: editedDraft,
    adjustment: '把背景调成亮白纸感，加上人物出镜',
  })
  assert.equal(refineCalls.length, 1)
  const sentUserText = refineCalls[0].messages[0].content[0].text
  assert.match(sentUserText, /用户手改后的模板/)
  assert.match(sentUserText, /把背景调成亮白纸感/)
  assert.ok(refineCalls[0].messages[0].content.some(p => p.type === 'image'), '微调模式应携带会话参考图')
  assert.equal(refined.draft.usePortrait, true)
})

test('previewCustomCoverStyle：分阶段回调、usePortrait 透传肖像照、裁切存草稿与 MiniMax 超时不重试', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-preview-'))
  const png = makePng(100, 40)
  const stages = []
  const fetchCalls = []
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init })
    return Response.json({ data: [{ b64_json: png.toString('base64') }] })
  }
  const llmCtx = mockLlmCtx({ replies: [{ values: ['AI 写作流', '极简终端界面'] }] })
  const settings = {
    coverProvider: 'ark',
    arkModel: 'doubao-seedream-5-5-261028',
    arkKey: 'sk-ark',
    portraitUrl: 'https://example.com/me.png',
    persona: { gender: 'auto', outfit: 'photo', outfitText: '', appearance: '' },
  }

  // 缺 Key 报错
  await assert.rejects(
    previewCustomCoverStyle(llmCtx, root, { ...settings, arkKey: '' }, {
      draft: { template: '21:9 标题 {{主标题}} 画面 {{画面}}', guidance: '', usePortrait: false },
      testTitle: '测试',
    }, fetchImpl),
    err => err.status === 400 && /API Key/.test(err.message),
  )

  // usePortrait: true -> 传 portraitUrl
  const resWithPortrait = await previewCustomCoverStyle(llmCtx, root, settings, {
    draft: {
      template: '21:9 标题 {{主标题}}，视觉 {{视觉}}，人物 [[SUBJECT]] 穿 [[OUTFIT]]',
      guidance: '',
      usePortrait: true,
    },
    testTitle: '我用 AI 搭了一套自动化写作流',
    resolution: '1K',
    onStage: s => stages.push(s),
  }, fetchImpl)
  assert.deepEqual(stages, ['prompt', 'generating', 'saving'])
  assert.equal(JSON.parse(fetchCalls[0].init.body).image, 'https://example.com/me.png')
  assert.equal(resWithPortrait.provider, 'ark')
  const savedDraft = await readDraftPreview(root, resWithPortrait.draftToken)
  assert.equal(savedDraft.contentType, 'image/png')

  // usePortrait: false -> 不传 portraitUrl
  const llmCtx2 = mockLlmCtx({ replies: [{ values: ['纯物件标题', '沙漏'] }] })
  await previewCustomCoverStyle(llmCtx2, root, settings, {
    draft: { template: '21:9 标题 {{主标题}}，视觉 {{视觉}}', guidance: '', usePortrait: false },
    testTitle: '纯物件测试',
  }, fetchImpl)
  assert.equal(JSON.parse(fetchCalls[1].init.body).image, undefined)

  // MiniMax 超时原样透传 MINIMAX_TIMEOUT 且不重试
  let mmCalls = 0
  const mmFetch = async () => {
    mmCalls++
    throw new DOMException('timeout', 'TimeoutError')
  }
  const llmCtx3 = mockLlmCtx({ replies: [{ values: ['标题', '视觉'] }] })
  await assert.rejects(
    previewCustomCoverStyle(llmCtx3, root, {
      ...settings,
      coverProvider: 'minimax',
      minimaxModel: 'MiniMax-H3-Image',
      minimaxKey: 'sk-mm',
    }, {
      draft: { template: '21:9 标题 {{主标题}}，视觉 {{视觉}}', guidance: '', usePortrait: false },
      testTitle: '超时测试',
    }, mmFetch),
    err => err.code === 'MINIMAX_TIMEOUT' && err.nonRetryable === true && /600 秒.*计费/.test(err.message),
  )
  assert.equal(mmCalls, 1)

  // 原型键 provider（如 toString）应报 400
  await assert.rejects(
    previewCustomCoverStyle(llmCtx3, root, { ...settings, coverProvider: 'toString' }, {
      draft: { template: '21:9 标题 {{主标题}}，视觉 {{视觉}}', guidance: '', usePortrait: false },
      testTitle: '原型键测试',
    }, fetchImpl),
    err => err.status === 400 && /生图提供方/.test(err.message),
  )

  // Google Gemini 试生成透传 geminiBaseUrl 与样式参考图（data: URL -> inlineData）
  const geminiCalls = []
  const geminiFetch = async (url, init) => {
    geminiCalls.push({ url, init })
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
    })
  }
  const llmCtx4 = mockLlmCtx({ replies: [{ values: ['标题', '视觉'] }] })
  const geminiRes = await previewCustomCoverStyle(llmCtx4, root, {
    ...settings,
    coverProvider: 'gemini',
    geminiModel: 'gemini-nano-banana-2.1',
    geminiKey: 'AIza-custom-style',
    geminiBaseUrl: 'https://relay.example.com/',
  }, {
    draft: { template: '21:9 标题 {{主标题}}，视觉 {{视觉}}', guidance: '', usePortrait: false, useStyleReference: true },
    styleReferenceImage: `data:image/png;base64,${png.toString('base64')}`,
    testTitle: 'Gemini 样图',
  }, geminiFetch)
  assert.equal(geminiCalls.length, 1)
  assert.equal(geminiCalls[0].url, 'https://relay.example.com/v1beta/models/gemini-nano-banana-2.1:generateContent')
  assert.equal(JSON.parse(geminiCalls[0].init.body).contents[0].parts[0].inlineData.mimeType, 'image/png')
  assert.equal(geminiRes.provider, 'gemini')
  const geminiDraft = await readDraftPreview(root, geminiRes.draftToken)
  assert.equal(geminiDraft.contentType, 'image/png')

  // OpenAI 试生成透传 openaiBaseUrl 与样式参考图（multipart/form-data -> /images/edits）
  const openaiCalls = []
  const openaiFetch = async (url, init) => {
    openaiCalls.push({ url, init })
    return Response.json({ data: [{ b64_json: png.toString('base64') }] })
  }
  const llmCtx5 = mockLlmCtx({ replies: [{ values: ['标题', '视觉'] }] })
  const openaiRes = await previewCustomCoverStyle(llmCtx5, root, {
    ...settings,
    coverProvider: 'openai',
    openaiModel: 'gpt-image-2.6-sunburst',
    openaiKey: 'sk-openai-custom-style',
    openaiBaseUrl: 'https://relay.example.com/',
  }, {
    draft: { template: '21:9 标题 {{主标题}}，视觉 {{视觉}}', guidance: '', usePortrait: false, useStyleReference: true },
    styleReferenceImage: `data:image/png;base64,${png.toString('base64')}`,
    testTitle: 'OpenAI 样图',
  }, openaiFetch)
  assert.equal(openaiCalls.length, 1)
  assert.equal(openaiCalls[0].url, 'https://relay.example.com/v1/images/edits')
  assert.ok(openaiCalls[0].init.body instanceof FormData)
  assert.equal(openaiCalls[0].init.body.get('image').type, 'image/png')
  assert.equal(openaiRes.provider, 'openai')
  const openaiDraft = await readDraftPreview(root, openaiRes.draftToken)
  assert.equal(openaiDraft.contentType, 'image/png')
})

test('coverPrompt：自定义风格中的 {{人物段}} 不受内置 felt 枚举约束', async () => {
  const ctx = mockLlmCtx({ replies: [{ values: ['写给工程师的复盘', '一名背对镜头的剪影站在窗前'] }] })
  const prompt = await coverPrompt(ctx, '写给工程师的复盘', '# 写给工程师的复盘', 'custom-person-slot', {}, {
    customStyle: {
      id: 'custom-person-slot',
      name: '窗前剪影风',
      template: '21:9 宽幅电影感，标题「{{主标题}}」，人物描述：{{人物段}}。',
      guidance: '',
      usePortrait: false,
    },
  })
  assert.match(prompt, /写给工程师的复盘/)
  assert.match(prompt, /一名背对镜头的剪影站在窗前/)
})

test('风格参考图：原子存储、resolveCoverReferenceImage 分流与试生成透传 STYLE REFERENCE DIRECTIVE', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-custom-style-ref-'))
  const png = makePng(120, 60)
  const refDataUrl = `data:image/png;base64,${png.toString('base64')}`

  // 1. 新建保存风格参考图
  const created = await saveCustomCoverStyle(root, {
    name: '红黑版画风',
    description: '高对比复古红黑版画',
    usePortrait: false,
    useStyleReference: true,
    template: 'A wide-format 21:9 banner. Title "{{主标题}}", subject {{主体}}.',
    guidance: '标题 4-8 字',
    styleReferenceImage: refDataUrl,
  })
  assert.equal(created.style.useStyleReference, true)
  assert.equal(created.style.hasStyleReference, true)
  assert.equal(created.style.styleReferenceFile, 'style-ref.png')

  const loadedUrl = await readCustomStyleReferenceDataUrl(root, created.style.id)
  assert.equal(loadedUrl, refDataUrl)

  // 2. resolveCoverReferenceImage：纯视觉且开启 useStyleReference -> 返回 style-ref
  const settings = { portraitUrl: 'https://example.com/me.png' }
  const resolvedStyle = await resolveCoverStyle(root, created.style.id)
  const styleRef = await resolveCoverReferenceImage(root, resolvedStyle, settings)
  assert.equal(styleRef.referenceKind, 'style')
  assert.equal(styleRef.referenceImage, refDataUrl)

  // 3. 关闭 useStyleReference 后不再透传参考图（但保留已存文件方便重新开启）
  const toggledOff = await saveCustomCoverStyle(root, {
    id: created.style.id,
    name: '红黑版画风',
    description: '高对比复古红黑版画',
    usePortrait: false,
    useStyleReference: false,
    template: 'A wide-format 21:9 banner. Title "{{主标题}}", subject {{主体}}.',
    guidance: '标题 4-8 字',
  })
  assert.equal(toggledOff.style.useStyleReference, false)
  assert.equal(toggledOff.style.hasStyleReference, true)
  const noRef = await resolveCoverReferenceImage(root, toggledOff.style, settings)
  assert.deepEqual(noRef, { referenceImage: null, referenceKind: null })

  // 4. previewCustomCoverStyle 开启 useStyleReference 时透传图片并附加 STYLE REFERENCE DIRECTIVE
  const fetchCalls = []
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init })
    return Response.json({ data: [{ b64_json: png.toString('base64') }] })
  }
  const llmCtx = mockLlmCtx({ replies: [{ values: ['红黑测试标题', '几何麦穗'] }] })
  const preview = await previewCustomCoverStyle(llmCtx, root, {
    coverProvider: 'ark',
    arkModel: 'doubao-seedream-5-5-261028',
    arkKey: 'sk-ark',
    portraitUrl: 'https://example.com/me.png',
    persona: { gender: 'auto', outfit: 'photo', outfitText: '', appearance: '' },
  }, {
    draft: {
      id: created.style.id,
      name: '红黑版画风',
      template: 'A wide-format 21:9 banner. Title "{{主标题}}", subject {{主体}}.',
      guidance: '',
      usePortrait: false,
      useStyleReference: true,
    },
    testTitle: '红黑测试标题',
  }, fetchImpl)
  const sentBody = JSON.parse(fetchCalls[0].init.body)
  assert.equal(sentBody.image, refDataUrl, '未传 styleReferenceImage 时应自动回退读取已保存的 style-ref')
  assert.match(preview.prompt, /^STYLE REFERENCE DIRECTIVE:/)
  assert.match(preview.prompt, /红黑测试标题/)
})

test('analyzeCustomCoverStyle：拆解 system prompt 包含工程分块规范与 template/guidance 严格隔离要求', async () => {
  const seen = []
  const ctx = mockLlmCtx({
    replies: [{
      name: '测试规范风',
      description: '结构化测试',
      usePortrait: false,
      template: 'A wide-format 21:9 banner. Title "{{主标题}}", subject {{主体}}.',
      guidance: '例如 Kimi 对应月球',
    }],
    onCall: req => seen.push(req),
  })
  await analyzeCustomCoverStyle(ctx, { requirement: '暗夜电影感' })
  assert.match(seen[0].system, /COLOR SYSTEM \(fixed\)/)
  assert.match(seen[0].system, /TEXT IN THE IMAGE/)
  assert.match(seen[0].system, /STYLE & NEGATIVES/)
  assert.match(seen[0].system, /严格隔离 template 与 guidance/)
  assert.match(seen[0].system, /风格骨架与题材场景解耦/)
  assert.doesNotMatch(seen[0].system, /多张参考图综合分析规则/)
})

test('analyzeCustomCoverStyle：多张参考图时注入多图综合分析规则并透传全部参考图与标记', async () => {
  const ref1 = `data:image/png;base64,${makePng(94, 40).toString('base64')}`
  const ref2 = `data:image/png;base64,${makePng(96, 40).toString('base64')}`
  const ref3 = `data:image/png;base64,${makePng(98, 40).toString('base64')}`
  const seen = []
  const ctx = mockLlmCtx({
    replies: [{
      name: '博主科技系列风',
      description: '真人互动与多变体媒介结合的明快科技教程系列封面',
      usePortrait: true,
      template: 'A wide-format 21:9 banner. Color {{配色方案}}, layout {{构图}}, title "{{主标题}}", subject {{视觉主体}}, person [[SUBJECT]] wearing [[OUTFIT]].',
      guidance: '配色与构图按文章主题从三种分支中择一',
    }],
    onCall: req => seen.push(req),
  })
  const res = await analyzeCustomCoverStyle(ctx, {
    referenceImages: [ref1, ref2, ref3],
    requirement: '',
  })
  assert.equal(seen.length, 1)
  assert.match(seen[0].system, /多张参考图综合分析规则（当前共 3 张：ref-1 ～ ref-3）/)
  assert.match(seen[0].system, /严禁只照搬第一张图（ref-1）/)
  assert.match(seen[0].system, /跨图共性/)
  assert.match(seen[0].system, /图间差异/)
  assert.match(seen[0].system, /按文章主题与核心道具动态选色/)
  assert.match(seen[0].system, /严禁禁用任意一张参考图中合法出现的视觉元素或媒介/)
  const userPayload = JSON.parse(seen[0].messages[0].content[0].text)
  assert.deepEqual(userPayload.referenceImageIds, ['ref-1', 'ref-2', 'ref-3'])
  assert.equal(userPayload.referenceImageCount, 3)
  assert.equal(userPayload.multiImagePolicy, 'synthesize-all')
  const imageParts = seen[0].messages[0].content.filter(part => part.type === 'image')
  assert.equal(imageParts.length, 3)
  assert.equal(res.draft.usePortrait, true)
})
